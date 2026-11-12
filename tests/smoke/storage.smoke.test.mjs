import test from 'node:test'
import assert from 'node:assert/strict'
import {STORAGE_KEY} from '../../src/scripts/constants.js'
import {createDefaultState} from '../../src/scripts/state-normalizers.js'
import {clearState, loadState, saveState} from '../../src/scripts/storage.js'

function storageWithQuota(t, quota) {
    const previous = globalThis.localStorage
    const entries = new Map()
    globalThis.localStorage = {
        getItem: (key) => entries.get(key) ?? null,
        setItem(key, value) {
            if (value.length * 2 > quota)
                throw new DOMException('Storage full', 'QuotaExceededError')
            entries.set(key, value)
        },
        removeItem: (key) => entries.delete(key),
    }
    t.after(() => {
        if (previous === undefined) delete globalThis.localStorage
        else globalThis.localStorage = previous
    })
    return entries
}

function stateWithHistory() {
    const state = createDefaultState()
    state.folders = [{id: 'news', name: 'Новости', feeds: []}]
    state.settings.blockedTitlePhrases = ['Реклама']
    state.modelState.interactionLog = Array.from({length: 300}, (_, i) => {
        const link = `https://example.com/articles/${Math.floor(i / 3)}`
        return {
            type: ['impression', 'click', 'dismiss'][i % 3],
            itemKey: link,
            recordedAt: 1800000000000 + i,
            snapshot: {
                source: 'Источник новостей',
                feedId: 'feed-1',
                title: `Заголовок новости ${Math.floor(i / 3)}`,
                link,
                publishedAt: i % 2 ? '2026-11-10T12:00:00.000Z' : null,
            },
        }
    })
    state.visitedItemKeys = state.modelState.interactionLog
        .filter((event) => event.type === 'impression')
        .map((event) => event.itemKey)
    state.clickedItemKeys = [...state.visitedItemKeys]
    return state
}

test('legacy storage remains readable and is used when it fits', (t) => {
    const entries = storageWithQuota(t, Infinity)
    const state = stateWithHistory()
    assert.equal(saveState(state), true)
    assert.deepEqual(JSON.parse(entries.get(STORAGE_KEY)), state)
    assert.deepEqual(loadState(), state)
})

test('quota fallback restores every history event and leaves domain data unchanged', (t) => {
    const state = stateWithHistory()
    const before = structuredClone(state)
    const fullSize = JSON.stringify(state).length * 2
    const entries = storageWithQuota(t, fullSize * 0.6)

    assert.equal(saveState(state), true)
    assert.equal(
        JSON.parse(entries.get(STORAGE_KEY)).storageEncoding,
        'compact-v1',
    )
    assert.deepEqual(state, before)
    assert.deepEqual(loadState(), state)

    // Later mutations and another cold load must work after compaction too.
    const restored = loadState()
    restored.folders[0].name = 'После перезапуска'
    assert.equal(saveState(restored), true)
    assert.deepEqual(loadState(), restored)
    assert.equal(clearState(), true)
    assert.deepEqual(loadState(), createDefaultState())
})

test('exhausted quota preserves the previously saved state', (t) => {
    const previous = createDefaultState()
    const entries = storageWithQuota(t, JSON.stringify(previous).length * 2)
    assert.equal(saveState(previous), true)
    const raw = entries.get(STORAGE_KEY)
    assert.equal(saveState(stateWithHistory()), false)
    assert.equal(entries.get(STORAGE_KEY), raw)
    assert.deepEqual(loadState(), previous)
})

test('unavailable storage reports failure without attempting quota compaction', (t) => {
    storageWithQuota(t, Infinity)
    let calls = 0
    globalThis.localStorage.setItem = () => {
        calls++
        throw new DOMException('Storage blocked', 'SecurityError')
    }
    assert.equal(saveState(stateWithHistory()), false)
    assert.equal(calls, 1)
})
