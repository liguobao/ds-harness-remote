import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { describe, expect, it, vi } from 'vitest'
import { ApiProxySwitch } from '../src/api-proxy-switch.js'

describe('ApiProxySwitch', () => {
  it('keeps remote authority disconnected until reconnect or explicit exit', async () => {
    const localList = vi.fn(async () => 'local')
    const remoteList = vi.fn(async () => 'remote')
    const local = api(localList)
    const remote = api(remoteList)
    const target = new ApiProxySwitch(local)
    target.install()
    target.selectRemote(remote, { deviceId: 'agy', name: 'AGY' })
    target.disconnectRemote()
    expect(target.status().mode).toBe('remote')
    expect(() => callList(local, '1')).toThrow('Remote connection was lost')
    expect(localList).not.toHaveBeenCalled()
    expect(remoteList).not.toHaveBeenCalled()
    target.selectRemote(remote, { deviceId: 'agy', name: 'AGY' })
    await expect(callList(local, '2')).resolves.toBe('remote')
    target.selectLocal()
    await expect(callList(local, '3')).resolves.toBe('local')
  })
  it('switches native session calls without replacing the official service identity', async () => {
    const localList = vi.fn(async () => 'local')
    const remoteList = vi.fn(async () => 'remote')
    const local = api(localList)
    const remote = api(remoteList)
    const serviceIdentity = local
    const target = new ApiProxySwitch(local)

    target.install()
    await expect(callList(local, '1')).resolves.toBe('local')
    target.selectRemote(remote, { deviceId: 'host-1', name: 'Remote Host' })
    await expect(callList(local, '2')).resolves.toBe('remote')
    expect(local).toBe(serviceIdentity)
    expect(target.status()).toEqual({ mode: 'remote', target: { deviceId: 'host-1', name: 'Remote Host' } })

    target.selectLocal()
    await expect(callList(local, '3')).resolves.toBe('local')
  })

  it('forwards the model-configuration domains to the remote target in remote mode', async () => {
    const localSettings = vi.fn(async () => 'local-settings')
    const remoteSettings = vi.fn(async () => 'remote-settings')
    const localCredentials = vi.fn(async () => 'local-credentials')
    const remoteCredentials = vi.fn(async () => 'remote-credentials')
    const local = api(undefined, localSettings, localCredentials)
    const remote = api(undefined, remoteSettings, remoteCredentials)
    const target = new ApiProxySwitch(local)

    target.install()
    const settings = local.settings as unknown as { mutate: (request: unknown) => Promise<unknown> }
    const credentials = local.credentials as unknown as { set: (request: unknown) => Promise<unknown> }

    await expect(settings.mutate({ rpcId: '1', payload: {} })).resolves.toBe('local-settings')
    await expect(credentials.set({ rpcId: '2', payload: {} })).resolves.toBe('local-credentials')

    target.selectRemote(remote, { deviceId: 'host-1', name: 'Remote Host' })
    await expect(settings.mutate({ rpcId: '3', payload: {} })).resolves.toBe('remote-settings')
    await expect(credentials.set({ rpcId: '4', payload: {} })).resolves.toBe('remote-credentials')

    target.selectLocal()
    await expect(settings.mutate({ rpcId: '5', payload: {} })).resolves.toBe('local-settings')
  })
})

function api(
  list?: (...args: unknown[]) => Promise<unknown>,
  settingsFn?: (...args: unknown[]) => Promise<unknown>,
  credentialsFn?: (...args: unknown[]) => Promise<unknown>,
): ApiProxy {
  const empty = {}
  return {
    sessions: { list: list ?? (async () => 'default') },
    subagents: empty,
    host: empty,
    workspace: empty,
    skills: empty,
    agentPresets: empty,
    goals: empty,
    settings: { mutate: settingsFn ?? (async () => 'default-settings') },
    credentials: { set: credentialsFn ?? (async () => 'default-credentials') },
    llm: empty,
    events: empty,
    downloads: empty,
    respond: async () => ({ accepted: true }),
  } as unknown as ApiProxy
}

function callList(api: ApiProxy, rpcId: string): Promise<unknown> {
  const list = api.sessions.list as unknown as (request: unknown) => Promise<unknown>
  return list({ rpcId, payload: {} })
}
