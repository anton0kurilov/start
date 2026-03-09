import {MAX_ITEMS_PER_FOLDER} from './constants.js'
import {
    getFeedItemUsefulness,
    getFolderItems,
    isItemVisited,
    registerFeedItemImpressions,
} from './domain.js'
import {formatCountLabel, formatRelativeTime, getHostname} from './utils.js'

export const elements = {
    folderForm: document.querySelector('[data-action="create-folder"]'),
    feedForm: document.querySelector('[data-action="add-feed"]'),
    foldersList: document.querySelector('[data-folders]'),
    columns: document.querySelector('[data-columns]'),
    status: document.querySelector('[data-status]'),
    statusText: document.querySelector('[data-status-text]'),
    statusClose: document.querySelector('[data-action="dismiss-status"]'),
    refresh: document.querySelector('[data-action="refresh"]'),
    reset: document.querySelector('[data-action="reset"]'),
    folderSelect: document.querySelector('select[name="folderId"]'),
    settings: document.querySelector('.settings'),
    settingsTabs: Array.from(document.querySelectorAll('[data-settings-tab]')),
    settingsPanels: Array.from(
        document.querySelectorAll('[data-settings-panel]'),
    ),
    toggleSettings: Array.from(
        document.querySelectorAll('[data-action="toggle-settings"]'),
    ),
    lastUpdated: document.querySelector('[data-last-updated]'),
    exportJson: document.querySelector('[data-action="export-json"]'),
    importForm: document.querySelector('[data-action="import-json"]'),
    importFile: document.querySelector('[data-import-file]'),
    importFileTrigger: document.querySelector(
        '[data-action="trigger-import-file"]',
    ),
    importFileName: document.querySelector('[data-import-filename]'),
    autoMarkReadOnScroll: document.querySelector(
        '[name="autoMarkReadOnScroll"]',
    ),
    useClickModelV2: document.querySelector('[name="useClickModelV2"]'),
}

let lastUpdatedTimerId = null
let feedItemTimesTimerId = null
let statusDismissTimerId = null
const RECENT_ITEM_WINDOW_MS = 30 * 60 * 1000
const RELATIVE_TIME_UPDATE_INTERVAL_MS = 60000
const STATUS_AUTO_DISMISS_MS = 15000
const FEED_LABEL_FORMS = ['поток', 'потока', 'потоков']
const FEED_ITEM_IMPRESSION_DWELL_MS = 1200
const FEED_ITEM_IMPRESSION_MIN_RATIO = 0.6
let activeSettingsTab = null
let feedItemImpressionObserver = null
const feedItemImpressionTimers = new Map()

export function render(state, {editingFeed = null} = {}) {
    renderSettings(state)
    renderFolderSelect(state)
    renderFoldersList(state, editingFeed)
    renderColumns(state)
}

function renderSettings(state) {
    if (elements.autoMarkReadOnScroll) {
        elements.autoMarkReadOnScroll.checked = Boolean(
            state.settings?.autoMarkReadOnScroll,
        )
    }
    if (elements.useClickModelV2) {
        elements.useClickModelV2.checked = Boolean(state.settings?.useClickModelV2)
    }
}

function setFeedFormDisabled(isDisabled) {
    if (!elements.feedForm) {
        return
    }
    const fields = elements.feedForm.querySelectorAll(
        'input, select, button, textarea',
    )
    fields.forEach((field) => {
        field.disabled = isDisabled
    })
    elements.feedForm.setAttribute('aria-disabled', String(isDisabled))
    const block =
        elements.feedForm.closest('.settings__block') ||
        elements.feedForm.closest('.settings__section')
    if (block) {
        block.classList.toggle('settings__block--disabled', isDisabled)
    }
}

function renderFolderSelect(state) {
    if (!elements.folderSelect) {
        return
    }
    elements.folderSelect.innerHTML = ''
    if (!state.folders.length) {
        setFeedFormDisabled(true)
        const option = document.createElement('option')
        option.value = ''
        option.textContent = 'Сначала создайте колонку'
        elements.folderSelect.appendChild(option)
        return
    }
    setFeedFormDisabled(false)
    state.folders.forEach((folder) => {
        const option = document.createElement('option')
        option.value = folder.id
        option.textContent = folder.name
        elements.folderSelect.appendChild(option)
    })
}

function renderFoldersList(state, editingFeed) {
    if (!elements.foldersList) {
        return
    }
    elements.foldersList.innerHTML = ''
    if (!state.folders.length) {
        const empty = document.createElement('div')
        empty.className = 'settings__empty'
        empty.textContent = 'Пока нет колонок. Создайте первую.'
        elements.foldersList.appendChild(empty)
        return
    }

    state.folders.forEach((folder) => {
        const wrapper = document.createElement('div')
        wrapper.className = 'settings__folder'
        wrapper.dataset.folderId = folder.id

        const header = document.createElement('div')
        header.className = 'settings__folder-header'

        const info = document.createElement('div')
        const name = document.createElement('div')
        name.className = 'settings__folder-name'
        name.textContent = folder.name
        const meta = document.createElement('div')
        meta.className = 'settings__folder-meta'
        meta.textContent = formatCountLabel(
            folder.feeds.length,
            FEED_LABEL_FORMS,
        )
        info.append(name, meta)

        const actions = document.createElement('div')
        actions.className = 'settings__folder-actions'
        const removeButton = document.createElement('button')
        removeButton.className = 'icon-btn icon-btn--danger'
        removeButton.type = 'button'
        removeButton.dataset.action = 'remove-folder'
        removeButton.textContent = 'Удалить'
        actions.appendChild(removeButton)

        header.append(info, actions)

        const feeds = document.createElement('div')
        feeds.className = 'settings__feeds'
        if (!folder.feeds.length) {
            const emptyFeed = document.createElement('div')
            emptyFeed.className = 'settings__feed is-muted'
            emptyFeed.textContent = 'Добавьте первый поток.'
            feeds.appendChild(emptyFeed)
        } else {
            folder.feeds.forEach((feed) => {
                const feedRow = createFeedRow({
                    feed,
                    isEditing:
                        editingFeed?.folderId === folder.id &&
                        editingFeed?.feedId === feed.id,
                })
                feeds.appendChild(feedRow)
            })
        }

        wrapper.append(header, feeds)
        elements.foldersList.appendChild(wrapper)
    })
}

function createFeedRow({feed, isEditing}) {
    const feedRow = document.createElement('div')
    feedRow.className = 'settings__feed'
    feedRow.dataset.feedId = feed.id

    if (isEditing) {
        feedRow.classList.add('settings__feed--editing')

        const editor = document.createElement('div')
        editor.className = 'settings__feed-editor'

        const fields = document.createElement('div')
        fields.className = 'settings__feed-fields'

        const nameInput = document.createElement('input')
        nameInput.className = 'control'
        nameInput.type = 'text'
        nameInput.value = feed.name
        nameInput.required = true
        nameInput.placeholder = 'Название подписки'
        nameInput.setAttribute('aria-label', 'Название подписки')
        nameInput.dataset.feedField = 'name'

        const urlInput = document.createElement('input')
        urlInput.className = 'control'
        urlInput.type = 'text'
        urlInput.value = feed.url
        urlInput.required = true
        urlInput.placeholder = 'URL-адрес потока (RSS)'
        urlInput.inputMode = 'url'
        urlInput.setAttribute('aria-label', 'URL-адрес потока')
        urlInput.dataset.feedField = 'url'

        fields.append(nameInput, urlInput)
        editor.appendChild(fields)

        const actions = document.createElement('div')
        actions.className = 'settings__feed-actions'

        const saveButton = document.createElement('button')
        saveButton.className = 'btn btn--primary settings__feed-btn'
        saveButton.type = 'button'
        saveButton.dataset.action = 'save-feed'
        saveButton.textContent = 'Сохранить'

        const cancelButton = document.createElement('button')
        cancelButton.className = 'btn btn--ghost settings__feed-btn'
        cancelButton.type = 'button'
        cancelButton.dataset.action = 'cancel-edit-feed'
        cancelButton.textContent = 'Отмена'

        actions.append(saveButton, cancelButton)
        feedRow.append(editor, actions)
        return feedRow
    }

    const feedInfo = document.createElement('div')
    feedInfo.className = 'settings__feed-info'

    const feedName = document.createElement('div')
    feedName.className = 'settings__feed-name'
    feedName.textContent = feed.name

    const feedUrl = document.createElement('div')
    feedUrl.className = 'settings__feed-url'
    feedUrl.textContent = getHostname(feed.url)

    feedInfo.append(feedName, feedUrl)

    const actions = document.createElement('div')
    actions.className = 'settings__feed-actions'

    const feedEdit = document.createElement('button')
    feedEdit.className = 'icon-btn'
    feedEdit.type = 'button'
    feedEdit.dataset.action = 'edit-feed'
    feedEdit.textContent = 'Изменить'

    const feedRemove = document.createElement('button')
    feedRemove.className = 'icon-btn icon-btn--danger'
    feedRemove.type = 'button'
    feedRemove.dataset.action = 'remove-feed'
    feedRemove.textContent = 'Удалить'

    actions.append(feedEdit, feedRemove)
    feedRow.append(feedInfo, actions)
    return feedRow
}

function renderColumns(state) {
    if (!elements.columns) {
        return
    }
    teardownFeedItemImpressionTracking()
    elements.columns.innerHTML = ''
    elements.columns.classList.toggle('columns--empty', !state.folders.length)
    const isRefreshing =
        elements.status?.classList.contains('fab__status--loading') || false

    if (!state.folders.length) {
        const empty = document.createElement('div')
        empty.className = 'columns__empty'
        empty.textContent =
            'Создайте первую колонку и подпишитесь на поток в настройках'
        elements.columns.appendChild(empty)
        ensureFeedItemTimesUpdates()
        return
    }

    state.folders.forEach((folder) => {
        const column = document.createElement('article')
        column.className = 'columns__item'

        const header = document.createElement('div')
        header.className = 'columns__header'
        const headerText = document.createElement('div')
        headerText.className = 'columns__header-text'
        const title = document.createElement('h2')
        title.className = 'columns__title'
        title.textContent = folder.name
        const markReadButton = document.createElement('button')
        markReadButton.className = 'btn btn--ghost columns__mark-read'
        markReadButton.type = 'button'
        markReadButton.dataset.action = 'mark-column-read'
        markReadButton.title = 'Отметить как прочитанное'
        markReadButton.setAttribute('aria-label', 'Отметить как прочитанное')

        const items = getFolderItems(folder)
        const visibleItems = items.slice(0, MAX_ITEMS_PER_FOLDER)
        markReadButton.disabled = !visibleItems.length
        const feedsLabel = formatCountLabel(folder.feeds.length, FEED_LABEL_FORMS)
        const meta = document.createElement('div')
        meta.className = 'columns__meta'
        meta.textContent = feedsLabel

        markReadButton.innerHTML = `
            <svg
                class="columns__mark-read-icon"
                viewBox="0 -960 960 960"
                aria-hidden="true"
                focusable="false"
            >
                <path
                    d="M268-240 42-466l57-56 170 170 56 56-57 56Zm226 0L268-466l56-57 170 170 368-368 56 57-424 424Zm0-226-57-56 198-198 57 56-198 198Z"
                />
            </svg>
        `

        headerText.append(title, meta)
        header.append(headerText, markReadButton)

        const content = document.createElement('div')
        content.className = 'columns__content'

        if (!folder.feeds.length) {
            const empty = document.createElement('div')
            empty.className = 'columns__empty'
            empty.textContent = 'Добавьте потоки в эту колонку.'
            content.appendChild(empty)
        } else if (!items.length) {
            const empty = document.createElement('div')
            empty.className = 'columns__empty'
            empty.textContent = isRefreshing
                ? 'Лента обновляется...'
                : 'Здесь пока нет новостей.'
            content.appendChild(empty)
        } else {
            visibleItems.forEach((item) => {
                const card = document.createElement('a')
                card.className = 'feed__item'
                applyFeedItemLink(card, item.link)
                const itemKey = buildFeedItemKey(item)
                if (itemKey) {
                    card.dataset.itemKey = itemKey
                    card.classList.toggle(
                        'feed__item--visited',
                        isItemVisited(itemKey),
                    )
                }
                card.dataset.itemSource = String(item.source || '').trim()
                card.dataset.itemTitle = String(item.title || '').trim()
                card.dataset.itemLink = String(item.link || '').trim()

                const source = document.createElement('div')
                source.className = 'feed__item-source'
                source.textContent = item.source || 'Источник'

                const headline = document.createElement('div')
                headline.className = 'feed__item-title'
                headline.textContent = item.title || 'Без заголовка'

                const time = document.createElement('div')
                time.className = 'feed__item-time'
                setFeedItemTime(time, item.date)

                const utility = createFeedItemUtility(item)
                const meta = document.createElement('div')
                meta.className = 'feed__item-meta'
                meta.append(time, utility)

                card.append(source, headline, meta)
                content.appendChild(card)
            })
        }

        column.append(header, content)
        elements.columns.appendChild(column)
    })

    observeFeedItemsForImpressions()
    ensureFeedItemTimesUpdates()
}

function observeFeedItemsForImpressions() {
    if (!elements.columns || typeof IntersectionObserver !== 'function') {
        return
    }
    const feedItems = Array.from(elements.columns.querySelectorAll('.feed__item'))
    if (!feedItems.length) {
        return
    }
    feedItemImpressionObserver = new IntersectionObserver(
        handleFeedItemImpressionEntries,
        {
            threshold: [0, FEED_ITEM_IMPRESSION_MIN_RATIO, 1],
        },
    )
    feedItems.forEach((feedItem) => {
        if (!isFeedItemEligibleForImpression(feedItem)) {
            return
        }
        feedItemImpressionObserver.observe(feedItem)
    })
}

function handleFeedItemImpressionEntries(entries) {
    entries.forEach((entry) => {
        const feedItem = entry?.target
        const itemKey = String(feedItem?.dataset?.itemKey || '').trim()
        if (!itemKey) {
            return
        }
        const isVisible =
            entry.isIntersecting &&
            entry.intersectionRatio >= FEED_ITEM_IMPRESSION_MIN_RATIO
        if (!isVisible) {
            clearFeedItemImpressionTimer(itemKey)
            return
        }
        scheduleFeedItemImpression(feedItem, itemKey)
    })
}

function scheduleFeedItemImpression(feedItem, itemKey) {
    if (!isFeedItemEligibleForImpression(feedItem)) {
        return
    }
    if (feedItemImpressionTimers.has(itemKey)) {
        return
    }
    const timerId = setTimeout(() => {
        feedItemImpressionTimers.delete(itemKey)
        if (!isFeedItemEligibleForImpression(feedItem)) {
            return
        }
        if (!isFeedItemVisibleInViewport(feedItem)) {
            return
        }
        const payload = resolveFeedItemImpressionPayload(feedItem)
        if (!payload) {
            return
        }
        registerFeedItemImpressions(payload)
        feedItemImpressionObserver?.unobserve(feedItem)
    }, FEED_ITEM_IMPRESSION_DWELL_MS)
    feedItemImpressionTimers.set(itemKey, timerId)
}

function clearFeedItemImpressionTimer(itemKey) {
    const timerId = feedItemImpressionTimers.get(itemKey)
    if (!timerId) {
        return
    }
    clearTimeout(timerId)
    feedItemImpressionTimers.delete(itemKey)
}

function teardownFeedItemImpressionTracking() {
    if (feedItemImpressionObserver) {
        feedItemImpressionObserver.disconnect()
        feedItemImpressionObserver = null
    }
    feedItemImpressionTimers.forEach((timerId) => {
        clearTimeout(timerId)
    })
    feedItemImpressionTimers.clear()
}

function resolveFeedItemImpressionPayload(feedItem) {
    if (!isFeedItemEligibleForImpression(feedItem)) {
        return null
    }
    return {
        itemKey: String(feedItem.dataset.itemKey || '').trim(),
        source: String(feedItem.dataset.itemSource || '').trim(),
        title: String(feedItem.dataset.itemTitle || '').trim(),
        link: String(feedItem.dataset.itemLink || '').trim(),
    }
}

function isFeedItemEligibleForImpression(feedItem) {
    if (!feedItem || feedItem.dataset.noLink === 'true') {
        return false
    }
    if (!feedItem.isConnected) {
        return false
    }
    return Boolean(String(feedItem.dataset.itemKey || '').trim())
}

function isFeedItemVisibleInViewport(feedItem) {
    if (!feedItem || typeof feedItem.getBoundingClientRect !== 'function') {
        return false
    }
    const rect = feedItem.getBoundingClientRect()
    if (!rect.width || !rect.height) {
        return false
    }
    const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth || 0
    const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight || 0
    return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < viewportHeight &&
        rect.left < viewportWidth
    )
}

function applyFeedItemLink(card, rawLink) {
    const link = String(rawLink || '').trim()
    if (link) {
        card.href = link
        card.target = '_blank'
        card.rel = 'noopener noreferrer'
        card.removeAttribute('aria-disabled')
        return
    }
    card.href = '#'
    card.dataset.noLink = 'true'
    card.setAttribute('aria-disabled', 'true')
    card.tabIndex = -1
}

function buildFeedItemKey(item) {
    const primaryKey = String(item.link || item.id || '').trim()
    if (primaryKey) {
        return primaryKey
    }
    const publishedAt =
        item.date instanceof Date && !Number.isNaN(item.date.getTime())
            ? item.date.toISOString()
            : ''
    return `${item.source || ''}|${item.title || ''}|${publishedAt}`.trim()
}

function createFeedItemUtility(item) {
    const utility = document.createElement('span')
    const usefulness = getFeedItemUsefulness(item)
    utility.className = 'feed__item-utility'
    utility.classList.add(`feed__item-utility--${usefulness.tone || 'learning'}`)
    if (usefulness.tone !== 'learning') {
        utility.appendChild(createFeedItemUtilityIcon())
    }
    const text = document.createElement('span')
    text.className = 'feed__item-utility-text'
    text.textContent = usefulness.label
    utility.appendChild(text)
    utility.title = usefulness.title
    return utility
}

function createFeedItemUtilityIcon() {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.classList.add('feed__item-utility-icon')
    icon.setAttribute('viewBox', '0 -960 960 960')
    icon.setAttribute('aria-hidden', 'true')
    icon.setAttribute('focusable', 'false')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute(
        'd',
        'M720-120H280v-520l280-280 50 50q7 7 11.5 19t4.5 23v14l-44 174h258q32 0 56 24t24 56v80q0 7-2 15t-4 15L794-168q-9 20-30 34t-44 14Zm-360-80h360l120-280v-80H480l54-220-174 174v406Zm0-406v406-406Zm-80-34v80H160v360h120v80H80v-520h200Z',
    )
    icon.appendChild(path)
    return icon
}

function setFeedItemTime(element, date) {
    if (!element) {
        return
    }
    if (!date || Number.isNaN(date.getTime())) {
        element.textContent = 'без даты'
        element.removeAttribute('title')
        delete element.dataset.publishedAt
        element.classList.remove('feed__item-time--fresh')
        return
    }
    element.dataset.publishedAt = date.toISOString()
    applyFeedItemTimeText(element, date)
}

function applyFeedItemTimeText(element, date) {
    element.textContent = formatRelativeTime(date)
    element.title = date.toLocaleString('ru-RU')
    element.classList.toggle('feed__item-time--fresh', isRecentItem(date))
}

function ensureFeedItemTimesUpdates() {
    if (!elements.columns) {
        if (feedItemTimesTimerId) {
            clearInterval(feedItemTimesTimerId)
            feedItemTimesTimerId = null
        }
        return
    }

    const timedElements = elements.columns.querySelectorAll(
        '.feed__item-time[data-published-at]',
    )
    if (!timedElements.length) {
        if (feedItemTimesTimerId) {
            clearInterval(feedItemTimesTimerId)
            feedItemTimesTimerId = null
        }
        return
    }

    if (feedItemTimesTimerId) {
        return
    }

    feedItemTimesTimerId = setInterval(() => {
        if (!elements.columns) {
            clearInterval(feedItemTimesTimerId)
            feedItemTimesTimerId = null
            return
        }
        updateFeedItemsTimes()
    }, RELATIVE_TIME_UPDATE_INTERVAL_MS)
}

function updateFeedItemsTimes() {
    if (!elements.columns) {
        return
    }
    const timedElements = elements.columns.querySelectorAll(
        '.feed__item-time[data-published-at]',
    )
    if (!timedElements.length) {
        if (feedItemTimesTimerId) {
            clearInterval(feedItemTimesTimerId)
            feedItemTimesTimerId = null
        }
        return
    }

    timedElements.forEach((element) => {
        const rawDate = element.dataset.publishedAt
        if (!rawDate) {
            return
        }
        const date = new Date(rawDate)
        if (Number.isNaN(date.getTime())) {
            element.textContent = 'без даты'
            element.removeAttribute('title')
            delete element.dataset.publishedAt
            element.classList.remove('feed__item-time--fresh')
            return
        }
        applyFeedItemTimeText(element, date)
    })
}

function isRecentItem(date) {
    if (!date || Number.isNaN(date.getTime())) {
        return false
    }
    const diff = Date.now() - date.getTime()
    return diff >= 0 && diff <= RECENT_ITEM_WINDOW_MS
}

export function updateStatus(text, tone = 'ready') {
    if (!elements.status || !elements.statusText) {
        clearStatusDismissTimer()
        return
    }
    clearStatusDismissTimer()
    elements.statusText.textContent = text
    elements.status.classList.remove('fab__status--loading', 'fab__status--error')
    const isError = tone === 'error'
    if (elements.statusClose) {
        elements.statusClose.disabled = !isError
    }
    if (tone === 'loading') {
        elements.status.classList.add('fab__status--loading')
    }
    if (isError) {
        elements.status.classList.add('fab__status--error')
        elements.status.hidden = false
        statusDismissTimerId = setTimeout(() => {
            dismissStatus()
        }, STATUS_AUTO_DISMISS_MS)
        return
    }
    elements.status.hidden = true
}

export function dismissStatus() {
    clearStatusDismissTimer()
    if (!elements.status) {
        return
    }
    elements.status.hidden = true
    elements.status.classList.remove('fab__status--error', 'fab__status--loading')
    if (elements.statusClose) {
        elements.statusClose.disabled = true
    }
}

function clearStatusDismissTimer() {
    if (!statusDismissTimerId) {
        return
    }
    clearTimeout(statusDismissTimerId)
    statusDismissTimerId = null
}

function clearLastUpdatedTimer() {
    if (!lastUpdatedTimerId) {
        return
    }
    clearInterval(lastUpdatedTimerId)
    lastUpdatedTimerId = null
}

export function setLastUpdatedInProgress() {
    if (!elements.lastUpdated) {
        clearLastUpdatedTimer()
        return
    }
    clearLastUpdatedTimer()
    elements.lastUpdated.textContent = 'в процессе'
    elements.lastUpdated.removeAttribute('title')
    delete elements.lastUpdated.dataset.lastUpdated
}

export function updateLastUpdated(lastUpdated) {
    if (!elements.lastUpdated) {
        return
    }
    clearLastUpdatedTimer()
    if (!lastUpdated) {
        elements.lastUpdated.textContent = 'еще не обновлялось'
        elements.lastUpdated.removeAttribute('title')
        delete elements.lastUpdated.dataset.lastUpdated
        return
    }
    const lastUpdatedDate = new Date(lastUpdated)
    if (Number.isNaN(lastUpdatedDate.getTime())) {
        elements.lastUpdated.textContent = 'неизвестно'
        elements.lastUpdated.removeAttribute('title')
        delete elements.lastUpdated.dataset.lastUpdated
        return
    }
    elements.lastUpdated.dataset.lastUpdated = lastUpdatedDate.toISOString()
    applyLastUpdatedText(lastUpdatedDate)
    lastUpdatedTimerId = setInterval(() => {
        if (!elements.lastUpdated) {
            clearLastUpdatedTimer()
            return
        }
        const storedValue = elements.lastUpdated.dataset.lastUpdated
        if (!storedValue) {
            clearLastUpdatedTimer()
            return
        }
        const storedDate = new Date(storedValue)
        if (Number.isNaN(storedDate.getTime())) {
            elements.lastUpdated.textContent = 'неизвестно'
            elements.lastUpdated.removeAttribute('title')
            delete elements.lastUpdated.dataset.lastUpdated
            clearLastUpdatedTimer()
            return
        }
        applyLastUpdatedText(storedDate)
    }, RELATIVE_TIME_UPDATE_INTERVAL_MS)
}

function applyLastUpdatedText(date) {
    elements.lastUpdated.textContent = formatRelativeTime(date)
    elements.lastUpdated.title = date.toLocaleString('ru-RU')
}

export function applySettingsOpen(isOpen) {
    if (!elements.settings) {
        return
    }
    elements.settings.classList.toggle('settings--open', isOpen)
    elements.settings.setAttribute('aria-hidden', String(!isOpen))
    document.body.classList.toggle('settings-is-open', isOpen)
    if (elements.toggleSettings.length) {
        elements.toggleSettings.forEach((toggle) => {
            if (toggle.hasAttribute('aria-expanded')) {
                toggle.setAttribute('aria-expanded', String(isOpen))
            }
        })
    }
}

export function applySettingsTab(tabId) {
    if (!elements.settingsTabs.length || !elements.settingsPanels.length) {
        return
    }
    const nextTabId =
        tabId ||
        activeSettingsTab ||
        elements.settingsTabs[0]?.dataset.settingsTab
    if (!nextTabId) {
        return
    }
    activeSettingsTab = nextTabId
    elements.settingsTabs.forEach((tab) => {
        const isActive = tab.dataset.settingsTab === nextTabId
        tab.classList.toggle('settings__tab--active', isActive)
        tab.setAttribute('aria-selected', String(isActive))
        tab.setAttribute('tabindex', isActive ? '0' : '-1')
    })
    elements.settingsPanels.forEach((panel) => {
        const isActive = panel.dataset.settingsPanel === nextTabId
        panel.classList.toggle('settings__panel-section--active', isActive)
        panel.hidden = !isActive
        panel.setAttribute('aria-hidden', String(!isActive))
    })
}
