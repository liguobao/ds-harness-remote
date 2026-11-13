import { requireOptionalNativeModule } from 'expo'
import { fromBase64Url, toBase64Url, type NoiseIkSessionOptions } from '@dsh-remote/crypto'

type NativeCipher = {
  isAvailable(): boolean
  encrypt(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plaintext: Uint8Array): Uint8Array
}
type Encryptor = NonNullable<NoiseIkSessionOptions['encryptChaChaPoly']>

/** Public cross-provider test vector generated with Node/OpenSSL, including a >2^53 nonce. */
export const NATIVE_CHACHA_VECTOR = {
  key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  nonce: 'AAAAAAEAAAAAACAA',
  ad: 'RFNIIG5hdGl2ZSBDaGFDaGFQb2x5IHNlbGYtdGVzdA==',
  plaintext: 'TmF0aXZlIHByb3ZpZGVyIGJ5dGUgY29tcGF0aWJpbGl0eQ==',
  expected: 'VhiMtTUfroGQG+Xjv1dXbT0r9RNYHK2HC1P9/4bNGrV7C9P/qCcrRRc+6l8wAQCKF3M=',
} as const

export function createNativeChaChaEncryptor(native: NativeCipher | undefined): Encryptor | undefined {
  if (!native || typeof native.encrypt !== 'function') return undefined
  // Decide before connecting. Unsupported/broken providers keep the standard implementation.
  try {
    if (!native.isAvailable()) return undefined
    const v = NATIVE_CHACHA_VECTOR
    const actual = native.encrypt(fromBase64Url(v.key), fromBase64Url(v.nonce), fromBase64Url(v.ad), fromBase64Url(v.plaintext))
    if (toBase64Url(actual) !== v.expected.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')) return undefined
  } catch { return undefined }
  return (key, nonce, ad, plaintext) => {
    if (plaintext.byteLength < 4096) return undefined
    const iv = new Uint8Array(12)
    new DataView(iv.buffer).setBigUint64(4, nonce, true)
    // Once selected, errors propagate and close the secure transport; no same-nonce retry.
    return native.encrypt(key, iv, ad, plaintext)
  }
}

let checked = false
let encryptor: Encryptor | undefined
export function nativeChaChaEncryptor(): Encryptor | undefined {
  if (!checked) {
    checked = true
    encryptor = createNativeChaChaEncryptor(requireOptionalNativeModule<NativeCipher>('RemoteChaChaPoly') ?? undefined)
  }
  return encryptor
}
