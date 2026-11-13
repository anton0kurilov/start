import {test, expect, type Page} from '@playwright/test'
import {preparePage, initialState, storedState} from '../fixtures/rss.mjs'
import {supabaseFixture} from '../fixtures/supabase.mjs'

async function settings(page: Page, section = 'sync') {
    if (
        !(await page
            .getByRole('button', {name: 'Закрыть', exact: true})
            .isVisible())
    )
        await page.getByRole('button', {name: 'Настройки', exact: true}).click()
    await page.locator(`[data-settings-section="${section}"]`).click()
}
async function closeSettings(page: Page) {
    await page.getByRole('button', {name: 'Закрыть', exact: true}).click()
}

test('seed phrase connects two devices; queued changes and lost responses converge without duplicates', async ({
    page,
    browser,
}) => {
    test.setTimeout(90000)
    const backend = await supabaseFixture()
    const context = await browser.newContext()
    const other = await context.newPage()
    const errors: string[] = []
    for (const target of [page, other])
        target.on('pageerror', (error) => errors.push(error.message))
    try {
        await backend.route(page)
        await backend.route(other)
        await preparePage(page, {state: initialState(1)})
        await preparePage(other, {state: initialState(0)})
        await page.goto('/')
        await settings(page)
        await page
            .getByRole('button', {name: 'Создать профиль синхронизации'})
            .click()
        const phrase = await page
            .getByRole('textbox', {name: 'Сохраните фразу доступа'})
            .inputValue()
        expect(phrase.split(' ')).toHaveLength(12)
        await page
            .getByRole('checkbox', {name: 'Я сохранил фразу доступа'})
            .check()
        await page
            .getByRole('button', {name: 'Включить синхронизацию', exact: true})
            .click()
        await expect(
            page.getByRole('button', {name: 'Закрыть', exact: true}),
        ).not.toBeVisible()
        await expect(page.locator('.feed__item').first()).toBeVisible()
        await settings(page)
        await expect(
            page.getByRole('button', {name: 'Отключить это устройство'}),
        ).toBeVisible()
        await page
            .getByRole('button', {name: 'Синхронизировать', exact: true})
            .click()
        await expect(
            page.getByRole('status').filter({hasText: 'Синхронизировано'}),
        ).toBeVisible()

        await other.goto('http://localhost:4174/')
        await settings(other)
        await other
            .getByRole('button', {name: 'Подключить существующий профиль'})
            .click()
        await other
            .getByRole('textbox', {name: 'Фраза доступа', exact: true})
            .fill(phrase)
        await other
            .getByRole('button', {name: 'Подключить профиль', exact: true})
            .click()
        await expect(
            other.getByRole('button', {name: 'Закрыть', exact: true}),
        ).not.toBeVisible()
        await expect(other.locator('.feed__item').first()).toBeVisible()
        expect(backend.users.size).toBe(1)
        expect((await storedState(other)).folders[0].id).toBe('folder-0')

        // Different offline edits to the same subscription preserve both fields.
        await page.context().setOffline(true)
        await context.setOffline(true)
        await settings(page, 'sources')
        await page.locator('.settings__folder-toggle').first().click()
        await page
            .getByRole('button', {name: 'Изменить подписку', exact: true})
            .click()
        await page
            .getByRole('textbox', {name: 'Название подписки', exact: true})
            .fill('Общее название')
        await page.getByRole('button', {name: 'Сохранить', exact: true}).click()
        await expect(page.locator('.settings__feed-name').first()).toHaveText(
            'Общее название',
        )
        await settings(other, 'sources')
        await other.locator('.settings__folder-toggle').first().click()
        await other
            .getByRole('button', {
                name: 'Убрать подписку из избранного',
                exact: true,
            })
            .click()
        await page.context().setOffline(false)
        await context.setOffline(false)
        for (const target of [other, page, other]) {
            await settings(target)
            await target
                .getByRole('button', {name: 'Синхронизировать', exact: true})
                .click()
            await expect(
                target
                    .getByRole('status')
                    .filter({hasText: 'Синхронизировано'}),
            ).toBeVisible()
        }
        for (const target of [page, other]) {
            const subscription = (await storedState(target)).folders[0].feeds[0]
            expect(subscription.name).toBe('Общее название')
            expect(subscription.isFavorite).toBe(false)
        }

        // Source cohorts keep their provenance; action history is shared.
        await closeSettings(page)
        await settings(page, 'sources')
        await page
            .getByRole('button', {name: 'Новая колонка', exact: true})
            .click()
        await page
            .getByRole('textbox', {name: 'Название колонки', exact: true})
            .fill('С двух устройств')
        backend.dropPushResponse()
        await page
            .getByRole('button', {name: 'Создать колонку', exact: true})
            .click()
        await closeSettings(page)
        await settings(page)
        await page
            .getByRole('button', {name: 'Синхронизировать', exact: true})
            .click()
        await expect(
            page.getByRole('status').filter({hasText: 'Требуется внимание'}),
        ).toBeVisible()
        await page
            .getByRole('button', {name: 'Синхронизировать', exact: true})
            .click()
        await expect(
            page.getByRole('status').filter({hasText: 'Синхронизировано'}),
        ).toBeVisible()
        await settings(other)
        await other
            .getByRole('button', {name: 'Синхронизировать', exact: true})
            .click()
        await expect
            .poll(async () =>
                (await storedState(other)).folders.some(
                    (f: any) => f.name === 'С двух устройств',
                ),
            )
            .toBe(true)
        const duplicateCount = await backend.db.query(
            "select count(*)::integer as count from start.records where kind='folder' and data->>'name'='С двух устройств'",
        )
        expect(duplicateCount.rows[0].count).toBe(1)
        expect(
            backend.requests.every(
                (r: any) => !JSON.stringify(r).includes(phrase),
            ),
        ).toBe(true)
        expect(errors).toEqual([])

        await page.setViewportSize({width: 390, height: 844})
        await expect(
            page.getByRole('button', {name: 'Отключить это устройство'}),
        ).toBeVisible()
        await page.screenshot({
            path: 'output/playwright/sync-connected-mobile.png',
            animations: 'disabled',
        })
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true)
        await page
            .getByRole('button', {name: 'Отключить это устройство'})
            .click()
        await settings(other)
        await expect(
            other.getByRole('button', {name: 'Отключить это устройство'}),
        ).toBeVisible()
        await other
            .getByRole('button', {name: 'Синхронизировать', exact: true})
            .click()
        await expect(
            other.getByRole('status').filter({hasText: 'Синхронизировано'}),
        ).toBeVisible()
    } finally {
        await context.close()
        await backend.close()
    }
})

test('phrase form validates locally and clears secrets when leaving the settings section', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(0)})
    const requests: string[] = []
    await page.route('https://*.supabase.co/**', async (route) => {
        requests.push(route.request().url())
        await route.abort()
    })
    await page.goto('/')
    await settings(page)
    await page
        .getByRole('button', {name: 'Подключить существующий профиль'})
        .click()
    await page
        .getByRole('textbox', {name: 'Фраза доступа', exact: true})
        .fill('abandon '.repeat(12))
    await page
        .getByRole('button', {name: 'Подключить профиль', exact: true})
        .click()
    await expect(
        page.getByRole('alert').filter({hasText: 'Контрольная сумма'}),
    ).toBeVisible()
    expect(requests).toHaveLength(0)
    await page.locator('[data-settings-section="interface"]').click()
    await page.locator('[data-settings-section="sync"]').click()
    await expect(
        page.getByRole('button', {name: 'Создать профиль синхронизации'}),
    ).toBeVisible()
})
