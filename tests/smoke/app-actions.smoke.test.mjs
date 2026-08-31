import test from 'node:test'
import assert from 'node:assert/strict'

import {createAppActions} from '../../src/scripts/app-actions.js'

function createActions({
    getState = () => ({folders: [{feeds: [{id: 'feed-1'}]}]}),
    refreshAll = async () => ({errorsCount: 0, errors: []}),
    setLastUpdatedInProgress = () => {},
    shouldAutoMarkReadOnScroll = () => false,
    syncAppView = () => {},
    markHiddenFeedItemsInAllColumns = () => {},
    showRefreshToast = () => {},
    hideRefreshToast = () => {},
    isOnline = () => true,
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
        setLastUpdatedInProgress,
        showRefreshToast,
        hideRefreshToast,
        isOnline,
        shouldAutoMarkReadOnScroll,
        syncAppView,
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

test('refreshAllFeeds preserves the live reading position at final render', async () => {
    let resolveRefresh = null
    const syncEvents = []
    const currentState = {folders: [{feeds: [{id: 'feed-1'}]}]}
    const refreshBarrier = new Promise((resolve) => {
        resolveRefresh = resolve
    })
    const actions = createActions({
        getState: () => currentState,
        refreshAll: async () => {
            await refreshBarrier
            return {errorsCount: 0, errors: []}
        },
        syncAppView: (payload) => {
            syncEvents.push(payload || {})
        },
    })

    const refreshPromise = actions.refreshAllFeeds()

    assert.deepEqual(syncEvents, [
        {
            state: currentState,
            preserveColumnScroll: true,
        },
    ])

    resolveRefresh()
    await refreshPromise

    assert.deepEqual(syncEvents, [
        {
            state: currentState,
            preserveColumnScroll: true,
        },
        {
            withLastUpdated: true,
            preserveColumnScroll: true,
        },
    ])
})

test('refreshAllFeeds in empty state does not call refreshAll', async () => {
    const syncEvents = []
    let refreshCalls = 0

    const actions = createActions({
        getState: () => ({folders: []}),
        refreshAll: async () => {
            refreshCalls += 1
            return {errorsCount: 0, errors: []}
        },
        syncAppView: (payload) => {
            syncEvents.push(payload || {})
        },
    })

    await actions.refreshAllFeeds()

    assert.equal(refreshCalls, 0)
    assert.deepEqual(syncEvents, [
        {state: {folders: []}, withLastUpdated: true},
    ])
})

test('refreshAllFeeds restores button state after failed refresh', async () => {
    const syncEvents = []
    const classListEvents = []
    const refreshButton = {
        disabled: false,
        classList: {
            add: (className) => classListEvents.push(['add', className]),
            remove: (className) => classListEvents.push(['remove', className]),
        },
    }

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
    })

    await actions.refreshAllFeeds()

    assert.equal(refreshButton.disabled, false)
    assert.deepEqual(classListEvents, [
        ['add', 'fab__icon-btn--refreshing'],
        ['remove', 'fab__icon-btn--refreshing'],
    ])
    assert.deepEqual(syncEvents, [
        {
            state: {
                folders: [{feeds: [{id: 'feed-1'}]}],
            },
            preserveColumnScroll: true,
        },
        {
            withLastUpdated: true,
            preserveColumnScroll: true,
        },
    ])
})

test('refreshAllFeeds lets column notices handle feed errors', async () => {
    const syncEvents = []
    const actions = createActions({
        refreshAll: async () => ({
            errorsCount: 2,
            errors: [
                {
                    feedId: 'feed-1',
                    feedName: 'Tech',
                    message: 'прокси недоступен (CORS)',
                },
            ],
        }),
        syncAppView: (payload) => {
            syncEvents.push(payload || {})
        },
    })

    await actions.refreshAllFeeds()

    assert.deepEqual(syncEvents, [
        {
            state: {
                folders: [{feeds: [{id: 'feed-1'}]}],
            },
            preserveColumnScroll: true,
        },
        {
            withLastUpdated: true,
            preserveColumnScroll: true,
        },
    ])
})

test('refreshAllFeeds shows an offline toast without making a request', async () => {
    const toastMessages = []
    let refreshCalls = 0
    const actions = createActions({
        isOnline: () => false,
        refreshAll: async () => {
            refreshCalls += 1
            return {errorsCount: 0, errors: []}
        },
        showRefreshToast: (message) => {
            toastMessages.push(message)
        },
    })

    await actions.refreshAllFeeds()

    assert.equal(refreshCalls, 0)
    assert.deepEqual(toastMessages, [
        'Нет подключения к интернету. Ленты не обновились.',
    ])
})

test('refreshAllFeeds shows a global toast when every feed fails', async () => {
    const toastEvents = []
    const actions = createActions({
        getState: () => ({
            folders: [
                {
                    feeds: [{id: 'feed-1'}, {id: 'feed-2'}],
                },
            ],
        }),
        refreshAll: async () => ({
            errorsCount: 2,
            errors: [
                {feedId: 'feed-1', message: 'ошибка сети/CORS'},
                {feedId: 'feed-2', message: 'ошибка сети/CORS'},
            ],
        }),
        hideRefreshToast: () => toastEvents.push('hide'),
        showRefreshToast: (message) => toastEvents.push(message),
    })

    await actions.refreshAllFeeds({source: 'auto'})

    assert.deepEqual(toastEvents, [
        'hide',
        'Не удалось обновить ленты. Проверьте подключение к интернету.',
    ])
})

test('refreshAllFeeds leaves partial failures to column notices', async () => {
    const toastEvents = []
    const actions = createActions({
        getState: () => ({
            folders: [
                {
                    feeds: [{id: 'feed-1'}, {id: 'feed-2'}],
                },
            ],
        }),
        refreshAll: async () => ({
            errorsCount: 1,
            errors: [{feedId: 'feed-1', message: 'ошибка сети/CORS'}],
        }),
        hideRefreshToast: () => toastEvents.push('hide'),
        showRefreshToast: (message) => toastEvents.push(message),
    })

    await actions.refreshAllFeeds()

    assert.deepEqual(toastEvents, ['hide'])
})

test('auto refresh runs without loading and success statuses', async () => {
    const syncEvents = []
    let inProgressCalls = 0

    const actions = createActions({
        setLastUpdatedInProgress: () => {
            inProgressCalls += 1
        },
        syncAppView: (payload) => {
            syncEvents.push(payload || {})
        },
    })

    await actions.refreshAllFeeds({source: 'auto'})

    assert.equal(inProgressCalls, 1)
    assert.deepEqual(syncEvents, [
        {
            withLastUpdated: true,
            preserveColumnScroll: true,
        },
    ])
})

test('refresh does not mark items hidden by newly inserted posts', async () => {
    let markHiddenCalls = 0
    const actions = createActions({
        shouldAutoMarkReadOnScroll: () => true,
        markHiddenFeedItemsInAllColumns: () => {
            markHiddenCalls += 1
        },
    })

    await actions.refreshAllFeeds()

    assert.equal(markHiddenCalls, 0)
})

test('auto refresh skips empty-state status noise', async () => {
    let refreshCalls = 0

    const actions = createActions({
        getState: () => ({folders: []}),
        refreshAll: async () => {
            refreshCalls += 1
            return {errorsCount: 0, errors: []}
        },
    })

    await actions.refreshAllFeeds({source: 'auto'})

    assert.equal(refreshCalls, 0)
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
    assert.deepEqual(syncEvents, [
        {
            state: {
                folders: [{feeds: [{id: 'feed-1'}]}],
            },
            preserveColumnScroll: true,
        },
        {
            withLastUpdated: true,
            preserveColumnScroll: true,
        },
    ])
})
