import test from 'node:test'
import assert from 'node:assert/strict'
import {
    CLICK_METADATA_DIMENSIONS,
    CLICK_WORD_BUCKETS,
    buildClickFeatures,
    trainClickModel,
    predictClickProbability,
} from '../../src/scripts/click-model.js'

test('dense representation preserves every signed coordinate, including coordinates after 28', () => {
    const embedding = new Array(64).fill(0)
    embedding[0] = 3
    embedding[63] = -4
    const features = buildClickFeatures({title: 'Тест'}, {}, embedding)
    assert.equal(features.length, CLICK_METADATA_DIMENSIONS + 64)
    assert.equal(features[CLICK_METADATA_DIMENSIONS], 0.6)
    assert.equal(features.at(-1), -0.8)
    assert.equal(embedding[0], 3)
    const extreme = buildClickFeatures({}, {}, [
        Number.MAX_VALUE,
        -Number.MAX_VALUE,
    ])
    assert.ok(extreme.every(Number.isFinite))
})

test('baseline hashes Russian and English text deterministically without changing metadata', () => {
    const snapshot = {
        title: 'Умный дом Home Assistant',
        description: 'Новая версия',
        feedId: 'feed',
    }
    const context = {
        ageMs: 5000,
        position: 4,
        columnType: 'recommended',
        hour: 14,
    }
    const baseline = buildClickFeatures(snapshot, context)
    const dense = buildClickFeatures(snapshot, context, [1, 0])
    assert.equal(
        baseline.length,
        CLICK_METADATA_DIMENSIONS + CLICK_WORD_BUCKETS,
    )
    assert.deepEqual(
        baseline.slice(0, CLICK_METADATA_DIMENSIONS),
        dense.slice(0, CLICK_METADATA_DIMENSIONS),
    )
    assert.deepEqual(buildClickFeatures(snapshot, context), baseline)
    assert.ok(
        baseline.slice(CLICK_METADATA_DIMENSIONS).some((value) => value > 0),
    )
    assert.ok(baseline.every(Number.isFinite))
})

test('exposure-time age and dismiss context are frozen inputs, with distinct missing indicators', () => {
    const snapshot = {title: 'A', publishedAt: new Date(0)}
    const features = buildClickFeatures(snapshot, {
        firstShownAt: 86400000,
        dismissSimilarity: 0,
    })
    assert.equal(features[0], 1 / 90)
    assert.equal(features[2], 1)
    assert.equal(features[13], 0)
    assert.equal(features[14], 1)
    const unknown = buildClickFeatures({publishedAt: {toString: null}}, {})
    assert.equal(unknown[2], 0)
    assert.equal(unknown[14], 0)
    assert.ok(unknown.every(Number.isFinite))
    assert.deepEqual(
        buildClickFeatures(snapshot, {
            firstShownAt: 86400000,
            dismissSimilarity: 0,
        }),
        features,
    )
})

test('unweighted logistic fit learns a signed semantic decision deterministically', () => {
    const rows = [
        {features: [-1, 0], outcome: 0},
        {features: [-0.8, 0.1], outcome: 0},
        {features: [1, 0], outcome: 1},
        {features: [0.8, -0.1], outcome: 1},
    ]
    const model = trainClickModel(rows)
    assert.ok(predictClickProbability(model, [1, 0]) > 0.8)
    assert.ok(predictClickProbability(model, [-1, 0]) < 0.2)
    assert.deepEqual(trainClickModel(rows), model)
    assert.deepEqual(
        trainClickModel(
            rows.map((row, index) => ({...row, weight: index ? 0.001 : 10000})),
        ),
        model,
    )
    assert.equal(Object.hasOwn(model, 'ready'), false)
})

test('constant features learn the natural CTR instead of balancing rare clicks', () => {
    const rows = Array.from({length: 100}, (_, index) => ({
        features: [0],
        outcome: index < 10 ? 1 : 0,
    }))
    const model = trainClickModel(rows, {epochs: 300})
    const probability = predictClickProbability(model, [0])
    assert.ok(Math.abs(probability - 0.1) < 0.002)
    assert.equal(model.positiveCount, 10)
    assert.equal(model.negativeCount, 90)
    assert.equal(model.sampleCount, 100)
})

test('regularization constrains overconfident fits without penalizing the prior bias', () => {
    const rows = [
        {features: [-1], outcome: 0},
        {features: [1], outcome: 1},
    ]
    const weak = trainClickModel(rows, {l2: 0, epochs: 200})
    const strong = trainClickModel(rows, {l2: 1, epochs: 200})
    assert.ok(Math.abs(strong.weights[0]) < Math.abs(weak.weights[0]))
    const negatives = trainClickModel([{features: [0], outcome: 0}])
    const positives = trainClickModel([{features: [0], outcome: 1}])
    assert.ok(predictClickProbability(negatives, [0]) < 0.5)
    assert.ok(predictClickProbability(positives, [0]) > 0.5)
    assert.ok(Number.isFinite(negatives.bias))
    assert.ok(Number.isFinite(positives.bias))
    assert.equal(predictClickProbability(trainClickModel([]), [0]), null)
})

test('invalid or incompatible inputs cannot yield a numeric forecast', () => {
    for (const embedding of [[], [NaN], [Infinity], ['1']])
        assert.throws(() => buildClickFeatures({}, {}, embedding), TypeError)
    assert.throws(
        () => trainClickModel([{features: [1], outcome: null}]),
        TypeError,
    )
    assert.throws(
        () =>
            trainClickModel([
                {features: [1], outcome: 1},
                {features: [1, 2], outcome: 0},
            ]),
        RangeError,
    )
    assert.throws(() => trainClickModel([], {learningRate: 0}), RangeError)
    assert.throws(() => trainClickModel([], {epochs: 0}), RangeError)
    assert.throws(() => trainClickModel([], {l2: -1}), RangeError)
    const model = trainClickModel([{features: [0], outcome: 1}])
    assert.equal(
        predictClickProbability({...model, schemaVersion: 99}, [0]),
        null,
    )
    assert.equal(
        predictClickProbability({...model, featureVersion: 'different'}, [0]),
        null,
    )
    assert.equal(predictClickProbability(model, [0, 0]), null)
    assert.equal(predictClickProbability(model, [NaN]), null)
    assert.equal(predictClickProbability({...model, bias: Infinity}, [0]), null)
    assert.equal(
        predictClickProbability(JSON.parse(JSON.stringify(model)), [0]),
        predictClickProbability(model, [0]),
    )
})
