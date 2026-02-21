import {
    addFeed,
    createFolder,
    exportState,
    getState,
    importState,
    markItemsVisited,
    refreshAll,
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

const pendingScrollMarkFrames = new WeakMap()
let refreshAllFeedsPromise = null

init()

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
        return
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

function handleColumnHeaderClick(event) {
    const feedItem = event.target.closest('.feed__item')
    if (feedItem && elements.columns?.contains(feedItem)) {
        if (feedItem.dataset.noLink === 'true') {
            event.preventDefault()
        }
        markFeedItemsVisited([feedItem])
        return
    }
    const actionButton = event.target.closest('[data-action="mark-column-read"]')
    if (actionButton && elements.columns?.contains(actionButton)) {
        event.preventDefault()
        if (actionButton.disabled) {
            return
        }
        const column = actionButton.closest('.columns__item')
        if (!column) {
            return
        }
        markColumnFeedItemsVisited(column)
        return
    }
    const header = event.target.closest('.columns__header')
    if (!header || !elements.columns?.contains(header)) {
        return
    }
    const column = header.closest('.columns__item')
    if (!column) {
        return
    }
    const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
    ).matches
    const content = column.querySelector('.columns__content')
    scrollElementToTop(content, reduceMotion)
    scrollElementToTop(column, reduceMotion)
}

function markColumnFeedItemsVisited(column) {
    if (!column) {
        return
    }
    const feedItems = Array.from(column.querySelectorAll('.feed__item'))
    if (!feedItems.length) {
        return
    }
    const isEveryItemVisited = feedItems.every((feedItem) =>
        feedItem.classList.contains('feed__item--visited'),
    )
    if (isEveryItemVisited) {
        unmarkFeedItemsVisited(feedItems)
        return
    }
    markFeedItemsVisited(feedItems)
}

function unmarkFeedItemsVisited(feedItems) {
    if (!feedItems?.length) {
        return
    }
    const unvisitedItemKeys = []
    feedItems.forEach((feedItem) => {
        if (!feedItem || !feedItem.classList.contains('feed__item--visited')) {
            return
        }
        feedItem.classList.remove('feed__item--visited')
        const itemKey = String(feedItem.dataset.itemKey || '').trim()
        if (itemKey) {
            unvisitedItemKeys.push(itemKey)
        }
    })
    if (unvisitedItemKeys.length) {
        unmarkItemsVisited(unvisitedItemKeys)
    }
}

function scrollElementToTop(element, reduceMotion) {
    if (!element) {
        return
    }
    if (typeof element.scrollTo === 'function') {
        element.scrollTo({
            top: 0,
            behavior: reduceMotion ? 'auto' : 'smooth',
        })
        return
    }
    element.scrollTop = 0
}

function handleAutoMarkReadOnScrollChange(event) {
    const target = event.currentTarget
    if (!target) {
        return
    }
    setAutoMarkReadOnScroll(Boolean(target.checked))
    if (shouldAutoMarkReadOnScroll()) {
        markHiddenFeedItemsInAllColumns()
    }
}

function handleDismissStatus() {
    dismissStatus()
}

function handleColumnScroll(event) {
    if (!shouldAutoMarkReadOnScroll()) {
        return
    }
    const scroller = event.target
    if (
        !scroller ||
        typeof scroller.closest !== 'function' ||
        !scroller.classList
    ) {
        return
    }
    const isColumnContent = scroller.classList.contains('columns__content')
    const isColumnItem = scroller.classList.contains('columns__item')
    if (!isColumnContent && !isColumnItem) {
        return
    }
    const content = isColumnContent
        ? scroller
        : scroller.querySelector('.columns__content')
    if (!content) {
        return
    }
    if (pendingScrollMarkFrames.has(scroller)) {
        return
    }
    const frameId = requestAnimationFrame(() => {
        pendingScrollMarkFrames.delete(scroller)
        markHiddenFeedItemsInColumn(
            content,
            scroller.getBoundingClientRect().top,
        )
    })
    pendingScrollMarkFrames.set(scroller, frameId)
}

function markHiddenFeedItemsInAllColumns() {
    const columnContents = elements.columns?.querySelectorAll('.columns__content')
    if (!columnContents?.length) {
        return
    }
    columnContents.forEach((content) => {
        markHiddenFeedItemsInColumn(content)
    })
}

function markHiddenFeedItemsInColumn(content, visibleTop) {
    if (!content) {
        return
    }
    const columnTop =
        typeof visibleTop === 'number'
            ? visibleTop
            : content.getBoundingClientRect().top
    const feedItems = Array.from(content.querySelectorAll('.feed__item'))
    const hiddenItems = feedItems.filter((item) => {
        if (item.classList.contains('feed__item--visited')) {
            return false
        }
        const itemBottom = item.getBoundingClientRect().bottom
        return itemBottom <= columnTop
    })
    markFeedItemsVisited(hiddenItems)
}

function markFeedItemsVisited(feedItems) {
    if (!feedItems?.length) {
        return
    }
    const visitedItemKeys = []
    feedItems.forEach((feedItem) => {
        if (!feedItem || feedItem.classList.contains('feed__item--visited')) {
            return
        }
        feedItem.classList.add('feed__item--visited')
        const itemKey = String(feedItem.dataset.itemKey || '').trim()
        if (itemKey) {
            visitedItemKeys.push(itemKey)
        }
    })
    if (visitedItemKeys.length) {
        markItemsVisited(visitedItemKeys)
    }
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

    let parsed = null
    try {
        parsed = JSON.parse(await file.text())
    } catch (error) {
        updateStatus('Файл импорта содержит неверный JSON', 'error')
        return
    }

    const result = importState(parsed)
    if (!result.ok) {
        updateStatus('Не удалось импортировать данные', 'error')
        return
    }

    const form = event.currentTarget
    if (form && typeof form.reset === 'function') {
        form.reset()
    }
    handleImportFileChange()
    render(getState())
    updateLastUpdated(getState().lastUpdated)
    await refreshAllFeeds()
}

async function refreshAllFeeds() {
    if (refreshAllFeedsPromise) {
        return refreshAllFeedsPromise
    }
    refreshAllFeedsPromise = refreshAllFeedsInternal()
    try {
        return await refreshAllFeedsPromise
    } finally {
        refreshAllFeedsPromise = null
    }
}

async function refreshAllFeedsInternal() {
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
    render(currentState)

    try {
        const result = await refreshAll()
        if (result.errorsCount) {
            const firstError = result.errors?.[0]
            const firstErrorText = firstError
                ? `. ${firstError.feedName || 'Фид'}: ${firstError.message}`
                : ''
            updateStatus(
                `Обновлено с ошибками: ${result.errorsCount}${firstErrorText}`,
                'error',
            )
        } else {
            updateStatus('Ленты обновлены')
        }
    } catch (error) {
        updateStatus('Не удалось обновить ленты', 'error')
    } finally {
        const nextState = getState()
        updateLastUpdated(nextState.lastUpdated)
        render(nextState)
        if (shouldAutoMarkReadOnScroll()) {
            markHiddenFeedItemsInAllColumns()
        }
        if (elements.refresh) {
            elements.refresh.disabled = false
        }
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
