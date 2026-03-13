import test from 'node:test'
import assert from 'node:assert/strict'

import {createAppActions} from '../../src/scripts/app-actions.js'

function createActions({
    getState = () => ({folders: [{feeds: [{id: 'feed-1'}]}]}),
    refreshAll = async () => ({errorsCount: 0, errors: []}),
    shouldAutoMarkReadOnScroll = () => false,
    syncAppView = () => {},
    updateStatus = () => {},
    markHiddenFeedItemsInAllColumns = () => {},
} = {}) {
    return createAppActions({
        elements: {
            refresh: {
                disabled: false,
            },
            importFile: null,
        },
        exportState: () => ({}),
        getState,
        importState: () => ({ok: true}),
        markHiddenFeedItemsInAllColumns,
        onImportFileReset: () => {},
        refreshAll,
        shouldAutoMarkReadOnScroll,
        syncAppView,
        updateStatus,
    })
}

test('refreshAllFeeds de-duplicates concurrent refresh calls', async () => {
    let resolveRefresh = null
    let refreshCalls = 0

    const refreshBarrier = new Promise((resolve) => {
        resolveRefresh = resolve
    })

    const actions = createActions({
        refreshAll: async () => {
            refreshCalls += 1
            await refreshBarrier
            return {errorsCount: 0, errors: []}
        },
    })

    const firstRequest = actions.refreshAllFeeds()
    const secondRequest = actions.refreshAllFeeds()

    assert.equal(refreshCalls, 1)

    resolveRefresh()
    const [firstResult, secondResult] = await Promise.all([
        firstRequest,
        secondRequest,
    ])
    assert.deepEqual(firstResult, secondResult)
})

test('refreshAllFeeds in empty state does not call refreshAll', async () => {
    const statusEvents = []
    let refreshCalls = 0

    const actions = createActions({
        getState: () => ({folders: []}),
        refreshAll: async () => {
            refreshCalls += 1
            return {errorsCount: 0, errors: []}
        },
        updateStatus: (text, tone) => {
            statusEvents.push({text, tone})
        },
    })

    await actions.refreshAllFeeds()

    assert.equal(refreshCalls, 0)
    assert.equal(statusEvents.length, 1)
    assert.equal(statusEvents[0].text, 'Добавьте потоки для обновления')
})

test('refreshAllFeeds restores button state after failed refresh', async () => {
    const statusEvents = []
    const syncEvents = []
    const refreshButton = {disabled: false}

    const actions = createAppActions({
        elements: {
            refresh: refreshButton,
            importFile: null,
        },
        exportState: () => ({}),
        getState: () => ({folders: [{feeds: [{id: 'feed-1'}]}]}),
        importState: () => ({ok: true}),
        markHiddenFeedItemsInAllColumns: () => {},
        onImportFileReset: () => {},
        refreshAll: async () => {
            throw new Error('network')
        },
        shouldAutoMarkReadOnScroll: () => false,
        syncAppView: (payload) => {
            syncEvents.push(payload || {})
        },
        updateStatus: (text, tone) => {
            statusEvents.push({text, tone})
        },
    })

    await actions.refreshAllFeeds()

    assert.equal(refreshButton.disabled, false)
    assert.ok(
        statusEvents.some(
            (event) =>
                event.text === 'Не удалось обновить ленты' &&
                event.tone === 'error',
        ),
    )
    assert.ok(syncEvents.some((payload) => payload.withLastUpdated === true))
})

test('auto refresh runs without loading and success statuses', async () => {
    const statusEvents = []
    const syncEvents = []

    const actions = createActions({
        syncAppView: (payload) => {
            syncEvents.push(payload || {})
        },
        updateStatus: (text, tone) => {
            statusEvents.push({text, tone})
        },
    })

    await actions.refreshAllFeeds({source: 'auto'})

    assert.deepEqual(statusEvents, [])
    assert.deepEqual(syncEvents, [{withLastUpdated: true}])
})

test('auto refresh skips empty-state status noise', async () => {
    const statusEvents = []
    let refreshCalls = 0

    const actions = createActions({
        getState: () => ({folders: []}),
        refreshAll: async () => {
            refreshCalls += 1
            return {errorsCount: 0, errors: []}
        },
        updateStatus: (text, tone) => {
            statusEvents.push({text, tone})
        },
    })

    await actions.refreshAllFeeds({source: 'auto'})

    assert.equal(refreshCalls, 0)
    assert.deepEqual(statusEvents, [])
})

test('handleFeedUpdated refreshes only when url changes', async () => {
    const syncEvents = []
    let refreshCalls = 0

    const actions = createActions({
        refreshAll: async () => {
            refreshCalls += 1
            return {errorsCount: 0, errors: []}
        },
        syncAppView: (payload) => {
            syncEvents.push(payload || {})
        },
    })

    await actions.handleFeedUpdated({ok: true, urlChanged: false})
    assert.equal(refreshCalls, 0)
    assert.equal(syncEvents.length, 1)
    assert.deepEqual(syncEvents[0], {})

    syncEvents.length = 0

    await actions.handleFeedUpdated({ok: true, urlChanged: true})
    assert.equal(refreshCalls, 1)
    assert.ok(syncEvents.some((payload) => payload.state))
})
