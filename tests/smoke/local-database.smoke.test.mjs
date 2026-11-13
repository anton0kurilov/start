import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory, IDBKeyRange} from 'fake-indexeddb'
import {createLocalDatabase} from '../../src/app/local-database.ts'
import {createRepository} from '../../src/app/repository.ts'
import {newProfile} from '../../src/app/sync-types.ts'
import {command} from '../../src/app/commands.ts'
import {migrateLegacy} from '../../src/app/migration.ts'
import {repositoryPredictionStorage} from '../../src/app/repository-predictions.ts'
import {finalizeClickObservations} from '../../src/scripts/click-observations.js'
import {IDBObjectStore} from 'fake-indexeddb'

globalThis.IDBKeyRange = IDBKeyRange

async function setup(t, key = 'guest', factory = new IDBFactory()) {
    const database = createLocalDatabase({factory})
    const profile = newProfile(key, key === 'guest' ? null : key)
    if (profile.userId) {
        profile.epoch = '1'
        profile.learningEpoch = 'learning-1'
    }
    await database.initialize(profile, [])
    const repository = await createRepository(database, key)
    t.after(() => {
        repository.close()
        database.close()
    })
    return {database, repository, factory}
}

test('local state and outbox commit together, survive reopening and never contain a seed', async (t) => {
    const {database, repository} = await setup(t, 'user:one')
    await repository.dispatch(
        command('folder.create', {id: 'one', name: 'Новости'}),
    )
    const loaded = await database.load('user:one')
    assert.equal(loaded.records[0].data.name, 'Новости')
    assert.equal(loaded.outbox.length, 1)
    assert.equal(loaded.outbox[0].command.client_seq, '1')
    assert.equal(loaded.profile.nextSequence, 2)
    const reopened = await createRepository(database, 'user:one')
    t.after(() => reopened.close())
    assert.equal(reopened.state.folders[0].id, 'one')
    assert.equal(reopened.pending.length, 1)
})

test('two tabs retry stale revisions without losing either change or sequence', async (t) => {
    const {database, repository} = await setup(t, 'user:one')
    const other = await createRepository(database, 'user:one')
    t.after(() => other.close())
    await Promise.all([
        repository.dispatch(
            command('folder.create', {id: 'one', name: 'Один'}),
        ),
        other.dispatch(command('folder.create', {id: 'two', name: 'Два'})),
    ])
    const loaded = await database.load('user:one')
    assert.deepEqual(loaded.records.map((r) => r.id).sort(), ['one', 'two'])
    assert.deepEqual(
        loaded.outbox.map((r) => r.sequence),
        [1, 2],
    )
})

test('aborted write does not advance profile or leave an orphaned outbox entry', async (t) => {
    const {database, repository} = await setup(t, 'user:one')
    await assert.rejects(
        database.transaction(['profiles', 'outbox'], 'readwrite', (tx) => {
            tx.objectStore('outbox').put({
                scope: 'user:one',
                sequence: 1,
                command: {type: 'bad'},
            })
            tx.objectStore('profiles').put({
                ...repository.profile,
                nextSequence: 2,
            })
            throw new Error('simulated failure')
        }),
        /simulated failure/,
    )
    const loaded = await database.load('user:one')
    assert.equal(loaded.outbox.length, 0)
    assert.equal(loaded.profile.nextSequence, 1)
})

test('reconciliation replaces only its own namespace and keeps unrelated pending work', async (t) => {
    const {database, repository} = await setup(t, 'user:one')
    const second = newProfile('user:two', 'two')
    await database.initialize(second, [
        {
            kind: 'folder',
            id: 'other',
            data: {name: 'Чужое'},
            revision: '0',
            deleted: false,
        },
    ])
    const local = command('folder.create', {id: 'local', name: 'Локальное'})
    await repository.dispatch(local)
    await repository.reconcile({
        epoch: '1',
        learningEpoch: 'learning-1',
        cursor: '2',
        snapshot: true,
        changes: [
            {
                kind: 'folder',
                id: 'remote',
                data: {name: 'Удалённое', position: 0},
                revision: '2',
                deleted: false,
            },
        ],
    })
    assert.deepEqual(repository.state.folders.map((f) => f.id).sort(), [
        'local',
        'remote',
    ])
    assert.equal(repository.pending.length, 1)
    assert.equal((await database.load('user:two')).records[0].id, 'other')
    await repository.reconcile({
        epoch: '1',
        learningEpoch: 'learning-1',
        cursor: '3',
        changes: [
            {
                kind: 'folder',
                id: 'local',
                data: {name: 'Локальное', position: 1},
                revision: '3',
                deleted: false,
            },
        ],
        receipts: [{op_id: local.op_id, status: 'accepted', revision: '3'}],
    })
    assert.equal(repository.pending.length, 0)
})

test('an account reset archives stale commands instead of restoring deleted data', async (t) => {
    const {database, repository} = await setup(t, 'user:one')
    await repository.dispatch(
        command('folder.create', {id: 'old', name: 'Старое'}),
    )
    await repository.reconcile({
        epoch: '2',
        learningEpoch: 'learning-2',
        cursor: '0',
        snapshot: true,
        changes: [],
    })
    assert.equal(repository.pending.length, 0)
    assert.equal(repository.state.folders.length, 0)
    assert.equal(
        (await database.getMetadata('archived-queue:user:one:1:learning-1'))
            .length,
        1,
    )
})

test('legacy migration is idempotent and leaves its source unchanged', async (t) => {
    const factory = new IDBFactory(),
        database = createLocalDatabase({factory})
    t.after(() => database.close())
    const raw = JSON.stringify({
        folders: [{id: 'legacy', name: 'Старое', feeds: []}],
        visitedItemKeys: ['https://example.com/one'],
    })
    let reads = 0
    const storage = {
        getItem: () => {
            reads++
            return raw
        },
    }
    await migrateLegacy(database, {storage, factory})
    await migrateLegacy(database, {storage, factory})
    const loaded = await database.load('guest')
    assert.equal(reads, 1)
    assert.equal(loaded.records.filter((r) => r.kind === 'folder').length, 1)
    assert.equal((await database.getMetadata('legacy-backup')).raw, raw)
    assert.equal(loaded.outbox.length, 0)
})

test('corrupt legacy state cannot silently migrate into an empty profile', async (t) => {
    const factory = new IDBFactory(),
        database = createLocalDatabase({factory})
    t.after(() => database.close())
    await assert.rejects(
        migrateLegacy(database, {factory, storage: {getItem: () => '{broken'}}),
    )
    assert.equal((await database.load('guest')).profile, undefined)
})

test('quota failure during a snapshot replacement rolls back deletions and the cursor', async (t) => {
    const {database, repository} = await setup(t, 'user:one')
    await repository.dispatch(
        command('folder.create', {id: 'local', name: 'Сохранено'}),
    )
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value, ...args) {
        if (this.name === 'records' && value.id === 'remote')
            throw new DOMException('Full', 'QuotaExceededError')
        return original.call(this, value, ...args)
    }
    try {
        await assert.rejects(
            repository.reconcile({
                epoch: '1',
                learningEpoch: 'learning-1',
                cursor: '2',
                snapshot: true,
                changes: [
                    {
                        kind: 'folder',
                        id: 'remote',
                        data: {name: 'Новое', position: 0},
                        revision: '2',
                        deleted: false,
                    },
                ],
            }),
            /Full/,
        )
    } finally {
        IDBObjectStore.prototype.put = original
    }
    const saved = await database.load('user:one')
    assert.equal(saved.profile.cursor, '0')
    assert.deepEqual(
        saved.records.map((r) => r.id),
        ['local'],
    )
    assert.equal(saved.outbox.length, 1)
})

test('learning reset hides stale learning commands while preserving delivery sequences for other changes', async (t) => {
    const {repository} = await setup(t, 'user:one')
    const oldEvent = command('item.signal', {
        signal: 'impression',
        itemKey: 'story',
        recordedAt: 1000,
        snapshot: {},
    })
    const folder = command('folder.create', {id: 'kept', name: 'Колонка'})
    await repository.dispatch([oldEvent, folder])
    await repository.reconcile({
        epoch: '1',
        learningEpoch: 'learning-2',
        cursor: '1',
        changes: [],
    })
    assert.deepEqual(
        repository.pending.map((r) => r.sequence),
        [1, 2],
    )
    assert.equal(repository.state.modelState.interactionLog.length, 0)
    assert.equal(repository.state.folders[0].id, 'kept')
    await repository.reconcile({
        epoch: '1',
        learningEpoch: 'learning-2',
        cursor: '2',
        changes: [
            {
                kind: 'folder',
                id: 'kept',
                data: {name: 'Колонка', position: 0},
                deleted: false,
                revision: '2',
            },
        ],
        receipts: [
            {op_id: oldEvent.op_id, status: 'rejected'},
            {op_id: folder.op_id, status: 'accepted', revision: '2'},
        ],
    })
    assert.equal(repository.pending.length, 0)
})

test('maturation queued with a click observes the latest atomic click and keeps the positive outcome', async (t) => {
    const {repository} = await setup(t, 'user:one')
    const p = repository.profile
    const signal = (kind, at) =>
        command('item.signal', {
            signal: kind,
            itemKey: 'story',
            recordedAt: at,
            snapshot: {title: 'Story'},
            profileId: p.learnerId,
            deviceId: p.deviceId,
            generation: p.generation,
            expected: '0',
        })
    await repository.dispatch(signal('exposure', 1000))
    const storage = repositoryPredictionStorage(
        repository,
        () => 86401001,
    )({dbName: 'unused'})
    const click = repository.dispatch(signal('click', 2000))
    const maturation = storage.updateObservation(
        'story',
        (latest) => finalizeClickObservations([latest], 86401001)[0],
    )
    await Promise.all([click, maturation])
    assert.equal(repository.observations()[0].clickAt, 2000)
    assert.equal(repository.observations()[0].outcome, 1)
    storage.close()
})

test('a delayed snapshot cannot roll back a newer cursor or reintroduce an old generation', async (t) => {
    const {repository} = await setup(t, 'user:one')
    const folder = (name, revision) => ({
        kind: 'folder',
        id: 'one',
        data: {name, position: 0},
        revision,
        deleted: false,
    })
    await repository.reconcile({
        epoch: '1',
        learningEpoch: 'learning-1',
        cursor: '5',
        snapshot: true,
        changes: [folder('Новое', '5')],
    })
    await repository.reconcile({
        epoch: '1',
        learningEpoch: 'old-learning',
        cursor: '4',
        snapshot: true,
        changes: [folder('Старое', '4')],
    })
    assert.equal(repository.profile.cursor, '5')
    assert.equal(repository.profile.learningEpoch, 'learning-1')
    assert.equal(repository.state.folders[0].name, 'Новое')
    await repository.reconcile({
        epoch: '2',
        learningEpoch: 'learning-2',
        cursor: '0',
        snapshot: true,
        changes: [],
    })
    await repository.reconcile({
        epoch: '1',
        learningEpoch: 'learning-1',
        cursor: '6',
        snapshot: true,
        changes: [folder('Возврат', '6')],
    })
    assert.equal(repository.profile.epoch, '2')
    assert.equal(repository.state.folders.length, 0)
})
