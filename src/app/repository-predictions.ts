import type {Repository} from './repository.ts'
import {command} from './commands.ts'
import type {createPredictionStorage} from './prediction-storage.ts'

type Observation = {
    itemKey: string
    profileId: string
    deadlineAt: number
    completedAt: number | null
    [key: string]: any
}

// The live profile uses the same transaction journal as reading and settings.
// Legacy standalone stores remain readable by the one-time migration only.
export function repositoryPredictionStorage(
    repository: Repository,
    now = Date.now,
) {
    return (_options: {
        dbName: string
    }): ReturnType<typeof createPredictionStorage<Observation>> => {
        let closed = false
        const check = () => {
            if (closed) throw new Error('Prediction storage closed')
        }
        return {
            async getProfileId() {
                check()
                return repository.profile.learnerId
            },
            async listObservations() {
                check()
                const rows = repository.observations(
                    repository.profile.learnerId,
                ) as Observation[]
                return [
                    ...rows.filter((row) => row.completedAt === null),
                    ...rows
                        .filter(
                            (row) =>
                                row.completedAt !== null &&
                                row.firstShownAt >= now() - 90 * 86400000,
                        )
                        .sort((a, b) => b.firstShownAt - a.firstShownAt)
                        .slice(0, 10000),
                ]
            },
            async updateObservation(key, update) {
                check()
                let next: Observation | null = null
                await repository.dispatch(() => {
                    check()
                    const profile = repository.profile
                    const current =
                        (repository
                            .observations(profile.learnerId)
                            .find((r) => r.itemKey === key) as Observation) ||
                        null
                    next = update(current)
                    // Cache retention cannot delete shared source history.
                    if (!next) return []
                    if (
                        next.itemKey !== key ||
                        next.profileId !== profile.learnerId
                    )
                        throw new Error('Invalid prediction observation key')
                    if (JSON.stringify(current) === JSON.stringify(next))
                        return []
                    return [
                        command('prediction.update', {
                            observation: next,
                            deviceId: profile.deviceId,
                            generation: profile.generation,
                        }),
                    ]
                })
                return next
            },
            async replaceObservations() {
                throw new Error('Use repository import')
            },
            async clear() {
                /* A profile switch must not erase shared history. */
            },
            close() {
                closed = true
            },
        }
    }
}
