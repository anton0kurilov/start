import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

import {
    MODEL_IMPRESSION_NEGATIVE_DELAY_MS,
    MODEL_STATE_SCHEMA_VERSION,
    MODEL_VERSION,
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

function createBaseState(overrides = {}) {
    return {
        folders: [],
        lastUpdated: null,
        settings: {
            autoMarkReadOnScroll: false,
            autoRefreshFeeds: false,
            showFavoritesColumn: false,
        },
        visitedItemKeys: [],
        clickedItemKeys: [],
        modelState: {
            schemaVersion: MODEL_STATE_SCHEMA_VERSION,
            modelVersion: MODEL_VERSION,
            interactionLog: [],
            modelArtifacts: {},
            calibrationArtifacts: {},
        },
        ...overrides,
    }
}

function createInteractionEvent({
    type,
    itemKey,
    recordedAt,
    source = 'Tech Daily',
    feedId = 'feed-1',
    title = 'AI agent benchmark',
    link = `https://example.com/${itemKey}`,
    publishedAt = '2026-03-01T10:00:00.000Z',
}) {
    return {
        type,
        itemKey,
        recordedAt,
        snapshot: {
            source,
            feedId,
            title,
            link,
            publishedAt,
        },
    }
}

function createPublishedScorerState({
    probability,
    baselineCtr = 0.1,
    weights = {},
}) {
    return createBaseState({
        modelState: {
            schemaVersion: MODEL_STATE_SCHEMA_VERSION,
            modelVersion: MODEL_VERSION,
            interactionLog: [],
            modelArtifacts: {},
            calibrationArtifacts: {},
            publishedModelArtifacts: {
                totalLabeledSamples: 240,
                baselineCtr,
                bias: logit(probability),
                weights,
            },
            publishedCalibrationArtifacts: {
                ready: true,
                slope: 1,
                intercept: 0,
                metrics: {
                    ece: 0.04,
                    baselineCtr,
                },
            },
        },
    })
}

function logit(probability) {
    return Math.log(probability / (1 - probability))
}

async function withMockedNow(now, callback) {
    const originalNow = Date.now
    Date.now = () => now
    try {
        return await callback()
    } finally {
        Date.now = originalNow
    }
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

test('updateFeed updates stored feed name and normalizes url', async () => {
    const initialState = createBaseState({
        folders: [
            {
                id: 'folder-1',
                name: 'Tech',
                feeds: [
                    {
                        id: 'feed-1',
                        name: 'Hacker News',
                        url: 'https://news.ycombinator.com/rss',
                    },
                    {
                        id: 'feed-2',
                        name: 'Lobsters',
                        url: 'https://lobste.rs/rss',
                    },
                ],
            },
        ],
    })
    const {domain, localStorage} = await loadFreshDomainModule(initialState)

    const result = domain.updateFeed({
        folderId: 'folder-1',
        feedId: 'feed-1',
        name: 'HN Frontpage',
        url: 'hnrss.github.io/frontpage',
    })

    assert.deepEqual(result, {ok: true, urlChanged: true})

    const updatedFeed = domain.getState().folders[0].feeds[0]
    assert.equal(updatedFeed.name, 'HN Frontpage')
    assert.equal(updatedFeed.url, 'https://hnrss.github.io/frontpage')

    const persistedState = getStoredState(localStorage)
    assert.equal(persistedState.folders[0].feeds[0].name, 'HN Frontpage')
    assert.equal(
        persistedState.folders[0].feeds[0].url,
        'https://hnrss.github.io/frontpage',
    )
})

test('updateFolder trims and persists renamed column', async () => {
    const initialState = createBaseState({
        folders: [
            {
                id: 'folder-1',
                name: 'Tech',
                feeds: [],
            },
        ],
    })
    const {domain, localStorage} = await loadFreshDomainModule(initialState)

    const result = domain.updateFolder({
        folderId: 'folder-1',
        name: '  Product  ',
    })

    assert.deepEqual(result, {ok: true})
    assert.equal(domain.getState().folders[0].name, 'Product')

    const persistedState = getStoredState(localStorage)
    assert.equal(persistedState.folders[0].name, 'Product')
})

test('markItemsVisited and unmarkItemsVisited keep unique visited keys', async () => {
    const {domain} = await loadFreshDomainModule()

    domain.markItemsVisited(['item-a', 'item-a', 'item-b'])
    assert.deepEqual(domain.getState().visitedItemKeys, ['item-a', 'item-b'])

    domain.unmarkItemsVisited('item-a')
    assert.deepEqual(domain.getState().visitedItemKeys, ['item-b'])
})

test('registerFeedItemImpressions stores a single impression event per item key', async () => {
    const {domain} = await loadFreshDomainModule()

    const firstCount = domain.registerFeedItemImpressions({
        itemKey: 'article-1',
        feedId: 'feed-1',
        source: 'Tech Daily',
        title: 'AI model release',
        link: 'https://example.com/ai-release',
    })
    const secondCount = domain.registerFeedItemImpressions({
        itemKey: 'article-1',
        feedId: 'feed-1',
        source: 'Tech Daily',
        title: 'AI model release',
        link: 'https://example.com/ai-release',
    })

    assert.equal(firstCount, 1)
    assert.equal(secondCount, 0)
    assert.equal(domain.getState().modelState.interactionLog.length, 1)
    assert.equal(domain.getState().modelState.interactionLog[0].type, 'impression')
})

test('registerFeedItemClick stores a single click per item key and retrains the scorer', async () => {
    const {domain} = await loadFreshDomainModule()

    const firstResult = domain.registerFeedItemClick({
        itemKey: 'article-1',
        feedId: 'feed-1',
        source: 'Tech Daily',
        title: 'JavaScript release notes',
        link: 'https://example.com/release',
    })
    const secondResult = domain.registerFeedItemClick({
        itemKey: 'article-1',
        feedId: 'feed-1',
        source: 'Tech Daily',
        title: 'JavaScript release notes',
        link: 'https://example.com/release',
    })

    assert.equal(firstResult, true)
    assert.equal(secondResult, false)
    assert.deepEqual(domain.getState().clickedItemKeys, ['article-1'])
    assert.equal(domain.getState().modelState.modelArtifacts.totalLabeledSamples, 1)
    assert.equal(domain.getState().modelState.modelArtifacts.positiveSamples, 1)
    assert.equal(domain.getState().modelState.interactionLog.at(-1).type, 'click')
})

test('registerFeedItemDismiss stores an explicit negative event', async () => {
    const {domain} = await loadFreshDomainModule()

    const dismissResult = domain.registerFeedItemDismiss({
        itemKey: 'article-2',
        feedId: 'feed-1',
        source: 'Tech Daily',
        title: 'Rust release notes',
        link: 'https://example.com/rust-release',
    })

    assert.equal(dismissResult, true)
    assert.equal(domain.getState().modelState.modelArtifacts.totalLabeledSamples, 1)
    assert.equal(domain.getState().modelState.modelArtifacts.explicitNegativeSamples, 1)
    assert.equal(domain.getState().modelState.interactionLog.at(-1).type, 'dismiss')
    assert.equal(domain.isItemDismissed('article-2'), true)
})

test('registerFeedItemDismiss overrides a prior click for the same item', async () => {
    const {domain} = await loadFreshDomainModule()

    const clickResult = domain.registerFeedItemClick({
        itemKey: 'article-3',
        feedId: 'feed-1',
        source: 'Tech Daily',
        title: 'Accidental click example',
        link: 'https://example.com/article-3',
    })
    const dismissResult = domain.registerFeedItemDismiss({
        itemKey: 'article-3',
        feedId: 'feed-1',
        source: 'Tech Daily',
        title: 'Accidental click example',
        link: 'https://example.com/article-3',
    })

    assert.equal(clickResult, true)
    assert.equal(dismissResult, true)
    assert.deepEqual(domain.getState().clickedItemKeys, [])
    assert.equal(domain.isItemDismissed('article-3'), true)
    assert.equal(domain.getState().modelState.modelArtifacts.positiveSamples, 0)
    assert.equal(
        domain.getState().modelState.modelArtifacts.explicitNegativeSamples,
        1,
    )
    assert.equal(domain.getState().modelState.interactionLog.at(-1).type, 'dismiss')
})

test('module init upgrades stale impressions into weak negatives', async () => {
    const now = Date.parse('2026-03-09T10:00:00.000Z')
    const oldImpressionAt = now - MODEL_IMPRESSION_NEGATIVE_DELAY_MS - 1000

    const initialState = createBaseState({
        modelState: {
            schemaVersion: MODEL_STATE_SCHEMA_VERSION,
            modelVersion: 1,
            interactionLog: [
                createInteractionEvent({
                    type: 'impression',
                    itemKey: 'stale-item',
                    recordedAt: oldImpressionAt,
                }),
            ],
            modelArtifacts: {},
            calibrationArtifacts: {},
        },
    })

    const {domain} = await withMockedNow(now, async () => {
        return await loadFreshDomainModule(initialState)
    })

    assert.equal(domain.getState().modelState.modelArtifacts.totalLabeledSamples, 1)
    assert.equal(domain.getState().modelState.modelArtifacts.weakNegativeSamples, 1)
})

test('getFeedItemUsefulness marks previously clicked item as clicked', async () => {
    const {domain} = await loadFreshDomainModule(
        createBaseState({
            clickedItemKeys: ['https://example.com/repeat'],
        }),
    )

    const usefulness = domain.getFeedItemUsefulness({
        id: 'id-1',
        source: 'Any source',
        title: 'Any headline',
        link: 'https://example.com/repeat',
    })

    assert.equal(usefulness.label, 'посетил')
    assert.equal(usefulness.tone, 'high')
    assert.ok(usefulness.percentage >= 90)
})

test('getFeedItemUsefulness prioritizes dismiss over a prior click', async () => {
    const {domain} = await loadFreshDomainModule()

    domain.registerFeedItemClick({
        itemKey: 'https://example.com/conflict',
        feedId: 'feed-1',
        source: 'Any source',
        title: 'Any headline',
        link: 'https://example.com/conflict',
    })
    domain.registerFeedItemDismiss({
        itemKey: 'https://example.com/conflict',
        feedId: 'feed-1',
        source: 'Any source',
        title: 'Any headline',
        link: 'https://example.com/conflict',
    })

    const usefulness = domain.getFeedItemUsefulness({
        id: 'id-2',
        source: 'Any source',
        title: 'Any headline',
        link: 'https://example.com/conflict',
    })

    assert.equal(usefulness.label, 'скрыл')
    assert.equal(usefulness.tone, 'low')
    assert.equal(usefulness.percentage, 0)
})

test('getFeedItemUsefulness keeps learning mode without calibrated scorer data', async () => {
    const {domain} = await loadFreshDomainModule(
        createBaseState({
            clickModel: {
                totalClicks: 120,
            },
            clickModelV2: {
                schemaVersion: 2,
                totalEvents: 999,
            },
        }),
    )

    const usefulness = domain.getFeedItemUsefulness({
        source: 'new source',
        link: 'https://unknown.example.com/news',
        title: 'Completely unseen headline terms',
    })

    assert.equal(usefulness.tone, 'learning')
    assert.equal(usefulness.score, null)
    assert.equal(usefulness.percentage, null)
})

test('getFeedItemUsefulness keeps using the last published calibration', async () => {
    const {domain} = await loadFreshDomainModule(
        createBaseState({
            modelState: {
                schemaVersion: MODEL_STATE_SCHEMA_VERSION,
                modelVersion: 1,
                interactionLog: [],
                modelArtifacts: {
                    totalLabeledSamples: 48,
                    bias: -0.3,
                    weights: {},
                },
                calibrationArtifacts: {
                    ready: false,
                    slope: 1,
                    intercept: 0,
                    metrics: {
                        ece: 0.4,
                    },
                },
                publishedModelArtifacts: {
                    totalLabeledSamples: 42,
                    bias: 0.35,
                    weights: {},
                },
                publishedCalibrationArtifacts: {
                    ready: true,
                    slope: 1,
                    intercept: 0,
                    metrics: {
                        ece: 0.04,
                    },
                },
            },
        }),
    )

    const usefulness = domain.getFeedItemUsefulness({
        source: 'Stable source',
        link: 'https://example.com/stable',
        title: 'Stable headline',
    })

    assert.equal(usefulness.tone, 'high')
    assert.equal(usefulness.label, '59%')
    assert.equal(usefulness.percentage, 59)
    assert.match(usefulness.title, /Вероятность клика: 59%/)
})

test('getFeedItemUsefulness falls back to approximate percentages for large datasets', async () => {
    const {domain} = await loadFreshDomainModule()
    Object.assign(domain.getState().modelState, {
        modelArtifacts: {
            trainedAt: null,
            totalLabeledSamples: 420,
            trainingSize: 336,
            holdoutSize: 84,
            positiveSamples: 140,
            explicitNegativeSamples: 180,
            weakNegativeSamples: 100,
            baselineCtr: 0.33,
            bias: 0.35,
            weights: {},
            topFeatures: [],
        },
        calibrationArtifacts: {
            ready: true,
            trainedAt: null,
            slope: 1,
            intercept: 0,
            holdoutSize: 84,
            metrics: {
                prAuc: 0.5,
                logLoss: 0.6,
                brier: 0.2,
                ece: 0.12,
                baselineCtr: 0.33,
                bucketCtrs: [],
            },
        },
        publishedModelArtifacts: {},
        publishedCalibrationArtifacts: {},
    })

    const usefulness = domain.getFeedItemUsefulness({
        source: 'Approx source',
        link: 'https://example.com/approx',
        title: 'Approx headline',
    })

    assert.equal(usefulness.tone, 'high')
    assert.equal(usefulness.label, '~59%')
    assert.equal(usefulness.percentage, 59)
    assert.match(usefulness.title, /Ориентировочная вероятность клика: ~59%/)
})

test('getFeedItemUsefulness maps clearly weak item to low tone', async () => {
    const {domain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.04,
            baselineCtr: 0.1,
        }),
    )

    const usefulness = domain.getFeedItemUsefulness({
        source: 'Cold source',
        link: 'https://example.com/weak',
        title: 'Weak headline',
    })

    assert.equal(usefulness.tone, 'low')
    assert.equal(usefulness.label, '4%')
    assert.equal(usefulness.percentage, 4)
})

test('getFeedItemUsefulness maps average baseline item to medium tone', async () => {
    const {domain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.1,
            baselineCtr: 0.1,
        }),
    )

    const usefulness = domain.getFeedItemUsefulness({
        source: 'Normal source',
        link: 'https://example.com/average',
        title: 'Average headline',
    })

    assert.equal(usefulness.tone, 'medium')
    assert.equal(usefulness.label, '10%')
    assert.equal(usefulness.percentage, 10)
    assert.match(usefulness.title, /Средний уровень: 10%/)
})

test('getFeedItemUsefulness maps strong lift over baseline to high tone', async () => {
    const {domain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.22,
            baselineCtr: 0.1,
        }),
    )

    const usefulness = domain.getFeedItemUsefulness({
        source: 'Strong source',
        link: 'https://example.com/strong',
        title: 'Strong headline',
    })

    assert.equal(usefulness.tone, 'high')
    assert.equal(usefulness.label, '22%')
    assert.equal(usefulness.percentage, 22)
})

test('getFeedItemUsefulness handles zone boundaries predictably', async () => {
    const {domain: belowMediumDomain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.07,
            baselineCtr: 0.1,
        }),
    )
    const {domain: aboveMediumDomain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.08,
            baselineCtr: 0.1,
        }),
    )
    const {domain: belowHighDomain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.18,
            baselineCtr: 0.1,
        }),
    )
    const {domain: aboveHighDomain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.2,
            baselineCtr: 0.1,
        }),
    )

    assert.equal(
        belowMediumDomain.getFeedItemUsefulness({
            source: 'Boundary source',
            link: 'https://example.com/below-medium',
            title: 'Below medium boundary',
        }).tone,
        'low',
    )
    assert.equal(
        aboveMediumDomain.getFeedItemUsefulness({
            source: 'Boundary source',
            link: 'https://example.com/above-medium',
            title: 'Above medium boundary',
        }).tone,
        'medium',
    )
    assert.equal(
        belowHighDomain.getFeedItemUsefulness({
            source: 'Boundary source',
            link: 'https://example.com/below-high',
            title: 'Below high boundary',
        }).tone,
        'medium',
    )
    assert.equal(
        aboveHighDomain.getFeedItemUsefulness({
            source: 'Boundary source',
            link: 'https://example.com/above-high',
            title: 'Above high boundary',
        }).tone,
        'high',
    )
})

test('getFeedItemUsefulness caps a single negative factor impact', async () => {
    const {domain} = await loadFreshDomainModule(
        createPublishedScorerState({
            probability: 0.5,
            baselineCtr: 0.1,
            weights: {
                'source:trusted': -6,
            },
        }),
    )

    const unaffected = domain.getFeedItemUsefulness({
        source: 'Neutral',
        link: 'https://example.com/neutral',
        title: 'Good headline',
    })
    const penalized = domain.getFeedItemUsefulness({
        source: 'Trusted',
        link: 'https://example.com/penalized',
        title: 'Good headline',
    })

    assert.equal(unaffected.tone, 'high')
    assert.equal(penalized.tone, 'medium')
    assert.ok(penalized.percentage >= 14)
})

test('retraining is deterministic for the same interaction log', async () => {
    const now = Date.parse('2026-03-09T12:00:00.000Z')
    const events = []

    for (let index = 0; index < 24; index += 1) {
        const recordedAt = now - (24 - index) * 60 * 60 * 1000
        const itemKey = `item-${index}`
        const baseEvent = createInteractionEvent({
            type: 'impression',
            itemKey,
            recordedAt: recordedAt - 5000,
            title: index % 2 === 0 ? 'AI agent benchmark' : 'Market outlook',
            link: `https://example.com/${itemKey}`,
        })
        events.push(baseEvent)
        events.push(
            createInteractionEvent({
                type: index % 2 === 0 ? 'click' : 'dismiss',
                itemKey,
                recordedAt,
                title: baseEvent.snapshot.title,
                link: baseEvent.snapshot.link,
            }),
        )
    }

    const initialState = createBaseState({
        modelState: {
            schemaVersion: MODEL_STATE_SCHEMA_VERSION,
            modelVersion: 1,
            interactionLog: events,
            modelArtifacts: {},
            calibrationArtifacts: {},
        },
    })

    const first = await withMockedNow(now, async () => {
        const {domain} = await loadFreshDomainModule(initialState)
        return domain.getState().modelState
    })
    const second = await withMockedNow(now, async () => {
        const {domain} = await loadFreshDomainModule(initialState)
        return domain.getState().modelState
    })

    assert.deepEqual(first.modelArtifacts, second.modelArtifacts)
    assert.deepEqual(first.calibrationArtifacts, second.calibrationArtifacts)
})

test('exportState includes model data and synchronizes artifacts before export', async () => {
    const now = Date.parse('2026-03-09T12:00:00.000Z')
    const initialState = createBaseState({
        modelState: {
            schemaVersion: MODEL_STATE_SCHEMA_VERSION,
            modelVersion: 1,
            interactionLog: [
                createInteractionEvent({
                    type: 'click',
                    itemKey: 'item-1',
                    recordedAt: now,
                }),
            ],
            modelArtifacts: {},
            calibrationArtifacts: {},
        },
    })

    const {domain} = await withMockedNow(now, async () => {
        return await loadFreshDomainModule(initialState)
    })

    const exported = domain.exportState()

    assert.equal(Array.isArray(exported.modelState.interactionLog), true)
    assert.equal(exported.modelState.interactionLog.length, 1)
    assert.equal(exported.modelState.modelArtifacts.totalLabeledSamples, 1)
    assert.deepEqual(exported.clickedItemKeys, [])
    assert.deepEqual(exported.dismissedItemKeys, [])
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
            autoRefreshFeeds: true,
            showFavoritesColumn: true,
        },
    })

    assert.equal(importResult.ok, true)

    const exported = domain.exportState()
    assert.equal(exported.folders.length, 1)
    assert.equal(exported.folders[0].feeds.length, 1)
    assert.equal(exported.folders[0].feeds[0].url, 'https://example.com/rss')
    assert.equal(exported.settings.autoMarkReadOnScroll, true)
    assert.equal(exported.settings.autoRefreshFeeds, true)
    assert.equal(exported.settings.showFavoritesColumn, true)
})

test('setAutoRefreshFeeds persists auto refresh preference', async () => {
    const {domain, localStorage} = await loadFreshDomainModule()

    domain.setAutoRefreshFeeds(true)

    assert.equal(domain.shouldAutoRefreshFeeds(), true)
    assert.equal(getStoredState(localStorage).settings.autoRefreshFeeds, true)
})

test('setShowFavoritesColumn persists favorites column preference', async () => {
    const {domain, localStorage} = await loadFreshDomainModule()

    domain.setShowFavoritesColumn(true)

    assert.equal(domain.shouldShowFavoritesColumn(), true)
    assert.equal(getStoredState(localStorage).settings.showFavoritesColumn, true)
})

test('resetState restores defaults from storage', async () => {
    const {domain} = await loadFreshDomainModule()

    domain.createFolder('Temporary')
    domain.registerFeedItemClick({
        itemKey: 'temporary-item',
        feedId: 'feed-1',
        source: 'Temporary',
        title: 'Temporary item',
        link: 'https://example.com/temp',
    })
    assert.equal(domain.getState().folders.length, 1)
    assert.equal(domain.getState().clickedItemKeys.length, 1)

    domain.resetState()
    assert.deepEqual(domain.getState().folders, [])
    assert.deepEqual(domain.getState().visitedItemKeys, [])
    assert.deepEqual(domain.getState().clickedItemKeys, [])
    assert.deepEqual(domain.getState().modelState.interactionLog, [])
})
