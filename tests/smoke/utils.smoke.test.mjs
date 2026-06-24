import test from 'node:test'
import assert from 'node:assert/strict'

import {normalizeHttpUrl} from '../../src/scripts/utils.js'

test('normalizeHttpUrl accepts HTTP and HTTPS links', () => {
    assert.equal(
        normalizeHttpUrl('https://example.com/article?id=1'),
        'https://example.com/article?id=1',
    )
    assert.equal(
        normalizeHttpUrl('http://example.com/article'),
        'http://example.com/article',
    )
})

test('normalizeHttpUrl resolves relative feed links', () => {
    assert.equal(
        normalizeHttpUrl('../article/1', 'https://example.com/feed/rss.xml'),
        'https://example.com/article/1',
    )
})

test('normalizeHttpUrl rejects executable and unsupported protocols', () => {
    assert.equal(normalizeHttpUrl('javascript:alert(1)'), '')
    assert.equal(
        normalizeHttpUrl('data:text/html,<script>alert(1)</script>'),
        '',
    )
    assert.equal(normalizeHttpUrl('file:///etc/passwd'), '')
    assert.equal(normalizeHttpUrl('not a valid absolute URL'), '')
})
