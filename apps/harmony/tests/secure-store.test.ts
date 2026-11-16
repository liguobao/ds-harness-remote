/**
 * Failure-path conformance for `SecureStore` (review: secret migration / degraded asset store).
 *
 * The ArkTS sources cannot be imported by Node, so esbuild bundles `SecureStore.ets` with every
 * `@kit.*` module replaced by the in-memory stub below. Everything under test — the migration
 * ordering, the write-then-verify step, the refusal to degnade to plaintext — is the real code.
 */
import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const stubPath = join(here, '.secure-store-kit-stub.ts')
const bundlePath = join(here, '.secure-store-bundle.mjs')

const stubSource = `
export const assetState = {
  failAdd: false,
  failAddsLeft: 0,
  rows: new Map<string, string>()
}
const decode = (value: any): string => new TextDecoder().decode(value)
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

export const asset = {
  Tag: { ALIAS: 'ALIAS', SECRET: 'SECRET', ACCESSIBILITY: 'ACCESSIBILITY', SYNC_TYPE: 'SYNC_TYPE', RETURN_TYPE: 'RETURN_TYPE' },
  Accessibility: { DEVICE_UNLOCKED: 'DEVICE_UNLOCKED' },
  SyncType: { NEVER: 'NEVER' },
  ReturnType: { ALL: 'ALL' },
  async add(attrs: Map<string, any>) {
    if (assetState.failAdd || assetState.failAddsLeft > 0) {
      if (assetState.failAddsLeft > 0) assetState.failAddsLeft -= 1
      const error: any = new Error('asset add failed')
      error.code = 24000003
      throw error
    }
    assetState.rows.set(decode(attrs.get('ALIAS')), decode(attrs.get('SECRET')))
  },
  async query(query: Map<string, any>) {
    const alias = decode(query.get('ALIAS'))
    if (!assetState.rows.has(alias)) {
      const error: any = new Error('not found')
      error.code = 24000002
      throw error
    }
    const row = new Map<string, any>()
    row.set('SECRET', utf8(assetState.rows.get(alias) as string))
    return [row]
  },
  async remove(query: Map<string, any>) {
    const alias = decode(query.get('ALIAS'))
    if (!assetState.rows.has(alias)) {
      const error: any = new Error('not found')
      error.code = 24000002
      throw error
    }
    assetState.rows.delete(alias)
  }
}

export const preferenceRows = new Map<string, Map<string, any>>()
export const preferences = {
  async getPreferences(_context: any, options: { name: string }) {
    if (!preferenceRows.has(options.name)) preferenceRows.set(options.name, new Map())
    const rows = preferenceRows.get(options.name) as Map<string, any>
    return {
      getSync: (key: string, fallback: any) => (rows.has(key) ? rows.get(key) : fallback),
      putSync: (key: string, value: any) => { rows.set(key, value) },
      deleteSync: (key: string) => { rows.delete(key) },
      put: async (key: string, value: any) => { rows.set(key, value) },
      flush: async () => undefined
    }
  }
}

export const common = {}
export const util = {
  TextEncoder: class {
    encodeInto(text: string): Uint8Array { return utf8(text) }
  },
  TextDecoder: {
    create: (_charset: string) => ({ decodeToString: (bytes: Uint8Array) => new TextDecoder().decode(bytes) })
  }
}
export const hilog = { info: () => undefined, warn: () => undefined, error: () => undefined }
export const cryptoFramework = {
  createRandom: () => ({
    generateRandomSync: (len: number) => ({ data: new Uint8Array(len).map((_, i) => (i * 7 + 13) & 0xff) })
  })
}
`

interface StoreModule {
  SecureStore: new () => {
    init(context: any): Promise<void>
    loadIdentity(): Promise<{ privateKey: string } | undefined>
    saveIdentity(identity: object): Promise<void>
    saveCredentials(pair: object): Promise<void>
  }
  SecureStorageUnavailableError: new (...args: any[]) => Error
  assetState: { failAdd: boolean; failAddsLeft: number; rows: Map<string, string> }
  preferenceRows: Map<string, Map<string, any>>
}

const KEY_IDENTITY = 'dshremote.identity.v1'
const KEY_CREDENTIALS = 'dshremote.credentials.v1'
const identity = {
  deviceId: '01a1c0e0-0000-7000-8000-000000000001',
  name: 'review-device',
  platform: 'harmonyos',
  privateKey: 'PRIVATE-KEY-MATERIAL',
  publicKey: 'PUBLIC-KEY-MATERIAL'
}

let mod!: StoreModule

beforeAll(async () => {
  writeFileSync(stubPath, stubSource, 'utf8')
  const entry = `
export { SecureStore, SecureStorageUnavailableError } from ${JSON.stringify(join(etsRoot, 'services', 'SecureStore.ets'))}
export { assetState, preferenceRows } from ${JSON.stringify(stubPath)}
`
  const entryPath = join(here, '.secure-store-entry.ts')
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
            pluginBuild.onResolve({ filter: /^@kit\./ }, () => ({ path: stubPath }))
          }
        }
      ]
    })
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  } finally {
    rmSync(entryPath, { force: true })
  }
  mod = (await import(`file://${bundlePath}`)) as StoreModule
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
  rmSync(stubPath, { force: true })
})

function prefs(): Map<string, any> {
  return mod.preferenceRows.get('dshremote.store') as Map<string, any>
}

beforeEach(() => {
  mod.assetState.rows.clear()
  mod.assetState.failAdd = false
  mod.assetState.failAddsLeft = 0
  mod.preferenceRows.clear()
})

describe('legacy private key migration', () => {
  it('keeps the plaintext record when the secure write fails', async () => {
    const seed = new mod.SecureStore()
    await seed.init({})
    prefs().set(KEY_IDENTITY, JSON.stringify(identity))
    mod.assetState.failAddsLeft = 99

    const store = new mod.SecureStore()
    await store.init({})
    const loaded = await store.loadIdentity()

    expect(loaded?.privateKey).toBe(identity.privateKey)
    // The regression: the old record must still carry the key, otherwise a failed write
    // would have deleted the last copy of the device private key.
    expect(prefs().get(KEY_IDENTITY)).toContain(identity.privateKey)
  })

  it('strips the plaintext key only after a verified write', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    prefs().set(KEY_IDENTITY, JSON.stringify(identity))

    await store.loadIdentity()

    expect(mod.assetState.rows.get('dshremote.identity.' + identity.deviceId)).toBe(identity.privateKey)
    expect(prefs().get(KEY_IDENTITY)).not.toContain(identity.privateKey)
  })
})

describe('degraded asset store', () => {
  it('refuses to persist an identity private key as plaintext', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    mod.assetState.failAddsLeft = 99

    await expect(store.saveIdentity({ ...identity })).rejects.toBeInstanceOf(mod.SecureStorageUnavailableError)
    expect(prefs().get(KEY_IDENTITY) ?? '').not.toContain(identity.privateKey)
  })

  it('refuses to persist account tokens as plaintext', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    mod.assetState.failAddsLeft = 99

    await expect(store.saveCredentials({
      accessToken: 'access',
      accessTokenExpiresAt: 1,
      refreshToken: 'refresh-secret',
      refreshTokenExpiresAt: 2
    })).rejects.toBeInstanceOf(mod.SecureStorageUnavailableError)
    expect(prefs().get(KEY_CREDENTIALS) ?? '').not.toContain('refresh-secret')
  })

  it('restores the previous credentials when overwriting fails', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    await store.saveCredentials({
      accessToken: 'old-access',
      accessTokenExpiresAt: 1,
      refreshToken: 'old-refresh',
      refreshTokenExpiresAt: 2
    })
    const before = mod.assetState.rows.get(KEY_CREDENTIALS)

    mod.assetState.failAddsLeft = 1
    await expect(store.saveCredentials({
      accessToken: 'new-access',
      accessTokenExpiresAt: 3,
      refreshToken: 'new-refresh',
      refreshTokenExpiresAt: 4
    })).rejects.toBeInstanceOf(mod.SecureStorageUnavailableError)

    expect(mod.assetState.rows.get(KEY_CREDENTIALS)).toBe(before)
    expect(before).toContain('old-refresh')
  })
})
