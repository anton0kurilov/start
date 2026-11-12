import test from 'node:test'
import assert from 'node:assert/strict'
import {createPredictions} from '../../src/app/predictions.ts'
import {
    createClickObservation,
    recordObservationClick,
    CLICK_WINDOW_MS,
} from '../../src/scripts/click-observations.js'

// Explicit test double. Production always uses IndexedDB and rejects failures.
function memoryStorage(hooks = {}) {
    const databases = new Map()
    const connections = []
    const factory = ({dbName}) => {
        if (!databases.has(dbName))
            databases.set(dbName, {rows: new Map(), profile: null})
        const data = databases.get(dbName)
        const connection = {dbName, closed: false}
        connections.push(connection)
        const check = () => {
            if (connection.closed) throw new Error('closed')
        }
        return {
            async getProfileId() {
                check()
                await hooks.profile?.(dbName)
                data.profile ||= `profile-${dbName}`
                return data.profile
            },
            async listObservations() {
                check()
                const snapshot = structuredClone([...data.rows.values()])
                await hooks.list?.(dbName, data)
                return snapshot
            },
            async updateObservation(key, reducer) {
                check()
                const next = reducer(
                    structuredClone(data.rows.get(key) || null),
                )
                if (next === null) data.rows.delete(key)
                else data.rows.set(key, structuredClone(next))
                return next
            },
            async replaceObservations(rows, profile) {
                check()
                await hooks.replace?.(dbName)
                data.rows = new Map(
                    structuredClone(rows).map((row) => [row.itemKey, row]),
                )
                data.profile = profile
            },
            async clear() {
                check()
                data.rows.clear()
                data.profile = null
            },
            close() {
                connection.closed = true
            },
        }
    }
    return {factory, databases, connections}
}
const card = (key = 'post') => ({
    itemKey: key,
    title: 'Original',
    description: 'Text',
    link: `https://example.com/${key}`,
    source: 'Source',
    feedId: 'feed',
    date: new Date(0),
})
const deferred = () => {
    let resolve
    const promise = new Promise((r) => {
        resolve = r
    })
    return {promise, resolve}
}
function backup() {
    return {
        schemaVersion: 1,
        profileId: 'imported',
        observations: [
            createClickObservation({
                observationId: 'one',
                profileId: 'imported',
                itemKey: 'imported-post',
                firstShownAt: 1000,
            }),
        ],
    }
}

test('prediction coordinator freezes exposure and matures both outcomes without losing clicks to dismiss', async () => {
    const memory = memoryStorage()
    let now = 1000
    const service = createPredictions({
        now: () => now,
        storageFactory: memory.factory,
    })
    service.start('first')
    const shown = card()
    const context = {column: 'normal'}
    service.record('exposure', shown, context)
    shown.title = 'Changed'
    context.column = 'recommended'
    now++
    service.record('click', shown)
    service.record('dismiss', shown)
    let data = await service.exportData()
    assert.equal(data.observations[0].snapshot.title, 'Original')
    assert.equal(data.observations[0].context.column, 'normal')
    assert.equal(data.observations[0].outcome, null)
    assert.equal(data.observations[0].predictions.legacy, null)
    now += CLICK_WINDOW_MS
    service.tick()
    data = await service.exportData()
    assert.equal(data.observations[0].outcome, 1)
    assert.equal(data.observations[0].dismissAt, 1001)
    service.dispose()
})

test('maturation atomically uses the latest row after a concurrent click', async () => {
    let now = 1000
    let intercept = false
    const memory = memoryStorage({
        list: (_name, db) => {
            if (!intercept) return
            intercept = false
            const row = db.rows.get('post')
            db.rows.set(
                'post',
                recordObservationClick([row], {
                    profileId: row.profileId,
                    itemKey: 'post',
                    recordedAt: 1001,
                })[0],
            )
        },
    })
    const service = createPredictions({
        now: () => now,
        storageFactory: memory.factory,
    })
    service.start('first')
    service.record('exposure', card())
    await service.exportData()
    now += CLICK_WINDOW_MS
    intercept = true
    service.tick()
    assert.equal((await service.exportData()).observations[0].outcome, 1)
    service.dispose()
})

test('generation changes discard queued events and clear retired private history', async () => {
    const memory = memoryStorage()
    const service = createPredictions({
        now: () => 1000,
        storageFactory: memory.factory,
    })
    service.start('old')
    service.record('exposure', card('old'))
    await service.exportData()
    service.record('click', card('old'))
    service.start('new')
    service.record('exposure', card('new'))
    const data = await service.exportData()
    assert.deepEqual(
        data.observations.map((row) => row.itemKey),
        ['new'],
    )
    assert.equal(memory.databases.get('start:predictions:old').rows.size, 0)
    assert.equal(memory.connections[0].closed, true)
    service.start('new')
    assert.equal((await service.exportData()).observations.length, 1)
    service.dispose()
})

test('failed startup closes its connection and a later start can recover', async () => {
    const statuses = []
    const memory = memoryStorage({
        profile: (name) => {
            if (name.endsWith(':bad')) throw new Error('unavailable')
        },
    })
    const service = createPredictions({
        storageFactory: memory.factory,
        onStatus: (value) => statuses.push(value),
    })
    service.start('bad')
    await assert.rejects(service.exportData(), /unavailable/i)
    assert.equal(memory.connections[0].closed, true)
    assert.equal(statuses.at(-1), 'error')
    service.start('good')
    await service.exportData()
    assert.equal(statuses.at(-1), 'ready')
    service.dispose()
})

test('a startup read failure closes an adopted connection', async () => {
    const memory = memoryStorage({
        list: () => {
            throw new Error('read failed')
        },
    })
    const service = createPredictions({storageFactory: memory.factory})
    service.start('bad')
    await assert.rejects(service.exportData())
    assert.equal(memory.connections[0].closed, true)
    service.dispose()
})

test('invalid import cannot allocate a staging store or replace current history', async () => {
    const memory = memoryStorage()
    const service = createPredictions({storageFactory: memory.factory})
    service.start('current')
    await service.exportData()
    for (const raw of [
        null,
        {},
        {...backup(), schemaVersion: 99},
        {...backup(), observations: [null]},
        {...backup(), profileId: 'other'},
        {
            ...backup(),
            observations: [...backup().observations, ...backup().observations],
        },
    ])
        await assert.rejects(service.stageImport(raw))
    assert.equal(memory.connections.length, 1)
    service.dispose()
})

for (const action of ['reset', 'dispose']) {
    test(`staged import is erased and rejected when superseded by ${action}`, async () => {
        const entered = deferred()
        const release = deferred()
        const memory = memoryStorage({
            replace: async () => {
                entered.resolve()
                await release.promise
            },
        })
        const service = createPredictions({storageFactory: memory.factory})
        service.start('current')
        await service.exportData()
        const staged = service.stageImport(backup())
        const rejected = assert.rejects(staged, /superseded/)
        await entered.promise
        if (action === 'reset') service.start('reset')
        else service.dispose()
        release.resolve()
        await rejected
        const stagingConnection = memory.connections.find(
            (connection) =>
                ![
                    'start:predictions:current',
                    'start:predictions:reset',
                ].includes(connection.dbName),
        )
        assert.equal(stagingConnection.closed, true)
        assert.equal(
            memory.databases.get(stagingConnection.dbName).rows.size,
            0,
        )
        if (action === 'reset') {
            assert.deepEqual((await service.exportData()).observations, [])
            service.dispose()
        }
    })
}

test('successful staging is isolated, can be discarded, and cannot clear an adopted generation', async () => {
    const memory = memoryStorage()
    const service = createPredictions({
        storageFactory: memory.factory,
        now: () => 1000,
    })
    service.start('current')
    service.record('exposure', card('current'))
    await service.exportData()
    const abandoned = await service.stageImport(backup())
    assert.deepEqual(
        (await service.exportData()).observations.map((row) => row.itemKey),
        ['current'],
    )
    await service.discardImport(abandoned)
    assert.equal(
        memory.databases.get(`start:predictions:${abandoned}`).rows.size,
        0,
    )
    const adopted = await service.stageImport(backup())
    service.start(adopted)
    await service.discardImport(adopted)
    assert.deepEqual(
        (await service.exportData()).observations.map((row) => row.itemKey),
        ['imported-post'],
    )
    service.dispose()
})

test('dispose removes successfully staged but unadopted private archives', async () => {
    const memory = memoryStorage()
    const service = createPredictions({storageFactory: memory.factory})
    service.start('current')
    await service.exportData()
    const generation = await service.stageImport(backup())
    service.dispose()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
        memory.databases.get(`start:predictions:${generation}`).rows.size,
        0,
    )
})

test('a pending initial connection is closed and cleared after reset supersedes it', async () => {
    const entered = deferred()
    const release = deferred()
    const memory = memoryStorage({
        profile: async (name) => {
            if (name.endsWith(':old')) {
                entered.resolve()
                await release.promise
            }
        },
    })
    const service = createPredictions({storageFactory: memory.factory})
    service.start('old')
    await entered.promise
    service.start('new')
    release.resolve()
    await service.exportData()
    assert.equal(memory.connections[0].closed, true)
    assert.equal(memory.databases.get('start:predictions:old').profile, null)
    service.dispose()
})
