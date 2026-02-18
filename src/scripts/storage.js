import {DEFAULT_SETTINGS, STORAGE_KEY} from './constants.js'

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return createFallbackState()
        }
        const parsed = JSON.parse(raw)
        return normalizeState(parsed)
    } catch (error) {
        return createFallbackState()
    }
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearState() {
    localStorage.removeItem(STORAGE_KEY)
}

function createFallbackState() {
    return {
        folders: [],
        lastUpdated: null,
        settings: {
            ...DEFAULT_SETTINGS,
        },
        visitedItemKeys: [],
    }
}

function normalizeState(rawState) {
    if (!rawState || typeof rawState !== 'object') {
        return createFallbackState()
    }

    return {
        folders: Array.isArray(rawState.folders) ? rawState.folders : [],
        lastUpdated: normalizeDate(rawState.lastUpdated),
        settings: normalizeSettings(rawState.settings),
        visitedItemKeys: normalizeVisitedItemKeys(rawState.visitedItemKeys),
    }
}

function normalizeDate(value) {
    if (!value) {
        return null
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return null
    }
    return date.toISOString()
}

function normalizeSettings(rawSettings) {
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

function normalizeVisitedItemKeys(rawKeys) {
    if (!Array.isArray(rawKeys)) {
        return []
    }
    const seen = new Set()
    return rawKeys
        .map((itemKey) => String(itemKey || '').trim())
        .filter((itemKey) => {
            if (!itemKey || seen.has(itemKey)) {
                return false
            }
            seen.add(itemKey)
            return true
        })
}
