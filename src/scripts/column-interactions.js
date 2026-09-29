import {refreshNewItemsNotice} from './column-scroll-state.js'

export function createColumnInteractions({
    columnsElement,
    markItemsVisited,
    registerFeedItemClick,
    registerFeedItemDismiss,
    shouldAutoMarkReadOnScroll,
    syncAppView,
    unmarkItemsVisited,
}) {
    const suppressedAutoMarkContents = new WeakSet()
    const autoMarkSuppressionTimers = new WeakMap()
    const scrollSnapshots = new WeakMap()
    const autoMarkSuppressionTimeoutMs = 1500

    return {
        handleColumnAuxClick,
        handleColumnHeaderClick,
        handleColumnScroll,
        captureScrollState,
    }

    function handleColumnHeaderClick(event) {
        const newItemsButton = event.target.closest(
            '[data-action="scroll-new-items-to-top"]',
        )
        if (newItemsButton && columnsElement?.contains(newItemsButton)) {
            event.preventDefault()
            const column = newItemsButton.closest('.columns__item')
            if (!column) {
                return
            }
            newItemsButton.hidden = true
            scrollColumnToTop(column)
            return
        }

        const dismissButton = event.target.closest(
            '[data-action="dismiss-feed-item"]',
        )
        if (dismissButton && columnsElement?.contains(dismissButton)) {
            event.preventDefault()
            event.stopPropagation?.()
            event.stopImmediatePropagation?.()
            const feedItem = dismissButton.closest('.feed__item')
            if (!feedItem) {
                return
            }
            dismissFeedItem(feedItem)
            return
        }

        const feedItemLink = event.target.closest('[data-feed-link="true"]')
        const feedItem = feedItemLink?.closest('.feed__item')
        if (feedItem && columnsElement?.contains(feedItem)) {
            if (feedItemLink.dataset.noLink === 'true') {
                event.preventDefault()
                return
            }
            markFeedItemsVisited([feedItem])
            registerClickedFeedItem(feedItem)
            return
        }

        const actionButton = event.target.closest(
            '[data-action="mark-column-read"]',
        )
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
            syncAppView({preserveColumnScroll: true})
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
        scrollColumnToTop(column)
    }

    function scrollColumnToTop(column) {
        const reduceMotion = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
        ).matches
        const content = column.querySelector('.columns__content')
        suppressAutoMarkDuringProgrammaticScroll(column, content)
        scrollElementToTop(content, reduceMotion)
        scrollElementToTop(column, reduceMotion)
    }

    function suppressAutoMarkDuringProgrammaticScroll(column, content) {
        if (
            !content ||
            ((column.scrollTop || 0) <= 0 &&
                (content.scrollTop || 0) <= 0)
        ) {
            return
        }
        scrollSnapshots.set(content, captureScrollSnapshot(column, content))
        clearAutoMarkSuppression(content)
        suppressedAutoMarkContents.add(content)
        const timerId = setTimeout(() => {
            clearAutoMarkSuppression(content)
        }, autoMarkSuppressionTimeoutMs)
        autoMarkSuppressionTimers.set(content, timerId)
    }

    function clearAutoMarkSuppression(content) {
        suppressedAutoMarkContents.delete(content)
        const timerId = autoMarkSuppressionTimers.get(content)
        if (timerId !== undefined) {
            clearTimeout(timerId)
            autoMarkSuppressionTimers.delete(content)
        }
    }

    function registerClickedFeedItem(feedItem) {
        const feedItemLink = feedItem?.querySelector('[data-feed-link="true"]')
        if (!feedItem || feedItemLink?.dataset.noLink === 'true') {
            return
        }
        const clickPayload = resolveFeedItemPayload(feedItem)
        if (!clickPayload?.itemKey) {
            return
        }
        if (registerFeedItemClick(clickPayload)) {
            syncAppView({preserveColumnScroll: true})
        }
    }

    function dismissFeedItem(feedItem) {
        const dismissPayload = resolveFeedItemPayload(feedItem)
        if (!dismissPayload?.itemKey) {
            return
        }
        if (registerFeedItemDismiss(dismissPayload)) {
            applyDismissedFeedItemState(feedItem)
        }
    }

    function applyDismissedFeedItemState(feedItem) {
        if (!feedItem) {
            return
        }
        feedItem.classList.add('feed__item--dismissed')
        const dismissButton = feedItem.querySelector(
            '[data-action="dismiss-feed-item"]',
        )
        if (!dismissButton) {
            return
        }
        dismissButton.classList.add('feed__item-dismiss--active')
        dismissButton.setAttribute('aria-pressed', 'true')
    }

    function handleColumnAuxClick(event) {
        if (event.button !== 1) {
            return
        }
        const feedItemLink = event.target.closest('[data-feed-link="true"]')
        const feedItem = feedItemLink?.closest('.feed__item')
        if (!feedItem || !columnsElement?.contains(feedItem)) {
            return
        }
        if (feedItemLink.dataset.noLink === 'true') {
            return
        }
        markFeedItemsVisited([feedItem])
        registerClickedFeedItem(feedItem)
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
        const unvisitedItemKeys = getItemKeys(feedItems)
        if (unvisitedItemKeys.length) {
            unmarkItemsVisited(unvisitedItemKeys)
            updateVisibleItemCopies(unvisitedItemKeys, false)
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
        const column = content.closest('.columns__item')
        const previousSnapshot = scrollSnapshots.get(content)
        const currentSnapshot = captureScrollSnapshot(column, content)
        scrollSnapshots.set(content, currentSnapshot)
        if (!suppressedAutoMarkContents.has(content)) {
            refreshNewItemsNotice(column)
        } else if (
            (column.scrollTop || 0) <= 0 &&
            (content.scrollTop || 0) <= 0
        ) {
            refreshNewItemsNotice(column)
        }
        if (content.dataset?.suppressAutoMarkOnScroll === 'true') {
            return
        }
        if (suppressedAutoMarkContents.has(content)) {
            if (
                column &&
                (column.scrollTop || 0) <= 0 &&
                (content.scrollTop || 0) <= 0
            ) {
                clearAutoMarkSuppression(content)
            }
            return
        }
        if (!previousSnapshot || !shouldAutoMarkReadOnScroll()) {
            return
        }
        const movedDown = isColumnContent
            ? currentSnapshot.contentScrollTop >
              previousSnapshot.contentScrollTop
            : currentSnapshot.columnScrollTop > previousSnapshot.columnScrollTop
        if (!movedDown) {
            return
        }
        // A refresh can insert unread cards above the viewport. Only cards
        // that cross the top edge during this scroll count as read.
        const newlyHiddenItems = Array.from(currentSnapshot.hiddenItems).filter(
            (item) => !previousSnapshot.hiddenItems.has(item),
        )
        markFeedItemsVisited(newlyHiddenItems)
    }

    function captureScrollState() {
        columnsElement
            ?.querySelectorAll('.columns__content')
            ?.forEach((content) => {
                const column = content.closest('.columns__item')
                scrollSnapshots.set(
                    content,
                    captureScrollSnapshot(column, content),
                )
            })
    }

    function markFeedItemsVisited(feedItems) {
        if (!feedItems?.length) {
            return
        }
        const visitedItemKeys = getItemKeys(feedItems)
        if (visitedItemKeys.length) {
            markItemsVisited(visitedItemKeys)
            updateVisibleItemCopies(visitedItemKeys, true)
        }
    }

    function updateVisibleItemCopies(itemKeys, isVisited) {
        const keys = new Set(itemKeys)
        columnsElement?.querySelectorAll('.feed__item')?.forEach((item) => {
            if (!keys.has(String(item.dataset.itemKey || '').trim())) {
                return
            }
            item.classList[isVisited ? 'add' : 'remove']('feed__item--visited')
        })
        columnsElement
            ?.querySelectorAll('.columns__item')
            ?.forEach(refreshNewItemsNotice)
    }

    function getItemKeys(feedItems) {
        return Array.from(
            new Set(
                feedItems
                    .map((item) => String(item?.dataset?.itemKey || '').trim())
                    .filter(Boolean),
            ),
        )
    }
}

function captureScrollSnapshot(column, content) {
    const visibleTop = Math.max(
        column?.getBoundingClientRect?.().top || 0,
        content?.getBoundingClientRect?.().top || 0,
    )
    const hiddenItems = new Set(
        Array.from(content.querySelectorAll?.('.feed__item') || []).filter(
            (item) => item.getBoundingClientRect().bottom <= visibleTop,
        ),
    )
    return {
        columnScrollTop: column?.scrollTop || 0,
        contentScrollTop: content?.scrollTop || 0,
        hiddenItems,
    }
}

function resolveFeedItemPayload(feedItem) {
    if (!feedItem) {
        return null
    }
    return {
        itemKey: String(feedItem.dataset.itemKey || '').trim(),
        feedId: String(feedItem.dataset.feedId || '').trim(),
        source: String(feedItem.dataset.itemSource || '').trim(),
        title: String(feedItem.dataset.itemTitle || '').trim(),
        link: String(feedItem.dataset.itemLink || '').trim(),
        publishedAt: String(feedItem.dataset.itemPublishedAt || '').trim(),
    }
}
