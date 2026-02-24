export function createColumnInteractions({
    columnsElement,
    markItemsVisited,
    registerFeedItemClick,
    shouldAutoMarkReadOnScroll,
    unmarkItemsVisited,
}) {
    const pendingScrollMarkFrames = new WeakMap()

    return {
        handleColumnHeaderClick,
        handleColumnScroll,
        markHiddenFeedItemsInAllColumns,
    }

    function handleColumnHeaderClick(event) {
        const feedItem = event.target.closest('.feed__item')
        if (feedItem && columnsElement?.contains(feedItem)) {
            if (feedItem.dataset.noLink === 'true') {
                event.preventDefault()
            }
            markFeedItemsVisited([feedItem])
            registerClickedFeedItem(feedItem)
            return
        }
        const actionButton = event.target.closest('[data-action="mark-column-read"]')
        if (actionButton && columnsElement?.contains(actionButton)) {
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
        if (!header || !columnsElement?.contains(header)) {
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

    function registerClickedFeedItem(feedItem) {
        if (!feedItem || feedItem.dataset.noLink === 'true') {
            return
        }
        const clickPayload = {
            itemKey: String(feedItem.dataset.itemKey || '').trim(),
            source: String(feedItem.dataset.itemSource || '').trim(),
            title: String(feedItem.dataset.itemTitle || '').trim(),
            link: String(feedItem.dataset.itemLink || '').trim(),
        }
        if (!clickPayload.itemKey) {
            return
        }
        registerFeedItemClick(clickPayload)
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
        const columnContents = columnsElement?.querySelectorAll('.columns__content')
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
}
