// Isolated stage-0 probe. Dependencies/model assets must already exist locally.
// node scripts/benchmark-encoder.mjs --runtime-dir /tmp/spike/node_modules \
//   --model-dir /tmp/spike/models --output-dir output/encoder-benchmark
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {resolve, extname, sep} from 'node:path'
import {gzipSync} from 'node:zlib'
import {platform, arch, cpus} from 'node:os'
import {chromium} from 'playwright'

const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, list) => {
        if (value.startsWith('--'))
            pairs.push([value.slice(2), list[index + 1]])
        return pairs
    }, []),
)
if (!args['runtime-dir'] || !args['model-dir']) {
    throw new Error('--runtime-dir and --model-dir are required')
}
const roots = {
    '/runtime/': resolve(args['runtime-dir'], '@huggingface/transformers/dist'),
    '/ort/': resolve(args['runtime-dir'], 'onnxruntime-web/dist'),
    '/models/': resolve(args['model-dir']),
}
const requests = []
const files = new Map()
const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html')
        return response.end(
            '<!doctype html><title>Encoder probe</title><script type="importmap">{"imports":{"onnxruntime-web/webgpu":"/ort/ort.webgpu.min.mjs","onnxruntime-common":"/ort/ort.webgpu.min.mjs"}}</script>',
        )
    }
    const entry = Object.entries(roots).find(([prefix]) =>
        pathname.startsWith(prefix),
    )
    if (!entry) {
        response.writeHead(404)
        return response.end()
    }
    const [prefix, root] = entry
    const path = resolve(root, pathname.slice(prefix.length))
    if (!path.startsWith(root + sep)) {
        response.writeHead(403)
        return response.end()
    }
    try {
        if (!files.has(path)) {
            const raw = await readFile(path)
            files.set(path, {raw, gzip: gzipSync(raw)})
        }
        const file = files.get(path)
        const compressed = request.headers['accept-encoding']?.includes('gzip')
        const body = compressed ? file.gzip : file.raw
        requests.push({
            path: pathname,
            rawBytes: file.raw.length,
            bytes: body.length,
        })
        response.setHeader(
            'Content-Type',
            {
                '.js': 'text/javascript',
                '.mjs': 'text/javascript',
                '.wasm': 'application/wasm',
                '.json': 'application/json',
            }[extname(path)] || 'application/octet-stream',
        )
        response.setHeader('Cache-Control', 'public,max-age=31536000,immutable')
        if (compressed) response.setHeader('Content-Encoding', 'gzip')
        response.end(body)
    } catch (error) {
        process.stderr.write(pathname + ': ' + error.message + '\n')
        response.writeHead(404)
        response.end(error.message)
    }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
let browser
try {
    browser = await chromium.launch()
    const context = await browser.newContext()
    const run = async (reference) => {
        const page = await context.newPage()
        page.on('console', (message) => {
            if (message.type() === 'error')
                process.stderr.write(message.text() + '\n')
        })
        await page.goto(`http://127.0.0.1:${server.address().port}`)
        const result = await page.evaluate(async (reference) => {
            const start = performance.now()
            const {AutoTokenizer, AutoModel, env} =
                await import('/runtime/transformers.web.min.js')
            env.allowRemoteModels = false
            env.allowLocalModels = true
            env.localModelPath = '/models/'
            env.backends.onnx.wasm.numThreads = 1
            env.useWasmCache = true
            env.backends.onnx.wasm.wasmPaths = {
                mjs: new URL(
                    '/ort/ort-wasm-simd-threaded.asyncify.mjs',
                    location.href,
                ).href,
                wasm: new URL(
                    '/ort/ort-wasm-simd-threaded.asyncify.wasm',
                    location.href,
                ).href,
            }
            const id = 'onnx-community/rubert-tiny-ONNX'
            const tokenizer = await AutoTokenizer.from_pretrained(id)
            const model = await AutoModel.from_pretrained(id, {
                dtype: 'q8',
                device: 'wasm',
            })
            const readyMs = performance.now() - start
            const texts = [
                'Как настроить автоматическое освещение в умном доме',
                'Автоматизация света дома: практическая инструкция',
                'Как приготовить яблочный пирог',
                'Home lighting automation: a practical guide',
                'Apple выпустила обновление iOS с исправлением ошибок',
                'Не устанавливайте обновление до резервного копирования',
                'Заряжаем велосипедный аккумулятор перед поездкой',
                'Battery charging tips for an electric bicycle',
            ]
            const embeddings = [],
                durations = []
            let outputInfo
            const embed = async (network, text) => {
                const input = tokenizer(text, {
                    truncation: true,
                    max_length: 128,
                })
                const output = await network(input)
                outputInfo ||= Object.fromEntries(
                    Object.entries(output).map(([key, tensor]) => [
                        key,
                        tensor.dims,
                    ]),
                )
                const hidden = output.last_hidden_state
                if (!hidden || hidden.dims.at(-1) !== 312)
                    throw new Error(
                        'Expected last_hidden_state with 312 dimensions: ' +
                            JSON.stringify(outputInfo),
                    )
                const vector = Array.from(hidden.data.slice(0, 312))
                const norm = Math.hypot(...vector)
                return vector.map((value) => value / norm)
            }
            for (const text of texts) {
                const before = performance.now()
                embeddings.push(await embed(model, text))
                durations.push(performance.now() - before)
            }
            const warm = []
            for (let i = 0; i < 20; i++) {
                const before = performance.now()
                await embed(model, texts[i % texts.length])
                warm.push(performance.now() - before)
            }
            const longText =
                'Практический разбор автоматизации освещения дома и настройки датчиков движения. '.repeat(
                    40,
                )
            const longInputTokens = tokenizer(longText, {
                truncation: true,
                max_length: 128,
            }).input_ids.dims.at(-1)
            const longDurations = []
            for (let i = 0; i < 10; i++) {
                const before = performance.now()
                await embed(model, longText)
                longDurations.push(performance.now() - before)
            }
            longDurations.sort((a, b) => a - b)
            const coldResources = performance
                .getEntriesByType('resource')
                .map(({name, transferSize, decodedBodySize}) => ({
                    name,
                    transferSize,
                    decodedBodySize,
                }))
            const cosine = (a, b) =>
                a.reduce((sum, value, i) => sum + value * b[i], 0)
            const comparisons = texts.map((text, i) => ({
                text,
                similarityToFirst: cosine(embeddings[0], embeddings[i]),
            }))
            const referenceCosines = []
            if (reference) {
                const original = await AutoModel.from_pretrained(id, {
                    dtype: 'fp32',
                    device: 'wasm',
                })
                for (let i = 0; i < texts.length; i++)
                    referenceCosines.push(
                        cosine(embeddings[i], await embed(original, texts[i])),
                    )
                await original.dispose()
            }
            await model.dispose()
            const sorted = [...warm].sort((a, b) => a - b)
            return {
                longInputTokens,
                longMedianMs: longDurations[5],
                longP90Ms: longDurations[8],
                readyMs,
                firstInferenceMs: durations[0],
                warmMedianMs: sorted[10],
                warmP95Ms: sorted[18],
                outputInfo,
                comparisons,
                referenceCosines,
                coldResources,
                userAgent: navigator.userAgent,
            }
        }, reference)
        await page.close()
        return result
    }
    const cold = await run(true)
    const warmRequestStart = requests.length
    const warm = await run(false)
    const output = {
        runtimeVersions: {
            transformers: JSON.parse(
                await readFile(
                    resolve(
                        args['runtime-dir'],
                        '@huggingface/transformers/package.json',
                    ),
                    'utf8',
                ),
            ).version,
            onnxRuntime: JSON.parse(
                await readFile(
                    resolve(
                        args['runtime-dir'],
                        'onnxruntime-web/package.json',
                    ),
                    'utf8',
                ),
            ).version,
        },
        measuredAt: new Date().toISOString(),
        host: {platform: platform(), arch: arch(), cpu: cpus()[0]?.model},
        model: {
            id: 'onnx-community/rubert-tiny-ONNX',
            revision: '9a8d2ed31c37246d2a8d4d9f500dc1ca66563114',
            variant: args.variant || 'published',
            quantizedSha256: createHash('sha256')
                .update(
                    await readFile(
                        resolve(
                            args['model-dir'],
                            'onnx-community/rubert-tiny-ONNX/onnx/model_quantized.onnx',
                        ),
                    ),
                )
                .digest('hex'),
        },
        cold,
        warm,
        requests,
        warmRequests: requests.slice(warmRequestStart),
    }
    const outputDir = resolve(args['output-dir'] || 'output/encoder-benchmark')
    await mkdir(outputDir, {recursive: true})
    await writeFile(
        resolve(outputDir, 'result.json'),
        JSON.stringify(output, null, 2) + '\n',
    )
    console.log(JSON.stringify(output, null, 2))
} finally {
    await browser?.close()
    await new Promise((done) => server.close(done))
}
