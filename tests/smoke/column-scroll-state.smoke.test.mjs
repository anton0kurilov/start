import test from 'node:test'
import assert from 'node:assert/strict'

import {
    captureColumnScrollState,
    restoreColumnScrollState,
} from '../../src/scripts/column-scroll-state.js'

function createColumnsElement(columns, scrollLeft = 0) {
    return {
        scrollLeft,
        querySelectorAll(selector) {
            return selector === '.columns__item' ? columns : []
        },
    }
}

function createColumn({
    columnKey,
    columnTop = 0,
    columnScrollTop = 0,
    contentTop = 40,
    contentScrollTop = 0,
    itemKeys = [],
    itemHeight = 100,
    noticeHidden = true,
}) {
    const notice = {
        hidden: noticeHidden,
    }
    const column = {
        dataset: {columnKey},
        scrollTop: columnScrollTop,
        getBoundingClientRect() {
            return {top: columnTop}
        },
        querySelector(selector) {
            if (selector === '.columns__content') {
                return content
            }
            if (selector === '.columns__new-items-notice') {
                return notice
            }
            return null
        },
    }
    const content = {
        dataset: {},
        scrollTop: contentScrollTop,
        getBoundingClientRect() {
            return {top: contentTop}
        },
        querySelectorAll(selector) {
            return selector === '.feed__item' ? items : []
        },
    }
    const items = itemKeys.map((itemKey, index) => ({
        dataset: {itemKey},
        getBoundingClientRect() {
            const top =
                contentTop + index * itemHeight - content.scrollTop
            return {
                top,
                bottom: top + itemHeight,
            }
        },
    }))

    return {column, content, items, notice}
}

test('restores the same visible item when new items appear above it', () => {
    const before = createColumn({
        columnKey: 'folder:tech',
        contentScrollTop: 120,
        itemKeys: ['item-a', 'item-b', 'item-c'],
    })
    const scrollState = captureColumnScrollState(
        createColumnsElement([before.column], 48),
    )
    const after = createColumn({
        columnKey: 'folder:tech',
        itemKeys: ['item-new', 'item-a', 'item-b', 'item-c'],
    })
    const columnsElement = createColumnsElement([after.column])

    restoreColumnScrollState(columnsElement, scrollState)

    assert.equal(columnsElement.scrollLeft, 48)
    assert.equal(after.content.scrollTop, 220)
    assert.equal(after.items[2].getBoundingClientRect().top, 20)
    assert.equal(after.notice.hidden, false)
})

test('matches columns by stable key after their order changes', () => {
    const beforeTech = createColumn({
        columnKey: 'folder:tech',
        contentScrollTop: 120,
        itemKeys: ['tech-a', 'tech-b', 'tech-c'],
    })
    const beforeNews = createColumn({
        columnKey: 'folder:news',
        contentScrollTop: 30,
        itemKeys: ['news-a', 'news-b'],
    })
    const scrollState = captureColumnScrollState(
        createColumnsElement([beforeTech.column, beforeNews.column]),
    )
    const afterNews = createColumn({
        columnKey: 'folder:news',
        itemKeys: ['news-a', 'news-b'],
    })
    const afterTech = createColumn({
        columnKey: 'folder:tech',
        itemKeys: ['tech-a', 'tech-b', 'tech-c'],
    })

    restoreColumnScrollState(
        createColumnsElement([afterNews.column, afterTech.column]),
        scrollState,
    )

    assert.equal(afterNews.content.scrollTop, 30)
    assert.equal(afterTech.content.scrollTop, 120)
})

test('falls back to the previous scroll offsets when the anchor disappears', () => {
    const before = createColumn({
        columnKey: 'recommended',
        columnScrollTop: 75,
        contentScrollTop: 120,
        itemKeys: ['item-a', 'item-b'],
    })
    const scrollState = captureColumnScrollState(
        createColumnsElement([before.column]),
    )
    const after = createColumn({
        columnKey: 'recommended',
        itemKeys: ['item-other'],
    })

    restoreColumnScrollState(
        createColumnsElement([after.column]),
        scrollState,
    )

    assert.equal(after.column.scrollTop, 75)
    assert.equal(after.content.scrollTop, 120)
    assert.equal(after.notice.hidden, true)
})

test('does not apply a removed keyed column state to another column', () => {
    const before = createColumn({
        columnKey: 'folder:removed',
        contentScrollTop: 120,
        itemKeys: ['removed-a', 'removed-b'],
    })
    const scrollState = captureColumnScrollState(
        createColumnsElement([before.column]),
    )
    const after = createColumn({
        columnKey: 'folder:remaining',
        itemKeys: ['remaining-a', 'remaining-b'],
    })

    restoreColumnScrollState(
        createColumnsElement([after.column]),
        scrollState,
    )

    assert.equal(after.column.scrollTop, 0)
    assert.equal(after.content.scrollTop, 0)
})

test('does not show the notice when new items appear while already at top', () => {
    const before = createColumn({
        columnKey: 'folder:tech',
        itemKeys: ['item-a', 'item-b'],
    })
    const scrollState = captureColumnScrollState(
        createColumnsElement([before.column]),
    )
    const after = createColumn({
        columnKey: 'folder:tech',
        itemKeys: ['item-new', 'item-a', 'item-b'],
    })

    restoreColumnScrollState(
        createColumnsElement([after.column]),
        scrollState,
    )

    assert.equal(after.content.scrollTop, 0)
    assert.equal(after.notice.hidden, true)
})

test('keeps an existing notice through a scroll-preserving rerender', () => {
    const before = createColumn({
        columnKey: 'folder:tech',
        contentScrollTop: 120,
        itemKeys: ['item-a', 'item-b', 'item-c'],
        noticeHidden: false,
    })
    const scrollState = captureColumnScrollState(
        createColumnsElement([before.column]),
    )
    const after = createColumn({
        columnKey: 'folder:tech',
        itemKeys: ['item-a', 'item-b', 'item-c'],
    })

    restoreColumnScrollState(
        createColumnsElement([after.column]),
        scrollState,
    )

    assert.equal(after.notice.hidden, false)
})
