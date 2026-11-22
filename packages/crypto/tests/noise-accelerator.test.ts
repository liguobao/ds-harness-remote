import { describe, expect, it, vi } from 'vitest'
import { chachaPoly } from '@lukeburns/clatterjs'
import { NoiseIkSession, generateKeyPair, type NoiseIkSessionOptions } from '../src/index.js'
function sessions(options: Pick<NoiseIkSessionOptions, 'encryptChaChaPoly' | 'decryptChaChaPoly'>) {
  const host = generateKeyPair(), client = generateKeyPair(), prologue = new Uint8Array([1, 2, 3])
  const source = new NoiseIkSession({ role: 'initiator', localPrivateKey: client.privateKey, localPublicKey: client.publicKey, remotePublicKey: host.publicKey, prologue, ...options })
  const target = new NoiseIkSession({ role: 'responder', localPrivateKey: host.privateKey, localPublicKey: host.publicKey, remotePublicKey: client.publicKey, prologue })
  target.readHandshake(source.writeHandshake()); source.readHandshake(target.writeHandshake())
  return { source, target }
}
describe('optional Noise ChaChaPoly acceleration', () => {
  it('interoperates with an unchanged peer while Noise retains nonce ownership', () => {
    const acceleratedEncrypt = vi.fn((key, nonce, ad, plaintext) => {
      if (plaintext.length < 4096) return undefined
      const out = new Uint8Array(plaintext.length + 16)
      chachaPoly.encrypt(key, nonce, ad, plaintext, out)
      return out
    })
    const acceleratedDecrypt = vi.fn((key, nonce, ad, ciphertext) => {
      if (ciphertext.length < 4096 + 16) return undefined
      const out = new Uint8Array(ciphertext.length - 16)
      chachaPoly.decrypt(key, nonce, ad, ciphertext, out)
      return out
    })
    const { source, target } = sessions({ encryptChaChaPoly: acceleratedEncrypt, decryptChaChaPoly: acceleratedDecrypt })
    acceleratedEncrypt.mockClear()
    acceleratedDecrypt.mockClear()
    for (const length of [1, 4096, 65519, 100]) {
      const plaintext = new Uint8Array(length).fill(length % 251)
      expect(target.decrypt(source.encrypt(plaintext))).toEqual(plaintext)
      expect(source.decrypt(target.encrypt(plaintext))).toEqual(plaintext)
    }
    expect(source.sendingCounter()).toBe(4n)
    expect(target.receivingCounter()).toBe(4n)
    expect(target.sendingCounter()).toBe(4n)
    expect(source.receivingCounter()).toBe(4n)
    expect(acceleratedEncrypt).toHaveBeenCalledTimes(4)
    expect(acceleratedDecrypt).toHaveBeenCalledTimes(4)
    const outboundFrame = source.encrypt(new Uint8Array(8192)); outboundFrame[0]! ^= 1
    expect(() => target.decrypt(outboundFrame)).toThrow()
    const inboundFrame = target.encrypt(new Uint8Array(8192)); inboundFrame[inboundFrame.length - 1]! ^= 1
    expect(() => source.decrypt(inboundFrame)).toThrow()
    expect(source.receivingCounter()).toBe(4n)
  })
  it('fails closed on invalid provider output or exceptions', () => {
    const wrongEncrypt = sessions({ encryptChaChaPoly: (_k, _n, _ad, plaintext) => plaintext.length < 4096 ? undefined : new Uint8Array(1) })
    expect(() => wrongEncrypt.source.encrypt(new Uint8Array(4096))).toThrow()
    expect(wrongEncrypt.source.sendingCounter()).toBe(0n)
    const throwsEncrypt = sessions({
      encryptChaChaPoly: (_k, _n, _ad, plaintext) => {
        if (plaintext.length < 4096) return undefined
        throw new Error('provider failed')
      },
    })
    expect(() => throwsEncrypt.source.encrypt(new Uint8Array(4096))).toThrow()
    expect(throwsEncrypt.source.sendingCounter()).toBe(0n)

    const wrongDecrypt = sessions({ decryptChaChaPoly: (_k, _n, _ad, ciphertext) => ciphertext.length < 4096 + 16 ? undefined : new Uint8Array(1) })
    const validFrame = wrongDecrypt.target.encrypt(new Uint8Array(4096))
    expect(() => wrongDecrypt.source.decrypt(validFrame)).toThrow()
    expect(wrongDecrypt.source.receivingCounter()).toBe(0n)

    const throwsDecrypt = sessions({
      decryptChaChaPoly: (_k, _n, _ad, ciphertext) => {
        if (ciphertext.length < 4096 + 16) return undefined
        throw new Error('decrypt provider failed')
      },
    })
    const validFrame2 = throwsDecrypt.target.encrypt(new Uint8Array(4096))
    expect(() => throwsDecrypt.source.decrypt(validFrame2)).toThrow()
    expect(throwsDecrypt.source.receivingCounter()).toBe(0n)
  })
})
