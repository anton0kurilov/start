import test from 'node:test'
import assert from 'node:assert/strict'
import {get} from 'svelte/store'
import * as domain from '../../src/scripts/domain.js'
import {createAppController} from '../../src/app/controller.ts'

function setup(overrides = {}) {
    const data = {
        folders: [],
        settings: {
            autoMarkReadOnScroll: false,
            autoRefreshFeeds: false,
            showRecommendedColumn: false,
            blockedTitlePhrases: [],
        },
        lastUpdated: null,
    }
    const api = {
        ...domain,
        getState: () => data,
        prepareView: () => false,
        createFolder: (name) => {
            data.folders.push({id: 'new', name, feeds: []})
        },
        ...overrides,
    }
    const controller = createAppController({api, host: null})
    return {controller, data, api}
}
test('controller publishes detached UI state through a read-only store', async () => {
    const {controller, data} = setup()
    const previous = get(controller.state)
    assert.equal(controller.state.set, undefined)
    assert.equal(await controller.createFolder(' Design '), 'new')
    assert.equal(previous.folders.length, 0)
    assert.equal(get(controller.state).folders[0].name, 'Design')
    get(controller.state).folders[0].name = 'outside'
    assert.equal(data.folders[0].name, 'Design')
    controller.dispose()
})
test('controller deduplicates refresh and restores pending state on failure', async () => {
    let resolve
    let calls = 0
    const {controller, data} = setup({
        refreshAll: () => {
            calls++
            return new Promise((r) => (resolve = r))
        },
    })
    data.folders = [
        {
            id: 'f',
            name: 'Test',
            feeds: [{id: 'rss', name: 'RSS', url: 'https://test.example/rss'}],
        },
    ]
    await controller.createFolder('Other')
    const first = controller.refresh(),
        second = controller.refresh()
    assert.equal(first, second)
    assert.equal(get(controller.state).refreshing, true)
    resolve({errorsCount: 1})
    await first
    assert.equal(calls, 1)
    assert.equal(get(controller.state).refreshing, false)
    assert.match(get(controller.state).refreshError, /Не удалось/)
    controller.dispose()
})
test('controller reports import errors without replacing state', async () => {
    let calls = 0
    const {controller} = setup({
        importState: () => {
            calls++
            return {ok: true}
        },
    })
    assert.equal((await controller.importJson('{')).ok, false)
    assert.equal((await controller.importJson('{}')).ok, false)
    assert.equal(calls, 0)
    assert.equal(get(controller.state).folders.length, 0)
    controller.dispose()
})
test('storage failure reports an actionable import error and keeps refresh running', async () => {
    let resolve
    let signal
    let calls = 0
    const {controller, data} = setup({
        importState: () => ({ok: false, error: 'storage'}),
        refreshAll: (options) => {
            calls++
            signal = options.signal
            return new Promise((r) => (resolve = r))
        },
    })
    data.folders = [
        {
            id: 'existing',
            name: 'Existing',
            feeds: [{id: 'rss', name: 'RSS', url: 'https://test.example/rss'}],
        },
    ]
    await controller.createFolder('Other')
    const pending = controller.refresh()
    const before = get(controller.state)
    const result = await controller.importJson(JSON.stringify({folders: []}))
    assert.equal(result.ok, false)
    assert.match(result.error, /Не удалось сохранить данные на устройстве/)
    assert.deepEqual(get(controller.state).folders, before.folders)
    assert.equal(get(controller.state).refreshing, true)
    assert.equal(signal.aborted, false)
    assert.equal(calls, 1)
    resolve({errorsCount: 0})
    await pending
    assert.equal(get(controller.state).refreshing, false)
    controller.dispose()
})
test('selectors do not prepare or persist the model during snapshots', async () => {
    let prepared = 0
    const {controller} = setup({
        prepareView: () => {
            prepared++
            return true
        },
    })
    await controller.createFolder('One')
    assert.equal(prepared, 0)
    controller.dispose()
})
test('disposing prevents late async responses from publishing', async () => {
    let resolve
    const {controller, data} = setup({
        refreshAll: () => new Promise((r) => (resolve = r)),
    })
    data.folders = [
        {
            id: 'f',
            name: 'Test',
            feeds: [{id: 'rss', name: 'RSS', url: 'https://test.example/rss'}],
        },
    ]
    await controller.createFolder('Other')
    let emissions = 0
    const off = controller.state.subscribe(() => emissions++)
    const pending = controller.refresh()
    controller.dispose()
    const count = emissions
    resolve({errorsCount: 0})
    await pending
    assert.equal(emissions, count)
    assert.throws(() => controller.createFolder('Late'), /disposed/)
    off()
})
test('dispose aborts requests and removes lifecycle listeners', async () => {
    let signal
    const events = new EventTarget()
    events.document = new EventTarget()
    events.document.visibilityState = 'visible'
    let added = 0,
        removed = 0,
        prepared = 0
    const add = events.addEventListener.bind(events),
        remove = events.removeEventListener.bind(events)
    events.addEventListener = (...args) => {
        added++
        add(...args)
    }
    events.removeEventListener = (...args) => {
        removed++
        remove(...args)
    }
    const data = {
        folders: [
            {
                id: 'f',
                name: 'Test',
                feeds: [
                    {id: 'rss', name: 'RSS', url: 'https://test.example/rss'},
                ],
            },
        ],
        settings: {
            autoMarkReadOnScroll: false,
            autoRefreshFeeds: false,
            showRecommendedColumn: false,
            blockedTitlePhrases: [],
        },
        lastUpdated: null,
    }
    const api = {
        ...domain,
        getState: () => data,
        prepareView: () => {
            prepared++
            return false
        },
        refreshAll: ({signal: s}) => {
            signal = s
            return Promise.resolve({errorsCount: 0})
        },
    }
    const controller = createAppController({api, host: events})
    controller.start()
    controller.start()
    assert.equal(added, 3)
    await controller.refresh()
    controller.dispose()
    controller.dispose()
    assert.equal(removed, 3)
    assert.equal(signal.aborted, true)
    assert.equal(prepared, 0)
})
