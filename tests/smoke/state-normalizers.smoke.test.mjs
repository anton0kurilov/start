import test from 'node:test'
import assert from 'node:assert/strict'

import {
    createDefaultState,
    normalizeClickModel,
    normalizeClickModelV2,
    normalizeClickedItemKeys,
    normalizeStatePayload,
    normalizeVisitedItemKeys,
} from '../../src/scripts/state-normalizers.js'
import {
    CLICK_MODEL_V2_SCHEMA_VERSION,
    CLICK_MODEL_V2_DIMENSION,
    MAX_CLICKED_ITEMS,
    MAX_VISITED_ITEMS,
} from '../../src/scripts/constants.js'

test('createDefaultState returns complete base shape', () => {
    const state = createDefaultState()

    assert.deepEqual(state.folders, [])
    assert.equal(state.lastUpdated, null)
    assert.deepEqual(state.settings, {
        autoMarkReadOnScroll: false,
        useClickModelV2: false,
    })
    assert.deepEqual(state.visitedItemKeys, [])
    assert.deepEqual(state.clickedItemKeys, [])
    assert.deepEqual(state.clickModel, {
        totalClicks: 0,
        sourceCounts: {},
        sourceHostCounts: {},
        hostCounts: {},
        tokenCounts: {},
    })
    assert.deepEqual(state.clickModelV2, {
        schemaVersion: CLICK_MODEL_V2_SCHEMA_VERSION,
        totalEvents: 0,
        positiveEvents: 0,
        negativeEvents: 0,
        bias: 0,
        weights: {},
        gradSquares: {},
        pendingImpressions: {},
    })
})

test('normalizeVisitedItemKeys deduplicates and trims to limit', () => {
    const input = ['a', 'a', 'b', 'c', 'd']
    const normalized = normalizeVisitedItemKeys(input, 3)
    assert.deepEqual(normalized, ['b', 'c', 'd'])
})

test('normalizeClickedItemKeys uses dedicated clicked limit', () => {
    const input = Array.from(
        {length: MAX_CLICKED_ITEMS + 2},
        (_, index) => `item-${index}`,
    )
    const normalized = normalizeClickedItemKeys(input)

    assert.equal(normalized.length, MAX_CLICKED_ITEMS)
    assert.equal(normalized[0], 'item-2')
    assert.equal(normalized.at(-1), `item-${MAX_CLICKED_ITEMS + 1}`)
})

test('normalizeClickModel aggregates noisy counters and trims maps', () => {
    const normalized = normalizeClickModel({
        totalClicks: 3.6,
        sourceCounts: {
            Tech: 2,
            tech: 3,
            '': 100,
            bad: -1,
        },
        sourceHostCounts: {
            'Tech||example.com': 1,
            'tech||EXAMPLE.com': 2,
        },
        hostCounts: {
            'example.com': 2.1,
            'EXAMPLE.COM': 0.8,
        },
        tokenCounts: {
            javascript: 5,
            release: 0,
        },
    })

    assert.equal(normalized.totalClicks, 4)
    assert.equal(normalized.sourceCounts.tech, 5)
    assert.equal(normalized.sourceHostCounts['tech||example.com'], 3)
    assert.equal(normalized.hostCounts['example.com'], 3)
    assert.equal(normalized.tokenCounts.javascript, 5)
    assert.equal(normalized.tokenCounts.release, undefined)
})

test('normalizeClickModelV2 sanitizes sparse weights and pending impressions', () => {
    const normalized = normalizeClickModelV2({
        schemaVersion: CLICK_MODEL_V2_SCHEMA_VERSION,
        totalEvents: 2,
        positiveEvents: 1,
        negativeEvents: 1,
        bias: 9,
        weights: {
            1: 0.5,
            2: -1.2,
            bad: 3,
            [CLICK_MODEL_V2_DIMENSION + 1]: 10,
        },
        gradSquares: {
            1: 2.5,
            2: -3,
            bad: 100,
        },
        pendingImpressions: {
            'item-1': {
                createdAt: Date.now(),
                features: [
                    [1, 0.7],
                    [2, 0.3],
                    ['bad', 1],
                ],
            },
            '': {
                createdAt: Date.now(),
                features: [[3, 1]],
            },
        },
    })

    assert.equal(normalized.schemaVersion, CLICK_MODEL_V2_SCHEMA_VERSION)
    assert.equal(normalized.totalEvents, 2)
    assert.equal(normalized.bias, 6)
    assert.equal(normalized.weights[1], 0.5)
    assert.equal(normalized.weights[2], -1.2)
    assert.equal(normalized.weights.bad, undefined)
    assert.equal(normalized.gradSquares[1], 2.5)
    assert.equal(normalized.gradSquares[2], undefined)
    assert.equal(Object.keys(normalized.pendingImpressions).length, 1)
    assert.equal(normalized.pendingImpressions['item-1'].features.length, 2)
})

test('normalizeStatePayload sanitizes malformed payload', () => {
    const rawState = {
        folders: [
            {
                id: 'folder-1',
                name: 'Tech',
                feeds: [
                    {id: 'feed-1', name: 'HN', url: 'news.ycombinator.com/rss'},
                    {id: 'feed-1', name: 'Broken', url: ''},
                ],
            },
            null,
            {
                id: 'folder-2',
                name: '   ',
                feeds: [],
            },
        ],
        lastUpdated: 'not-a-date',
        settings: {autoMarkReadOnScroll: 'yes'},
        visitedItemKeys: ['a', 'a', 'b'],
        clickedItemKeys: ['x', 'x', 'y'],
        clickModel: {totalClicks: 1},
    }

    const normalized = normalizeStatePayload(rawState)

    assert.ok(normalized)
    assert.equal(normalized.folders.length, 1)
    assert.equal(normalized.folders[0].feeds.length, 1)
    assert.equal(normalized.folders[0].feeds[0].url, 'https://news.ycombinator.com/rss')
    assert.equal(normalized.lastUpdated, null)
    assert.deepEqual(normalized.settings, {
        autoMarkReadOnScroll: true,
        useClickModelV2: false,
    })
    assert.deepEqual(normalized.visitedItemKeys, ['a', 'b'])
    assert.deepEqual(normalized.clickedItemKeys, ['x', 'y'])
})

test('normalizeVisitedItemKeys falls back to MAX_VISITED_ITEMS for bad limit', () => {
    const input = Array.from(
        {length: MAX_VISITED_ITEMS + 1},
        (_, index) => `visited-${index}`,
    )
    const normalized = normalizeVisitedItemKeys(input, 0)

    assert.equal(normalized.length, MAX_VISITED_ITEMS)
    assert.equal(normalized[0], 'visited-1')
})
