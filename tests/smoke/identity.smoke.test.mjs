import test from 'node:test'
import assert from 'node:assert/strict'
import {base58} from '@scure/base'
import {
    createPhrase,
    identityFromPhrase,
    web3SignInUrl,
} from '../../src/app/identity.ts'
import {cloudError} from '../../src/app/supabase.ts'

const phrase =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
test('identity v1 is deterministic across normalized phrases and its signature verifies with Web Crypto', async () => {
    const first = await identityFromPhrase(phrase)
    const second = await identityFromPhrase(
        `  ${phrase.toUpperCase().replaceAll(' ', '\n ')}  `,
    )
    assert.equal(first.publicKey, second.publicKey)
    const message = new TextEncoder().encode(
        'start.example login, nonce 0123456789',
    )
    const signature = await first.wallet.signMessage(message)
    const publicKey = await crypto.subtle.importKey(
        'raw',
        base58.decode(first.publicKey),
        {name: 'Ed25519'},
        false,
        ['verify'],
    )
    assert.equal(
        await crypto.subtle.verify('Ed25519', publicKey, signature, message),
        true,
    )
    const tampered = new TextEncoder().encode('another.example login')
    assert.equal(
        await crypto.subtle.verify('Ed25519', publicKey, signature, tampered),
        false,
    )
    first.destroy()
    second.destroy()
    await assert.rejects(first.wallet.signMessage(message), /cleared/)
})
test('generated phrases contain 12 words and invalid checksum cannot create an identity', async () => {
    const first = createPhrase(),
        second = createPhrase()
    assert.equal(first.split(' ').length, 12)
    assert.notEqual(first, second)
    await assert.rejects(
        identityFromPhrase('abandon '.repeat(12)),
        /Контрольная сумма/,
    )
    const identity = await identityFromPhrase(first)
    assert.equal(JSON.stringify(identity).includes(first), false)
    identity.destroy()
})

test('native Web3 login accepts localhost and HTTPS, and explains the unsupported IP origin before authentication', () => {
    assert.equal(
        web3SignInUrl('http://localhost:1234/'),
        'http://localhost:1234/',
    )
    assert.equal(
        web3SignInUrl('https://reader.example/start/'),
        'https://reader.example/start/',
    )
    assert.throws(
        () => web3SignInUrl('http://127.0.0.1:1234/'),
        (error) => {
            assert.match(cloudError(error), /http:\/\/localhost:1234\//)
            assert.match(cloudError(error), /экспорт и импорт/)
            return true
        },
    )
    assert.throws(() => web3SignInUrl('http://[::1]:4173/'), /localhost:4173/)
    assert.throws(() => web3SignInUrl('http://reader.example/'), /HTTPS/)
    assert.throws(
        () => web3SignInUrl('https://reader.example@evil.example/'),
        /HTTPS/,
    )
})
