import {MAX_ITEMS_PER_FOLDER} from './constants.js'
import {getFolderItems} from './domain.js'
import {formatRelativeTime, getHostname} from './utils.js'

export const elements = {
    folderForm: document.querySelector('[data-action="create-folder"]'),
    feedForm: document.querySelector('[data-action="add-feed"]'),
    foldersList: document.querySelector('[data-folders]'),
    columns: document.querySelector('[data-columns]'),
    status: document.querySelector('[data-status]'),
    refresh: document.querySelector('[data-action="refresh"]'),
    reset: document.querySelector('[data-action="reset"]'),
    folderSelect: document.querySelector('select[name="folderId"]'),
    settings: document.querySelector('.settings'),
    toggleSettings: Array.from(
        document.querySelectorAll('[data-action="toggle-settings"]'),
    ),
    lastUpdated: document.querySelector('[data-last-updated]'),
    exportJson: document.querySelector('[data-action="export-json"]'),
    importForm: document.querySelector('[data-action="import-json"]'),
    importFile: document.querySelector('[data-import-file]'),
}

let lastUpdatedTimerId = null

export function render(state) {
    renderFolderSelect(state)
    renderFoldersList(state)
    renderColumns(state)
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
    const section = elements.feedForm.closest('.settings__section')
    if (section) {
        section.classList.toggle('settings__section--disabled', isDisabled)
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
        option.textContent = 'Сначала создайте папку'
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

function renderFoldersList(state) {
    if (!elements.foldersList) {
        return
    }
    elements.foldersList.innerHTML = ''
    if (!state.folders.length) {
        const empty = document.createElement('div')
        empty.className = 'settings__empty'
        empty.textContent = 'Пока нет папок. Создайте первую.'
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
        meta.textContent = `${folder.feeds.length} потоков`
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
                const feedRow = document.createElement('div')
                feedRow.className = 'settings__feed'
                feedRow.dataset.feedId = feed.id

                const feedInfo = document.createElement('div')
                const feedName = document.createElement('div')
                feedName.className = 'settings__feed-name'
                feedName.textContent = feed.name
                const feedUrl = document.createElement('div')
                feedUrl.className = 'settings__feed-url'
                feedUrl.textContent = getHostname(feed.url)
                feedInfo.append(feedName, feedUrl)

                const feedRemove = document.createElement('button')
                feedRemove.className = 'icon-btn icon-btn--danger'
                feedRemove.type = 'button'
                feedRemove.dataset.action = 'remove-feed'
                feedRemove.textContent = 'Удалить'

                feedRow.append(feedInfo, feedRemove)
                feeds.appendChild(feedRow)
            })
        }

        wrapper.append(header, feeds)
        elements.foldersList.appendChild(wrapper)
    })
}

function renderColumns(state) {
    if (!elements.columns) {
        return
    }
    elements.columns.innerHTML = ''
    elements.columns.classList.toggle('columns--empty', !state.folders.length)

    if (!state.folders.length) {
        const empty = document.createElement('div')
        empty.className = 'columns__empty'
        empty.textContent =
            'Создайте первую папку и подпишитесь на поток в настройках'
        elements.columns.appendChild(empty)
        return
    }

    state.folders.forEach((folder) => {
        const column = document.createElement('article')
        column.className = 'columns__item'

        const header = document.createElement('div')
        header.className = 'columns__header'
        const title = document.createElement('h2')
        title.className = 'columns__title'
        title.textContent = folder.name

        const items = getFolderItems(folder)
        const meta = document.createElement('div')
        meta.className = 'columns__meta'
        meta.textContent = `${folder.feeds.length} потоков · ${items.length} новостей`

        header.append(title, meta)

        const content = document.createElement('div')
        content.className = 'columns__content'

        if (!folder.feeds.length) {
            const empty = document.createElement('div')
            empty.className = 'columns__empty'
            empty.textContent = 'Добавьте потоки в эту папку.'
            content.appendChild(empty)
        } else if (!items.length) {
            const empty = document.createElement('div')
            empty.className = 'columns__empty'
            empty.textContent = 'Здесь пока нет новостей.'
            content.appendChild(empty)
        } else {
            items.slice(0, MAX_ITEMS_PER_FOLDER).forEach((item) => {
                const card = document.createElement('a')
                card.className = 'feed__item'
                card.href = item.link || '#'
                card.target = '_blank'
                card.rel = 'noopener noreferrer'

                const source = document.createElement('div')
                source.className = 'feed__item-source'
                source.textContent = item.source || 'Источник'

                const headline = document.createElement('div')
                headline.className = 'feed__item-title'
                headline.textContent = item.title || 'Без заголовка'

                const time = document.createElement('div')
                time.className = 'feed__item-time'
                time.textContent = formatRelativeTime(item.date)
                if (item.date) {
                    time.title = item.date.toLocaleString('ru-RU')
                }

                card.append(source, headline, time)
                content.appendChild(card)
            })
        }

        column.append(header, content)
        elements.columns.appendChild(column)
    })
}

export function updateStatus(text, tone = 'ready') {
    if (!elements.status) {
        return
    }
    elements.status.textContent = text
    elements.status.classList.remove(
        'fab__status--loading',
        'fab__status--error',
    )
    if (tone === 'loading') {
        elements.status.classList.add('fab__status--loading')
    }
    if (tone === 'error') {
        elements.status.classList.add('fab__status--error')
    }
}

export function updateLastUpdated(lastUpdated) {
    if (!elements.lastUpdated) {
        return
    }
    if (lastUpdatedTimerId) {
        clearInterval(lastUpdatedTimerId)
        lastUpdatedTimerId = null
    }
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
            clearInterval(lastUpdatedTimerId)
            lastUpdatedTimerId = null
            return
        }
        const storedValue = elements.lastUpdated.dataset.lastUpdated
        if (!storedValue) {
            clearInterval(lastUpdatedTimerId)
            lastUpdatedTimerId = null
            return
        }
        const storedDate = new Date(storedValue)
        if (Number.isNaN(storedDate.getTime())) {
            elements.lastUpdated.textContent = 'неизвестно'
            elements.lastUpdated.removeAttribute('title')
            delete elements.lastUpdated.dataset.lastUpdated
            clearInterval(lastUpdatedTimerId)
            lastUpdatedTimerId = null
            return
        }
        applyLastUpdatedText(storedDate)
    }, 60000)
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
