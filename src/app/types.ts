export interface Feed {
    id: string
    name: string
    url: string
    isFavorite: boolean
}
export interface Folder {
    id: string
    name: string
    feeds: Feed[]
}
export interface Settings {
    semanticEnabled?: boolean
    autoMarkReadOnScroll: boolean
    autoRefreshFeeds: boolean
    showRecommendedColumn: boolean
    blockedTitlePhrases: string[]
}
export interface Usefulness {
    tone: string
    score: number | null
    label: string
    title: string
    percentage?: number | null
}
export interface Item {
    description?: string
    id: string
    feedId: string
    title: string
    source: string
    link: string
    date: Date | null
}
export interface Card extends Item {
    itemKey: string
    cardKey: string
    visited: boolean
    dismissed: boolean
    favorite: boolean
    usefulness: Usefulness
}
export interface Column {
    key: string
    title: string
    recommended: boolean
    cards: Card[]
    hasFeeds: boolean
    errors: {id: string; name: string; message: string}[]
}
export interface AppViewState {
    sync?: import('./sync-types').SyncStatus
    persistenceError?: string
    predictionHistory?: 'loading' | 'ready' | 'error'
    semantics?: {status: string; loaded: number; total: number}
    folders: Folder[]
    settings: Settings
    columns: Column[]
    lastUpdated: string | null
    refreshing: boolean
    refreshError: string
    now: number
}
export interface FeedInput {
    folderId: string
    name: string
    url: string
}
export interface Result {
    ok: boolean
    error?: string
    urlChanged?: boolean
}
