import test from 'node:test'
import assert from 'node:assert/strict'

import {createColumnInteractions} from '../../src/scripts/column-interactions.js'

function createMockElement({
    classes = [],
    dataset = {},
    parent = null,
} = {}) {
    const classNames = new Set(classes)
    const attributes = new Map()
    const element = {
        dataset: {...dataset},
        parentElement: parent,
        children: [],
        classList: {
            contains(className) {
                return classNames.has(className)
            },
            add(className) {
                classNames.add(className)
            },
            remove(className) {
                classNames.delete(className)
            },
        },
        closest(selector) {
            let current = this
            while (current) {
                if (matchesSelector(current, selector)) {
                    return current
                }
                current = current.parentElement
            }
            return null
        },
        contains(target) {
            let current = target
            while (current) {
                if (current === this) {
                    return true
                }
                current = current.parentElement
            }
            return false
        },
        querySelector(selector) {
            for (const child of this.children) {
                if (matchesSelector(child, selector)) {
                    return child
                }
                const nestedMatch = child.querySelector(selector)
                if (nestedMatch) {
                    return nestedMatch
                }
            }
            return null
        },
        setAttribute(name, value) {
            attributes.set(String(name), String(value))
        },
        getAttribute(name) {
            return attributes.get(String(name)) || null
        },
    }

    if (parent) {
        parent.children.push(element)
    }

    return element
}

function matchesSelector(element, selector) {
    if (!element || !selector) {
        return false
    }
    if (selector.startsWith('.')) {
        return element.classList.contains(selector.slice(1))
    }
    if (selector === '[data-action="dismiss-feed-item"]') {
        return element.dataset.action === 'dismiss-feed-item'
    }
    if (selector === '[data-action="mark-column-read"]') {
        return element.dataset.action === 'mark-column-read'
    }
    if (selector === '[data-action="scroll-new-items-to-top"]') {
        return element.dataset.action === 'scroll-new-items-to-top'
    }
    if (selector === '[data-feed-link="true"]') {
        return element.dataset.feedLink === 'true'
    }
    return false
}

test('dismiss click keeps existing visited state intact', () => {
    const visitedCalls = []
    const unvisitedCalls = []
    const dismissedPayloads = []
    let syncCalls = 0

    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    const feedItem = createMockElement({
        classes: ['feed__item', 'feed__item--visited'],
        dataset: {
            itemKey: 'item-1',
            feedId: 'feed-1',
            itemSource: 'VC.RU',
            itemTitle: 'Important market update',
            itemLink: 'https://example.com/item-1',
            itemPublishedAt: '2026-03-09T10:00:00.000Z',
        },
        parent: column,
    })
    createMockElement({
        dataset: {
            feedLink: 'true',
        },
        parent: feedItem,
    })
    const meta = createMockElement({parent: feedItem})
    const actions = createMockElement({
        classes: ['feed__item-actions'],
        parent: meta,
    })
    const dismissButton = createMockElement({
        classes: ['feed__item-dismiss'],
        dataset: {
            action: 'dismiss-feed-item',
        },
        parent: actions,
    })
    const dismissIcon = createMockElement({
        classes: ['feed__item-dismiss-icon'],
        parent: dismissButton,
    })

    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited(itemKeys) {
            visitedCalls.push(itemKeys)
        },
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss(payload) {
            dismissedPayloads.push(payload)
            return true
        },
        shouldAutoMarkReadOnScroll() {
            return false
        },
        syncAppView() {
            syncCalls += 1
        },
        unmarkItemsVisited(itemKeys) {
            unvisitedCalls.push(itemKeys)
        },
    })

    let prevented = false
    let propagationStopped = false
    let immediatePropagationStopped = false

    interactions.handleColumnHeaderClick({
        target: dismissIcon,
        preventDefault() {
            prevented = true
        },
        stopPropagation() {
            propagationStopped = true
        },
        stopImmediatePropagation() {
            immediatePropagationStopped = true
        },
    })

    assert.equal(prevented, true)
    assert.equal(propagationStopped, true)
    assert.equal(immediatePropagationStopped, true)
    assert.deepEqual(visitedCalls, [])
    assert.deepEqual(unvisitedCalls, [])
    assert.equal(feedItem.classList.contains('feed__item--visited'), true)
    assert.equal(feedItem.classList.contains('feed__item--dismissed'), true)
    assert.equal(
        dismissButton.classList.contains('feed__item-dismiss--active'),
        true,
    )
    assert.equal(dismissButton.getAttribute('aria-pressed'), 'true')
    assert.equal(dismissedPayloads.length, 1)
    assert.equal(dismissedPayloads[0].itemKey, 'item-1')
    assert.equal(syncCalls, 0)
})

test('feed link click preserves column scroll when rerendering after click', () => {
    const visitedCalls = []
    const syncPayloads = []

    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    const feedItem = createMockElement({
        classes: ['feed__item'],
        dataset: {
            itemKey: 'item-2',
            feedId: 'feed-1',
            itemSource: 'VC.RU',
            itemTitle: 'Important market update',
            itemLink: 'https://example.com/item-2',
            itemPublishedAt: '2026-03-09T10:00:00.000Z',
        },
        parent: column,
    })
    const feedItemLink = createMockElement({
        dataset: {
            feedLink: 'true',
        },
        parent: feedItem,
    })

    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited(itemKeys) {
            visitedCalls.push(itemKeys)
        },
        registerFeedItemClick() {
            return true
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return false
        },
        syncAppView(payload) {
            syncPayloads.push(payload || {})
        },
        unmarkItemsVisited() {},
    })

    interactions.handleColumnHeaderClick({
        target: feedItemLink,
        preventDefault() {},
    })

    assert.deepEqual(visitedCalls, [['item-2']])
    assert.deepEqual(syncPayloads, [{preserveColumnScroll: true}])
    assert.equal(feedItem.classList.contains('feed__item--visited'), true)
})

test('scrolling back to the top hides the new items notice', () => {
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    column.scrollTop = 0
    const notice = createMockElement({
        classes: ['columns__new-items-notice'],
        parent: column,
    })
    notice.hidden = false
    const content = createMockElement({
        classes: ['columns__content'],
        parent: column,
    })
    content.scrollTop = 0
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited() {},
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return false
        },
        syncAppView() {},
        unmarkItemsVisited() {},
    })

    interactions.handleColumnScroll({target: content})

    assert.equal(notice.hidden, true)
})

test('new items button scrolls its column to the top', () => {
    const previousWindow = globalThis.window
    globalThis.window = {
        matchMedia() {
            return {matches: false}
        },
    }
    const scrollCalls = []
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    column.scrollTop = 800
    column.scrollTo = (options) => {
        scrollCalls.push(['column', options])
        column.scrollTop = options.top
    }
    const newItemsButton = createMockElement({
        classes: ['columns__new-items-notice'],
        dataset: {
            action: 'scroll-new-items-to-top',
        },
        parent: column,
    })
    newItemsButton.hidden = false
    const content = createMockElement({
        classes: ['columns__content'],
        parent: column,
    })
    content.scrollTop = 800
    content.scrollTo = (options) => {
        scrollCalls.push(['content', options])
        content.scrollTop = options.top
    }
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited() {},
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return false
        },
        syncAppView() {},
        unmarkItemsVisited() {},
    })
    let prevented = false

    try {
        interactions.handleColumnHeaderClick({
            target: newItemsButton,
            preventDefault() {
                prevented = true
            },
        })
        interactions.handleColumnScroll({target: content})
    } finally {
        globalThis.window = previousWindow
    }

    assert.equal(prevented, true)
    assert.equal(newItemsButton.hidden, true)
    assert.deepEqual(scrollCalls, [
        ['content', {top: 0, behavior: 'smooth'}],
        ['column', {top: 0, behavior: 'smooth'}],
    ])
})

test('programmatic scroll to new items does not auto-mark hidden items', () => {
    const previousWindow = globalThis.window
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    globalThis.window = {
        matchMedia() {
            return {matches: false}
        },
    }
    let scheduledMarkFrames = 0
    globalThis.requestAnimationFrame = () => {
        scheduledMarkFrames += 1
        return scheduledMarkFrames
    }
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    column.scrollTop = 0
    column.scrollTo = () => {}
    const newItemsButton = createMockElement({
        classes: ['columns__new-items-notice'],
        dataset: {
            action: 'scroll-new-items-to-top',
        },
        parent: column,
    })
    newItemsButton.hidden = false
    const content = createMockElement({
        classes: ['columns__content'],
        parent: column,
    })
    content.scrollTop = 800
    content.scrollTo = () => {}
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited() {},
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return true
        },
        syncAppView() {},
        unmarkItemsVisited() {},
    })

    try {
        interactions.handleColumnHeaderClick({
            target: newItemsButton,
            preventDefault() {},
        })
        interactions.handleColumnScroll({target: content})

        assert.equal(scheduledMarkFrames, 0)

        content.scrollTop = 0
        interactions.handleColumnScroll({target: content})
    } finally {
        globalThis.window = previousWindow
        globalThis.requestAnimationFrame = previousRequestAnimationFrame
    }
})

test('new items click cancels a pending auto-mark frame', () => {
    const previousWindow = globalThis.window
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    const previousCancelAnimationFrame = globalThis.cancelAnimationFrame
    globalThis.window = {
        matchMedia() {
            return {matches: false}
        },
    }
    let pendingFrameCallback
    const canceledFrames = []
    let visitedCalls = 0
    globalThis.requestAnimationFrame = (callback) => {
        pendingFrameCallback = callback
        return 42
    }
    globalThis.cancelAnimationFrame = (frameId) => {
        canceledFrames.push(frameId)
    }
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    column.scrollTop = 0
    column.scrollTo = () => {}
    const newItemsButton = createMockElement({
        classes: ['columns__new-items-notice'],
        dataset: {
            action: 'scroll-new-items-to-top',
        },
        parent: column,
    })
    const content = createMockElement({
        classes: ['columns__content'],
        parent: column,
    })
    content.scrollTop = 800
    content.scrollTo = () => {}
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited() {
            visitedCalls += 1
        },
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return true
        },
        syncAppView() {},
        unmarkItemsVisited() {},
    })

    try {
        interactions.handleColumnScroll({target: content})
        interactions.handleColumnHeaderClick({
            target: newItemsButton,
            preventDefault() {},
        })

        assert.deepEqual(canceledFrames, [42])

        pendingFrameCallback()
        assert.equal(visitedCalls, 0)

        content.scrollTop = 0
        interactions.handleColumnScroll({target: content})
    } finally {
        globalThis.window = previousWindow
        globalThis.requestAnimationFrame = previousRequestAnimationFrame
        globalThis.cancelAnimationFrame = previousCancelAnimationFrame
    }
})

test('restored scroll position does not trigger auto-marking', () => {
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    let scheduledMarkFrames = 0
    globalThis.requestAnimationFrame = () => {
        scheduledMarkFrames += 1
        return scheduledMarkFrames
    }
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    const content = createMockElement({
        classes: ['columns__content'],
        dataset: {
            suppressAutoMarkOnScroll: 'true',
        },
        parent: column,
    })
    content.scrollTop = 800
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited() {},
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return true
        },
        syncAppView() {},
        unmarkItemsVisited() {},
    })

    try {
        interactions.handleColumnScroll({target: content})
    } finally {
        globalThis.requestAnimationFrame = previousRequestAnimationFrame
    }

    assert.equal(scheduledMarkFrames, 0)
})

test('scrolling upward does not auto-mark after suppression expires', () => {
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    let scheduledMarkFrames = 0
    globalThis.requestAnimationFrame = () => {
        scheduledMarkFrames += 1
        return scheduledMarkFrames
    }
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    column.scrollTop = 0
    const content = createMockElement({
        classes: ['columns__content'],
        dataset: {
            suppressAutoMarkOnScroll: 'true',
        },
        parent: column,
    })
    content.scrollTop = 800
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited() {},
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return true
        },
        syncAppView() {},
        unmarkItemsVisited() {},
    })

    try {
        interactions.handleColumnScroll({target: content})
        delete content.dataset.suppressAutoMarkOnScroll
        content.scrollTop = 600
        interactions.handleColumnScroll({target: content})

        assert.equal(scheduledMarkFrames, 0)

        content.scrollTop = 700
        interactions.handleColumnScroll({target: content})
    } finally {
        globalThis.requestAnimationFrame = previousRequestAnimationFrame
    }

    assert.equal(scheduledMarkFrames, 1)
})
