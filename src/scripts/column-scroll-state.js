const autoMarkRestoreSuppressionTimers = new WeakMap()
const autoMarkRestoreSuppressionMs = 250
const pendingNewItemKeysByNotice = new WeakMap()

export function captureColumnScrollState(columnsElement) {
    if (!columnsElement) {
        return null
    }

    const columns = Array.from(
        columnsElement.querySelectorAll('.columns__item'),
    ).map((column, index) => captureColumnState(column, index))

    return {
        columnsScrollLeft: columnsElement.scrollLeft || 0,
        columns,
    }
}

export function restoreColumnScrollState(columnsElement, scrollState) {
    if (!columnsElement || !scrollState) {
        return
    }

    columnsElement.scrollLeft = scrollState.columnsScrollLeft || 0
    const columns = Array.from(
        columnsElement.querySelectorAll('.columns__item'),
    )
    const columnsByKey = new Map(
        columns
            .map((column) => [getColumnKey(column), column])
            .filter(([columnKey]) => columnKey),
    )

    scrollState.columns?.forEach((columnState) => {
        const column = columnState.columnKey
            ? columnsByKey.get(columnState.columnKey)
            : columns[columnState.columnIndex]
        if (!column) {
            return
        }
        restoreColumnState(column, columnState)
    })
}

function captureColumnState(column, columnIndex) {
    const content = column.querySelector('.columns__content')
    const anchor = content ? findFirstVisibleFeedItem(column, content) : null
    const newItemsNotice = column.querySelector(
        '.columns__new-items-notice',
    )
    refreshNewItemsNotice(column)

    return {
        columnKey: getColumnKey(column),
        columnIndex,
        columnScrollTop: column.scrollTop || 0,
        contentScrollTop: content?.scrollTop || 0,
        itemKeys: content
            ? Array.from(content.querySelectorAll('.feed__item'))
                  .map((feedItem) =>
                      String(feedItem.dataset?.itemKey || '').trim(),
                  )
                  .filter(Boolean)
            : [],
        anchorItemKey: String(anchor?.dataset?.itemKey || '').trim(),
        anchorOffset: anchor
            ? anchor.getBoundingClientRect().top -
              getColumnVisibleTop(column, content)
            : 0,
        pendingNewItemKeys: Array.from(
            pendingNewItemKeysByNotice.get(newItemsNotice) || [],
        ),
    }
}

function restoreColumnState(column, columnState) {
    const content = column.querySelector('.columns__content')
    column.scrollTop = columnState.columnScrollTop || 0
    if (!content) {
        return
    }
    suppressAutoMarkDuringScrollRestore(content)
    content.scrollTop = columnState.contentScrollTop || 0
    const wasScrolled =
        (columnState.columnScrollTop || 0) > 0 ||
        (columnState.contentScrollTop || 0) > 0
    if (!wasScrolled) {
        updateNewItemsNotice(column, [])
        return
    }

    const feedItems = Array.from(content.querySelectorAll('.feed__item'))
    const anchorItemKey = String(columnState.anchorItemKey || '').trim()
    const anchor = feedItems.find(
        (feedItem) =>
            String(feedItem.dataset?.itemKey || '').trim() === anchorItemKey,
    )
    if (anchor) {
        const scrollers =
            columnState.columnScrollTop > columnState.contentScrollTop
                ? [column, content]
                : [content, column]
        scrollers.forEach((scroller) => {
            const offset =
                anchor.getBoundingClientRect().top -
                getColumnVisibleTop(column, content)
            const delta = offset - (columnState.anchorOffset || 0)
            if (Math.abs(delta) < 0.5) {
                return
            }
            scroller.scrollTop += delta
        })
    }

    const previousKeys = new Set(columnState.itemKeys || [])
    const previousPendingKeys = new Set(columnState.pendingNewItemKeys || [])
    // Keep only arrivals that have not been brought into view or marked read.
    const pendingKeys = feedItems
        .map((feedItem) => String(feedItem.dataset?.itemKey || '').trim())
        .filter(
            (itemKey) =>
                itemKey &&
                (previousPendingKeys.has(itemKey) ||
                    !previousKeys.has(itemKey)),
        )
    updateNewItemsNotice(column, pendingKeys)
}

function findFirstVisibleFeedItem(column, content) {
    const visibleTop = getColumnVisibleTop(column, content)
    return Array.from(content.querySelectorAll('.feed__item')).find(
        (feedItem) => feedItem.getBoundingClientRect().bottom > visibleTop,
    )
}

function getColumnVisibleTop(column, content) {
    return Math.max(
        column.getBoundingClientRect().top,
        content.getBoundingClientRect().top,
    )
}

function getColumnKey(column) {
    return String(column?.dataset?.columnKey || '').trim()
}

function updateNewItemsNotice(column, itemKeys) {
    const notice = column.querySelector('.columns__new-items-notice')
    if (!notice) {
        return
    }
    pendingNewItemKeysByNotice.set(notice, new Set(itemKeys))
    refreshNewItemsNotice(column)
}

export function refreshNewItemsNotice(column) {
    const notice = column?.querySelector('.columns__new-items-notice')
    const content = column?.querySelector('.columns__content')
    if (!notice || !content) {
        return
    }
    const pendingKeys = pendingNewItemKeysByNotice.get(notice) || new Set()
    if (!pendingKeys.size) {
        notice.hidden = true
        return
    }
    if ((column.scrollTop || 0) <= 0 && (content.scrollTop || 0) <= 0) {
        pendingKeys.clear()
    } else {
        const visibleTop = getColumnVisibleTop(column, content)
        const pendingItems = new Map()
        content.querySelectorAll('.feed__item').forEach((item) => {
            const itemKey = String(item.dataset?.itemKey || '').trim()
            if (pendingKeys.has(itemKey)) {
                const copies = pendingItems.get(itemKey) || []
                copies.push(item)
                pendingItems.set(itemKey, copies)
            }
        })
        pendingKeys.forEach((itemKey) => {
            const copies = pendingItems.get(itemKey) || []
            if (
                !copies.length ||
                copies.some(
                    (item) =>
                        item.classList?.contains('feed__item--visited') ||
                        item.getBoundingClientRect().bottom > visibleTop,
                )
            ) {
                pendingKeys.delete(itemKey)
            }
        })
    }
    pendingNewItemKeysByNotice.set(notice, pendingKeys)
    notice.hidden = pendingKeys.size === 0
}

function suppressAutoMarkDuringScrollRestore(content) {
    if (!content.dataset) {
        return
    }
    content.dataset.suppressAutoMarkOnScroll = 'true'
    if (
        typeof window === 'undefined' ||
        typeof window.setTimeout !== 'function'
    ) {
        delete content.dataset.suppressAutoMarkOnScroll
        return
    }
    const currentTimer = autoMarkRestoreSuppressionTimers.get(content)
    if (currentTimer !== undefined) {
        window.clearTimeout(currentTimer)
    }
    const timerId = window.setTimeout(() => {
        delete content.dataset.suppressAutoMarkOnScroll
        autoMarkRestoreSuppressionTimers.delete(content)
    }, autoMarkRestoreSuppressionMs)
    autoMarkRestoreSuppressionTimers.set(content, timerId)
}
