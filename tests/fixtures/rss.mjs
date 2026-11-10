export const fixedTime = Date.parse('2026-11-10T12:00:00Z')
export const widths = [1440, 1100, 900, 721, 720, 390, 320]
export function initialState(count = 8) {
    return {
        folders: Array.from({length: count}, (_, i) => ({
            id: `folder-${i}`, name: i ? `Новости ${i}` : 'Дизайн и разработка',
            feeds: [{id: `feed-${i}`, name: i ? `Источник ${i}` : 'Избранный источник', url: `https://feeds.example/${i}`, isFavorite: i === 0}],
        })),
        settings: {autoMarkReadOnScroll: false, autoRefreshFeeds: false, showRecommendedColumn: false, blockedTitlePhrases: []},
        visitedItemKeys: ['https://articles.example/1'], clickedItemKeys: [],
    }
}
export function feedXml(extra = 0) {
    return `<?xml version="1.0"?><rss version="2.0"><channel><title>Тестовая лента</title>${Array.from({length: 40 + extra}, (_, n) => {
        const i = n - extra
        return `<item><guid>item-${i}</guid><title>${i === 2 ? 'Очень длинный заголовок публикации для проверки переноса текста на узких экранах' : `Дизайн интерфейса и разработка ${i}`}</title><link>https://articles.example/${i}</link><pubDate>${new Date(fixedTime - i * 3600000).toUTCString()}</pubDate></item>`
    }).join('')}</channel></rss>`
}
export async function preparePage(page, {state = initialState(), extra = () => 0, fail = () => false} = {}) {
    await page.clock.install({time: fixedTime})
    await page.addInitScript(state => localStorage.setItem('start:rss:v1', JSON.stringify(state)), state)
    await page.route('https://cors.kurilov.workers.dev/**', route => route.fulfill({status: fail() ? 503 : 200, contentType: 'application/xml', body: feedXml(extra())}))
}
