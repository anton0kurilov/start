export function createAppActions({
    elements,
    exportState,
    getState,
    importState,
    markHiddenFeedItemsInAllColumns,
    onImportFileReset,
    refreshAll,
    shouldAutoMarkReadOnScroll,
    syncAppView,
    setLastUpdatedInProgress,
    updateStatus,
}) {
    let refreshAllFeedsPromise = null

    return {
        refreshAllFeeds,
        handleExportJson,
        handleImportJson,
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
            syncAppView({state: currentState, withLastUpdated: true})
            return
        }

        updateStatus('Обновляю ленты...', 'loading')
        if (typeof setLastUpdatedInProgress === 'function') {
            setLastUpdatedInProgress()
        }
        if (elements.refresh) {
            elements.refresh.disabled = true
        }
        syncAppView({state: currentState})

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
            syncAppView({withLastUpdated: true})
            if (shouldAutoMarkReadOnScroll()) {
                markHiddenFeedItemsInAllColumns()
            }
            if (elements.refresh) {
                elements.refresh.disabled = false
            }
        }
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
        if (typeof onImportFileReset === 'function') {
            onImportFileReset()
        }
        syncAppView({withLastUpdated: true})
        await refreshAllFeeds()
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
