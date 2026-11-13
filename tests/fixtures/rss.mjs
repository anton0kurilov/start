export const fixedTime = Date.parse('2026-11-10T12:00:00Z')
export const widths = [1440, 1100, 900, 721, 720, 390, 320]
export function initialState(count = 8) {
    return {
        folders: Array.from({length: count}, (_, i) => ({
            id: `folder-${i}`,
            name: i ? `Новости ${i}` : 'Дизайн и разработка',
            feeds: [
                {
                    id: `feed-${i}`,
                    name: i ? `Источник ${i}` : 'Избранный источник',
                    url: `https://feeds.example/${i}`,
                    isFavorite: i === 0,
                },
            ],
        })),
        settings: {
            autoMarkReadOnScroll: false,
            autoRefreshFeeds: false,
            showRecommendedColumn: false,
            blockedTitlePhrases: [],
        },
        visitedItemKeys: ['https://articles.example/1'],
        clickedItemKeys: [],
    }
}
export function feedXml(extra = 0) {
    return `<?xml version="1.0"?><rss version="2.0"><channel><title>Тестовая лента</title>${Array.from(
        {length: 40 + extra},
        (_, n) => {
            const i = n - extra
            return `<item><guid>item-${i}</guid><title>${i === 2 ? 'Очень длинный заголовок публикации для проверки переноса текста на узких экранах' : `Дизайн интерфейса и разработка ${i}`}</title><link>https://articles.example/${i}</link><pubDate>${new Date(fixedTime - i * 3600000).toUTCString()}</pubDate></item>`
        },
    ).join('')}</channel></rss>`
}
export async function preparePage(
    page,
    {state = initialState(), extra = () => 0, fail = () => false} = {},
) {
    await page.clock.install({time: fixedTime})
    await page.addInitScript(
        (state) => localStorage.setItem('start:rss:v1', JSON.stringify(state)),
        state,
    )
    await page.route('https://cors.kurilov.workers.dev/**', (route) =>
        route.fulfill({
            status: fail() ? 503 : 200,
            contentType: 'application/xml',
            body: feedXml(extra()),
        }),
    )
}

export function signalState(bias = 0.35) {
    return {
        ...initialState(2),
        settings: {...initialState(2).settings, showRecommendedColumn: true},
        clickedItemKeys: ['https://articles.example/0'],
        modelState: {
            schemaVersion: 1,
            modelVersion: 2,
            interactionLog: [
                {
                    type: 'dismiss',
                    itemKey: 'https://articles.example/3',
                    recordedAt: fixedTime - 60000,
                    snapshot: {
                        source: 'Избранный источник',
                        feedId: 'feed-0',
                        title: 'Дизайн интерфейса и разработка 3',
                        link: 'https://articles.example/3',
                        publishedAt: new Date(
                            fixedTime - 10800000,
                        ).toISOString(),
                    },
                },
            ],
            publishedModelArtifacts: {
                totalLabeledSamples: 42,
                bias,
                weights: {},
                baselineCtr: 0.12,
            },
            publishedCalibrationArtifacts: {
                ready: true,
                slope: 1,
                intercept: 0,
                metrics: {ece: 0.04},
            },
        },
    }
}

export async function storedState(page) {
    return page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('start:data:v2')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
        })
        const result = await new Promise((resolve, reject) => {
            const tx = db.transaction(['profiles', 'records', 'metadata'])
            const active = tx.objectStore('metadata').get('active-profile')
            active.onsuccess = () => {
                const scope = active.result?.value || 'guest'
                const profile = tx.objectStore('profiles').get(scope)
                const records = tx
                    .objectStore('records')
                    .index('scope')
                    .getAll(scope)
                records.onsuccess = () => {
                    const rows = (kind) =>
                        records.result.filter(
                            (r) => r.kind === kind && !r.deleted,
                        )
                    const order = (a, b) =>
                        (a.data.position || 0) - (b.data.position || 0) ||
                        a.id.localeCompare(b.id)
                    const settings = {
                        semanticEnabled: profile.result?.semanticEnabled,
                        blockedTitlePhrases: rows('phrase')
                            .filter((r) => r.data.enabled)
                            .map((r) => r.data.phrase),
                    }
                    for (const row of rows('preference'))
                        settings[row.id] = row.data.value
                    const folders = rows('folder')
                        .sort(order)
                        .map((r) => ({
                            id: r.id,
                            name: r.data.name,
                            feeds: rows('subscription')
                                .filter((s) => s.data.folderId === r.id)
                                .sort(order)
                                .map((s) => ({id: s.id, ...s.data})),
                        }))
                    const observations = rows('observation')
                        .filter(
                            (r) =>
                                r.data.observation.profileId ===
                                profile.result.learnerId,
                        )
                        .map((r) => r.data.observation)
                    tx.oncomplete = () =>
                        resolve({
                            folders,
                            settings,
                            visitedItemKeys: rows('read')
                                .filter((r) => r.data.value)
                                .map((r) => r.data.itemKey),
                            clickedItemKeys: rows('feedback')
                                .filter((r) => r.data.clicked)
                                .map((r) => r.data.itemKey),
                            lastUpdated: profile.result?.lastUpdated || null,
                            modelState: {
                                interactionLog: rows('event').map(
                                    (r) => r.data,
                                ),
                            },
                            observations,
                        })
                }
            }
            tx.onabort = () => reject(tx.error)
        })
        db.close()
        return result
    })
}
