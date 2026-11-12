import {
    createClickObservation,
    recordObservationClick,
    recordObservationDismiss,
    finalizeClickObservations,
    normalizeClickObservation,
} from '../scripts/click-observations.js'
import {createPredictionStorage} from './prediction-storage.ts'
import type {Card} from './types'

export type PredictionHistoryStatus = 'loading' | 'ready' | 'error'
type Observation = {
    itemKey: string
    profileId: string
    deadlineAt: number
    completedAt: number | null
    [key: string]: unknown
}
type Storage = ReturnType<typeof createPredictionStorage<Observation>>
type StorageFactory = (options: {dbName: string}) => Storage

// One ordered queue captures intent before storage work. Cleanup runs even when
// its generation is obsolete; normal writes never cross profile generations.
export function createPredictions({
    now = Date.now,
    onStatus = (_status: PredictionHistoryStatus) => {},
    storageFactory = (options) => createPredictionStorage<Observation>(options),
    forecast = (
        _snapshot: Record<string, unknown>,
        _context: Record<string, unknown>,
    ) =>
        ({predictions: {a1: null, b: null}, versions: {}}) as {
            predictions: Record<string, number | null>
            versions: Record<string, unknown>
        },
}: {
    now?: () => number
    onStatus?: (status: PredictionHistoryStatus) => void
    storageFactory?: StorageFactory
    forecast?: (
        snapshot: Record<string, unknown>,
        context: Record<string, unknown>,
    ) => {
        predictions: Record<string, number | null>
        versions: Record<string, unknown>
    }
} = {}) {
    let epoch = 0
    let activeGeneration: string | undefined
    let store: Storage | undefined
    let queue = Promise.resolve()
    let disposed = false
    let failed = false
    const stagedGenerations = new Set<string>()

    async function discardImport(generation: string) {
        if (
            !stagedGenerations.has(generation) ||
            generation === activeGeneration
        )
            return
        const staged = storageFactory({
            dbName: `start:predictions:${generation}`,
        })
        try {
            await staged.clear()
            stagedGenerations.delete(generation)
        } finally {
            staged.close()
        }
    }

    function status(value: PredictionHistoryStatus, current: number) {
        if (!disposed && current === epoch) onStatus(value)
    }
    function enqueue(
        task: () => Promise<void>,
        current = epoch,
        cleanup = false,
    ) {
        queue = queue
            .then(async () => {
                if (!cleanup && (disposed || current !== epoch)) return
                try {
                    await task()
                } catch {
                    if (current === epoch && !disposed) {
                        failed = true
                        status('error', current)
                    }
                }
            })
            .catch(() => {
                // A rendering callback must not poison subsequent persistence work.
                if (current === epoch) failed = true
            })
    }
    async function mature(target: Storage, current: number) {
        const records = await target.listObservations()
        for (const row of records) {
            if (disposed || current !== epoch) return
            if (row.completedAt == null && row.deadlineAt <= now())
                await target.updateObservation(row.itemKey, (latest) =>
                    latest
                        ? finalizeClickObservations([latest], now())[0]
                        : null,
                )
        }
        const closed = records
            .filter((row) => row.deadlineAt <= now())
            .sort((a, b) => Number(b.firstShownAt) - Number(a.firstShownAt))
        for (const row of closed.filter(
            (row, index) =>
                index >= 10000 ||
                Number(row.firstShownAt) < now() - 90 * 86400000,
        )) {
            if (disposed || current !== epoch) return
            await target.updateObservation(row.itemKey, (latest) =>
                latest && latest.deadlineAt > now() ? latest : null,
            )
        }
    }
    function start(generation: string) {
        if (disposed) return
        const current = ++epoch
        const previous = store
        const previousGeneration = activeGeneration
        activeGeneration = generation
        stagedGenerations.delete(generation)
        store = undefined
        failed = false
        status('loading', current)
        enqueue(
            async () => {
                if (previous) {
                    try {
                        if (previousGeneration !== activeGeneration)
                            await previous.clear()
                    } finally {
                        previous.close()
                    }
                }
            },
            current,
            true,
        )
        enqueue(async () => {
            const next = storageFactory({
                dbName: `start:predictions:${generation}`,
            })
            let adopted = false
            let healthy = false
            try {
                await next.getProfileId()
                if (disposed || current !== epoch) {
                    if (generation !== activeGeneration) await next.clear()
                    return
                }
                store = next
                adopted = true
                await mature(next, current)
                healthy = true
                if (!failed) status('ready', current)
            } finally {
                if (!adopted) next.close()
                else if (!healthy && current === epoch) {
                    if (store === next) store = undefined
                    next.close()
                }
            }
        }, current)
    }
    function record(
        kind: 'exposure' | 'click' | 'dismiss',
        card: Card,
        context: Record<string, unknown> = {},
    ) {
        if (disposed) return
        const recordedAt = now()
        const snapshot = {
            title: card.title,
            description: card.description || '',
            link: card.link,
            source: card.source,
            feedId: card.feedId,
            publishedAt: card.date?.toISOString() || null,
        }
        const itemKey = card.itemKey
        const frozenContext = structuredClone({
            ...context,
            referenceTime: recordedAt,
            firstShownAt: recordedAt,
        })
        const frozenForecast = structuredClone(
            forecast(snapshot, frozenContext),
        )
        const current = epoch
        enqueue(async () => {
            const target = store
            if (!target) throw new Error('Prediction storage unavailable')
            const profileId = await target.getProfileId()
            if (disposed || current !== epoch) return
            await target.updateObservation(itemKey, (previous) => {
                const exposure = createClickObservation({
                    observationId: crypto.randomUUID(),
                    profileId,
                    itemKey,
                    firstShownAt: recordedAt,
                    snapshot,
                    context: frozenContext,
                    // Legacy scores are not calibrated CTR predictions.
                    predictions: {legacy: null, ...frozenForecast.predictions},
                    versions: {legacy: 2, ...frozenForecast.versions},
                })
                const row = previous || exposure
                if (!row) throw new Error('Invalid click observation')
                if (kind === 'click')
                    return recordObservationClick([row], {
                        profileId,
                        itemKey,
                        recordedAt,
                    })[0]
                if (kind === 'dismiss')
                    return recordObservationDismiss([row], {
                        profileId,
                        itemKey,
                        recordedAt,
                    })[0]
                return row
            })
        }, current)
    }
    return {
        start,
        record,
        tick() {
            const current = epoch
            enqueue(async () => {
                if (store) await mature(store, current)
            }, current)
        },
        async exportData() {
            const current = epoch
            await queue
            const target = store
            if (disposed || current !== epoch || !target || failed)
                throw new Error('Prediction history unavailable')
            const profileId = await target.getProfileId()
            const observations = await target.listObservations()
            if (
                disposed ||
                current !== epoch ||
                observations.some((row) => row.profileId !== profileId)
            )
                throw new Error('Prediction profile changed during export')
            return {schemaVersion: 1, profileId, observations}
        },
        async stageImport(raw: unknown) {
            const current = epoch
            if (disposed) throw new Error('Prediction history unavailable')
            const input = raw as {
                schemaVersion?: number
                profileId?: string
                observations?: unknown[]
            }
            if (
                !input ||
                input.schemaVersion !== 1 ||
                typeof input.profileId !== 'string' ||
                !input.profileId.trim() ||
                !Array.isArray(input.observations) ||
                input.observations.length > 10000
            )
                throw new Error('Unsupported prediction data')
            const rows = input.observations.map(
                normalizeClickObservation,
            ) as (Observation | null)[]
            if (rows.some((row) => !row || row.profileId !== input.profileId))
                throw new Error('Invalid prediction observations')
            const validRows = rows as Observation[]
            if (
                new Set(validRows.map((row) => row.itemKey)).size !==
                validRows.length
            )
                throw new Error('Duplicate observations')
            const generation = crypto.randomUUID()
            const staged = storageFactory({
                dbName: `start:predictions:${generation}`,
            })
            let completed = false
            try {
                await staged.replaceObservations(validRows, input.profileId)
                if (disposed || current !== epoch)
                    throw new Error('Prediction import was superseded')
                completed = true
                stagedGenerations.add(generation)
                return generation
            } finally {
                try {
                    if (!completed) await staged.clear()
                } finally {
                    staged.close()
                }
            }
        },
        discardImport,
        dispose() {
            disposed = true
            epoch++
            const previous = store
            store = undefined
            void queue.then(async () => {
                previous?.close()
                await Promise.allSettled(
                    [...stagedGenerations].map(discardImport),
                )
            })
        },
    }
}
