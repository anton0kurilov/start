import {
    createClickObservation,
    recordObservationClick,
    recordObservationDismiss,
    normalizeClickObservation,
} from '../scripts/click-observations.js'
import {DEFAULT_SETTINGS} from '../scripts/constants.js'
import {createDefaultModelState} from '../scripts/model-state.js'
import {digest, itemDigest} from './item-identity.ts'
import {
    entityKey,
    type Command,
    type DomainState,
    type Entity,
    type EntityKind,
    type EntityMap,
    type Profile,
} from './sync-types.ts'

export function command(type: string, payload: Record<string, any>): Command {
    return {
        protocol_version: 1,
        op_id: crypto.randomUUID(),
        type,
        payload: structuredClone(payload),
    }
}
export class CommandError extends Error {
    code: string
    constructor(code: string) {
        super(code)
        this.code = code
    }
}
function requireValue(valid: unknown, code = 'INVALID_COMMAND'): asserts valid {
    if (!valid) throw new CommandError(code)
}
function text(value: unknown, limit = 512) {
    requireValue(
        typeof value === 'string' &&
            value.trim().length > 0 &&
            value.length <= limit,
    )
    return value.trim()
}
export function applyCommand(
    input: EntityMap,
    cmd: Command,
    revision = cmd.op_id,
) {
    const records = new Map(input)
    const effects: Entity[] = []
    const p = cmd.payload
    function get(kind: EntityKind, id: string, optional = false) {
        const row = records.get(entityKey(kind, id))
        if (!optional) requireValue(row && !row.deleted, 'ENTITY_DELETED')
        return row && !row.deleted ? row : undefined
    }
    function put(
        kind: EntityKind,
        id: string,
        data: Record<string, any>,
        deleted = false,
    ) {
        const row: Entity = {
            kind,
            id,
            data: structuredClone(data),
            deleted,
            revision,
        }
        records.set(entityKey(kind, id), row)
        effects.push(row)
    }
    function rows(kind: EntityKind) {
        return [...records.values()].filter(
            (row) => row.kind === kind && !row.deleted,
        )
    }
    function read(
        key: string,
        value: boolean,
        origin: string,
        expected?: string,
    ) {
        const id = itemDigest(text(key, 4096)),
            previous = get('read', id, true)
        if (
            origin !== 'manual' &&
            String(previous?.data.version || '0') !== expected
        )
            return
        put('read', id, {itemKey: key, value, origin, version: cmd.op_id})
    }
    if (cmd.type === 'entity.seed') {
        const row = p.entity as Entity
        requireValue(
            row &&
                [
                    'folder',
                    'subscription',
                    'preference',
                    'phrase',
                    'read',
                    'feedback',
                    'event',
                    'observation',
                ].includes(row.kind),
        )
        if (!records.has(entityKey(row.kind, row.id)))
            put(row.kind, text(row.id, 256), row.data, row.deleted)
    } else if (cmd.type === 'folder.create') {
        requireValue(!records.has(entityKey('folder', p.id)), 'ID_EXISTS')
        requireValue(rows('folder').length < 200, 'FOLDER_LIMIT')
        put('folder', text(p.id, 256), {
            name: text(p.name),
            position: rows('folder').length,
        })
    } else if (cmd.type === 'folder.patch') {
        const row = get('folder', p.id)!
        put('folder', row.id, {...row.data, name: text(p.name)})
    } else if (cmd.type === 'folder.move') {
        const row = get('folder', p.id)!
        const list = rows('folder')
            .sort(order)
            .filter((r) => r.id !== p.id)
        const index = list.findIndex((r) => r.id === p.beforeId)
        list.splice(index < 0 ? list.length : index, 0, row)
        list.forEach((r, position) => {
            if (r.data.position !== position)
                put('folder', r.id, {...r.data, position})
        })
    } else if (cmd.type === 'folder.delete') {
        const row = get('folder', p.id)!
        put('folder', row.id, {}, true)
        for (const sub of rows('subscription'))
            if (sub.data.folderId === row.id)
                put('subscription', sub.id, {}, true)
    } else if (cmd.type === 'subscription.create') {
        requireValue(!records.has(entityKey('subscription', p.id)), 'ID_EXISTS')
        get('folder', p.folderId)
        requireValue(rows('subscription').length < 2000, 'SUBSCRIPTION_LIMIT')
        const url = new URL(text(p.url, 4096))
        requireValue(['https:', 'http:'].includes(url.protocol))
        put('subscription', text(p.id, 256), {
            name: text(p.name),
            url: url.href,
            folderId: p.folderId,
            isFavorite: Boolean(p.isFavorite),
            position: rows('subscription').filter(
                (r) => r.data.folderId === p.folderId,
            ).length,
        })
    } else if (cmd.type === 'subscription.delete') {
        const row = get('subscription', p.id)!
        put('subscription', row.id, {}, true)
    } else if (cmd.type === 'subscription.patch') {
        const row = get('subscription', p.id)!
        const changes: Record<string, any> = {}
        if ('name' in p.changes) changes.name = text(p.changes.name)
        if ('isFavorite' in p.changes) {
            requireValue(typeof p.changes.isFavorite === 'boolean')
            changes.isFavorite = p.changes.isFavorite
        }
        if ('url' in p.changes) {
            const url = new URL(text(p.changes.url, 4096))
            requireValue(['https:', 'http:'].includes(url.protocol))
            changes.url = url.href
        }
        put('subscription', row.id, {...row.data, ...changes})
    } else if (cmd.type === 'preference.set') {
        requireValue(
            [
                'autoMarkReadOnScroll',
                'autoRefreshFeeds',
                'showRecommendedColumn',
            ].includes(p.key) && typeof p.value === 'boolean',
        )
        put('preference', p.key, {value: p.value})
    } else if (cmd.type === 'phrase.set') {
        const phrase = text(p.phrase, 512)
        requireValue(typeof p.enabled === 'boolean')
        put('phrase', digest(phrase.toLowerCase()), {
            phrase,
            enabled: p.enabled,
        })
    } else if (cmd.type === 'read.set') {
        requireValue(
            Array.isArray(p.items) &&
                p.items.length <= 200 &&
                typeof p.value === 'boolean',
        )
        for (const item of p.items)
            read(item.key, p.value, p.origin, item.expected)
    } else if (cmd.type === 'item.signal') {
        requireValue(
            ['impression', 'exposure', 'click', 'dismiss'].includes(p.signal),
        )
        const key = text(p.itemKey, 4096),
            id = itemDigest(key)
        const previous = get('feedback', id, true)?.data || {
            itemKey: key,
            clicked: false,
            dismissed: false,
        }
        if (p.signal === 'click' || p.signal === 'dismiss')
            put('feedback', id, {
                ...previous,
                clicked: previous.clicked || p.signal === 'click',
                dismissed: previous.dismissed || p.signal === 'dismiss',
            })
        if (p.signal === 'click') read(key, true, 'open', p.expected)
        if (p.signal !== 'exposure') {
            const exists = rows('event').some(
                (r) => r.data.itemKey === key && r.data.type === p.signal,
            )
            if (!exists)
                put('event', cmd.op_id, {
                    type: p.signal,
                    itemKey: key,
                    recordedAt: p.recordedAt,
                    snapshot: p.snapshot,
                })
        }
        if (p.signal !== 'impression' && p.profileId) {
            const observationId = `${p.profileId}:${id}`
            const existing = get('observation', observationId, true)
            const row =
                existing?.data.observation ||
                createClickObservation({
                    observationId,
                    profileId: p.profileId,
                    itemKey: key,
                    firstShownAt: p.recordedAt,
                    snapshot: p.snapshot,
                    context: p.context || {},
                    predictions: p.predictions || {},
                    versions: p.versions || {},
                })
            requireValue(row)
            const event = {
                profileId: p.profileId,
                itemKey: key,
                recordedAt: p.recordedAt,
            }
            const next =
                p.signal === 'click'
                    ? recordObservationClick([row], event)[0]
                    : p.signal === 'dismiss'
                      ? recordObservationDismiss([row], event)[0]
                      : row
            if (!existing || JSON.stringify(row) !== JSON.stringify(next))
                put('observation', observationId, {
                    observation: next,
                    ownerDeviceId: p.deviceId,
                    generation: p.generation,
                })
        }
    } else if (cmd.type === 'prediction.update') {
        const normalized = normalizeClickObservation(p.observation)
        requireValue(normalized)
        const id = `${normalized.profileId}:${itemDigest(normalized.itemKey)}`
        const previous = get('observation', id, true)
        if (previous) {
            const before = previous.data.observation
            for (const field of [
                'firstShownAt',
                'deadlineAt',
                'snapshot',
                'context',
                'predictions',
                'versions',
            ])
                requireValue(
                    JSON.stringify(before[field]) ===
                        JSON.stringify(normalized[field]),
                    'IMMUTABLE_OBSERVATION',
                )
            if (before.completedAt !== null)
                requireValue(
                    before.clickAt === normalized.clickAt &&
                        before.outcome === normalized.outcome,
                    'CLOSED_OBSERVATION',
                )
        }
        put('observation', id, {
            observation: normalized,
            ownerDeviceId: p.deviceId,
            generation: p.generation,
        })
    } else throw new CommandError('UNKNOWN_COMMAND')
    return {records, effects}
}
export function order(a: Entity, b: Entity) {
    return (
        Number(a.data.position || 0) - Number(b.data.position || 0) ||
        a.id.localeCompare(b.id)
    )
}
export function domainState(
    records: EntityMap,
    profile: Profile,
    cached?: DomainState,
): DomainState {
    const rows = (kind: EntityKind) =>
        [...records.values()].filter((r) => r.kind === kind && !r.deleted)
    const settings = {
        ...DEFAULT_SETTINGS,
        semanticEnabled: profile.semanticEnabled,
        blockedTitlePhrases: [] as string[],
    }
    for (const row of rows('preference'))
        (settings as Record<string, any>)[row.id] = row.data.value
    settings.blockedTitlePhrases = rows('phrase')
        .filter((r) => r.data.enabled)
        .map((r) => String(r.data.phrase))
    const events = rows('event')
        .sort(
            (a, b) =>
                a.data.recordedAt - b.data.recordedAt ||
                a.id.localeCompare(b.id),
        )
        .slice(-6000)
        .map((r) => r.data)
    return {
        folders: rows('folder')
            .sort(order)
            .map((folder) => ({
                id: folder.id,
                name: folder.data.name,
                feeds: rows('subscription')
                    .filter((r) => r.data.folderId === folder.id)
                    .sort(order)
                    .map((r) => ({
                        id: r.id,
                        name: r.data.name,
                        url: r.data.url,
                        isFavorite: r.data.isFavorite,
                    })),
            })),
        settings,
        visitedItemKeys: rows('read')
            .filter((r) => r.data.value)
            .map((r) => r.data.itemKey),
        clickedItemKeys: rows('feedback')
            .filter((r) => r.data.clicked)
            .map((r) => r.data.itemKey),
        modelState: {
            ...(cached?.modelState || createDefaultModelState()),
            interactionLog: events,
        },
        predictionGeneration: profile.generation,
        lastUpdated: profile.lastUpdated || null,
    }
}
export function legacyEntities(
    state: DomainState,
    observations: Record<string, any>[] = [],
    profile?: Profile,
) {
    const records: Entity[] = []
    const put = (kind: EntityKind, id: string, data: Record<string, any>) =>
        records.push({kind, id, data, revision: '0', deleted: false})
    state.folders.forEach((folder, position) => {
        put('folder', folder.id, {name: folder.name, position})
        folder.feeds.forEach((feed, position) =>
            put('subscription', feed.id, {
                ...feed,
                folderId: folder.id,
                position,
            }),
        )
    })
    for (const key of [
        'autoMarkReadOnScroll',
        'autoRefreshFeeds',
        'showRecommendedColumn',
    ])
        put('preference', key, {value: (state.settings as any)[key]})
    for (const phrase of state.settings.blockedTitlePhrases)
        put('phrase', digest(phrase.toLowerCase()), {phrase, enabled: true})
    for (const key of state.visitedItemKeys)
        put('read', itemDigest(key), {
            itemKey: key,
            value: true,
            origin: 'legacy',
            version: '0',
        })
    const feedback = new Map<string, Record<string, any>>()
    for (const key of state.clickedItemKeys)
        feedback.set(key, {itemKey: key, clicked: true, dismissed: false})
    for (const event of state.modelState.interactionLog || []) {
        put('event', digest(JSON.stringify(event)), event)
        if (event.type === 'click' || event.type === 'dismiss') {
            const item = feedback.get(event.itemKey) || {
                itemKey: event.itemKey,
                clicked: false,
                dismissed: false,
            }
            item.clicked ||= event.type === 'click'
            item.dismissed ||= event.type === 'dismiss'
            feedback.set(event.itemKey, item)
        }
    }
    for (const [key, value] of feedback) put('feedback', itemDigest(key), value)
    for (const observation of observations)
        put(
            'observation',
            `${observation.profileId}:${itemDigest(observation.itemKey)}`,
            {
                observation,
                ownerDeviceId: profile?.deviceId || null,
                generation: profile?.generation,
            },
        )
    return records
}
