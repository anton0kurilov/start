import {
    entityKey,
    type Entity,
    type OutboxEntry,
    type Profile,
} from './sync-types.ts'

const STORES = ['profiles', 'records', 'base', 'outbox', 'metadata']
type RecordRow = Entity & {scope: string}

export function createLocalDatabase({
    factory = globalThis.indexedDB,
    name = 'start:data:v2',
}: {factory?: IDBFactory; name?: string} = {}) {
    let opening: Promise<IDBDatabase> | undefined
    let closed = false
    function open() {
        if (closed) return Promise.reject(new Error('Local database is closed'))
        if (!factory)
            return Promise.reject(new Error('IndexedDB is unavailable'))
        return (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
            const request = factory.open(name, 1)
            request.onupgradeneeded = () => {
                const db = request.result
                db.createObjectStore('profiles', {keyPath: 'key'})
                for (const store of ['records', 'base']) {
                    const rows = db.createObjectStore(store, {
                        keyPath: ['scope', 'kind', 'id'],
                    })
                    rows.createIndex('scope', 'scope')
                }
                const outbox = db.createObjectStore('outbox', {
                    keyPath: ['scope', 'sequence'],
                })
                outbox.createIndex('scope', 'scope')
                db.createObjectStore('metadata', {keyPath: 'key'})
            }
            request.onblocked = () =>
                reject(new Error('Закройте другие вкладки Start. и повторите.'))
            request.onerror = () => {
                opening = undefined
                reject(request.error || new Error('Cannot open IndexedDB'))
            }
            request.onsuccess = () => {
                const db = request.result
                if (closed) {
                    db.close()
                    reject(new Error('Local database is closed'))
                    return
                }
                db.onversionchange = () => {
                    db.close()
                    opening = undefined
                }
                resolve(db)
            }
        }))
    }
    async function transaction<T>(
        stores: string[],
        mode: IDBTransactionMode,
        run: (
            tx: IDBTransaction,
            result: (value: T) => void,
            protect: (task: () => void) => () => void,
        ) => void,
    ): Promise<T> {
        const db = await open()
        return new Promise<T>((resolve, reject) => {
            const tx = db.transaction(stores, mode)
            let value: T
            let failure: unknown
            tx.oncomplete = () => resolve(value)
            tx.onabort = () =>
                reject(
                    failure ||
                        tx.error ||
                        new Error('Local transaction aborted'),
                )
            function protect(task: () => void) {
                return () => {
                    try {
                        task()
                    } catch (error) {
                        failure = error
                        tx.abort()
                    }
                }
            }
            protect(() => run(tx, (next) => (value = next), protect))()
        })
    }
    function removeScope(
        store: IDBObjectStore,
        scope: string,
        done: () => void,
        protect: (task: () => void) => () => void,
    ) {
        const request = store
            .index('scope')
            .openKeyCursor(IDBKeyRange.only(scope))
        request.onsuccess = protect(() => {
            const cursor = request.result
            if (!cursor) {
                done()
                return
            }
            store.delete(cursor.primaryKey)
            cursor.continue()
        })
    }
    return {
        open,
        transaction,
        async load(scope: string) {
            return transaction<{
                profile: Profile | undefined
                records: Entity[]
                base: Entity[]
                outbox: OutboxEntry[]
            }>(STORES, 'readonly', (tx, result) => {
                const profile = tx.objectStore('profiles').get(scope)
                const records = tx
                    .objectStore('records')
                    .index('scope')
                    .getAll(scope)
                const base = tx.objectStore('base').index('scope').getAll(scope)
                const outbox = tx
                    .objectStore('outbox')
                    .index('scope')
                    .getAll(scope)
                outbox.onsuccess = () =>
                    result({
                        profile: profile.result,
                        records: records.result,
                        base: base.result,
                        outbox: outbox.result,
                    })
            })
        },
        getMetadata<T>(key: string) {
            return transaction<T | undefined>(
                ['metadata'],
                'readonly',
                (tx, result) => {
                    const request = tx.objectStore('metadata').get(key)
                    request.onsuccess = () => result(request.result?.value)
                },
            )
        },
        setMetadata(key: string, value: unknown) {
            return transaction<void>(['metadata'], 'readwrite', (tx) => {
                tx.objectStore('metadata').put({key, value})
            })
        },
        initialize(profile: Profile, records: Entity[], backup?: unknown) {
            const snapshot = structuredClone({profile, records, backup})
            return transaction<boolean>(
                STORES,
                'readwrite',
                (tx, result, protect) => {
                    const request = tx.objectStore('profiles').get(profile.key)
                    request.onsuccess = protect(() => {
                        if (request.result) {
                            result(false)
                            return
                        }
                        tx.objectStore('profiles').put(snapshot.profile)
                        for (const record of snapshot.records)
                            tx.objectStore('records').put({
                                ...record,
                                scope: profile.key,
                            })
                        if (snapshot.backup !== undefined)
                            tx.objectStore('metadata').put({
                                key: 'legacy-backup',
                                value: snapshot.backup,
                            })
                        result(true)
                    })
                },
            )
        },
        commit(
            expected: Profile,
            next: Profile,
            effects: Entity[],
            appended: OutboxEntry[] = [],
        ) {
            const snapshot = structuredClone({next, effects, appended})
            return transaction<boolean>(
                STORES,
                'readwrite',
                (tx, result, protect) => {
                    const request = tx.objectStore('profiles').get(expected.key)
                    request.onsuccess = protect(() => {
                        if (request.result?.version !== expected.version) {
                            result(false)
                            return
                        }
                        tx.objectStore('profiles').put(snapshot.next)
                        for (const record of snapshot.effects)
                            tx.objectStore('records').put({
                                ...record,
                                scope: expected.key,
                            })
                        for (const entry of snapshot.appended)
                            tx.objectStore('outbox').put(entry)
                        result(true)
                    })
                },
            )
        },
        reconcile(
            expected: Profile,
            next: Profile,
            base: Entity[],
            records: Entity[],
            outbox: OutboxEntry[],
        ) {
            const snapshot = structuredClone({next, base, records, outbox})
            return transaction<boolean>(
                STORES,
                'readwrite',
                (tx, result, protect) => {
                    const request = tx.objectStore('profiles').get(expected.key)
                    request.onsuccess = protect(() => {
                        if (request.result?.version !== expected.version) {
                            result(false)
                            return
                        }
                        tx.objectStore('profiles').put(snapshot.next)
                        let remaining = 3
                        const afterDelete = protect(() => {
                            if (--remaining) return
                            for (const row of snapshot.base)
                                tx.objectStore('base').put({
                                    ...row,
                                    scope: expected.key,
                                })
                            for (const row of snapshot.records)
                                tx.objectStore('records').put({
                                    ...row,
                                    scope: expected.key,
                                })
                            for (const row of snapshot.outbox)
                                tx.objectStore('outbox').put(row)
                            result(true)
                        })
                        for (const store of ['base', 'records', 'outbox'])
                            removeScope(
                                tx.objectStore(store),
                                expected.key,
                                afterDelete,
                                protect,
                            )
                    })
                },
            )
        },
        close() {
            closed = true
            void opening?.then(
                (db) => db.close(),
                () => {},
            )
        },
    }
}
export type LocalDatabase = ReturnType<typeof createLocalDatabase>
export function recordMap(records: Entity[]) {
    return new Map(records.map((row) => [entityKey(row.kind, row.id), row]))
}
