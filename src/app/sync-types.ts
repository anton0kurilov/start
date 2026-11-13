import type {Folder, Settings} from './types'

export type EntityKind =
    | 'folder'
    | 'subscription'
    | 'preference'
    | 'phrase'
    | 'read'
    | 'feedback'
    | 'event'
    | 'observation'

export type Entity = {
    kind: EntityKind
    id: string
    data: Record<string, any>
    revision: string
    deleted: boolean
}
export type Command = {
    protocol_version: 1
    op_id: string
    type: string
    payload: Record<string, any>
    client_seq?: string
    account_epoch?: string
    learning_epoch?: string
}
export type Profile = {
    key: string
    userId: string | null
    deviceId: string
    learnerId: string
    generation: string
    version: number
    nextSequence: number
    epoch: string | null
    learningEpoch: string | null
    cursor: string
    semanticEnabled: boolean
    lastUpdated: string | null
}
export type OutboxEntry = {
    scope: string
    sequence: number
    command: Command
    acceptedRevision?: string
}
export type EntityMap = Map<string, Entity>
export type DomainState = {
    folders: Folder[]
    settings: Settings
    visitedItemKeys: string[]
    clickedItemKeys: string[]
    modelState: Record<string, any>
    predictionGeneration?: string
    lastUpdated: string | null
}
export type SyncStatus = {
    status: 'local' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error'
    configured: boolean
    userId: string | null
    pending: number
    error: string
    lastSynced: string | null
}
export function entityKey(kind: EntityKind, id: string) {
    return `${kind}:${id}`
}
export function newProfile(
    key = 'guest',
    userId: string | null = null,
): Profile {
    return {
        key,
        userId,
        deviceId: crypto.randomUUID(),
        learnerId: crypto.randomUUID(),
        generation: crypto.randomUUID(),
        version: 0,
        nextSequence: 1,
        epoch: null,
        learningEpoch: null,
        cursor: '0',
        semanticEnabled: false,
        lastUpdated: null,
    }
}
