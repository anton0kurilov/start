export function createAppActions({
    elements,
    exportState,
    getState,
    importState,
    markHiddenFeedItemsInAllColumns,
    refreshAll,
    shouldAutoMarkReadOnScroll,
    syncAppView,
    setLastUpdatedInProgress,
    updateStatus,
}) {
    let refreshAllFeedsPromise = null

    return {
        refreshAllFeeds,
        handleFeedUpdated,
        handleExportJson,
        handleImportJson,
        handleImportFileSelected,
    }

    async function refreshAllFeeds(options = {}) {
        if (refreshAllFeedsPromise) {
            return refreshAllFeedsPromise
        }
        refreshAllFeedsPromise = refreshAllFeedsInternal(options)
        try {
            return await refreshAllFeedsPromise
        } finally {
            refreshAllFeedsPromise = null
        }
    }

    async function refreshAllFeedsInternal(options = {}) {
        const source = options?.source === 'auto' ? 'auto' : 'manual'
        const isAutoRefresh = source === 'auto'
        const currentState = getState()
        const feeds = currentState.folders.flatMap((folder) => folder.feeds)
        if (!feeds.length) {
            if (!isAutoRefresh) {
                updateStatus('Добавьте потоки для обновления')
                syncAppView({state: currentState, withLastUpdated: true})
            }
            return
        }

        if (!isAutoRefresh) {
            updateStatus('Обновляю ленты...', 'loading')
        }
        if (!isAutoRefresh && typeof setLastUpdatedInProgress === 'function') {
            setLastUpdatedInProgress()
        }
        if (elements.refresh) {
            elements.refresh.disabled = true
        }
        if (!isAutoRefresh) {
            syncAppView({state: currentState})
        }

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
            } else if (!isAutoRefresh) {
                updateStatus('Ленты обновлены')
            }
        } catch (error) {
            if (!isAutoRefresh) {
                updateStatus('Не удалось обновить ленты', 'error')
            } else if (
                typeof document === 'undefined' ||
                !document.hidden
            ) {
                updateStatus('Не удалось обновить ленты', 'error')
            }
        } finally {
            syncAppView({withLastUpdated: true})
            if (shouldAutoMarkReadOnScroll()) {
                markHiddenFeedItemsInAllColumns()
            }
            if (elements.refresh) {
                elements.refresh.disabled = false
            }
        }
    }

    async function handleFeedUpdated(updateResult) {
        if (!updateResult?.ok) {
            return
        }
        if (updateResult.urlChanged) {
            await refreshAllFeeds()
            return
        }
        syncAppView()
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
        if (elements.importFile) {
            elements.importFile.click()
            return
        }
        updateStatus('Выберите JSON-файл для импорта', 'error')
    }

    async function handleImportFileSelected() {
        const file = elements.importFile?.files?.[0]
        if (!file) {
            return
        }
        const confirmed = window.confirm(
            'Импорт заменит текущие колонки и потоки. Продолжить?',
        )
        if (!confirmed) {
            clearImportFileSelection()
            return
        }

        let parsed = null
        try {
            parsed = JSON.parse(await file.text())
        } catch (error) {
            updateStatus('Файл импорта содержит неверный JSON', 'error')
            clearImportFileSelection()
            return
        }

        const result = importState(parsed)
        if (!result.ok) {
            updateStatus('Не удалось импортировать данные', 'error')
            clearImportFileSelection()
            return
        }

        clearImportFileSelection()
        syncAppView({withLastUpdated: true})
        await refreshAllFeeds()
    }
}

function clearImportFileSelection() {
    const importFile = document.querySelector('[data-import-file]')
    if (importFile) {
        importFile.value = ''
    }
}

function buildExportFilename(prefix = 'start-feeds') {
    const now = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate(),
    )}`
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`
    return `${prefix}-${date}-${time}.json`
}
