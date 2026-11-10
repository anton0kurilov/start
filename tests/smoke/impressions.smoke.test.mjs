import test from 'node:test'
import assert from 'node:assert/strict'
import {createImpressionTracker} from '../../src/app/impressions.ts'

test('shared impression observer respects dwell, visibility and disposal', (t) => {
    t.mock.timers.enable({apis: ['setTimeout']})
    let callback
    let created = 0
    let disconnected = false
    let dialogOpen = false
    const observed = new Set()
    const previousObserver = globalThis.IntersectionObserver
    const previousDocument = globalThis.document
    globalThis.document = {
        hidden: false,
        querySelector: () => dialogOpen,
    }
    globalThis.IntersectionObserver = class {
        constructor(fn) {
            created++
            callback = fn
        }
        observe(node) {
            observed.add(node)
        }
        unobserve(node) {
            observed.delete(node)
        }
        disconnect() {
            disconnected = true
            observed.clear()
        }
    }
    t.after(() => {
        globalThis.IntersectionObserver = previousObserver
        globalThis.document = previousDocument
    })
    const events = []
    const tracker = createImpressionTracker((card) => events.push(card))
    const first = {},
        second = {}
    let card = {itemKey: 'first', title: 'old'}
    tracker.observe(first, () => card)
    const removeSecond = tracker.observe(second, () => ({itemKey: 'second'}))
    const entry = (target, ratio) => ({
        target,
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
    })
    assert.equal(created, 1)
    callback([entry(first, 0.7), entry(second, 0.5)])
    t.mock.timers.tick(1199)
    assert.equal(events.length, 0)
    card = {...card, title: 'current'}
    t.mock.timers.tick(1)
    assert.equal(events[0].title, 'current')
    callback([entry(first, 0.7), entry(second, 0.8)])
    callback([entry(first, 0)])
    removeSecond()
    t.mock.timers.tick(1200)
    assert.equal(events.length, 1)
    assert.equal(observed.has(second), false)
    dialogOpen = true
    callback([entry(first, 1)])
    t.mock.timers.tick(1200)
    dialogOpen = false
    globalThis.document.hidden = true
    callback([entry(first, 1)])
    t.mock.timers.tick(1200)
    assert.equal(events.length, 1)
    globalThis.document.hidden = false
    callback([entry(first, 1)])
    tracker.dispose()
    t.mock.timers.tick(1200)
    assert.equal(events.length, 1)
    assert.equal(disconnected, true)
    assert.equal(observed.size, 0)
})
