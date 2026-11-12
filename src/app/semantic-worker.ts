/// <reference lib="webworker" />
import {semanticManifest as manifest} from './semantic-manifest'

const scope = self as unknown as DedicatedWorkerGlobalScope
const cacheName = `start:semantic:${manifest.version}`
let tokenizer: any
let model: any
let task = Promise.resolve()
const blobs: string[] = []
const url = (path: string) =>
    new URL(manifest.base + path, scope.location.origin).href
const sha = async (bytes: ArrayBuffer) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')

async function prepare() {
    const cache = await caches.open(cacheName)
    let loaded = 0
    const needed = []
    for (const asset of manifest.assets) {
        const cached = await cache.match(url(asset.path))
        if (!cached || cached.headers.get('x-start-sha256') !== asset.sha256)
            needed.push(asset)
    }
    const total = needed.reduce((sum, asset) => sum + asset.compressedBytes, 0)
    scope.postMessage({status: 'downloading', loaded, total})
    for (const asset of needed) {
        const response = await fetch(url(asset.path + '.gz'))
        if (!response.ok || !response.body)
            throw new Error('Не удалось загрузить файлы прогноза')
        const reader = response.body.getReader()
        const parts: Uint8Array[] = []
        let size = 0
        const previousLoaded = loaded
        const decodedByBrowser = !!response.headers.get('content-encoding')
        while (true) {
            const part = await reader.read()
            if (part.done) break
            size += part.value.byteLength
            loaded =
                previousLoaded +
                Math.min(
                    asset.compressedBytes,
                    Math.round(
                        (size /
                            (decodedByBrowser
                                ? asset.bytes
                                : asset.compressedBytes)) *
                            asset.compressedBytes,
                    ),
                )
            parts.push(part.value)
            scope.postMessage({loaded, total})
        }
        const compressed = new Uint8Array(size)
        let offset = 0
        for (const part of parts) {
            compressed.set(part, offset)
            offset += part.byteLength
        }
        let decoded: ArrayBuffer
        // Static hosts may set Content-Encoding for .gz; fetch then yields
        // decoded bytes. Verify either exact representation before caching.
        if (
            size === asset.bytes &&
            (await sha(compressed.buffer)) === asset.sha256
        ) {
            decoded = compressed.buffer
        } else {
            if (
                size !== asset.compressedBytes ||
                (await sha(compressed.buffer)) !== asset.compressedSha256
            )
                throw new Error(
                    'Загруженный файл повреждён. Повторите загрузку',
                )
            decoded = await new Response(
                new Blob([compressed])
                    .stream()
                    .pipeThrough(new DecompressionStream('gzip')),
            ).arrayBuffer()
        }
        loaded = previousLoaded + asset.compressedBytes
        if (
            decoded.byteLength !== asset.bytes ||
            (await sha(decoded)) !== asset.sha256
        )
            throw new Error('Не удалось проверить файлы прогноза')
        await cache.put(
            url(asset.path),
            new Response(decoded, {
                headers: {
                    'content-type': asset.type,
                    'x-start-sha256': asset.sha256,
                },
            }),
        )
    }
    scope.postMessage({status: 'preparing'})
    async function blob(path: string) {
        const response = await cache.match(url(path))
        if (!response) throw new Error('Файлы прогноза недоступны')
        const value = URL.createObjectURL(await response.blob())
        blobs.push(value)
        return value
    }
    const libraryUrl = await blob('runtime.js')
    const {AutoTokenizer, AutoModel, env} = await import(
        /* @vite-ignore */ libraryUrl
    )
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = manifest.base
    env.useBrowserCache = false
    env.useWasmCache = false
    env.fetch = async (input: RequestInfo | URL) => {
        const key = input instanceof Request ? input.url : String(input)
        const response = await cache.match(
            new URL(key, scope.location.origin).href,
        )
        return response || new Response(null, {status: 404})
    }
    env.backends.onnx.wasm.numThreads = 1
    env.backends.onnx.wasm.wasmPaths = {
        mjs: await blob('ort/ort-wasm-simd-threaded.asyncify.mjs'),
        wasm: await blob('ort/ort-wasm-simd-threaded.asyncify.wasm'),
    }
    tokenizer = await AutoTokenizer.from_pretrained('model')
    model = await AutoModel.from_pretrained('model', {
        dtype: 'q8',
        device: 'wasm',
    })
    scope.postMessage({status: 'ready'})
}

scope.onmessage = ({data}) => {
    task = task
        .then(async () => {
            if (data.type === 'start') await prepare()
            else if (data.type === 'embed') {
                if (!model || !tokenizer)
                    throw new Error('Прогноз ещё не готов')
                const output = await model(
                    tokenizer(data.text, {truncation: true, max_length: 128}),
                )
                const hidden = output.last_hidden_state
                if (!hidden || hidden.dims.at(-1) !== 312)
                    throw new Error('Некорректный encoder')
                const vector = Array.from(hidden.data.slice(0, 312)) as number[]
                const norm = Math.hypot(...vector)
                if (!Number.isFinite(norm) || norm === 0)
                    throw new Error('Некорректный вектор')
                scope.postMessage({
                    id: data.id,
                    vector: vector.map((value) => value / norm),
                })
            }
        })
        .catch((error) =>
            scope.postMessage({
                id: data.id,
                error: String(error?.message || error),
            }),
        )
}
