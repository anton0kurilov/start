import {test, expect, type Page} from '@playwright/test'
import {initialState, feedXml, fixedTime} from '../fixtures/rss.mjs'

async function history(page: Page) {
    return page.evaluate(async () => {
        const state = JSON.parse(localStorage.getItem('start:rss:v1')!)
        if (!state.predictionGeneration) return []
        return new Promise<any[]>((resolve, reject) => {
            const request = indexedDB.open(
                `start:predictions:${state.predictionGeneration}`,
                1,
            )
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                const db = request.result
                const tx = db.transaction('observations')
                const rows = tx.objectStore('observations').getAll()
                tx.oncomplete = () => {
                    db.close()
                    resolve(rows.result)
                }
                tx.onabort = () => {
                    db.close()
                    reject(tx.error)
                }
            }
        })
    })
}

test('click history survives reload and preserves click followed by dismiss', async ({
    page,
}) => {
    await page.clock.install({time: fixedTime})
    await page.addInitScript((state) => {
        if (!localStorage.getItem('start:rss:v1'))
            localStorage.setItem('start:rss:v1', JSON.stringify(state))
    }, initialState(1))
    await page.route('https://cors.kurilov.workers.dev/**', (route) =>
        route.fulfill({
            contentType: 'application/xml',
            body: feedXml(),
        }),
    )
    await page.goto('/')
    await expect
        .poll(async () => (await history(page)).length)
        .toBeGreaterThan(0)
    const first = page.locator('.feed__item').first()
    const key = await first.getAttribute('data-item-key')
    const before = (await history(page)).find((row) => row.itemKey === key)
    const popupPromise = page.waitForEvent('popup')
    await first.locator('.feed__item-link').click()
    const popup = await popupPromise
    await popup.close()
    await first.locator('[data-action="dismiss-feed-item"]').click()
    await expect
        .poll(async () => {
            const row = (await history(page)).find((row) => row.itemKey === key)
            return !!row?.clickAt && !!row?.dismissAt
        })
        .toBe(true)
    await page.reload()
    await expect(page.locator('.feed__item').first()).toBeVisible()
    await expect
        .poll(async () => {
            const row = (await history(page)).find((row) => row.itemKey === key)
            return row?.observationId
        })
        .toBe(before.observationId)
    const row = (await history(page)).find((row) => row.itemKey === key)
    expect(row.clickAt).not.toBeNull()
    expect(row.dismissAt).not.toBeNull()
    expect(row.outcome).toBeNull()
    expect(row.deadlineAt - row.firstShownAt).toBe(86400000)
    expect(row.predictions.legacy).toBeNull()
})
