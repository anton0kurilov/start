import {MAX_ITEMS_PER_FOLDER} from './constants.js'
import {
    getFeedError,
    getFeedItemUsefulness,
    getFolderItems,
    isItemDismissed,
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
    autoRefreshFeeds: document.querySelector('[name="autoRefreshFeeds"]'),
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
const SETTINGS_EDIT_ICON = `
    <svg class="settings__action-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/>
    </svg>
`
const SETTINGS_DELETE_ICON = `
    <svg class="settings__action-icon" viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
        <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>
    </svg>
`
let activeSettingsTab = null
let feedItemImpressionObserver = null
const feedItemImpressionTimers = new Map()

export function render(state, {editingFeed = null, editingFolderId = null} = {}) {
    renderSettings(state)
    renderFolderSelect(state)
    renderFoldersList(state, editingFeed, editingFolderId)
    renderColumns(state)
}

function renderSettings(state) {
    if (elements.autoMarkReadOnScroll) {
        elements.autoMarkReadOnScroll.checked = Boolean(
            state.settings?.autoMarkReadOnScroll,
        )
    }
    if (elements.autoRefreshFeeds) {
        elements.autoRefreshFeeds.checked = Boolean(
            state.settings?.autoRefreshFeeds,
        )
    }
}

function createSettingsIconButton({action, label, variant = 'ghost', icon}) {
    const button = document.createElement('button')
    button.className = `btn btn--${variant} settings__icon-btn`
    button.type = 'button'
    button.dataset.action = action
    button.setAttribute('aria-label', label)
    button.title = label
    button.innerHTML = icon
    return button
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

function renderFoldersList(state, editingFeed, editingFolderId) {
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

        const actions = document.createElement('div')
        actions.className = 'settings__folder-actions'
        const feedsLabel = formatCountLabel(
            folder.feeds.length,
            FEED_LABEL_FORMS,
        )
        if (editingFolderId === folder.id) {
            header.classList.add('settings__folder-header--editing')

            const editor = document.createElement('div')
            editor.className = 'settings__folder-editor'

            const nameInput = document.createElement('input')
            nameInput.className = 'control'
            nameInput.type = 'text'
            nameInput.value = folder.name
            nameInput.required = true
            nameInput.placeholder = 'Название колонки'
            nameInput.setAttribute('aria-label', 'Название колонки')
            nameInput.dataset.folderField = 'name'

            const meta = document.createElement('div')
            meta.className = 'settings__folder-meta'
            meta.textContent = feedsLabel

            editor.append(nameInput, meta)

            const saveButton = document.createElement('button')
            saveButton.className = 'btn btn--primary settings__folder-btn'
            saveButton.type = 'button'
            saveButton.dataset.action = 'save-folder'
            saveButton.textContent = 'Сохранить'

            const cancelButton = document.createElement('button')
            cancelButton.className = 'btn btn--ghost settings__folder-btn'
            cancelButton.type = 'button'
            cancelButton.dataset.action = 'cancel-edit-folder'
            cancelButton.textContent = 'Отмена'

            actions.append(saveButton, cancelButton)
            header.append(editor, actions)
        } else {
            const info = document.createElement('div')
            info.className = 'settings__folder-info'
            const name = document.createElement('div')
            name.className = 'settings__folder-name'
            name.textContent = folder.name
            name.title = folder.name
            const meta = document.createElement('div')
            meta.className = 'settings__folder-meta'
            meta.textContent = feedsLabel
            info.append(name, meta)

            const editButton = createSettingsIconButton({
                action: 'edit-folder',
                label: 'Изменить колонку',
                icon: SETTINGS_EDIT_ICON,
            })

            const removeButton = createSettingsIconButton({
                action: 'remove-folder',
                label: 'Удалить колонку',
                variant: 'danger',
                icon: SETTINGS_DELETE_ICON,
            })

            actions.append(editButton, removeButton)
            header.append(info, actions)
        }

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
    feedName.title = feed.name

    const feedUrl = document.createElement('div')
    feedUrl.className = 'settings__feed-url'
    feedUrl.textContent = getHostname(feed.url)
    feedUrl.title = feed.url

    feedInfo.append(feedName, feedUrl)

    const actions = document.createElement('div')
    actions.className = 'settings__feed-actions'

    const feedEdit = createSettingsIconButton({
        action: 'edit-feed',
        label: 'Изменить подписку',
        icon: SETTINGS_EDIT_ICON,
    })

    const feedRemove = createSettingsIconButton({
        action: 'remove-feed',
        label: 'Удалить подписку',
        variant: 'danger',
        icon: SETTINGS_DELETE_ICON,
    })

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
        const failedFeeds = folder.feeds.filter((feed) => getFeedError(feed.id))
        const hasFeedErrors = failedFeeds.length > 0
        const haveAllFeedsFailed =
            Boolean(folder.feeds.length) &&
            failedFeeds.length === folder.feeds.length
        markReadButton.disabled = !visibleItems.length

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

        headerText.append(title)
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
            empty.className = hasFeedErrors
                ? 'columns__empty columns__empty--error'
                : 'columns__empty'
            if (isRefreshing) {
                empty.textContent = 'Лента обновляется...'
            } else if (hasFeedErrors) {
                empty.textContent =
                    'Не удалось загрузить новости. Попробуйте обновить позже.'
            } else {
                empty.textContent = 'Здесь пока нет публикаций.'
            }
            content.appendChild(empty)
        } else {
            if (hasFeedErrors) {
                content.appendChild(
                    createColumnRefreshNotice({
                        failedFeedsCount: failedFeeds.length,
                        totalFeedsCount: folder.feeds.length,
                        isStale: haveAllFeedsFailed,
                    }),
                )
            }
            visibleItems.forEach((item) => {
                const card = document.createElement('article')
                card.className = 'feed__item'
                const itemKey = buildFeedItemKey(item)
                const isDismissed = itemKey ? isItemDismissed(itemKey) : false
                if (itemKey) {
                    card.dataset.itemKey = itemKey
                    card.classList.toggle(
                        'feed__item--visited',
                        isItemVisited(itemKey),
                    )
                }
                card.classList.toggle('feed__item--dismissed', isDismissed)
                card.dataset.feedId = String(item.feedId || '').trim()
                card.dataset.itemSource = String(item.source || '').trim()
                card.dataset.itemTitle = String(item.title || '').trim()
                card.dataset.itemLink = String(item.link || '').trim()
                card.dataset.itemPublishedAt =
                    item.date instanceof Date && !Number.isNaN(item.date.getTime())
                        ? item.date.toISOString()
                        : ''

                const link = document.createElement('a')
                link.className = 'feed__item-link'
                link.dataset.feedLink = 'true'
                applyFeedItemLink(link, item.link)

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
                const metaControls = document.createElement('div')
                metaControls.className = 'feed__item-meta-controls'

                const actions = document.createElement('div')
                actions.className = 'feed__item-actions'
                actions.append(utility, createFeedItemDismissButton(isDismissed))

                metaControls.appendChild(actions)
                meta.append(time, metaControls)

                link.append(source, headline)
                card.append(link, meta)
                content.appendChild(card)
            })
        }

        column.append(header, content)
        elements.columns.appendChild(column)
    })

    observeFeedItemsForImpressions()
    ensureFeedItemTimesUpdates()
}

function createColumnRefreshNotice({
    failedFeedsCount,
    totalFeedsCount,
    isStale,
}) {
    const notice = document.createElement('div')
    notice.className = 'columns__notice'
    const failedFeedsLabel = formatCountLabel(
        failedFeedsCount,
        FEED_LABEL_FORMS,
    )
    const failedText =
        failedFeedsCount === 1
            ? `${failedFeedsLabel} не обновился`
            : `${failedFeedsLabel} не обновились`
    const suffix =
        isStale || failedFeedsCount === totalFeedsCount
            ? 'Показаны новости с прошлого обновления.'
            : 'Показаны доступные новости.'

    notice.textContent = `${failedText}. ${suffix}`
    return notice
}

function observeFeedItemsForImpressions() {
    if (!elements.columns || typeof IntersectionObserver !== 'function') {
        return
    }
    const feedItems = Array.from(
        elements.columns.querySelectorAll('.feed__item'),
    )
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
        feedId: String(feedItem.dataset.feedId || '').trim(),
        source: String(feedItem.dataset.itemSource || '').trim(),
        title: String(feedItem.dataset.itemTitle || '').trim(),
        link: String(feedItem.dataset.itemLink || '').trim(),
        publishedAt: String(feedItem.dataset.itemPublishedAt || '').trim(),
    }
}

function isFeedItemEligibleForImpression(feedItem) {
    const feedItemLink = feedItem?.querySelector?.('[data-feed-link="true"]')
    if (!feedItem || feedItemLink?.dataset.noLink === 'true') {
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
    utility.classList.add(
        `feed__item-utility--${usefulness.tone || 'learning'}`,
    )
    if (usefulness.tone !== 'learning') {
        utility.appendChild(createFeedItemUtilityIcon())
    }
    if (!isProbabilityUsefulnessLabel(usefulness.label)) {
        const text = document.createElement('span')
        text.className = 'feed__item-utility-text'
        text.textContent = usefulness.label
        utility.appendChild(text)
    }
    utility.title = usefulness.title
    utility.setAttribute('aria-label', usefulness.title)
    return utility
}

function isProbabilityUsefulnessLabel(label) {
    return /%/.test(String(label || ''))
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

function createFeedItemDismissButton(isDismissed = false) {
    const button = document.createElement('button')
    button.className = 'btn btn--ghost feed__item-dismiss'
    button.type = 'button'
    button.dataset.action = 'dismiss-feed-item'
    button.setAttribute('aria-label', 'Показывать меньше похожих публикаций')
    button.title = 'Показывать меньше похожих публикаций'
    button.setAttribute('aria-pressed', String(isDismissed))
    if (isDismissed) {
        button.classList.add('feed__item-dismiss--active')
    }
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    icon.classList.add('feed__item-dismiss-icon')
    icon.setAttribute('viewBox', '0 -960 960 960')
    icon.setAttribute('aria-hidden', 'true')
    icon.setAttribute('focusable', 'false')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute(
        'd',
        'M240-840h440v520L400-40l-50-50q-7-7-11.5-19t-4.5-23v-14l44-174H120q-32 0-56-24t-24-56v-80q0-7 2-15t4-15l120-282q9-20 30-34t44-14Zm360 80H240L120-480v80h360l-54 220 174-174v-406Zm0 406v-406 406Zm80 34v-80h120v-360H680v-80h200v520H680Z',
    )
    icon.appendChild(path)
    button.appendChild(icon)
    return button
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
    elements.status.classList.remove(
        'fab__status--loading',
        'fab__status--error',
    )
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
    elements.status.classList.remove(
        'fab__status--error',
        'fab__status--loading',
    )
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
