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
        hadNewItemsNotice: Boolean(
            newItemsNotice && !newItemsNotice.hidden,
        ),
    }
}

function restoreColumnState(column, columnState) {
    const content = column.querySelector('.columns__content')
    column.scrollTop = columnState.columnScrollTop || 0
    if (!content) {
        return
    }
    content.scrollTop = columnState.contentScrollTop || 0
    const wasScrolled =
        (columnState.columnScrollTop || 0) > 0 ||
        (columnState.contentScrollTop || 0) > 0
    if (!wasScrolled) {
        updateNewItemsNotice(column, false)
        return
    }

    const feedItems = Array.from(content.querySelectorAll('.feed__item'))
    const anchorItemKey = String(columnState.anchorItemKey || '').trim()
    if (!anchorItemKey) {
        updateNewItemsNotice(
            column,
            isColumnScrolled(column, content) &&
                columnState.hadNewItemsNotice,
        )
        return
    }
    const anchor = feedItems.find(
        (feedItem) =>
            String(feedItem.dataset?.itemKey || '').trim() === anchorItemKey,
    )
    if (!anchor) {
        updateNewItemsNotice(
            column,
            isColumnScrolled(column, content) &&
                columnState.hadNewItemsNotice,
        )
        return
    }

    const newItemsAboveCount = countNewItemsAbove(
        feedItems,
        anchor,
        columnState.itemKeys,
    )
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
    updateNewItemsNotice(
        column,
        isColumnScrolled(column, content) &&
            (columnState.hadNewItemsNotice || newItemsAboveCount > 0),
    )
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

function countNewItemsAbove(feedItems, anchor, previousItemKeys) {
    const anchorIndex = feedItems.indexOf(anchor)
    if (anchorIndex <= 0) {
        return 0
    }
    const previousKeys = new Set(previousItemKeys || [])
    return feedItems.slice(0, anchorIndex).filter((feedItem) => {
        const itemKey = String(feedItem.dataset?.itemKey || '').trim()
        return itemKey && !previousKeys.has(itemKey)
    }).length
}

function isColumnScrolled(column, content) {
    return (column.scrollTop || 0) > 0 || (content.scrollTop || 0) > 0
}

function updateNewItemsNotice(column, isVisible) {
    const notice = column.querySelector('.columns__new-items-notice')
    if (!notice) {
        return
    }
    notice.hidden = !isVisible
}
