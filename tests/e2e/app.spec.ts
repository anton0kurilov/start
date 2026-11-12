import {test, expect, type Page} from '@playwright/test'
import {initialState, preparePage} from '../fixtures/rss.mjs'

async function settings(page: Page, section = 'sources') {
    await page.getByRole('button', {name: 'Настройки', exact: true}).click()
    await page.locator(`[data-settings-section="${section}"]`).click()
}
async function close(page: Page) {
    await page.getByRole('button', {name: 'Закрыть', exact: true}).click()
}
async function stored(page: Page) {
    return page.evaluate(() =>
        JSON.parse(localStorage.getItem('start:rss:v1')!),
    )
}

for (const viewport of [
    {width: 1440, height: 900},
    {width: 320, height: 568},
]) {
    test(`onboarding opens column creation and reaches the first feed at ${viewport.width}px`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport)
        await preparePage(page, {state: initialState(0)})
        await page.goto('/')
        await expect(
            page.getByRole('heading', {name: 'Ваша лента. Ваши источники.'}),
        ).toBeVisible()
        await page.screenshot({
            path: `output/playwright/onboarding-${viewport.width}.png`,
            animations: 'disabled',
        })
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true)

        // The entry point must work after another settings section was used.
        await settings(page, 'interface')
        await close(page)
        const start = page.getByRole('button', {
            name: 'Создать первую колонку',
        })
        await start.scrollIntoViewIfNeeded()
        const startBounds = await start.boundingBox()
        const controlsBounds = await page.locator('.fab').boundingBox()
        expect(startBounds!.y + startBounds!.height).toBeLessThanOrEqual(
            controlsBounds!.y,
        )
        await start.click()
        const name = page.getByRole('textbox', {
            name: 'Название колонки',
            exact: true,
        })
        await expect(name).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(start).toBeFocused()
        expect((await stored(page)).folders).toHaveLength(0)

        await start.click()
        await name.fill('Мои интересы')
        await page
            .getByRole('button', {name: 'Создать колонку', exact: true})
            .click()
        expect((await stored(page)).folders).toMatchObject([
            {name: 'Мои интересы', feeds: []},
        ])
        await close(page)
        await expect(start).toHaveCount(0)
        await expect(
            page.getByRole('heading', {name: /Мои интересы/}),
        ).toBeVisible()
        await expect(
            page.getByRole('button', {name: 'Настройки', exact: true}),
        ).toBeFocused()

        await settings(page)
        await expect(name).toBeHidden()
        await page.locator('.settings__folder-toggle').click()
        await page
            .getByRole('button', {name: 'Добавить первую подписку'})
            .click()
        await page
            .getByRole('textbox', {name: 'Название подписки', exact: true})
            .fill('Любимый сайт')
        await page
            .getByRole('textbox', {name: 'Прямая ссылка на RSS-поток'})
            .fill('https://feeds.example/first')
        await page
            .getByRole('button', {name: 'Подписаться', exact: true})
            .click()
        await expect(page.locator('#settings-feed-form')).toHaveCount(0)
        expect((await stored(page)).folders[0].feeds).toMatchObject([
            {name: 'Любимый сайт', url: 'https://feeds.example/first'},
        ])
        await close(page)
        await expect(page.locator('.feed__item')).toHaveCount(40)
    })
}

test('first local render does not wait for network and offline settings work', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.route('https://cors.kurilov.workers.dev/**', (route) =>
        route.abort(),
    )
    await page.addInitScript(() =>
        Object.defineProperty(navigator, 'onLine', {get: () => false}),
    )
    await page.goto('/')
    await expect(
        page.getByRole('heading', {name: 'Дизайн и разработка'}),
    ).toBeVisible()
    await expect(page.locator('[data-refresh-toast]')).toContainText(
        'Нет подключения',
    )
    await settings(page)
    await page.getByRole('button', {name: 'Новая колонка', exact: true}).click()
    await page
        .getByRole('textbox', {name: 'Название колонки', exact: true})
        .fill('Без сети')
    await page
        .getByRole('button', {name: 'Создать колонку', exact: true})
        .click()
    expect((await stored(page)).folders).toHaveLength(2)
})

test('opening and dismissing sync duplicates without changing reading position', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(2)})
    await page.goto('/')
    const copies = page.locator(
        '.feed__item[data-item-key="https://articles.example/0"]',
    )
    await expect(copies).toHaveCount(2)
    const popup = page.waitForEvent('popup')
    await copies.first().locator('a').click()
    await (await popup).close()
    await expect(copies.first()).toHaveClass(/--visited/)
    await expect(copies.last()).toHaveClass(/--visited/)
    await page
        .locator('.feed__item[data-item-key="https://articles.example/5"] a')
        .first()
        .click({button: 'middle'})
    const data = await stored(page)
    expect(
        data.modelState.interactionLog.filter(
            (event: {type: string}) => event.type === 'click',
        ),
    ).toHaveLength(2)
    await copies.first().getByRole('button').click()
    await expect(copies.first().getByRole('button')).toHaveAttribute(
        'aria-pressed',
        'true',
    )
    await expect(copies.last().getByRole('button')).toHaveAttribute(
        'aria-pressed',
        'true',
    )
    await expect(copies.first()).toHaveClass(/--visited/)
    await expect(copies.first().locator('.feed__item-utility')).toContainText(
        'скрыл',
    )
})

test('mark column toggles visible records in every copy', async ({page}) => {
    await preparePage(page, {state: initialState(2)})
    await page.goto('/')
    const action = page.locator('[data-action="mark-column-read"]').first()
    await expect(page.locator('.feed__item')).toHaveCount(80)
    await action.click()
    await expect(page.locator('.feed__item--visited')).toHaveCount(80)
    await action.click()
    await expect(page.locator('.feed__item--visited')).toHaveCount(0)
})

test('filter draft survives refresh, only saves explicitly and confirms saving', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.goto('/')
    await settings(page, 'filter')
    const field = page.getByRole('textbox', {name: 'Слова и фразы'})
    await field.fill('Очень длинный')
    await close(page)
    await page.locator('[data-action="refresh"]').click()
    await expect(page.locator('.feed__item')).toHaveCount(40)
    await settings(page, 'filter')
    await expect(field).toHaveValue('Очень длинный')
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click()
    await expect(
        page.getByRole('button', {name: 'Сохранено', exact: true}),
    ).toBeVisible()
    await expect(page.locator('.feed__item')).toHaveCount(39)
    await field.fill('')
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click()
    await expect(page.locator('.feed__item')).toHaveCount(40)
})

test('new items preserve the reading anchor and are not marked read on restore', async ({
    page,
}) => {
    let extra = 0
    const state = initialState(1)
    state.settings.autoMarkReadOnScroll = true
    await preparePage(page, {state, extra: () => extra})
    await page.goto('/')
    const content = page.locator('.columns__content').first()
    await expect(page.locator('.feed__item')).toHaveCount(40)
    await content.evaluate((el) => (el.scrollTop = 650))
    await page.waitForTimeout(300)
    const anchor = await content.evaluate((el) => {
        const top = el.getBoundingClientRect().top
        const card = Array.from(
            el.querySelectorAll<HTMLElement>('.feed__item'),
        ).find((item) => item.getBoundingClientRect().bottom > top)!
        return {
            key: card.dataset.itemKey,
            top: card.getBoundingClientRect().top,
        }
    })
    extra = 3
    await page.locator('[data-action="refresh"]').click()
    await expect(page.locator('[data-action="refresh"]')).toBeEnabled()
    const same = content.locator(`[data-item-key="${anchor.key}"]`)
    await expect
        .poll(async () => Math.abs((await same.boundingBox())!.y - anchor.top))
        .toBeLessThan(2)
    await expect(
        page.getByRole('button', {
            name: 'Новые материалы сверху. Перейти к началу колонки',
        }),
    ).toBeVisible()
    expect((await stored(page)).visitedItemKeys).not.toContain(
        'https://articles.example/-1',
    )
    await page
        .getByRole('button', {
            name: 'Новые материалы сверху. Перейти к началу колонки',
        })
        .click()
    await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBe(0)
    expect((await stored(page)).visitedItemKeys).not.toContain(
        'https://articles.example/-1',
    )
})

test('partial and complete failures preserve already loaded cards', async ({
    page,
}) => {
    let fail = false
    await preparePage(page, {state: initialState(1), fail: () => fail})
    await page.goto('/')
    await expect(page.locator('.feed__item')).toHaveCount(40)
    fail = true
    await page.locator('[data-action="refresh"]').click()
    await expect(page.locator('[data-refresh-toast]')).toContainText(
        'Не удалось',
    )
    await expect(page.locator('.feed__item')).toHaveCount(40)
    await expect(page.locator('.columns__notice')).toBeVisible()
    await page
        .getByRole('button', {name: 'Скрыть ошибку обновления', exact: true})
        .click()
    await expect(page.locator('.columns__notice')).toHaveCount(0)
})

test('add, validate, rename and favorite subscriptions with form drafts preserved', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.goto('/')
    await settings(page)
    await page.locator('.settings__folder-toggle').first().click()
    await page
        .getByRole('button', {name: 'Добавить подписку', exact: true})
        .click()
    await page
        .getByRole('textbox', {name: 'Название подписки', exact: true})
        .fill('Новая подписка')
    await close(page)
    await page.locator('[data-action="refresh"]').click()
    await settings(page)
    await expect(
        page.getByRole('textbox', {name: 'Название подписки', exact: true}),
    ).toHaveValue('Новая подписка')
    await page
        .getByRole('textbox', {name: 'Прямая ссылка на RSS-поток'})
        .fill('https://feeds.example/new')
    await page.getByRole('button', {name: 'Подписаться', exact: true}).click()
    await expect(page.locator('.settings__feed')).toHaveCount(2)
    await page
        .getByRole('button', {name: 'Изменить подписку', exact: true})
        .last()
        .click()
    await page
        .getByRole('textbox', {name: 'Название подписки', exact: true})
        .fill('Переименована')
    await page
        .getByRole('textbox', {name: 'URL-адрес потока', exact: true})
        .fill('javascript:alert(1)')
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click()
    await expect(page.locator('#feed-edit-error')).toBeVisible()
    await page
        .getByRole('textbox', {name: 'URL-адрес потока', exact: true})
        .fill('https://feeds.example/new')
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click()
    await expect(page.locator('.settings__feed-name').last()).toHaveText(
        'Переименована',
    )
    await page
        .getByRole('button', {
            name: 'Добавить подписку в избранное',
            exact: true,
        })
        .click()
    expect((await stored(page)).folders[0].feeds[1].isFavorite).toBe(true)
})

test('dialog traps focus, Escape restores origin and mobile navigation works', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.goto('/')
    await settings(page)
    await page.getByRole('button', {name: 'Закрыть', exact: true}).focus()
    await page.keyboard.press('Shift+Tab')
    const focusedInside = await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
    )
    expect(focusedInside).toBe(true)
    await page.keyboard.press('Escape')
    await expect(
        page.getByRole('button', {name: 'Настройки', exact: true}),
    ).toBeFocused()
    await page.setViewportSize({width: 390, height: 844})
    await page.getByRole('button', {name: 'Настройки', exact: true}).click()
    await expect(page.locator('.settings__navigation')).toBeVisible()
    await page.locator('[data-settings-section="interface"]').click()
    await expect(
        page.getByRole('button', {name: 'Назад к разделам настроек'}),
    ).toBeFocused()
    await page
        .getByRole('checkbox', {name: 'Автообновление каждые 5 минут'})
        .check()
    await page.getByRole('button', {name: 'Назад к разделам настроек'}).click()
    await expect(page.locator('.settings__navigation')).toBeVisible()
    await page.emulateMedia({reducedMotion: 'reduce'})
    expect(
        await page
            .locator('.settings__panel')
            .evaluate((el) => getComputedStyle(el).transitionDuration),
    ).toBe('0s')
})

test('keyboard reorder persists and keeps focus', async ({page}) => {
    await preparePage(page, {state: initialState(3)})
    await page.goto('/')
    await settings(page)
    const handle = page.getByRole('button', {
        name: 'Переместить колонку «Дизайн и разработка»',
        exact: true,
    })
    await handle.focus()
    await page.keyboard.press('ArrowDown')
    expect((await stored(page)).folders.map((f: {id: string}) => f.id)).toEqual(
        ['folder-1', 'folder-0', 'folder-2'],
    )
    await expect(handle).toBeFocused()
    await expect(page.getByRole('status').last()).toContainText(
        'Порядок сохранён',
    )
})

test('import reports invalid JSON; export round trip and reset keep confirmation', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.goto('/')
    await settings(page, 'transfer')
    page.on('dialog', (dialog) => void dialog.accept())
    await page.locator('input[type="file"]').setInputFiles({
        name: 'broken.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{broken'),
    })
    await expect(page.getByRole('alert').last()).toContainText(
        'корректный JSON',
    )
    const download = page.waitForEvent('download')
    await page.getByRole('button', {name: 'Экспортировать в JSON'}).click()
    const file = await download
    const path = await file.path()
    await page.locator('input[type="file"]').setInputFiles(path!)
    await expect(page.getByRole('alert').last()).not.toBeVisible()
    await expect(page.locator('#import-status')).toContainText(
        'Импорт завершён',
    )
    expect((await stored(page)).folders).toHaveLength(1)
    await page.getByRole('button', {name: 'Сбросить всё'}).click()
    expect((await stored(page))?.folders ?? []).toEqual([])
})

test('import shows reading, recovers from file errors and finishes before background refresh', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.addInitScript(() => {
        const read = File.prototype.text
        File.prototype.text = async function () {
            await new Promise<void>((resolve, reject) => {
                window.addEventListener(
                    'finish-import-read',
                    (event) => {
                        if ((event as CustomEvent<{fail: boolean}>).detail.fail)
                            reject(new Error('File cannot be read'))
                        else resolve()
                    },
                    {once: true},
                )
            })
            return read.call(this)
        }
    })
    await page.goto('/')
    await page.locator('.feed__item').first().waitFor()
    await settings(page, 'transfer')
    page.on('dialog', (dialog) => void dialog.accept())
    const file = {
        name: 'subscriptions.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(initialState(2))),
    }
    const input = page.getByLabel('JSON-файл для импорта')
    const button = page.locator('[data-action="trigger-import-file"]')
    const status = page.locator('#import-status')
    await input.setInputFiles(file)
    await expect(status).toHaveText('Чтение файла и импорт данных…')
    await expect(button).toHaveText('Импортируем…')
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(input).toBeDisabled()
    expect((await stored(page)).folders).toHaveLength(1)
    await page.evaluate(() =>
        window.dispatchEvent(
            new CustomEvent('finish-import-read', {detail: {fail: true}}),
        ),
    )
    await expect(page.locator('#import-error')).toContainText(
        'Не удалось прочитать',
    )
    await expect(status).not.toBeVisible()
    await expect(button).toBeEnabled()
    await expect(input).toBeEnabled()
    expect((await stored(page)).folders).toHaveLength(1)

    let release = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route('https://cors.kurilov.workers.dev/**', async (route) => {
        await gate
        await route.fallback()
    })
    try {
        await input.setInputFiles(file)
        await expect(status).toContainText('Чтение файла')
        await expect(page.locator('#import-error')).not.toBeVisible()
        await page.evaluate(() =>
            window.dispatchEvent(
                new CustomEvent('finish-import-read', {detail: {fail: false}}),
            ),
        )
        await expect(status).toContainText('Импорт завершён')
        await expect(status).toContainText('Настройки можно закрыть')
        await expect(button).toBeEnabled()
        await expect(button).toHaveAttribute('aria-busy', 'false')
        await expect(input).toBeEnabled()
        expect((await stored(page)).folders).toHaveLength(2)
        await expect(page.locator('[data-action="refresh"]')).toBeDisabled()
        await close(page)
        await settings(page, 'transfer')
        await expect(status).toContainText('Настройки можно закрыть')
    } finally {
        release()
    }
})

test('pointer reorder cancels with Escape and commits on drop', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(3)})
    await page.goto('/')
    await settings(page)
    const first = page.locator('[data-action="reorder-folder"]').first()
    const last = page.locator('[data-action="reorder-folder"]').last()
    const from = (await first.boundingBox())!,
        to = (await last.boundingBox())!
    await page.mouse.move(from.x + 10, from.y + 10)
    await page.mouse.down()
    await page.mouse.move(to.x + 10, to.y + 30, {steps: 8})
    await expect(page.locator('.settings__folder--drag-preview')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect((await stored(page)).folders[0].id).toBe('folder-0')
    await page.mouse.move(from.x + 10, from.y + 10)
    await page.mouse.down()
    await page.mouse.move(to.x + 10, to.y + 30, {steps: 8})
    await page.mouse.up()
    await expect
        .poll(async () => (await stored(page)).folders[2].id)
        .toBe('folder-0')
    await expect(page.locator('.settings__folder--drag-preview')).toHaveCount(0)
})

test('a subscription deleted during validation is not added to a missing folder', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.goto('/')
    await settings(page)
    await page.locator('.settings__folder-toggle').click()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route('https://cors.kurilov.workers.dev/**', async (route) => {
        await gate
        await route.fulfill({
            status: 200,
            contentType: 'application/xml',
            body: '<rss><channel><title>Empty</title></channel></rss>',
        })
    })
    await page
        .getByRole('button', {name: 'Добавить подписку', exact: true})
        .click()
    await page
        .getByRole('textbox', {name: 'Название подписки', exact: true})
        .fill('Pending')
    await page
        .getByRole('textbox', {name: 'Прямая ссылка на RSS-поток'})
        .fill('https://feeds.example/pending')
    await page.getByRole('button', {name: 'Подписаться', exact: true}).click()
    await expect(
        page.getByRole('button', {name: 'Проверка…', exact: true}),
    ).toBeDisabled()
    await page
        .getByRole('button', {name: 'Удалить колонку', exact: true})
        .click()
    release()
    await expect(page.locator('.settings__folder')).toHaveCount(0)
    expect((await stored(page)).folders).toHaveLength(0)
})

test('showing recommendations preserves the horizontal column anchor', async ({
    page,
}) => {
    await page.setViewportSize({width: 390, height: 844})
    await preparePage(page, {state: initialState(3)})
    await page.goto('/')
    const board = page.locator('[data-columns]')
    await expect(page.locator('.feed__item')).toHaveCount(120)
    await board.evaluate((el) => (el.scrollLeft = 390))
    await settings(page, 'interface')
    await page
        .getByRole('checkbox', {
            name: 'Показывать колонку с рекомендуемыми публикациями',
        })
        .check()
    await close(page)
    const position = await page
        .locator('[data-column-key="folder:folder-1"]')
        .boundingBox()
    expect(Math.abs(position!.x)).toBeLessThan(2)
})

test('auto refresh waits in a hidden tab and resumes once visible', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(1)})
    await page.goto('/')
    await expect(page.locator('.feed__item')).toHaveCount(40)
    await settings(page, 'interface')
    await page
        .getByRole('checkbox', {name: 'Автообновление каждые 5 минут'})
        .check()
    await close(page)
    await page.evaluate(() =>
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'hidden',
        }),
    )
    const previous = (await stored(page)).lastUpdated
    await page.clock.fastForward(300001)
    expect((await stored(page)).lastUpdated).toBe(previous)
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => 'visible',
        })
        document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect
        .poll(async () => (await stored(page)).lastUpdated)
        .not.toBe(previous)
})

test('reorder failure rolls back the visible order and announces the error', async ({
    page,
}) => {
    await preparePage(page, {state: initialState(3)})
    await page.goto('/')
    await settings(page)
    await page.evaluate(
        () =>
            (Storage.prototype.setItem = () => {
                throw new DOMException('Quota exceeded', 'QuotaExceededError')
            }),
    )
    await page
        .getByRole('button', {
            name: 'Переместить колонку «Дизайн и разработка»',
            exact: true,
        })
        .focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.settings__reorder-status')).toContainText(
        'Не удалось сохранить',
    )
    expect(
        await page
            .locator('.settings__folder')
            .evaluateAll((rows) =>
                rows.map((row) => (row as HTMLElement).dataset.folderId),
            ),
    ).toEqual(['folder-0', 'folder-1', 'folder-2'])
})
