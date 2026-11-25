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
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const stubPath = join(here, '.secure-store-kit-stub.ts')
const bundlePath = join(here, '.secure-store-bundle.mjs')

const stubSource = `
export const assetState = {
  failAdd: false,
  failRemoveAlias: "",
  failAddsLeft: 0,
  rows: new Map<string, string>()
}
const decode = (value: any): string => new TextDecoder().decode(value)
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

export const asset = {
  Tag: { ALIAS: 'ALIAS', SECRET: 'SECRET', ACCESSIBILITY: 'ACCESSIBILITY', SYNC_TYPE: 'SYNC_TYPE', CONFLICT_RESOLUTION: 'CONFLICT_RESOLUTION', RETURN_TYPE: 'RETURN_TYPE' },
  Accessibility: { DEVICE_UNLOCKED: 'DEVICE_UNLOCKED' },
  SyncType: { NEVER: 'NEVER' },
  ReturnType: { ALL: 'ALL' },
  ConflictResolution: { OVERWRITE: 'OVERWRITE' },
  async add(attrs: Map<string, any>) {
    if (assetState.failAdd || assetState.failAddsLeft > 0) {
      if (assetState.failAddsLeft > 0) assetState.failAddsLeft -= 1
      const error: any = new Error('asset add failed')
      error.code = 24000003
      throw error
    }
    const alias = decode(attrs.get('ALIAS'))
    if (assetState.rows.has(alias) && attrs.get('CONFLICT_RESOLUTION') !== 'OVERWRITE') {
      throw Object.assign(new Error('already exists'), { code: 24000003 })
    }
    assetState.rows.set(alias, decode(attrs.get('SECRET')))
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
    if (alias === assetState.failRemoveAlias) throw Object.assign(new Error('locked'), { code: 24000005 })
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

// These kit APIs are outside the account-switch paths exercised by this test.
export const fileIo = {}, http = {}, bundleManager = {}, i18n = {}, notificationManager = {},
  connection = {}, webSocket = {}, webview = {}, url = {}, backgroundTaskManager = {}, wantAgent = {}
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
    loadCredentials(config?: typeof activeConfig): Promise<typeof pair | undefined>
    saveCredentials(pair: object, config: typeof activeConfig): Promise<void>
    clearCredentials(): Promise<void>
    resetIdentity(): Promise<void>
    saveConfig(config: typeof activeConfig): Promise<void>
    loadConfig(): Promise<typeof activeConfig | undefined>
  }
  AppRuntime: new () => {
    store: InstanceType<StoreModule['SecureStore']>
    serverUrl: string
    config: typeof activeConfig
    credentials: typeof pair | undefined
    identity: typeof identity
    readAccountMembership(): Promise<unknown>
    errorMsg: string
    qrUrl: string
    startQrLogin(baseUrl: string): Promise<void>
    selectServer(baseUrl: string): Promise<string | undefined>
  }
  RemoteServerApi: { prototype: {
    health(): Promise<void>
    oauthProviders(): Promise<unknown[]>
    refreshToken(): Promise<typeof pair>
    startQrLogin(): Promise<{ qrId: string; scanUrl: string; expiresIn: number }>
  } }
  SecureStorageUnavailableError: new (...args: any[]) => Error
  assetState: { failAdd: boolean; failRemoveAlias: string; failAddsLeft: number; rows: Map<string, string> }
  preferenceRows: Map<string, Map<string, any>>
}

const KEY_IDENTITY = 'dshremote.identity.v1'
const KEY_CREDENTIALS = 'dshremote.credentials.v1'
const LEGACY_PROFILES = 'dshremote.hostPins.v1.profiles'
const activeConfig = { baseUrl: 'https://host.test/remote', email: 'alice@example.test' }
const pair = { accessToken: 'active-access', accessTokenExpiresAt: 1, refreshToken: 'active-refresh', refreshTokenExpiresAt: 2 }
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
export { AppRuntime } from ${JSON.stringify(join(etsRoot, 'services', 'AppRuntime.ets'))}
export { RemoteServerApi } from ${JSON.stringify(join(etsRoot, 'net', 'ServerApi.ets'))}
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
  mod.assetState.failRemoveAlias = ''
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
    }, activeConfig)).rejects.toBeInstanceOf(mod.SecureStorageUnavailableError)
    expect(prefs().get(KEY_CREDENTIALS) ?? '').not.toContain('refresh-secret')
  })

  it('preserves the previous credentials when overwriting fails', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    await store.saveCredentials({
      accessToken: 'old-access',
      accessTokenExpiresAt: 1,
      refreshToken: 'old-refresh',
      refreshTokenExpiresAt: 2
    }, activeConfig)
    const before = mod.assetState.rows.get(KEY_CREDENTIALS)

    mod.assetState.failAddsLeft = 1
    await expect(store.saveCredentials({
      accessToken: 'new-access',
      accessTokenExpiresAt: 3,
      refreshToken: 'new-refresh',
      refreshTokenExpiresAt: 4
    }, activeConfig)).rejects.toBeInstanceOf(mod.SecureStorageUnavailableError)

    expect(mod.assetState.rows.get(KEY_CREDENTIALS)).toBe(before)
    expect(before).toContain('old-refresh')
  })
})

describe('account credential scope and legacy profile cleanup', () => {
  it.each(['asset', 'preferences'])('migrates the active %s pair and removes every retired account', async (source) => {
    const seed = new mod.SecureStore()
    await seed.init({})
    await seed.saveConfig(activeConfig)
    const rows = source === 'asset' ? mod.assetState.rows : prefs()
    rows.set(KEY_CREDENTIALS, JSON.stringify(pair))
    prefs().set(LEGACY_PROFILES, JSON.stringify([
      { ...activeConfig, ...pair },
      { ...activeConfig, email: 'other@example.test', accessToken: 'other-access', refreshToken: 'other-refresh' },
    ]))

    const store = new mod.SecureStore()
    await store.init({})
    await store.init({})
    expect(await store.loadCredentials(activeConfig)).toEqual(pair)
    expect(await store.loadCredentials()).toBeUndefined()
    expect(await store.loadCredentials({ ...activeConfig, baseUrl: 'https://host.test/other' })).toBeUndefined()
    expect(await store.loadCredentials({ ...activeConfig, email: 'other@example.test' })).toBeUndefined()
    expect(prefs().has(LEGACY_PROFILES)).toBe(false)
    expect(prefs().has(KEY_CREDENTIALS)).toBe(false)
  })

  it('scrubs profile plaintext even if upgrading the active pair has to wait for Asset Store', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    await store.saveConfig(activeConfig)
    mod.assetState.rows.set(KEY_CREDENTIALS, JSON.stringify(pair))
    prefs().set(LEGACY_PROFILES, JSON.stringify([{ ...activeConfig, ...pair }]))
    mod.assetState.failAddsLeft = 1
    await expect(store.init({})).rejects.toBeInstanceOf(mod.SecureStorageUnavailableError)
    expect(JSON.stringify([...prefs()])).not.toContain(pair.accessToken)
    expect(JSON.stringify([...prefs()])).not.toContain(pair.refreshToken)
    const restarted = new mod.SecureStore()
    await restarted.init({})
    expect(await restarted.loadCredentials(activeConfig)).toEqual(pair)
    expect(prefs().has('dshremote.legacyProfileOwners')).toBe(false)
  })

  it.each([false, true])('resolves rotated legacy tokens only for an unambiguous owner (multi-account %s)', async (multiple) => {
    const store = new mod.SecureStore()
    await store.init({})
    await store.saveConfig(activeConfig)
    const rotated = { ...pair, accessToken: 'rotated-access', refreshToken: 'rotated-refresh' }
    mod.assetState.rows.set(KEY_CREDENTIALS, JSON.stringify(rotated))
    const profiles = [{ ...activeConfig, ...pair }]
    if (multiple) profiles.push({ ...activeConfig, ...pair, email: 'other@example.test' })
    prefs().set(LEGACY_PROFILES, JSON.stringify(profiles))
    await store.init({})
    expect(await store.loadCredentials(activeConfig)).toEqual(multiple ? undefined : rotated)
    expect(prefs().has(LEGACY_PROFILES)).toBe(false)
  })

  it('drops conflicting legacy credentials left by an interrupted profile switch', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    await store.saveConfig(activeConfig)
    mod.assetState.rows.set(KEY_CREDENTIALS, JSON.stringify(pair))
    prefs().set(LEGACY_PROFILES, JSON.stringify([{ ...activeConfig, baseUrl: 'https://old.test', ...pair }]))
    await store.init({})
    expect(await store.loadCredentials(activeConfig)).toBeUndefined()
    expect(mod.assetState.rows.has(KEY_CREDENTIALS)).toBe(false)
    expect(prefs().has(LEGACY_PROFILES)).toBe(false)
  })

  it('retains the old server on a failed credential deletion and permits a clean retry', async () => {
    const runtime = new mod.AppRuntime()
    const store = runtime.store
    await store.init({})
    await store.saveConfig(activeConfig)
    await store.saveCredentials(pair, activeConfig)
    runtime.serverUrl = activeConfig.baseUrl
    vi.spyOn(mod.RemoteServerApi.prototype, 'health').mockResolvedValue(undefined)
    vi.spyOn(mod.RemoteServerApi.prototype, 'oauthProviders').mockResolvedValue([])
    try {
      const next = 'https://new.test'
      mod.assetState.failRemoveAlias = KEY_CREDENTIALS
      expect(await runtime.selectServer(next)).toBeUndefined()
      expect(runtime.errorMsg).toContain('安全存储')
      expect(runtime.serverUrl).toBe(activeConfig.baseUrl)
      const restarted = new mod.SecureStore()
      await restarted.init({})
      expect(await restarted.loadConfig()).toEqual(activeConfig)
      expect(await restarted.loadCredentials(activeConfig)).toEqual(pair)

      mod.assetState.failRemoveAlias = ''
      expect(await runtime.selectServer(next)).toBe(next)
      await restarted.init({})
      expect(await restarted.loadConfig()).toEqual({ baseUrl: next, email: '' })
      expect(await restarted.loadCredentials(await restarted.loadConfig())).toBeUndefined()
      expect(mod.assetState.rows.has(KEY_CREDENTIALS)).toBe(false)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('ignores a QR login invitation returned by the previous server after switching', async () => {
    const runtime = new mod.AppRuntime()
    await runtime.store.init({})
    runtime.serverUrl = activeConfig.baseUrl
    const invitation = Promise.withResolvers<{ qrId: string; scanUrl: string; expiresIn: number }>()
    vi.spyOn(mod.RemoteServerApi.prototype, 'startQrLogin').mockReturnValue(invitation.promise)
    vi.spyOn(mod.RemoteServerApi.prototype, 'health').mockResolvedValue(undefined)
    vi.spyOn(mod.RemoteServerApi.prototype, 'oauthProviders').mockResolvedValue([])
    try {
      const pending = runtime.startQrLogin(activeConfig.baseUrl)
      expect(await runtime.selectServer('https://new.test')).toBe('https://new.test')
      invitation.resolve({ qrId: 'old', scanUrl: 'https://old.test/login', expiresIn: 60 })
      await pending
      expect(runtime.qrUrl).toBe('')
      expect(runtime.serverUrl).toBe('https://new.test')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('discards a refresh response that arrives after a server switch', async () => {
    const runtime = new mod.AppRuntime()
    const store = runtime.store
    await store.init({})
    await store.saveConfig(activeConfig)
    runtime.config = activeConfig
    runtime.serverUrl = activeConfig.baseUrl
    runtime.identity = identity
    runtime.credentials = { ...pair, refreshTokenExpiresAt: Date.now() + 3_600_000 }
    await store.saveCredentials(runtime.credentials, activeConfig)
    const rotated = Promise.withResolvers<typeof pair>()
    vi.spyOn(mod.RemoteServerApi.prototype, 'refreshToken').mockReturnValue(rotated.promise)
    vi.spyOn(mod.RemoteServerApi.prototype, 'health').mockResolvedValue(undefined)
    vi.spyOn(mod.RemoteServerApi.prototype, 'oauthProviders').mockResolvedValue([])
    try {
      const pending = runtime.readAccountMembership()
      expect(mod.RemoteServerApi.prototype.refreshToken).toHaveBeenCalledOnce()
      expect(await runtime.selectServer('https://new.test')).toBe('https://new.test')
      rotated.resolve({ ...pair, accessToken: 'rotated' })
      await expect(pending).rejects.toThrow('Account changed')
      expect(runtime.credentials).toBeUndefined()
      expect(mod.assetState.rows.has(KEY_CREDENTIALS)).toBe(false)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('rejects a scoped pair after an interrupted login changes only one side of the commit', async () => {
    const store = new mod.SecureStore()
    await store.init({})
    await store.saveConfig(activeConfig)
    await store.saveCredentials(pair, { ...activeConfig, baseUrl: 'https://new.test' })
    const restarted = new mod.SecureStore()
    await restarted.init({})
    expect(await restarted.loadCredentials(await restarted.loadConfig())).toBeUndefined()
  })

  it.each(['clearCredentials', 'resetIdentity'] as const)('purges all legacy profile tokens during %s', async (method) => {
    const store = new mod.SecureStore()
    await store.init({})
    await store.saveCredentials(pair, activeConfig)
    prefs().set(KEY_CREDENTIALS, JSON.stringify(pair))
    prefs().set(LEGACY_PROFILES, JSON.stringify([{ ...activeConfig, ...pair }]))
    await store[method]()
    expect(prefs().has(KEY_CREDENTIALS)).toBe(false)
    expect(prefs().has(LEGACY_PROFILES)).toBe(false)
    expect(await store.loadCredentials(activeConfig)).toBeUndefined()
  })
})
