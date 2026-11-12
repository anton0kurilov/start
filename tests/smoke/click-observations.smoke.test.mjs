import test from 'node:test'
import assert from 'node:assert/strict'
import {
    CLICK_WINDOW_MS,
    createClickObservation,
    normalizeClickObservation,
    recordClickExposure,
    recordObservationClick,
    recordObservationDismiss,
    finalizeClickObservations,
    getEligibleClickObservations,
} from '../../src/scripts/click-observations.js'

function exposure(overrides = {}) {
    return {
        observationId: 'observation-1',
        profileId: 'profile-1',
        itemKey: 'https://example.com/article',
        firstShownAt: 0,
        snapshot: {title: 'First title', description: 'First description'},
        context: {column: 'folder', features: {age: 30}},
        predictions: {baseline: 0.2, semantic: null},
        versions: {model: 'baseline-1'},
        ...overrides,
    }
}

function event(recordedAt, overrides = {}) {
    return {
        profileId: 'profile-1',
        itemKey: 'https://example.com/article',
        recordedAt,
        ...overrides,
    }
}

test('first exposure captures immutable features and forecasts, without freezing caller inputs', () => {
    const input = exposure()
    const row = createClickObservation(input)
    input.snapshot.title = 'Changed after exposure'
    input.context.features.age = 500
    input.predictions.baseline = 0.99
    input.versions.model = 'next-model'
    assert.equal(row.firstShownAt, 0)
    assert.equal(row.snapshot.title, 'First title')
    assert.equal(row.context.features.age, 30)
    assert.equal(row.predictions.baseline, 0.2)
    assert.equal(row.versions.model, 'baseline-1')
    assert.throws(() => {
        row.context.features.age = 42
    }, TypeError)
    assert.equal(Object.isFrozen(input.context), false)
})

test('repeated copies and refresh retain first context and do not extend observation window', () => {
    const rows = recordClickExposure([], exposure())
    const repeated = recordClickExposure(
        rows,
        exposure({
            observationId: 'copy-in-recommendations',
            firstShownAt: 5000,
            context: {column: 'recommended'},
            predictions: {baseline: 0.9},
        }),
    )
    assert.equal(repeated, rows)
    assert.equal(repeated[0].deadlineAt, CLICK_WINDOW_MS)
    assert.equal(repeated[0].context.column, 'folder')
    assert.equal(recordClickExposure(rows, exposure({itemKey: 'other'})), rows)
})

test('positive and negative observations enter training only after equal 24 hour windows', () => {
    let rows = recordClickExposure([], exposure())
    rows = recordClickExposure(
        rows,
        exposure({observationId: 'second', itemKey: 'second'}),
    )
    rows = recordObservationClick(rows, event(0))
    assert.equal(rows[0].clickAt, 0)
    assert.deepEqual(
        getEligibleClickObservations(rows, CLICK_WINDOW_MS - 1),
        [],
    )
    assert.equal(rows[0].outcome, null)
    const eligible = getEligibleClickObservations(rows, CLICK_WINDOW_MS)
    assert.deepEqual(
        eligible.map((row) => row.outcome),
        [1, 0],
    )
    assert.equal(rows[1].completedAt, null)
})

test('exclusive deadline and late clicks do not rewrite a completed negative', () => {
    let rows = recordClickExposure([], exposure())
    rows = recordObservationClick(rows, event(CLICK_WINDOW_MS))
    assert.equal(rows[0].clickAt, null)
    assert.equal(rows[0].lateClickAt, CLICK_WINDOW_MS)
    rows = finalizeClickObservations(rows, CLICK_WINDOW_MS)
    const original = rows[0]
    rows = recordObservationClick(rows, event(CLICK_WINDOW_MS + 1))
    assert.equal(rows[0], original)
    assert.equal(rows[0].outcome, 0)
    assert.equal(recordObservationClick(rows, event(100))[0], original)
    assert.equal(finalizeClickObservations(rows, CLICK_WINDOW_MS + 100), rows)
})

test('click immediately before deadline counts and dismiss never erases it', () => {
    let rows = recordClickExposure([], exposure())
    rows = recordObservationClick(rows, event(CLICK_WINDOW_MS - 1))
    rows = recordObservationDismiss(rows, event(CLICK_WINDOW_MS))
    rows = finalizeClickObservations(rows, CLICK_WINDOW_MS + 500)
    assert.equal(rows[0].outcome, 1)
    assert.equal(rows[0].clickAt, CLICK_WINDOW_MS - 1)
    assert.equal(rows[0].dismissAt, CLICK_WINDOW_MS)
    assert.equal(rows[0].predictions.baseline, 0.2)
})

test('fast click records supplied pre-click exposure exactly once', () => {
    const input = exposure({firstShownAt: 100})
    let rows = recordObservationClick([], event(100, {exposure: input}))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].clickAt, 100)
    assert.equal(rows[0].predictions.baseline, 0.2)
    assert.equal(
        recordObservationClick(rows, event(101, {exposure: exposure()})),
        rows,
    )
    assert.deepEqual(
        recordObservationClick([], event(99, {exposure: input})),
        [],
    )
    assert.deepEqual(
        recordObservationClick(
            [],
            event(100, {
                exposure: exposure({itemKey: 'unrelated'}),
            }),
        ),
        [],
    )
    assert.deepEqual(recordObservationDismiss([], event(100)), [])
})

test('profile isolation and invalid timestamps cannot change another user observation', () => {
    const rows = recordClickExposure([], exposure({firstShownAt: 100}))
    for (const input of [
        event(99),
        event(NaN),
        event(-1),
        event('100'),
        event(100, {profileId: 'other'}),
    ]) {
        assert.equal(recordObservationClick(rows, input), rows)
        assert.equal(recordObservationDismiss(rows, input), rows)
    }
    assert.deepEqual(getEligibleClickObservations(rows, -1), [])
    assert.equal(
        createClickObservation(exposure({firstShownAt: Infinity})),
        null,
    )
    assert.equal(
        createClickObservation(
            exposure({firstShownAt: Number.MAX_SAFE_INTEGER}),
        ),
        null,
    )
    assert.equal(createClickObservation(exposure({profileId: ''})), null)
    assert.equal(
        createClickObservation(
            exposure({snapshot: {publishedAt: {toString: null}}}),
        ).snapshot.publishedAt,
        null,
    )
})

test('restart normalization preserves evidence, rejects unknown schema, and does not trust forged labels', () => {
    let rows = recordClickExposure([], exposure())
    rows = recordObservationClick(rows, event(5))
    rows = recordObservationDismiss(rows, event(6))
    rows = finalizeClickObservations(rows, CLICK_WINDOW_MS + 1)
    const decoded = JSON.parse(JSON.stringify(rows[0]))
    assert.deepEqual(normalizeClickObservation(decoded), rows[0])
    assert.equal(normalizeClickObservation({...decoded, outcome: 0}).outcome, 1)
    assert.equal(
        normalizeClickObservation({...decoded, schemaVersion: 99}),
        null,
    )
    assert.equal(
        normalizeClickObservation({...decoded, targetVersion: 'other'}),
        null,
    )
    assert.equal(normalizeClickObservation({...decoded, deadlineAt: 20}), null)
    const pending = normalizeClickObservation({...decoded, completedAt: 1})
    assert.equal(pending.outcome, null)
    assert.deepEqual(
        getEligibleClickObservations([pending], CLICK_WINDOW_MS - 1),
        [],
    )
})

test('bounded text and JSON-safe frozen context survive storage without invalid forecasts', () => {
    const row = createClickObservation(
        exposure({
            snapshot: {
                title: 'a'.repeat(1000),
                description: 'b'.repeat(4000),
                date: new Date(0),
            },
            predictions: {baseline: Infinity, semantic: -0.1, constant: 0},
            context: JSON.parse(
                '{"__proto__":{"bad":true},"features":[1,null,-2]}',
            ),
        }),
    )
    assert.equal(row.snapshot.title.length, 512)
    assert.equal(row.snapshot.description.length, 2000)
    assert.equal(row.snapshot.publishedAt, new Date(0).toISOString())
    assert.deepEqual(row.predictions, {
        baseline: null,
        semantic: null,
        constant: 0,
    })
    assert.equal(Object.hasOwn(row.context, '__proto__'), false)
    assert.equal({}.bad, undefined)
    assert.deepEqual(
        normalizeClickObservation(JSON.parse(JSON.stringify(row))),
        row,
    )
})
