import {STORAGE_KEY} from './constants.js'
import {createDefaultState, normalizeStatePayload} from './state-normalizers.js'

let backend
export function setStateStorage(next) {
    backend = next
}

export function loadState() {
    if (backend) return backend.loadState()
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return createDefaultState()
        }
        const parsed = decodeStoredState(JSON.parse(raw))
        return normalizeStatePayload(parsed) || createDefaultState()
    } catch (error) {
        return createDefaultState()
    }
}

export function saveState(state) {
    if (backend) return backend.saveState(state)
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
        return true
    } catch (error) {
        if (error?.name === 'QuotaExceededError') {
            try {
                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(encodeStoredState(state)),
                )
                return true
            } catch {
                return false
            }
        }
        return false
    }
}

// Keep legacy JSON readable; only compact history when the full state won't fit.
// Intern repeated URLs/titles and store event fields as tuples without dropping
// reading history or recommendation events. Exports still use the domain format.
function encodeStoredState(state) {
    const strings = []
    const indexes = new Map()
    const intern = (value) => {
        if (!indexes.has(value)) {
            indexes.set(value, strings.length)
            strings.push(value)
        }
        return indexes.get(value)
    }
    return {
        ...state,
        storageEncoding: 'compact-v1',
        strings,
        visitedItemKeys: state.visitedItemKeys.map(intern),
        clickedItemKeys: state.clickedItemKeys.map(intern),
        modelState: {
            ...state.modelState,
            interactionLog: state.modelState.interactionLog.map((event) => [
                event.type,
                intern(event.itemKey),
                event.recordedAt,
                intern(event.snapshot.source),
                intern(event.snapshot.feedId),
                intern(event.snapshot.title),
                intern(event.snapshot.link),
                event.snapshot.publishedAt,
            ]),
        },
    }
}

export function decodeStoredState(state) {
    if (state?.storageEncoding !== 'compact-v1') return state
    const {strings} = state
    return {
        ...state,
        visitedItemKeys: state.visitedItemKeys.map((index) => strings[index]),
        clickedItemKeys: state.clickedItemKeys.map((index) => strings[index]),
        modelState: {
            ...state.modelState,
            interactionLog: state.modelState.interactionLog.map((event) => ({
                type: event[0],
                itemKey: strings[event[1]],
                recordedAt: event[2],
                snapshot: {
                    source: strings[event[3]],
                    feedId: strings[event[4]],
                    title: strings[event[5]],
                    link: strings[event[6]],
                    publishedAt: event[7],
                },
            })),
        },
    }
}

export function clearState() {
    if (backend) return backend.clearState()
    try {
        localStorage.removeItem(STORAGE_KEY)
        return true
    } catch (error) {
        return false
    }
}
