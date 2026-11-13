import {get, readonly, writable} from 'svelte/store'
import {createSupabase, cloudError} from './supabase.ts'
import {identityFromPhrase, web3SignInUrl} from './identity.ts'
import {createRepository, type Repository} from './repository.ts'
import {createSync} from './sync.ts'
import {command} from './commands.ts'
import {newProfile, type SyncStatus} from './sync-types.ts'
import type {LocalDatabase} from './local-database.ts'
import type {Session} from '@supabase/supabase-js'

export function createCloud(
    database: LocalDatabase,
    activate: (repository: Repository) => Promise<void>,
) {
    const client = createSupabase(database)
    const state = writable<SyncStatus>({
        status: 'local',
        configured: Boolean(client),
        userId: null,
        pending: 0,
        error: '',
        lastSynced: null,
    })
    let repository: Repository
    let engine: ReturnType<typeof createSync> | undefined
    let busy = false
    let disposed = false
    const update = (changes: Partial<SyncStatus>) => {
        if (!disposed) state.update((s) => ({...s, ...changes}))
    }
    function bind(next: Repository) {
        engine?.stop()
        repository = next
        update({
            userId: next.profile.userId,
            pending: next.pending.length,
            status: next.profile.userId ? 'connecting' : 'local',
            error: '',
        })
        engine =
            client && next.profile.userId
                ? createSync(next, client, update)
                : undefined
    }
    async function rpc<T>(
        name: string,
        args: Record<string, any> = {},
        owner = repository.profile.userId,
    ): Promise<T> {
        if (!client) throw new Error('Cloud is not configured')
        const {data, error} = await client.auth.getSession()
        if (error) throw error
        if (!owner || data.session?.user.id !== owner)
            throw new Error('AUTH_OWNER_CHANGED')
        const result = await client
            .schema('start')
            .rpc(name, args)
            .setHeader('Authorization', `Bearer ${data.session.access_token}`)
        if (result.error) throw result.error
        return result.data as T
    }
    async function accountRepository(userId: string) {
        const key = `user:${userId}`
        if (!(await database.load(key)).profile)
            await database.initialize(newProfile(key, userId), [])
        return createRepository(database, key)
    }
    async function switchTo(next: Repository) {
        engine?.stop()
        await database.setMetadata('active-profile', next.profile.key)
        await activate(next)
        bind(next)
        engine?.start()
    }
    async function connect(phrase: string, create: boolean) {
        if (!client || busy)
            return {ok: false, error: 'Подключение сейчас недоступно.'}
        let identity: Awaited<ReturnType<typeof identityFromPhrase>> | undefined
        let signInUrl: string
        try {
            signInUrl = web3SignInUrl(location.href)
            identity = await identityFromPhrase(phrase)
        } catch (error) {
            return {ok: false, error: cloudError(error)}
        }
        busy = true
        engine?.stop()
        const previousRepository = repository
        let previousSession: Session | null = null
        let signedSession: Session | null = null
        update({status: 'connecting', error: ''})
        let guest = repository
        let next: Repository | undefined
        try {
            const previous = await client.auth.getSession()
            if (previous.error) throw previous.error
            previousSession = previous.data.session
            if (repository.profile.userId)
                guest = await createRepository(database)
            const now = Date.now()
            const auth = await client.auth.signInWithWeb3({
                chain: 'solana',
                wallet: identity.wallet,
                options: {
                    url: signInUrl,
                    signInWithSolana: {
                        nonce: crypto.randomUUID().replaceAll('-', ''),
                        expirationTime: new Date(now + 5 * 60000).toISOString(),
                    },
                },
            })
            identity.destroy()
            if (auth.error) throw auth.error
            signedSession = auth.data.session
            const user = auth.data.user
            if (!user) throw new Error('Auth session unavailable')
            if (create) await rpc('create_profile', {}, user.id)
            else {
                const result = await client
                    .schema('start')
                    .from('profiles')
                    .select('user_id')
                    .eq('user_id', user.id)
                    .maybeSingle()
                if (result.error) throw result.error
                if (!result.data) throw new Error('PROFILE_NOT_FOUND')
            }
            next = await accountRepository(user.id)
            const preparation = createSync(next, client, update)
            try {
                await preparation.sync()
            } finally {
                preparation.stop()
            }
            if (create && next.entities.length === 0) {
                const guestProfile = guest.profile
                await next.updateLocal({
                    learnerId: guestProfile.learnerId,
                    generation: guestProfile.generation,
                    semanticEnabled: guestProfile.semanticEnabled,
                })
                const entities = guest.entities.filter((r) => !r.deleted)
                const priority: Record<string, number> = {
                    folder: 0,
                    subscription: 1,
                    preference: 2,
                    phrase: 3,
                    read: 4,
                    feedback: 5,
                    event: 6,
                    observation: 7,
                }
                entities.sort((a, b) => priority[a.kind] - priority[b.kind])
                for (let i = 0; i < entities.length; i += 50)
                    await next.dispatch(
                        entities.slice(i, i + 50).map((row) => {
                            if (row.kind === 'observation')
                                row.data.ownerDeviceId =
                                    row.data.ownerDeviceId ===
                                    guestProfile.deviceId
                                        ? next!.profile.deviceId
                                        : null
                            return command('entity.seed', {entity: row})
                        }),
                    )
            }
            await switchTo(next)
            next = undefined
            return {ok: true}
        } catch (error) {
            if (next !== repository) next?.close()
            const current = (await client.auth.getSession().catch(() => null))
                ?.data.session
            // Never sign out a session installed by another tab while this
            // connection was pending. Restore only the session we replaced.
            if (
                signedSession &&
                current?.access_token === signedSession.access_token
            ) {
                await client.auth.signOut({scope: 'local'}).catch(() => {})
                if (previousSession)
                    await client.auth
                        .setSession({
                            access_token: previousSession.access_token,
                            refresh_token: previousSession.refresh_token,
                        })
                        .catch(() => {})
            }
            if (repository === previousRepository) {
                bind(previousRepository)
                engine?.start()
            }
            update({status: 'error', error: cloudError(error)})
            return {ok: false, error: cloudError(error)}
        } finally {
            identity?.destroy()
            if (guest !== repository) guest.close()
            busy = false
        }
    }
    async function disconnectLocal() {
        await repository.flush()
        const result = await client?.auth.signOut({scope: 'local'})
        if (result?.error) throw result.error
        await switchTo(await createRepository(database))
    }
    const service = {
        state: readonly(state),
        get snapshot() {
            return get(state)
        },
        bind,
        async bootstrap(initial: Repository) {
            bind(initial)
            if (!client) return
            try {
                const {data, error} = await client.auth.getSession()
                if (error) throw error
                const user = data.session?.user
                if (!user) {
                    if (initial.profile.userId)
                        update({
                            status: 'error',
                            error: 'Для синхронизации снова введите фразу доступа. Локальные данные сохранены.',
                        })
                    return
                }
                if (initial.profile.userId === user.id) {
                    engine?.start()
                    return
                }
                const next = await accountRepository(user.id)
                const preparation = createSync(next, client, update)
                try {
                    await preparation.sync()
                } catch (error) {
                    next.close()
                    throw error
                } finally {
                    preparation.stop()
                }
                await switchTo(next)
            } catch (error) {
                update({status: 'error', error: cloudError(error)})
            }
        },
        createProfile: (phrase: string) => connect(phrase, true),
        connectProfile: (phrase: string) => connect(phrase, false),
        async synchronize() {
            try {
                await engine?.sync()
                return {ok: true}
            } catch (error) {
                return {ok: false, error: cloudError(error)}
            }
        },
        async disconnect() {
            if (busy) return
            busy = true
            engine?.stop()
            try {
                await disconnectLocal()
            } catch (error) {
                bind(repository)
                engine?.start()
                throw error
            } finally {
                busy = false
            }
        },
        async resetProfile() {
            if (busy || !repository.profile.epoch) return
            busy = true
            engine?.stop()
            let next: Repository | undefined
            try {
                await repository.flush()
                await rpc('reset_account', {
                    p_expected: repository.profile.epoch,
                })
                next = await accountRepository(repository.profile.userId!)
                const preparation = createSync(next, client!, update)
                try {
                    await preparation.sync()
                } finally {
                    preparation.stop()
                }
                await switchTo(next)
            } catch (error) {
                if (next !== repository) next?.close()
                bind(repository)
                engine?.start()
                throw error
            } finally {
                busy = false
            }
        },
        async deleteProfile() {
            if (busy) return
            busy = true
            engine?.stop()
            try {
                await rpc('delete_profile', {
                    p_expected: repository.profile.epoch,
                })
                await disconnectLocal()
            } catch (error) {
                bind(repository)
                engine?.start()
                throw error
            } finally {
                busy = false
            }
        },
        dispose() {
            disposed = true
            engine?.stop()
            client?.auth.stopAutoRefresh()
        },
    }
    return service
}
export type CloudService = ReturnType<typeof createCloud>
