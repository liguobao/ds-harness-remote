import { createCipheriv } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { createNativeChaChaEncryptor, NATIVE_CHACHA_VECTOR as vector } from '../src/services/native-chacha-poly'

function openssl(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
  cipher.setAAD(ad, { plaintextLength: plaintext.length })
  return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]))
}
const provider = (encrypt = openssl) => ({ isAvailable: () => true, encrypt })
describe('Android binary ChaChaPoly adapter', () => {
  it('matches the OpenSSL public self-test vector', () => {
    const args = [vector.key, vector.nonce, vector.ad, vector.plaintext].map(s => Buffer.from(s, 'base64'))
    expect(Buffer.from(openssl(args[0]!, args[1]!, args[2]!, args[3]!)).toString('base64')).toBe(vector.expected)
  })
  it('keeps standard encryption when unavailable or the self-test fails', () => {
    expect(createNativeChaChaEncryptor(undefined)).toBeUndefined()
    expect(createNativeChaChaEncryptor({ ...provider(), isAvailable: () => false })).toBeUndefined()
    expect(createNativeChaChaEncryptor(provider(() => new Uint8Array(50)))).toBeUndefined()
    expect(createNativeChaChaEncryptor(provider(() => { throw new Error('unavailable') }))).toBeUndefined()
  })
  it.each([0n, 1n, (1n << 53n) + 1n, (1n << 64n) - 1n])('preserves nonce %s and ciphertext bytes', nonce => {
    const native = vi.fn(openssl)
    const encrypt = createNativeChaChaEncryptor(provider(native))!
    const key = Uint8Array.from({ length: 32 }, (_, i) => i)
    const ad = new TextEncoder().encode('associated data')
    const backing = Uint8Array.from({ length: 65530 }, (_, i) => i % 251)
    const plaintext = backing.subarray(7, 65526)
    const iv = Buffer.alloc(12); iv.writeBigUInt64LE(nonce, 4)
    expect(encrypt(key, nonce, ad, plaintext)).toEqual(openssl(key, iv, ad, plaintext))
    expect(Buffer.from(native.mock.calls[1]![1])).toEqual(iv)
    expect(native.mock.calls[1]![3]).toBe(plaintext)
  })
  it('keeps small messages standard and propagates runtime failures without retry', () => {
    const native = vi.fn(openssl)
    const encrypt = createNativeChaChaEncryptor(provider(native))!
    expect(encrypt(new Uint8Array(32), 0n, new Uint8Array(), new Uint8Array(100))).toBeUndefined()
    native.mockImplementation(() => { throw new Error('native failed') })
    expect(() => encrypt(new Uint8Array(32), 1n, new Uint8Array(), new Uint8Array(4096))).toThrow('native failed')
    expect(native).toHaveBeenCalledTimes(2)
  })
})
