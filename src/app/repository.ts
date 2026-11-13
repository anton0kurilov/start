import {applyCommand, command, domainState, legacyEntities} from './commands.ts'
import {
    createLocalDatabase,
    recordMap,
    type LocalDatabase,
} from './local-database.ts'
import {migrateLegacy} from './migration.ts'
import {normalizeClickObservation} from '../scripts/click-observations.js'
import {normalizeStatePayload} from '../scripts/state-normalizers.js'
import {
    entityKey,
    newProfile,
    type Command,
    type DomainState,
    type Entity,
    type EntityMap,
    type OutboxEntry,
    type Profile,
} from './sync-types.ts'
import {itemDigest} from './item-identity.ts'

export async function createRepository(
    database = createLocalDatabase(),
    scope = 'guest',
) {
    if (scope === 'guest') await migrateLegacy(database)
    let profile: Profile
    let records: EntityMap
    let base: EntityMap
    let outbox: OutboxEntry[]
    let cached: DomainState | undefined
    let queue = Promise.resolve()
    let closed = false
    const listeners = new Set<() => void>()
    const channel =
        typeof BroadcastChannel === 'undefined'
            ? null
            : new BroadcastChannel(`start:data:${scope}`)
    async function reload() {
        const loaded = await database.load(scope)
        if (!loaded.profile) throw new Error('Local profile is unavailable')
        profile = loaded.profile
        records = recordMap(loaded.records)
        base = recordMap(loaded.base)
        outbox = loaded.outbox.sort((a, b) => a.sequence - b.sequence)
    }
    function notify(remote = false) {
        if (closed) return
        for (const listener of listeners) listener()
        if (!remote) channel?.postMessage({version: profile.version})
    }
    function enqueue<T>(task: () => Promise<T>): Promise<T> {
        const result = queue.then(() => {
            if (closed) throw new Error('Repository closed')
            return task()
        })
        queue = result.then(
            () => {},
            () => {},
        )
        return result
    }
    await reload()
    const model = await database.getMetadata<Record<string, any>>(
        `model-cache:${scope}`,
    )
    cached = domainState(
        records!,
        profile!,
        model ? ({modelState: model} as DomainState) : undefined,
    )
    if (channel)
        channel.onmessage = () => {
            void enqueue(async () => {
                await reload()
                notify(true)
            }).catch(() => {})
        }

    return {
        database,
        get profile() {
            return structuredClone(profile)
        },
        get state() {
            cached = domainState(records, profile, cached)
            return cached
        },
        get pending() {
            return structuredClone(outbox)
        },
        get entities() {
            return [...records.values()].map((r) => structuredClone(r))
        },
        get base() {
            return [...base.values()].map((r) => structuredClone(r))
        },
        subscribe(listener: () => void) {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
        async flush() {
            await queue
        },
        dispatch(cmds: Command | Command[] | (() => Command[])) {
            const inputs =
                typeof cmds === 'function'
                    ? cmds
                    : structuredClone(Array.isArray(cmds) ? cmds : [cmds])
            return enqueue(async () => {
                for (let attempt = 0; attempt < 8; attempt++) {
                    let nextRecords = records
                    const effects: Entity[] = [],
                        appended: OutboxEntry[] = []
                    let sequence = profile.nextSequence
                    // Functional updates are evaluated under the same queue
                    // and retried against the latest committed profile.
                    for (const input of typeof inputs === 'function'
                        ? inputs()
                        : inputs) {
                        const result = applyCommand(nextRecords, input)
                        nextRecords = result.records
                        effects.push(...result.effects)
                        if (
                            result.effects.length &&
                            profile.userId &&
                            profile.epoch
                        ) {
                            if (!Number.isSafeInteger(sequence))
                                throw new Error('Device sequence exhausted')
                            appended.push({
                                scope,
                                sequence,
                                command: {
                                    ...input,
                                    client_seq: String(sequence++),
                                    account_epoch: profile.epoch,
                                    learning_epoch: profile.learningEpoch!,
                                },
                            })
                        }
                    }
                    if (!effects.length) return
                    const next = {
                        ...profile,
                        version: profile.version + 1,
                        nextSequence: sequence,
                    }
                    if (
                        !(await database.commit(
                            profile,
                            next,
                            effects,
                            appended,
                        ))
                    ) {
                        await reload()
                        continue
                    }
                    profile = next
                    records = nextRecords
                    outbox.push(...appended)
                    notify()
                    return
                }
                throw new Error(
                    'Данные изменяются в другой вкладке. Повторите действие.',
                )
            })
        },
        updateLocal(
            changes: Partial<
                Pick<
                    Profile,
                    | 'semanticEnabled'
                    | 'generation'
                    | 'learnerId'
                    | 'lastUpdated'
                >
            >,
        ) {
            return enqueue(async () => {
                for (let attempt = 0; attempt < 8; attempt++) {
                    const next = {
                        ...profile,
                        ...changes,
                        version: profile.version + 1,
                    }
                    if (!(await database.commit(profile, next, []))) {
                        await reload()
                        continue
                    }
                    profile = next
                    notify()
                    return
                }
                throw new Error('Local profile changed')
            })
        },
        readVersion(key: string) {
            return String(
                records.get(entityKey('read', itemDigest(key)))?.data.version ||
                    '0',
            )
        },
        reconcile(update: {
            epoch: string
            learningEpoch: string
            cursor: string
            changes: Entity[]
            snapshot?: boolean
            receipts?: {op_id: string; status: string; revision?: string}[]
        }) {
            const input = structuredClone(update)
            return enqueue(async () => {
                for (let attempt = 0; attempt < 8; attempt++) {
                    // A slower tab must never roll back a newer cursor, epoch
                    // or learning reset already committed by another tab.
                    if (
                        profile.epoch !== null &&
                        BigInt(input.epoch) < BigInt(profile.epoch)
                    )
                        return
                    if (
                        profile.epoch === input.epoch &&
                        BigInt(input.cursor) < BigInt(profile.cursor)
                    ) {
                        input.cursor = profile.cursor
                        input.learningEpoch = profile.learningEpoch!
                        input.snapshot = false
                        input.changes = []
                    }
                    const changedEpoch =
                        profile.epoch !== null && profile.epoch !== input.epoch
                    const changedLearning =
                        profile.learningEpoch !== null &&
                        profile.learningEpoch !== input.learningEpoch
                    if (changedEpoch || changedLearning)
                        await database.setMetadata(
                            `archived-queue:${scope}:${profile.epoch}:${profile.learningEpoch}`,
                            outbox,
                        )
                    const nextBase = input.snapshot
                        ? new Map<string, Entity>()
                        : new Map(base)
                    for (const row of input.changes)
                        nextBase.set(entityKey(row.kind, row.id), row)
                    const receiptMap = new Map(
                        (input.receipts || []).map((r) => [r.op_id, r]),
                    )
                    const learningCommand = (entry: OutboxEntry) =>
                        ['item.signal', 'prediction.update'].includes(
                            entry.command.type,
                        ) ||
                        (entry.command.type === 'entity.seed' &&
                            ['feedback', 'event', 'observation'].includes(
                                entry.command.payload.entity?.kind,
                            ))
                    const pending = changedEpoch
                        ? []
                        : outbox
                              .map((entry) => {
                                  const receipt = receiptMap.get(
                                      entry.command.op_id,
                                  )
                                  return receipt?.status === 'accepted'
                                      ? {
                                            ...entry,
                                            acceptedRevision: receipt.revision,
                                        }
                                      : entry
                              })
                              .filter((entry) => {
                                  const receipt = receiptMap.get(
                                      entry.command.op_id,
                                  )
                                  if (receipt && receipt.status !== 'accepted')
                                      return false
                                  return (
                                      !entry.acceptedRevision ||
                                      BigInt(entry.acceptedRevision) >
                                          BigInt(input.cursor)
                                  )
                              })
                    let projected = nextBase
                    for (const entry of pending) {
                        // The server consumes stale learning commands with a
                        // terminal rejection, preserving contiguous sequences.
                        // They must not reappear in the visible projection.
                        if (
                            learningCommand(entry) &&
                            entry.command.learning_epoch !== input.learningEpoch
                        )
                            continue
                        try {
                            projected = applyCommand(
                                projected,
                                entry.command,
                            ).records
                        } catch {
                            /* Server returns the final rejection; never resurrect tombstones. */
                        }
                    }
                    const next = {
                        ...profile,
                        epoch: input.epoch,
                        learningEpoch: input.learningEpoch,
                        cursor: input.cursor,
                        version: profile.version + 1,
                        ...(changedEpoch
                            ? {nextSequence: 1, deviceId: crypto.randomUUID()}
                            : {}),
                        ...(changedEpoch || changedLearning
                            ? {
                                  learnerId: crypto.randomUUID(),
                                  generation: crypto.randomUUID(),
                              }
                            : {}),
                    }
                    if (
                        !(await database.reconcile(
                            profile,
                            next,
                            [...nextBase.values()],
                            [...projected.values()],
                            pending,
                        ))
                    ) {
                        await reload()
                        continue
                    }
                    profile = next
                    base = nextBase
                    records = projected
                    outbox = pending
                    notify()
                    return
                }
                throw new Error('Concurrent synchronization')
            })
        },
        async replaceGuest(raw: unknown) {
            if (profile.userId)
                throw new Error(
                    'Импорт с заменой доступен в локальном профиле. Выйдите из синхронизации перед импортом.',
                )
            const payload = raw as Record<string, any>
            const state = normalizeStatePayload(
                payload.data || payload,
            ) as DomainState | null
            if (!state || !Array.isArray((payload.data || payload).folders))
                throw new Error('Некорректный файл Start.')
            const data = payload.predictionData
            if (
                data &&
                (data.schemaVersion !== 1 ||
                    !Array.isArray(data.observations) ||
                    typeof data.profileId !== 'string')
            )
                throw new Error('Неизвестный формат истории прогнозов')
            const archive =
                payload.predictionArchive || data?.observations || []
            if (!Array.isArray(archive))
                throw new Error('Некорректный архив прогнозов')
            const observations = archive.map((row: any) => {
                const normalized = normalizeClickObservation(row)
                if (
                    !normalized ||
                    (!payload.predictionArchive &&
                        normalized.profileId !== data.profileId)
                )
                    throw new Error('Некорректная история прогнозов')
                return normalized
            })
            if (observations.length > 50000)
                throw new Error('Слишком большая история прогнозов')
            if (payload.version === 2 && Array.isArray(payload.visitedItemKeys))
                state.visitedItemKeys = [
                    ...new Set(
                        payload.visitedItemKeys.filter(
                            (key: unknown) =>
                                typeof key === 'string' && key.length <= 4096,
                        ),
                    ),
                ] as string[]
            return enqueue(async () => {
                await reload()
                const next = {
                    ...profile,
                    version: profile.version + 1,
                    learnerId: crypto.randomUUID(),
                    generation: crypto.randomUUID(),
                    semanticEnabled: Boolean(state.settings.semanticEnabled),
                }
                const entities = legacyEntities(state, observations, next)
                for (const row of entities)
                    if (row.kind === 'observation')
                        row.data.ownerDeviceId = null
                await database.setMetadata(
                    `backup-before-import:${Date.now()}`,
                    {profile, entities: [...records.values()]},
                )
                if (
                    !(await database.reconcile(profile, next, [], entities, []))
                )
                    throw new Error('Профиль изменился во время импорта')
                profile = next
                records = recordMap(entities)
                base = new Map()
                outbox = []
                cached = state
                notify()
            })
        },
        observations(profileId?: string) {
            return [...records.values()]
                .filter(
                    (r) =>
                        r.kind === 'observation' &&
                        !r.deleted &&
                        (!profileId ||
                            r.data.observation.profileId === profileId),
                )
                .map((r) => structuredClone(r.data.observation))
        },
        close() {
            closed = true
            channel?.close()
            listeners.clear()
        },
    }
}
export type Repository = Awaited<ReturnType<typeof createRepository>>
