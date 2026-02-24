import {
    addFeed,
    createFolder,
    exportState,
    getState,
    importState,
    markItemsVisited,
    refreshAll,
    registerFeedItemClick,
    removeFeed,
    removeFolder,
    resetState,
    setAutoMarkReadOnScroll,
    shouldAutoMarkReadOnScroll,
    unmarkItemsVisited,
} from './domain.js'
import {
    applySettingsOpen,
    applySettingsTab,
    dismissStatus,
    elements,
    render,
    updateLastUpdated,
    updateStatus,
} from './ui.js'
import {createAppActions} from './app-actions.js'
import {createColumnInteractions} from './column-interactions.js'

function syncAppView({state = null, withLastUpdated = false} = {}) {
    const nextState = state || getState()
    render(nextState)
    if (withLastUpdated) {
        updateLastUpdated(nextState.lastUpdated)
    }
    return nextState
}

function syncAppAndRefreshFeeds() {
    syncAppView()
    return refreshAllFeeds()
}

const columnInteractions = createColumnInteractions({
    columnsElement: elements.columns,
    markItemsVisited,
    registerFeedItemClick,
    shouldAutoMarkReadOnScroll,
    unmarkItemsVisited,
})

const appActions = createAppActions({
    elements,
    exportState,
    getState,
    importState,
    markHiddenFeedItemsInAllColumns:
        columnInteractions.markHiddenFeedItemsInAllColumns,
    onImportFileReset: handleImportFileChange,
    refreshAll,
    shouldAutoMarkReadOnScroll,
    syncAppView,
    updateStatus,
})

init()

function refreshAllFeeds() {
    return appActions.refreshAllFeeds()
}

function handleExportJson() {
    return appActions.handleExportJson()
}

function handleImportJson(event) {
    return appActions.handleImportJson(event)
}

function handleColumnHeaderClick(event) {
    return columnInteractions.handleColumnHeaderClick(event)
}

function handleColumnScroll(event) {
    return columnInteractions.handleColumnScroll(event)
}

function init() {
    setupSafeAreaRefresh()
    bindEvents()
    applySettingsOpen(false)
    applySettingsTab()
    refreshAllFeeds()
}

function setupSafeAreaRefresh() {
    const root = document.documentElement
    const applySafeAreaVars = () => {
        root.style.setProperty('--safeAreaTop', 'env(safe-area-inset-top)')
        root.style.setProperty('--safeAreaRight', 'env(safe-area-inset-right)')
        root.style.setProperty(
            '--safeAreaBottom',
            'env(safe-area-inset-bottom)',
        )
        root.style.setProperty('--safeAreaLeft', 'env(safe-area-inset-left)')
    }

    const scheduleSafeAreaRefresh = () => {
        requestAnimationFrame(applySafeAreaVars)
    }

    applySafeAreaVars()
    window.addEventListener('pageshow', scheduleSafeAreaRefresh)
    window.addEventListener('orientationchange', scheduleSafeAreaRefresh)
    window.addEventListener('resize', scheduleSafeAreaRefresh)
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
    if (elements.columns) {
        elements.columns.addEventListener('click', handleColumnHeaderClick)
        elements.columns.addEventListener('scroll', handleColumnScroll, true)
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
    if (elements.autoMarkReadOnScroll) {
        elements.autoMarkReadOnScroll.addEventListener(
            'change',
            handleAutoMarkReadOnScrollChange,
        )
    }
    if (elements.statusClose) {
        elements.statusClose.addEventListener('click', handleDismissStatus)
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
    syncAppView()
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
    syncAppAndRefreshFeeds()
}

function handleListActions(event) {
    const button = event.target.closest('[data-action]')
    if (!button) {
        return
    }
    const action = button.dataset.action
    if (action === 'remove-folder') {
        handleRemoveFolderAction(button)
        return
    }
    if (action === 'remove-feed') {
        handleRemoveFeedAction(button)
    }
}

function handleRemoveFolderAction(button) {
    const wrapper = button.closest('[data-folder-id]')
    if (!wrapper) {
        return
    }
    const folderId = wrapper.dataset.folderId
    removeFolder(folderId)
    syncAppAndRefreshFeeds()
}

function handleRemoveFeedAction(button) {
    const feedRow = button.closest('[data-feed-id]')
    const folderWrapper = button.closest('[data-folder-id]')
    if (!feedRow || !folderWrapper) {
        return
    }
    const feedId = feedRow.dataset.feedId
    const folderId = folderWrapper.dataset.folderId
    removeFeed(folderId, feedId)
    syncAppAndRefreshFeeds()
}

function handleReset() {
    const confirmReset = window.confirm(
        'Сбросить папки и потоки к начальному состоянию?',
    )
    if (!confirmReset) {
        return
    }
    resetState()
    syncAppAndRefreshFeeds()
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

function handleAutoMarkReadOnScrollChange(event) {
    const target = event.currentTarget
    if (!target) {
        return
    }
    setAutoMarkReadOnScroll(Boolean(target.checked))
    if (shouldAutoMarkReadOnScroll()) {
        columnInteractions.markHiddenFeedItemsInAllColumns()
    }
}

function handleDismissStatus() {
    dismissStatus()
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
