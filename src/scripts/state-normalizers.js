import {
    CLICK_MODEL_V2_DIMENSION,
    CLICK_MODEL_V2_SCHEMA_VERSION,
    DEFAULT_SETTINGS,
    MAX_CLICKED_ITEMS,
    MAX_CLICK_MODEL_HOSTS,
    MAX_CLICK_MODEL_SOURCE_HOSTS,
    MAX_CLICK_MODEL_SOURCES,
    MAX_CLICK_MODEL_TOKENS,
    MAX_CLICK_MODEL_V2_FEATURES_PER_ITEM,
    MAX_CLICK_MODEL_V2_PENDING_IMPRESSIONS,
    MAX_CLICK_MODEL_V2_WEIGHTS,
    MAX_VISITED_ITEMS,
} from './constants.js'
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
        clickModel: createDefaultClickModel(),
        clickModelV2: createDefaultClickModelV2(),
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
        clickModel: normalizeClickModel(rawState.clickModel),
        clickModelV2: normalizeClickModelV2(rawState.clickModelV2),
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
        useClickModelV2: Boolean(rawSettings.useClickModelV2),
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

    if (normalized.length <= limit) {
        return normalized
    }

    return normalized.slice(-limit)
}

export function normalizeClickedItemKeys(rawKeys) {
    return normalizeVisitedItemKeys(rawKeys, MAX_CLICKED_ITEMS)
}

export function createDefaultClickModel() {
    return {
        totalClicks: 0,
        sourceCounts: {},
        sourceHostCounts: {},
        hostCounts: {},
        tokenCounts: {},
    }
}

export function createDefaultClickModelV2() {
    return {
        schemaVersion: CLICK_MODEL_V2_SCHEMA_VERSION,
        totalEvents: 0,
        positiveEvents: 0,
        negativeEvents: 0,
        bias: 0,
        weights: {},
        gradSquares: {},
        pendingImpressions: {},
    }
}

export function normalizeClickModel(rawClickModel) {
    if (!rawClickModel || typeof rawClickModel !== 'object') {
        return createDefaultClickModel()
    }
    return {
        totalClicks: normalizeTotalClicks(rawClickModel.totalClicks),
        sourceCounts: normalizeCountMap(
            rawClickModel.sourceCounts,
            MAX_CLICK_MODEL_SOURCES,
        ),
        sourceHostCounts: normalizeCountMap(
            rawClickModel.sourceHostCounts,
            MAX_CLICK_MODEL_SOURCE_HOSTS,
        ),
        hostCounts: normalizeCountMap(
            rawClickModel.hostCounts,
            MAX_CLICK_MODEL_HOSTS,
        ),
        tokenCounts: normalizeCountMap(
            rawClickModel.tokenCounts,
            MAX_CLICK_MODEL_TOKENS,
        ),
    }
}

export function normalizeClickModelV2(rawClickModelV2) {
    if (!rawClickModelV2 || typeof rawClickModelV2 !== 'object') {
        return createDefaultClickModelV2()
    }
    const schemaVersion = Number(rawClickModelV2.schemaVersion || 1)
    if (schemaVersion !== CLICK_MODEL_V2_SCHEMA_VERSION) {
        return createDefaultClickModelV2()
    }
    const positiveEvents = normalizeNonNegativeInteger(rawClickModelV2.positiveEvents)
    const negativeEvents = normalizeNonNegativeInteger(rawClickModelV2.negativeEvents)
    const totalEvents = Math.max(
        normalizeNonNegativeInteger(rawClickModelV2.totalEvents),
        positiveEvents + negativeEvents,
    )

    return {
        schemaVersion: CLICK_MODEL_V2_SCHEMA_VERSION,
        totalEvents,
        positiveEvents,
        negativeEvents,
        bias: normalizeBoundedFloat(rawClickModelV2.bias, -6, 6, 0),
        weights: normalizeSparseWeightMap(
            rawClickModelV2.weights,
            MAX_CLICK_MODEL_V2_WEIGHTS,
        ),
        gradSquares: normalizeSparseAccumulatorMap(
            rawClickModelV2.gradSquares,
            MAX_CLICK_MODEL_V2_WEIGHTS,
        ),
        pendingImpressions: normalizePendingImpressionsMap(
            rawClickModelV2.pendingImpressions,
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

function normalizeTotalClicks(value) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return 0
    }
    return Math.round(parsedValue)
}

function normalizeCountMap(rawCounts, maxEntries) {
    if (!rawCounts || typeof rawCounts !== 'object') {
        return {}
    }
    const limit = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 0
    if (!limit) {
        return {}
    }
    const aggregate = {}
    Object.entries(rawCounts).forEach(([rawKey, rawValue]) => {
        const key = normalizeCounterKey(rawKey)
        const value = normalizeCounterValue(rawValue)
        if (!key || !value) {
            return
        }
        aggregate[key] = (aggregate[key] || 0) + value
    })
    const sortedEntries = Object.entries(aggregate).sort((left, right) => {
        return right[1] - left[1]
    })
    return Object.fromEntries(sortedEntries.slice(0, limit))
}

function normalizeCounterKey(value) {
    return String(value || '').trim().toLowerCase()
}

function normalizeCounterValue(value) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return 0
    }
    return Math.round(parsedValue)
}

function normalizeNonNegativeInteger(value) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        return 0
    }
    return Math.round(parsedValue)
}

function normalizeBoundedFloat(value, min, max, fallback = 0) {
    const parsedValue = Number(value)
    if (!Number.isFinite(parsedValue)) {
        return fallback
    }
    return Math.min(Math.max(parsedValue, min), max)
}

function normalizeSparseWeightMap(rawMap, maxEntries) {
    if (!rawMap || typeof rawMap !== 'object') {
        return {}
    }
    const aggregate = {}
    Object.entries(rawMap).forEach(([rawIndex, rawValue]) => {
        const index = normalizeSparseIndex(rawIndex)
        const value = normalizeBoundedFloat(rawValue, -6, 6, 0)
        if (index === null || !value) {
            return
        }
        aggregate[index] = (aggregate[index] || 0) + value
    })
    const sortedEntries = Object.entries(aggregate).sort((left, right) => {
        return Math.abs(right[1]) - Math.abs(left[1])
    })
    return Object.fromEntries(sortedEntries.slice(0, maxEntries))
}

function normalizeSparseAccumulatorMap(rawMap, maxEntries) {
    if (!rawMap || typeof rawMap !== 'object') {
        return {}
    }
    const aggregate = {}
    Object.entries(rawMap).forEach(([rawIndex, rawValue]) => {
        const index = normalizeSparseIndex(rawIndex)
        const value = normalizeBoundedFloat(rawValue, 0, 100000, 0)
        if (index === null || !value) {
            return
        }
        aggregate[index] = (aggregate[index] || 0) + value
    })
    const sortedEntries = Object.entries(aggregate).sort((left, right) => {
        return right[1] - left[1]
    })
    return Object.fromEntries(sortedEntries.slice(0, maxEntries))
}

function normalizePendingImpressionsMap(rawPendingImpressions) {
    if (!rawPendingImpressions || typeof rawPendingImpressions !== 'object') {
        return {}
    }
    const normalizedEntries = []
    Object.entries(rawPendingImpressions).forEach(([rawItemKey, rawValue]) => {
        const itemKey = normalizeItemKey(rawItemKey)
        if (!itemKey || !rawValue || typeof rawValue !== 'object') {
            return
        }
        const createdAt = normalizeNonNegativeInteger(rawValue.createdAt)
        if (!createdAt) {
            return
        }
        normalizedEntries.push([
            itemKey,
            {
                createdAt,
                features: normalizeSparseFeatures(rawValue.features),
            },
        ])
    })
    normalizedEntries.sort((left, right) => {
        return right[1].createdAt - left[1].createdAt
    })
    return Object.fromEntries(
        normalizedEntries.slice(0, MAX_CLICK_MODEL_V2_PENDING_IMPRESSIONS),
    )
}

function normalizeSparseFeatures(rawFeatures) {
    if (!Array.isArray(rawFeatures)) {
        return []
    }
    const aggregate = {}
    rawFeatures.forEach((feature) => {
        const source = Array.isArray(feature) ? feature : null
        const rawIndex = source ? source[0] : feature?.index
        const rawValue = source ? source[1] : feature?.value
        const index = normalizeSparseIndex(rawIndex)
        const value = normalizeBoundedFloat(rawValue, 0, 4, 0)
        if (index === null || !value) {
            return
        }
        aggregate[index] = (aggregate[index] || 0) + value
    })
    const sortedEntries = Object.entries(aggregate).sort((left, right) => {
        return right[1] - left[1]
    })
    return sortedEntries
        .slice(0, MAX_CLICK_MODEL_V2_FEATURES_PER_ITEM)
        .map(([index, value]) => [Number(index), value])
}

function normalizeSparseIndex(value) {
    const parsedValue = Number(value)
    if (
        !Number.isInteger(parsedValue) ||
        parsedValue < 0 ||
        parsedValue >= CLICK_MODEL_V2_DIMENSION
    ) {
        return null
    }
    return parsedValue
}
