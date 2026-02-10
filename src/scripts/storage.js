import {STORAGE_KEY} from './constants.js'

const fallbackState = {
    folders: [],
    lastUpdated: null,
}

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return {...fallbackState}
        }
        const parsed = JSON.parse(raw)
        if (!parsed || !Array.isArray(parsed.folders)) {
            return {...fallbackState}
        }
        return parsed
    } catch (error) {
        return {...fallbackState}
    }
}

export function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function clearState() {
    localStorage.removeItem(STORAGE_KEY)
}
