import {STORAGE_KEY, MODEL_STATE_SCHEMA_VERSION} from '../scripts/constants.js'
import {decodeStoredState} from '../scripts/storage.js'
import {
    createDefaultState,
    normalizeStatePayload,
} from '../scripts/state-normalizers.js'
import {normalizeClickObservation} from '../scripts/click-observations.js'
import {legacyEntities} from './commands.ts'
import {newProfile, type DomainState} from './sync-types.ts'
import type {LocalDatabase} from './local-database.ts'

export async function readLegacyPredictions(factory: IDBFactory, name: string) {
    return new Promise<{
        profileId?: string
        observations: Record<string, any>[]
    } | null>((resolve, reject) => {
        let absent = false
        const request = factory.open(name)
        request.onupgradeneeded = () => {
            absent = true
            request.transaction!.abort()
        }
        request.onerror = () => (absent ? resolve(null) : reject(request.error))
        request.onblocked = () =>
            reject(new Error('Legacy prediction database is blocked'))
        request.onsuccess = () => {
            const db = request.result
            if (
                !db.objectStoreNames.contains('observations') ||
                !db.objectStoreNames.contains('metadata')
            ) {
                db.close()
                reject(new Error('Invalid legacy prediction database'))
                return
            }
            const tx = db.transaction(['observations', 'metadata'])
            const rows = tx.objectStore('observations').getAll()
            const profile = tx.objectStore('metadata').get('profileId')
            tx.oncomplete = () => {
                db.close()
                resolve({
                    profileId: profile.result?.value,
                    observations: rows.result,
                })
            }
            tx.onabort = () => {
                db.close()
                reject(tx.error)
            }
        }
    })
}
export async function migrateLegacy(
    database: LocalDatabase,
    {
        storage = globalThis.localStorage,
        factory = globalThis.indexedDB,
    }: {storage?: Pick<Storage, 'getItem'>; factory?: IDBFactory} = {},
) {
    if ((await database.load('guest')).profile) return
    const raw = storage?.getItem(STORAGE_KEY) ?? null
    let state = createDefaultState() as DomainState
    if (raw !== null) {
        const decoded = decodeStoredState(JSON.parse(raw))
        if (!decoded || !Array.isArray(decoded.folders))
            throw new Error(
                'Старые данные повреждены. Исходная копия сохранена.',
            )
        if (
            decoded.modelState?.interactionLog?.length &&
            Number(decoded.modelState.schemaVersion) !==
                MODEL_STATE_SCHEMA_VERSION
        )
            throw new Error(
                'Неизвестный формат истории. Исходная копия сохранена.',
            )
        const normalized = normalizeStatePayload(decoded)
        if (!normalized) throw new Error('Cannot normalize legacy state')
        state = normalized as DomainState
    }
    const profile = newProfile()
    profile.semanticEnabled = Boolean(state.settings.semanticEnabled)
    let legacy = null
    if (state.predictionGeneration && factory) {
        legacy = await readLegacyPredictions(
            factory,
            `start:predictions:${state.predictionGeneration}`,
        )
        if (legacy?.profileId) profile.learnerId = legacy.profileId
    }
    const observations = (legacy?.observations || []).map((row) => {
        const normalized = normalizeClickObservation(row)
        if (
            !normalized ||
            (legacy?.profileId && normalized.profileId !== legacy.profileId)
        )
            throw new Error(
                'История прогнозов повреждена. Исходная копия сохранена.',
            )
        return normalized
    })
    await database.initialize(
        profile,
        legacyEntities(state, observations, profile),
        {raw, predictions: legacy, migratedAt: new Date().toISOString()},
    )
    await database.setMetadata('model-cache:guest', state.modelState)
}
