import {AUTO_REFRESH_INTERVAL_MS} from './constants.js'
import {
    addFeed,
    createFolder,
    exportState,
    getState,
    importState,
    markItemsVisited,
    refreshAll,
    registerFeedItemClick,
    registerFeedItemDismiss,
    removeFeed,
    removeFolder,
    resetState,
    setAutoMarkReadOnScroll,
    setAutoRefreshFeeds,
    shouldAutoMarkReadOnScroll,
    shouldAutoRefreshFeeds,
    unmarkItemsVisited,
    updateFolder,
    updateFeed,
} from './domain.js'
import {
    applySettingsOpen,
    applySettingsTab,
    dismissStatus,
    elements,
    render,
    setLastUpdatedInProgress,
    updateLastUpdated,
    updateStatus,
} from './ui.js'
import {createAppActions} from './app-actions.js'
import {createColumnInteractions} from './column-interactions.js'

let editingFeed = null
let editingFolderId = null
let autoRefreshTimerId = null

function syncAppView({
    state = null,
    withLastUpdated = false,
    preserveColumnScroll = false,
} = {}) {
    const nextState = state || getState()
    const scrollState = preserveColumnScroll ? captureColumnScrollState() : null
    render(nextState, {editingFeed, editingFolderId})
    if (scrollState) {
        restoreColumnScrollState(scrollState)
    }
    if (withLastUpdated) {
        updateLastUpdated(nextState.lastUpdated)
    }
    syncAutoRefreshSchedule()
    return nextState
}

function syncAppAndRefreshFeeds() {
    syncAppView()
    return refreshAllFeeds()
}

function captureColumnScrollState() {
    return {
        columnsScrollLeft: elements.columns?.scrollLeft || 0,
        itemScrollTops: Array.from(
            elements.columns?.querySelectorAll('.columns__item') || [],
        ).map((column) => column.scrollTop || 0),
        contentScrollTops: Array.from(
            elements.columns?.querySelectorAll('.columns__content') || [],
        ).map((content) => content.scrollTop || 0),
    }
}

function restoreColumnScrollState(scrollState) {
    if (!scrollState || !elements.columns) {
        return
    }
    elements.columns.scrollLeft = scrollState.columnsScrollLeft || 0
    const columnItems = Array.from(
        elements.columns.querySelectorAll('.columns__item'),
    )
    columnItems.forEach((column, index) => {
        column.scrollTop = scrollState.itemScrollTops?.[index] || 0
    })
    const columnContents = Array.from(
        elements.columns.querySelectorAll('.columns__content'),
    )
    columnContents.forEach((content, index) => {
        content.scrollTop = scrollState.contentScrollTops?.[index] || 0
    })
}

const columnInteractions = createColumnInteractions({
    columnsElement: elements.columns,
    markItemsVisited,
    registerFeedItemClick,
    registerFeedItemDismiss,
    shouldAutoMarkReadOnScroll,
    syncAppView,
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
    setLastUpdatedInProgress,
    shouldAutoMarkReadOnScroll,
    syncAppView,
    updateStatus,
})

init()

async function refreshAllFeeds(options = {}) {
    try {
        return await appActions.refreshAllFeeds(options)
    } finally {
        syncAutoRefreshSchedule()
    }
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

function handleColumnAuxClick(event) {
    return columnInteractions.handleColumnAuxClick(event)
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
        elements.columns.addEventListener('auxclick', handleColumnAuxClick)
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
    if (elements.autoRefreshFeeds) {
        elements.autoRefreshFeeds.addEventListener(
            'change',
            handleAutoRefreshFeedsChange,
        )
    }
    if (elements.statusClose) {
        elements.statusClose.addEventListener('click', handleDismissStatus)
    }
    window.addEventListener('focus', handleAutoRefreshWakeup)
    window.addEventListener('online', handleAutoRefreshWakeup)
    window.addEventListener('pageshow', handleAutoRefreshWakeup)
    document.addEventListener('visibilitychange', handleAutoRefreshWakeup)
    document.addEventListener('keydown', handleGlobalKeydown)
}

function handleGlobalKeydown(event) {
    if (event.defaultPrevented) {
        return
    }
    if (event.key === 'Escape') {
        closeSettings()
        return
    }
    if (isEditableTarget(event.target)) {
        return
    }
    if (!isRefreshHotkey(event)) {
        return
    }
    event.preventDefault()
    refreshAllFeeds()
}

function isRefreshHotkey(event) {
    if (event.repeat) {
        return false
    }
    if (
        event.key === 'F5' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
    ) {
        return true
    }
    return (
        event.code === 'KeyR' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey
    )
}

function isEditableTarget(target) {
    if (!(target instanceof Element)) {
        return false
    }
    if (target.closest('input, textarea, select')) {
        return true
    }
    return Boolean(
        target.closest('[contenteditable]:not([contenteditable="false"])'),
    )
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
    if (action === 'edit-folder') {
        handleEditFolderAction(button)
        return
    }
    if (action === 'cancel-edit-folder') {
        handleCancelEditFolderAction()
        return
    }
    if (action === 'save-folder') {
        handleSaveFolderAction(button)
        return
    }
    if (action === 'edit-feed') {
        handleEditFeedAction(button)
        return
    }
    if (action === 'cancel-edit-feed') {
        handleCancelEditFeedAction()
        return
    }
    if (action === 'save-feed') {
        handleSaveFeedAction(button)
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
    if (editingFolderId === folderId) {
        editingFolderId = null
    }
    if (editingFeed?.folderId === folderId) {
        editingFeed = null
    }
    removeFolder(folderId)
    syncAppAndRefreshFeeds()
}

function handleEditFolderAction(button) {
    const folderId = resolveFolderId(button)
    if (!folderId) {
        return
    }
    editingFeed = null
    editingFolderId = folderId
    syncAppView()
    focusEditingFolderNameInput(folderId)
}

function handleCancelEditFolderAction() {
    if (!editingFolderId) {
        return
    }
    editingFolderId = null
    syncAppView()
}

function handleSaveFolderAction(button) {
    const folderId = resolveFolderId(button)
    if (!folderId) {
        return
    }

    const wrapper = button.closest('[data-folder-id]')
    const nameInput = wrapper?.querySelector('[data-folder-field="name"]')
    const name = String(nameInput?.value || '').trim()
    if (!name) {
        nameInput?.focus()
        return
    }

    const result = updateFolder({folderId, name})
    if (!result.ok) {
        return
    }

    editingFolderId = null
    syncAppView()
}

function handleRemoveFeedAction(button) {
    const feedRow = button.closest('[data-feed-id]')
    const folderWrapper = button.closest('[data-folder-id]')
    if (!feedRow || !folderWrapper) {
        return
    }
    const feedId = feedRow.dataset.feedId
    const folderId = folderWrapper.dataset.folderId
    if (isEditingFeed(folderId, feedId)) {
        editingFeed = null
    }
    removeFeed(folderId, feedId)
    syncAppAndRefreshFeeds()
}

function handleEditFeedAction(button) {
    const context = resolveFeedContext(button)
    if (!context) {
        return
    }
    editingFolderId = null
    editingFeed = context
    syncAppView()
    focusEditingFeedNameInput(context.feedId)
}

function handleCancelEditFeedAction() {
    if (!editingFeed) {
        return
    }
    editingFeed = null
    syncAppView()
}

function handleSaveFeedAction(button) {
    const context = resolveFeedContext(button)
    if (!context) {
        return
    }
    const feedRow = button.closest('[data-feed-id]')
    const nameInput = feedRow?.querySelector('[data-feed-field="name"]')
    const urlInput = feedRow?.querySelector('[data-feed-field="url"]')
    const name = String(nameInput?.value || '').trim()
    const rawUrl = String(urlInput?.value || '').trim()

    if (!name) {
        nameInput?.focus()
        return
    }
    if (!rawUrl) {
        urlInput?.focus()
        return
    }

    const result = updateFeed({
        ...context,
        name,
        url: rawUrl,
    })
    if (!result.ok) {
        return
    }

    editingFeed = null
    appActions.handleFeedUpdated(result)
}

function handleReset() {
    const confirmReset = window.confirm(
        'Сбросить колонки и потоки к начальному состоянию?',
    )
    if (!confirmReset) {
        return
    }
    resetState()
    syncAppAndRefreshFeeds()
}

function handleToggleSettings() {
    const isOpen = elements.settings?.classList.contains('settings--open')
    if (isOpen) {
        closeSettings()
        return
    }
    applySettingsOpen(true)
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

function handleAutoRefreshFeedsChange(event) {
    const target = event.currentTarget
    if (!target) {
        return
    }
    setAutoRefreshFeeds(Boolean(target.checked))
    syncAutoRefreshSchedule()
    if (shouldAutoRefreshFeeds()) {
        void maybeRunAutoRefresh()
    }
}

function handleDismissStatus() {
    dismissStatus()
}

function closeSettings() {
    const hadEditingState = Boolean(editingFeed || editingFolderId)
    editingFeed = null
    editingFolderId = null
    if (hadEditingState) {
        syncAppView()
    }
    applySettingsOpen(false)
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

function resolveFeedContext(element) {
    const feedRow = element.closest('[data-feed-id]')
    const folderWrapper = element.closest('[data-folder-id]')
    if (!feedRow || !folderWrapper) {
        return null
    }
    return {
        folderId: folderWrapper.dataset.folderId,
        feedId: feedRow.dataset.feedId,
    }
}

function resolveFolderId(element) {
    const wrapper = element.closest('[data-folder-id]')
    return wrapper?.dataset.folderId || null
}

function isEditingFeed(folderId, feedId) {
    return (
        editingFeed?.folderId === folderId && editingFeed?.feedId === feedId
    )
}

function handleAutoRefreshWakeup() {
    if (!shouldAutoRefreshFeeds()) {
        clearScheduledAutoRefresh()
        return
    }
    if (getTimeUntilNextAutoRefresh() > 0) {
        syncAutoRefreshSchedule()
        return
    }
    void maybeRunAutoRefresh()
}

async function maybeRunAutoRefresh() {
    if (
        !shouldAutoRefreshFeeds() ||
        !hasConfiguredFeeds() ||
        getTimeUntilNextAutoRefresh() > 0 ||
        !canRunAutoRefreshNow()
    ) {
        syncAutoRefreshSchedule()
        return false
    }
    await refreshAllFeeds({source: 'auto'})
    return true
}

function syncAutoRefreshSchedule() {
    clearScheduledAutoRefresh()
    if (!shouldAutoRefreshFeeds() || !hasConfiguredFeeds()) {
        return
    }
    const delay = Math.max(0, getTimeUntilNextAutoRefresh())
    if (delay === 0 && !canRunAutoRefreshNow()) {
        return
    }
    autoRefreshTimerId = window.setTimeout(() => {
        autoRefreshTimerId = null
        void maybeRunAutoRefresh()
    }, delay)
}

function clearScheduledAutoRefresh() {
    if (autoRefreshTimerId === null) {
        return
    }
    window.clearTimeout(autoRefreshTimerId)
    autoRefreshTimerId = null
}

function getTimeUntilNextAutoRefresh(now = Date.now()) {
    const lastUpdatedAt = Date.parse(getState().lastUpdated || '')
    if (!Number.isFinite(lastUpdatedAt) || lastUpdatedAt <= 0) {
        return AUTO_REFRESH_INTERVAL_MS
    }
    return Math.max(0, lastUpdatedAt + AUTO_REFRESH_INTERVAL_MS - now)
}

function hasConfiguredFeeds() {
    const folders = getState().folders || []
    return folders.some(
        (folder) => Array.isArray(folder.feeds) && folder.feeds.length,
    )
}

function canRunAutoRefreshNow() {
    if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
    ) {
        return false
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false
    }
    return true
}

function focusEditingFolderNameInput(folderId) {
    const nameInput = elements.foldersList?.querySelector(
        `[data-folder-id="${folderId}"] [data-folder-field="name"]`,
    )
    if (!nameInput || typeof nameInput.focus !== 'function') {
        return
    }
    nameInput.focus()
    if (typeof nameInput.select === 'function') {
        nameInput.select()
    }
}

function focusEditingFeedNameInput(feedId) {
    const nameInput = elements.foldersList?.querySelector(
        `[data-feed-id="${feedId}"] [data-feed-field="name"]`,
    )
    if (!nameInput || typeof nameInput.focus !== 'function') {
        return
    }
    nameInput.focus()
    if (typeof nameInput.select === 'function') {
        nameInput.select()
    }
}
