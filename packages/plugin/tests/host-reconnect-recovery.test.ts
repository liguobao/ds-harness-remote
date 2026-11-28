import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemotePluginOptions } from '../src/client/settings.js'
import type { ClientReact, PluginSettingsView, RemoteStatus } from '../src/client/types.js'
import type { ClientModeRuntime, HostAuthorizationControl, HostConnectionHandle } from '../src/client-runtime.js'
import { resolveConfig, type Config } from '../src/config.js'
import type { ControlResult } from '../src/control-result.js'
import { CONTROL_RPC_PREFIX } from '../src/control-route.js'
import { PluginControlRuntime, type PluginSettingsBinding } from '../src/control-runtime.js'
import { IdentityStore } from '../src/identity-store.js'
import { HostServerApi } from '../src/server-api.js'
import { ServerCredentialStore } from '../src/server-credentials.js'

const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-host-recovery-'))
  directories.push(directory)
  return directory
}

describe('HostServerApi startup authorization hydration', () => {
  it('restores stored authorization during loadStoredPolicy and preserves it when refresh fails', async () => {
    const directory = await temporaryDirectory()
    const identity = await new IdentityStore({ directory, role: 'host' }).loadOrCreate('test-host')
    const store = new ServerCredentialStore(directory)
    await store.save({
      serverUrl: 'https://dsh.r2049.cn',
      deviceId: identity.deviceId,
      authorizationMethod: 'account',
      account: 'host@example.com',
      accessToken: 'expired-access-token-value',
      accessTokenExpiresAt: 1,
      refreshToken: 'valid-refresh-token-value',
      refreshTokenExpiresAt: Date.now() + 3_600_000,
    })

    const offlineFetch = vi.fn<typeof fetch>(async () => {
      throw new Error('network down')
    })
    const api = new HostServerApi('https://dsh.r2049.cn', store, offlineFetch, 'host')
    api.bindIdentity(identity)
    await api.loadStoredPolicy()

    expect(api.currentAuthorization()).toEqual({
      method: 'account',
      account: 'host@example.com',
    })

    await expect(api.authenticate(identity)).rejects.toMatchObject({ code: 'CONNECTION_FAILED' })
    expect(api.currentAuthorization()).toEqual({
      method: 'account',
      account: 'host@example.com',
    })
  })

  it('does not hydrate credentials whose refresh token has already expired', async () => {
    const directory = await temporaryDirectory()
    const identity = await new IdentityStore({ directory, role: 'host' }).loadOrCreate('test-host')
    const store = new ServerCredentialStore(directory)
    await store.save({
      serverUrl: 'https://dsh.r2049.cn',
      deviceId: identity.deviceId,
      authorizationMethod: 'account',
      account: 'expired@example.com',
      accessToken: 'expired-access-token-value',
      accessTokenExpiresAt: 1,
      refreshToken: 'expired-refresh-token-value',
      refreshTokenExpiresAt: 1,
    })

    const api = new HostServerApi('https://dsh.r2049.cn', store, fetch, 'host')
    api.bindIdentity(identity)
    await api.loadStoredPolicy()

    expect(api.currentAuthorization()).toBeUndefined()
  })
})

describe('PluginControlRuntime host.reconnect recovery', () => {
  it('restores persisted hostControl when host.reconnect is invoked while disabled', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsBinding({
      serverUrl: 'https://dsh.r2049.cn',
      role: 'host',
      hostControl: { enabled: false },
    })
    const replaceSpy = vi.spyOn(settings, 'replace')
    const setHostControlEnabled = vi.fn()
    const reconnectHost = vi.fn()
    const client = { setHostControlEnabled } as unknown as ClientModeRuntime
    const host = {
      reconnectHost,
      hostStatus: () => ({
        configured: true,
        online: false,
        reconnecting: true,
        authorized: true,
        accountRequired: false,
      }),
    } as unknown as HostAuthorizationControl

    const handler = register(new PluginControlRuntime(resolveConfig(settings.get()), directory, settings, client, host))
    const first = await handler('host.reconnect', {}, signal())
    expect(first).toMatchObject({ ok: true })
    expect(settings.get().hostControl).toEqual({ enabled: true })
    expect(replaceSpy).toHaveBeenCalledOnce()
    expect(setHostControlEnabled).toHaveBeenCalledWith(true)
    expect(reconnectHost).toHaveBeenCalledOnce()

    const second = await handler('host.reconnect', {}, signal())
    expect(second).toMatchObject({ ok: true })
    expect(replaceSpy).toHaveBeenCalledOnce()
    expect(reconnectHost).toHaveBeenCalledTimes(2)
  })
})

describe('RemotePluginOptions unassociated Host error recovery banner', () => {
  it('renders reconnect recovery for paused or actionable unassociated Host errors and hides transient or sign-in states', async () => {
    vi.stubGlobal('window', {
      requestAnimationFrame: vi.fn(),
      cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })

    for (const errorCode of [
      'SERVER_CREDENTIALS_LOCK_UNSUPPORTED',
      'SERVER_CREDENTIALS_LOCK_DIRECTORY',
      'SERVER_CREDENTIALS_BUSY',
      'CONNECTION_FAILED',
    ]) {
      const { React, resetRender, unmount } = createTestHarness()
      try {
        const control = vi.fn(async (endpoint: string): Promise<unknown> => {
          if (endpoint === 'settings.get') {
            const view: PluginSettingsView = {
              config: { logLevel: 'info', terminal: { enabled: true }, remoteTools: { enabled: true } },
              deviceName: 'test-host',
              writable: true,
              applies: 'live',
              associations: {},
            }
            return view
          }
          if (endpoint === 'status') {
            const status: RemoteStatus = {
              mode: 'local',
              available: false,
              hostAuthorizationAvailable: true,
              host: {
                configured: true,
                online: false,
                reconnecting: false,
                authorized: false,
                accountRequired: false,
                error: errorCode,
              },
            }
            return status
          }
          if (endpoint === 'host.reconnect') {
            return {
              mode: 'local',
              available: false,
              host: {
                configured: true,
                online: false,
                reconnecting: true,
                authorized: true,
                accountRequired: false,
              },
            }
          }
          return {}
        })

        const Component = createRemotePluginOptions(React) as any
        const props = {
          control,
          statusFeed: { subscribe: () => () => {}, getSnapshot: () => undefined },
          t: (key: string) => key,
          view: 'page',
          sidebarEntry: { read: () => 'standard', subscribe: () => () => {}, publish: () => {} },
        }
        resetRender()
        Component(props)
        await new Promise(resolve => setTimeout(resolve, 0))
        resetRender()
        const tree = Component(props)

        const issueBanner = findElement(tree, node => node.props?.className === 'dshRemoteConnectionIssue')
        expect(issueBanner).not.toBeNull()
        const reconnectBtn = findElement(issueBanner, node => node.type === 'button' && node.props?.className === 'dshRemoteReconnect')
        expect(reconnectBtn).not.toBeNull()
        reconnectBtn.props.onClick()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(control).toHaveBeenCalledWith('host.reconnect')
      } finally {
        unmount()
      }
    }

    for (const hiddenHost of [
      { configured: true, online: false, reconnecting: true, authorized: false, accountRequired: false, error: 'CONNECTION_FAILED' },
      { configured: true, online: false, reconnecting: false, authorized: false, accountRequired: true, error: 'ACCOUNT_AUTH_REQUIRED' },
    ]) {
      const { React, resetRender, unmount } = createTestHarness()
      try {
        const control = vi.fn(async (endpoint: string): Promise<unknown> => {
          if (endpoint === 'settings.get') {
            return {
              config: { logLevel: 'info', terminal: { enabled: true }, remoteTools: { enabled: true } },
              deviceName: 'test-host',
              writable: true,
              applies: 'live',
              associations: {},
            } satisfies PluginSettingsView
          }
          if (endpoint === 'status') {
            return { mode: 'local', available: false, hostAuthorizationAvailable: true, host: hiddenHost } satisfies RemoteStatus
          }
          return {}
        })
        const Component = createRemotePluginOptions(React) as any
        const props = {
          control,
          statusFeed: { subscribe: () => () => {}, getSnapshot: () => undefined },
          t: (key: string) => key,
          view: 'page',
          sidebarEntry: { read: () => 'standard', subscribe: () => () => {}, publish: () => {} },
        }
        resetRender()
        Component(props)
        await new Promise(resolve => setTimeout(resolve, 0))
        resetRender()
        const tree = Component(props)
        expect(findElement(tree, node => node.props?.className === 'dshRemoteConnectionIssue')).toBeNull()
      } finally {
        unmount()
      }
    }
  })
})

function register(runtime: PluginControlRuntime) {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ControlResult<unknown>>) | undefined
  let channel: string | undefined
  runtime.register({
    rpc: {
      handle: (registeredChannel, next) => {
        channel = registeredChannel
        handler = next
        return async () => undefined
      },
    },
  } satisfies HostConnectionHandle)
  expect(channel).toBe(CONTROL_RPC_PREFIX)
  if (handler === undefined) throw new Error('control handler was not registered')
  return handler
}

function settingsBinding(initial: Config): PluginSettingsBinding {
  let value = structuredClone(initial)
  return {
    get: () => structuredClone(value),
    replace: async section => { value = structuredClone(section) },
  }
}

function signal(): AbortSignal {
  return new AbortController().signal
}

function createTestHarness() {
  const stateSlots: any[] = []
  let stateIndex = 0
  const prevDeps: any[][] = []
  let effectCleanups: (((() => void) | void))[] = []
  let effectIndex = 0

  const React: ClientReact = {
    Fragment: Symbol('Fragment'),
    createElement(type: any, props?: any, ...children: any[]) {
      return { type, props: props || {}, children }
    },
    useEffect(effect: any, deps?: any[]) {
      const slot = effectIndex++
      const oldDeps = prevDeps[slot]
      const hasChanged = !oldDeps || !deps || deps.some((d, i) => !Object.is(d, oldDeps[i]))
      if (hasChanged) {
        if (typeof effectCleanups[slot] === 'function') effectCleanups[slot]!()
        prevDeps[slot] = deps || []
        effectCleanups[slot] = effect()
      }
    },
    useCallback(cb: any) { return cb },
    useMemo(factory: any) { return factory() },
    useRef(initial: any) {
      const slot = stateIndex++
      if (stateSlots[slot] === undefined) stateSlots[slot] = { current: initial }
      return stateSlots[slot]
    },
    useState(initial: any) {
      const slot = stateIndex++
      if (stateSlots[slot] === undefined) {
        stateSlots[slot] = typeof initial === 'function' ? initial() : initial
      }
      const setState = (val: any) => {
        stateSlots[slot] = typeof val === 'function' ? val(stateSlots[slot]) : val
      }
      return [stateSlots[slot], setState]
    },
    useSyncExternalStore(_subscribe: any, getSnapshot: any) {
      return typeof getSnapshot === 'function' ? getSnapshot() : undefined
    },
  }

  return {
    React,
    resetRender: () => { stateIndex = 0; effectIndex = 0 },
    unmount: () => {
      for (const cleanup of effectCleanups) {
        if (typeof cleanup === 'function') cleanup()
      }
      effectCleanups = []
    },
  }
}

function findElement(node: any, predicate: (n: any) => boolean): any {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  const children = Array.isArray(node) ? node : node.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  }
  return null
}
