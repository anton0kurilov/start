import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {command, applyCommand} from '../../src/app/commands.ts'

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const device = '33333333-3333-4333-8333-333333333333'
let db
let epoch
let learningEpoch
let sequence = 0

async function asUser(user, run) {
    return db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
            user,
        ])
        await tx.exec('set local role authenticated')
        return run(tx)
    })
}
async function rpc(user, name, args = []) {
    return asUser(
        user,
        async (tx) =>
            (
                await tx.query(
                    `select start.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`,
                    args,
                )
            ).rows[0].result,
    )
}
async function push(
    commands,
    user = alice,
    dev = device,
    startSequence = sequence,
) {
    const packed = commands.map((cmd, index) => ({
        ...cmd,
        client_seq: String(startSequence + index + 1),
        account_epoch: epoch,
        learning_epoch: learningEpoch,
    }))
    const result = await rpc(user, 'sync_push', [
        epoch,
        dev,
        '0',
        JSON.stringify(packed),
    ])
    if (user === alice && startSequence === sequence)
        sequence += commands.length
    return {result, packed}
}

test.before(async () => {
    db = new PGlite()
    await db.exec(`
        create role anon; create role authenticated;
        create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
        grant usage on schema auth to authenticated;
        grant execute on function auth.uid() to authenticated;
        insert into auth.users values('${alice}'),('${bob}');
        create schema neighbor;
        create table neighbor.notes(id integer primary key, user_id uuid references auth.users(id), text text);
        insert into neighbor.notes values(1,'${alice}','Keep me');
    `)
    await db.exec(
        await readFile(
            new URL(
                '../../supabase/migrations/202611130001_start_sync.sql',
                import.meta.url,
            ),
            'utf8',
        ),
    )
    const profile = await rpc(alice, 'create_profile')
    epoch = profile.epoch
    learningEpoch = profile.learningEpoch
    await rpc(alice, 'sync_register_device', [device])
})
test.after(async () => {
    await db?.close()
})

test('SQL accepts commands once and rejects replay mutation without consuming another sequence', async () => {
    const cmd = command('folder.create', {id: 'news', name: 'Новости'})
    const {result, packed} = await push([cmd])
    assert.equal(result.receipts[0].status, 'accepted')
    const retry = await rpc(alice, 'sync_push', [
        epoch,
        device,
        '0',
        JSON.stringify(packed),
    ])
    assert.deepEqual(retry, result)
    const changed = structuredClone(packed)
    changed[0].payload.name = 'Changed'
    await assert.rejects(
        rpc(alice, 'sync_push', [epoch, device, '0', JSON.stringify(changed)]),
        /REPLAY_MISMATCH/,
    )
    assert.equal(
        (await rpc(alice, 'sync_register_device', [device])).lastSequence,
        '1',
    )
})

test('read/unread conflict produces the same final state in SQL and local reducer', async () => {
    const key = 'https://example.com/story'
    const commands = [
        command('read.set', {items: [{key}], value: false, origin: 'manual'}),
        command('read.set', {
            items: [{key, expected: '0'}],
            value: true,
            origin: 'auto',
        }),
    ]
    const {result} = await push(commands)
    assert.equal(result.receipts[0].status, 'accepted')
    assert.equal(result.receipts[1].status, 'noop')
    const local = commands.reduce(
        (map, cmd) => applyCommand(map, cmd).records,
        new Map(),
    )
    const stored = await asUser(
        alice,
        async (tx) =>
            (await tx.query("select data from start.records where kind='read'"))
                .rows[0].data,
    )
    assert.deepEqual(stored, [...local.values()][0].data)
})

test('a click is atomic across feedback, read state, event and CTR snapshot', async () => {
    const cmd = command('item.signal', {
        signal: 'click',
        itemKey: 'https://example.com/click',
        expected: '0',
        profileId: 'test-profile',
        deviceId: device,
        generation: 'generation',
        recordedAt: 1000,
        snapshot: {
            title: 'Story',
            description: '',
            source: 'RSS',
            feedId: 'feed',
            link: 'https://example.com/click',
            publishedAt: null,
        },
        context: {},
        predictions: {b: 0.2},
        versions: {},
    })
    const {result} = await push([cmd])
    assert.equal(result.receipts[0].status, 'accepted', JSON.stringify(result))
    const rows = await asUser(
        alice,
        async (tx) =>
            (
                await tx.query(
                    "select kind,data from start.records where kind='observation' or data->>'itemKey'='https://example.com/click'",
                )
            ).rows,
    )
    assert.deepEqual(rows.map((r) => r.kind).sort(), [
        'event',
        'feedback',
        'observation',
        'read',
    ])
    assert.equal(
        rows.find((r) => r.kind === 'observation').data.observation.clickAt,
        1000,
    )
})

test('an invalid command has a terminal receipt and does not block a following valid command', async () => {
    const {result} = await push([
        command('subscription.create', {
            id: 'orphan',
            folderId: 'missing',
            name: 'RSS',
            url: 'https://example.com/rss',
        }),
        command('preference.set', {key: 'autoRefreshFeeds', value: true}),
    ])
    assert.equal(result.receipts[0].code, 'PARENT_DELETED')
    assert.equal(result.receipts[1].status, 'accepted')
})

test('RLS, RPC and private schema deny another app user and direct writes', async () => {
    assert.equal(
        (await asUser(bob, (tx) => tx.query('select * from start.records')))
            .rows.length,
        0,
    )
    await assert.rejects(
        rpc(bob, 'sync_register_device', [device]),
        /PROFILE_NOT_FOUND/,
    )
    await assert.rejects(
        asUser(alice, (tx) =>
            tx.query(
                "insert into start.records values($1,1,'folder','evil','{}',1,false)",
                [alice],
            ),
        ),
        /permission denied/,
    )
    await assert.rejects(
        asUser(alice, (tx) => tx.query('select * from start_private.receipts')),
        /permission denied/,
    )
})

test('snapshot pages are immutable, scoped and include the committed revision boundary', async () => {
    const snapshot = await rpc(alice, 'sync_snapshot_begin')
    const before = await rpc(alice, 'sync_snapshot_page', [snapshot.id, 0])
    const parallel = await rpc(alice, 'sync_snapshot_begin')
    assert.notEqual(parallel.id, snapshot.id)
    await push([command('folder.patch', {id: 'news', name: 'После снимка'})])
    const repeated = await rpc(alice, 'sync_snapshot_page', [snapshot.id, 0])
    assert.deepEqual(repeated, before)
    await rpc(bob, 'create_profile')
    await assert.rejects(
        rpc(bob, 'sync_snapshot_page', [snapshot.id, 0]),
        /SNAPSHOT_EXPIRED/,
    )
    const delta = await rpc(alice, 'sync_pull', [epoch, snapshot.cursor, 100])
    assert.equal(
        delta.changes.flat().find((r) => r.kind === 'folder').data.name,
        'После снимка',
    )
})

test('deleting Start removes its data, preserves shared Auth and the neighbor app, and invalidates old queues', async () => {
    await rpc(alice, 'delete_profile', [epoch])
    assert.equal(
        (await db.query('select * from neighbor.notes')).rows[0].text,
        'Keep me',
    )
    assert.equal(
        (await db.query('select * from auth.users where id=$1', [alice])).rows
            .length,
        1,
    )
    const recreated = await rpc(alice, 'create_profile')
    assert.notEqual(recreated.epoch, epoch)
    await assert.rejects(
        rpc(alice, 'sync_push', [epoch, device, '0', '[]']),
        /EPOCH_MISMATCH/,
    )
    assert.equal(
        (await asUser(alice, (tx) => tx.query('select * from start.records')))
            .rows.length,
        0,
    )
})
