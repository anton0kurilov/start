import {semanticManifest as manifest} from './semantic-manifest.ts'

export type SemanticStatus =
    | 'off'
    | 'checking'
    | 'downloading'
    | 'preparing'
    | 'ready'
    | 'cancelled'
    | 'error'
export const SEMANTIC_DOWNLOAD_BYTES = manifest.assets.reduce(
    (sum, asset) => sum + asset.compressedBytes,
    0,
)
export const SEMANTIC_CACHE_BYTES = manifest.assets.reduce(
    (sum, asset) => sum + asset.bytes,
    0,
)
export const SEMANTIC_VERSION = manifest.version
const cacheName = `start:semantic:${manifest.version}`

export function createSemantics({
    onStatus = (_status: SemanticStatus, _error?: string) => {},
    onProgress = (_progress: {loaded: number; total: number}) => {},
}: {
    onStatus?: (status: SemanticStatus, error?: string) => void
    onProgress?: (progress: {loaded: number; total: number}) => void
} = {}) {
    let worker: Worker | undefined
    let status: SemanticStatus = 'off'
    let disposed = false
    let sequence = 0
    let startPromise: Promise<void> | undefined
    let ready: {resolve: () => void; reject: (error: Error) => void} | undefined
    const pending = new Map<
        number,
        {resolve: (vector: number[]) => void; reject: (error: Error) => void}
    >()
    function change(next: SemanticStatus, error?: string) {
        status = next
        onStatus(next, error)
    }
    function stop() {
        worker?.terminate()
        worker = undefined
        const error = new Error('Загрузка или обработка отменена')
        ready?.reject(error)
        ready = undefined
        startPromise = undefined
        for (const request of pending.values()) request.reject(error)
        pending.clear()
        if (!disposed) change('cancelled')
    }
    return {
        get status() {
            return status
        },
        async isCached() {
            if (typeof caches === 'undefined') return false
            try {
                const cache = await caches.open(cacheName)
                const files = await Promise.all(
                    manifest.assets.map(async (asset) => {
                        const response = await cache.match(
                            new URL(manifest.base + asset.path, location.origin)
                                .href,
                        )
                        return (
                            response?.headers.get('x-start-sha256') ===
                            asset.sha256
                        )
                    }),
                )
                return files.every(Boolean)
            } catch {
                return false
            }
        },
        start(): Promise<void> {
            if (disposed)
                return Promise.reject(new Error('Обработка остановлена'))
            if (status === 'ready') return Promise.resolve()
            if (startPromise) return startPromise
            if (
                typeof Worker === 'undefined' ||
                typeof caches === 'undefined' ||
                typeof DecompressionStream === 'undefined'
            ) {
                const error = new Error(
                    'Браузер не поддерживает локальную модель',
                )
                change('error', error.message)
                return Promise.reject(error)
            }
            change('checking')
            startPromise = new Promise<void>((resolve, reject) => {
                ready = {resolve, reject}
                worker = new Worker(
                    new URL('./semantic-worker.ts', import.meta.url),
                    {type: 'module'},
                )
                const fail = (message: string) => {
                    worker?.terminate()
                    worker = undefined
                    ready?.reject(new Error(message))
                    ready = undefined
                    startPromise = undefined
                    for (const request of pending.values())
                        request.reject(new Error(message))
                    pending.clear()
                    change('error', message)
                }
                worker.onerror = () =>
                    fail('Не удалось запустить локальный прогноз')
                worker.onmessage = ({data}) => {
                    if (data.error) {
                        fail(data.error)
                        return
                    }
                    if (typeof data.loaded === 'number')
                        onProgress({loaded: data.loaded, total: data.total})
                    if (data.status) {
                        change(data.status)
                        if (data.status === 'ready') {
                            ready?.resolve()
                            ready = undefined
                        }
                    }
                    if (data.id !== undefined) {
                        pending.get(data.id)?.resolve(data.vector)
                        pending.delete(data.id)
                    }
                }
                worker.postMessage({type: 'start'})
            })
            return startPromise
        },
        embed(text: string): Promise<number[]> {
            if (status !== 'ready' || !worker || disposed)
                return Promise.reject(
                    new Error('Локальный прогноз ещё не готов'),
                )
            const id = ++sequence
            return new Promise((resolve, reject) => {
                pending.set(id, {resolve, reject})
                worker!.postMessage({type: 'embed', id, text})
            })
        },
        stop,
        async clearCache() {
            stop()
            if (typeof caches !== 'undefined') await caches.delete(cacheName)
            change('off')
        },
        dispose() {
            disposed = true
            stop()
        },
    }
}
