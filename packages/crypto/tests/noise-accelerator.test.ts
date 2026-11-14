import { describe, expect, it, vi } from 'vitest'
import { chachaPoly } from '@lukeburns/clatterjs'
import { NoiseIkSession, generateKeyPair, type NoiseIkSessionOptions } from '../src/index.js'
function sessions(encryptChaChaPoly: NoiseIkSessionOptions['encryptChaChaPoly']) {
  const host = generateKeyPair(), client = generateKeyPair(), prologue = new Uint8Array([1, 2, 3])
  const source = new NoiseIkSession({ role: 'initiator', localPrivateKey: client.privateKey, localPublicKey: client.publicKey, remotePublicKey: host.publicKey, prologue, encryptChaChaPoly })
  const target = new NoiseIkSession({ role: 'responder', localPrivateKey: host.privateKey, localPublicKey: host.publicKey, remotePublicKey: client.publicKey, prologue })
  target.readHandshake(source.writeHandshake()); source.readHandshake(target.writeHandshake())
  return { source, target }
}
describe('optional Noise ChaChaPoly acceleration', () => {
  it('interoperates with an unchanged peer while Noise retains nonce ownership', () => {
    const accelerated = vi.fn((key, nonce, ad, plaintext) => {
      if (plaintext.length < 4096) return undefined
      const out = new Uint8Array(plaintext.length + 16)
      chachaPoly.encrypt(key, nonce, ad, plaintext, out)
      return out
    })
    const { source, target } = sessions(accelerated)
    for (const length of [1, 4096, 65519, 100]) {
      const plaintext = new Uint8Array(length).fill(length % 251)
      expect(target.decrypt(source.encrypt(plaintext))).toEqual(plaintext)
    }
    expect(source.sendingCounter()).toBe(4n)
    expect(target.receivingCounter()).toBe(4n)
    const frame = source.encrypt(new Uint8Array(8192)); frame[0]! ^= 1
    expect(() => target.decrypt(frame)).toThrow()
  })
  it('fails closed on invalid provider output or exceptions', () => {
    const wrong = sessions((_k, _n, _ad, plaintext) => plaintext.length < 4096 ? undefined : new Uint8Array(1))
    expect(() => wrong.source.encrypt(new Uint8Array(4096))).toThrow()
    expect(wrong.source.sendingCounter()).toBe(0n)
    const throws = sessions((_k, _n, _ad, plaintext) => {
      if (plaintext.length < 4096) return undefined
      throw new Error('provider failed')
    })
    expect(() => throws.source.encrypt(new Uint8Array(4096))).toThrow()
    expect(throws.source.sendingCounter()).toBe(0n)
  })
})
