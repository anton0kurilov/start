import {
    CORS_PROXY,
    DEFAULT_SETTINGS,
    FETCH_TIMEOUT,
    MODEL_SYNC_INTERVAL_MS,
} from './constants.js'
import {
    appendModelEvent,
    buildModelItemSnapshot,
    hasPendingWeakNegativeTransitions,
    isCalibrationReadyForApproximateDisplay,
    isCalibrationReadyForDisplay,
    predictModelProbability,
    rebuildModelState,
} from './model-state.js'
import {loadState, saveState, clearState} from './storage.js'
import {createId, decodeHtmlEntities, normalizeUrl} from './utils.js'
import * as stateNormalizers from './state-normalizers.js'

let state = loadState()
let visitedItemKeysSet = new Set(state.visitedItemKeys || [])
let clickedItemKeysSet = new Set(state.clickedItemKeys || [])
let dismissedItemKeysSet = new Set()
let impressedItemKeysSet = new Set()
const feedItems = new Map()
const feedErrors = new Map()
const PROXY_HEALTHCHECK_URL = 'https://example.com/'
const USEFULNESS_HIGH_THRESHOLD = 0.58
const USEFULNESS_MEDIUM_THRESHOLD = 0.36
const CLICKED_ITEM_USEFULNESS_SCORE = 0.91
let lastModelSyncCheckAt = 0

refreshModelInteractionIndexes()
synchronizeModelState(true)

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

export function updateFolder({folderId, name}) {
    const folder = state.folders.find((item) => item.id === folderId)
    if (!folder) {
        return {ok: false}
    }

    const nextName = String(name || '').trim()
    if (!nextName) {
        return {ok: false}
    }

    if (folder.name === nextName) {
        return {ok: true}
    }

    folder.name = nextName
    saveState(state)
    return {ok: true}
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

export function updateFeed({folderId, feedId, name, url}) {
    const folder = state.folders.find((item) => item.id === folderId)
    if (!folder) {
        return {ok: false, urlChanged: false}
    }

    const feed = folder.feeds.find((item) => item.id === feedId)
    if (!feed) {
        return {ok: false, urlChanged: false}
    }

    const nextName = String(name || '').trim()
    const nextUrl = normalizeUrl(url)
    if (!nextName || !nextUrl) {
        return {ok: false, urlChanged: false}
    }

    const nameChanged = feed.name !== nextName
    const urlChanged = feed.url !== nextUrl
    if (!nameChanged && !urlChanged) {
        return {ok: true, urlChanged: false}
    }

    feed.name = nextName
    feed.url = nextUrl

    if (urlChanged) {
        feedItems.delete(feedId)
        feedErrors.delete(feedId)
    } else if (nameChanged && feedItems.has(feedId)) {
        feedItems.set(
            feedId,
            (feedItems.get(feedId) || []).map((item) => ({
                ...item,
                source: nextName,
                feedId: feedId,
            })),
        )
    }

    saveState(state)
    return {ok: true, urlChanged}
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
    refreshModelInteractionIndexes()
    synchronizeModelState(true)
}

export function exportState() {
    synchronizeModelStateIfNeeded(true)
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
        clickedItemKeys: [...clickedItemKeysSet],
        visitedItemKeys: [...visitedItemKeysSet],
        dismissedItemKeys: [...dismissedItemKeysSet],
        modelState: state.modelState,
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
    feedItems.clear()
    feedErrors.clear()
    refreshModelInteractionIndexes()
    synchronizeModelState(true)
    saveState(state)
    return {ok: true, foldersCount: state.folders.length}
}

export function shouldAutoMarkReadOnScroll() {
    return Boolean(state.settings?.autoMarkReadOnScroll)
}

export function shouldAutoRefreshFeeds() {
    return Boolean(state.settings?.autoRefreshFeeds)
}

export function shouldShowFavoritesColumn() {
    return Boolean(state.settings?.showFavoritesColumn)
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

export function setAutoRefreshFeeds(isEnabled) {
    const nextValue = Boolean(isEnabled)
    const currentValue = Boolean(state.settings?.autoRefreshFeeds)
    if (currentValue === nextValue) {
        return
    }
    state.settings = {
        ...DEFAULT_SETTINGS,
        ...(state.settings || {}),
        autoRefreshFeeds: nextValue,
    }
    saveState(state)
}

export function setShowFavoritesColumn(isEnabled) {
    const nextValue = Boolean(isEnabled)
    const currentValue = Boolean(state.settings?.showFavoritesColumn)
    if (currentValue === nextValue) {
        return
    }
    state.settings = {
        ...DEFAULT_SETTINGS,
        ...(state.settings || {}),
        showFavoritesColumn: nextValue,
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

export function isItemDismissed(itemKey) {
    const normalizedItemKey = stateNormalizers.normalizeItemKey(itemKey)
    if (!normalizedItemKey) {
        return false
    }
    return dismissedItemKeysSet.has(normalizedItemKey)
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

export function registerFeedItemImpressions(itemsMeta) {
    const items = Array.isArray(itemsMeta) ? itemsMeta : [itemsMeta]
    let addedCount = 0

    items.forEach((itemMeta) => {
        const normalizedItemKey = stateNormalizers.normalizeItemKey(
            itemMeta?.itemKey,
        )
        if (
            !normalizedItemKey ||
            clickedItemKeysSet.has(normalizedItemKey) ||
            dismissedItemKeysSet.has(normalizedItemKey) ||
            impressedItemKeysSet.has(normalizedItemKey)
        ) {
            return
        }

        const didAppend = appendModelEvent(state.modelState, {
            type: 'impression',
            itemKey: normalizedItemKey,
            recordedAt: Date.now(),
            snapshot: buildModelItemSnapshot(itemMeta),
        })
        if (!didAppend) {
            return
        }
        addedCount += 1
        impressedItemKeysSet.add(normalizedItemKey)
    })

    if (!addedCount) {
        return 0
    }

    saveState(state)
    return addedCount
}

export function registerFeedItemClick(itemMeta) {
    const normalizedItemKey = stateNormalizers.normalizeItemKey(
        itemMeta?.itemKey,
    )
    if (
        !normalizedItemKey ||
        clickedItemKeysSet.has(normalizedItemKey) ||
        dismissedItemKeysSet.has(normalizedItemKey)
    ) {
        return false
    }

    clickedItemKeysSet.add(normalizedItemKey)
    const normalizedClickedKeys = stateNormalizers.normalizeClickedItemKeys(
        Array.from(clickedItemKeysSet),
    )
    clickedItemKeysSet = new Set(normalizedClickedKeys)
    state.clickedItemKeys = normalizedClickedKeys

    appendModelEvent(state.modelState, {
        type: 'click',
        itemKey: normalizedItemKey,
        recordedAt: Date.now(),
        snapshot: buildModelItemSnapshot(itemMeta),
    })

    synchronizeModelState(true)
    refreshModelInteractionIndexes()
    saveState(state)
    return true
}

export function registerFeedItemDismiss(itemMeta) {
    const normalizedItemKey = stateNormalizers.normalizeItemKey(
        itemMeta?.itemKey,
    )
    if (!normalizedItemKey || dismissedItemKeysSet.has(normalizedItemKey)) {
        return false
    }

    const didAppend = appendModelEvent(state.modelState, {
        type: 'dismiss',
        itemKey: normalizedItemKey,
        recordedAt: Date.now(),
        snapshot: buildModelItemSnapshot(itemMeta),
    })
    if (!didAppend) {
        return false
    }

    if (clickedItemKeysSet.has(normalizedItemKey)) {
        clickedItemKeysSet.delete(normalizedItemKey)
        const normalizedClickedKeys = stateNormalizers.normalizeClickedItemKeys(
            Array.from(clickedItemKeysSet),
        )
        clickedItemKeysSet = new Set(normalizedClickedKeys)
        state.clickedItemKeys = normalizedClickedKeys
    }

    dismissedItemKeysSet.add(normalizedItemKey)
    synchronizeModelState(true)
    refreshModelInteractionIndexes()
    saveState(state)
    return true
}

export function getFeedItemUsefulness(item) {
    synchronizeModelStateIfNeeded()

    if (isKnownDismissedItem(item)) {
        return createDismissedUsefulness()
    }

    if (isKnownClickedItem(item)) {
        return createClickedUsefulness()
    }

    const latestModelArtifacts = state.modelState?.modelArtifacts
    const publishedModelArtifacts = state.modelState?.publishedModelArtifacts
    const publishedCalibrationArtifacts =
        state.modelState?.publishedCalibrationArtifacts
    const latestTotalSamples = Number(
        latestModelArtifacts?.totalLabeledSamples || 0,
    )
    const hasPublishedCalibration = isCalibrationReadyForDisplay(
        publishedModelArtifacts,
        publishedCalibrationArtifacts,
    )
    const latestCalibrationArtifacts = state.modelState?.calibrationArtifacts
    const canUseApproximateLatestCalibration =
        isCalibrationReadyForApproximateDisplay(
            latestModelArtifacts,
            latestCalibrationArtifacts,
        )

    if (!hasPublishedCalibration && !latestTotalSamples) {
        return createLearningUsefulness(0)
    }

    if (!hasPublishedCalibration && !canUseApproximateLatestCalibration) {
        return createLearningUsefulness(latestTotalSamples)
    }

    const displayModelArtifacts = hasPublishedCalibration
        ? publishedModelArtifacts
        : latestModelArtifacts
    const displayCalibrationArtifacts = hasPublishedCalibration
        ? publishedCalibrationArtifacts
        : latestCalibrationArtifacts
    const prediction = predictModelProbability(
        {
            modelArtifacts: displayModelArtifacts,
            calibrationArtifacts: displayCalibrationArtifacts,
        },
        item,
    )
    if (!Number.isFinite(prediction?.probability)) {
        return createLearningUsefulness(latestTotalSamples)
    }

    const score = clamp(prediction.probability, 0.03, 0.97)
    const displayTotalSamples = Number(
        displayModelArtifacts?.totalLabeledSamples || latestTotalSamples,
    )
    const percentage = Math.round(score * 100)
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
        label: hasPublishedCalibration ? `${percentage}%` : `~${percentage}%`,
        title: hasPublishedCalibration
            ? `Вероятность клика: ${percentage}%. На основе ${displayTotalSamples} размеченных публикаций`
            : `Ориентировочная вероятность клика: ~${percentage}%. Калибровка ещё нестабильна (${displayTotalSamples} размеченных публикаций)`,
    }
}

export function getFeedError(feedId) {
    return feedErrors.get(feedId) || ''
}

export function getFolderItems(folder) {
    synchronizeModelStateIfNeeded()
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
    synchronizeModelStateIfNeeded()

    const feeds = state.folders.flatMap((folder) => folder.feeds)
    if (!feeds.length) {
        return {hasFeeds: false, errorsCount: 0, errors: []}
    }

    const proxyCheck = await ensureProxyAvailable()
    if (!proxyCheck.ok) {
        const errorMessage = formatFeedError(proxyCheck.error)
        const errors = feeds.map((feed) => {
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
            return await loadFeed(feed)
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
            feedId: feed.id,
        }))
        feedItems.set(feed.id, items)
        feedErrors.delete(feed.id)
        return {ok: true, count: items.length}
    } catch (error) {
        const errorMessage = formatFeedError(error)
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

function createLearningUsefulness(totalSamples) {
    const detailsText = totalSamples
        ? `Нужно больше данных для прогноза (сейчас ${totalSamples} размеченных публикаций)`
        : 'Нужны первые взаимодействия, чтобы обучить прогноз полезности'
    return {
        tone: 'learning',
        score: null,
        percentage: null,
        label: 'обучается',
        title: detailsText,
    }
}

function createClickedUsefulness() {
    return {
        tone: 'high',
        score: CLICKED_ITEM_USEFULNESS_SCORE,
        percentage: Math.round(CLICKED_ITEM_USEFULNESS_SCORE * 100),
        label: 'посетил',
        title: 'Вы уже открывали эту публикацию',
    }
}

function createDismissedUsefulness() {
    return {
        tone: 'low',
        score: 0,
        percentage: 0,
        label: 'скрыл',
        title: 'Вы уже скрыли эту публикацию',
    }
}

function isKnownClickedItem(item) {
    const itemKey = resolveFeedItemKey(item)
    if (!itemKey) {
        return false
    }
    return clickedItemKeysSet.has(itemKey)
}

function isKnownDismissedItem(item) {
    const itemKey = resolveFeedItemKey(item)
    if (!itemKey) {
        return false
    }
    return dismissedItemKeysSet.has(itemKey)
}

function resolveFeedItemKey(item) {
    const primaryKey = stateNormalizers.normalizeItemKey(item?.link || item?.id)
    if (primaryKey) {
        return primaryKey
    }
    const publishedAt =
        item?.date instanceof Date && !Number.isNaN(item.date.getTime())
            ? item.date.toISOString()
            : ''
    return stateNormalizers.normalizeItemKey(
        `${item?.source || ''}|${item?.title || ''}|${publishedAt}`,
    )
}

function refreshModelInteractionIndexes() {
    dismissedItemKeysSet = new Set()
    impressedItemKeysSet = new Set()

    const interactionLog = Array.isArray(state.modelState?.interactionLog)
        ? state.modelState.interactionLog
        : []

    interactionLog.forEach((event) => {
        const itemKey = stateNormalizers.normalizeItemKey(event?.itemKey)
        if (!itemKey) {
            return
        }
        if (event.type === 'dismiss') {
            dismissedItemKeysSet.add(itemKey)
        }
        if (event.type === 'impression') {
            impressedItemKeysSet.add(itemKey)
        }
    })
}

function synchronizeModelState(force = false) {
    state.modelState = stateNormalizers.normalizeModelState(state.modelState)
    rebuildModelState(state.modelState, Date.now())
    lastModelSyncCheckAt = Date.now()
    return true
}

function synchronizeModelStateIfNeeded(force = false) {
    const now = Date.now()
    if (!force && now - lastModelSyncCheckAt < MODEL_SYNC_INTERVAL_MS) {
        return false
    }
    if (!force && !hasPendingWeakNegativeTransitions(state.modelState, now)) {
        lastModelSyncCheckAt = now
        return false
    }

    synchronizeModelState(true)
    saveState(state)
    return true
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}
