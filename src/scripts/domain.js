import {
    CLICK_MODEL_V2_DIMENSION,
    CORS_PROXY,
    DEFAULT_SETTINGS,
    FETCH_TIMEOUT,
    MAX_CLICK_MODEL_HOSTS,
    MAX_CLICK_MODEL_SOURCE_HOSTS,
    MAX_CLICK_MODEL_SOURCES,
    MAX_CLICK_MODEL_TOKENS,
    MAX_CLICK_MODEL_V2_FEATURES_PER_ITEM,
    MAX_CLICK_MODEL_V2_NEGATIVE_HISTORY,
    MAX_CLICK_MODEL_V2_PENDING_IMPRESSIONS,
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
const USEFULNESS_HIGH_THRESHOLD = 0.58
const USEFULNESS_MEDIUM_THRESHOLD = 0.36
const CLICK_MODEL_SMOOTHING = 6
const TITLE_TOKENS_LIMIT = 8
const TITLE_TOKENS_FOR_SCORING = 3
const SOURCE_SIGNAL_WEIGHT = 0.14
const HOST_SIGNAL_WEIGHT = 0.1
const TOKEN_SIGNAL_WEIGHT = 0.7
const SOURCE_HOST_SIGNAL_WEIGHT = 0.06
const CLICK_MODEL_TRIM_TRIGGER_MULTIPLIER = 1.15
const SCORE_MIN_PRIOR = 0.09
const SCORE_CONFIDENCE_BONUS = 0.2
const SCORE_EVIDENCE_GAIN = 0.72
const SCORE_EVIDENCE_EXPONENT = 0.38
const TOKEN_SIGNAL_FALLOFF = 0.55
const CLICK_MODEL_V2_NEGATIVE_DELAY_MS = 18 * 60 * 60 * 1000
const CLICK_MODEL_V2_NEGATIVE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const CLICK_MODEL_V2_CONFIDENCE_EVENTS = 110
const CLICK_MODEL_V2_LEARNING_EVENTS = 12
const CLICK_MODEL_V2_BASE_LEARNING_RATE = 0.08
const CLICK_MODEL_V2_REGULARIZATION = 0.002
const CLICK_MODEL_V2_GRADIENT_CLIP = 0.8
const CLICK_MODEL_V2_MAX_ABS_WEIGHT = 6
const CLICK_MODEL_V2_MIN_GRAD_SQUARE = 1e-6
const CLICK_MODEL_V2_POSITIVE_WEIGHT_MAX = 4
const CLICK_MODEL_V2_POSITIVE_WEIGHT_EXPONENT = 0.5
const CLICK_MODEL_V2_PRIOR_ALPHA = 2
const CLICK_MODEL_V2_PRIOR_BETA = 8
const CLICK_MODEL_V2_MIN_EVENTS_FOR_PERCENT = 120
const CLICK_MODEL_V2_MODEL_BLEND_MIN_EVENTS = 32
const CLICK_MODEL_V2_MODEL_BLEND_MAX_EVENTS = 180
const CLICK_MODEL_V2_MODEL_BLEND_MIN = 0.2
const CLICK_MODEL_V2_MODEL_BLEND_MAX = 0.82
const CLICK_MODEL_V2_HEURISTIC_BLEND = 0.22
const CLICKED_ITEM_USEFULNESS_SCORE = 0.91
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

export function shouldUseClickModelV2() {
    return Boolean(state.settings?.useClickModelV2)
}

export function setUseClickModelV2(isEnabled) {
    const nextValue = Boolean(isEnabled)
    const currentValue = Boolean(state.settings?.useClickModelV2)
    if (currentValue === nextValue) {
        return
    }
    state.settings = {
        ...DEFAULT_SETTINGS,
        ...(state.settings || {}),
        useClickModelV2: nextValue,
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

export function registerFeedItemImpressions(itemsMeta) {
    const items = Array.isArray(itemsMeta) ? itemsMeta : [itemsMeta]
    let clickModelV2 = stateNormalizers.normalizeClickModelV2(
        state.clickModelV2,
    )
    const now = Date.now()
    let isChanged = settleExpiredPendingImpressions(clickModelV2, now)
    let addedCount = 0

    items.forEach((itemMeta) => {
        const normalizedItemKey = stateNormalizers.normalizeItemKey(
            itemMeta?.itemKey,
        )
        if (!normalizedItemKey) {
            return
        }
        if (
            clickedItemKeysSet.has(normalizedItemKey) ||
            clickModelV2.pendingImpressions[normalizedItemKey]
        ) {
            return
        }
        if (shouldSkipNegativeLabel(clickModelV2, normalizedItemKey, now)) {
            return
        }
        clickModelV2.pendingImpressions[normalizedItemKey] = {
            createdAt: now,
            features: buildClickModelV2FeatureVector(itemMeta),
        }
        addedCount += 1
        isChanged = true
    })

    if (trimPendingImpressions(clickModelV2)) {
        isChanged = true
    }

    if (!isChanged) {
        return addedCount
    }

    state.clickModelV2 = clickModelV2
    saveState(state)
    return addedCount
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
    state.clickModelV2 = applyClickToModelV2(
        state.clickModelV2,
        normalizedItemKey,
        itemMeta,
    )
    saveState(state)
    return true
}

export function getFeedItemUsefulness(item) {
    if (isKnownClickedItem(item)) {
        return createClickedUsefulness()
    }
    if (shouldUseClickModelV2()) {
        return getFeedItemUsefulnessV2(item)
    }
    return getFeedItemUsefulnessV1(item)
}

function getFeedItemUsefulnessV1(item) {
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
    const baselineSignal = getBaselineSignal(totalClicks)
    const normalizedEvidence = normalizeSignalDelta(
        behaviorScore,
        baselineSignal,
    )
    const amplifiedEvidence = Math.pow(
        normalizedEvidence,
        SCORE_EVIDENCE_EXPONENT,
    )
    const priorScore = SCORE_MIN_PRIOR + confidence * SCORE_CONFIDENCE_BONUS
    const rawScore = priorScore + amplifiedEvidence * SCORE_EVIDENCE_GAIN
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

function getFeedItemUsefulnessV2(item) {
    const clickModelV2 = stateNormalizers.normalizeClickModelV2(
        state.clickModelV2,
    )
    const totalEvents = clickModelV2.totalEvents
    if (!totalEvents) {
        return createLearningUsefulness(0, null, 'events')
    }

    const featureVector = buildClickModelV2FeatureVector(item)
    const modelScore = predictClickModelV2(clickModelV2, featureVector)
    const priorScore =
        (clickModelV2.positiveEvents + CLICK_MODEL_V2_PRIOR_ALPHA) /
        (clickModelV2.positiveEvents +
            clickModelV2.negativeEvents +
            CLICK_MODEL_V2_PRIOR_ALPHA +
            CLICK_MODEL_V2_PRIOR_BETA)
    const confidence = Math.min(
        1,
        totalEvents / CLICK_MODEL_V2_CONFIDENCE_EVENTS,
    )
    const blendProgress = normalizeRange(
        totalEvents,
        CLICK_MODEL_V2_MODEL_BLEND_MIN_EVENTS,
        CLICK_MODEL_V2_MODEL_BLEND_MAX_EVENTS,
    )
    const modelBlend =
        CLICK_MODEL_V2_MODEL_BLEND_MIN +
        blendProgress *
            (CLICK_MODEL_V2_MODEL_BLEND_MAX - CLICK_MODEL_V2_MODEL_BLEND_MIN)
    const effectiveModelBlend = modelBlend * confidence
    const effectiveScore =
        priorScore * (1 - effectiveModelBlend) +
        modelScore * effectiveModelBlend
    const v1Usefulness = getFeedItemUsefulnessV1(item)
    const heuristicScore = Number(v1Usefulness?.score)
    const blendedScore = Number.isFinite(heuristicScore)
        ? effectiveScore * (1 - CLICK_MODEL_V2_HEURISTIC_BLEND) +
          heuristicScore * CLICK_MODEL_V2_HEURISTIC_BLEND
        : effectiveScore
    const score = clamp(blendedScore, 0.06, 0.97)
    const percentage = Math.round(score * 100)

    if (
        totalEvents < CLICK_MODEL_V2_LEARNING_EVENTS ||
        totalEvents < CLICK_MODEL_V2_MIN_EVENTS_FOR_PERCENT
    ) {
        return createLearningUsefulness(totalEvents, null, 'events')
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
        title: `Вероятность клика (V2) на основе ${totalEvents} размеченных показов`,
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

function applyClickToModelV2(rawClickModelV2, itemKey, itemMeta) {
    const clickModelV2 = stateNormalizers.normalizeClickModelV2(rawClickModelV2)
    const now = Date.now()
    settleExpiredPendingImpressions(clickModelV2, now)
    const pendingImpression = clickModelV2.pendingImpressions[itemKey]
    let featureVector = []
    if (pendingImpression) {
        featureVector = normalizeClickModelV2FeatureVector(
            pendingImpression.features,
        )
        delete clickModelV2.pendingImpressions[itemKey]
    } else {
        featureVector = buildClickModelV2FeatureVector(itemMeta)
    }
    delete clickModelV2.negativeHistory[itemKey]
    trainClickModelV2Sample(clickModelV2, featureVector, 1)
    trimPendingImpressions(clickModelV2)
    return clickModelV2
}

function settleExpiredPendingImpressions(clickModelV2, now = Date.now()) {
    const pendingImpressions = clickModelV2?.pendingImpressions
    if (!pendingImpressions || typeof pendingImpressions !== 'object') {
        return false
    }
    let isChanged = false
    Object.entries(pendingImpressions).forEach(([itemKey, impression]) => {
        const createdAt = Number(impression?.createdAt)
        if (
            !Number.isFinite(createdAt) ||
            createdAt <= 0 ||
            now - createdAt < CLICK_MODEL_V2_NEGATIVE_DELAY_MS
        ) {
            return
        }
        trainNegativeImpression(
            clickModelV2,
            itemKey,
            normalizeClickModelV2FeatureVector(impression?.features),
            now,
        )
        delete pendingImpressions[itemKey]
        isChanged = true
    })
    return isChanged
}

function trimPendingImpressions(clickModelV2) {
    const pendingImpressions = clickModelV2?.pendingImpressions
    if (!pendingImpressions || typeof pendingImpressions !== 'object') {
        return false
    }
    const pendingEntries = Object.entries(pendingImpressions)
    if (pendingEntries.length <= MAX_CLICK_MODEL_V2_PENDING_IMPRESSIONS) {
        return false
    }
    pendingEntries.sort((left, right) => {
        return (
            Number(left[1]?.createdAt || 0) - Number(right[1]?.createdAt || 0)
        )
    })
    let isChanged = false
    while (pendingEntries.length > MAX_CLICK_MODEL_V2_PENDING_IMPRESSIONS) {
        const [itemKey] = pendingEntries.shift()
        delete pendingImpressions[itemKey]
        isChanged = true
    }
    return isChanged
}

function trainNegativeImpression(
    clickModelV2,
    itemKey,
    featureVector,
    now = Date.now(),
) {
    const normalizedItemKey = stateNormalizers.normalizeItemKey(itemKey)
    if (
        !normalizedItemKey ||
        shouldSkipNegativeLabel(clickModelV2, normalizedItemKey, now)
    ) {
        return false
    }
    trainClickModelV2Sample(clickModelV2, featureVector, 0)
    markNegativeHistory(clickModelV2, normalizedItemKey, now)
    return true
}

function shouldSkipNegativeLabel(clickModelV2, itemKey, now = Date.now()) {
    const normalizedItemKey = stateNormalizers.normalizeItemKey(itemKey)
    if (!normalizedItemKey) {
        return true
    }
    const lastNegativeAt = Number(
        clickModelV2?.negativeHistory?.[normalizedItemKey] || 0,
    )
    if (!Number.isFinite(lastNegativeAt) || lastNegativeAt <= 0) {
        return false
    }
    return now - lastNegativeAt < CLICK_MODEL_V2_NEGATIVE_COOLDOWN_MS
}

function markNegativeHistory(clickModelV2, itemKey, now = Date.now()) {
    const normalizedItemKey = stateNormalizers.normalizeItemKey(itemKey)
    if (!normalizedItemKey || !clickModelV2?.negativeHistory) {
        return
    }
    clickModelV2.negativeHistory[normalizedItemKey] = Math.max(
        0,
        Math.round(now),
    )
    trimNegativeHistory(clickModelV2)
}

function trimNegativeHistory(clickModelV2) {
    const negativeHistory = clickModelV2?.negativeHistory
    if (!negativeHistory || typeof negativeHistory !== 'object') {
        return
    }
    const historyEntries = Object.entries(negativeHistory)
    if (historyEntries.length <= MAX_CLICK_MODEL_V2_NEGATIVE_HISTORY) {
        return
    }
    historyEntries.sort((left, right) => {
        return Number(right[1] || 0) - Number(left[1] || 0)
    })
    clickModelV2.negativeHistory = Object.fromEntries(
        historyEntries.slice(0, MAX_CLICK_MODEL_V2_NEGATIVE_HISTORY),
    )
}

function predictClickModelV2(clickModelV2, featureVector) {
    const normalizedFeatures = normalizeClickModelV2FeatureVector(featureVector)
    let linearScore = Number(clickModelV2?.bias || 0)
    normalizedFeatures.forEach(([index, value]) => {
        const weight = Number(clickModelV2?.weights?.[index] || 0)
        if (!weight) {
            return
        }
        linearScore += weight * value
    })
    const clampedScore = clamp(linearScore, -8, 8)
    return 1 / (1 + Math.exp(-clampedScore))
}

function trainClickModelV2Sample(clickModelV2, featureVector, label) {
    const normalizedFeatures = normalizeClickModelV2FeatureVector(featureVector)
    const normalizedLabel = Number(label) >= 0.5 ? 1 : 0
    const prediction = predictClickModelV2(clickModelV2, normalizedFeatures)
    const sampleWeight = resolveClickModelV2SampleWeight(
        clickModelV2,
        normalizedLabel,
    )
    let error = (prediction - normalizedLabel) * sampleWeight
    error = clamp(
        error,
        -CLICK_MODEL_V2_GRADIENT_CLIP,
        CLICK_MODEL_V2_GRADIENT_CLIP,
    )

    const bias = Number(clickModelV2.bias || 0)
    const biasGradient = error + CLICK_MODEL_V2_REGULARIZATION * bias
    clickModelV2.bias = clamp(
        bias - CLICK_MODEL_V2_BASE_LEARNING_RATE * biasGradient,
        -CLICK_MODEL_V2_MAX_ABS_WEIGHT,
        CLICK_MODEL_V2_MAX_ABS_WEIGHT,
    )

    normalizedFeatures.forEach(([index, value]) => {
        const featureKey = String(index)
        const currentWeight = Number(clickModelV2.weights?.[featureKey] || 0)
        const gradient =
            error * value + CLICK_MODEL_V2_REGULARIZATION * currentWeight
        const previousGradSquare = Number(
            clickModelV2.gradSquares?.[featureKey] || 0,
        )
        const nextGradSquare = Math.max(
            CLICK_MODEL_V2_MIN_GRAD_SQUARE,
            previousGradSquare + gradient * gradient,
        )
        clickModelV2.gradSquares[featureKey] = nextGradSquare
        const effectiveRate =
            CLICK_MODEL_V2_BASE_LEARNING_RATE / Math.sqrt(nextGradSquare)
        const nextWeight = clamp(
            currentWeight - effectiveRate * gradient,
            -CLICK_MODEL_V2_MAX_ABS_WEIGHT,
            CLICK_MODEL_V2_MAX_ABS_WEIGHT,
        )
        if (Math.abs(nextWeight) < 0.00005) {
            delete clickModelV2.weights[featureKey]
            return
        }
        clickModelV2.weights[featureKey] = nextWeight
    })

    if (normalizedLabel) {
        clickModelV2.positiveEvents += 1
    } else {
        clickModelV2.negativeEvents += 1
    }
    clickModelV2.totalEvents += 1
}

function resolveClickModelV2SampleWeight(clickModelV2, normalizedLabel) {
    if (!normalizedLabel) {
        return 1
    }
    const positiveEvents = Math.max(
        1,
        Number(clickModelV2?.positiveEvents || 0),
    )
    const negativeEvents = Math.max(
        1,
        Number(clickModelV2?.negativeEvents || 0),
    )
    const imbalanceRatio = negativeEvents / positiveEvents
    const adjustedWeight = Math.pow(
        imbalanceRatio,
        CLICK_MODEL_V2_POSITIVE_WEIGHT_EXPONENT,
    )
    return clamp(adjustedWeight, 1, CLICK_MODEL_V2_POSITIVE_WEIGHT_MAX)
}

function buildClickModelV2FeatureVector(itemMeta) {
    const sourceKey = normalizeSourceKey(itemMeta?.source)
    const hostKey = normalizeHostKey(itemMeta?.link)
    const sourceHostKey = buildSourceHostKey(sourceKey, hostKey)
    const titleTokens = extractTitleTokens(itemMeta?.title)
    const features = []
    pushHashedClickModelV2Feature(features, `source:${sourceKey}`, 0.8)
    pushHashedClickModelV2Feature(features, `host:${hostKey}`, 0.7)
    pushHashedClickModelV2Feature(features, `sourceHost:${sourceHostKey}`, 0.65)
    let tokenWeight = 1
    titleTokens.forEach((token) => {
        pushHashedClickModelV2Feature(features, `token:${token}`, tokenWeight)
        tokenWeight *= 0.82
    })
    return normalizeClickModelV2FeatureVector(features)
}

function pushHashedClickModelV2Feature(featureVector, featureKey, value = 1) {
    const normalizedKey = String(featureKey || '').trim()
    const normalizedValue = Number(value)
    if (
        !normalizedKey ||
        !Number.isFinite(normalizedValue) ||
        normalizedValue <= 0
    ) {
        return
    }
    const hashedIndex = hashClickModelV2FeatureKey(normalizedKey)
    featureVector.push([hashedIndex, normalizedValue])
}

function hashClickModelV2FeatureKey(featureKey) {
    let hash = 2166136261
    for (let index = 0; index < featureKey.length; index += 1) {
        hash ^= featureKey.charCodeAt(index)
        hash +=
            (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }
    return (hash >>> 0) % CLICK_MODEL_V2_DIMENSION
}

function normalizeClickModelV2FeatureVector(featureVector) {
    if (!Array.isArray(featureVector)) {
        return []
    }
    const aggregate = {}
    featureVector.forEach((feature) => {
        if (!Array.isArray(feature)) {
            return
        }
        const index = Number(feature[0])
        const value = Number(feature[1])
        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= CLICK_MODEL_V2_DIMENSION ||
            !Number.isFinite(value) ||
            value <= 0
        ) {
            return
        }
        const featureKey = String(index)
        aggregate[featureKey] = (aggregate[featureKey] || 0) + value
    })
    const sortedEntries = Object.entries(aggregate).sort((left, right) => {
        return right[1] - left[1]
    })
    return sortedEntries
        .slice(0, MAX_CLICK_MODEL_V2_FEATURES_PER_ITEM)
        .map(([index, value]) => [Number(index), value])
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
    const trimThreshold = Math.ceil(limit * CLICK_MODEL_TRIM_TRIGGER_MULTIPLIER)
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
    let weightedTotal = 0
    let totalWeight = 0
    let weight = 1
    tokenSignals.forEach((signal) => {
        weightedTotal += signal * weight
        totalWeight += weight
        weight *= TOKEN_SIGNAL_FALLOFF
    })
    if (!totalWeight) {
        return 0
    }
    return weightedTotal / totalWeight
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

function normalizeSignalDelta(signalValue, baselineValue) {
    const signal = Number(signalValue)
    const baseline = Number(baselineValue)
    if (!Number.isFinite(signal) || !Number.isFinite(baseline)) {
        return 0
    }
    const clampedBaseline = clamp(baseline, 0, 0.98)
    const clampedSignal = clamp(signal, clampedBaseline, 1)
    const range = 1 - clampedBaseline
    if (!range) {
        return 0
    }
    return (clampedSignal - clampedBaseline) / range
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

function createLearningUsefulness(
    totalSamples,
    percentage = null,
    mode = 'clicks',
) {
    const sampleLabel = mode === 'events' ? 'показов' : 'кликов'
    const detailsText = totalSamples
        ? `Нужно больше данных для точного прогноза (сейчас: ${totalSamples} ${sampleLabel})`
        : 'Нужны первые взаимодействия, чтобы обучить прогноз полезности'
    return {
        tone: 'learning',
        score: null,
        percentage,
        label: percentage ? `обуч. ${percentage}%` : 'обучается',
        title: detailsText,
    }
}

function createClickedUsefulness() {
    return {
        tone: 'high',
        score: CLICKED_ITEM_USEFULNESS_SCORE,
        percentage: Math.round(CLICKED_ITEM_USEFULNESS_SCORE * 100),
        label: '100%',
        title: 'Вы уже открывали эту новость',
    }
}

function isKnownClickedItem(item) {
    const itemKey = resolveFeedItemKey(item)
    if (!itemKey) {
        return false
    }
    return clickedItemKeysSet.has(itemKey)
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

function normalizeRange(value, min, max) {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
        return 0
    }
    if (max <= min) {
        return numericValue >= max ? 1 : 0
    }
    return clamp((numericValue - min) / (max - min), 0, 1)
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}
