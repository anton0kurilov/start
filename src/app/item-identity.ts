import {sha256} from '@noble/hashes/sha2.js'
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js'
import type {Item} from './types'

export function itemKey(item: Partial<Item>) {
    return String(
        item.link ||
            item.id ||
            `${item.source || ''}|${item.title || ''}|${item.date?.toISOString() || ''}`,
    ).trim()
}
export function digest(value: string) {
    return bytesToHex(sha256(utf8ToBytes(value)))
}
export function itemDigest(key: string) {
    return digest(`item-key-v1:${key.trim()}`)
}
