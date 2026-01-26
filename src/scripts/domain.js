import {CORS_PROXY, FETCH_TIMEOUT} from './constants.js'
import {loadState, saveState, clearState} from './storage.js'
import {createId, normalizeUrl} from './utils.js'

let state = loadState()
const feedItems = new Map()

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
    saveState(state)
}

export function resetState() {
    clearState()
    state = loadState()
    feedItems.clear()
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
    }
}

export function importState(rawState) {
    const normalized = normalizeImportedState(rawState)
    if (!normalized) {
        return {ok: false, error: 'invalid'}
    }
    state = normalized
    saveState(state)
    feedItems.clear()
    return {ok: true, foldersCount: state.folders.length}
}

export function getFolderItems(folder) {
    const items = folder.feeds.flatMap((feed) => feedItems.get(feed.id) || [])
    return items
        .filter((item) => item && item.title)
        .sort((a, b) => {
            const aTime = a.date ? a.date.getTime() : 0
            const bTime = b.date ? b.date.getTime() : 0
            return bTime - aTime
        })
}

export async function refreshAll() {
    const feeds = state.folders.flatMap((folder) => folder.feeds)
    if (!feeds.length) {
        return {hasFeeds: false, errorsCount: 0}
    }

    const results = await Promise.all(
        feeds.map(async (feed) => {
            const result = await loadFeed(feed)
            return result
        }),
    )

    const errorsCount = results.filter((result) => !result.ok).length
    state.lastUpdated = new Date().toISOString()
    saveState(state)

    return {hasFeeds: true, errorsCount}
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
        return {ok: true, count: items.length}
    } catch (error) {
        feedItems.set(feed.id, [])
        return {ok: false, count: 0}
    }
}

async function fetchFeedText(url) {
    const proxyUrl = `${CORS_PROXY}${encodeURIComponent(url)}`
    const response = await fetchWithTimeout(proxyUrl)
    if (!response.ok) {
        throw new Error('Proxy fetch failed')
    }
    return await response.text()
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
        throw new Error('Invalid XML')
    }
    const feedTitle =
        doc
            .querySelector('channel > title, feed > title')
            ?.textContent?.trim() || ''
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
        const date = dateText ? new Date(dateText) : null
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

function getText(parent, selector) {
    const node = parent.querySelector(selector)
    return node ? String(node.textContent || '').trim() : ''
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
        const key = item.id || item.link || item.title
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
    const folders = Array.isArray(payload.folders) ? payload.folders : []
    const normalizedFolders = folders
        .map((folder) => normalizeImportedFolder(folder))
        .filter(Boolean)
    const lastUpdated = normalizeImportedDate(payload.lastUpdated)
    return {
        folders: normalizedFolders,
        lastUpdated,
    }
}

function normalizeImportedFolder(folder) {
    if (!folder || typeof folder !== 'object') {
        return null
    }
    const name = normalizeImportedText(folder.name)
    if (!name) {
        return null
    }
    const feeds = Array.isArray(folder.feeds) ? folder.feeds : []
    const normalizedFeeds = feeds
        .map((feed) => normalizeImportedFeed(feed))
        .filter(Boolean)
    return {
        id: normalizeImportedText(folder.id) || createId(),
        name,
        feeds: normalizedFeeds,
    }
}

function normalizeImportedFeed(feed) {
    if (!feed || typeof feed !== 'object') {
        return null
    }
    const name = normalizeImportedText(feed.name)
    const url = normalizeUrl(normalizeImportedText(feed.url))
    if (!name || !url) {
        return null
    }
    return {
        id: normalizeImportedText(feed.id) || createId(),
        name,
        url,
    }
}

function normalizeImportedText(value) {
    if (typeof value !== 'string') {
        return ''
    }
    return value.trim()
}

function normalizeImportedDate(value) {
    if (!value) {
        return null
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return null
    }
    return date.toISOString()
}
