import { createCipheriv, createDecipheriv } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
import { createNativeChaChaDecryptor, createNativeChaChaEncryptor, NATIVE_CHACHA_VECTOR as vector } from '../src/services/native-chacha-poly'

function openssl(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
  cipher.setAAD(ad, { plaintextLength: plaintext.length })
  return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]))
}
function opensslDecrypt(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
  const body = ciphertext.subarray(0, ciphertext.length - 16)
  const tag = ciphertext.subarray(ciphertext.length - 16)
  decipher.setAuthTag(tag)
  decipher.setAAD(ad, { plaintextLength: body.length })
  return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]))
}
const provider = (encrypt = openssl, decrypt: typeof opensslDecrypt | null = opensslDecrypt) => ({
  isAvailable: () => true,
  encrypt,
  ...(decrypt !== null ? { decrypt } : {}),
})
describe('Android binary ChaChaPoly adapter', () => {
  it('matches the OpenSSL public self-test vector for encrypt and decrypt', () => {
    const args = [vector.key, vector.nonce, vector.ad, vector.plaintext].map(s => Buffer.from(s, 'base64'))
    const expected = Buffer.from(vector.expected, 'base64')
    expect(Buffer.from(openssl(args[0]!, args[1]!, args[2]!, args[3]!)).toString('base64')).toBe(vector.expected)
    expect(Buffer.from(opensslDecrypt(args[0]!, args[1]!, args[2]!, expected)).toString('base64')).toBe(vector.plaintext)
  })
  it('keeps standard encryption when unavailable or the self-test fails', () => {
    expect(createNativeChaChaEncryptor(undefined)).toBeUndefined()
    expect(createNativeChaChaEncryptor({ ...provider(), isAvailable: () => false })).toBeUndefined()
    expect(createNativeChaChaEncryptor(provider(() => new Uint8Array(50)))).toBeUndefined()
    expect(createNativeChaChaEncryptor(provider(() => { throw new Error('unavailable') }))).toBeUndefined()
  })
  it('keeps standard decryption when unavailable, missing decrypt, or self-test/tag rejection fails', () => {
    expect(createNativeChaChaDecryptor(undefined)).toBeUndefined()
    expect(createNativeChaChaDecryptor(provider(openssl, null))).toBeUndefined()
    expect(createNativeChaChaDecryptor({ ...provider(), isAvailable: () => false })).toBeUndefined()
    expect(createNativeChaChaDecryptor(provider(openssl, () => new Uint8Array(10)))).toBeUndefined()
    expect(createNativeChaChaDecryptor(provider(openssl, () => { throw new Error('unavailable') }))).toBeUndefined()
    // Must reject a broken provider that returns plaintext without verifying the AEAD tag.
    expect(createNativeChaChaDecryptor(provider(openssl, () => Buffer.from(vector.plaintext, 'base64')))).toBeUndefined()
  })
  it.each([0n, 1n, (1n << 53n) + 1n, (1n << 64n) - 1n])('preserves nonce %s and ciphertext/plaintext bytes', nonce => {
    const nativeEncrypt = vi.fn(openssl)
    const nativeDecrypt = vi.fn(opensslDecrypt)
    const p = provider(nativeEncrypt, nativeDecrypt)
    const encrypt = createNativeChaChaEncryptor(p)!
    const decrypt = createNativeChaChaDecryptor(p)!
    const key = Uint8Array.from({ length: 32 }, (_, i) => i)
    const ad = new TextEncoder().encode('associated data')
    const backing = Uint8Array.from({ length: 65530 }, (_, i) => i % 251)
    const plaintext = backing.subarray(7, 65526)
    const iv = Buffer.alloc(12); iv.writeBigUInt64LE(nonce, 4)
    const ciphertext = encrypt(key, nonce, ad, plaintext)!
    expect(ciphertext).toEqual(openssl(key, iv, ad, plaintext))
    expect(Buffer.from(nativeEncrypt.mock.calls[1]![1])).toEqual(iv)
    expect(nativeEncrypt.mock.calls[1]![3]).toBe(plaintext)

    const ctBacking = new Uint8Array(ciphertext.length + 12)
    ctBacking.set(ciphertext, 5)
    const ctSlice = ctBacking.subarray(5, 5 + ciphertext.length)
    expect(decrypt(key, nonce, ad, ctSlice)).toEqual(plaintext)
    expect(Buffer.from(nativeDecrypt.mock.calls[2]![1])).toEqual(iv)
    expect(nativeDecrypt.mock.calls[2]![3]).toBe(ctSlice)
  })
  it('keeps small messages standard and propagates runtime failures without retry', () => {
    const nativeEncrypt = vi.fn(openssl)
    const nativeDecrypt = vi.fn(opensslDecrypt)
    const p = provider(nativeEncrypt, nativeDecrypt)
    const encrypt = createNativeChaChaEncryptor(p)!
    const decrypt = createNativeChaChaDecryptor(p)!
    expect(encrypt(new Uint8Array(32), 0n, new Uint8Array(), new Uint8Array(100))).toBeUndefined()
    expect(decrypt(new Uint8Array(32), 0n, new Uint8Array(), new Uint8Array(100 + 16))).toBeUndefined()
    expect(decrypt(new Uint8Array(32), 0n, new Uint8Array(), new Uint8Array(4095 + 16))).toBeUndefined()
    nativeEncrypt.mockImplementation(() => { throw new Error('native encrypt failed') })
    nativeDecrypt.mockImplementation(() => { throw new Error('native decrypt failed') })
    expect(() => encrypt(new Uint8Array(32), 1n, new Uint8Array(), new Uint8Array(4096))).toThrow('native encrypt failed')
    expect(() => decrypt(new Uint8Array(32), 1n, new Uint8Array(), new Uint8Array(4096 + 16))).toThrow('native decrypt failed')
    expect(nativeEncrypt).toHaveBeenCalledTimes(2)
    expect(nativeDecrypt).toHaveBeenCalledTimes(3)
  })
})
