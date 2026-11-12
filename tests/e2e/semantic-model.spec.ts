import {test, expect} from '@playwright/test'
import {preparePage, initialState} from '../fixtures/rss.mjs'

test('semantic model downloads only on request, runs in worker and reuses verified cache', async ({
    page,
}) => {
    test.setTimeout(90000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript(() => {
        const Base = Worker
        ;(window as any).__semanticVectors = []
        window.Worker = class extends Base {
            constructor(url: string | URL, options?: WorkerOptions) {
                super(url, options)
                this.addEventListener('message', ({data}) => {
                    if (data.vector)
                        (window as any).__semanticVectors.push({
                            length: data.vector.length,
                            norm: Math.hypot(...data.vector),
                        })
                })
            }
        }
    })
    const assets: string[] = []
    page.on('request', (request) => {
        if (request.url().includes('/assets/ml/')) assets.push(request.url())
    })
    await preparePage(page, {state: initialState(1)})
    await page.goto('/')
    await expect(page.locator('.feed__item').first()).toBeVisible()
    expect(assets).toEqual([])
    await page.getByRole('button', {name: 'Настройки', exact: true}).click()
    await page.locator('[data-settings-section="interface"]').click()
    await expect(
        page.getByRole('status', {
            name: 'Смысловой прогноз: Выключен',
            exact: true,
        }),
    ).toBeVisible()
    await page
        .getByRole('button', {name: /Загрузить данные для прогноза/})
        .click()
    await expect(
        page.getByText('Локальная обработка включена.', {exact: false}),
    ).toBeVisible({timeout: 60000})
    expect(assets.some((url) => url.endsWith('.onnx.gz'))).toBe(true)
    await expect
        .poll(() =>
            page.evaluate(() => (window as any).__semanticVectors.length),
        )
        .toBeGreaterThan(0)
    const vector = await page.evaluate(
        () => (window as any).__semanticVectors[0],
    )
    expect(vector.length).toBe(312)
    expect(vector.norm).toBeCloseTo(1, 5)
    expect(errors).toEqual([])
    const badge = page.getByRole('status', {
        name: 'Смысловой прогноз: Включён',
        exact: true,
    })
    await expect(badge).toBeVisible()
    await page.screenshot({
        path: 'output/playwright/semantic-status-desktop.png',
    })
    await page.setViewportSize({width: 320, height: 568})
    await expect(badge).toBeVisible()
    expect(
        await badge.evaluate((element) => {
            const badge = element.getBoundingClientRect()
            const heading = element.parentElement!.getBoundingClientRect()
            const title = element
                .parentElement!.querySelector('h4')!
                .getBoundingClientRect()
            return (
                badge.left >= title.right &&
                badge.right <= heading.right + 1 &&
                badge.left >= heading.left
            )
        }),
    ).toBe(true)
    await page.screenshot({
        path: 'output/playwright/semantic-status-mobile.png',
    })
    await page.getByRole('button', {name: 'Выключить обработку'}).click()
    await expect(
        page.getByRole('status', {
            name: 'Смысловой прогноз: Выключен',
            exact: true,
        }),
    ).toBeVisible()
    assets.length = 0
    await page
        .getByRole('button', {name: /Загрузить данные для прогноза/})
        .click()
    await expect(
        page.getByText('Локальная обработка включена.', {exact: false}),
    ).toBeVisible({timeout: 30000})
    expect(assets).toEqual([])
    expect(errors).toEqual([])
})

test('corrupt semantic payload produces a recoverable error without blocking reading', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.route('**/assets/ml/**/*.gz', (route) =>
        route.fulfill({body: 'corrupt'}),
    )
    await page.goto('/')
    await page.getByRole('button', {name: 'Настройки', exact: true}).click()
    await page.locator('[data-settings-section="interface"]').click()
    await page
        .getByRole('button', {name: /Загрузить данные для прогноза/})
        .click()
    await expect(
        page.getByRole('status', {
            name: 'Смысловой прогноз: Ошибка',
            exact: true,
        }),
    ).toBeVisible()
    await expect(
        page.getByText('Не удалось подготовить прогноз.', {exact: false}),
    ).toBeVisible()
    await expect(
        page.getByRole('button', {name: /Загрузить данные для прогноза/}),
    ).toBeEnabled()
    await page.getByRole('button', {name: 'Закрыть', exact: true}).click()
    await expect(page.locator('.feed__item').first()).toBeVisible()
})
