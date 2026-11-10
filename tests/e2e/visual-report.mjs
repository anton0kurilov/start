import {readFile, writeFile} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import {widths} from '../fixtures/rss.mjs'
function png(buffer) {
    const width = buffer.readUInt32BE(16),
        height = buffer.readUInt32BE(20),
        type = buffer[25],
        channels = type === 6 ? 4 : 3
    if (buffer[24] !== 8 || ![2, 6].includes(type))
        throw new Error('Expected 8-bit RGB/RGBA screenshot')
    const chunks = []
    for (let offset = 8; offset < buffer.length;) {
        const size = buffer.readUInt32BE(offset)
        if (buffer.toString('ascii', offset + 4, offset + 8) === 'IDAT')
            chunks.push(buffer.subarray(offset + 8, offset + 8 + size))
        offset += size + 12
    }
    const raw = inflateSync(Buffer.concat(chunks)),
        stride = width * channels,
        pixels = Buffer.alloc(stride * height)
    function paeth(a, b, c) {
        const p = a + b - c,
            pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c)
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
    }
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]
        for (let x = 0; x < stride; x++) {
            const i = y * stride + x,
                a = x >= channels ? pixels[i - channels] : 0,
                b = y ? pixels[i - stride] : 0,
                c = y && x >= channels ? pixels[i - stride - channels] : 0
            pixels[i] =
                (raw[y * (stride + 1) + x + 1] +
                    [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][
                        filter
                    ]) &
                255
        }
    }
    return {width, height, channels, pixels}
}
const before = process.argv[2] || 'baseline-ready',
    after = process.argv[3] || 'svelte-ready'
const result = []
const names = [
    ...['feed', 'settings'].flatMap((kind) =>
        widths.map((width) => `${kind}-${width}.png`),
    ),
    ...['high', 'medium', 'low'].map((tone) => `signal-${tone}.png`),
    ...['error', 'pending'].flatMap((kind) =>
        [1440, 390].map((width) => `form-${kind}-${width}.png`),
    ),
    'refresh-error.png',
    'empty.png',
]
for (const name of names) {
    const a = png(await readFile(`output/playwright/${before}/${name}`)),
        b = png(await readFile(`output/playwright/${after}/${name}`))
    if (a.width !== b.width || a.height !== b.height)
        throw new Error(`Screenshot size differs: ${name}`)
    let changed = 0
    for (let i = 0; i < a.width * a.height; i++) {
        let delta = 0
        for (let c = 0; c < 3; c++)
            delta = Math.max(
                delta,
                Math.abs(
                    a.pixels[i * a.channels + c] - b.pixels[i * b.channels + c],
                ),
            )
        if (delta > 24) changed++
    }
    result.push({
        name,
        changedPercent: Number(
            ((100 * changed) / (a.width * a.height)).toFixed(3),
        ),
    })
}
await writeFile(
    'output/playwright/visual-report.json',
    JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
