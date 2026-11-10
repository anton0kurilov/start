import {chromium} from '@playwright/test'
import {mkdir, writeFile} from 'node:fs/promises'
import {initialState, preparePage, widths} from '../fixtures/rss.mjs'
const label = process.argv[2] || 'svelte'
const url = process.env.APP_URL || 'http://127.0.0.1:4173'
const output = `output/playwright/${label}`
await mkdir(output, {recursive: true})
const browser = await chromium.launch({headless: true})
const measures = []
for (let i = 0; i < 7; i++) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}})
    await preparePage(page)
    // Capture readiness in the page; locator polling adds variable transport delay.
    await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
            if (document.querySelectorAll('.feed__item').length < 320) return
            observer.disconnect()
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    window.__startReady = performance.now()
                }),
            )
        })
        observer.observe(document, {childList: true, subtree: true})
    })
    await page.goto(url)
    await page.waitForFunction(() => window.__startReady !== undefined)
    const startup = await page.evaluate(() => window.__startReady)
    const refresh = await page.evaluate(async () => {
        const start = performance.now()
        document.querySelector('[data-action="refresh"]').click()
        await new Promise((resolve) => {
            const check = () =>
                document.querySelector('[data-action="refresh"]').disabled
                    ? requestAnimationFrame(check)
                    : requestAnimationFrame(resolve)
            requestAnimationFrame(check)
        })
        return performance.now() - start
    })
    const click = await page.evaluate(async () => {
        const start = performance.now()
        document.querySelector('[data-action="mark-column-read"]').click()
        await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
        )
        return performance.now() - start
    })
    measures.push({startup, refresh, click})
    await page.close()
}
const median = (key) => measures.map((m) => m[key]).sort((a, b) => a - b)[3]
const metrics = {
    runs: measures,
    median: Object.fromEntries(
        ['startup', 'refresh', 'click'].map((key) => [key, median(key)]),
    ),
}
for (const width of widths) {
    const page = await browser.newPage({viewport: {width, height: 900}})
    await preparePage(page, {state: initialState(2)})
    await page.goto(url)
    await page.locator('.feed__item').first().waitFor()
    await page.screenshot({path: `${output}/feed-${width}.png`})
    await page.locator('[data-action="toggle-settings"][aria-expanded]').click()
    if (width <= 720)
        await page.locator('[data-settings-section="sources"]').click()
    await page.locator('.settings__folder-toggle').first().click()
    await page.screenshot({path: `${output}/settings-${width}.png`})
    await page.close()
}
await writeFile(`${output}/metrics.json`, JSON.stringify(metrics, null, 2))
console.log(JSON.stringify(metrics.median))
await browser.close()
