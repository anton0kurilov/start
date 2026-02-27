import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {
    CLICK_MODEL_V2_SCHEMA_VERSION,
    STORAGE_KEY,
} from '../../src/scripts/constants.js'

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

test('registerFeedItemImpressions stores pending entries and click trains V2 positive sample', async () => {
    const {domain} = await loadFreshDomainModule()

    const impressionsCount = domain.registerFeedItemImpressions([
        {
            itemKey: 'article-2',
            source: 'Tech Daily',
            title: 'AI model release',
            link: 'https://example.com/ai-release',
        },
    ])

    assert.equal(impressionsCount, 1)
    assert.ok(domain.getState().clickModelV2.pendingImpressions['article-2'])

    const clickResult = domain.registerFeedItemClick({
        itemKey: 'article-2',
        source: 'Tech Daily',
        title: 'AI model release',
        link: 'https://example.com/ai-release',
    })

    assert.equal(clickResult, true)
    assert.equal(domain.getState().clickModelV2.totalEvents, 1)
    assert.equal(domain.getState().clickModelV2.positiveEvents, 1)
    assert.equal(
        domain.getState().clickModelV2.pendingImpressions['article-2'],
        undefined,
    )
})

test('registerFeedItemImpressions settles expired impressions into negative samples', async () => {
    const oldTimestamp = Date.now() - 19 * 60 * 60 * 1000
    const {domain} = await loadFreshDomainModule({
        folders: [],
        lastUpdated: null,
        settings: {autoMarkReadOnScroll: false},
        visitedItemKeys: [],
        clickedItemKeys: [],
        clickModel: {
            totalClicks: 0,
            sourceCounts: {},
            sourceHostCounts: {},
            hostCounts: {},
            tokenCounts: {},
        },
        clickModelV2: {
            schemaVersion: CLICK_MODEL_V2_SCHEMA_VERSION,
            totalEvents: 0,
            positiveEvents: 0,
            negativeEvents: 0,
            bias: 0,
            weights: {},
            gradSquares: {},
            pendingImpressions: {
                stale: {
                    createdAt: oldTimestamp,
                    features: [[2, 1]],
                },
            },
        },
    })

    domain.registerFeedItemImpressions([])

    assert.equal(domain.getState().clickModelV2.totalEvents, 1)
    assert.equal(domain.getState().clickModelV2.negativeEvents, 1)
    assert.equal(
        domain.getState().clickModelV2.pendingImpressions.stale,
        undefined,
    )
})

test('getFeedItemUsefulness prioritizes strong title tokens over source bias', async () => {
    const {domain} = await loadFreshDomainModule({
        folders: [],
        lastUpdated: null,
        settings: {autoMarkReadOnScroll: false},
        visitedItemKeys: [],
        clickedItemKeys: [],
        clickModel: {
            totalClicks: 40,
            sourceCounts: {
                preferred: 25,
                secondary: 20,
            },
            sourceHostCounts: {
                'preferred||pref.example.com': 25,
                'secondary||sec.example.com': 20,
            },
            hostCounts: {
                'pref.example.com': 25,
                'sec.example.com': 20,
            },
            tokenCounts: {
                ai: 30,
                inference: 26,
                agents: 22,
                benchmark: 18,
            },
        },
    })

    const sourceBiasedItem = domain.getFeedItemUsefulness({
        source: 'preferred',
        link: 'https://pref.example.com/post',
        title: 'General platform update',
    })
    const titleDrivenItem = domain.getFeedItemUsefulness({
        source: 'secondary',
        link: 'https://sec.example.com/post',
        title: 'AI inference agents benchmark',
    })

    assert.equal(typeof sourceBiasedItem.score, 'number')
    assert.equal(typeof titleDrivenItem.score, 'number')
    assert.ok(titleDrivenItem.score > sourceBiasedItem.score)
})

test('getFeedItemUsefulness keeps a reasonable baseline after enough clicks', async () => {
    const {domain} = await loadFreshDomainModule({
        folders: [],
        lastUpdated: null,
        settings: {autoMarkReadOnScroll: false},
        visitedItemKeys: [],
        clickedItemKeys: [],
        clickModel: {
            totalClicks: 35,
            sourceCounts: {},
            sourceHostCounts: {},
            hostCounts: {},
            tokenCounts: {},
        },
    })

    const usefulness = domain.getFeedItemUsefulness({
        source: 'new source',
        link: 'https://unknown.example.com/news',
        title: 'Completely unseen headline terms',
    })

    assert.equal(typeof usefulness.score, 'number')
    assert.ok(usefulness.percentage >= 20)
})

test('getFeedItemUsefulness uses V2 score when neural model toggle is enabled', async () => {
    const {domain} = await loadFreshDomainModule({
        folders: [],
        lastUpdated: null,
        settings: {
            autoMarkReadOnScroll: false,
            useClickModelV2: true,
        },
        visitedItemKeys: [],
        clickedItemKeys: [],
        clickModel: {
            totalClicks: 35,
            sourceCounts: {},
            sourceHostCounts: {},
            hostCounts: {},
            tokenCounts: {},
        },
        clickModelV2: {
            schemaVersion: CLICK_MODEL_V2_SCHEMA_VERSION,
            totalEvents: 160,
            positiveEvents: 124,
            negativeEvents: 36,
            bias: 1.5,
            weights: {},
            gradSquares: {},
            pendingImpressions: {},
        },
    })

    const usefulness = domain.getFeedItemUsefulness({
        source: 'any',
        link: 'https://example.com/post',
        title: 'Any title',
    })

    assert.equal(typeof usefulness.score, 'number')
    assert.ok(usefulness.percentage >= 55)
    assert.ok(usefulness.title.includes('(V2)'))
})

test('getFeedItemUsefulness keeps V2 in learning mode before enough events', async () => {
    const {domain} = await loadFreshDomainModule({
        folders: [],
        lastUpdated: null,
        settings: {
            autoMarkReadOnScroll: false,
            useClickModelV2: true,
        },
        visitedItemKeys: [],
        clickedItemKeys: [],
        clickModel: {
            totalClicks: 35,
            sourceCounts: {},
            sourceHostCounts: {},
            hostCounts: {},
            tokenCounts: {},
        },
        clickModelV2: {
            schemaVersion: CLICK_MODEL_V2_SCHEMA_VERSION,
            totalEvents: 24,
            positiveEvents: 20,
            negativeEvents: 4,
            bias: 0.8,
            weights: {},
            gradSquares: {},
            pendingImpressions: {},
        },
    })

    const usefulness = domain.getFeedItemUsefulness({
        source: 'any',
        link: 'https://example.com/post',
        title: 'Any title',
    })

    assert.equal(usefulness.tone, 'learning')
    assert.equal(usefulness.score, null)
    assert.equal(usefulness.percentage, null)
})

test('getFeedItemUsefulness lifts mid-frequency keyword matches at larger history', async () => {
    const {domain} = await loadFreshDomainModule({
        folders: [],
        lastUpdated: null,
        settings: {autoMarkReadOnScroll: false},
        visitedItemKeys: [],
        clickedItemKeys: [],
        clickModel: {
            totalClicks: 66,
            sourceCounts: {},
            sourceHostCounts: {},
            hostCounts: {},
            tokenCounts: {
                ai: 4,
                model: 3,
            },
        },
    })

    const usefulness = domain.getFeedItemUsefulness({
        source: 'new source',
        link: 'https://unknown.example.com/news',
        title: 'AI model update',
    })

    assert.equal(typeof usefulness.score, 'number')
    assert.ok(usefulness.percentage >= 45)
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
