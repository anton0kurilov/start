import type {Repository} from './repository.ts'
import type {Entity, SyncStatus} from './sync-types.ts'
import {cloudError, type CloudClient} from './supabase.ts'

export function createSync(
    repository: Repository,
    client: CloudClient,
    onStatus: (status: Partial<SyncStatus>) => void,
    host: Window | null = typeof window === 'undefined' ? null : window,
) {
    const offline = () => host?.navigator.onLine === false
    let stopped = false
    let running: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const requests = new AbortController()
    let needsSnapshot = repository.profile.epoch === null
    async function rpc<T>(
        name: string,
        args: Record<string, any> = {},
    ): Promise<T> {
        if (stopped) throw new Error('Sync stopped')
        const {data} = await client.auth.getSession()
        if (stopped || data.session?.user.id !== repository.profile.userId)
            throw new Error('AUTH_OWNER_CHANGED')
        const result = await client
            .schema('start')
            .rpc(name, args)
            .setHeader('Authorization', `Bearer ${data.session.access_token}`)
            .abortSignal(requests.signal)
        if (result.error) throw result.error
        if (stopped) throw new Error('Sync stopped')
        return result.data as T
    }
    async function snapshot() {
        const start = await rpc<{
            id: string
            epoch: string
            learningEpoch: string
            cursor: string
        }>('sync_snapshot_begin')
        const changes: Entity[] = []
        let after = 0
        for (;;) {
            const page = await rpc<{
                records: Entity[]
                next: number
                done: boolean
            }>('sync_snapshot_page', {p_id: start.id, p_after: after})
            changes.push(...page.records)
            if (page.done) break
            if (page.next <= after) throw new Error('Invalid snapshot cursor')
            after = page.next
        }
        await repository.reconcile({...start, changes, snapshot: true})
        needsSnapshot = false
    }
    async function pull(receipts?: any[]) {
        for (;;) {
            const profile = repository.profile
            const result = await rpc<{
                epoch: string
                learningEpoch: string
                head: string
                cursor: string
                changes: Entity[][]
            }>('sync_pull', {
                p_epoch: profile.epoch,
                p_after: profile.cursor,
                p_limit: 100,
            })
            await repository.reconcile({
                ...result,
                changes: result.changes.flat(),
                receipts,
            })
            receipts = undefined
            if (BigInt(result.cursor) >= BigInt(result.head)) return
            if (result.cursor === profile.cursor)
                throw new Error('Invalid delta cursor')
        }
    }
    async function run() {
        if (stopped || host?.document.visibilityState === 'hidden') return
        clearTimeout(timer)
        if (offline()) {
            onStatus({status: 'offline'})
            return
        }
        onStatus({
            status: 'syncing',
            error: '',
            pending: repository.pending.length,
        })
        try {
            let profile = repository.profile
            if (needsSnapshot) await snapshot()
            try {
                await pull()
            } catch (error) {
                if (
                    /EPOCH_MISMATCH|SNAPSHOT_REQUIRED/.test(
                        (error as Error).message,
                    )
                )
                    await snapshot()
                else throw error
            }
            profile = repository.profile
            await rpc('sync_register_device', {p_device: profile.deviceId})
            for (let batchNumber = 0; batchNumber < 100; batchNumber++) {
                const pending = repository.pending.filter(
                    (r) => !r.acceptedRevision,
                )
                if (!pending.length) break
                const commands = []
                let bytes = 0
                for (const entry of pending.slice(0, 100)) {
                    const length = new TextEncoder().encode(
                        JSON.stringify(entry.command),
                    ).length
                    if (bytes + length > 240000) break
                    commands.push(entry.command)
                    bytes += length
                }
                if (!commands.length)
                    throw new Error('Command exceeds batch size')
                profile = repository.profile
                const pushed = await rpc<{receipts: any[]}>('sync_push', {
                    p_epoch: profile.epoch,
                    p_device: profile.deviceId,
                    p_base_revision: profile.cursor,
                    p_commands: commands,
                })
                await pull(pushed.receipts)
                onStatus({pending: repository.pending.length})
            }
            failures = 0
            onStatus({
                status: repository.pending.length ? 'syncing' : 'synced',
                error: '',
                pending: repository.pending.length,
                lastSynced: new Date().toISOString(),
            })
        } catch (error) {
            if (stopped) return
            failures++
            if (
                /EPOCH_MISMATCH|SNAPSHOT_REQUIRED/.test(
                    (error as Error).message,
                )
            )
                needsSnapshot = true
            onStatus({
                status: offline() ? 'offline' : 'error',
                error: cloudError(error),
                pending: repository.pending.length,
            })
            throw error
        } finally {
            if (!stopped)
                schedule(
                    failures
                        ? Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) *
                              (0.75 + Math.random() * 0.5)
                        : repository.pending.length
                          ? 1000
                          : 60000,
                )
        }
    }
    function sync() {
        if (running) return running
        running = run().finally(() => {
            running = null
        })
        return running
    }
    function schedule(delay = 750) {
        clearTimeout(timer)
        if (!stopped)
            timer = setTimeout(() => {
                void sync().catch(() => {})
            }, delay)
    }
    function wake() {
        if (!host || host.document.visibilityState !== 'hidden')
            void sync().catch(() => {})
    }
    const unsubscribe = repository.subscribe(() => {
        onStatus({pending: repository.pending.length})
        if (!running && repository.pending.length) schedule()
    })
    for (const event of ['online', 'focus', 'pageshow'])
        host?.addEventListener(event, wake)
    host?.document.addEventListener('visibilitychange', wake)
    return {
        sync,
        snapshot,
        start() {
            schedule(0)
        },
        stop() {
            stopped = true
            requests.abort()
            clearTimeout(timer)
            unsubscribe()
            for (const event of ['online', 'focus', 'pageshow'])
                host?.removeEventListener(event, wake)
            host?.document.removeEventListener('visibilitychange', wake)
        },
    }
}
