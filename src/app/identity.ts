import {generateMnemonic, mnemonicToSeed, validateMnemonic} from '@scure/bip39'
import {wordlist} from '@scure/bip39/wordlists/english.js'
import {base58} from '@scure/base'
import {ed25519} from '@noble/curves/ed25519.js'
import {hkdf} from '@noble/hashes/hkdf.js'
import {sha256} from '@noble/hashes/sha2.js'
import {utf8ToBytes} from '@noble/hashes/utils.js'

export const IDENTITY_VERSION = 'identity-v1'
export class SignInLocationError extends Error {}

// Supabase Auth v2.197 SIWS accepts DNS names (including localhost), but
// rejects IP authorities and permits HTTP only for localhost.
export function web3SignInUrl(input: string) {
    const url = new URL(input)
    if (['127.0.0.1', '[::1]'].includes(url.hostname)) {
        const local = new URL(url)
        local.hostname = 'localhost'
        throw new SignInLocationError(
            `Для входа откройте ${local.origin}/. Локальные данные с текущего адреса можно перенести через экспорт и импорт JSON.`,
        )
    }
    const domain =
        /^(localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})(?::\d{1,5})?$/
    if (
        !domain.test(url.host) ||
        url.username ||
        url.password ||
        !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && url.hostname === 'localhost')
        )
    )
        throw new SignInLocationError(
            'Для входа нужен HTTPS-адрес приложения или http://localhost для локального запуска.',
        )
    return url.href
}
export function normalizePhrase(phrase: string) {
    return phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/u).join(' ')
}
export function createPhrase() {
    return generateMnemonic(wordlist, 128)
}
export async function identityFromPhrase(input: string) {
    const phrase = normalizePhrase(input)
    if (phrase.split(' ').length !== 12 || !validateMnemonic(phrase, wordlist))
        throw new Error(
            'Проверьте 12 слов и их порядок. Контрольная сумма фразы не совпадает.',
        )
    const root = await mnemonicToSeed(phrase, '')
    const secret = hkdf(
        sha256,
        root,
        utf8ToBytes('start:auth:v1'),
        utf8ToBytes('ed25519-login'),
        32,
    )
    root.fill(0)
    const publicKey = ed25519.getPublicKey(secret)
    let destroyed = false
    return {
        version: IDENTITY_VERSION,
        publicKey: base58.encode(publicKey),
        wallet: {
            publicKey: {toBase58: () => base58.encode(publicKey)},
            async signMessage(message: Uint8Array) {
                if (destroyed) throw new Error('Identity was cleared')
                return ed25519.sign(message, secret)
            },
        },
        destroy() {
            secret.fill(0)
            destroyed = true
        },
    }
}
