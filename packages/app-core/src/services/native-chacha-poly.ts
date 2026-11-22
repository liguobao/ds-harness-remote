import { requireOptionalNativeModule } from 'expo'
import { fromBase64Url, toBase64Url, type NoiseIkSessionOptions } from '@dsh-remote/crypto'

type NativeCipher = {
  isAvailable(): boolean
  encrypt(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Uint8Array
  decrypt?(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array
}
type Encryptor = NonNullable<NoiseIkSessionOptions['encryptChaChaPoly']>
type Decryptor = NonNullable<NoiseIkSessionOptions['decryptChaChaPoly']>

const MIN_NATIVE_PLAINTEXT_BYTES = 4096
const CHACHA_POLY_TAG_BYTES = 16

/** Public cross-provider test vector generated with Node/OpenSSL, including a >2^53 nonce. */
export const NATIVE_CHACHA_VECTOR = {
  key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  nonce: 'AAAAAAEAAAAAACAA',
  ad: 'RFNIIG5hdGl2ZSBDaGFDaGFQb2x5IHNlbGYtdGVzdA==',
  plaintext: 'TmF0aXZlIHByb3ZpZGVyIGJ5dGUgY29tcGF0aWJpbGl0eQ==',
  expected: 'VhiMtTUfroGQG+Xjv1dXbT0r9RNYHK2HC1P9/4bNGrV7C9P/qCcrRRc+6l8wAQCKF3M=',
} as const

function encodeNoiseNonce(nonce: bigint): Uint8Array {
  const iv = new Uint8Array(12)
  new DataView(iv.buffer).setBigUint64(4, nonce, true)
  return iv
}

function normalizeBase64Url(base64: string): string {
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function createNativeChaChaEncryptor(native: NativeCipher | undefined): Encryptor | undefined {
  if (!native || typeof native.encrypt !== 'function') return undefined
  // Decide before connecting. Unsupported/broken providers keep the standard implementation.
  try {
    if (!native.isAvailable()) return undefined
    const v = NATIVE_CHACHA_VECTOR
    const actual = native.encrypt(fromBase64Url(v.key), fromBase64Url(v.nonce), fromBase64Url(v.ad), fromBase64Url(v.plaintext))
    if (toBase64Url(actual) !== normalizeBase64Url(v.expected)) return undefined
  } catch { return undefined }
  return (key, nonce, ad, plaintext) => {
    if (plaintext.byteLength < MIN_NATIVE_PLAINTEXT_BYTES) return undefined
    // Once selected, errors propagate and close the secure transport; no same-nonce retry.
    return native.encrypt(key, encodeNoiseNonce(nonce), ad, plaintext)
  }
}

export function createNativeChaChaDecryptor(native: NativeCipher | undefined): Decryptor | undefined {
  if (!native || typeof native.decrypt !== 'function') return undefined
  // Decide before connecting. Verify both valid decryption and AEAD tag rejection.
  try {
    if (!native.isAvailable()) return undefined
    const v = NATIVE_CHACHA_VECTOR
    const key = fromBase64Url(v.key)
    const nonce = fromBase64Url(v.nonce)
    const ad = fromBase64Url(v.ad)
    const ciphertext = fromBase64Url(v.expected)
    const actual = native.decrypt(key, nonce, ad, ciphertext)
    if (toBase64Url(actual) !== normalizeBase64Url(v.plaintext)) return undefined
    const tampered = Uint8Array.from(ciphertext)
    tampered[tampered.byteLength - 1]! ^= 0x01
    let rejected = false
    try {
      native.decrypt(key, nonce, ad, tampered)
    } catch {
      rejected = true
    }
    if (!rejected) return undefined
  } catch { return undefined }
  const nativeDecrypt = native.decrypt.bind(native)
  return (key, nonce, ad, ciphertext) => {
    if (ciphertext.byteLength < MIN_NATIVE_PLAINTEXT_BYTES + CHACHA_POLY_TAG_BYTES) return undefined
    // Once selected, errors propagate and close the secure transport; no fallback retry.
    return nativeDecrypt(key, encodeNoiseNonce(nonce), ad, ciphertext)
  }
}

let checkedEncryptor = false
let encryptor: Encryptor | undefined
export function nativeChaChaEncryptor(): Encryptor | undefined {
  if (!checkedEncryptor) {
    checkedEncryptor = true
    encryptor = createNativeChaChaEncryptor(requireOptionalNativeModule<NativeCipher>('RemoteChaChaPoly') ?? undefined)
  }
  return encryptor
}

let checkedDecryptor = false
let decryptor: Decryptor | undefined
export function nativeChaChaDecryptor(): Decryptor | undefined {
  if (!checkedDecryptor) {
    checkedDecryptor = true
    decryptor = createNativeChaChaDecryptor(requireOptionalNativeModule<NativeCipher>('RemoteChaChaPoly') ?? undefined)
  }
  return decryptor
}
