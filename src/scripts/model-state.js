import {
    MAX_MODEL_EVENTS,
    MAX_MODEL_FEATURES,
    MAX_MODEL_FEATURES_PER_ITEM,
    MODEL_CALIBRATION_EPOCHS,
    MODEL_CALIBRATION_LEARNING_RATE,
    MODEL_MAX_APPROXIMATE_ECE,
    MODEL_EXPLICIT_NEGATIVE_WEIGHT,
    MODEL_IMPRESSION_NEGATIVE_DELAY_MS,
    MODEL_MAX_ACCEPTABLE_ECE,
    MODEL_MAX_ABS_WEIGHT,
    MODEL_MIN_HOLDOUT_SAMPLES,
    MODEL_MIN_SAMPLES_FOR_APPROXIMATE_PERCENT,
    MODEL_MIN_SAMPLES_FOR_PERCENT,
    MODEL_POSITIVE_WEIGHT,
    MODEL_RANKER_EPOCHS,
    MODEL_RANKER_LEARNING_RATE,
    MODEL_RANKER_REGULARIZATION,
    MODEL_RECENCY_HALF_LIFE_MS,
    MODEL_STATE_SCHEMA_VERSION,
    MODEL_VERSION,
    MODEL_WEAK_NEGATIVE_WEIGHT,
} from './constants.js'
import {getHostname} from './utils.js'

const TITLE_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'be',
    'for',
    'from',
    'in',
    'is',
    'it',
    'of',
    'on',
    'or',
    'that',
    'the',
    'to',
    'with',
    'без',
    'в',
    'во',
    'для',
    'и',
    'из',
    'к',
    'как',
    'на',
    'о',
    'об',
    'по',
    'под',
    'при',
    'с',
    'со',
    'что',
    'это',
])

export function createDefaultModelState() {
    return {
        schemaVersion: MODEL_STATE_SCHEMA_VERSION,
        modelVersion: MODEL_VERSION,
        interactionLog: [],
        modelArtifacts: createDefaultModelArtifacts(),
        calibrationArtifacts: createDefaultCalibrationArtifacts(),
        publishedModelArtifacts: createDefaultModelArtifacts(),
        publishedCalibrationArtifacts: createDefaultCalibrationArtifacts(),
    }
}

export function createDefaultModelArtifacts() {
    return {
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
    }
}

export function createDefaultCalibrationArtifacts() {
    return {
        ready: false,
        trainedAt: null,
        slope: 1,
        intercept: 0,
        holdoutSize: 0,
        metrics: createEmptyMetrics(),
    }
}

export function buildModelItemSnapshot(itemMeta) {
    const publishedAt = normalizePublishedAt(itemMeta?.date || itemMeta?.publishedAt)
    return {
        source: normalizeText(itemMeta?.source),
        feedId: normalizeText(itemMeta?.feedId),
        title: normalizeText(itemMeta?.title),
        link: normalizeText(itemMeta?.link),
        publishedAt,
    }
}

export function appendModelEvent(modelState, event) {
    if (!modelState || typeof modelState !== 'object') {
        return false
    }
    const normalizedEvent = normalizeEvent(event)
    if (!normalizedEvent) {
        return false
    }
    const nextLog = Array.isArray(modelState.interactionLog)
        ? [...modelState.interactionLog, normalizedEvent]
        : [normalizedEvent]
    nextLog.sort((left, right) => {
        const recordedAtDelta = left.recordedAt - right.recordedAt
        if (recordedAtDelta !== 0) {
            return recordedAtDelta
        }
        const itemKeyDelta = left.itemKey.localeCompare(right.itemKey)
        if (itemKeyDelta !== 0) {
            return itemKeyDelta
        }
        return left.type.localeCompare(right.type)
    })
    modelState.interactionLog = nextLog.slice(-MAX_MODEL_EVENTS)
    return true
}

export function rebuildModelState(modelState, now = Date.now()) {
    if (!modelState || typeof modelState !== 'object') {
        return createDefaultModelState()
    }
    const previousPublishedModelArtifacts = cloneModelArtifacts(
        modelState.publishedModelArtifacts,
    )
    const previousPublishedCalibrationArtifacts = cloneCalibrationArtifacts(
        modelState.publishedCalibrationArtifacts,
    )
    const labeledSamples = buildLabeledSamples(modelState.interactionLog, now)
    const sampleSplit = splitLabeledSamples(labeledSamples)
    const modelArtifacts = trainRanker(sampleSplit.training, sampleSplit.summary, now)
    const calibrationArtifacts = trainCalibrator(
        modelArtifacts,
        sampleSplit.holdout,
        now,
    )

    modelState.schemaVersion = MODEL_STATE_SCHEMA_VERSION
    modelState.modelVersion = MODEL_VERSION
    modelState.modelArtifacts = modelArtifacts
    modelState.calibrationArtifacts = calibrationArtifacts
    if (isCalibrationReadyForDisplay(modelArtifacts, calibrationArtifacts)) {
        modelState.publishedModelArtifacts = cloneModelArtifacts(modelArtifacts)
        modelState.publishedCalibrationArtifacts = cloneCalibrationArtifacts(
            calibrationArtifacts,
        )
    } else {
        modelState.publishedModelArtifacts = previousPublishedModelArtifacts
        modelState.publishedCalibrationArtifacts =
            previousPublishedCalibrationArtifacts
    }
    return modelState
}

export function predictModelProbability(modelState, itemMeta, now = Date.now()) {
    const snapshot = buildModelItemSnapshot(itemMeta)
    const features = buildFeatureVector(snapshot, now)
    const modelArtifacts = modelState?.modelArtifacts || createDefaultModelArtifacts()
    const calibrationArtifacts =
        modelState?.calibrationArtifacts || createDefaultCalibrationArtifacts()
    const rawScore = predictRawScore(modelArtifacts, features)
    const rankingProbability = sigmoid(rawScore)
    const calibratedProbability = calibrationArtifacts.ready
        ? sigmoid(
              calibrationArtifacts.slope * rawScore +
                  calibrationArtifacts.intercept,
          )
        : rankingProbability
    return {
        rawScore,
        rankingProbability,
        probability: calibratedProbability,
    }
}

export function hasPendingWeakNegativeTransitions(modelState, now = Date.now()) {
    const groupedItems = groupEventsByItemKey(modelState?.interactionLog)
    const trainedAt = normalizeTimestamp(modelState?.modelArtifacts?.trainedAt)
    return groupedItems.some((entry) => {
        if (entry.dismissAt || entry.clickAt || !entry.lastImpressionAt) {
            return false
        }
        const weakNegativeAt =
            entry.lastImpressionAt + MODEL_IMPRESSION_NEGATIVE_DELAY_MS
        return weakNegativeAt <= now && (!trainedAt || weakNegativeAt > trainedAt)
    })
}

export function isCalibrationReadyForDisplay(
    modelArtifacts,
    calibrationArtifacts,
) {
    const totalSamples = Number(modelArtifacts?.totalLabeledSamples || 0)
    if (totalSamples < MODEL_MIN_SAMPLES_FOR_PERCENT) {
        return false
    }
    if (!calibrationArtifacts?.ready) {
        return false
    }
    const ece = Number(calibrationArtifacts?.metrics?.ece)
    return Number.isFinite(ece) && ece <= MODEL_MAX_ACCEPTABLE_ECE
}

export function isCalibrationReadyForApproximateDisplay(
    modelArtifacts,
    calibrationArtifacts,
) {
    const totalSamples = Number(modelArtifacts?.totalLabeledSamples || 0)
    if (totalSamples < MODEL_MIN_SAMPLES_FOR_APPROXIMATE_PERCENT) {
        return false
    }
    if (!calibrationArtifacts?.ready) {
        return false
    }
    const ece = Number(calibrationArtifacts?.metrics?.ece)
    return Number.isFinite(ece) && ece <= MODEL_MAX_APPROXIMATE_ECE
}

function normalizeEvent(rawEvent) {
    if (!rawEvent || typeof rawEvent !== 'object') {
        return null
    }
    const type = normalizeEventType(rawEvent.type)
    const itemKey = normalizeText(rawEvent.itemKey)
    const recordedAt = normalizeTimestamp(rawEvent.recordedAt)
    const snapshot = buildModelItemSnapshot(rawEvent.snapshot || rawEvent.item)
    if (!type || !itemKey || !recordedAt) {
        return null
    }
    return {
        type,
        itemKey,
        recordedAt,
        snapshot,
    }
}

function normalizeEventType(value) {
    const eventType = normalizeText(value)
    return ['impression', 'click', 'dismiss'].includes(eventType)
        ? eventType
        : ''
}

function buildLabeledSamples(interactionLog, now) {
    const groupedItems = groupEventsByItemKey(interactionLog)
    const labeledSamples = []

    groupedItems.forEach((entry) => {
        const snapshot = entry.snapshot || buildModelItemSnapshot(null)
        let label = null
        let labelKind = ''
        let labelAt = 0
        let baseWeight = 0

        if (entry.dismissAt) {
            label = 0
            labelKind = 'explicit_negative'
            labelAt = entry.dismissAt
            baseWeight = MODEL_EXPLICIT_NEGATIVE_WEIGHT
        } else if (entry.clickAt) {
            label = 1
            labelKind = 'positive'
            labelAt = entry.clickAt
            baseWeight = MODEL_POSITIVE_WEIGHT
        } else if (
            entry.lastImpressionAt &&
            now - entry.lastImpressionAt >= MODEL_IMPRESSION_NEGATIVE_DELAY_MS
        ) {
            label = 0
            labelKind = 'weak_negative'
            labelAt = entry.lastImpressionAt
            baseWeight = MODEL_WEAK_NEGATIVE_WEIGHT
        }

        if (label === null || !labelAt) {
            return
        }

        const features = buildFeatureVector(snapshot, labelAt)
        if (!features.length) {
            return
        }

        labeledSamples.push({
            itemKey: entry.itemKey,
            label,
            labelKind,
            labelAt,
            weight: baseWeight * computeRecencyWeight(labelAt, now),
            features,
        })
    })

    labeledSamples.sort((left, right) => {
        const labelAtDelta = left.labelAt - right.labelAt
        if (labelAtDelta !== 0) {
            return labelAtDelta
        }
        return left.itemKey.localeCompare(right.itemKey)
    })

    return labeledSamples
}

function splitLabeledSamples(labeledSamples) {
    const summary = {
        totalLabeledSamples: labeledSamples.length,
        positiveSamples: 0,
        explicitNegativeSamples: 0,
        weakNegativeSamples: 0,
        baselineCtr: null,
    }

    let totalWeight = 0
    let positiveWeight = 0
    labeledSamples.forEach((sample) => {
        totalWeight += sample.weight
        if (sample.label) {
            summary.positiveSamples += 1
            positiveWeight += sample.weight
            return
        }
        if (sample.labelKind === 'explicit_negative') {
            summary.explicitNegativeSamples += 1
            return
        }
        summary.weakNegativeSamples += 1
    })

    summary.baselineCtr = totalWeight ? positiveWeight / totalWeight : null

    if (!labeledSamples.length) {
        return {
            summary,
            training: [],
            holdout: [],
        }
    }

    const tentativeHoldoutSize = Math.max(
        MODEL_MIN_HOLDOUT_SAMPLES,
        Math.round(labeledSamples.length * 0.2),
    )
    const holdoutSize =
        labeledSamples.length >= MODEL_MIN_HOLDOUT_SAMPLES * 2
            ? Math.min(
                  tentativeHoldoutSize,
                  labeledSamples.length - MODEL_MIN_HOLDOUT_SAMPLES,
              )
            : 0

    return {
        summary,
        training: holdoutSize
            ? labeledSamples.slice(0, labeledSamples.length - holdoutSize)
            : labeledSamples,
        holdout: holdoutSize
            ? labeledSamples.slice(labeledSamples.length - holdoutSize)
            : [],
    }
}

function trainRanker(trainingSamples, summary, now) {
    const modelArtifacts = createDefaultModelArtifacts()
    modelArtifacts.trainedAt = new Date(now).toISOString()
    modelArtifacts.totalLabeledSamples = summary.totalLabeledSamples
    modelArtifacts.positiveSamples = summary.positiveSamples
    modelArtifacts.explicitNegativeSamples = summary.explicitNegativeSamples
    modelArtifacts.weakNegativeSamples = summary.weakNegativeSamples
    modelArtifacts.baselineCtr = summary.baselineCtr
    modelArtifacts.trainingSize = trainingSamples.length

    if (!trainingSamples.length) {
        return modelArtifacts
    }

    const vocabulary = buildVocabulary(trainingSamples)
    const trainingSet = trainingSamples
        .map((sample) => ({
            ...sample,
            features: sample.features.filter(([featureKey]) =>
                vocabulary.has(featureKey),
            ),
        }))
        .filter((sample) => sample.features.length > 0)

    if (!trainingSet.length) {
        return modelArtifacts
    }

    const positiveWeight = sumSampleWeights(trainingSet, 1)
    const negativeWeight = sumSampleWeights(trainingSet, 0)
    const positiveScale = positiveWeight
        ? clamp(Math.sqrt(negativeWeight / positiveWeight), 1, 3)
        : 1

    const weights = {}
    const gradSquares = {}
    let bias = 0
    let biasGradSquare = 1

    for (let epoch = 0; epoch < MODEL_RANKER_EPOCHS; epoch += 1) {
        trainingSet.forEach((sample) => {
            const effectiveWeight =
                sample.weight * (sample.label ? positiveScale : 1)
            const rawScore = predictRawScore({bias, weights}, sample.features)
            const prediction = sigmoid(rawScore)
            const error = (prediction - sample.label) * effectiveWeight

            const biasGradient =
                error + MODEL_RANKER_REGULARIZATION * bias * 0.25
            biasGradSquare += biasGradient * biasGradient
            bias = clamp(
                bias -
                    (MODEL_RANKER_LEARNING_RATE / Math.sqrt(biasGradSquare)) *
                        biasGradient,
                -MODEL_MAX_ABS_WEIGHT,
                MODEL_MAX_ABS_WEIGHT,
            )

            sample.features.forEach(([featureKey, value]) => {
                const currentWeight = Number(weights[featureKey] || 0)
                const gradient =
                    error * value +
                    MODEL_RANKER_REGULARIZATION * currentWeight
                gradSquares[featureKey] =
                    Number(gradSquares[featureKey] || 1) + gradient * gradient
                const nextWeight = clamp(
                    currentWeight -
                        (MODEL_RANKER_LEARNING_RATE /
                            Math.sqrt(gradSquares[featureKey])) *
                            gradient,
                    -MODEL_MAX_ABS_WEIGHT,
                    MODEL_MAX_ABS_WEIGHT,
                )

                if (Math.abs(nextWeight) < 0.0001) {
                    delete weights[featureKey]
                    return
                }

                weights[featureKey] = nextWeight
            })
        })
    }

    modelArtifacts.bias = bias
    modelArtifacts.weights = weights
    modelArtifacts.topFeatures = Object.entries(weights)
        .sort((left, right) => {
            const absoluteDelta = Math.abs(right[1]) - Math.abs(left[1])
            if (absoluteDelta !== 0) {
                return absoluteDelta
            }
            return left[0].localeCompare(right[0])
        })
        .slice(0, 12)
        .map(([featureKey, weight]) => ({
            featureKey,
            weight,
        }))

    return modelArtifacts
}

function trainCalibrator(modelArtifacts, holdoutSamples, now) {
    const calibrationArtifacts = createDefaultCalibrationArtifacts()
    calibrationArtifacts.trainedAt = new Date(now).toISOString()
    calibrationArtifacts.holdoutSize = holdoutSamples.length

    if (!holdoutSamples.length) {
        return calibrationArtifacts
    }

    const holdoutSet = holdoutSamples.map((sample) => ({
        ...sample,
        rawScore: predictRawScore(modelArtifacts, sample.features),
    }))

    let slope = 1
    let intercept = 0
    let slopeGradSquare = 1
    let interceptGradSquare = 1

    if (holdoutSet.length >= MODEL_MIN_HOLDOUT_SAMPLES) {
        for (let epoch = 0; epoch < MODEL_CALIBRATION_EPOCHS; epoch += 1) {
            holdoutSet.forEach((sample) => {
                const probability = sigmoid(slope * sample.rawScore + intercept)
                const error = (probability - sample.label) * sample.weight
                const slopeGradient = error * sample.rawScore + slope * 0.001
                const interceptGradient = error

                slopeGradSquare += slopeGradient * slopeGradient
                interceptGradSquare += interceptGradient * interceptGradient

                slope = clamp(
                    slope -
                        (MODEL_CALIBRATION_LEARNING_RATE /
                            Math.sqrt(slopeGradSquare)) *
                            slopeGradient,
                    -4,
                    4,
                )
                intercept = clamp(
                    intercept -
                        (MODEL_CALIBRATION_LEARNING_RATE /
                            Math.sqrt(interceptGradSquare)) *
                            interceptGradient,
                    -8,
                    8,
                )
            })
        }

        calibrationArtifacts.ready = true
        calibrationArtifacts.slope = slope
        calibrationArtifacts.intercept = intercept
    }

    calibrationArtifacts.metrics = evaluateCalibrationMetrics(
        holdoutSet,
        calibrationArtifacts.ready ? slope : 1,
        calibrationArtifacts.ready ? intercept : 0,
    )

    return calibrationArtifacts
}

function evaluateCalibrationMetrics(holdoutSet, slope, intercept) {
    if (!holdoutSet.length) {
        return createEmptyMetrics()
    }

    const predictions = holdoutSet.map((sample) => ({
        ...sample,
        probability: sigmoid(slope * sample.rawScore + intercept),
    }))

    return {
        prAuc: computePrAuc(predictions),
        logLoss: computeLogLoss(predictions),
        brier: computeBrierScore(predictions),
        ece: computeExpectedCalibrationError(predictions),
        baselineCtr: computeWeightedLabelAverage(predictions),
        bucketCtrs: computeBucketCtrs(predictions),
    }
}

function buildVocabulary(samples) {
    const featureWeights = {}
    samples.forEach((sample) => {
        sample.features.forEach(([featureKey, value]) => {
            featureWeights[featureKey] =
                (featureWeights[featureKey] || 0) + sample.weight * value
        })
    })

    return new Set(
        Object.entries(featureWeights)
            .sort((left, right) => {
                const weightDelta = right[1] - left[1]
                if (weightDelta !== 0) {
                    return weightDelta
                }
                return left[0].localeCompare(right[0])
            })
            .slice(0, MAX_MODEL_FEATURES)
            .map(([featureKey]) => featureKey),
    )
}

function sumSampleWeights(samples, label) {
    return samples.reduce((total, sample) => {
        return sample.label === label ? total + sample.weight : total
    }, 0)
}

function groupEventsByItemKey(interactionLog) {
    const aggregate = new Map()
    const events = Array.isArray(interactionLog) ? interactionLog : []

    events.forEach((rawEvent) => {
        const event = normalizeEvent(rawEvent)
        if (!event) {
            return
        }
        const current = aggregate.get(event.itemKey) || {
            itemKey: event.itemKey,
            snapshot: event.snapshot,
            lastImpressionAt: 0,
            clickAt: 0,
            dismissAt: 0,
        }

        current.snapshot = mergeSnapshots(current.snapshot, event.snapshot)
        if (event.type === 'impression') {
            current.lastImpressionAt = Math.max(
                current.lastImpressionAt,
                event.recordedAt,
            )
        } else if (event.type === 'click') {
            current.clickAt = Math.max(current.clickAt, event.recordedAt)
        } else if (event.type === 'dismiss') {
            current.dismissAt = Math.max(current.dismissAt, event.recordedAt)
        }

        aggregate.set(event.itemKey, current)
    })

    return Array.from(aggregate.values())
}

function mergeSnapshots(primarySnapshot, secondarySnapshot) {
    const baseSnapshot = primarySnapshot || buildModelItemSnapshot(null)
    const nextSnapshot = secondarySnapshot || buildModelItemSnapshot(null)
    return {
        source: nextSnapshot.source || baseSnapshot.source,
        feedId: nextSnapshot.feedId || baseSnapshot.feedId,
        title: nextSnapshot.title || baseSnapshot.title,
        link: nextSnapshot.link || baseSnapshot.link,
        publishedAt: nextSnapshot.publishedAt || baseSnapshot.publishedAt,
    }
}

function cloneModelArtifacts(modelArtifacts) {
    const base = createDefaultModelArtifacts()
    const next = modelArtifacts && typeof modelArtifacts === 'object'
        ? modelArtifacts
        : {}
    return {
        ...base,
        ...next,
        weights: {...(next.weights || {})},
        topFeatures: Array.isArray(next.topFeatures)
            ? next.topFeatures.map((feature) => ({...feature}))
            : [],
    }
}

function cloneCalibrationArtifacts(calibrationArtifacts) {
    const base = createDefaultCalibrationArtifacts()
    const next =
        calibrationArtifacts && typeof calibrationArtifacts === 'object'
            ? calibrationArtifacts
            : {}
    return {
        ...base,
        ...next,
        metrics: {
            ...base.metrics,
            ...(next.metrics || {}),
            bucketCtrs: Array.isArray(next.metrics?.bucketCtrs)
                ? next.metrics.bucketCtrs.map((bucket) => ({...bucket}))
                : [],
        },
    }
}

function buildFeatureVector(snapshot, referenceTime) {
    const features = {}
    const sourceKey = normalizeText(snapshot?.source).toLowerCase()
    const feedKey = normalizeText(snapshot?.feedId)
    const hostKey = normalizeHostKey(snapshot?.link)
    const sourceHostKey =
        sourceKey && hostKey ? `${sourceKey}||${hostKey}` : ''
    const titleTokens = extractTitleTokens(snapshot?.title)
    const pathTokens = extractPathTokens(snapshot?.link)
    const ageBucket = resolveAgeBucket(snapshot?.publishedAt, referenceTime)

    pushFeature(features, `source:${sourceKey}`, 1)
    pushFeature(features, `feed:${feedKey}`, 0.95)
    pushFeature(features, `host:${hostKey}`, 0.8)
    pushFeature(features, `sourceHost:${sourceHostKey}`, 0.78)
    pushFeature(features, `age:${ageBucket}`, 0.42)

    let unigramWeight = 1
    titleTokens.forEach((token) => {
        pushFeature(features, `title:${token}`, unigramWeight)
        unigramWeight *= 0.9
    })

    let bigramWeight = 0.82
    for (let index = 0; index < titleTokens.length - 1; index += 1) {
        pushFeature(
            features,
            `title2:${titleTokens[index]}_${titleTokens[index + 1]}`,
            bigramWeight,
        )
        bigramWeight *= 0.92
    }

    pathTokens.forEach((token, index) => {
        pushFeature(features, `path:${token}`, Math.max(0.3, 0.55 - index * 0.04))
    })

    return Object.entries(features)
        .sort((left, right) => {
            const weightDelta = right[1] - left[1]
            if (weightDelta !== 0) {
                return weightDelta
            }
            return left[0].localeCompare(right[0])
        })
        .slice(0, MAX_MODEL_FEATURES_PER_ITEM)
        .sort((left, right) => left[0].localeCompare(right[0]))
}

function pushFeature(features, featureKey, value) {
    const normalizedKey = normalizeText(featureKey)
    const normalizedValue = Number(value)
    if (!normalizedKey || !Number.isFinite(normalizedValue) || normalizedValue <= 0) {
        return
    }
    features[normalizedKey] = (features[normalizedKey] || 0) + normalizedValue
}

function extractTitleTokens(value) {
    const text = normalizeText(value)
        .toLowerCase()
        .replace(/[^a-zа-яё0-9\s]/gi, ' ')
    if (!text) {
        return []
    }
    const seen = new Set()
    const tokens = []
    text.split(/\s+/).forEach((token) => {
        const nextToken = token.trim()
        if (
            nextToken.length < 3 ||
            TITLE_STOP_WORDS.has(nextToken) ||
            seen.has(nextToken)
        ) {
            return
        }
        seen.add(nextToken)
        tokens.push(nextToken)
    })
    return tokens.slice(0, 10)
}

function extractPathTokens(link) {
    const url = normalizeText(link)
    if (!url) {
        return []
    }
    try {
        const pathname = new URL(url).pathname
        const seen = new Set()
        const tokens = []
        pathname
            .toLowerCase()
            .replace(/[^a-zа-яё0-9/]/gi, ' ')
            .split(/[\/\s]+/)
            .forEach((token) => {
                const nextToken = token.trim()
                if (
                    nextToken.length < 3 ||
                    TITLE_STOP_WORDS.has(nextToken) ||
                    seen.has(nextToken)
                ) {
                    return
                }
                seen.add(nextToken)
                tokens.push(nextToken)
            })
        return tokens.slice(0, 6)
    } catch (error) {
        return []
    }
}

function resolveAgeBucket(publishedAt, referenceTime) {
    const publishedTimestamp = normalizeTimestamp(publishedAt)
    const referenceTimestamp = normalizeTimestamp(referenceTime) || Date.now()
    if (!publishedTimestamp) {
        return 'unknown'
    }
    const ageMs = Math.max(0, referenceTimestamp - publishedTimestamp)
    if (ageMs < 6 * 60 * 60 * 1000) {
        return '0-6h'
    }
    if (ageMs < 24 * 60 * 60 * 1000) {
        return '6-24h'
    }
    if (ageMs < 3 * 24 * 60 * 60 * 1000) {
        return '1-3d'
    }
    if (ageMs < 7 * 24 * 60 * 60 * 1000) {
        return '3-7d'
    }
    return '7d+'
}

function computeRecencyWeight(labelAt, now) {
    const ageMs = Math.max(0, now - labelAt)
    return Math.pow(0.5, ageMs / MODEL_RECENCY_HALF_LIFE_MS)
}

function predictRawScore(modelArtifacts, features) {
    let rawScore = Number(modelArtifacts?.bias || 0)
    features.forEach(([featureKey, value]) => {
        const weight = Number(modelArtifacts?.weights?.[featureKey] || 0)
        if (!weight) {
            return
        }
        rawScore += weight * value
    })
    return clamp(rawScore, -12, 12)
}

function computePrAuc(predictions) {
    const orderedPredictions = [...predictions].sort((left, right) => {
        const probabilityDelta = right.probability - left.probability
        if (probabilityDelta !== 0) {
            return probabilityDelta
        }
        return left.itemKey.localeCompare(right.itemKey)
    })
    const totalPositiveWeight = orderedPredictions.reduce((total, sample) => {
        return sample.label ? total + sample.weight : total
    }, 0)
    if (!totalPositiveWeight) {
        return null
    }
    let truePositiveWeight = 0
    let falsePositiveWeight = 0
    let previousRecall = 0
    let area = 0

    orderedPredictions.forEach((sample) => {
        if (sample.label) {
            truePositiveWeight += sample.weight
        } else {
            falsePositiveWeight += sample.weight
        }
        const precision =
            truePositiveWeight + falsePositiveWeight
                ? truePositiveWeight / (truePositiveWeight + falsePositiveWeight)
                : 0
        const recall = truePositiveWeight / totalPositiveWeight
        area += precision * Math.max(0, recall - previousRecall)
        previousRecall = recall
    })

    return area
}

function computeLogLoss(predictions) {
    let totalWeight = 0
    let totalLoss = 0
    predictions.forEach((sample) => {
        const probability = clamp(sample.probability, 0.0001, 0.9999)
        const loss = sample.label
            ? -Math.log(probability)
            : -Math.log(1 - probability)
        totalWeight += sample.weight
        totalLoss += loss * sample.weight
    })
    return totalWeight ? totalLoss / totalWeight : null
}

function computeBrierScore(predictions) {
    let totalWeight = 0
    let totalSquaredError = 0
    predictions.forEach((sample) => {
        const squaredError = Math.pow(sample.probability - sample.label, 2)
        totalWeight += sample.weight
        totalSquaredError += squaredError * sample.weight
    })
    return totalWeight ? totalSquaredError / totalWeight : null
}

function computeExpectedCalibrationError(predictions) {
    if (!predictions.length) {
        return null
    }
    const bins = Array.from({length: 10}, () => ({
        weight: 0,
        weightedLabel: 0,
        weightedPrediction: 0,
    }))

    predictions.forEach((sample) => {
        const binIndex = Math.min(9, Math.floor(sample.probability * 10))
        const bucket = bins[binIndex]
        bucket.weight += sample.weight
        bucket.weightedLabel += sample.label * sample.weight
        bucket.weightedPrediction += sample.probability * sample.weight
    })

    const totalWeight = bins.reduce((total, bucket) => total + bucket.weight, 0)
    if (!totalWeight) {
        return null
    }

    const totalCalibrationGap = bins.reduce((total, bucket) => {
        if (!bucket.weight) {
            return total
        }
        const averageLabel = bucket.weightedLabel / bucket.weight
        const averagePrediction = bucket.weightedPrediction / bucket.weight
        return (
            total +
            Math.abs(averagePrediction - averageLabel) *
                (bucket.weight / totalWeight)
        )
    }, 0)

    return totalCalibrationGap
}

function computeWeightedLabelAverage(predictions) {
    let totalWeight = 0
    let positiveWeight = 0
    predictions.forEach((sample) => {
        totalWeight += sample.weight
        if (sample.label) {
            positiveWeight += sample.weight
        }
    })
    return totalWeight ? positiveWeight / totalWeight : null
}

function computeBucketCtrs(predictions) {
    if (!predictions.length) {
        return []
    }
    const orderedPredictions = [...predictions].sort((left, right) => {
        const probabilityDelta = right.probability - left.probability
        if (probabilityDelta !== 0) {
            return probabilityDelta
        }
        return left.itemKey.localeCompare(right.itemKey)
    })
    const bucketSize = Math.max(1, Math.ceil(orderedPredictions.length / 5))
    const bucketCtrs = []
    for (let index = 0; index < orderedPredictions.length; index += bucketSize) {
        const bucket = orderedPredictions.slice(index, index + bucketSize)
        bucketCtrs.push({
            bucket: bucketCtrs.length + 1,
            size: bucket.length,
            positiveRate: computeWeightedLabelAverage(bucket),
        })
    }
    return bucketCtrs
}

function createEmptyMetrics() {
    return {
        prAuc: null,
        logLoss: null,
        brier: null,
        ece: null,
        baselineCtr: null,
        bucketCtrs: [],
    }
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function normalizePublishedAt(value) {
    const timestamp = normalizeTimestamp(value)
    return timestamp ? new Date(timestamp).toISOString() : null
}

function normalizeTimestamp(value) {
    if (value instanceof Date) {
        const timestamp = value.getTime()
        return Number.isFinite(timestamp) ? Math.round(timestamp) : 0
    }
    if (typeof value === 'string') {
        const timestamp = new Date(value).getTime()
        return Number.isFinite(timestamp) ? Math.round(timestamp) : 0
    }
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return 0
    }
    return Math.round(numericValue)
}

function normalizeHostKey(link) {
    return normalizeText(getHostname(normalizeText(link))).toLowerCase()
}

function sigmoid(value) {
    return 1 / (1 + Math.exp(-clamp(value, -16, 16)))
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}
