export const CLICK_MODEL_SCHEMA_VERSION = 1
export const CLICK_FEATURE_VERSION = 'click-features-v1'
export const CLICK_SOURCE_BUCKETS = 32
export const CLICK_WORD_BUCKETS = 128
export const CLICK_METADATA_DIMENSIONS = 16 + CLICK_SOURCE_BUCKETS

const DAY = 24 * 60 * 60 * 1000

// The caller supplies exposure-time context. This function never reads the
// clock or current user history, so historical features cannot age in place.
export function buildClickFeatures(snapshot = {}, context = {}, embedding) {
    snapshot = snapshot && typeof snapshot === 'object' ? snapshot : {}
    context = context && typeof context === 'object' ? context : {}
    const title = string(snapshot.title).slice(0, 512)
    const description = string(snapshot.description).slice(0, 2000)
    const shownAt = context.firstShownAt ?? context.shownAt
    const publishedAt = parseDate(snapshot.publishedAt ?? snapshot.date)
    const age = finite(context.ageMs)
        ? context.ageMs
        : finite(shownAt) && publishedAt !== null
          ? Math.max(0, shownAt - publishedAt)
          : null
    const position =
        finite(context.position) && context.position >= 0
            ? context.position
            : null
    const column = context.columnType ?? context.column
    const hour =
        finite(context.hour) && context.hour >= 0 && context.hour < 24
            ? context.hour
            : null
    const dismiss = finite(context.dismissSimilarity)
        ? Math.max(-1, Math.min(1, context.dismissSimilarity))
        : null
    const dense = embedding !== undefined
    const features = [
        age === null ? 0 : Math.min(90, Math.max(0, age / DAY)) / 90,
        age === null
            ? 0
            : Math.log1p(Math.min(90 * DAY, Math.max(0, age)) / DAY) /
              Math.log(91),
        age === null ? 0 : 1,
        position === null ? 0 : Math.min(position, 40) / 40,
        position === null ? 0 : 1,
        column === 'recommended' ? 1 : 0,
        typeof column === 'string' && column.length ? 1 : 0,
        description.length ? 1 : 0,
        title.length / 512,
        description.length / 2000,
        hour === null ? 0 : Math.sin((hour * Math.PI) / 12),
        hour === null ? 0 : Math.cos((hour * Math.PI) / 12),
        hour === null ? 0 : 1,
        dismiss ?? 0,
        dismiss === null ? 0 : 1,
        string(snapshot.feedId) || string(snapshot.source) ? 1 : 0,
    ]
    const source = new Array(CLICK_SOURCE_BUCKETS).fill(0)
    const identity =
        string(snapshot.feedId) || string(snapshot.source).toLowerCase()
    if (identity) source[hash(identity) % source.length] = 1
    features.push(...source)
    if (dense) {
        requireVector(embedding, 4096 - CLICK_METADATA_DIMENSIONS)
        features.push(...normalized(embedding))
    } else {
        const words = new Array(CLICK_WORD_BUCKETS).fill(0)
        const tokens =
            `${title} ${description}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ||
            []
        for (const token of tokens) words[hash(token) % words.length]++
        features.push(...normalized(words.map((count) => Math.log1p(count))))
    }
    return features
}

// A deterministic unweighted likelihood fit. These artifacts are a candidate,
// not proof of calibrated probabilities or readiness for UI publication.
export function trainClickModel(
    rows,
    {epochs = 60, learningRate = 0.3, l2 = 0.01} = {},
) {
    if (!Array.isArray(rows))
        throw new TypeError('Training rows must be an array')
    if (!Number.isSafeInteger(epochs) || epochs < 1 || epochs > 1000)
        throw new RangeError('Epochs must be between 1 and 1000')
    if (!finite(learningRate) || learningRate <= 0 || learningRate > 1)
        throw new RangeError('Learning rate must be in (0, 1]')
    if (!finite(l2) || l2 < 0 || l2 > 1)
        throw new RangeError('L2 must be in [0, 1]')
    let dimension = 0
    let positiveCount = 0
    for (const row of rows) {
        requireVector(row?.features)
        dimension ||= row.features.length
        if (row.features.length !== dimension)
            throw new RangeError('Training vectors must have equal dimensions')
        if (row.outcome !== 0 && row.outcome !== 1)
            throw new TypeError('Training requires completed binary outcomes')
        positiveCount += row.outcome
    }
    const prior = (positiveCount + 1) / (rows.length + 2)
    let bias = Math.log(prior / (1 - prior))
    const weights = new Array(dimension).fill(0)
    const gradient = new Array(dimension).fill(0)
    for (let epoch = 0; rows.length && epoch < epochs; epoch++) {
        gradient.fill(0)
        let biasGradient = 0
        for (const row of rows) {
            const error =
                sigmoid(dot(weights, row.features) + bias) - row.outcome
            biasGradient += error
            for (let index = 0; index < dimension; index++)
                gradient[index] += error * row.features[index]
        }
        bias -= (learningRate * biasGradient) / rows.length
        for (let index = 0; index < dimension; index++) {
            weights[index] -=
                learningRate *
                (gradient[index] / rows.length + l2 * weights[index])
            if (!finite(weights[index]))
                throw new RangeError(
                    'Training overflow: features must be scaled',
                )
        }
        if (!finite(bias)) throw new RangeError('Training bias overflow')
    }
    return {
        schemaVersion: CLICK_MODEL_SCHEMA_VERSION,
        featureVersion: CLICK_FEATURE_VERSION,
        dimension,
        sampleCount: rows.length,
        positiveCount,
        negativeCount: rows.length - positiveCount,
        prior,
        bias,
        weights,
        epochs: rows.length ? epochs : 0,
        learningRate,
        l2,
    }
}

export function predictClickProbability(model, features) {
    if (
        model?.schemaVersion !== CLICK_MODEL_SCHEMA_VERSION ||
        model?.featureVersion !== CLICK_FEATURE_VERSION ||
        !Number.isSafeInteger(model.dimension) ||
        model.dimension <= 0 ||
        !Array.isArray(model.weights) ||
        model.weights.length !== model.dimension ||
        !Array.isArray(features) ||
        features.length !== model.dimension ||
        !finite(model.bias) ||
        !model.weights.every(finite) ||
        !features.every(finite)
    )
        return null
    const score = dot(model.weights, features) + model.bias
    return finite(score) ? sigmoid(score) : null
}

function requireVector(value, maximum = 4096) {
    if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > maximum ||
        !value.every(finite)
    )
        throw new TypeError(
            'Expected a nonempty finite numeric vector of at most 4096 values',
        )
}

function normalized(values) {
    // Scaling first avoids overflow for finite vectors with very large values.
    const scale = values.reduce(
        (largest, value) => Math.max(largest, Math.abs(value)),
        0,
    )
    if (!scale) return values.map(() => 0)
    const norm = Math.sqrt(
        values.reduce((sum, value) => sum + (value / scale) ** 2, 0),
    )
    return values.map((value) => value / scale / norm)
}

function dot(weights, features) {
    let score = 0
    for (let index = 0; index < weights.length; index++)
        score += weights[index] * features[index]
    return score
}

function sigmoid(value) {
    if (!finite(value))
        throw new RangeError('Training overflow: features must be scaled')
    if (value >= 0) return 1 / (1 + Math.exp(-value))
    const exponential = Math.exp(value)
    return exponential / (1 + exponential)
}

function finite(value) {
    return typeof value === 'number' && Number.isFinite(value)
}

function string(value) {
    return typeof value === 'string' ? value : ''
}

function parseDate(value) {
    if (!(
        typeof value === 'string' ||
        typeof value === 'number' ||
        value instanceof Date
    ))
        return null
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : null
}

function hash(value) {
    let result = 2166136261
    for (let index = 0; index < value.length; index++)
        result = Math.imul(result ^ value.charCodeAt(index), 16777619)
    return result >>> 0
}
