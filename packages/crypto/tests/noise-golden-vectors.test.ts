import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  NOISE_IK_PROTOCOL,
  NoiseIkSession,
  createNoisePrologue,
  fromBase64Url,
  generateKeyPair,
  toBase64Url,
} from '../src/index.js'

interface CounterVector {
  initiatorSending: string
  initiatorReceiving: string
  responderSending: string
  responderReceiving: string
}

interface MessageVector {
  sender: 'initiator' | 'responder'
  payload: string
  message: string
}

interface TransportVector {
  sender: 'initiator' | 'responder'
  plaintext: string
  ciphertext: string
  countersAfter: CounterVector
}

interface NoiseVector {
  name: string
  staticKeys: Record<'initiator' | 'responder', { privateKey: string; publicKey: string }>
  ephemeralPrivateKeys: Record<'initiator' | 'responder', string>
  prologue: {
    connectionId: string
    hostDeviceId: string
    clientDeviceId: string
    bytes: string
  }
  handshake: { message1: MessageVector; message2: MessageVector }
  countersAfterHandshake: CounterVector
  transport: TransportVector[]
}

interface NoiseVectorFile {
  fixtureFormat: string
  fixtureFormatVersion: number
  protocolVersion: number
  suite: string
  encoding: string
  vectors: NoiseVector[]
}

const vectorUrl = new URL('../../../fixtures/crypto/v1/noise-ik.json', import.meta.url)
const file = JSON.parse(await readFile(vectorUrl, 'utf8')) as NoiseVectorFile

describe('Noise IK v1 golden vectors', () => {
  it('uses the supported fixture format and protocol suite', () => {
    expect(file).toMatchObject({
      fixtureFormat: 'dsh-remote.noise-vectors',
      fixtureFormatVersion: 1,
      protocolVersion: 1,
      suite: NOISE_IK_PROTOCOL,
      encoding: 'base64url-no-padding',
    })
    expect(file.vectors.length).toBeGreaterThan(0)
  })

  it('adapts an ephemeral private key without fixing RNG read boundaries', () => {
    const value = file.vectors[0]?.ephemeralPrivateKeys.initiator
    if (value === undefined) throw new Error('Noise vector is missing an initiator ephemeral private key.')
    const expected = fromBase64Url(value)
    const random = ephemeralPrivateKeyRandom(value)

    expect(random.consumed()).toBe(false)
    const first = random.read(16)
    const second = random.read(expected.byteLength - first.byteLength)
    expect(Uint8Array.from([...first, ...second])).toEqual(expected)
    expect(random.consumed()).toBe(true)
    expect(() => random.read(1)).toThrow('exceeds ephemeral key')
  })

  it.each(file.vectors)('$name matches deterministic handshake and transport outputs', vector => {
    const initiatorRandom = ephemeralPrivateKeyRandom(vector.ephemeralPrivateKeys.initiator)
    const responderRandom = ephemeralPrivateKeyRandom(vector.ephemeralPrivateKeys.responder)
    const prologue = createNoisePrologue(
      vector.prologue.connectionId,
      vector.prologue.hostDeviceId,
      vector.prologue.clientDeviceId,
    )
    expect(toBase64Url(prologue)).toBe(vector.prologue.bytes)
    expectStaticKey(vector.staticKeys.initiator)
    expectStaticKey(vector.staticKeys.responder)

    const initiator = createSession('initiator', vector, prologue, initiatorRandom.read)
    const responder = createSession('responder', vector, prologue, responderRandom.read)

    expectHandshake('initiator', vector.handshake.message1, initiator, responder)
    expectHandshake('responder', vector.handshake.message2, responder, initiator)
    expect(initiator.complete).toBe(true)
    expect(responder.complete).toBe(true)
    expectCounters(initiator, responder, vector.countersAfterHandshake)
    expect(initiatorRandom.consumed()).toBe(true)
    expect(responderRandom.consumed()).toBe(true)

    for (const transport of vector.transport) {
      const source = transport.sender === 'initiator' ? initiator : responder
      const target = transport.sender === 'initiator' ? responder : initiator
      const plaintext = fromBase64Url(transport.plaintext)
      const ciphertext = source.encrypt(plaintext)
      expect(toBase64Url(ciphertext)).toBe(transport.ciphertext)
      expect(target.decrypt(ciphertext)).toEqual(plaintext)
      expectCounters(initiator, responder, transport.countersAfter)
    }
  })
})

function createSession(
  role: 'initiator' | 'responder',
  vector: NoiseVector,
  prologue: Uint8Array,
  random: (length: number) => Uint8Array,
): NoiseIkSession {
  const local = vector.staticKeys[role]
  const remote = vector.staticKeys[role === 'initiator' ? 'responder' : 'initiator']
  return new NoiseIkSession({
    role,
    localPrivateKey: local.privateKey,
    localPublicKey: local.publicKey,
    remotePublicKey: remote.publicKey,
    prologue,
    random,
  })
}

function expectHandshake(
  sender: MessageVector['sender'],
  message: MessageVector,
  source: NoiseIkSession,
  target: NoiseIkSession,
): void {
  expect(message.sender).toBe(sender)
  const payload = fromBase64Url(message.payload)
  const encoded = source.writeHandshake(payload)
  expect(toBase64Url(encoded)).toBe(message.message)
  expect(target.readHandshake(fromBase64Url(message.message))).toEqual(payload)
}

function expectStaticKey(key: { privateKey: string; publicKey: string }): void {
  expect(generateKeyPair(fromBase64Url(key.privateKey)).publicKey).toBe(key.publicKey)
}

function expectCounters(
  initiator: NoiseIkSession,
  responder: NoiseIkSession,
  expected: CounterVector,
): void {
  expect({
    initiatorSending: initiator.sendingCounter().toString(),
    initiatorReceiving: initiator.receivingCounter().toString(),
    responderSending: responder.sendingCounter().toString(),
    responderReceiving: responder.receivingCounter().toString(),
  }).toEqual(expected)
}

function ephemeralPrivateKeyRandom(value: string): {
  read: (length: number) => Uint8Array
  consumed: () => boolean
} {
  const key = fromBase64Url(value)
  let offset = 0
  return {
    read(length) {
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > key.byteLength) {
        throw new Error(`Noise vector RNG request exceeds ephemeral key: ${length}`)
      }
      const result = key.slice(offset, offset + length)
      offset += length
      return result
    },
    consumed: () => offset === key.byteLength,
  }
}
