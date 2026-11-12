export const CLICK_OBSERVATION_SCHEMA_VERSION = 1
export const CLICK_TARGET_VERSION = 'click-24h-v1'
export const CLICK_WINDOW_MS = 24 * 60 * 60 * 1000

// These values are measurements at first exposure, not a mutable card model.
export function createClickObservation(input) {
    if (!input || typeof input !== 'object') return null
    const observationId = identifier(input.observationId, 256)
    const profileId = identifier(input.profileId, 256)
    const itemKey = identifier(input.itemKey, 4096)
    const firstShownAt = timestamp(input.firstShownAt)
    if (
        !observationId ||
        !profileId ||
        !itemKey ||
        firstShownAt === null ||
        firstShownAt > Number.MAX_SAFE_INTEGER - CLICK_WINDOW_MS
    )
        return null

    const item = input.snapshot || input.item || {}
    const predictions = {}
    for (const [key, value] of Object.entries(input.predictions || {})) {
        if (!safeKey(key)) continue
        predictions[key] =
            typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= 0 &&
            value <= 1
                ? value
                : null
    }
    return freeze({
        schemaVersion: CLICK_OBSERVATION_SCHEMA_VERSION,
        targetVersion: CLICK_TARGET_VERSION,
        observationId,
        profileId,
        itemKey,
        firstShownAt,
        deadlineAt: firstShownAt + CLICK_WINDOW_MS,
        snapshot: {
            title: text(item.title, 512),
            description: text(item.description, 2000),
            source: text(item.source, 512),
            feedId: text(item.feedId, 256),
            link: text(item.link, 4096),
            publishedAt: isoDate(item.publishedAt ?? item.date),
        },
        context: copyRecord(input.context),
        predictions,
        versions: copyRecord(input.versions),
        embeddingKey: identifier(input.embeddingKey, 1024) || null,
        clickAt: null,
        lateClickAt: null,
        dismissAt: null,
        outcome: null,
        completedAt: null,
    })
}

export function normalizeClickObservation(raw) {
    if (
        raw?.schemaVersion !== CLICK_OBSERVATION_SCHEMA_VERSION ||
        raw?.targetVersion !== CLICK_TARGET_VERSION
    )
        return null
    const observation = createClickObservation(raw)
    if (!observation || raw.deadlineAt !== observation.deadlineAt) return null
    const validTime = (value) => {
        const time = timestamp(value)
        return time !== null && time >= observation.firstShownAt ? time : null
    }
    const click = validTime(raw.clickAt)
    const lateClick = validTime(raw.lateClickAt)
    const completion = validTime(raw.completedAt)
    const clickAt =
        click !== null && click < observation.deadlineAt ? click : null
    const completedAt =
        completion !== null && completion >= observation.deadlineAt
            ? completion
            : null
    return freeze({
        ...observation,
        clickAt,
        lateClickAt:
            lateClick !== null && lateClick >= observation.deadlineAt
                ? lateClick
                : null,
        dismissAt: validTime(raw.dismissAt),
        completedAt,
        // Never trust an imported label independently of its recorded events.
        outcome: completedAt === null ? null : clickAt === null ? 0 : 1,
    })
}

export function recordClickExposure(observations, input) {
    const rows = Array.isArray(observations) ? observations : []
    const observation = createClickObservation(input)
    if (
        !observation ||
        rows.some(
            (row) =>
                sameItem(row, observation) ||
                row.observationId === observation.observationId,
        )
    )
        return rows
    return [...rows, observation]
}

export function recordObservationClick(observations, event) {
    let rows = Array.isArray(observations) ? observations : []
    const recordedAt = timestamp(event?.recordedAt)
    if (recordedAt === null) return rows
    // The caller supplies the exposure captured BEFORE applying the click.
    if (!rows.some((row) => sameItem(row, event)) && event.exposure) {
        if (
            !sameItem(event.exposure, event) ||
            timestamp(event.exposure.firstShownAt) === null ||
            recordedAt < event.exposure.firstShownAt
        )
            return rows
        rows = recordClickExposure(rows, event.exposure)
    }
    return updateRows(rows, event, (row) => {
        if (recordedAt < row.firstShownAt) return row
        if (recordedAt >= row.deadlineAt) {
            if (row.lateClickAt !== null && row.lateClickAt <= recordedAt)
                return row
            return freeze({...row, lateClickAt: recordedAt})
        }
        // Storage must serialize event writes ahead of finalization. A closed
        // observation cannot be relabeled by a delayed/backdated event.
        if (row.completedAt !== null) return row
        if (row.clickAt !== null && row.clickAt <= recordedAt) return row
        return freeze({...row, clickAt: recordedAt})
    })
}

export function recordObservationDismiss(observations, event) {
    const rows = Array.isArray(observations) ? observations : []
    const recordedAt = timestamp(event?.recordedAt)
    if (recordedAt === null) return rows
    return updateRows(rows, event, (row) => {
        if (recordedAt < row.firstShownAt) return row
        if (row.dismissAt !== null && row.dismissAt <= recordedAt) return row
        return freeze({...row, dismissAt: recordedAt})
    })
}

export function finalizeClickObservations(observations, now) {
    const rows = Array.isArray(observations) ? observations : []
    if (timestamp(now) === null) return rows
    let changed = false
    const next = rows.map((row) => {
        if (row.completedAt !== null || now < row.deadlineAt) return row
        changed = true
        return freeze({
            ...row,
            completedAt: now,
            outcome: row.clickAt === null ? 0 : 1,
        })
    })
    return changed ? next : rows
}

export function getEligibleClickObservations(observations, now) {
    if (timestamp(now) === null) return []
    return finalizeClickObservations(observations, now).filter(
        (row) => row.deadlineAt <= now && row.completedAt <= now,
    )
}

function updateRows(rows, event, update) {
    let changed = false
    const next = rows.map((row) => {
        if (!sameItem(row, event)) return row
        const updated = update(row)
        changed ||= updated !== row
        return updated
    })
    return changed ? next : rows
}

function sameItem(left, right) {
    return (
        !!left &&
        !!right &&
        left.profileId === right.profileId &&
        left.itemKey === right.itemKey
    )
}

function timestamp(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function identifier(value, limit) {
    if (typeof value !== 'string') return ''
    const normalized = value.trim()
    return normalized.length <= limit ? normalized : ''
}

function text(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function isoDate(value) {
    if (value === null || value === undefined || value === '') return null
    if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        !(value instanceof Date)
    )
        return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function safeKey(key) {
    return !['__proto__', 'constructor', 'prototype'].includes(key)
}

function copyRecord(value, depth = 0) {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        depth > 6
    )
        return {}
    const output = {}
    for (const [key, entry] of Object.entries(value)) {
        if (!safeKey(key)) continue
        output[key] = copyValue(entry, depth + 1)
    }
    return output
}

function copyValue(value, depth) {
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string') return value.slice(0, 4096)
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (Array.isArray(value))
        return depth > 6
            ? []
            : value.slice(0, 512).map((entry) => copyValue(entry, depth + 1))
    return copyRecord(value, depth)
}

function freeze(value) {
    for (const entry of Object.values(value)) {
        if (entry && typeof entry === 'object' && !Object.isFrozen(entry))
            freeze(entry)
    }
    return Object.freeze(value)
}
