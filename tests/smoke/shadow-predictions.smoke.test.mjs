import test from 'node:test'
import assert from 'node:assert/strict'
import {createShadowPredictions} from '../../src/app/shadow-predictions.ts'
import {
    createClickObservation,
    recordObservationClick,
    finalizeClickObservations,
    CLICK_WINDOW_MS,
} from '../../src/scripts/click-observations.js'
import {
    buildClickFeatures,
    trainClickModel,
} from '../../src/scripts/click-model.js'

function cohort() {
    return Array.from({length: 12}, (_, i) => {
        let row = createClickObservation({
            observationId: `o${i}`,
            profileId: 'p',
            itemKey: `post${i}`,
            firstShownAt: i * 1000,
            snapshot: {
                title: i % 2 ? 'Практический разбор' : 'Рекламный анонс',
            },
            context: {},
            predictions: {},
        })
        if (i % 2)
            row = recordObservationClick([row], {
                profileId: 'p',
                itemKey: row.itemKey,
                recordedAt: row.firstShownAt + 1,
            })[0]
        return finalizeClickObservations([row], CLICK_WINDOW_MS + 20000)[0]
    })
}
function worker() {
    return {
        onmessage: null,
        onerror: null,
        terminate() {},
        postMessage(request) {
            const train = (rows) =>
                trainClickModel(
                    rows.map((row) => ({
                        features: buildClickFeatures(
                            row.snapshot,
                            row.context,
                            row.embedding,
                        ),
                        outcome: row.outcome,
                    })),
                )
            queueMicrotask(() =>
                this.onmessage?.({
                    data: {
                        id: request.id,
                        a1: train(request.a1),
                        b: train(request.b),
                    },
                }),
            )
        },
    }
}
test('shadow predictions train only mature history and log future candidate probabilities', async () => {
    const model = createShadowPredictions({
        embed: async () =>
            Array.from({length: 312}, (_, i) => (i === 0 ? 1 : 0)),
        createWorker: worker,
    })
    const rows = cohort(),
        now = CLICK_WINDOW_MS + 20000
    const snapshot = {title: 'Практический разбор'}
    assert.equal(
        model.predict(snapshot, {referenceTime: now}).predictions.b,
        null,
    )
    await model.prepare(rows, now)
    await model.prepareItem(snapshot)
    const forecast = model.predict(snapshot, {referenceTime: now})
    assert.ok(forecast.predictions.a1 > 0 && forecast.predictions.a1 < 1)
    assert.ok(forecast.predictions.b > 0 && forecast.predictions.b < 1)
    assert.equal(forecast.versions.calibration, 'unvalidated-shadow-v1')
    assert.equal(
        model.predict(snapshot, {referenceTime: 0}).predictions.b,
        null,
    )
    assert.equal(model.report(rows, now).published, false)
    model.dispose()
    assert.equal(
        model.predict(snapshot, {referenceTime: now}).predictions.b,
        null,
    )
})
test('immature positives cannot create a trained shadow head', async () => {
    let workers = 0
    const model = createShadowPredictions({
        embed: async () => [1],
        createWorker: () => {
            workers++
            return worker()
        },
    })
    await model.prepare(cohort(), 10000)
    assert.equal(workers, 0)
    model.dispose()
})
