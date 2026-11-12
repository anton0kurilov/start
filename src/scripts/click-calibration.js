import {
    CLICK_WINDOW_MS,
    getEligibleClickObservations,
    normalizeClickObservation,
} from './click-observations.js'

const DEFAULT_BOUNDARIES = Array.from({length: 11}, (_, index) => index / 10)
const LOG_EPSILON = 1e-15

// Diagnostic metrics only. None of these values authorizes publishing a model.
// In particular, low Brier loss alone does not establish calibration quality.
export function evaluateClickProbabilities(
    observations,
    {predictionKey = '', now = NaN, boundaries = DEFAULT_BOUNDARIES} = {},
) {
    requireTime(now)
    if (typeof predictionKey !== 'string' || !predictionKey)
        throw new TypeError('A prediction key is required')
    validateBoundaries(boundaries)
    const {eligible, invalidCount} = eligibleRows(observations, now)
    const bins = boundaries.slice(0, -1).map((lower, index) => ({
        lower,
        upper: boundaries[index + 1],
        count: 0,
        positiveCount: 0,
        probabilitySum: 0,
    }))
    let count = 0
    let positiveCount = 0
    let probabilitySum = 0
    let brierSum = 0
    let logLossSum = 0
    for (const row of eligible) {
        const probability = row.predictions[predictionKey]
        if (!validProbability(probability)) continue
        const label = row.outcome
        count++
        positiveCount += label
        probabilitySum += probability
        brierSum += (probability - label) ** 2
        const clipped = Math.min(
            1 - LOG_EPSILON,
            Math.max(LOG_EPSILON, probability),
        )
        logLossSum -= label ? Math.log(clipped) : Math.log1p(-clipped)
        const index = bins.findIndex(
            (bin, index) =>
                probability >= bin.lower &&
                (probability < bin.upper || index === bins.length - 1),
        )
        const bin = bins[index]
        bin.count++
        bin.positiveCount += label
        bin.probabilitySum += probability
    }
    const calibrationBins = bins.map((bin) => ({
        lower: bin.lower,
        upper: bin.upper,
        count: bin.count,
        positiveCount: bin.positiveCount,
        meanProbability: bin.count ? bin.probabilitySum / bin.count : null,
        observedCtr: bin.count ? bin.positiveCount / bin.count : null,
    }))
    const observedCtr = count ? positiveCount / count : null
    const meanProbability = count ? probabilitySum / count : null
    return {
        eligibleCount: eligible.length,
        invalidCount,
        count,
        missingCount: eligible.length - count,
        coverage: eligible.length ? count / eligible.length : 0,
        positiveCount,
        allObservedCtr: eligible.length
            ? eligible.reduce((sum, row) => sum + row.outcome, 0) /
              eligible.length
            : null,
        observedCtr,
        meanProbability,
        meanError: count ? meanProbability - observedCtr : null,
        brier: count ? brierSum / count : null,
        logLoss: count ? logLossSum / count : null,
        ece: count
            ? calibrationBins.reduce(
                  (sum, bin) =>
                      bin.count
                          ? sum +
                            (bin.count / count) *
                                Math.abs(bin.meanProbability - bin.observedCtr)
                          : sum,
                  0,
              )
            : null,
        bins: calibrationBins,
    }
}

// Window boundaries are exposure timestamps, not outcome timestamps. The
// embargo lets all labels from the preceding window mature before the next
// window starts. Cutoffs can be pinned before collecting the final test set.
export function splitClickObservations(
    observations,
    {
        now,
        trainFraction = 0.6,
        calibrationFraction = 0.2,
        embargoMs = CLICK_WINDOW_MS,
        trainEndAt,
        calibrationEndAt,
    } = {},
) {
    requireTime(now)
    if (!Number.isSafeInteger(embargoMs) || embargoMs < CLICK_WINDOW_MS)
        throw new RangeError(
            'Embargo must be at least the 24 hour target window',
        )
    if (
        !Number.isFinite(trainFraction) ||
        !Number.isFinite(calibrationFraction) ||
        trainFraction <= 0 ||
        calibrationFraction <= 0 ||
        trainFraction + calibrationFraction >= 1
    )
        throw new RangeError('Invalid chronological window fractions')
    const {eligible, invalidCount} = eligibleRows(observations, now)
    eligible.sort(
        (left, right) =>
            left.firstShownAt - right.firstShownAt ||
            left.observationId.localeCompare(right.observationId),
    )
    const startAt = eligible[0]?.firstShownAt ?? 0
    const endAt = eligible.at(-1)?.firstShownAt + 1 || startAt
    const span = endAt - startAt
    const trainEnd = trainEndAt ?? startAt + Math.floor(span * trainFraction)
    const calibrationEnd =
        calibrationEndAt ??
        startAt + Math.floor(span * (trainFraction + calibrationFraction))
    requireTime(trainEnd)
    requireTime(calibrationEnd)
    if (calibrationEnd < trainEnd)
        throw new RangeError('Calibration must follow training')
    const calibrationStart = trainEnd + embargoMs
    const testStart = calibrationEnd + embargoMs
    requireTime(calibrationStart)
    requireTime(testStart)
    const training = []
    const calibration = []
    const test = []
    const embargo = []
    for (const row of eligible) {
        if (row.firstShownAt < trainEnd && row.deadlineAt <= calibrationStart)
            training.push(row)
        else if (
            row.firstShownAt >= calibrationStart &&
            row.firstShownAt < calibrationEnd &&
            row.deadlineAt <= testStart
        )
            calibration.push(row)
        else if (row.firstShownAt >= testStart) test.push(row)
        else embargo.push(row)
    }
    return {
        training,
        calibration,
        test,
        embargo,
        invalidCount,
        eligibleCount: eligible.length,
        cutoffs: {
            trainEndAt: trainEnd,
            calibrationStartAt: calibrationStart,
            calibrationEndAt: calibrationEnd,
            testStartAt: testStart,
        },
        classes: {
            training: countClasses(training),
            calibration: countClasses(calibration),
            test: countClasses(test),
        },
    }
}

function eligibleRows(observations, now) {
    const valid = []
    let invalidCount = 0
    const ids = new Set()
    const items = new Set()
    for (const input of Array.isArray(observations) ? observations : []) {
        const row = normalizeClickObservation(input)
        const itemIdentity = row && JSON.stringify([row.profileId, row.itemKey])
        if (!row || ids.has(row.observationId) || items.has(itemIdentity)) {
            invalidCount++
            continue
        }
        ids.add(row.observationId)
        items.add(itemIdentity)
        valid.push(row)
    }
    return {eligible: getEligibleClickObservations(valid, now), invalidCount}
}

function countClasses(rows) {
    const positive = rows.reduce((sum, row) => sum + row.outcome, 0)
    return {positive, negative: rows.length - positive}
}

function validProbability(value) {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
    )
}

function requireTime(value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new RangeError('A non-negative safe timestamp is required')
}

function validateBoundaries(boundaries) {
    if (
        !Array.isArray(boundaries) ||
        boundaries.length < 2 ||
        boundaries[0] !== 0 ||
        boundaries.at(-1) !== 1 ||
        boundaries.some(
            (value, index) =>
                !validProbability(value) ||
                (index > 0 && value <= boundaries[index - 1]),
        )
    )
        throw new RangeError('Calibration boundaries must increase from 0 to 1')
}
