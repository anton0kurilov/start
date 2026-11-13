import {readonly, writable} from 'svelte/store'
import {command} from './commands.ts'
import type {Repository} from './repository.ts'
import type {CloudService} from './cloud.ts'
import {repositoryPredictionStorage} from './repository-predictions.ts'
import {itemKey} from './item-identity.ts'
export {itemKey} from './item-identity.ts'
import * as domain from '../scripts/domain.js'
import {
    AUTO_REFRESH_INTERVAL_MS,
    MAX_ITEMS_PER_FOLDER,
} from '../scripts/constants.js'
import {normalizeHttpUrl, normalizeUrl} from '../scripts/utils.js'
import {createPredictions, type PredictionHistoryStatus} from './predictions.ts'
import {createSemantics, SEMANTIC_DOWNLOAD_BYTES} from './semantics.ts'
import type {createShadowPredictions} from './shadow-predictions.ts'
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

export function createAppController({
    api = domain,
    repository,
    cloud,
    now = Date.now,
    isOnline = () =>
        typeof navigator === 'undefined' || navigator.onLine !== false,
    host = typeof window === 'undefined' ? null : window,
}: {
    api?: typeof domain
    repository?: Repository
    cloud?: CloudService
    now?: () => number
    isOnline?: () => boolean
    host?: Window | null
} = {}) {
    let disposed = false
    let generation = 0
    let requests = new AbortController()
    let refreshing = false
    let syncState = cloud?.snapshot
    let persistenceError = ''
    let refreshError = ''
    let refreshPromise: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let clock: ReturnType<typeof setInterval> | undefined
    const beforeUpdate = new Set<() => void>()
    let predictionHistory: PredictionHistoryStatus = 'loading'
    let predictions: ReturnType<typeof createPredictions> | undefined
    let semantics: ReturnType<typeof createSemantics> | undefined
    let shadow: ReturnType<typeof createShadowPredictions> | undefined
    let semanticState = {
        status: 'off',
        loaded: 0,
        total: SEMANTIC_DOWNLOAD_BYTES,
    }
    let shadowPreparing = false
    let lastSemanticProgress = 0
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
            persistenceError,
            sync: syncState,
            predictionHistory,
            semantics: {...semanticState},
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
    function change<T>(
        fn: () => T | Promise<T>,
        failure = undefined as T,
    ): Promise<T> {
        if (disposed) throw new Error('Controller disposed')
        return (async () => {
            try {
                const result = await fn()
                persistenceError = ''
                publish()
                schedule()
                return result
            } catch {
                persistenceError =
                    'Не удалось сохранить изменения на устройстве. Проверьте свободное место и повторите действие.'
                publish()
                return failure
            }
        })()
    }
    async function persist(
        commands: ReturnType<typeof command> | ReturnType<typeof command>[],
        legacy: () => unknown,
    ) {
        if (repository) await repository.dispatch(commands)
        else legacy()
    }
    function signal(
        kind: string,
        card: Card,
        context: Record<string, unknown> = {},
    ) {
        const recordedAt = now()
        const snapshot = {
            title: card.title.trim().slice(0, 512),
            description: (card.description || '').trim().slice(0, 2000),
            source: card.source.trim().slice(0, 512),
            feedId: card.feedId,
            link: card.link,
            publishedAt: card.date?.toISOString() || null,
        }
        const frozen = {
            ...context,
            referenceTime: recordedAt,
            firstShownAt: recordedAt,
        }
        const forecast = shadow?.predict(snapshot, frozen) || {
            predictions: {a1: null, b: null},
            versions: {},
        }
        return command('item.signal', {
            signal: kind,
            itemKey: card.itemKey,
            recordedAt,
            snapshot,
            context: frozen,
            predictions: {legacy: null, ...forecast.predictions},
            versions: {legacy: 2, ...forecast.versions},
            profileId: repository?.profile.learnerId,
            deviceId: repository?.profile.deviceId,
            generation: repository?.profile.generation,
            expected: repository?.readVersion(card.itemKey),
        })
    }
    const unsubscribeCloud = cloud?.state.subscribe((next) => {
        syncState = next
        publish()
    })
    const unsubscribeRepository = repository?.subscribe(() => {
        api.hydrateState(repository.state)
        publish()
        schedule()
    })
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
                if (repository) {
                    try {
                        await repository.updateLocal({
                            lastUpdated: api.getState().lastUpdated,
                        })
                    } catch {
                        persistenceError =
                            'Не удалось сохранить время обновления на устройстве.'
                    }
                }
                refreshing = false
                refreshPromise = null
                void prepareShadowItems()
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
    function pageHidden() {
        return host?.document.visibilityState === 'hidden'
    }
    async function prepareShadowItems() {
        const current = generation
        const target = shadow
        if (!target || pageHidden()) return
        try {
            for (const folder of view.folders) {
                for (const item of api.getFolderItems(folder) as Item[]) {
                    if (
                        disposed ||
                        current !== generation ||
                        target !== shadow ||
                        pageHidden()
                    )
                        return
                    await target.prepareItem({
                        ...item,
                        publishedAt: item.date?.toISOString() || null,
                    })
                }
            }
        } catch {
            /* Optional shadow features never interrupt reading. */
        }
    }
    async function refreshShadow() {
        if (!shadow || !predictions || shadowPreparing || pageHidden()) return
        shadowPreparing = true
        const target = shadow
        try {
            const data = await predictions.exportData()
            if (target !== shadow || disposed) return
            await target.prepare(data.observations, now())
            if (target === shadow) void prepareShadowItems()
        } catch {
            /* Persistence has its own visible error status. */
        } finally {
            shadowPreparing = false
        }
    }
    async function enableSemantics() {
        if (!semantics || disposed) return
        const current = generation
        try {
            await semantics.start()
            if (
                disposed ||
                current !== generation ||
                semantics.status !== 'ready'
            )
                return
            if (repository)
                await repository.updateLocal({semanticEnabled: true})
            else api.setSemanticEnabled(true)
            const {createShadowPredictions} =
                await import('./shadow-predictions.ts')
            if (
                disposed ||
                current !== generation ||
                semantics.status !== 'ready'
            )
                return
            shadow?.dispose()
            shadow = createShadowPredictions({
                embed: (text) => semantics!.embed(text),
            })
            await refreshShadow()
            publish()
        } catch {
            /* The download service exposes its error status. */
        }
    }
    function restartPredictions() {
        shadow?.dispose()
        shadow = undefined
        semantics?.stop()
        try {
            if (predictions) predictions.start(api.ensurePredictionGeneration())
        } catch {
            predictionHistory = 'error'
            publish()
        }
    }
    function start() {
        if (!host || disposed || clock) return
        semantics = createSemantics({
            onStatus(status) {
                semanticState = {...semanticState, status}
                publish()
            },
            onProgress(progress) {
                semanticState = {...semanticState, ...progress}
                if (
                    now() - lastSemanticProgress >= 200 ||
                    progress.loaded >= progress.total
                ) {
                    lastSemanticProgress = now()
                    publish()
                }
            },
        })
        predictions = createPredictions({
            now,
            ...(repository
                ? {storageFactory: repositoryPredictionStorage(repository, now)}
                : {}),
            forecast: (snapshot, context) =>
                shadow?.predict(snapshot, context) || {
                    predictions: {a1: null, b: null},
                    versions: {},
                },
            onStatus(status) {
                predictionHistory = status
                publish()
            },
        })
        restartPredictions()
        if (api.getState().settings.semanticEnabled)
            void semantics
                .isCached()
                .then((cached) => {
                    if (cached && !disposed) void enableSemantics()
                })
                .catch(() => {})
        for (const name of ['focus', 'pageshow'] as const)
            host.addEventListener(name, wakeup)
        host.addEventListener('online', online)
        host.document.addEventListener('visibilitychange', wakeup)
        clock = setInterval(() => {
            predictions?.tick()
            void refreshShadow()
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
            return change(async () => {
                const id = crypto.randomUUID()
                if (repository)
                    await repository.dispatch(
                        command('folder.create', {id, name: name.trim()}),
                    )
                else {
                    api.createFolder(name.trim())
                    return api.getState().folders.at(-1)?.id as string
                }
                return id
            })
        },
        updateFolder(id: string, name: string) {
            return change(
                async () => {
                    if (!repository)
                        return api.updateFolder({folderId: id, name})
                    await repository.dispatch(
                        command('folder.patch', {id, name}),
                    )
                    return {ok: true}
                },
                {ok: false},
            )
        },
        removeFolder(id: string) {
            return change(async () => {
                await persist(command('folder.delete', {id}), () =>
                    api.removeFolder(id),
                )
                void refresh()
            })
        },
        reorder(ids: string[]) {
            return change(
                async () => {
                    if (!repository) return api.reorderFolders(ids)
                    const current = view.folders.map((f) => f.id)
                    if (
                        ids.length !== current.length ||
                        new Set(ids).size !== ids.length ||
                        ids.some((id) => !current.includes(id))
                    )
                        return {ok: false}
                    const moves = []
                    for (let i = ids.length - 1; i >= 0; i--) {
                        const beforeId = ids[i + 1] || null
                        const index = current.indexOf(ids[i])
                        if (
                            current[index + 1] === beforeId ||
                            (beforeId === null && index === current.length - 1)
                        )
                            continue
                        moves.push(
                            command('folder.move', {id: ids[i], beforeId}),
                        )
                        current.splice(index, 1)
                        current.splice(
                            beforeId === null
                                ? current.length
                                : current.indexOf(beforeId),
                            0,
                            ids[i],
                        )
                    }
                    await repository.dispatch(moves)
                    return {ok: true}
                },
                {ok: false},
            )
        },
        async addFeed(input: FeedInput): Promise<Result> {
            if (!repository) {
                try {
                    return await change(
                        async () => {
                            const result = await api.addFeed({
                                ...input,
                                signal: requests.signal,
                            })
                            if (result.ok) void refresh()
                            return result
                        },
                        {ok: false},
                    )
                } catch {
                    return {ok: false, error: 'Не удалось добавить подписку.'}
                }
            }
            const current = generation
            const url = normalizeHttpUrl(
                input.url.includes('://') ? input.url : normalizeUrl(input.url),
            )
            if (!url || !input.name.trim())
                return {
                    ok: false,
                    error: 'Укажите название и корректный HTTP(S) URL.',
                }
            const validation = await api.validateFeedUrl(url, requests.signal)
            if (!validation.ok) return validation
            if (disposed || current !== generation)
                return {ok: false, error: 'Добавление отменено.'}
            return change<Result>(
                async () => {
                    await repository.dispatch(
                        command('subscription.create', {
                            id: crypto.randomUUID(),
                            folderId: input.folderId,
                            name: input.name,
                            url,
                        }),
                    )
                    void refresh()
                    return {ok: true}
                },
                {ok: false, error: 'Не удалось сохранить подписку.'},
            )
        },
        async updateFeed(input: FeedInput & {feedId: string}): Promise<Result> {
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
            return change<Result>(
                async () => {
                    if (!repository) return api.updateFeed({...input, url})
                    const previous = view.folders
                        .flatMap((f) => f.feeds)
                        .find((f) => f.id === input.feedId)
                    if (!previous) return {ok: false}
                    const changes: Record<string, unknown> = {}
                    if (previous.name !== input.name.trim())
                        changes.name = input.name.trim()
                    if (previous.url !== url) changes.url = url
                    if (Object.keys(changes).length)
                        await repository.dispatch(
                            command('subscription.patch', {
                                id: input.feedId,
                                changes,
                            }),
                        )
                    if (previous.url !== url) void refresh()
                    return {ok: true, urlChanged: previous.url !== url}
                },
                {ok: false, error: 'Не удалось сохранить подписку.'},
            )
        },
        removeFeed(folderId: string, feedId: string) {
            return change(async () => {
                await persist(
                    command('subscription.delete', {id: feedId}),
                    () => api.removeFeed(folderId, feedId),
                )
                void refresh()
            })
        },
        favorite(folderId: string, feedId: string, isFavorite: boolean) {
            return change(() =>
                persist(
                    command('subscription.patch', {
                        id: feedId,
                        changes: {isFavorite},
                    }),
                    () => api.setFeedFavorite({folderId, feedId, isFavorite}),
                ),
            )
        },
        setting(
            key: keyof Omit<
                Settings,
                'blockedTitlePhrases' | 'semanticEnabled'
            >,
            enabled: boolean,
        ) {
            return change(async () => {
                await persist(
                    command('preference.set', {key, value: enabled}),
                    () => {
                        if (key === 'autoMarkReadOnScroll')
                            api.setAutoMarkReadOnScroll(enabled)
                        else if (key === 'autoRefreshFeeds')
                            api.setAutoRefreshFeeds(enabled)
                        else api.setShowRecommendedColumn(enabled)
                    },
                )
                wakeup()
            })
        },
        filter(phrases: string[]) {
            return change(async () => {
                const values = [
                    ...new Map(
                        phrases
                            .map(
                                (p) =>
                                    [p.trim().toLowerCase(), p.trim()] as const,
                            )
                            .filter(([key]) => key),
                    ).values(),
                ]
                const commands = values.map((phrase) =>
                    command('phrase.set', {phrase, enabled: true}),
                )
                for (const phrase of view.settings.blockedTitlePhrases)
                    if (
                        !values.some(
                            (v) => v.toLowerCase() === phrase.toLowerCase(),
                        )
                    )
                        commands.push(
                            command('phrase.set', {phrase, enabled: false}),
                        )
                await persist(commands, () =>
                    api.setBlockedTitlePhrases(values),
                )
                return [...api.getState().settings.blockedTitlePhrases]
            }, [...view.settings.blockedTitlePhrases])
        },
        read(keys: string[], visited = true, origin = 'manual') {
            return change(() =>
                persist(
                    command('read.set', {
                        items: keys.map((key) => ({
                            key,
                            expected: repository?.readVersion(key),
                        })),
                        value: visited,
                        origin,
                    }),
                    () =>
                        visited
                            ? api.markItemsVisited(keys)
                            : api.unmarkItemsVisited(keys),
                ),
            )
        },
        open(card: Card, context: Record<string, unknown> = {}) {
            if (!normalizeHttpUrl(card.link)) return Promise.resolve()
            const cmd = signal('click', card, context)
            if (!repository) predictions?.record('click', card, context)
            return change(() =>
                persist(cmd, () => {
                    api.markItemsVisited([card.itemKey])
                    api.registerFeedItemClick(card)
                }),
            )
        },
        dismiss(card: Card) {
            const cmd = signal('dismiss', card)
            if (!repository) predictions?.record('dismiss', card)
            return change(() =>
                persist(cmd, () => api.registerFeedItemDismiss(card)),
            )
        },
        impression(card: Card) {
            if (disposed) return
            if (repository)
                void change(() =>
                    repository.dispatch(signal('impression', card)),
                )
            else api.registerFeedItemImpressions(card)
        },
        exposure(card: Card, context: Record<string, unknown> = {}) {
            if (
                disposed ||
                (api.getState().clickedItemKeys as string[]).includes(
                    card.itemKey,
                ) ||
                api.isItemDismissed(card.itemKey)
            )
                return
            if (repository)
                void change(() =>
                    repository.dispatch(signal('exposure', card, context)),
                )
            else predictions?.record('exposure', card, context)
        },
        enableSemantics,
        async disableSemantics() {
            shadow?.dispose()
            shadow = undefined
            semantics?.stop()
            if (repository)
                await repository.updateLocal({semanticEnabled: false})
            else api.setSemanticEnabled(false)
            publish()
        },
        async clearSemanticFiles() {
            shadow?.dispose()
            shadow = undefined
            if (repository)
                await repository.updateLocal({semanticEnabled: false})
            else api.setSemanticEnabled(false)
            await semantics?.clearCache()
            semanticState = {
                ...semanticState,
                status: 'off',
                loaded: 0,
                total: SEMANTIC_DOWNLOAD_BYTES,
            }
            publish()
        },
        async exportBackup() {
            await repository?.flush()
            const data = api.exportState()
            if (!predictions) return data
            const predictionData = await predictions.exportData()
            return {
                ...data,
                ...(repository
                    ? {version: 2, predictionArchive: repository.observations()}
                    : {}),
                predictionData: {
                    ...predictionData,
                    evaluation:
                        shadow?.report(predictionData.observations, now()) ||
                        null,
                },
            }
        },
        async importBackup(text: string): Promise<Result> {
            if (repository) {
                let parsed: unknown
                try {
                    parsed = JSON.parse(text)
                } catch {
                    return {
                        ok: false,
                        error: 'Файл не содержит корректный JSON.',
                    }
                }
                if (repository.profile.userId)
                    return {
                        ok: false,
                        error: 'Для замены импортом сначала отключите синхронизацию на этом устройстве.',
                    }
                return change<Result>(
                    async () => {
                        await repository.replaceGuest(parsed)
                        cancelRequests()
                        restartPredictions()
                        void refresh()
                        return {ok: true}
                    },
                    {
                        ok: false,
                        error: 'Не удалось проверить или сохранить импортируемые данные. Текущие данные сохранены.',
                    },
                )
            }
            const requestGeneration = generation
            if (disposed) return {ok: false, error: 'Приложение закрыто.'}
            let parsed
            try {
                parsed = JSON.parse(text)
            } catch {
                return {ok: false, error: 'Файл не содержит корректный JSON.'}
            }
            try {
                if (parsed?.predictionData) {
                    if (!predictions) throw new Error('Storage unavailable')
                    parsed.predictionGeneration = await predictions.stageImport(
                        parsed.predictionData,
                    )
                } else if (parsed && typeof parsed === 'object') {
                    delete parsed.predictionGeneration
                }
            } catch {
                return {
                    ok: false,
                    error: 'Не удалось проверить или сохранить историю прогнозов. Текущие данные сохранены.',
                }
            }
            if (disposed || requestGeneration !== generation) {
                if (parsed?.predictionGeneration)
                    await predictions?.discardImport(
                        parsed.predictionGeneration,
                    )
                return {
                    ok: false,
                    error: 'Данные изменились во время импорта. Повторите импорт.',
                }
            }
            const result = await this.importJson(JSON.stringify(parsed))
            if (!result.ok && parsed?.predictionGeneration)
                await predictions?.discardImport(parsed.predictionGeneration)
            return result
        },
        hideRefreshError() {
            refreshError = ''
            publish()
        },
        exportJson() {
            return api.exportState()
        },
        async importJson(text: string): Promise<Result> {
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
            const result = await change(() => {
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
                restartPredictions()
                return imported
            })
            if (result.ok) void refresh()
            return result
        },
        async reset() {
            cancelRequests()
            await change(async () => {
                if (repository?.profile.userId && cloud)
                    await cloud.resetProfile()
                else if (repository)
                    await repository.replaceGuest({folders: []})
                else api.resetState()
            })
            restartPredictions()
        },
        createSyncProfile(phrase: string) {
            return (
                cloud?.createProfile(phrase) ||
                Promise.resolve({
                    ok: false,
                    error: 'Синхронизация не настроена.',
                })
            )
        },
        connectSyncProfile(phrase: string) {
            return (
                cloud?.connectProfile(phrase) ||
                Promise.resolve({
                    ok: false,
                    error: 'Синхронизация не настроена.',
                })
            )
        },
        disconnectSync() {
            return cloud?.disconnect()
        },
        syncNow() {
            return cloud?.synchronize()
        },
        deleteSyncProfile() {
            return cloud?.deleteProfile()
        },
        hidePersistenceError() {
            persistenceError = ''
            publish()
        },
        dispose() {
            if (disposed) return
            disposed = true
            unsubscribeCloud?.()
            unsubscribeRepository?.()
            predictions?.dispose()
            shadow?.dispose()
            semantics?.dispose()
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
