import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {STORAGE_KEY} from '../../src/scripts/constants.js'

const DOMAIN_MODULE_URL = pathToFileURL(
    path.resolve(process.cwd(), 'src/scripts/domain.js'),
).href

function createLocalStorageMock() {
    const storage = new Map()
    return {
        getItem(key) {
            return storage.has(key) ? storage.get(key) : null
        },
        setItem(key, value) {
            storage.set(String(key), String(value))
        },
        removeItem(key) {
            storage.delete(String(key))
        },
        clear() {
            storage.clear()
        },
    }
}

function getStoredState(storage) {
    const rawState = storage.getItem(STORAGE_KEY)
    return rawState ? JSON.parse(rawState) : null
}

async function loadFreshDomainModule(initialState = null) {
    const localStorage = createLocalStorageMock()
    if (initialState) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState))
    }
    globalThis.localStorage = localStorage
    const cacheKey = `${Date.now()}-${Math.random()}`
    const domain = await import(`${DOMAIN_MODULE_URL}?smoke=${cacheKey}`)
    return {domain, localStorage}
}

test('domain state mutations persist folders and feeds into storage', async () => {
    const {domain, localStorage} = await loadFreshDomainModule()

    domain.createFolder('Tech')
    let state = domain.getState()
    assert.equal(state.folders.length, 1)
    const folderId = state.folders[0].id
    assert.ok(folderId)

    domain.addFeed({
        folderId,
        name: 'Hacker News',
        url: 'news.ycombinator.com/rss',
    })
    state = domain.getState()
    assert.equal(state.folders[0].feeds.length, 1)
    assert.equal(
        state.folders[0].feeds[0].url,
        'https://news.ycombinator.com/rss',
    )

    const persistedState = getStoredState(localStorage)
    assert.equal(persistedState.folders.length, 1)
    assert.equal(persistedState.folders[0].feeds.length, 1)

    const feedId = state.folders[0].feeds[0].id
    domain.removeFeed(folderId, feedId)
    assert.equal(domain.getState().folders[0].feeds.length, 0)
})

test('markItemsVisited and unmarkItemsVisited keep unique visited keys', async () => {
    const {domain} = await loadFreshDomainModule()

    domain.markItemsVisited(['item-a', 'item-a', 'item-b'])
    assert.deepEqual(domain.getState().visitedItemKeys, ['item-a', 'item-b'])

    domain.unmarkItemsVisited('item-a')
    assert.deepEqual(domain.getState().visitedItemKeys, ['item-b'])
})

test('registerFeedItemClick stores a single click per item key', async () => {
    const {domain} = await loadFreshDomainModule()

    const firstResult = domain.registerFeedItemClick({
        itemKey: 'article-1',
        source: 'Tech Daily',
        title: 'JavaScript release notes',
        link: 'https://example.com/release',
    })
    const secondResult = domain.registerFeedItemClick({
        itemKey: 'article-1',
        source: 'Tech Daily',
        title: 'JavaScript release notes',
        link: 'https://example.com/release',
    })

    assert.equal(firstResult, true)
    assert.equal(secondResult, false)
    assert.deepEqual(domain.getState().clickedItemKeys, ['article-1'])
    assert.equal(domain.getState().clickModel.totalClicks, 1)
    assert.equal(domain.getState().clickModel.sourceCounts['tech daily'], 1)
    assert.equal(
        domain.getState().clickModel.sourceHostCounts['tech daily||example.com'],
        1,
    )
})

test('importState and exportState preserve folder and settings contract', async () => {
    const {domain} = await loadFreshDomainModule()

    const importResult = domain.importState({
        version: 1,
        folders: [
            {
                id: 'folder-1',
                name: 'News',
                feeds: [
                    {
                        id: 'feed-1',
                        name: 'Example',
                        url: 'example.com/rss',
                    },
                ],
            },
        ],
        settings: {
            autoMarkReadOnScroll: true,
        },
    })

    assert.equal(importResult.ok, true)

    const exported = domain.exportState()
    assert.equal(exported.folders.length, 1)
    assert.equal(exported.folders[0].feeds.length, 1)
    assert.equal(exported.folders[0].feeds[0].url, 'https://example.com/rss')
    assert.equal(exported.settings.autoMarkReadOnScroll, true)
})

test('resetState restores defaults from storage', async () => {
    const {domain} = await loadFreshDomainModule()

    domain.createFolder('Temporary')
    assert.equal(domain.getState().folders.length, 1)

    domain.resetState()
    assert.deepEqual(domain.getState().folders, [])
    assert.deepEqual(domain.getState().visitedItemKeys, [])
    assert.deepEqual(domain.getState().clickedItemKeys, [])
})
