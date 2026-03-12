import test from 'node:test'
import assert from 'node:assert/strict'

import {
    createDefaultState,
    normalizeClickedItemKeys,
    normalizeModelState,
    normalizeStatePayload,
    normalizeVisitedItemKeys,
} from '../../src/scripts/state-normalizers.js'
import {
    MAX_CLICKED_ITEMS,
    MAX_MODEL_EVENTS,
    MAX_VISITED_ITEMS,
    MODEL_STATE_SCHEMA_VERSION,
} from '../../src/scripts/constants.js'

test('createDefaultState returns complete base shape', () => {
    const state = createDefaultState()

    assert.deepEqual(state.folders, [])
    assert.equal(state.lastUpdated, null)
    assert.deepEqual(state.settings, {
        autoMarkReadOnScroll: false,
    })
    assert.deepEqual(state.visitedItemKeys, [])
    assert.deepEqual(state.clickedItemKeys, [])
    assert.deepEqual(state.modelState, {
        schemaVersion: MODEL_STATE_SCHEMA_VERSION,
        modelVersion: 1,
        interactionLog: [],
        modelArtifacts: {
            trainedAt: null,
            totalLabeledSamples: 0,
            trainingSize: 0,
            holdoutSize: 0,
            positiveSamples: 0,
            explicitNegativeSamples: 0,
            weakNegativeSamples: 0,
            baselineCtr: null,
            bias: 0,
            weights: {},
            topFeatures: [],
        },
        calibrationArtifacts: {
            ready: false,
            trainedAt: null,
            slope: 1,
            intercept: 0,
            holdoutSize: 0,
            metrics: {
                prAuc: null,
                logLoss: null,
                brier: null,
                ece: null,
                baselineCtr: null,
                bucketCtrs: [],
            },
        },
        publishedModelArtifacts: {
            trainedAt: null,
            totalLabeledSamples: 0,
            trainingSize: 0,
            holdoutSize: 0,
            positiveSamples: 0,
            explicitNegativeSamples: 0,
            weakNegativeSamples: 0,
            baselineCtr: null,
            bias: 0,
            weights: {},
            topFeatures: [],
        },
        publishedCalibrationArtifacts: {
            ready: false,
            trainedAt: null,
            slope: 1,
            intercept: 0,
            holdoutSize: 0,
            metrics: {
                prAuc: null,
                logLoss: null,
                brier: null,
                ece: null,
                baselineCtr: null,
                bucketCtrs: [],
            },
        },
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

test('normalizeModelState sanitizes interaction log and ignores invalid schema', () => {
    const invalidSchema = normalizeModelState({
        schemaVersion: 999,
        interactionLog: [
            {
                type: 'click',
                itemKey: 'item-1',
                recordedAt: Date.now(),
            },
        ],
    })
    assert.deepEqual(invalidSchema.interactionLog, [])

    const now = Date.now()
    const interactionLog = Array.from({length: MAX_MODEL_EVENTS + 5}, (_, index) => ({
        type: index % 3 === 0 ? 'impression' : index % 3 === 1 ? 'click' : 'dismiss',
        itemKey: `item-${index}`,
        recordedAt: now + index,
        snapshot: {
            source: 'Tech',
            feedId: 'feed-1',
            title: 'AI release notes',
            link: `https://example.com/${index}`,
            publishedAt: new Date(now).toISOString(),
        },
    }))

    const normalized = normalizeModelState({
        schemaVersion: MODEL_STATE_SCHEMA_VERSION,
        interactionLog: [
            ...interactionLog,
            {
                type: 'bad',
                itemKey: '',
                recordedAt: 0,
                snapshot: null,
            },
        ],
        modelArtifacts: {
            bias: 99,
            weights: {
                useful: 0.5,
                bad: 'not-a-number',
            },
        },
        calibrationArtifacts: {
            ready: true,
            slope: 10,
            intercept: -99,
            metrics: {
                ece: 9,
            },
        },
        publishedModelArtifacts: {
            bias: -12,
            weights: {
                stable: 0.75,
            },
        },
        publishedCalibrationArtifacts: {
            ready: true,
            slope: 12,
            intercept: -12,
            metrics: {
                ece: 0.03,
            },
        },
    })

    assert.equal(normalized.schemaVersion, MODEL_STATE_SCHEMA_VERSION)
    assert.equal(normalized.interactionLog.length, MAX_MODEL_EVENTS)
    assert.equal(normalized.interactionLog[0].itemKey, 'item-5')
    assert.equal(normalized.modelArtifacts.bias, 6)
    assert.equal(normalized.modelArtifacts.weights.useful, 0.5)
    assert.equal(normalized.calibrationArtifacts.ready, true)
    assert.equal(normalized.calibrationArtifacts.slope, 4)
    assert.equal(normalized.calibrationArtifacts.intercept, -8)
    assert.equal(normalized.calibrationArtifacts.metrics.ece, 1)
    assert.equal(normalized.publishedModelArtifacts.bias, -6)
    assert.equal(normalized.publishedModelArtifacts.weights.stable, 0.75)
    assert.equal(normalized.publishedCalibrationArtifacts.ready, true)
    assert.equal(normalized.publishedCalibrationArtifacts.slope, 4)
    assert.equal(normalized.publishedCalibrationArtifacts.intercept, -8)
    assert.equal(normalized.publishedCalibrationArtifacts.metrics.ece, 0.03)
})

test('normalizeStatePayload sanitizes malformed payload and drops legacy scorer fields', () => {
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
        ],
        lastUpdated: 'not-a-date',
        settings: {
            autoMarkReadOnScroll: 'yes',
            useClickModelV2: true,
        },
        visitedItemKeys: ['a', 'a', 'b'],
        clickedItemKeys: ['x', 'x', 'y'],
        clickModel: {totalClicks: 1},
        clickModelV2: {schemaVersion: 2},
    }

    const normalized = normalizeStatePayload(rawState)

    assert.ok(normalized)
    assert.equal(normalized.folders.length, 1)
    assert.equal(normalized.folders[0].feeds.length, 1)
    assert.equal(normalized.folders[0].feeds[0].url, 'https://news.ycombinator.com/rss')
    assert.equal(normalized.lastUpdated, null)
    assert.deepEqual(normalized.settings, {
        autoMarkReadOnScroll: true,
    })
    assert.deepEqual(normalized.visitedItemKeys, ['a', 'b'])
    assert.deepEqual(normalized.clickedItemKeys, ['x', 'y'])
    assert.deepEqual(normalized.modelState.interactionLog, [])
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
