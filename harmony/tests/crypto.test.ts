/**
 * Conformance tests for the hand-written ArkTS Noise IK implementation.
 *
 * The reviewer asked for the repository's own golden vectors to run against this client.
 * The ETS sources cannot be imported by Node directly, so esbuild transpiles them on the
 * fly with `@kit.CryptoArchitectureKit` replaced by a deterministic stub. Everything else
 * (X25519, ChaCha20-Poly1305, SHA-256, HKDF, the state machine) is the real code that ships
 * in the HAP.
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const bundlePath = join(here, '.crypto-bundle.mjs')
const fixturePath = join(here, '..', '..', '..', 'fixtures', 'crypto', 'v1', 'noise-ik.json')

interface CryptoModule {
  NoiseIkInitiator: new (
    localPrivate: Uint8Array,
    localPublic: Uint8Array,
    remotePublic: Uint8Array,
    prologue: Uint8Array,
    random: (n: number) => Uint8Array
  ) => {
    writeHandshake(payload: Uint8Array): Uint8Array
    readHandshake(message: Uint8Array): Uint8Array
    encrypt(plaintext: Uint8Array): Uint8Array
    decrypt(ciphertext: Uint8Array): Uint8Array
    isComplete(): boolean
  }
  fromBase64Url(value: string): Uint8Array
  toBase64Url(bytes: Uint8Array): string
  bytesToHex(bytes: Uint8Array): string
  x25519Public(secret: Uint8Array): Uint8Array
}

interface Vector {
  staticKeys: {
    initiator: { privateKey: string; publicKey: string }
    responder: { privateKey: string; publicKey: string }
  }
  ephemeralPrivateKeys: { initiator: string; responder: string }
  prologue: { bytes: string }
  handshake: {
    message1: { payload: string; message: string }
    message2: { payload: string; message: string }
  }
  transport: Array<{ sender: string; plaintext: string; ciphertext: string }>
}

const kitStub = `
export const cryptoFramework = {
  createRandom: () => ({
    generateRandomSync: (len: number) => ({
      data: new Uint8Array(len).map((_, i) => (i * 7 + 13) & 0xff)
    })
  })
}
`

let crypto!: CryptoModule
let vector!: Vector

beforeAll(async () => {
  const entry = `
export { NoiseIkInitiator } from ${JSON.stringify(join(etsRoot, 'crypto', 'NoiseIk.ets'))}
export { fromBase64Url, toBase64Url, bytesToHex } from ${JSON.stringify(join(etsRoot, 'crypto', 'Bytes.ets'))}
export { x25519Public } from ${JSON.stringify(join(etsRoot, 'crypto', 'X25519.ets'))}
`
  const entryPath = join(here, '.crypto-entry.ts')
  writeFileSync(entryPath, entry, 'utf8')
  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'neutral',
      loader: { '.ets': 'ts' },
      resolveExtensions: ['.ets', '.ts', '.js'],
      plugins: [
        {
          name: 'kit-stub',
          setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /^@kit\./ }, () => ({ path: 'kit', namespace: 'kit-stub' }))
            pluginBuild.onLoad({ filter: /.*/, namespace: 'kit-stub' }, () => ({
              contents: kitStub,
              loader: 'ts'
            }))
          }
        }
      ]
    })
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  } finally {
    rmSync(entryPath, { force: true })
  }
  crypto = (await import(`file://${bundlePath}`)) as CryptoModule
  vector = (JSON.parse(readFileSync(fixturePath, 'utf8')) as { vectors: Vector[] }).vectors[0]
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

function makeInitiator() {
  const random = (n: number): Uint8Array => {
    const key = crypto.fromBase64Url(vector.ephemeralPrivateKeys.initiator)
    return key.slice(0, n)
  }
  return new crypto.NoiseIkInitiator(
    crypto.fromBase64Url(vector.staticKeys.initiator.privateKey),
    crypto.fromBase64Url(vector.staticKeys.initiator.publicKey),
    crypto.fromBase64Url(vector.staticKeys.responder.publicKey),
    crypto.fromBase64Url(vector.prologue.bytes),
    random
  )
}

describe('Noise IK v1 golden vectors', () => {
  it('derives the fixture public key from the fixture private key', () => {
    const derived = crypto.x25519Public(crypto.fromBase64Url(vector.staticKeys.initiator.privateKey))
    expect(crypto.toBase64Url(derived)).toBe(vector.staticKeys.initiator.publicKey)
  })

  it('handshake message 1 matches the golden bytes', () => {
    const initiator = makeInitiator()
    const message1 = initiator.writeHandshake(crypto.fromBase64Url(vector.handshake.message1.payload))
    expect(crypto.bytesToHex(message1)).toBe(
      crypto.bytesToHex(crypto.fromBase64Url(vector.handshake.message1.message))
    )
  })

  it('handshake message 2 decrypts to the golden payload', () => {
    const initiator = makeInitiator()
    initiator.writeHandshake(crypto.fromBase64Url(vector.handshake.message1.payload))
    const payload = initiator.readHandshake(crypto.fromBase64Url(vector.handshake.message2.message))
    expect(crypto.toBase64Url(payload)).toBe(vector.handshake.message2.payload)
    expect(initiator.isComplete()).toBe(true)
  })

  it('transport frames match the golden ciphertext in both directions', () => {
    const initiator = makeInitiator()
    initiator.writeHandshake(crypto.fromBase64Url(vector.handshake.message1.payload))
    initiator.readHandshake(crypto.fromBase64Url(vector.handshake.message2.message))
    for (const frame of vector.transport) {
      if (frame.sender === 'initiator') {
        const sealed = initiator.encrypt(crypto.fromBase64Url(frame.plaintext))
        expect(crypto.toBase64Url(sealed)).toBe(frame.ciphertext)
      } else {
        const opened = initiator.decrypt(crypto.fromBase64Url(frame.ciphertext))
        expect(crypto.toBase64Url(opened)).toBe(frame.plaintext)
      }
    }
  })

  it('rejects a tampered transport frame', () => {
    const initiator = makeInitiator()
    initiator.writeHandshake(crypto.fromBase64Url(vector.handshake.message1.payload))
    initiator.readHandshake(crypto.fromBase64Url(vector.handshake.message2.message))
    const frame = vector.transport.find((entry) => entry.sender === 'responder')
    expect(frame).toBeDefined()
    const ciphertext = crypto.fromBase64Url(frame!.ciphertext)
    ciphertext[ciphertext.length - 1] ^= 0xff
    expect(() => initiator.decrypt(ciphertext)).toThrow()
  })
})
