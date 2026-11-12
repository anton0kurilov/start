import {
    buildClickFeatures,
    predictClickProbability,
} from '../scripts/click-model.js'
import {evaluateClickProbabilities} from '../scripts/click-calibration.js'
import {
    getEligibleClickObservations,
    normalizeClickObservation,
} from '../scripts/click-observations.js'
import type {
    ClickModel,
    ClickTrainingRequest,
    ClickTrainingResponse,
} from './click-worker'

export type PredictionSnapshot = {
    title?: string
    description?: string
    source?: string
    feedId?: string
    link?: string
    publishedAt?: string | null
}
export type PredictionContext = {
    column?: string
    position?: number
    referenceTime?: number
    [key: string]: unknown
}
type TrainingWorker = Pick<
    Worker,
    'postMessage' | 'terminate' | 'onmessage' | 'onerror'
>
const DAY = 24 * 60 * 60 * 1000

// Candidates only: these probabilities are logged before outcomes, never
// advertised as calibrated or published to the recommendation UI.
export function createShadowPredictions({
    embed,
    encoderVersion = 'rubert-tiny-cls-q8-1d6a20cc',
    createWorker = () =>
        new Worker(new URL('./click-worker.ts', import.meta.url), {
            type: 'module',
        }),
}: {
    embed: (text: string) => Promise<number[]>
    encoderVersion?: string
    createWorker?: () => TrainingWorker
}) {
    let disposed = false
    let epoch = 0
    let preparation = 0
    let sequence = 0
    let worker: TrainingWorker | undefined
    let heads: {a1: ClickModel | null; b: ClickModel | null} = {
        a1: null,
        b: null,
    }
    let cutoff = 0
    let trainedSignature = ''
    const vectors = new Map<string, number[]>()
    const inFlight = new Map<string, Promise<number[] | null>>()
    const pending = new Map<
        number,
        (value: ClickTrainingResponse | null) => void
    >()

    function text(snapshot: PredictionSnapshot) {
        return [
            snapshot.title?.trim().slice(0, 512),
            snapshot.description?.trim().slice(0, 2000),
        ]
            .filter(Boolean)
            .join('\n\n')
    }
    function frozenContext(
        context: PredictionContext,
        firstShownAt = context.referenceTime,
    ) {
        return {...context, firstShownAt}
    }
    async function prepareItem(snapshot: PredictionSnapshot) {
        if (disposed) return null
        const key = text(snapshot)
        if (!key) return null
        if (vectors.has(key)) return vectors.get(key)!
        if (inFlight.has(key)) return inFlight.get(key)!
        const current = epoch
        const task = (async () => {
            try {
                const vector = await embed(key)
                if (
                    disposed ||
                    current !== epoch ||
                    !Array.isArray(vector) ||
                    vector.length !== 312 ||
                    !vector.every(Number.isFinite) ||
                    !vector.some((value) => value !== 0)
                )
                    return null
                const copy = [...vector]
                if (vectors.size >= 2000)
                    vectors.delete(vectors.keys().next().value!)
                vectors.set(key, copy)
                return copy
            } catch {
                return null
            } finally {
                if (current === epoch) inFlight.delete(key)
            }
        })()
        inFlight.set(key, task)
        return task
    }
    function stopWorker() {
        worker?.terminate()
        worker = undefined
        pending.forEach((resolve) => resolve(null))
        pending.clear()
    }
    function train(request: Omit<ClickTrainingRequest, 'id'>) {
        return new Promise<ClickTrainingResponse | null>((resolve) => {
            try {
                if (!worker) {
                    worker = createWorker()
                    worker.onmessage = ({
                        data,
                    }: MessageEvent<ClickTrainingResponse>) => {
                        pending.get(data.id)?.(data)
                        pending.delete(data.id)
                    }
                    worker.onerror = () => stopWorker()
                }
                const id = ++sequence
                pending.set(id, resolve)
                worker.postMessage({id, ...request})
            } catch {
                stopWorker()
                resolve(null)
            }
        })
    }
    async function prepare(observations: unknown[], now: number) {
        if (disposed || !Number.isSafeInteger(now) || now < 0) return
        const current = epoch
        const job = ++preparation
        const seen = new Set<string>()
        const valid = observations.flatMap((raw) => {
            const row = normalizeClickObservation(raw)
            if (!row) return []
            const identity = JSON.stringify([row.profileId, row.itemKey])
            if (seen.has(identity)) return []
            seen.add(identity)
            return [row]
        })
        const rows = getEligibleClickObservations(valid, now)
            .filter((row) => row.firstShownAt >= now - 90 * DAY)
            .sort((a, b) => a.firstShownAt - b.firstShownAt)
            .slice(-10000)
            .slice(-500)
        const positive = rows.filter((row) => row.outcome === 1).length
        if (positive < 5 || rows.length - positive < 5) return
        const signature = JSON.stringify(
            rows.map((row) => [row.observationId, row.outcome]),
        )
        if (signature === trainedSignature) return
        const a1 = rows.map((row) => ({
            snapshot: row.snapshot,
            context: frozenContext(row.context, row.firstShownAt),
            outcome: row.outcome,
        }))
        const b: ClickTrainingRequest['b'] = []
        for (let index = 0; index < rows.length; index++) {
            const embedding = await prepareItem(rows[index].snapshot)
            if (disposed || current !== epoch || job !== preparation) return
            if (embedding) b.push({...a1[index], embedding})
        }
        const result = await train({a1, b})
        if (
            disposed ||
            current !== epoch ||
            job !== preparation ||
            !result ||
            result.error
        )
            return
        heads = {a1: result.a1 ?? null, b: result.b ?? null}
        cutoff = Math.max(...rows.map((row) => row.deadlineAt))
        trainedSignature = result.b ? signature : ''
    }
    function predict(snapshot: PredictionSnapshot, context: PredictionContext) {
        const vector = vectors.get(text(snapshot))
        const metadata = frozenContext(context)
        const active =
            !disposed &&
            Number.isFinite(context.referenceTime) &&
            context.referenceTime! >= cutoff
        return {
            predictions: {
                a1:
                    active && heads.a1
                        ? predictClickProbability(
                              heads.a1,
                              buildClickFeatures(snapshot, metadata),
                          )
                        : null,
                b:
                    active && heads.b && vector
                        ? predictClickProbability(
                              heads.b,
                              buildClickFeatures(snapshot, metadata, vector),
                          )
                        : null,
            },
            versions: {
                a1: heads.a1 ? `click-a1-v1@${cutoff}` : null,
                b: heads.b ? `click-b-v1@${cutoff}` : null,
                encoder: encoderVersion,
                calibration: 'unvalidated-shadow-v1',
            },
        }
    }
    function report(observations: unknown[], now: number) {
        const metrics = (rows: unknown[], predictionKey: string) =>
            evaluateClickProbabilities(rows, {predictionKey, now})
        const common = observations.filter((raw) => {
            const row = normalizeClickObservation(raw)
            return (
                typeof row?.predictions.a1 === 'number' &&
                typeof row?.predictions.b === 'number'
            )
        })
        return {
            published: false,
            all: {
                a1: metrics(observations, 'a1'),
                b: metrics(observations, 'b'),
            },
            common: {a1: metrics(common, 'a1'), b: metrics(common, 'b')},
        }
    }
    function reset() {
        epoch++
        preparation++
        stopWorker()
        vectors.clear()
        inFlight.clear()
        heads = {a1: null, b: null}
        trainedSignature = ''
        cutoff = 0
    }
    return {
        prepareItem,
        prepare,
        predict,
        report,
        reset,
        dispose() {
            disposed = true
            reset()
        },
    }
}
