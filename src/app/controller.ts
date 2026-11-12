import {readonly, writable} from 'svelte/store'
import * as domain from '../scripts/domain.js'
import {
    AUTO_REFRESH_INTERVAL_MS,
    MAX_ITEMS_PER_FOLDER,
} from '../scripts/constants.js'
import {normalizeHttpUrl, normalizeUrl} from '../scripts/utils.js'
import type {
    AppViewState,
    Card,
    Column,
    FeedInput,
    Folder,
    Item,
    Result,
    Settings,
} from './types'

export function itemKey(item: Item) {
    return String(
        item.link ||
            item.id ||
            `${item.source}|${item.title}|${item.date?.toISOString() || ''}`,
    ).trim()
}

export function createAppController({
    api = domain,
    now = Date.now,
    isOnline = () =>
        typeof navigator === 'undefined' || navigator.onLine !== false,
    host = typeof window === 'undefined' ? null : window,
}: {
    api?: typeof domain
    now?: () => number
    isOnline?: () => boolean
    host?: Window | null
} = {}) {
    let disposed = false
    let generation = 0
    let requests = new AbortController()
    let refreshing = false
    let refreshError = ''
    let refreshPromise: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let clock: ReturnType<typeof setInterval> | undefined
    const beforeUpdate = new Set<() => void>()
    let view = snapshot()
    const store = writable(view)

    function snapshot(): AppViewState {
        const state = api.getState() as unknown as {
            folders: Folder[]
            settings: Settings
            lastUpdated: string | null
        }
        const folders = state.folders.map((f: Folder) => ({
            ...f,
            feeds: f.feeds.map((feed) => ({...feed})),
        })) as Folder[]
        const favorites = new Set(
            folders.flatMap((folder) =>
                folder.feeds
                    .filter((feed) => feed.isFavorite)
                    .map((feed) => feed.id),
            ),
        )
        const card = (item: Item): Card => ({
            ...item,
            itemKey: itemKey(item),
            cardKey: `${item.feedId}:${item.id}`,
            visited: api.isItemVisited(itemKey(item)),
            dismissed: api.isItemDismissed(itemKey(item)),
            favorite: favorites.has(item.feedId),
            usefulness: api.getFeedItemUsefulness(item),
        })
        const folderItems = folders.map(
            (folder) => api.getFolderItems(folder) as Item[],
        )
        const columns: Column[] = folders.map((folder, i) => ({
            key: `folder:${folder.id}`,
            title: folder.name,
            recommended: false,
            hasFeeds: !!folder.feeds.length,
            cards: folderItems[i].slice(0, MAX_ITEMS_PER_FOLDER).map(card),
            errors: folder.feeds
                .filter((feed) => api.getFeedError(feed.id))
                .map((feed) => ({
                    id: feed.id,
                    name: feed.name,
                    message: api.getFeedError(feed.id),
                })),
        }))
        if (state.settings.showRecommendedColumn && folders.length) {
            const recommendations = folderItems
                .flat()
                .map((item) => ({
                    item,
                    usefulness: api.getFeedItemUsefulness(item, {
                        includeClickBoost: false,
                    }),
                }))
                .filter((entry) => entry.usefulness.tone === 'high')
                .sort(
                    (a, b) =>
                        (b.item.date?.getTime() || 0) -
                            (a.item.date?.getTime() || 0) ||
                        (b.usefulness.score || 0) - (a.usefulness.score || 0),
                )
            columns.unshift({
                key: 'recommended',
                title: 'Рекомендуемое',
                recommended: true,
                hasFeeds: folders.some((folder) => folder.feeds.length),
                errors: [],
                cards: recommendations
                    .slice(0, MAX_ITEMS_PER_FOLDER)
                    .map((entry) => card(entry.item)),
            })
        }
        return {
            folders,
            settings: {
                ...state.settings,
                blockedTitlePhrases: [...state.settings.blockedTitlePhrases],
            } as Settings,
            columns,
            lastUpdated: state.lastUpdated,
            refreshing,
            refreshError,
            now: now(),
        }
    }
    function publish() {
        if (disposed) return
        beforeUpdate.forEach((fn) => fn())
        view = snapshot()
        store.set(view)
    }
    function change<T>(fn: () => T): T {
        if (disposed) throw new Error('Controller disposed')
        const result = fn()
        publish()
        schedule()
        return result
    }
    function schedule() {
        clearTimeout(timer)
        if (
            disposed ||
            !host ||
            !view.settings.autoRefreshFeeds ||
            !view.folders.some((folder) => folder.feeds.length)
        )
            return
        const due =
            Date.parse(view.lastUpdated || '') + AUTO_REFRESH_INTERVAL_MS
        const delay = Number.isFinite(due)
            ? Math.max(0, due - now())
            : AUTO_REFRESH_INTERVAL_MS
        if (
            !delay &&
            (!isOnline() || host.document.visibilityState === 'hidden')
        )
            return
        timer = setTimeout(wakeup, delay)
    }
    function wakeup() {
        if (disposed) return
        const last = Date.parse(view.lastUpdated || '')
        const elapsed = Number.isFinite(last) ? now() - last : Infinity
        if (
            view.settings.autoRefreshFeeds &&
            elapsed >= AUTO_REFRESH_INTERVAL_MS &&
            isOnline() &&
            host?.document.visibilityState !== 'hidden'
        )
            void refresh()
        else schedule()
    }
    function cancelRequests() {
        requests.abort()
        requests = new AbortController()
        generation += 1
        refreshPromise = null
        refreshing = false
        refreshError = ''
    }
    function refresh(): Promise<void> {
        if (disposed) return Promise.resolve()
        if (refreshPromise) return refreshPromise
        if (!view.folders.some((folder) => folder.feeds.length))
            return Promise.resolve()
        if (!isOnline()) {
            refreshError = 'Нет подключения к интернету. Ленты не обновились.'
            publish()
            return Promise.resolve()
        }
        const requestGeneration = generation
        refreshing = true
        refreshError = ''
        publish()
        refreshPromise = (async () => {
            try {
                const result = await api.refreshAll({signal: requests.signal})
                if (disposed || requestGeneration !== generation) return
                const count = (api.getState().folders as Folder[]).flatMap(
                    (folder: Folder) => folder.feeds,
                ).length
                if (count && result.errorsCount >= count)
                    refreshError =
                        'Не удалось обновить ленты. Проверьте подключение к интернету.'
            } catch {
                if (disposed || requestGeneration !== generation) return
                refreshError =
                    'Не удалось обновить ленты. Проверьте подключение к интернету.'
            } finally {
                if (requestGeneration !== generation || disposed) return
                refreshing = false
                refreshPromise = null
                publish()
                schedule()
            }
        })()
        return refreshPromise
    }
    function online() {
        refreshError = ''
        publish()
        wakeup()
    }
    function start() {
        if (!host || disposed || clock) return
        for (const name of ['focus', 'pageshow'] as const)
            host.addEventListener(name, wakeup)
        host.addEventListener('online', online)
        host.document.addEventListener('visibilitychange', wakeup)
        clock = setInterval(() => {
            if (api.prepareView()) publish()
            else if (!disposed) {
                view = {...view, now: now()}
                store.set(view)
            }
        }, 60000)
        void refresh()
        schedule()
    }
    return {
        state: readonly(store),
        start,
        refresh,
        beforeUpdate(fn: () => void) {
            beforeUpdate.add(fn)
            return () => {
                beforeUpdate.delete(fn)
            }
        },
        createFolder(name: string) {
            return change(() => {
                api.createFolder(name.trim())
                return api.getState().folders.at(-1)?.id as string
            })
        },
        updateFolder(id: string, name: string) {
            return change(() => api.updateFolder({folderId: id, name}))
        },
        removeFolder(id: string) {
            change(() => api.removeFolder(id))
            void refresh()
        },
        reorder(ids: string[]) {
            return change(() => api.reorderFolders(ids))
        },
        async addFeed(input: FeedInput): Promise<Result> {
            if (disposed) return {ok: false}
            try {
                const result = await api.addFeed({
                    ...input,
                    signal: requests.signal,
                })
                if (!disposed) {
                    publish()
                    if (result.ok) void refresh()
                }
                return result
            } catch {
                return {
                    ok: false,
                    error: 'Не удалось добавить подписку. Попробуйте ещё раз.',
                }
            }
        },
        updateFeed(input: FeedInput & {feedId: string}): Result {
            const raw = input.url.trim()
            const url = normalizeHttpUrl(
                raw.includes('://') ||
                    /^(mailto|javascript|data|file):/i.test(raw)
                    ? raw
                    : normalizeUrl(raw),
            )
            if (!input.name.trim() || !url)
                return {
                    ok: false,
                    error: 'Укажите название подписки и корректный HTTP(S) URL.',
                }
            const result = change(() => api.updateFeed({...input, url}))
            if (result.ok && result.urlChanged) void refresh()
            return result.ok
                ? result
                : {...result, error: 'Не удалось сохранить подписку.'}
        },
        removeFeed(folderId: string, feedId: string) {
            change(() => api.removeFeed(folderId, feedId))
            void refresh()
        },
        favorite(folderId: string, feedId: string, isFavorite: boolean) {
            change(() => api.setFeedFavorite({folderId, feedId, isFavorite}))
        },
        setting(
            key: keyof Omit<Settings, 'blockedTitlePhrases'>,
            enabled: boolean,
        ) {
            change(() => {
                if (key === 'autoMarkReadOnScroll')
                    api.setAutoMarkReadOnScroll(enabled)
                else if (key === 'autoRefreshFeeds')
                    api.setAutoRefreshFeeds(enabled)
                else api.setShowRecommendedColumn(enabled)
            })
            wakeup()
        },
        filter(phrases: string[]) {
            change(() => api.setBlockedTitlePhrases(phrases))
            return [...api.getState().settings.blockedTitlePhrases]
        },
        read(keys: string[], visited = true) {
            change(() =>
                visited
                    ? api.markItemsVisited(keys)
                    : api.unmarkItemsVisited(keys),
            )
        },
        open(card: Card) {
            if (!normalizeHttpUrl(card.link)) return
            change(() => {
                api.markItemsVisited([card.itemKey])
                api.registerFeedItemClick(card)
            })
        },
        dismiss(card: Card) {
            change(() => api.registerFeedItemDismiss(card))
        },
        impression(card: Card) {
            if (!disposed) api.registerFeedItemImpressions(card)
        },
        hideRefreshError() {
            refreshError = ''
            publish()
        },
        exportJson() {
            return api.exportState()
        },
        importJson(text: string): Result {
            let parsed: unknown
            try {
                parsed = JSON.parse(text)
            } catch {
                return {ok: false, error: 'Файл не содержит корректный JSON.'}
            }
            if (
                !parsed ||
                typeof parsed !== 'object' ||
                !Array.isArray(
                    (parsed as {data?: {folders?: unknown}; folders?: unknown})
                        .data?.folders ??
                        (parsed as {folders?: unknown}).folders,
                )
            )
                return {
                    ok: false,
                    error: 'Выберите файл экспорта Start. с колонками и подписками.',
                }
            const result = change(() => {
                const imported = api.importState(parsed)
                if (!imported.ok)
                    return {
                        ok: false,
                        error:
                            imported.error === 'storage'
                                ? 'Не удалось сохранить данные на устройстве. Возможно, хранилище заполнено или недоступно. Текущие данные сохранены. Освободите место и повторите импорт.'
                                : 'Не удалось импортировать данные.',
                    }
                cancelRequests()
                return imported
            })
            if (result.ok) void refresh()
            return result
        },
        reset() {
            cancelRequests()
            change(() => api.resetState())
        },
        dispose() {
            if (disposed) return
            disposed = true
            cancelRequests()
            clearTimeout(timer)
            clearInterval(clock)
            beforeUpdate.clear()
            if (host) {
                for (const name of ['focus', 'pageshow'] as const)
                    host.removeEventListener(name, wakeup)
                host.removeEventListener('online', online)
                host.document.removeEventListener('visibilitychange', wakeup)
            }
        },
    }
}
export type AppController = ReturnType<typeof createAppController>
