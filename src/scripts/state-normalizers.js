import {
    DEFAULT_SETTINGS,
    MAX_CLICKED_ITEMS,
    MAX_MODEL_EVENTS,
    MAX_MODEL_FEATURES,
    MAX_VISITED_ITEMS,
    MODEL_STATE_SCHEMA_VERSION,
    MODEL_VERSION,
} from './constants.js'
import {
    createDefaultCalibrationArtifacts,
    createDefaultModelArtifacts,
    createDefaultModelState,
} from './model-state.js'
import {createId, normalizeUrl} from './utils.js'

export function createDefaultState() {
    return {
        folders: [],
        lastUpdated: null,
        settings: {
            ...DEFAULT_SETTINGS,
        },
        visitedItemKeys: [],
        clickedItemKeys: [],
        modelState: createDefaultModelState(),
    }
}

export function normalizeStatePayload(rawState) {
    if (!rawState || typeof rawState !== 'object') {
        return null
    }

    return {
        folders: normalizeFolders(rawState.folders),
        lastUpdated: normalizeIsoDate(rawState.lastUpdated),
        settings: normalizeSettings(rawState.settings),
        visitedItemKeys: normalizeVisitedItemKeys(rawState.visitedItemKeys),
        clickedItemKeys: normalizeClickedItemKeys(rawState.clickedItemKeys),
        modelState: normalizeModelState(rawState.modelState),
    }
}

export function normalizeSettings(rawSettings) {
    if (!rawSettings || typeof rawSettings !== 'object') {
        return {
            ...DEFAULT_SETTINGS,
        }
    }
    return {
        ...DEFAULT_SETTINGS,
        autoMarkReadOnScroll: Boolean(rawSettings.autoMarkReadOnScroll),
    }
}

export function normalizeIsoDate(value) {
    if (!value) {
        return null
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return null
    }
    return date.toISOString()
}

export function normalizeVisitedItemKeys(rawKeys, maxItems = MAX_VISITED_ITEMS) {
    if (!Array.isArray(rawKeys)) {
        return []
    }
    const limit =
        Number.isInteger(maxItems) && maxItems > 0
            ? maxItems
            : MAX_VISITED_ITEMS
    const seen = new Set()
    const normalized = []

    rawKeys.forEach((itemKey) => {
        const nextKey = normalizeItemKey(itemKey)
        if (!nextKey || seen.has(nextKey)) {
            return
        }
        seen.add(nextKey)
        normalized.push(nextKey)
    })

    return normalized.length <= limit ? normalized : normalized.slice(-limit)
}

export function normalizeClickedItemKeys(rawKeys) {
    return normalizeVisitedItemKeys(rawKeys, MAX_CLICKED_ITEMS)
}

export function normalizeModelState(rawModelState) {
    if (!rawModelState || typeof rawModelState !== 'object') {
        return createDefaultModelState()
    }

    const schemaVersion = Number(rawModelState.schemaVersion || 0)
    const interactionLog =
        schemaVersion === MODEL_STATE_SCHEMA_VERSION
            ? normalizeInteractionLog(rawModelState.interactionLog)
            : []

    return {
        schemaVersion: MODEL_STATE_SCHEMA_VERSION,
        modelVersion: MODEL_VERSION,
        interactionLog,
        modelArtifacts: normalizeModelArtifacts(rawModelState.modelArtifacts),
        calibrationArtifacts: normalizeCalibrationArtifacts(
            rawModelState.calibrationArtifacts,
        ),
    }
}

export function normalizeItemKey(itemKey) {
    return String(itemKey || '').trim()
}

export function normalizeFolders(rawFolders) {
    if (!Array.isArray(rawFolders)) {
        return []
    }
    const usedFolderIds = new Set()
    const usedFeedIds = new Set()
    return rawFolders
        .map((folder) => normalizeFolder(folder, usedFolderIds, usedFeedIds))
        .filter(Boolean)
}

function normalizeFolder(rawFolder, usedFolderIds, usedFeedIds) {
    if (!rawFolder || typeof rawFolder !== 'object') {
        return null
    }
    const name = normalizeText(rawFolder.name)
    if (!name) {
        return null
    }
    const feeds = Array.isArray(rawFolder.feeds) ? rawFolder.feeds : []
    const normalizedFeeds = feeds
        .map((feed) => normalizeFeed(feed, usedFeedIds))
        .filter(Boolean)

    return {
        id: ensureUniqueId(rawFolder.id, usedFolderIds),
        name,
        feeds: normalizedFeeds,
    }
}

function normalizeFeed(rawFeed, usedFeedIds) {
    if (!rawFeed || typeof rawFeed !== 'object') {
        return null
    }
    const name = normalizeText(rawFeed.name)
    const rawUrl = normalizeText(rawFeed.url)
    const url = normalizeUrl(rawUrl)
    if (!name || !url) {
        return null
    }
    return {
        id: ensureUniqueId(rawFeed.id, usedFeedIds),
        name,
        url,
    }
}

function normalizeInteractionLog(rawInteractionLog) {
    if (!Array.isArray(rawInteractionLog)) {
        return []
    }
    const normalizedEntries = []
    rawInteractionLog.forEach((rawEntry) => {
        const normalizedEntry = normalizeInteractionEvent(rawEntry)
        if (!normalizedEntry) {
            return
        }
        normalizedEntries.push(normalizedEntry)
    })

    normalizedEntries.sort((left, right) => {
        const recordedAtDelta = left.recordedAt - right.recordedAt
        if (recordedAtDelta !== 0) {
            return recordedAtDelta
        }
        const itemKeyDelta = left.itemKey.localeCompare(right.itemKey)
        if (itemKeyDelta !== 0) {
            return itemKeyDelta
        }
        return left.type.localeCompare(right.type)
    })

    return normalizedEntries.slice(-MAX_MODEL_EVENTS)
}

function normalizeInteractionEvent(rawEntry) {
    if (!rawEntry || typeof rawEntry !== 'object') {
        return null
    }
    const type = normalizeInteractionType(rawEntry.type)
    const itemKey = normalizeItemKey(rawEntry.itemKey)
    const recordedAt = normalizeNonNegativeInteger(rawEntry.recordedAt)
    const snapshot = normalizeItemSnapshot(rawEntry.snapshot)
    if (!type || !itemKey || !recordedAt) {
        return null
    }
    return {
        type,
        itemKey,
        recordedAt,
        snapshot,
    }
}

function normalizeInteractionType(value) {
    const normalizedType = normalizeText(value)
    return ['impression', 'click', 'dismiss'].includes(normalizedType)
        ? normalizedType
        : ''
}

function normalizeItemSnapshot(rawSnapshot) {
    if (!rawSnapshot || typeof rawSnapshot !== 'object') {
        return {
            source: '',
            feedId: '',
            title: '',
            link: '',
            publishedAt: null,
        }
    }
    return {
        source: normalizeText(rawSnapshot.source),
        feedId: normalizeText(rawSnapshot.feedId),
        title: normalizeText(rawSnapshot.title),
        link: normalizeText(rawSnapshot.link),
        publishedAt: normalizeIsoDate(rawSnapshot.publishedAt),
    }
}

function normalizeModelArtifacts(rawArtifacts) {
    const defaults = createDefaultModelArtifacts()
    if (!rawArtifacts || typeof rawArtifacts !== 'object') {
        return defaults
    }
    return {
        trainedAt: normalizeIsoDate(rawArtifacts.trainedAt),
        totalLabeledSamples: normalizeNonNegativeInteger(
            rawArtifacts.totalLabeledSamples,
        ),
        trainingSize: normalizeNonNegativeInteger(rawArtifacts.trainingSize),
        holdoutSize: normalizeNonNegativeInteger(rawArtifacts.holdoutSize),
        positiveSamples: normalizeNonNegativeInteger(rawArtifacts.positiveSamples),
        explicitNegativeSamples: normalizeNonNegativeInteger(
            rawArtifacts.explicitNegativeSamples,
        ),
        weakNegativeSamples: normalizeNonNegativeInteger(
            rawArtifacts.weakNegativeSamples,
        ),
        baselineCtr: normalizeBoundedFloat(rawArtifacts.baselineCtr, 0, 1, null),
        bias: normalizeBoundedFloat(rawArtifacts.bias, -6, 6, 0),
        weights: normalizeWeightMap(rawArtifacts.weights),
        topFeatures: normalizeTopFeatures(rawArtifacts.topFeatures),
    }
}

function normalizeCalibrationArtifacts(rawArtifacts) {
    const defaults = createDefaultCalibrationArtifacts()
    if (!rawArtifacts || typeof rawArtifacts !== 'object') {
        return defaults
    }
    return {
        ready: Boolean(rawArtifacts.ready),
        trainedAt: normalizeIsoDate(rawArtifacts.trainedAt),
        slope: normalizeBoundedFloat(rawArtifacts.slope, -4, 4, 1),
        intercept: normalizeBoundedFloat(rawArtifacts.intercept, -8, 8, 0),
        holdoutSize: normalizeNonNegativeInteger(rawArtifacts.holdoutSize),
        metrics: normalizeCalibrationMetrics(rawArtifacts.metrics),
    }
}

function normalizeCalibrationMetrics(rawMetrics) {
    const defaults = createDefaultCalibrationArtifacts().metrics
    if (!rawMetrics || typeof rawMetrics !== 'object') {
        return defaults
    }
    return {
        prAuc: normalizeBoundedFloat(rawMetrics.prAuc, 0, 1, null),
        logLoss: normalizeBoundedFloat(rawMetrics.logLoss, 0, 10, null),
        brier: normalizeBoundedFloat(rawMetrics.brier, 0, 1, null),
        ece: normalizeBoundedFloat(rawMetrics.ece, 0, 1, null),
        baselineCtr: normalizeBoundedFloat(rawMetrics.baselineCtr, 0, 1, null),
        bucketCtrs: normalizeBucketCtrs(rawMetrics.bucketCtrs),
    }
}

function normalizeBucketCtrs(rawBucketCtrs) {
    if (!Array.isArray(rawBucketCtrs)) {
        return []
    }
    return rawBucketCtrs
        .map((bucket) => {
            if (!bucket || typeof bucket !== 'object') {
                return null
            }
            return {
                bucket: normalizeNonNegativeInteger(bucket.bucket),
                size: normalizeNonNegativeInteger(bucket.size),
                positiveRate: normalizeBoundedFloat(
                    bucket.positiveRate,
                    0,
                    1,
                    null,
                ),
            }
        })
        .filter((bucket) => bucket && bucket.bucket > 0 && bucket.size > 0)
}

function normalizeWeightMap(rawWeights) {
    if (!rawWeights || typeof rawWeights !== 'object') {
        return {}
    }
    const normalizedEntries = Object.entries(rawWeights)
        .map(([rawKey, rawValue]) => [
            normalizeText(rawKey),
            normalizeBoundedFloat(rawValue, -6, 6, 0),
        ])
        .filter(([featureKey, weight]) => featureKey && weight)

    normalizedEntries.sort((left, right) => {
        const absoluteDelta = Math.abs(right[1]) - Math.abs(left[1])
        if (absoluteDelta !== 0) {
            return absoluteDelta
        }
        return left[0].localeCompare(right[0])
    })

    return Object.fromEntries(normalizedEntries.slice(0, MAX_MODEL_FEATURES))
}

function normalizeTopFeatures(rawTopFeatures) {
    if (!Array.isArray(rawTopFeatures)) {
        return []
    }
    return rawTopFeatures
        .map((feature) => {
            if (!feature || typeof feature !== 'object') {
                return null
            }
            const featureKey = normalizeText(feature.featureKey)
            const weight = normalizeBoundedFloat(feature.weight, -6, 6, 0)
            if (!featureKey || !weight) {
                return null
            }
            return {
                featureKey,
                weight,
            }
        })
        .filter(Boolean)
        .slice(0, 12)
}

function ensureUniqueId(rawId, usedIds) {
    let nextId = normalizeText(rawId) || createId()
    while (usedIds.has(nextId)) {
        nextId = createId()
    }
    usedIds.add(nextId)
    return nextId
}

function normalizeText(value) {
    if (typeof value !== 'string') {
        return ''
    }
    return value.trim()
}

function normalizeNonNegativeInteger(value) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return 0
    }
    return Math.round(parsedValue)
}

function normalizeBoundedFloat(value, min, max, fallback = 0) {
    if (value === null && fallback === null) {
        return null
    }
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) {
        return fallback
    }
    return Math.min(Math.max(parsedValue, min), max)
}
