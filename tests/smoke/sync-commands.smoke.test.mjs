import test from 'node:test'
import assert from 'node:assert/strict'
import {applyCommand, command} from '../../src/app/commands.ts'
import {entityKey} from '../../src/app/sync-types.ts'
import {itemDigest} from '../../src/app/item-identity.ts'

test('manual unread survives a stale automatic read in either arrival order', () => {
    const key = 'https://example.com/article'
    const auto = command('read.set', {
        items: [{key, expected: '0'}],
        value: true,
        origin: 'auto',
    })
    const unread = command('read.set', {
        items: [{key}],
        value: false,
        origin: 'manual',
    })
    for (const sequence of [
        [auto, unread],
        [unread, auto],
    ]) {
        const records = sequence.reduce(
            (map, cmd) => applyCommand(map, cmd).records,
            new Map(),
        )
        assert.equal(
            records.get(entityKey('read', itemDigest(key))).data.value,
            false,
        )
    }
})

test('deletion is final for an id and cascades without recreating children', () => {
    let records = new Map()
    for (const cmd of [
        command('folder.create', {id: 'folder', name: 'Новости'}),
        command('subscription.create', {
            id: 'feed',
            folderId: 'folder',
            name: 'RSS',
            url: 'https://example.com/rss',
        }),
        command('folder.delete', {id: 'folder'}),
    ])
        records = applyCommand(records, cmd).records
    assert.equal(records.get('folder:folder').deleted, true)
    assert.equal(records.get('subscription:feed').deleted, true)
    assert.throws(
        () =>
            applyCommand(
                records,
                command('subscription.patch', {
                    id: 'feed',
                    changes: {name: 'Возврат'},
                }),
            ),
        /ENTITY_DELETED/,
    )
    assert.throws(
        () =>
            applyCommand(
                records,
                command('folder.create', {id: 'folder', name: 'Возврат'}),
            ),
        /ID_EXISTS/,
    )
})

test('a click, its read status and frozen observation are one command; dismiss preserves the click', () => {
    const input = {
        itemKey: 'https://example.com/article',
        profileId: 'profile',
        deviceId: 'device',
        generation: 'generation',
        recordedAt: 1000,
        expected: '0',
        snapshot: {title: 'Статья'},
        context: {position: 2},
        predictions: {b: 0.2},
    }
    let records = applyCommand(
        new Map(),
        command('item.signal', {...input, signal: 'click'}),
    ).records
    assert.equal(
        [...records.values()].filter((r) =>
            ['read', 'feedback', 'observation'].includes(r.kind),
        ).length,
        3,
    )
    records = applyCommand(
        records,
        command('item.signal', {...input, recordedAt: 2000, signal: 'dismiss'}),
    ).records
    const observation = [...records.values()].find(
        (r) => r.kind === 'observation',
    ).data.observation
    assert.equal(observation.clickAt, 1000)
    assert.equal(observation.dismissAt, 2000)
    assert.equal(observation.predictions.b, 0.2)
    assert.equal(
        records.get(`feedback:${itemDigest(input.itemKey)}`).data.clicked,
        true,
    )
})
