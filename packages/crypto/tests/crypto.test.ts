import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { decryptFrame, deriveSharedKey, encryptFrame, fromBase64Url, generateKeyPair, identityFingerprint } from '../src/index.js'

describe('secure channel primitives', () => {
  it('rejects alternate encodings of key and ciphertext bytes', async () => {
    await runScenarios(['AQ==', 'AR', 'AQJ', 'AQ\n', 'AQ+/', 'A'].map(value => ({
      name: JSON.stringify(value),
      run: () => expect(() => fromBase64Url(value)).toThrow('Invalid canonical Base64URL.'),
    })))
    expect(fromBase64Url('AQID')).toEqual(new Uint8Array([1, 2, 3]))
  })
  it('derives matching shared keys and decrypts a frame', () => {
    const host = generateKeyPair()
    const client = generateKeyPair()
    const hostKey = deriveSharedKey(host.privateKey, client.publicKey)
    const clientKey = deriveSharedKey(client.privateKey, host.publicKey)
    expect(Buffer.from(hostKey).equals(Buffer.from(clientKey))).toBe(true)

    const plaintext = new TextEncoder().encode('hello remote')
    const frame = encryptFrame(hostKey, plaintext)
    expect(new TextDecoder().decode(decryptFrame(clientKey, frame))).toBe('hello remote')
    expect(identityFingerprint(host.publicKey)).toMatch(/^[A-F0-9]{12}$/)
  })
})
