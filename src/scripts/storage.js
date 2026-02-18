import {STORAGE_KEY} from './constants.js'
import {createDefaultState, normalizeStatePayload} from './state-normalizers.js'

export function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return createDefaultState()
        }
        const parsed = JSON.parse(raw)
        return normalizeStatePayload(parsed) || createDefaultState()
    } catch (error) {
        return createDefaultState()
    }
}

export function saveState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
        return true
    } catch (error) {
        return false
    }
}

export function clearState() {
    try {
        localStorage.removeItem(STORAGE_KEY)
        return true
    } catch (error) {
        return false
    }
}
