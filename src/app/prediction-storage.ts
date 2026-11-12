export type PredictionRecord = {itemKey: string; [key: string]: unknown}

// Callbacks run synchronously inside the IndexedDB transaction. Resolving only
// on transaction completion means callers never mistake a successful put
// request for a durable commit.
export function createPredictionStorage<
    Observation extends {itemKey: string} = PredictionRecord,
>({
    factory = typeof indexedDB === 'undefined' ? null : indexedDB,
    dbName = 'start:predictions:v1',
}: {factory?: IDBFactory | null; dbName?: string} = {}) {
    let database: Promise<IDBDatabase> | null = null
    let closed = false

    function open(): Promise<IDBDatabase> {
        if (closed)
            return Promise.reject(new Error('Prediction storage is closed'))
        if (!factory)
            return Promise.reject(new Error('IndexedDB is unavailable'))
        if (database) return database
        const promise = new Promise<IDBDatabase>((resolve, reject) => {
            let settled = false
            const request = factory.open(dbName, 1)
            request.onupgradeneeded = () => {
                if (settled || closed) {
                    request.transaction?.abort()
                    return
                }
                const db = request.result
                db.createObjectStore('observations', {keyPath: 'itemKey'})
                db.createObjectStore('metadata', {keyPath: 'key'})
            }
            request.onblocked = () => {
                settled = true
                reject(new Error('Prediction storage upgrade is blocked'))
            }
            request.onerror = () => {
                settled = true
                reject(
                    request.error ||
                        new Error('Cannot open prediction storage'),
                )
            }
            request.onsuccess = () => {
                const db = request.result
                if (settled || closed) {
                    db.close()
                    reject(new Error('Prediction storage is closed'))
                    return
                }
                settled = true
                db.onversionchange = () => {
                    db.close()
                    if (database === promise) database = null
                }
                resolve(db)
            }
        })
        database = promise
        void promise.catch(() => {
            if (database === promise) database = null
        })
        return promise
    }

    async function transaction<Result>(
        stores: string[],
        mode: IDBTransactionMode,
        run: (
            tx: IDBTransaction,
            result: (value: Result) => void,
            fail: (error: unknown) => void,
        ) => void,
    ): Promise<Result> {
        const db = await open()
        if (closed) throw new Error('Prediction storage is closed')
        return new Promise<Result>((resolve, reject) => {
            const tx = db.transaction(stores, mode)
            let value: Result
            let failure: unknown
            tx.oncomplete = () => resolve(value)
            tx.onabort = () =>
                reject(
                    failure ||
                        tx.error ||
                        new Error('Prediction storage transaction aborted'),
                )
            const fail = (error: unknown) => {
                failure = error
                tx.abort()
            }
            try {
                run(
                    tx,
                    (result) => {
                        value = result
                    },
                    fail,
                )
            } catch (error) {
                fail(error)
            }
        })
    }

    function checkRecord(record: Observation, expectedKey?: string) {
        if (
            !record ||
            typeof record !== 'object' ||
            typeof record.itemKey !== 'string' ||
            !record.itemKey.trim() ||
            (expectedKey !== undefined && record.itemKey !== expectedKey)
        )
            throw new Error('Invalid prediction observation key')
    }

    return {
        getProfileId() {
            return transaction<string>(
                ['metadata'],
                'readwrite',
                (tx, result, fail) => {
                    const store = tx.objectStore('metadata')
                    const request = store.get('profileId')
                    request.onsuccess = () => {
                        try {
                            const id =
                                request.result === undefined
                                    ? crypto.randomUUID()
                                    : request.result.value
                            if (typeof id !== 'string' || !id.trim())
                                throw new Error(
                                    'Invalid stored prediction profile',
                                )
                            if (request.result === undefined)
                                store.put({key: 'profileId', value: id})
                            result(id)
                        } catch (error) {
                            fail(error)
                        }
                    }
                },
            )
        },
        updateObservation(
            itemKey: string,
            update: (current: Observation | null) => Observation | null,
        ) {
            if (typeof itemKey !== 'string' || !itemKey.trim())
                return Promise.reject(
                    new Error('Invalid prediction observation key'),
                )
            return transaction<Observation | null>(
                ['observations'],
                'readwrite',
                (tx, result, fail) => {
                    const store = tx.objectStore('observations')
                    const request = store.get(itemKey)
                    request.onsuccess = () => {
                        try {
                            const next = update(request.result ?? null)
                            if (next === null) store.delete(itemKey)
                            else {
                                checkRecord(next, itemKey)
                                store.put(next)
                            }
                            result(next)
                        } catch (error) {
                            fail(error)
                        }
                    }
                },
            )
        },
        listObservations() {
            return transaction<Observation[]>(
                ['observations'],
                'readonly',
                (tx, result) => {
                    const request = tx.objectStore('observations').getAll()
                    request.onsuccess = () => result(request.result)
                },
            )
        },
        async replaceObservations(records: Observation[], profileId?: string) {
            if (!Array.isArray(records))
                throw new Error('Invalid prediction observations')
            if (
                profileId !== undefined &&
                (typeof profileId !== 'string' || !profileId.trim())
            )
                throw new Error('Invalid prediction profile')
            const keys = new Set<string>()
            for (const record of records) {
                checkRecord(record)
                if (keys.has(record.itemKey))
                    throw new Error('Duplicate prediction observation')
                keys.add(record.itemKey)
            }
            // Clone before awaiting open: caller mutations cannot change the
            // validated import while the database is opening.
            const snapshot = structuredClone(records)
            return transaction<void>(
                ['observations', 'metadata'],
                'readwrite',
                (tx, result) => {
                    const store = tx.objectStore('observations')
                    store.clear()
                    for (const record of snapshot) store.put(record)
                    if (profileId !== undefined)
                        tx.objectStore('metadata').put({
                            key: 'profileId',
                            value: profileId,
                        })
                    result(undefined)
                },
            )
        },
        clear() {
            return transaction<void>(
                ['observations', 'metadata'],
                'readwrite',
                (tx, result) => {
                    tx.objectStore('observations').clear()
                    tx.objectStore('metadata').clear()
                    result(undefined)
                },
            )
        },
        close() {
            closed = true
            void database?.then(
                (db) => db.close(),
                () => {},
            )
        },
    }
}

export type PredictionStorage = ReturnType<typeof createPredictionStorage>
