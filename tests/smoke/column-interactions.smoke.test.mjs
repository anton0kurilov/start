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
        querySelectorAll(selector) {
            return this.children.flatMap((child) => [
                ...(matchesSelector(child, selector) ? [child] : []),
                ...child.querySelectorAll(selector),
            ])
        },
        getBoundingClientRect() {
            return {top: 0, bottom: 0}
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

test('a card without a usable link is not marked as read', () => {
    const visitedCalls = []
    let clickCalls = 0
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    const item = createMockElement({
        classes: ['feed__item'],
        dataset: {itemKey: 'no-link'},
        parent: column,
    })
    const link = createMockElement({
        dataset: {feedLink: 'true', noLink: 'true'},
        parent: item,
    })
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited(keys) {
            visitedCalls.push(keys)
        },
        registerFeedItemClick() {
            clickCalls += 1
            return true
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
    interactions.handleColumnHeaderClick({
        target: link,
        preventDefault() {
            prevented = true
        },
    })
    interactions.handleColumnAuxClick({target: link, button: 1})

    assert.equal(prevented, true)
    assert.deepEqual(visitedCalls, [])
    assert.equal(clickCalls, 0)
    assert.equal(item.classList.contains('feed__item--visited'), false)
})

test('manual column action keeps duplicate cards in sync when toggled', () => {
    const visitedCalls = []
    const unvisitedCalls = []
    const syncPayloads = []
    const columns = createMockElement({classes: ['columns']})
    const firstColumn = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    const button = createMockElement({
        dataset: {action: 'mark-column-read'},
        parent: firstColumn,
    })
    const firstItem = createMockElement({
        classes: ['feed__item'],
        dataset: {itemKey: 'shared'},
        parent: firstColumn,
    })
    const secondColumn = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    const secondItem = createMockElement({
        classes: ['feed__item'],
        dataset: {itemKey: 'shared'},
        parent: secondColumn,
    })
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited(keys) {
            visitedCalls.push(keys)
        },
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return false
        },
        syncAppView(payload) {
            syncPayloads.push(payload)
        },
        unmarkItemsVisited(keys) {
            unvisitedCalls.push(keys)
        },
    })

    interactions.handleColumnHeaderClick({target: button, preventDefault() {}})
    assert.deepEqual(visitedCalls, [['shared']])
    assert.equal(firstItem.classList.contains('feed__item--visited'), true)
    assert.equal(secondItem.classList.contains('feed__item--visited'), true)

    interactions.handleColumnHeaderClick({target: button, preventDefault() {}})
    assert.deepEqual(unvisitedCalls, [['shared']])
    assert.equal(firstItem.classList.contains('feed__item--visited'), false)
    assert.equal(secondItem.classList.contains('feed__item--visited'), false)
    assert.deepEqual(syncPayloads, [
        {preserveColumnScroll: true},
        {preserveColumnScroll: true},
    ])
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

function createScrollFixture({
    itemKeys,
    scrollTop = 0,
    mobile = false,
    autoMarkRead = true,
} = {}) {
    const visitedCalls = []
    let isAutoMarkReadEnabled = autoMarkRead
    const columns = createMockElement({classes: ['columns']})
    const column = createMockElement({
        classes: ['columns__item'],
        parent: columns,
    })
    column.scrollTop = mobile ? scrollTop : 0
    column.getBoundingClientRect = () => ({top: 0, bottom: 340})
    column.scrollTo = () => {}
    const header = createMockElement({
        classes: ['columns__header'],
        parent: column,
    })
    const notice = createMockElement({
        classes: ['columns__new-items-notice'],
        dataset: {action: 'scroll-new-items-to-top'},
        parent: column,
    })
    notice.hidden = true
    const content = createMockElement({
        classes: ['columns__content'],
        parent: column,
    })
    content.scrollTop = mobile ? 0 : scrollTop
    content.getBoundingClientRect = () => ({
        top: 40 - (mobile ? column.scrollTop : 0),
        bottom: 340,
    })
    content.scrollTo = () => {}
    const items = itemKeys.map((itemKey, index) => {
        const item = createMockElement({
            classes: ['feed__item'],
            dataset: {itemKey},
            parent: content,
        })
        item.getBoundingClientRect = () => {
            const top =
                40 + index * 100 -
                (mobile ? column.scrollTop : content.scrollTop)
            return {top, bottom: top + 100}
        }
        return item
    })
    const interactions = createColumnInteractions({
        columnsElement: columns,
        markItemsVisited(itemKeysToMark) {
            visitedCalls.push(itemKeysToMark)
        },
        registerFeedItemClick() {
            return false
        },
        registerFeedItemDismiss() {
            return false
        },
        shouldAutoMarkReadOnScroll() {
            return isAutoMarkReadEnabled
        },
        syncAppView() {},
        unmarkItemsVisited() {},
    })
    interactions.captureScrollState()
    return {
        column,
        content,
        header,
        interactions,
        items,
        notice,
        visitedCalls,
        setAutoMarkRead(isEnabled) {
            isAutoMarkReadEnabled = isEnabled
        },
    }
}

test('downward scrolling marks only cards that cross the top edge', () => {
    const fixture = createScrollFixture({itemKeys: ['a', 'b', 'c']})
    fixture.content.scrollTop = 120
    fixture.interactions.handleColumnScroll({target: fixture.content})
    fixture.content.scrollTop = 220
    fixture.interactions.handleColumnScroll({target: fixture.content})
    fixture.content.scrollTop = 180
    fixture.interactions.handleColumnScroll({target: fixture.content})

    assert.deepEqual(fixture.visitedCalls, [['a'], ['b']])
})

test('new cards already above a restored viewport stay unread on downward scroll', () => {
    const fixture = createScrollFixture({
        itemKeys: ['new', 'a', 'b', 'c'],
        scrollTop: 160,
    })
    fixture.content.scrollTop = 210
    fixture.interactions.handleColumnScroll({target: fixture.content})

    assert.deepEqual(fixture.visitedCalls, [['a']])
    assert.equal(fixture.items[0].classList.contains('feed__item--visited'), false)
})

test('header click and upward scroll never mark cards as read', () => {
    const previousWindow = globalThis.window
    globalThis.window = {matchMedia: () => ({matches: false})}
    const fixture = createScrollFixture({
        itemKeys: ['new', 'a', 'b', 'c'],
        scrollTop: 280,
    })

    try {
        fixture.interactions.handleColumnHeaderClick({target: fixture.header})
        for (const scrollTop of [200, 100, 0]) {
            fixture.content.scrollTop = scrollTop
            fixture.interactions.handleColumnScroll({target: fixture.content})
        }
        assert.deepEqual(fixture.visitedCalls, [])

        fixture.content.scrollTop = 110
        fixture.interactions.handleColumnScroll({target: fixture.content})
        assert.deepEqual(fixture.visitedCalls, [['new']])
    } finally {
        globalThis.window = previousWindow
    }
})

test('upward scrolling stays unread without programmatic suppression', () => {
    const fixture = createScrollFixture({
        itemKeys: ['new', 'a', 'b', 'c'],
        scrollTop: 280,
    })
    for (const scrollTop of [200, 100, 0]) {
        fixture.content.scrollTop = scrollTop
        fixture.interactions.handleColumnScroll({target: fixture.content})
    }

    assert.deepEqual(fixture.visitedCalls, [])
})

test('restored scroll is a new baseline rather than a read action', () => {
    const fixture = createScrollFixture({itemKeys: ['a', 'b', 'c', 'd']})
    fixture.content.dataset.suppressAutoMarkOnScroll = 'true'
    fixture.content.scrollTop = 220
    fixture.interactions.handleColumnScroll({target: fixture.content})
    delete fixture.content.dataset.suppressAutoMarkOnScroll

    assert.deepEqual(fixture.visitedCalls, [])
    fixture.content.scrollTop = 300
    fixture.interactions.handleColumnScroll({target: fixture.content})
    assert.deepEqual(fixture.visitedCalls, [['c']])
})

test('enabling automatic marking does not read cards already above the viewport', () => {
    const fixture = createScrollFixture({
        itemKeys: ['a', 'b', 'c'],
        scrollTop: 160,
        autoMarkRead: false,
    })
    fixture.content.scrollTop = 210
    fixture.interactions.handleColumnScroll({target: fixture.content})
    assert.deepEqual(fixture.visitedCalls, [])

    fixture.setAutoMarkRead(true)
    fixture.interactions.captureScrollState()
    fixture.content.scrollTop = 220
    fixture.interactions.handleColumnScroll({target: fixture.content})
    assert.deepEqual(fixture.visitedCalls, [])

    fixture.content.scrollTop = 310
    fixture.interactions.handleColumnScroll({target: fixture.content})
    assert.deepEqual(fixture.visitedCalls, [['c']])
})

test('mobile column scrolling uses the visible column edge', () => {
    const fixture = createScrollFixture({
        itemKeys: ['a', 'b', 'c'],
        mobile: true,
    })
    fixture.column.scrollTop = 150
    fixture.interactions.handleColumnScroll({target: fixture.column})

    assert.deepEqual(fixture.visitedCalls, [['a']])
})
