import test from 'node:test'
import assert from 'node:assert/strict'
import {
    CLICK_WINDOW_MS,
    createClickObservation,
    recordObservationClick,
} from '../../src/scripts/click-observations.js'
import {
    evaluateClickProbabilities,
    splitClickObservations,
} from '../../src/scripts/click-calibration.js'

const DAY = CLICK_WINDOW_MS

function row(id, firstShownAt, outcome, probability) {
    const input = createClickObservation({
        observationId: String(id),
        profileId: 'profile',
        itemKey: String(id),
        firstShownAt,
        predictions: {baseline: probability},
    })
    return outcome === 1
        ? recordObservationClick([input], {
              profileId: input.profileId,
              itemKey: input.itemKey,
              recordedAt: firstShownAt + 1,
          })[0]
        : input
}

test('probabilistic metrics use natural class counts, ignoring legacy weights', () => {
    const input = [row(1, 0, 1, 0.8), row(2, 0, 0, 0.2)]
    const result = evaluateClickProbabilities(input, {
        predictionKey: 'baseline',
        now: DAY,
    })
    assert.equal(result.count, 2)
    assert.equal(result.coverage, 1)
    assert.ok(Math.abs(result.brier - 0.04) < 1e-12)
    assert.ok(Math.abs(result.logLoss + Math.log(0.8)) < 1e-12)
    assert.equal(result.observedCtr, 0.5)
    assert.equal(result.meanProbability, 0.5)
    assert.equal(result.meanError, 0)
    assert.deepEqual(
        evaluateClickProbabilities(
            input.map((value, i) => ({...value, weight: i ? 0.01 : 2000})),
            {
                predictionKey: 'baseline',
                now: DAY,
            },
        ),
        result,
    )
})

test('coverage reports missing predictions and overall CTR instead of silently selecting easy rows', () => {
    const input = [row(1, 0, 1, 0.5), row(2, 0, 0, null), row(3, DAY, 1, 0.99)]
    const result = evaluateClickProbabilities(input, {
        predictionKey: 'baseline',
        now: DAY,
    })
    assert.equal(result.eligibleCount, 2)
    assert.equal(result.count, 1)
    assert.equal(result.missingCount, 1)
    assert.equal(result.coverage, 0.5)
    assert.equal(result.allObservedCtr, 0.5)
    assert.equal(result.observedCtr, 1)
    assert.equal(input[0].completedAt, null)
})

test('reliability bins are half open, retain empty groups and include probability one', () => {
    const result = evaluateClickProbabilities(
        [row(1, 0, 0, 0), row(2, 0, 1, 0.5), row(3, 0, 1, 1)],
        {predictionKey: 'baseline', now: DAY, boundaries: [0, 0.25, 0.5, 1]},
    )
    assert.deepEqual(
        result.bins.map((bin) => bin.count),
        [1, 0, 2],
    )
    assert.equal(result.bins[1].observedCtr, null)
    assert.equal(result.bins[2].meanProbability, 0.75)
    assert.equal(result.bins[2].observedCtr, 1)
    assert.ok(Number.isFinite(result.logLoss))
    const wrong = evaluateClickProbabilities([row('wrong', 0, 0, 1)], {
        predictionKey: 'baseline',
        now: DAY,
    })
    assert.ok(wrong.logLoss > 30)
})

test('empty and invalid observations cannot produce a successful zero-error report', () => {
    const input = [null, {...row(1, 0, 1, 0.5), schemaVersion: 99}]
    const result = evaluateClickProbabilities(input, {
        predictionKey: 'baseline',
        now: DAY,
    })
    assert.equal(result.invalidCount, 2)
    assert.equal(result.logLoss, null)
    assert.equal(result.brier, null)
    assert.equal(result.ece, null)
    assert.equal(result.coverage, 0)
    const duplicate = row(2, 0, 0, 0.5)
    assert.equal(
        evaluateClickProbabilities([duplicate, duplicate], {
            predictionKey: 'baseline',
            now: DAY,
        }).count,
        1,
    )
})

test('pinned chronological windows discard embargo rows and future outcomes', () => {
    const input = [
        row('train', 0, 1, 0.5),
        row('embargo1', DAY, 0, 0.5),
        row('calibration', 2 * DAY, 0, 0.5),
        row('embargo2', 3 * DAY, 1, 0.5),
        row('test', 4 * DAY, 1, 0.5),
        row('unmatured-positive', 5 * DAY, 1, 0.99),
    ].reverse()
    const split = splitClickObservations(input, {
        now: 5 * DAY,
        trainEndAt: DAY,
        calibrationEndAt: 3 * DAY,
    })
    assert.deepEqual(
        split.training.map((value) => value.itemKey),
        ['train'],
    )
    assert.deepEqual(
        split.calibration.map((value) => value.itemKey),
        ['calibration'],
    )
    assert.deepEqual(
        split.test.map((value) => value.itemKey),
        ['test'],
    )
    assert.deepEqual(
        split.embargo.map((value) => value.itemKey),
        ['embargo1', 'embargo2'],
    )
    assert.deepEqual(split.classes.training, {positive: 1, negative: 0})
    assert.equal(split.eligibleCount, 5)
    assert.equal(input[0].itemKey, 'unmatured-positive')
    assert.ok(
        split.training.every(
            (value) => value.deadlineAt <= split.cutoffs.calibrationStartAt,
        ),
    )
    assert.ok(
        split.calibration.every(
            (value) => value.deadlineAt <= split.cutoffs.testStartAt,
        ),
    )
})

test('default cutoffs partition calendar time rather than randomly shuffling samples', () => {
    const input = [row(1, 0, 0, 0.1), row(2, 10 * DAY - 1, 1, 0.9)]
    const split = splitClickObservations(input, {now: 11 * DAY})
    assert.equal(split.cutoffs.trainEndAt, 6 * DAY)
    assert.equal(split.cutoffs.calibrationStartAt, 7 * DAY)
    assert.equal(split.cutoffs.calibrationEndAt, 8 * DAY)
    assert.equal(split.cutoffs.testStartAt, 9 * DAY)
    assert.equal(split.training[0].itemKey, '1')
    assert.equal(split.test[0].itemKey, '2')
    assert.equal(splitClickObservations([], {now: 0}).eligibleCount, 0)
})

test('invalid clocks, bin boundaries, overlapping windows and short embargo fail explicitly', () => {
    assert.throws(
        () =>
            evaluateClickProbabilities([], {
                predictionKey: 'baseline',
                now: NaN,
            }),
        RangeError,
    )
    assert.throws(() => evaluateClickProbabilities([], {now: 0}), TypeError)
    for (const boundaries of [[0, 0.5, 0.5, 1], [0.1, 1], [0, NaN, 1], [0]]) {
        assert.throws(
            () =>
                evaluateClickProbabilities([], {
                    predictionKey: 'baseline',
                    now: 0,
                    boundaries,
                }),
            RangeError,
        )
    }
    assert.throws(
        () => splitClickObservations([], {now: 0, embargoMs: DAY - 1}),
        RangeError,
    )
    assert.throws(
        () =>
            splitClickObservations([], {
                now: 0,
                trainFraction: 0.9,
                calibrationFraction: 0.2,
            }),
        RangeError,
    )
    assert.throws(
        () =>
            splitClickObservations([], {
                now: 0,
                trainEndAt: 20,
                calibrationEndAt: 10,
            }),
        RangeError,
    )
})
