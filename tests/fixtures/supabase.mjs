import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {base58} from '@scure/base'
import {ed25519} from '@noble/curves/ed25519.js'
import {fixedTime} from './rss.mjs'

// Auth transport is simulated; the exact production SQL runs in PostgreSQL.
// No request in these scenarios reaches the user's shared Supabase project.
export async function supabaseFixture() {
    const db = new PGlite()
    await db.exec(
        `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
    )
    await db.exec(
        await readFile(
            new URL(
                '../../supabase/migrations/202611130001_start_sync.sql',
                import.meta.url,
            ),
            'utf8',
        ),
    )
    const users = new Map(),
        refresh = new Map(),
        requests = []
    let dropNextPush = false
    function session(user) {
        const now = Math.floor(fixedTime / 1000)
        const jwt = [
            Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString(
                'base64url',
            ),
            Buffer.from(
                JSON.stringify({
                    sub: user.id,
                    aud: 'authenticated',
                    role: 'authenticated',
                    iat: now,
                    exp: now + 3600,
                    session_id: randomUUID(),
                    iss: 'supabase-test',
                }),
            ).toString('base64url'),
            'test-signature',
        ].join('.')
        const token = randomUUID()
        refresh.set(token, user)
        return {
            access_token: jwt,
            refresh_token: token,
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: now + 3600,
            user,
        }
    }
    async function routeHandler(route) {
        const request = route.request(),
            url = new URL(request.url())
        const body = request.postDataJSON() || {}
        requests.push({path: url.pathname, body})
        const reply = (status, data) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(data),
            })
        try {
            if (url.pathname === '/auth/v1/token') {
                if (url.searchParams.get('grant_type') === 'refresh_token') {
                    const user = refresh.get(body.refresh_token)
                    return user
                        ? reply(200, session(user))
                        : reply(400, {msg: 'Invalid refresh token'})
                }
                // Match the hosted SIWS parser, rather than accepting every
                // cryptographically valid message from an unsupported origin.
                const lines = String(body.message).split('\n')
                const suffix = ' wants you to sign in with your Solana account:'
                const domain = lines[0]?.endsWith(suffix)
                    ? lines[0].slice(0, -suffix.length)
                    : ''
                const domainPattern =
                    /^(localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})(?::\d{1,5})?$/
                const signedUrl = new URL(
                    lines.find((line) => line.startsWith('URI: '))?.slice(5),
                )
                if (
                    !domainPattern.test(domain) ||
                    !(
                        signedUrl.protocol === 'https:' ||
                        signedUrl.hostname === 'localhost'
                    ) ||
                    signedUrl.host !== domain
                )
                    return reply(400, {
                        code: 'validation_failed',
                        message: 'Invalid SIWS origin',
                    })
                const key = String(body.message).split('\n')[1]?.trim()
                const valid =
                    key &&
                    ed25519.verify(
                        Buffer.from(body.signature, 'base64url'),
                        new TextEncoder().encode(body.message),
                        base58.decode(key),
                    )
                if (!valid) return reply(401, {msg: 'Invalid signature'})
                let user = users.get(key)
                if (!user) {
                    user = {
                        id: randomUUID(),
                        aud: 'authenticated',
                        role: 'authenticated',
                        app_metadata: {provider: 'web3', providers: ['web3']},
                        user_metadata: {},
                        identities: [],
                        created_at: new Date(fixedTime).toISOString(),
                    }
                    users.set(key, user)
                    await db.query('insert into auth.users values($1)', [
                        user.id,
                    ])
                }
                return reply(200, session(user))
            }
            const bearer = request.headers().authorization?.slice(7)
            let userId
            try {
                userId = JSON.parse(
                    Buffer.from(bearer.split('.')[1], 'base64url'),
                ).sub
            } catch {}
            if (url.pathname === '/auth/v1/logout')
                return route.fulfill({status: 204})
            if (!userId) return reply(401, {message: 'AUTH_REQUIRED'})
            if (url.pathname === '/auth/v1/user')
                return reply(
                    200,
                    [...users.values()].find((u) => u.id === userId),
                )
            let result = await db.transaction(async (tx) => {
                await tx.query(
                    "select set_config('request.jwt.claim.sub',$1,true)",
                    [userId],
                )
                await tx.exec('set local role authenticated')
                if (url.pathname === '/rest/v1/profiles')
                    return (
                        await tx.query(
                            'select user_id from start.profiles where user_id=$1',
                            [userId],
                        )
                    ).rows
                const name = url.pathname.split('/').at(-1)
                if (
                    ![
                        'create_profile',
                        'sync_register_device',
                        'sync_push',
                        'sync_pull',
                        'sync_snapshot_begin',
                        'sync_snapshot_page',
                        'reset_account',
                        'reset_learning',
                        'delete_profile',
                    ].includes(name)
                )
                    throw new Error('Unknown test RPC')
                const entries = Object.entries(body)
                for (const [key] of entries)
                    if (!/^p_[a-z_]+$/.test(key))
                        throw new Error('Invalid test RPC argument')
                const args = entries
                    .map(([key], i) => `${key} => $${i + 1}`)
                    .join(',')
                return (
                    await tx.query(
                        `select start.${name}(${args}) as value`,
                        entries.map(([, value]) =>
                            typeof value === 'object'
                                ? JSON.stringify(value)
                                : value,
                        ),
                    )
                ).rows[0].value
            })
            if (url.pathname.endsWith('sync_push') && dropNextPush) {
                dropNextPush = false
                return route.abort('failed')
            }
            if (
                url.pathname === '/rest/v1/profiles' &&
                request.headers().accept?.includes('vnd.pgrst.object')
            )
                result = result[0] || null
            return reply(200, result)
        } catch (error) {
            return reply(400, {
                code: error.code || 'P0001',
                message: error.message,
            })
        }
    }
    return {
        db,
        requests,
        users,
        route: async (page) =>
            page.route('https://*.supabase.co/**', routeHandler),
        dropPushResponse() {
            dropNextPush = true
        },
        close: () => db.close(),
    }
}
