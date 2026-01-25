import {
    addFeed,
    createFolder,
    getState,
    refreshAll,
    removeFeed,
    removeFolder,
    resetState,
} from './domain.js'
import {
    applySettingsOpen,
    elements,
    render,
    updateLastUpdated,
    updateStatus,
} from './ui.js'

init()

function init() {
    bindEvents()
    applySettingsOpen(false)
    render(getState())
    updateLastUpdated(getState().lastUpdated)
    refreshAllFeeds()
}

function bindEvents() {
    if (elements.folderForm) {
        elements.folderForm.addEventListener('submit', handleCreateFolder)
    }
    if (elements.feedForm) {
        elements.feedForm.addEventListener('submit', handleAddFeed)
    }
    if (elements.foldersList) {
        elements.foldersList.addEventListener('click', handleListActions)
    }
    if (elements.refresh) {
        elements.refresh.addEventListener('click', () => refreshAllFeeds())
    }
    if (elements.reset) {
        elements.reset.addEventListener('click', handleReset)
    }
    if (elements.toggleSettings.length) {
        elements.toggleSettings.forEach((toggle) => {
            toggle.addEventListener('click', handleToggleSettings)
        })
    }
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            applySettingsOpen(false)
        }
    })
}

function handleCreateFolder(event) {
    event.preventDefault()
    const formData = new FormData(event.target)
    const name = String(formData.get('folderName') || '').trim()
    if (!name) {
        return
    }
    createFolder(name)
    event.target.reset()
    render(getState())
}

function handleAddFeed(event) {
    event.preventDefault()
    const formData = new FormData(event.target)
    const name = String(formData.get('feedName') || '').trim()
    const rawUrl = String(formData.get('feedUrl') || '').trim()
    const folderId = String(formData.get('folderId') || '')
    if (!name || !rawUrl || !folderId) {
        return
    }
    addFeed({
        folderId,
        name,
        url: rawUrl,
    })
    event.target.reset()
    render(getState())
    refreshAllFeeds()
}

function handleListActions(event) {
    const button = event.target.closest('[data-action]')
    if (!button) {
        return
    }
    const action = button.dataset.action
    if (action === 'remove-folder') {
        const wrapper = button.closest('[data-folder-id]')
        if (!wrapper) {
            return
        }
        const folderId = wrapper.dataset.folderId
        removeFolder(folderId)
        render(getState())
        refreshAllFeeds()
    }
    if (action === 'remove-feed') {
        const feedRow = button.closest('[data-feed-id]')
        const folderWrapper = button.closest('[data-folder-id]')
        if (!feedRow || !folderWrapper) {
            return
        }
        const feedId = feedRow.dataset.feedId
        const folderId = folderWrapper.dataset.folderId
        removeFeed(folderId, feedId)
        render(getState())
        refreshAllFeeds()
    }
}

function handleReset() {
    const confirmReset = window.confirm(
        'Сбросить папки и потоки к начальному состоянию?',
    )
    if (!confirmReset) {
        return
    }
    resetState()
    render(getState())
    refreshAllFeeds()
}

function handleToggleSettings() {
    const isOpen = elements.settings?.classList.contains('settings--open')
    applySettingsOpen(!isOpen)
}

async function refreshAllFeeds() {
    const currentState = getState()
    const feeds = currentState.folders.flatMap((folder) => folder.feeds)
    if (!feeds.length) {
        updateStatus('Добавьте потоки для обновления')
        render(currentState)
        updateLastUpdated(currentState.lastUpdated)
        return
    }

    updateStatus('Обновляю ленты...', 'loading')
    if (elements.refresh) {
        elements.refresh.disabled = true
    }

    const result = await refreshAll()

    if (result.errorsCount) {
        updateStatus(`Обновлено с ошибками: ${result.errorsCount}`, 'error')
    } else {
        updateStatus('Ленты обновлены')
    }
    const nextState = getState()
    updateLastUpdated(nextState.lastUpdated)
    render(nextState)
    if (elements.refresh) {
        elements.refresh.disabled = false
    }
}
