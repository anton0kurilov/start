import test from 'node:test'
import assert from 'node:assert/strict'
import {createBoardPosition} from '../../src/app/board-position.ts'

function harness() {
    let left = 420
    const writes = []
    const columns = []
    function column(key) {
        return {
            dataset: {columnKey: key},
            get offsetLeft() {
                return 24 + columns.indexOf(this) * 400
            },
            getBoundingClientRect() {
                return {
                    left: this.offsetLeft - left,
                    right: this.offsetLeft + 380 - left,
                }
            },
        }
    }
    columns.push(...['a', 'b', 'c', 'd'].map(column))
    const board = {
        get scrollLeft() {
            return left
        },
        set scrollLeft(value) {
            writes.push(value)
            left = value
        },
        getBoundingClientRect: () => ({left: 0}),
        querySelectorAll: () => columns,
    }
    return {
        board,
        columns,
        column,
        writes,
        move: (value) => (left = value),
        position: createBoardPosition(board),
    }
}

test('data-only updates leave native horizontal scrolling untouched', () => {
    const h = harness()
    h.position.capture()
    h.move(730)
    h.position.restore()
    assert.equal(h.board.scrollLeft, 730)
    assert.deepEqual(h.writes, [])
})

test('inserting a column preserves the visible anchor', () => {
    const h = harness()
    h.position.capture()
    h.columns.unshift(h.column('recommended'))
    h.position.restore()
    assert.equal(h.board.scrollLeft, 820)
    assert.deepEqual(h.writes, [820])
})

test('native snapping that already retained the anchor is not applied twice', () => {
    const h = harness()
    h.position.capture()
    h.columns.unshift(h.column('recommended'))
    h.move(820)
    h.position.restore()
    assert.equal(h.board.scrollLeft, 820)
    assert.deepEqual(h.writes, [])
})

test('updates in one render batch restore the column anchor only once', () => {
    const h = harness()
    assert.equal(h.position.capture(), true)
    assert.equal(h.position.capture(), false)
    h.columns.unshift(h.column('recommended'))
    h.position.restore()
    h.position.restore()
    assert.deepEqual(h.writes, [820])
})

test('removing a preceding column retains the same visible anchor', () => {
    const h = harness()
    h.position.capture()
    h.columns.shift()
    h.position.restore()
    assert.equal(h.board.scrollLeft, 20)
})

test('a removed anchor or empty board does not reset horizontal scrolling', () => {
    const h = harness()
    h.position.capture()
    h.columns.splice(1, 1)
    h.position.restore()
    h.columns.length = 0
    assert.equal(h.position.capture(), false)
    h.position.restore()
    assert.deepEqual(h.writes, [])
})
