import {
    CORS_PROXY,
    DEFAULT_SETTINGS,
    FETCH_TIMEOUT,
    MAX_CLICK_MODEL_HOSTS,
    MAX_CLICK_MODEL_SOURCE_HOSTS,
    MAX_CLICK_MODEL_SOURCES,
    MAX_CLICK_MODEL_TOKENS,
} from './constants.js'
import {loadState, saveState, clearState} from './storage.js'
import {
    createId,
    decodeHtmlEntities,
    getHostname,
    normalizeUrl,
} from './utils.js'
import * as stateNormalizers from './state-normalizers.js'

let state = loadState()
let visitedItemKeysSet = new Set(state.visitedItemKeys || [])
let clickedItemKeysSet = new Set(state.clickedItemKeys || [])
const feedItems = new Map()
const feedErrors = new Map()
const PROXY_HEALTHCHECK_URL = 'https://example.com/'
const USEFULNESS_CONFIDENCE_CLICKS = 24
const USEFULNESS_LEARNING_CLICKS = 3
const USEFULNESS_HIGH_THRESHOLD = 0.66
const USEFULNESS_MEDIUM_THRESHOLD = 0.42
const CLICK_MODEL_SMOOTHING = 6
const TITLE_TOKENS_LIMIT = 8
const TITLE_TOKENS_FOR_SCORING = 4
const SOURCE_SIGNAL_WEIGHT = 0.14
const HOST_SIGNAL_WEIGHT = 0.1
const TOKEN_SIGNAL_WEIGHT = 0.7
const SOURCE_HOST_SIGNAL_WEIGHT = 0.06
const CONFIDENCE_SIGNAL_WEIGHT = 0.1
const BEHAVIOR_SIGNAL_WEIGHT = 1 - CONFIDENCE_SIGNAL_WEIGHT
const CLICK_MODEL_TRIM_TRIGGER_MULTIPLIER = 1.15
const TITLE_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'be',
    'for',
    'from',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'that',
    'the',
    'to',
    'with',
    'без',
    'в',
    'во',
    'для',
    'и',
    'из',
    'к',
    'как',
    'на',
    'о',
    'об',
    'по',
    'под',
    'при',
    'с',
    'со',
    'что',
    'это',
])

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
    clickedItemKeysSet = new Set(state.clickedItemKeys || [])
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
    clickedItemKeysSet = new Set(state.clickedItemKeys || [])
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
    const normalizedItemKey = stateNormalizers.normalizeItemKey(itemKey)
    if (!normalizedItemKey) {
        return false
    }
    return visitedItemKeysSet.has(normalizedItemKey)
}

export function markItemsVisited(itemKeys) {
    const keys = Array.isArray(itemKeys) ? itemKeys : [itemKeys]
    let isChanged = false
    keys.forEach((itemKey) => {
        const normalizedItemKey = stateNormalizers.normalizeItemKey(itemKey)
        if (!normalizedItemKey || visitedItemKeysSet.has(normalizedItemKey)) {
            return
        }
        visitedItemKeysSet.add(normalizedItemKey)
        isChanged = true
    })
    if (!isChanged) {
        return
    }
    const normalizedVisitedKeys = stateNormalizers.normalizeVisitedItemKeys(
        Array.from(visitedItemKeysSet),
    )
    visitedItemKeysSet = new Set(normalizedVisitedKeys)
    state.visitedItemKeys = normalizedVisitedKeys
    saveState(state)
}

export function unmarkItemsVisited(itemKeys) {
    const keys = Array.isArray(itemKeys) ? itemKeys : [itemKeys]
    let isChanged = false
    keys.forEach((itemKey) => {
        const normalizedItemKey = stateNormalizers.normalizeItemKey(itemKey)
        if (!normalizedItemKey || !visitedItemKeysSet.has(normalizedItemKey)) {
            return
        }
        visitedItemKeysSet.delete(normalizedItemKey)
        isChanged = true
    })
    if (!isChanged) {
        return
    }
    const normalizedVisitedKeys = stateNormalizers.normalizeVisitedItemKeys(
        Array.from(visitedItemKeysSet),
    )
    visitedItemKeysSet = new Set(normalizedVisitedKeys)
    state.visitedItemKeys = normalizedVisitedKeys
    saveState(state)
}

export function registerFeedItemClick(itemMeta) {
    const normalizedItemKey = stateNormalizers.normalizeItemKey(
        itemMeta?.itemKey,
    )
    if (!normalizedItemKey || clickedItemKeysSet.has(normalizedItemKey)) {
        return false
    }
    clickedItemKeysSet.add(normalizedItemKey)
    const normalizedClickedKeys = stateNormalizers.normalizeClickedItemKeys(
        Array.from(clickedItemKeysSet),
    )
    clickedItemKeysSet = new Set(normalizedClickedKeys)
    state.clickedItemKeys = normalizedClickedKeys
    state.clickModel = applyClickToModel(state.clickModel, itemMeta)
    saveState(state)
    return true
}

export function getFeedItemUsefulness(item) {
    const clickModel = stateNormalizers.normalizeClickModel(state.clickModel)
    const totalClicks = clickModel.totalClicks

    if (!totalClicks) {
        return createLearningUsefulness(0)
    }

    const sourceKey = normalizeSourceKey(item?.source)
    const hostKey = normalizeHostKey(item?.link)
    const titleTokens = extractTitleTokens(item?.title)
    const sourceHostKey = buildSourceHostKey(sourceKey, hostKey)

    const sourceSignal = getCounterSignal(
        clickModel.sourceCounts,
        sourceKey,
        totalClicks,
    )
    const hostSignal = getCounterSignal(
        clickModel.hostCounts,
        hostKey,
        totalClicks,
    )
    const tokenSignal = getTokensSignal(
        clickModel.tokenCounts,
        titleTokens,
        totalClicks,
    )
    const sourceHostSignal = getCounterSignal(
        clickModel.sourceHostCounts,
        sourceHostKey,
        totalClicks,
    )

    const confidence = Math.min(1, totalClicks / USEFULNESS_CONFIDENCE_CLICKS)
    const behaviorScore = getWeightedSignalAverage(
        [
            {
                isAvailable: Boolean(sourceKey),
                value: sourceSignal,
                weight: SOURCE_SIGNAL_WEIGHT,
            },
            {
                isAvailable: Boolean(hostKey),
                value: hostSignal,
                weight: HOST_SIGNAL_WEIGHT,
            },
            {
                isAvailable: titleTokens.length > 0,
                value: tokenSignal,
                weight: TOKEN_SIGNAL_WEIGHT,
            },
            {
                isAvailable: Boolean(sourceHostKey),
                value: sourceHostSignal,
                weight: SOURCE_HOST_SIGNAL_WEIGHT,
            },
        ],
        getBaselineSignal(totalClicks),
    )
    const rawScore =
        behaviorScore * BEHAVIOR_SIGNAL_WEIGHT +
        confidence * CONFIDENCE_SIGNAL_WEIGHT
    const score = clamp(rawScore, 0.06, 0.97)
    const percentage = Math.round(score * 100)

    if (totalClicks < USEFULNESS_LEARNING_CLICKS) {
        return createLearningUsefulness(totalClicks, percentage)
    }

    let tone = 'low'
    if (score >= USEFULNESS_HIGH_THRESHOLD) {
        tone = 'high'
    } else if (score >= USEFULNESS_MEDIUM_THRESHOLD) {
        tone = 'medium'
    }

    return {
        tone,
        score,
        percentage,
        label: `${percentage}%`,
        title: `Вероятность клика на основе ${totalClicks} предыдущих взаимодействий`,
    }
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
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(url)}`
    const response = await fetchWithTimeout(proxyUrl)
    if (!response.ok) {
        throw createHttpError(response.status)
    }
    return await response.text()
}

async function ensureProxyAvailable() {
    const testUrl = `${CORS_PROXY}${encodeURIComponent(PROXY_HEALTHCHECK_URL)}`
    try {
        const response = await fetchWithTimeout(testUrl)
        if (response.status >= 500) {
            throw createHttpError(response.status)
        }
        return {ok: true}
    } catch (error) {
        const proxyError = new Error('Proxy unavailable')
        proxyError.code = 'PROXY_UNAVAILABLE'
        proxyError.cause = error
        return {ok: false, error: proxyError}
    }
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
    return node ? decodeHtmlEntities(String(node.textContent || '')).trim() : ''
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
    return stateNormalizers.normalizeStatePayload(payload)
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

function applyClickToModel(rawClickModel, itemMeta) {
    const clickModel = stateNormalizers.normalizeClickModel(rawClickModel)
    const sourceCounts = {
        ...clickModel.sourceCounts,
    }
    const sourceHostCounts = {
        ...clickModel.sourceHostCounts,
    }
    const hostCounts = {
        ...clickModel.hostCounts,
    }
    const tokenCounts = {
        ...clickModel.tokenCounts,
    }

    const sourceKey = normalizeSourceKey(itemMeta?.source)
    const hostKey = normalizeHostKey(itemMeta?.link)
    incrementCounter(sourceCounts, sourceKey)
    incrementCounter(sourceHostCounts, buildSourceHostKey(sourceKey, hostKey))
    incrementCounter(hostCounts, hostKey)
    extractTitleTokens(itemMeta?.title).forEach((token) => {
        incrementCounter(tokenCounts, token)
    })

    return {
        totalClicks: clickModel.totalClicks + 1,
        sourceCounts: trimCounterMap(sourceCounts, MAX_CLICK_MODEL_SOURCES),
        sourceHostCounts: trimCounterMap(
            sourceHostCounts,
            MAX_CLICK_MODEL_SOURCE_HOSTS,
        ),
        hostCounts: trimCounterMap(hostCounts, MAX_CLICK_MODEL_HOSTS),
        tokenCounts: trimCounterMap(tokenCounts, MAX_CLICK_MODEL_TOKENS),
    }
}

function incrementCounter(counterMap, key) {
    if (!counterMap || typeof counterMap !== 'object') {
        return
    }
    const normalizedKey = String(key || '').trim()
    if (!normalizedKey) {
        return
    }
    counterMap[normalizedKey] = (counterMap[normalizedKey] || 0) + 1
}

function trimCounterMap(counterMap, limit) {
    if (!counterMap || typeof counterMap !== 'object') {
        return {}
    }
    if (!Number.isInteger(limit) || limit <= 0) {
        return {}
    }
    const normalizedEntries = Object.entries(counterMap)
        .map(([key, value]) => [String(key || '').trim(), Number(value) || 0])
        .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
    if (normalizedEntries.length <= limit) {
        return Object.fromEntries(normalizedEntries)
    }
    const trimThreshold = Math.ceil(
        limit * CLICK_MODEL_TRIM_TRIGGER_MULTIPLIER,
    )
    if (normalizedEntries.length <= trimThreshold) {
        return Object.fromEntries(normalizedEntries)
    }
    normalizedEntries.sort((left, right) => right[1] - left[1])
    return Object.fromEntries(normalizedEntries.slice(0, limit))
}

function getCounterSignal(counterMap, key, totalClicks) {
    if (!key || !totalClicks) {
        return 0
    }
    const rawCount = Number(counterMap?.[key] || 0)
    const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : 0
    return (count + 1) / (totalClicks + CLICK_MODEL_SMOOTHING)
}

function getTokensSignal(counterMap, tokens, totalClicks) {
    if (!Array.isArray(tokens) || !tokens.length) {
        return 0
    }
    const tokenSignals = tokens
        .map((token) => getCounterSignal(counterMap, token, totalClicks))
        .sort((left, right) => right - left)
        .slice(0, TITLE_TOKENS_FOR_SCORING)
    if (!tokenSignals.length) {
        return 0
    }
    const total = tokenSignals.reduce((sum, value) => sum + value, 0)
    return total / tokenSignals.length
}

function buildSourceHostKey(sourceKey, hostKey) {
    const normalizedSource = String(sourceKey || '').trim()
    const normalizedHost = String(hostKey || '').trim()
    if (!normalizedSource || !normalizedHost) {
        return ''
    }
    return `${normalizedSource}||${normalizedHost}`
}

function getBaselineSignal(totalClicks) {
    if (!totalClicks) {
        return 0
    }
    return 1 / (totalClicks + CLICK_MODEL_SMOOTHING)
}

function getWeightedSignalAverage(components, fallbackValue = 0) {
    if (!Array.isArray(components) || !components.length) {
        return fallbackValue
    }
    let weightedTotal = 0
    let totalWeight = 0
    components.forEach((component) => {
        const weight = Number(component.weight)
        if (!Number.isFinite(weight) || weight <= 0) {
            return
        }
        const rawValue = component?.isAvailable
            ? Number(component.value)
            : fallbackValue
        const value = Number.isFinite(rawValue) ? rawValue : fallbackValue
        weightedTotal += value * weight
        totalWeight += weight
    })
    if (!totalWeight) {
        return fallbackValue
    }
    return weightedTotal / totalWeight
}

function normalizeSourceKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
}

function normalizeHostKey(url) {
    const host = getHostname(String(url || ''))
    return String(host || '')
        .trim()
        .toLowerCase()
}

function extractTitleTokens(value) {
    const text = String(value || '')
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    if (!text.trim()) {
        return []
    }
    const seen = new Set()
    const tokens = []
    text.split(/\s+/).forEach((token) => {
        const nextToken = token.trim()
        if (
            nextToken.length < 3 ||
            TITLE_STOP_WORDS.has(nextToken) ||
            seen.has(nextToken)
        ) {
            return
        }
        seen.add(nextToken)
        tokens.push(nextToken)
    })
    return tokens.slice(0, TITLE_TOKENS_LIMIT)
}

function createLearningUsefulness(totalClicks, percentage = null) {
    const detailsText = totalClicks
        ? `Нужно больше кликов для точного прогноза (сейчас: ${totalClicks})`
        : 'Нужны первые клики, чтобы обучить прогноз полезности'
    return {
        tone: 'learning',
        score: null,
        percentage,
        label: percentage ? `обуч. ${percentage}%` : 'обучается',
        title: detailsText,
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}
