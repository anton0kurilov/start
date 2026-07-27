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

    return {
        columnKey: getColumnKey(column),
        columnIndex,
        columnScrollTop: column.scrollTop || 0,
        contentScrollTop: content?.scrollTop || 0,
        anchorItemKey: String(anchor?.dataset?.itemKey || '').trim(),
        anchorOffset: anchor
            ? anchor.getBoundingClientRect().top -
              getColumnVisibleTop(column, content)
            : 0,
    }
}

function restoreColumnState(column, columnState) {
    const content = column.querySelector('.columns__content')
    column.scrollTop = columnState.columnScrollTop || 0
    if (!content) {
        return
    }
    content.scrollTop = columnState.contentScrollTop || 0

    const anchorItemKey = String(columnState.anchorItemKey || '').trim()
    if (!anchorItemKey) {
        return
    }
    const anchor = Array.from(content.querySelectorAll('.feed__item')).find(
        (feedItem) =>
            String(feedItem.dataset?.itemKey || '').trim() === anchorItemKey,
    )
    if (!anchor) {
        return
    }

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
