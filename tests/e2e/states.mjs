import {chromium} from '@playwright/test'
import {mkdir} from 'node:fs/promises'
import {
    initialState,
    preparePage,
    signalState,
    feedXml,
} from '../fixtures/rss.mjs'
const label = process.argv[2] || 'svelte-ready',
    url = process.env.APP_URL || 'http://127.0.0.1:4173'
const directory = `output/playwright/${label}`
await mkdir(directory, {recursive: true})
const browser = await chromium.launch()
for (const [name, bias] of [
    ['high', 0.35],
    ['medium', -2],
    ['low', -4],
]) {
    const page = await browser.newPage({viewport: {width: 1440, height: 900}})
    await preparePage(page, {state: signalState(bias)})
    await page.goto(url)
    await page.locator('.feed__item').first().waitFor()
    await page.screenshot({
        path: `${directory}/signal-${name}.png`,
        animations: 'disabled',
    })
    await page.close()
}
for (const width of [1440, 390]) {
    const page = await browser.newPage({viewport: {width, height: 900}})
    await preparePage(page, {state: initialState(2)})
    await page.goto(url)
    await page.locator('.feed__item').first().waitFor()
    await page.locator('[data-action="toggle-settings"][aria-expanded]').click()
    await page.locator('[data-settings-section="sources"]').click()
    await page.locator('.settings__folder-toggle').first().click()
    await page
        .getByRole('button', {name: 'Добавить подписку', exact: true})
        .first()
        .click()
    await page
        .getByRole('textbox', {name: 'Название подписки', exact: true})
        .fill('Тестовая подписка')
    await page
        .getByRole('textbox', {name: 'Прямая ссылка на RSS-поток'})
        .fill('https://feeds.example/invalid')
    await page.route('https://cors.kurilov.workers.dev/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<html><body>No RSS</body></html>',
        }),
    )
    await page.getByRole('button', {name: 'Подписаться', exact: true}).click()
    await page.locator('#feed-form-error').waitFor()
    await page.screenshot({
        path: `${directory}/form-error-${width}.png`,
        animations: 'disabled',
    })
    let release
    const gate = new Promise((resolve) => (release = resolve))
    await page.route('https://cors.kurilov.workers.dev/**', async (route) => {
        await gate
        await route.fulfill({
            status: 200,
            contentType: 'application/xml',
            body: feedXml(),
        })
    })
    await page.getByRole('button', {name: 'Подписаться', exact: true}).click()
    await page.getByRole('button', {name: 'Проверка…', exact: true}).waitFor()
    await page.screenshot({
        path: `${directory}/form-pending-${width}.png`,
        animations: 'disabled',
    })
    release()
    await page.close()
}
const page = await browser.newPage({viewport: {width: 1440, height: 900}})
let fail = false
await preparePage(page, {state: initialState(2), fail: () => fail})
await page.goto(url)
await page.locator('.feed__item').first().waitFor()
fail = true
await page.locator('[data-action="refresh"]').click()
await page.locator('[data-refresh-toast]').waitFor()
await page.screenshot({
    path: `${directory}/refresh-error.png`,
    animations: 'disabled',
})
await page.close()
const empty = await browser.newPage({viewport: {width: 390, height: 900}})
await preparePage(empty, {state: initialState(0)})
await empty.goto(url)
await empty.locator('.onboarding').waitFor()
await empty.screenshot({path: `${directory}/empty.png`, animations: 'disabled'})
await browser.close()
