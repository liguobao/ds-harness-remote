import { chacha20poly1305 } from '@noble/ciphers/chacha'
import { randomBytes } from '@noble/ciphers/webcrypto'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'

export interface KeyPair {
  publicKey: string
  privateKey: string
}

export interface EncryptedFrame {
  nonce: string
  ciphertext: string
}

export function generateKeyPair(privateKeyBytes?: Uint8Array): KeyPair {
  const privateKey = privateKeyBytes ?? x25519.utils.randomPrivateKey()
  if (privateKey.byteLength !== 32) throw new Error('X25519 private keys must be 32 bytes')
  const publicKey = x25519.getPublicKey(privateKey)
  return {
    privateKey: toBase64Url(privateKey),
    publicKey: toBase64Url(publicKey),
  }
}

export function deriveSharedKey(privateKey: string, peerPublicKey: string, salt = 'dsh-remote-v1'): Uint8Array {
  const shared = x25519.getSharedSecret(fromBase64Url(privateKey), fromBase64Url(peerPublicKey))
  return hkdf(sha256, shared, new TextEncoder().encode(salt), new TextEncoder().encode('remote-channel'), 32)
}

export function encryptFrame(key: Uint8Array, plaintext: Uint8Array, aad = 'dsh-remote-v1'): EncryptedFrame {
  const nonce = randomBytes(12)
  const cipher = chacha20poly1305(key, nonce, new TextEncoder().encode(aad))
  return {
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(cipher.encrypt(plaintext)),
  }
}

export function decryptFrame(key: Uint8Array, frame: EncryptedFrame, aad = 'dsh-remote-v1'): Uint8Array {
  const cipher = chacha20poly1305(key, fromBase64Url(frame.nonce), new TextEncoder().encode(aad))
  return cipher.decrypt(fromBase64Url(frame.ciphertext))
}

export function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64')
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1
    || (value.length % 4 === 2 && !/[AQgw]$/u.test(value))
    || (value.length % 4 === 3 && !/[AEIMQUYcgkosw048]$/u.test(value))) {
    throw new Error('Invalid canonical Base64URL.')
  }
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  if (typeof atob === 'function') {
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0))
  }
  return new Uint8Array(Buffer.from(padded, 'base64'))
}

export function identityFingerprint(publicKey: string): string {
  return Array.from(sha256(fromBase64Url(publicKey)).slice(0, 6), byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export {
  NOISE_IK_PROTOCOL,
  NoiseIkSession,
  NoiseSessionError,
  createNoisePrologue,
} from './noise.js'
export type { NoiseIkSessionOptions } from './noise.js'
