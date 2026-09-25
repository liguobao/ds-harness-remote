import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as remotePlugin from '../src/index.js'

const directories: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Cordis plugin lifecycle', () => {
  it('does not block Harness startup while runtime services are unavailable', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis pending host' })

    expect(fiber.state).toBe(2)
    expect(fiber.inject).toEqual({})
    expect(ctx.get('dshRemote')).toBeUndefined()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('loads against ApiProxy and disposes its runtime', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-cordis-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    let identityReadyWhenControlRegistered: boolean | undefined
    ctx.provide('settings', settings({ deviceName: 'Cordis test host' }))
    ctx.provide('apiProxy', apiProxy())
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection(() => {
      try {
        ctx.dshRemote.currentIdentity()
        identityReadyWhenControlRegistered = true
      } catch {
        identityReadyWhenControlRegistered = false
      }
    }))
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis test host' })

    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis test host' })
      expect(ctx.dshRemote.diagnostics()).toMatchObject({
        loaded: true,
        capabilities: expect.arrayContaining(['harness.api.v1', 'harness.api.transfer.v1']),
      })
    })
    expect(identityReadyWhenControlRegistered).toBe(false)

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('waits for Desktop connection before activating even when ApiProxy is ready', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-late-connection-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    const handle = vi.fn(() => async () => undefined)
    ctx.provide('settings', settings({ deviceName: 'Cordis delayed connection host' }))
    ctx.provide('apiProxy', apiProxy())
    ctx.provide('typertGateway', typertGateway())
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis delayed connection host' })

    expect(ctx.get('dshRemote')).toBeUndefined()
    ctx.provide('connection', { rpc: { handle } } as never)
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis delayed connection host' })
    })
    expect(handle).toHaveBeenCalledWith('/ds-harness-remote', expect.any(Function), {
      authority: 'loopback',
    })

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('loads a TUI Host against the v0.1.2 Typert Remote Gateway without a Desktop connection service', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-alpha-cordis-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    ctx.provide('commands', { register: vi.fn(() => vi.fn()) })
    ctx.provide('tuiCommandTrees', { register: vi.fn(() => vi.fn()) })
    ctx.provide('tuiScenes', { register: vi.fn(() => vi.fn()), open: vi.fn(() => true) })
    ctx.provide('settings', settings({ deviceName: 'Cordis alpha host' }))
    ctx.provide('typertGateway', {
      invoke: vi.fn(async () => undefined),
      dispatchRpc: vi.fn(async () => ({ ok: true, value: undefined })),
      openWireStream: vi.fn(async () => (async function* () { return })()),
      wireStream: {
        open: vi.fn(async () => (async function* () { return })()),
        failure: vi.fn(() => ({ code: 'internal', message: 'failed', details: {} })),
      },
    } as never)
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis alpha host' })

    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis alpha host' })
      expect(ctx.dshRemote.diagnostics()).toMatchObject({ loaded: true, serverConfigured: true })
    })
    expect(ctx.get('dshRemoteClient')).toBeUndefined()

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps the TUI command available when rc.2 has no Component admission', async () => {
    const register = vi.fn((_definition: unknown) => vi.fn())
    const registerCommand = vi.fn((_context: unknown, _definition: unknown) => {
      throw Object.assign(new Error('the calling activation has no verified dsh-plugin.json Component identity'), {
        code: 'COMPONENT_NOT_ADMITTED',
      })
    })
    const ctx = new Context()
    ctx.provide('commands', { register })
    ctx.provide('tuiPluginHost', { registerCommand })
    ctx.provide('tuiCommandTrees', { register: vi.fn(() => vi.fn()) })
    ctx.provide('tuiScenes', { register: vi.fn(() => vi.fn()), open: vi.fn(() => true) })
    ctx.provide('settings', settings({ enabled: false }))
    ctx.provide('typertGateway', typertGateway())

    const fiber = await ctx.plugin(remotePlugin, { enabled: false })

    expect(fiber.state).toBe(2)
    expect(registerCommand).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toMatchObject({ name: 'remote' })

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('prefers mediated TUI command registration when Component admission is available', async () => {
    const register = vi.fn((_definition: unknown) => vi.fn())
    const registerCommand = vi.fn((_context: unknown, _definition: unknown) => vi.fn())
    const ctx = new Context()
    ctx.provide('commands', { register })
    ctx.provide('tuiPluginHost', { registerCommand })
    ctx.provide('tuiCommandTrees', { register: vi.fn(() => vi.fn()) })
    ctx.provide('tuiScenes', { register: vi.fn(() => vi.fn()), open: vi.fn(() => true) })
    ctx.provide('settings', settings({ enabled: false }))
    ctx.provide('typertGateway', typertGateway())

    const fiber = await ctx.plugin(remotePlugin, { enabled: false })

    expect(fiber.state).toBe(2)
    expect(registerCommand).toHaveBeenCalledOnce()
    expect(registerCommand.mock.calls[0]?.[1]).toMatchObject({ name: 'remote' })
    expect(register).not.toHaveBeenCalled()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('waits for a late legacy ApiProxy instead of activating rc.2 without it', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-late-apiproxy-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const ctx = new Context()
    const handlers: Array<{
      channel: string
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
      disposed: boolean
    }> = []
    ctx.provide('settings', settings({ deviceName: 'Cordis delayed rc.2 host' }))
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', {
      rpc: {
        handle: vi.fn((channel: string, handler: typeof handlers[number]['handler']) => {
          const entry = { channel, handler, disposed: false }
          handlers.push(entry)
          return async () => { entry.disposed = true }
        }),
      },
    } as never)
    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis delayed rc.2 host' })

    expect(ctx.get('dshRemote')).toBeUndefined()
    expect(handlers).toHaveLength(1)
    expect(handlers[0]?.channel).toBe('/ds-harness-remote')
    await expect(handlers[0]?.handler('status', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        mode: 'local',
        available: false,
        hostAuthorizationAvailable: false,
      },
    })
    ctx.provide('apiProxy', apiProxy())
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis delayed rc.2 host' })
    })
    expect(handlers[0]?.disposed).toBe(true)
    expect(handlers.at(-1)?.disposed).toBe(false)

    await fiber.dispose()
    expect(ctx.get('dshRemote')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('starts the retained Client runtime for a saved Client configuration', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-host-only-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)
    const replace = vi.fn(async (_ns: string, _section: unknown) => undefined)
    const describeHost = vi.fn(async request => ({
      rpcId: request.rpcId,
      result: {
        ok: true as const,
        value: {
          version: '0.1.0-rc.8',
          cwd: '/workspace',
          attachedSessions: 0,
          home: '/home/tester',
          canOpenPath: false,
        },
      },
    }))
    const ctx = new Context()
    ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [],
      replace,
    } as never)
    ctx.provide('apiProxy', apiProxy(describeHost))
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection())

    const fiber = await ctx.plugin(remotePlugin, {
      role: 'client',
      serverUrl: 'https://dsh.r2049.cn',
      deviceName: 'Former client',
    })

    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Former client' })
    })
    expect(replace).not.toHaveBeenCalled()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('disables legacy loader entries during startup', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-legacy-loader-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const entries = [
      { id: 'legacy-package', options: { id: 'legacy-package', name: 'dsh-remote' } },
      { id: 'legacy-workspace', options: { id: 'legacy-workspace', name: '@dsh-remote/plugin' } },
      { id: 'current', options: { id: 'current', name: 'ds-harness-remote' } },
    ]
    const loader = {
      entries: () => entries.values(),
      locate: () => 'current',
      update: vi.fn(async (id: string, options: { disabled?: boolean | null }) => {
        const entry = entries.find(item => item.id === id)
        if (entry !== undefined) Object.assign(entry.options, options)
      }),
    }
    const ctx = new Context()
    ctx.provide('loader', loader)
    ctx.provide('settings', settings({ deviceName: 'Cordis migration host' }))
    ctx.provide('apiProxy', apiProxy())
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', connection())

    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis migration host' })

    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis migration host' })
    })
    expect(loader.update).toHaveBeenCalledWith('legacy-package', { disabled: true })
    expect(loader.update).toHaveBeenCalledWith('legacy-workspace', { disabled: true })
    expect(loader.update).not.toHaveBeenCalledWith('current', expect.anything())

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('derives the configurable entry id from a bundle include mount', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-include-entry-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    // A profile row's Loader path id is `include:<row id>`; the settings
    // namespace must be the row's own `options.id`.
    const loader = loaderTree('include:ds-harness-remote', 'ds-harness-remote')
    const replace = vi.fn(async (_ns: string, _section: unknown) => undefined)
    const handlers: ControlHandler[] = []
    const ctx = new Context()
    ctx.provide('loader', loader)
    ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'ds-harness-remote' }],
      replace,
    } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', capturingConnection(handlers))
    ctx.provide('apiProxy', apiProxy())

    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis include host' })
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis include host' })
    })
    await handlers[0]!('settings.codex.set', { enabled: false }, new AbortController().signal)

    expect(replace).toHaveBeenCalledOnce()
    expect(replace.mock.calls[0]?.[0]).toBe('ds-harness-remote')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps a plain insert mount entry id unchanged', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-insert-entry-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const loader = loaderTree('ds-harness-remote', 'ds-harness-remote')
    const replace = vi.fn(async (_ns: string, _section: unknown) => undefined)
    const handlers: ControlHandler[] = []
    const ctx = new Context()
    ctx.provide('loader', loader)
    ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'ds-harness-remote' }],
      replace,
    } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', capturingConnection(handlers))
    ctx.provide('apiProxy', apiProxy())

    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis insert host' })
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis insert host' })
    })
    await handlers[0]!('settings.codex.set', { enabled: false }, new AbortController().signal)

    expect(replace).toHaveBeenCalledOnce()
    expect(replace.mock.calls[0]?.[0]).toBe('ds-harness-remote')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('installs the rc.1 page policy and writes through a Loader-supplied volatile entry', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-volatile-entry-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    // The Loader hands `apply` the entry's live volatile reference, not the
    // plain composition object, and addresses it by `options.id` (the located
    // tree path is different).
    const liveEntry = { get: () => ({ deviceName: 'Cordis volatile host' }) }
    const loader = loaderTree('include:ds-harness-remote-tui', 'ds-harness-remote-tui')
    const replace = vi.fn(async (_ns: string, _section: unknown) => undefined)
    const configure = vi.fn((_presentation: unknown, _owner: unknown) => () => undefined)
    const handlers: ControlHandler[] = []
    const ctx = new Context()
    ctx.provide('loader', loader)
    ctx.provide('settings', {
      configure,
      describe: () => [{ ns: 'ds-harness-remote-tui' }],
      replace,
    } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', capturingConnection(handlers))
    ctx.provide('apiProxy', apiProxy())

    const fiber = await ctx.plugin(volatileEntryPlugin(liveEntry) as unknown as typeof remotePlugin, {})
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis volatile host' })
    })
    await handlers[0]!('settings.codex.set', { enabled: false }, new AbortController().signal)

    expect(configure).toHaveBeenCalledWith({ auto: false }, fiber)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace.mock.calls[0]?.[0]).toBe('ds-harness-remote-tui')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('activates against the ≤0.1.6 settings registry through a scope binding', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-legacy-settings-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    const scope = {
      get: () => ({ deviceName: 'Cordis legacy host' }),
      replace: vi.fn(async (_section: unknown) => undefined),
    }
    const register = vi.fn((_ns: string, _schema: unknown, _options: unknown) => scope)
    const handlers: ControlHandler[] = []
    const ctx = new Context()
    ctx.provide('loader', loaderTree('ds-harness-remote', 'ds-harness-remote'))
    // Only the ≤0.1.6 registry generation: no `configure`, a `register` that
    // returns the read/write scope.
    ctx.provide('settings', {
      register,
      describe: () => [{ ns: 'ds-harness-remote', user: { deviceName: 'Cordis legacy host' } }],
    } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', capturingConnection(handlers))
    ctx.provide('apiProxy', apiProxy())

    const fiber = await ctx.plugin(remotePlugin, {})
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis legacy host' })
    })
    expect(register).toHaveBeenCalled()
    expect(register.mock.calls[0]?.[0]).toBe('ds-harness-remote')

    await handlers[0]!('settings.codex.set', { enabled: false }, new AbortController().signal)
    expect(scope.replace).toHaveBeenCalledOnce()

    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('resolves a group-nested include path to the row id, not a stripped prefix', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-remote-group-entry-'))
    directories.push(dshHome)
    vi.stubEnv('DSH_HOME', dshHome)

    // `include:<group>:<row>` cannot be recovered by stripping `include:`; it
    // needs the located entry's own `options.id`.
    const loader = loaderTree('include:team:ds-harness-remote', 'ds-harness-remote')
    const replace = vi.fn(async (_ns: string, _section: unknown) => undefined)
    const handlers: ControlHandler[] = []
    const ctx = new Context()
    ctx.provide('loader', loader)
    ctx.provide('settings', {
      configure: () => () => undefined,
      describe: () => [{ ns: 'ds-harness-remote' }],
      replace,
    } as never)
    ctx.provide('typertGateway', typertGateway())
    ctx.provide('connection', capturingConnection(handlers))
    ctx.provide('apiProxy', apiProxy())

    const fiber = await ctx.plugin(remotePlugin, { deviceName: 'Cordis group host' })
    await vi.waitFor(() => {
      expect(ctx.dshRemote.currentIdentity()).toMatchObject({ name: 'Cordis group host' })
    })
    await handlers[0]!('settings.codex.set', { enabled: false }, new AbortController().signal)

    expect(replace).toHaveBeenCalledOnce()
    expect(replace.mock.calls[0]?.[0]).toBe('ds-harness-remote')

    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})

function settings(value: Record<string, unknown>) {
  return {
    configure: () => () => undefined,
    describe: () => [{ ns: 'ds-harness-remote', value }],
    replace: vi.fn(async () => undefined),
  } as never
}

type ControlHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>

/**
 * Apply the plugin with a caller-supplied live volatile entry. The passthrough
 * `Config` reproduces the Loader contract — `apply` receives the entry's live
 * reference (a `{ get() }` object) rather than a validated plain config.
 */
function volatileEntryPlugin(entry: { get(): Record<string, unknown> }) {
  return {
    name: 'ds-harness-remote',
    Config: {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => ({ value: entry }),
      },
    },
    apply: (ctx: Context) => remotePlugin.apply(ctx, entry as never),
  }
}

/** Loader stub whose `locate` returns a tree-path id distinct from `options.id`. */
function loaderTree(located: string, optionsId: string) {
  const entries = [{ id: located, options: { id: optionsId, name: 'ds-harness-remote' } }]
  return {
    entries: () => entries.values(),
    locate: () => located,
    update: vi.fn(async () => undefined),
  }
}

/** Connection stub that captures the registered control handler. */
function capturingConnection(handlers: ControlHandler[]) {
  return {
    rpc: {
      handle: vi.fn((_channel: string, handler: ControlHandler) => {
        handlers.push(handler)
        return async () => undefined
      }),
    },
  } as never
}

function connection(onHandle?: () => void) {
  return {
    rpc: {
      handle: vi.fn(() => {
        onHandle?.()
        return async () => undefined
      }),
    },
  } as never
}

function typertGateway() {
  return { invoke: vi.fn(async () => undefined) } as never
}

function apiProxy(describeHost?: ApiProxy['host']['describe']): ApiProxy {
  const empty = {}
  return {
    sessions: empty,
    subagents: empty,
    host: describeHost === undefined ? empty : { describe: describeHost },
    workspace: empty,
    skills: empty,
    agentPresets: empty,
    goals: empty,
    settings: empty,
    credentials: empty,
    llm: empty,
    events: { mux: async function* () { return }, host: async function* () { return } },
    downloads: empty,
    respond: async () => ({ accepted: true }),
  } as unknown as ApiProxy
}
