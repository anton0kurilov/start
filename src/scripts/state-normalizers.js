import {
    DEFAULT_SETTINGS,
    MAX_CLICKED_ITEMS,
    MAX_CLICK_MODEL_HOSTS,
    MAX_CLICK_MODEL_SOURCES,
    MAX_CLICK_MODEL_TOKENS,
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
        hostCounts: {},
        tokenCounts: {},
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
