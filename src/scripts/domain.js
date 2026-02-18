import {
    CORS_PROXY,
    DEFAULT_SETTINGS,
    FETCH_TIMEOUT,
} from './constants.js'
import {loadState, saveState, clearState} from './storage.js'
import {createId, normalizeUrl, decodeHtmlEntities} from './utils.js'
import {
    normalizeItemKey,
    normalizeStatePayload,
    normalizeVisitedItemKeys,
} from './state-normalizers.js'

let state = loadState()
let visitedItemKeysSet = new Set(state.visitedItemKeys || [])
const feedItems = new Map()
const feedErrors = new Map()
const FALLBACK_CORS_PROXY = 'https://api.allorigins.win/raw?url='
const PROXY_HEALTHCHECK_URL = 'https://example.com/'
const CORS_PROXY_BASES = [CORS_PROXY, FALLBACK_CORS_PROXY]
let activeProxyBase = CORS_PROXY

export function getState() {
    return state
}

export function createFolder(name) {
    state.folders.push({
        id: createId(),
        name,
        feeds: [],
    })
    saveState(state)
}

export function addFeed({folderId, name, url}) {
    const folder = state.folders.find((item) => item.id === folderId)
    if (!folder) {
        return
    }
    folder.feeds.push({
        id: createId(),
        name,
        url: normalizeUrl(url),
    })
    saveState(state)
}

export function removeFolder(folderId) {
    const folder = state.folders.find((item) => item.id === folderId)
    if (folder) {
        folder.feeds.forEach((feed) => {
            feedItems.delete(feed.id)
            feedErrors.delete(feed.id)
        })
    }
    state.folders = state.folders.filter((folder) => folder.id !== folderId)
    saveState(state)
}

export function removeFeed(folderId, feedId) {
    const folder = state.folders.find((item) => item.id === folderId)
    if (!folder) {
        return
    }
    folder.feeds = folder.feeds.filter((feed) => feed.id !== feedId)
    feedItems.delete(feedId)
    feedErrors.delete(feedId)
    saveState(state)
}

export function resetState() {
    clearState()
    state = loadState()
    visitedItemKeysSet = new Set(state.visitedItemKeys || [])
    feedItems.clear()
    feedErrors.clear()
}

export function exportState() {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        folders: state.folders.map((folder) => ({
            id: folder.id,
            name: folder.name,
            feeds: folder.feeds.map((feed) => ({
                id: feed.id,
                name: feed.name,
                url: feed.url,
            })),
        })),
        lastUpdated: state.lastUpdated,
        settings: {
            ...DEFAULT_SETTINGS,
            ...(state.settings || {}),
        },
    }
}

export function importState(rawState) {
    const normalized = normalizeImportedState(rawState)
    if (!normalized) {
        return {ok: false, error: 'invalid'}
    }
    state = normalized
    visitedItemKeysSet = new Set(state.visitedItemKeys || [])
    saveState(state)
    feedItems.clear()
    feedErrors.clear()
    return {ok: true, foldersCount: state.folders.length}
}

export function shouldAutoMarkReadOnScroll() {
    return Boolean(state.settings?.autoMarkReadOnScroll)
}

export function setAutoMarkReadOnScroll(isEnabled) {
    const nextValue = Boolean(isEnabled)
    const currentValue = Boolean(state.settings?.autoMarkReadOnScroll)
    if (currentValue === nextValue) {
        return
    }
    state.settings = {
        ...DEFAULT_SETTINGS,
        ...(state.settings || {}),
        autoMarkReadOnScroll: nextValue,
    }
    saveState(state)
}

export function isItemVisited(itemKey) {
    const normalizedItemKey = normalizeItemKey(itemKey)
    if (!normalizedItemKey) {
        return false
    }
    return visitedItemKeysSet.has(normalizedItemKey)
}

export function markItemsVisited(itemKeys) {
    const keys = Array.isArray(itemKeys) ? itemKeys : [itemKeys]
    let isChanged = false
    keys.forEach((itemKey) => {
        const normalizedItemKey = normalizeItemKey(itemKey)
        if (!normalizedItemKey || visitedItemKeysSet.has(normalizedItemKey)) {
            return
        }
        visitedItemKeysSet.add(normalizedItemKey)
        isChanged = true
    })
    if (!isChanged) {
        return
    }
    const normalizedVisitedKeys = normalizeVisitedItemKeys(
        Array.from(visitedItemKeysSet),
    )
    visitedItemKeysSet = new Set(normalizedVisitedKeys)
    state.visitedItemKeys = normalizedVisitedKeys
    saveState(state)
}

export function getFeedError(feedId) {
    return feedErrors.get(feedId) || ''
}

export function getFolderItems(folder) {
    const feeds = Array.isArray(folder?.feeds) ? folder.feeds : []
    const items = feeds.flatMap((feed) => feedItems.get(feed.id) || [])
    return items
        .filter((item) => item && String(item.title || '').trim())
        .sort((a, b) => {
            const aTime = getItemTimestamp(a)
            const bTime = getItemTimestamp(b)
            return bTime - aTime
        })
}

export async function refreshAll() {
    const feeds = state.folders.flatMap((folder) => folder.feeds)
    if (!feeds.length) {
        return {hasFeeds: false, errorsCount: 0, errors: []}
    }

    const proxyCheck = await ensureProxyAvailable()
    if (!proxyCheck.ok) {
        const errorMessage = formatFeedError(proxyCheck.error)
        const errors = feeds.map((feed) => {
            feedItems.set(feed.id, [])
            feedErrors.set(feed.id, errorMessage)
            return {
                feedId: feed.id,
                feedName: feed.name,
                message: errorMessage,
            }
        })
        state.lastUpdated = new Date().toISOString()
        saveState(state)
        return {hasFeeds: true, errorsCount: errors.length, errors}
    }

    const results = await Promise.all(
        feeds.map(async (feed) => {
            const result = await loadFeed(feed)
            return result
        }),
    )

    const errorsCount = results.filter((result) => !result.ok).length
    const errors = results
        .filter((result) => !result.ok)
        .map((result) => ({
            feedId: result.feedId,
            feedName: result.feedName,
            message: result.error,
        }))
    state.lastUpdated = new Date().toISOString()
    saveState(state)

    return {hasFeeds: true, errorsCount, errors}
}

async function loadFeed(feed) {
    try {
        const xmlText = await fetchFeedText(feed.url)
        const parsed = parseFeed(xmlText)
        const items = dedupeItems(parsed.items).map((item) => ({
            ...item,
            source: feed.name || parsed.title || item.source,
        }))
        feedItems.set(feed.id, items)
        feedErrors.delete(feed.id)
        return {ok: true, count: items.length}
    } catch (error) {
        const errorMessage = formatFeedError(error)
        feedItems.set(feed.id, [])
        feedErrors.set(feed.id, errorMessage)
        return {
            ok: false,
            count: 0,
            feedId: feed.id,
            feedName: feed.name,
            error: errorMessage,
        }
    }
}

async function fetchFeedText(url) {
    const proxyBases = getProxyBasesByPriority()
    let lastError = null
    for (const proxyBase of proxyBases) {
        const proxyUrl = `${proxyBase}${encodeURIComponent(url)}`
        try {
            const response = await fetchWithTimeout(proxyUrl)
            if (!response.ok) {
                throw createHttpError(response.status)
            }
            activeProxyBase = proxyBase
            return await response.text()
        } catch (error) {
            lastError = error
        }
    }
    throw lastError || new Error('Proxy fetch failed')
}

async function ensureProxyAvailable() {
    const proxyBases = getProxyBasesByPriority()
    let lastError = null
    for (const proxyBase of proxyBases) {
        const testUrl = `${proxyBase}${encodeURIComponent(PROXY_HEALTHCHECK_URL)}`
        try {
            const response = await fetchWithTimeout(testUrl)
            if (response.status >= 500) {
                throw createHttpError(response.status)
            }
            activeProxyBase = proxyBase
            return {ok: true}
        } catch (error) {
            lastError = error
        }
    }
    const error = new Error('Proxy unavailable')
    error.code = 'PROXY_UNAVAILABLE'
    error.cause = lastError
    return {ok: false, error}
}

function getProxyBasesByPriority() {
    return [activeProxyBase, ...CORS_PROXY_BASES].filter(
        (proxyBase, index, list) => list.indexOf(proxyBase) === index,
    )
}

function createHttpError(status) {
    const error = new Error('HTTP error')
    error.code = 'HTTP_ERROR'
    error.status = status
    return error
}

function fetchWithTimeout(url) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
    return fetch(url, {signal: controller.signal}).finally(() => {
        clearTimeout(timeout)
    })
}

function parseFeed(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml')
    const errorNode = doc.querySelector('parsererror')
    if (errorNode) {
        const error = new Error('Invalid XML')
        error.code = 'INVALID_XML'
        throw error
    }
    const feedTitle = decodeHtmlEntities(
        doc.querySelector('channel > title, feed > title')?.textContent || '',
    ).trim()
    const entries = Array.from(
        doc.querySelectorAll('item').length
            ? doc.querySelectorAll('item')
            : doc.querySelectorAll('entry'),
    )

    const items = entries.map((entry) => {
        const title = getText(entry, 'title')
        const link = getLink(entry)
        const dateText =
            getText(entry, 'pubDate') ||
            getText(entry, 'updated') ||
            getText(entry, 'published')
        const date = parseFeedDate(dateText)
        const id =
            getText(entry, 'guid') || getText(entry, 'id') || link || title
        return {
            id,
            title,
            link,
            date,
            source: feedTitle,
        }
    })

    return {title: feedTitle, items}
}

function formatFeedError(error) {
    if (error?.name === 'AbortError') {
        return 'таймаут запроса'
    }
    if (error?.code === 'PROXY_UNAVAILABLE') {
        return 'прокси недоступен (CORS)'
    }
    if (error?.code === 'INVALID_XML') {
        return 'ошибка парсинга XML'
    }
    if (error?.code === 'HTTP_ERROR') {
        return `ошибка загрузки (HTTP ${error.status || 'unknown'})`
    }
    if (error instanceof TypeError) {
        return 'ошибка сети/CORS'
    }
    return 'не удалось обновить фид'
}

function getText(parent, selector) {
    const node = parent.querySelector(selector)
    return node
        ? decodeHtmlEntities(String(node.textContent || '')).trim()
        : ''
}

function getLink(entry) {
    const linkNode =
        entry.querySelector('link[rel="alternate"]') ||
        entry.querySelector('link')
    if (!linkNode) {
        return ''
    }
    const href = linkNode.getAttribute('href')
    return href ? href.trim() : String(linkNode.textContent || '').trim()
}

function dedupeItems(items) {
    const seen = new Set()
    return items.filter((item) => {
        const key = String(item.id || item.link || item.title || '').trim()
        if (!key || seen.has(key)) {
            return false
        }
        seen.add(key)
        return true
    })
}

function normalizeImportedState(rawState) {
    if (!rawState || typeof rawState !== 'object') {
        return null
    }
    const payload =
        rawState && typeof rawState.data === 'object' ? rawState.data : rawState
    return normalizeStatePayload(payload)
}

function parseFeedDate(value) {
    if (!value) {
        return null
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return null
    }
    return date
}

function getItemTimestamp(item) {
    const date = item?.date
    if (!(date instanceof Date)) {
        return 0
    }
    const time = date.getTime()
    if (Number.isNaN(time)) {
        return 0
    }
    return time
}
