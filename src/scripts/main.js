import {
    addFeed,
    createFolder,
    exportState,
    getState,
    importState,
    refreshAll,
    removeFeed,
    removeFolder,
    resetState,
} from './domain.js'
import {
    applySettingsOpen,
    applySettingsTab,
    elements,
    render,
    updateLastUpdated,
    updateStatus,
} from './ui.js'

init()

function init() {
    bindEvents()
    applySettingsOpen(false)
    applySettingsTab()
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
    if (elements.exportJson) {
        elements.exportJson.addEventListener('click', handleExportJson)
    }
    if (elements.importForm) {
        elements.importForm.addEventListener('submit', handleImportJson)
    }
    if (elements.importFileTrigger) {
        elements.importFileTrigger.addEventListener(
            'click',
            handleTriggerImportFile,
        )
    }
    if (elements.importFile) {
        elements.importFile.addEventListener('change', handleImportFileChange)
    }
    if (elements.toggleSettings.length) {
        elements.toggleSettings.forEach((toggle) => {
            toggle.addEventListener('click', handleToggleSettings)
        })
    }
    if (elements.settingsTabs.length) {
        elements.settingsTabs.forEach((tab) => {
            tab.addEventListener('click', handleSettingsTabClick)
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

function handleSettingsTabClick(event) {
    const tab = event.currentTarget
    if (!tab) {
        return
    }
    applySettingsTab(tab.dataset.settingsTab)
}

function handleTriggerImportFile() {
    if (elements.importFile) {
        elements.importFile.click()
    }
}

function handleImportFileChange() {
    if (!elements.importFileName) {
        return
    }
    const file = elements.importFile?.files?.[0]
    elements.importFileName.textContent = file ? file.name : 'Файл не выбран'
}

function handleExportJson() {
    const payload = exportState()
    const filename = buildExportFilename()
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], {type: 'application/json'})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    updateStatus('Экспортировано в JSON')
}

async function handleImportJson(event) {
    event.preventDefault()
    const file = elements.importFile?.files?.[0]
    if (!file) {
        if (elements.importFile) {
            elements.importFile.click()
        }
        updateStatus('Выберите JSON-файл для импорта', 'error')
        return
    }
    const confirmed = window.confirm(
        'Импорт заменит текущие папки и потоки. Продолжить?',
    )
    if (!confirmed) {
        return
    }
    try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        const result = importState(parsed)
        if (!result.ok) {
            updateStatus('Не удалось импортировать данные', 'error')
            return
        }
        event.target.reset()
        handleImportFileChange()
        render(getState())
        updateLastUpdated(getState().lastUpdated)
        refreshAllFeeds()
    } catch (error) {
        updateStatus('Файл импорта содержит неверный JSON', 'error')
    }
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

function buildExportFilename() {
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate(),
    )}`
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`
    return `start-feeds-${date}-${time}.json`
}
