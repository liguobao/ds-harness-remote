import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { buildAuthDiagnosticFromMetadata, parseInitializeMetadata } from '../src/acp/adapters/auth-diagnostics.js'
import { ADAPTER_LABELS } from '../src/acp/adapters/cursor-process.js'
import { KimiAcpClient } from '../src/acp/adapters/kimi-process.js'
import { AcpSessionModelState } from '../src/acp/adapters/session-models.js'
import { ACP_CATALOG_BACKENDS, acpBackendLabel, acpBackendProvider, acpWorkspacePrefix } from '../src/acp/virtual-catalog.js'
import { sessionPrefix } from '../src/acp/virtual-contract.js'
import { remoteHostFeatures } from '../src/client-capabilities.js'
import { ClientControl } from '../src/client-control.js'
import { pendingWorkspaceSelectionKey, storedWorkspaceSelection } from '../src/client/navigation.js'

type Wire = Record<string, any>

function fakeProcess() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
  Object.assign(child, { stdin, stdout, stderr, exitCode: null, killed: false })
  child.kill = vi.fn(() => {
    Object.assign(child, { killed: true, exitCode: 0 })
    child.emit('exit', 0, null)
    return true
  })
  return {
    child, stdin, stdout, sent: [] as Wire[],
    reply: (message: Wire, result: unknown) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`),
    update: (sessionId: string, update: Wire) => stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } })}\n`),
  }
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const chunk = (sessionUpdate: string, text: string) => ({ sessionUpdate, content: { type: 'text', text } })

function setup(handle?: (message: Wire, child: ReturnType<typeof fakeProcess>) => boolean) {
  const children: ReturnType<typeof fakeProcess>[] = []
  const spawn = vi.fn((binary: string) => {
    expect(binary).toBe('kimi')
    const child = fakeProcess()
    children.push(child)
    child.stdin.on('data', (data: Buffer) => {
      for (const line of String(data).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line) as Wire
        child.sent.push(message)
        if (handle?.(message, child)) continue
        if (message.id === undefined || message.method === undefined) continue
        child.reply(message, message.method === 'session/new' ? { sessionId: 'session_kimi_1' } : {})
      }
    })
    return child.child
  })
  const client = new KimiAcpClient(undefined, undefined, spawn)
  return { client, children, spawn }
}

describe('KimiAcpClient', () => {
  it('spawns `kimi acp`, exposes configOptions model/thinking and modes without interactive auth', async () => {
    let selectedModel = 'deepseek/deepseek-flash'
    let selectedThinking = 'high'
    let selectedMode = 'default'
    const buildConfigOptions = () => ([
      {
        type: 'select',
        id: 'model',
        name: 'Model',
        category: 'model',
        currentValue: selectedModel,
        options: [
          { value: 'deepseek/deepseek-flash', name: 'DeepSeek Flash' },
          { value: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        ],
      },
      {
        type: 'select',
        id: 'thinking',
        name: 'Thinking',
        category: 'thought_level',
        currentValue: selectedThinking,
        options: [
          { value: 'off', name: 'Thinking Off' },
          { value: 'low', name: 'Thinking Low' },
          { value: 'high', name: 'Thinking High' },
        ],
      },
      {
        type: 'select',
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        currentValue: selectedMode,
        options: [
          { value: 'default', name: 'Default' },
          { value: 'plan', name: 'Plan' },
          { value: 'auto', name: 'Auto' },
        ],
      },
    ])
    const buildModes = () => ({
      currentModeId: selectedMode,
      availableModes: [
        { id: 'default', name: 'Default' },
        { id: 'plan', name: 'Plan' },
        { id: 'auto', name: 'Auto' },
      ],
    })

    const { client, children } = setup((message, child) => {
      if (message.method === 'session/new') {
        child.reply(message, {
          sessionId: 'session_kimi_1',
          configOptions: buildConfigOptions(),
          modes: buildModes(),
        })
        return true
      }
      if (message.method === 'session/set_config_option') {
        if (message.params?.configId === 'model') selectedModel = message.params.value
        if (message.params?.configId === 'thinking') selectedThinking = message.params.value
        child.reply(message, { configOptions: buildConfigOptions() })
        return true
      }
      if (message.method === 'session/set_mode') {
        selectedMode = message.params?.modeId
        child.update('session_kimi_1', { sessionUpdate: 'current_mode_update', currentModeId: selectedMode })
        // Partial config_option_update with only mode should not wipe model/effort.
        child.update('session_kimi_1', { sessionUpdate: 'config_option_update', configOptions: [buildConfigOptions()[2]] })
        child.reply(message, {})
        return true
      }
      return false
    })

    try {
      expect((client as unknown as { options: { args?: string[] } }).options.args).toEqual(['acp'])
      await client.start()
      const created = await client.call('session/new', { cwd: '/work/repo', mcpServers: [] })
      expect(created).toMatchObject({ sessionId: 'session_kimi_1' })

      const models = await client.call('dsh/sessionModels', { sessionId: 'session_kimi_1' }) as any
      expect(models.current).toMatchObject({ provider: 'kimi', model: 'deepseek/deepseek-flash', reasoningEffort: 'high' })
      expect(models.groups[0]).toMatchObject({ id: 'kimi', name: 'Kimi' })

      await expect(client.call('dsh/selectModel', {
        sessionId: 'session_kimi_1',
        model: 'deepseek/deepseek-v4-pro',
        reasoningEffort: 'low',
      })).rejects.toThrow(/Select the Kimi model before choosing/)

      await expect(client.call('dsh/selectModel', {
        sessionId: 'session_kimi_1',
        model: 'deepseek/deepseek-v4-pro',
      })).resolves.toMatchObject({
        selected: { provider: 'kimi', model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'high' },
      })

      await expect(client.call('dsh/selectModel', {
        sessionId: 'session_kimi_1',
        model: 'deepseek/deepseek-v4-pro',
        reasoningEffort: 'low',
      })).resolves.toMatchObject({
        selected: { provider: 'kimi', model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'low' },
      })

      await expect(client.call('session/set_mode', { sessionId: 'session_kimi_1', modeId: 'plan' }))
        .resolves.toEqual({ currentModeId: 'plan' })

      // Partial config_option_update must preserve previously advertised model/effort.
      const modelsAfterMode = await client.call('dsh/sessionModels', { sessionId: 'session_kimi_1' }) as any
      expect(modelsAfterMode.current).toMatchObject({ provider: 'kimi', model: 'deepseek/deepseek-v4-pro', reasoningEffort: 'low' })
      expect(children[0]!.sent.some(message => message.method === 'authenticate')).toBe(false)
    } finally { await client.close() }
  })

  it('forwards image prompts to the Kimi ACP process without modification', async () => {
    const { client, children } = setup((message, child) => {
      if (message.method === 'session/new') {
        child.reply(message, { sessionId: 'session_kimi_img' })
        return true
      }
      if (message.method === 'session/prompt') {
        child.reply(message, { stopReason: 'end_turn' })
        return true
      }
      return false
    })
    try {
      await client.start()
      await client.call('session/new', { cwd: '/work/repo', mcpServers: [] })
      const promptBlocks = [
        { type: 'text', text: 'what is in this image?' },
        { type: 'image', mimeType: 'image/png', data: 'AQIDBA==' },
      ]
      await client.call('session/prompt', { sessionId: 'session_kimi_img', prompt: promptBlocks })
      const promptCall = children[0]!.sent.find(message => message.method === 'session/prompt')
      expect(promptCall).toMatchObject({
        params: {
          sessionId: 'session_kimi_img',
          prompt: promptBlocks,
        },
      })
    } finally { await client.close() }
  })

  it('labels history as kimi, strips synthetic <system-reminder> chunks safely, and isolates replay', async () => {
    const literalReminder = '<system-reminder>\nUser pasted literal block\n</system-reminder>'
    const { client, children } = setup((message, child) => {
      if (message.method === 'session/list') {
        child.reply(message, { sessions: [{ sessionId: 'saved-1', cwd: '/work/repo', title: null, updatedAt: '2026-11-27T08:00:00Z' }], nextCursor: null })
        return true
      }
      if (message.method === 'session/load') {
        // Turn 1: text + metadata + injected system-reminder (must strip injected reminder)
        child.update('saved-1', chunk('user_message_chunk', 'run the tests'))
        child.update('saved-1', { sessionUpdate: 'session_info_update', title: 'run the tests' })
        child.update('saved-1', chunk('user_message_chunk', '<system-reminder>\nToday\'s date is 2026-11-27\n</system-reminder>'))
        child.update('saved-1', chunk('agent_message_chunk', 'all green'))
        // Turn 2: image-only user prompt + injected system-reminder (must strip injected reminder)
        child.update('saved-1', { sessionUpdate: 'user_message_chunk', content: { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' } })
        child.update('saved-1', chunk('user_message_chunk', '<system-reminder>\nToday\'s date is 2026-11-27\n</system-reminder>'))
        child.update('saved-1', chunk('agent_message_chunk', 'image checked'))
        // Turn 3: user literally sent only a <system-reminder> block (must preserve it, strip second synthetic one)
        child.update('saved-1', chunk('user_message_chunk', literalReminder))
        child.update('saved-1', chunk('user_message_chunk', '<system-reminder>\nToday\'s date is 2026-11-27\n</system-reminder>'))
        child.update('saved-1', chunk('agent_message_chunk', 'literal preserved'))
        // Non-chunk agent_message must also reset turn tracking before a subsequent literal <system-reminder>.
        child.update('saved-1', chunk('user_message_chunk', '   \n'))
        child.update('saved-1', { sessionUpdate: 'agent_message', content: { type: 'text', text: 'turn boundary' } })
        child.update('saved-1', chunk('user_message_chunk', literalReminder))
        child.update('saved-1', chunk('user_message_chunk', '<system-reminder>a</system-reminder> keep user text <system-reminder>b</system-reminder>'))
        child.update('saved-1', chunk('user_message_chunk', '<system-reminder>\nToday\'s date is 2026-11-27\n</system-reminder>'))
        child.update('saved-1', chunk('agent_message_chunk', 'multi-tag preserved'))
        queueMicrotask(() => child.reply(message, { modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] } }))
        return true
      }
      return false
    })
    const live = vi.fn()
    client.onInbound(live)
    try {
      await client.start()
      const catalog = await client.call('session/list', { cwd: '/work/repo' }) as { sessions: Array<{ sessionId: string }> }
      expect(catalog.sessions.map(session => session.sessionId)).toEqual(['saved-1'])
      await client.call('session/load', { sessionId: 'saved-1', cwd: '/work/repo', mcpServers: [] })
      const history = await client.history('saved-1', '/work/repo') as Array<{ event: { type: string; data: any } }>
      const users = history.filter(entry => entry.event.type === 'user/message')
      expect(users).toHaveLength(4)
      expect(users[0]!.event.data.content).toEqual([{ type: 'text', text: 'run the tests' }])
      expect(users[1]!.event.data.content).toHaveLength(1)
      expect(users[1]!.event.data.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
      expect(users[2]!.event.data.content).toEqual([{ type: 'text', text: literalReminder }])
      expect(users[3]!.event.data.content).toEqual([
        { type: 'text', text: `   \n${literalReminder}<system-reminder>a</system-reminder> keep user text <system-reminder>b</system-reminder>` },
      ])

      const assistant = history.filter(entry => entry.event.type === 'assistant/message')
      expect(assistant).toHaveLength(4)
      expect(assistant[0]!.event.data.message.source).toMatchObject({ kind: 'model', provider: 'kimi' })
      expect(live).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'session/update' }))
      // Replay for an already-loaded idle session stays on the active process to avoid Kimi's exclusive session lock.
      expect(children.length).toBe(1)
    } finally { await client.close() }
  })

  it('uses isolated reader before session load, reuses live process once loaded, and returns snapshot during active prompts', async () => {
    let promptReply!: () => void
    let turn = 0
    const { client, children } = setup((message, child) => {
      if (message.method === 'session/new') {
        child.reply(message, { sessionId: 'live-lock-1' })
        return true
      }
      if (message.method === 'session/load') {
        const sid = message.params.sessionId
        child.update(sid, chunk('user_message_chunk', `question-${turn || 1}`))
        child.update(sid, chunk('user_message_chunk', '<system-reminder>Today</system-reminder>'))
        child.update(sid, chunk('agent_message_chunk', `answer-${turn || 1}`))
        queueMicrotask(() => child.reply(message, { modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }] } }))
        return true
      }
      if (message.method === 'session/prompt') {
        turn++
        promptReply = () => child.reply(message, { stopReason: 'end_turn' })
        return true
      }
      return false
    })
    const live = vi.fn()
    client.onInbound(live)
    try {
      await client.start()
      // Unloaded session uses isolated reader (2 processes total).
      const unloaded = await client.history('saved-unloaded', '/work/repo') as Array<{ event: { type: string } }>
      expect(unloaded.filter(e => e.event.type === 'user/message')).toHaveLength(1)
      expect(children).toHaveLength(2)

      // Live session reuses process #1 and does not spawn a 3rd process.
      await client.call('session/new', { cwd: '/work/repo', mcpServers: [] })
      const firstPrompt = client.call('session/prompt', { sessionId: 'live-lock-1', prompt: [{ type: 'text', text: 'hi' }] })
      await vi.waitFor(() => expect(children[0]!.sent.some(m => m.method === 'session/prompt')).toBe(true))
      // While a prompt is actively streaming, history() does not overlap session/load or spawn a locking process.
      const duringPrompt = await client.history('live-lock-1', '/work/repo')
      expect(duringPrompt).toEqual([])
      expect(children).toHaveLength(2)

      promptReply()
      await firstPrompt

      const liveHistory = await client.history('live-lock-1', '/work/repo') as Array<{ event: { type: string; data: any } }>
      expect(children).toHaveLength(2)
      const users = liveHistory.filter(e => e.event.type === 'user/message')
      expect(users).toHaveLength(1)
      expect(users[0]!.event.data.content).toEqual([{ type: 'text', text: 'question-1' }])
      expect(live).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'session/update' }))
    } finally { await client.close() }
  })

  it('handles partial vs full configOptions updates and effort clearing without losing state', async () => {
    const state = new AcpSessionModelState('kimi')
    state.update({
      configOptions: [
        { type: 'select', id: 'model', category: 'model', currentValue: 'reasoning-model', options: [{ value: 'reasoning-model', name: 'Reasoning' }, { value: 'fast-model', name: 'Fast' }] },
        { type: 'select', id: 'thinking', category: 'thought_level', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
        { type: 'select', id: 'mode', category: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] },
      ],
    })
    expect(state.catalog().current).toEqual({ provider: 'kimi', model: 'reasoning-model', reasoningEffort: 'high' })

    // Partial [mode] via session/set_config_option must preserve model & effort.
    await state.setMode('s1', 'plan', async () => ({
      configOptions: [{ type: 'select', id: 'mode', category: 'mode', currentValue: 'plan', options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] }],
    }))
    expect(state.modesCatalog().currentModeId).toBe('plan')
    expect(state.catalog().current).toEqual({ provider: 'kimi', model: 'reasoning-model', reasoningEffort: 'high' })

    // Partial [thinking] config_option_update preserves model.
    state.update({
      sessionUpdate: 'config_option_update',
      configOptions: [{ type: 'select', id: 'thinking', category: 'thought_level', currentValue: 'low', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] }],
    })
    expect(state.catalog().current).toEqual({ provider: 'kimi', model: 'reasoning-model', reasoningEffort: 'low' })

    // Partial config_option_update carrying [model (unchanged), mode] preserves effort (Issue #6).
    state.update({
      sessionUpdate: 'config_option_update',
      configOptions: [
        { type: 'select', id: 'model', category: 'model', currentValue: 'reasoning-model', options: [{ value: 'reasoning-model', name: 'Reasoning' }, { value: 'fast-model', name: 'Fast' }] },
        { type: 'select', id: 'mode', category: 'mode', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] },
      ],
    })
    expect(state.catalog().current).toEqual({ provider: 'kimi', model: 'reasoning-model', reasoningEffort: 'low' })

    // Switching to a model that omits thinking via session/set_config_option clears stale effort.
    await state.select('s1', 'fast-model', undefined, async () => ({
      configOptions: [{ type: 'select', id: 'model', category: 'model', currentValue: 'fast-model', options: [{ value: 'reasoning-model', name: 'Reasoning' }, { value: 'fast-model', name: 'Fast' }] }],
    }))
    expect(state.catalog().current).toEqual({ provider: 'kimi', model: 'fast-model' })

    // Partial config_option_update switching model without thinking also clears stale effort.
    state.update({
      configOptions: [
        { type: 'select', id: 'model', category: 'model', currentValue: 'reasoning-model', options: [{ value: 'reasoning-model', name: 'Reasoning' }, { value: 'fast-model', name: 'Fast' }] },
        { type: 'select', id: 'thinking', category: 'thought_level', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
      ],
    })
    state.update({
      sessionUpdate: 'config_option_update',
      configOptions: [{ type: 'select', id: 'model', category: 'model', currentValue: 'fast-model', options: [{ value: 'reasoning-model', name: 'Reasoning' }, { value: 'fast-model', name: 'Fast' }] }],
    })
    expect(state.catalog().current).toEqual({ provider: 'kimi', model: 'fast-model' })

    // Full session/load snapshot resets omitted fields cleanly.
    state.update({
      configOptions: [{ type: 'select', id: 'model', category: 'model', currentValue: 'reasoning-model', options: [{ value: 'reasoning-model', name: 'Reasoning' }] }],
    })
    expect(state.catalog().current).toEqual({ provider: 'kimi', model: 'reasoning-model' })
  })

  it('maintains built-in ACP parity contracts and dynamic kimi workspace control dispatch', async () => {
    for (const backend of ACP_CATALOG_BACKENDS) {
      expect(acpWorkspacePrefix(backend)).toBe(`${backend}:cwd:`)
      expect(sessionPrefix(backend)).toBe(backend === 'antigravity' ? 'acp:' : `${backend}:`)
      expect(acpBackendProvider(backend)).toBe(backend)
      expect(acpBackendLabel(backend).length).toBeGreaterThan(0)
      if (backend !== 'opencode') {
        expect(ADAPTER_LABELS[backend]).toBe(acpBackendLabel(backend))
      }
      expect(buildAuthDiagnosticFromMetadata(
        backend,
        parseInitializeMetadata({ authMethods: [{ id: 'cli', name: 'CLI', type: 'terminal' }] }),
        undefined,
        false,
      ).loginCommand).toBeDefined()
    }
    expect(remoteHostFeatures()).toEqual({
      commandList: false,
      fileViewer: false,
      terminal: false,
      remoteGateway: false,
      codex: false,
      cursor: false,
      antigravity: false,
      opencode: false,
      pluginRoute: false,
    })

    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sessionStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => { store.set(k, v) },
          removeItem: (k: string) => { store.delete(k) },
        },
      },
    })
    try {
      for (const backend of ['kimi', 'my-agent'] as const) {
        store.set(pendingWorkspaceSelectionKey, JSON.stringify({ targetDeviceId: 'h1', workspaceId: `${backend}:cwd:%2Frepo`, backend }))
        expect(storedWorkspaceSelection()).toEqual({ targetDeviceId: 'h1', workspaceId: `${backend}:cwd:%2Frepo`, backend })
      }
      store.set(pendingWorkspaceSelectionKey, JSON.stringify({ targetDeviceId: 'h1', workspaceId: 'acp:bad', backend: 'acp' }))
      expect(storedWorkspaceSelection()).toBeUndefined()
      store.set(pendingWorkspaceSelectionKey, JSON.stringify({ targetDeviceId: 'h1', workspaceId: 'kimi:cwd:%2Frepo', backend: 123 }))
      expect(storedWorkspaceSelection()).toBeUndefined()
    } finally {
      delete (globalThis as { window?: unknown }).window
    }

    const listCursorWorkspaces = vi.fn(async () => [{ workspaceId: 'kimi:cwd:%2Frepo' }])
    const openCursorWorkspace = vi.fn(async () => ({ opened: true }))
    const createCursorWorkspace = vi.fn(async () => ({ workspaceId: 'kimi:cwd:%2Frepo' }))
    const control = new ClientControl({
      listCursorWorkspaces,
      openCursorWorkspace,
      createCursorWorkspace,
    } as never)
    const signal = new AbortController().signal
    expect(await control.handleControl('kimi.workspaces.list', { targetDeviceId: 'h1' }, signal)).toMatchObject({ ok: true })
    expect(listCursorWorkspaces).toHaveBeenCalledWith('h1', signal, 'kimi')
    expect(await control.handleControl('kimi.workspace.open', { targetDeviceId: 'h1', workspaceId: 'kimi:cwd:%2Frepo' }, signal)).toMatchObject({ ok: true })
    expect(openCursorWorkspace).toHaveBeenCalledWith('h1', 'kimi:cwd:%2Frepo', signal, 'kimi')
    expect(await control.handleControl('kimi.workspace.create', { targetDeviceId: 'h1', path: '/repo' }, signal)).toMatchObject({ ok: true })
    expect(createCursorWorkspace).toHaveBeenCalledWith('h1', '/repo', signal, 'kimi')

    // Issue #5: workspace.selection.consume must preserve valid custom ACP backend IDs alongside built-ins.
    const consumeWorkspaceSelection = vi.fn((selection: unknown) => selection)
    const selectionControl = new ClientControl({ consumeWorkspaceSelection } as never)
    expect(await selectionControl.handleControl('workspace.selection.consume', {
      targetDeviceId: 'h1',
      workspaceId: 'my-agent:cwd:%2Frepo',
      backend: 'my-agent',
    }, signal)).toMatchObject({
      ok: true,
      value: { targetDeviceId: 'h1', workspaceId: 'my-agent:cwd:%2Frepo', backend: 'my-agent' },
    })
  })

  it('populates lastHistoryMetadata during live history reload and prevents timeout tombstone (Issues #1 & #3)', async () => {
    let dropLoad = false
    const { client } = setup((message, child) => {
      if (message.method === 'session/new') {
        child.reply(message, {
          sessionId: 'kimi-meta-1',
          modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] },
        })
        child.update('kimi-meta-1', {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'plan', description: 'Enter plan mode' }],
        })
        return true
      }
      if (message.method === 'session/load') {
        if (dropLoad) return true
        child.update('kimi-meta-1', chunk('user_message_chunk', 'q1'))
        child.update('kimi-meta-1', chunk('agent_message_chunk', 'a1'))
        queueMicrotask(() => child.reply(message, {
          modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] },
        }))
        return true
      }
      if (message.method === 'session/prompt') {
        child.stdout.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id: 'live-perm-1',
          method: 'session/request_permission',
          params: { sessionId: 'kimi-meta-1', options: [{ kind: 'allow_once', optionId: 'allow', name: 'Allow' }] },
        })}\n`)
        child.update('kimi-meta-1', chunk('agent_message_chunk', 'live-after-timeout'))
        queueMicrotask(() => child.reply(message, { stopReason: 'end_turn' }))
        return true
      }
      return false
    })
    const inbound: Array<Record<string, any>> = []
    client.onInbound(msg => inbound.push(msg as Record<string, any>))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await client.start()
      await client.call('session/new', { cwd: '/work/repo', mcpServers: [] })
      await tick()
      await client.history('kimi-meta-1', '/work/repo')
      expect(client.lastHistoryMetadata('kimi-meta-1')).toMatchObject({
        modes: { currentModeId: 'default' },
        commands: [{ name: 'plan' }],
      })

      // Trigger timeout in readLiveHistory (unresponded session/load).
      dropLoad = true
      const failedRead = client.history('kimi-meta-1', '/work/repo').catch(err => err)
      await vi.advanceTimersByTimeAsync(65_000)
      expect(await failedRead).toMatchObject({ code: 'KIMI_REQUEST_TIMEOUT' })

      dropLoad = false
      await client.call('session/load', { sessionId: 'kimi-meta-1', cwd: '/work/repo', mcpServers: [] })
      await client.call('session/prompt', { sessionId: 'kimi-meta-1', prompt: [{ type: 'text', text: 'go' }] })
      await tick()
      expect(inbound.some(m => m.method === 'session/request_permission' && m.id === 'live-perm-1')).toBe(true)
      expect(inbound.some(m => m.method === 'session/update' && m.params?.update?.content?.text === 'live-after-timeout')).toBe(true)
    } finally {
      vi.useRealTimers()
      await client.close()
    }
  })

  it('serializes prompt/history/load concurrency and isolates caller AbortSignals (Issues #2 & #4)', async () => {
      let finishPrompt!: () => void
      let finishPrimaryLoad!: () => void
      let finishHistoryLoad!: () => void
      let pausedUnloadedRace = false
      let loadCallsOnP1 = 0
      const order: string[] = []
      const { client, children } = setup((message, child) => {
        const procIndex = children.indexOf(child)
        if (message.method === 'session/new') {
          child.reply(message, { sessionId: message.params?.cwd === '/p2' ? 'kimi-abort-1' : 'kimi-race-1' })
          return true
        }
        if (message.method === 'session/prompt') {
          finishPrompt = () => child.reply(message, { stopReason: 'end_turn' })
          return true
        }
        if (message.method === 'session/load') {
          const sid = message.params.sessionId
          if (procIndex === 0) loadCallsOnP1++
          order.push(`p${procIndex}:${sid}`)
          if (sid === 'kimi-unloaded-race' && !pausedUnloadedRace) {
            pausedUnloadedRace = true
            finishPrimaryLoad = () => {
              child.update(sid, chunk('user_message_chunk', 'loaded'))
              child.update(sid, chunk('agent_message_chunk', 'ok'))
              child.reply(message, {})
            }
            return true
          }
          if (sid === 'kimi-unloaded-first' && procIndex === 1) {
            finishHistoryLoad = () => {
              child.update(sid, chunk('user_message_chunk', 'h1'))
              child.update(sid, chunk('agent_message_chunk', 'a1'))
              child.reply(message, {})
            }
            return true
          }
          if (sid === 'kimi-abort-1') {
            finishHistoryLoad = () => {
              child.update(sid, chunk('user_message_chunk', 'shared'))
              child.update(sid, chunk('agent_message_chunk', 'done'))
              child.reply(message, {})
            }
            return true
          }
          child.reply(message, {})
          return true
        }
        return false
      })
      try {
        await client.start()

        // 2a: Rejected overlapping session/prompt must NOT clear activePrompts for the running prompt.
        await client.call('session/new', { cwd: '/p1', mcpServers: [] })
        const p1 = client.call('session/prompt', { sessionId: 'kimi-race-1', prompt: [{ type: 'text', text: 'turn1' }] })
        await vi.waitFor(() => expect(children[0]!.sent.some(m => m.method === 'session/prompt')).toBe(true))
        await expect(client.call('session/prompt', { sessionId: 'kimi-race-1', prompt: [{ type: 'text', text: 'turn2' }] }))
          .rejects.toMatchObject({ code: 'PROMPT_IN_PROGRESS' })
        loadCallsOnP1 = 0
        await client.history('kimi-race-1', '/p1')
        expect(loadCallsOnP1).toBe(0)
        finishPrompt()
        await p1

        // 2b: Unloaded session/load in flight on primary process must serialize with history() without spawning a 2nd process.
        const countBefore = children.length
        const primaryLoad = client.call('session/load', { sessionId: 'kimi-unloaded-race', cwd: '/p1', mcpServers: [] })
        await vi.waitFor(() => expect(order).toContain('p0:kimi-unloaded-race'))
        const histDuringLoad = client.history('kimi-unloaded-race', '/p1')
        await tick()
        expect(children.length).toBe(countBefore)
        finishPrimaryLoad()
        await primaryLoad
        await histDuringLoad
        expect(children.length).toBe(countBefore)

        // 2c: In-flight unloaded history() on temporary process blocks primary session/load until finished.
        order.length = 0
        const unloadedHist = client.history('kimi-unloaded-first', '/p1')
        await vi.waitFor(() => expect(order).toContain('p1:kimi-unloaded-first'))
        const subsequentLoad = client.call('session/load', { sessionId: 'kimi-unloaded-first', cwd: '/p1', mcpServers: [] })
        await tick()
        expect(order).toEqual(['p1:kimi-unloaded-first'])
        finishHistoryLoad()
        await unloadedHist
        await subsequentLoad
        expect(order).toEqual(['p1:kimi-unloaded-first', 'p0:kimi-unloaded-first'])

        // 4: Aborting Caller A rejects immediately without blocking or breaking Caller B on the same live history read.
        await client.call('session/new', { cwd: '/p2', mcpServers: [] })
        const abortA = new AbortController()
        const abortB = new AbortController()
        const callA = client.history('kimi-abort-1', '/p2', abortA.signal)
        const callB = client.history('kimi-abort-1', '/p2', abortB.signal)
        await vi.waitFor(() => expect(order).toContain('p0:kimi-abort-1'))
        abortA.abort()
        await expect(callA).rejects.toThrow()
        finishHistoryLoad()
        const resB = await callB as Array<{ event: { type: string } }>
        expect(resB.filter(e => e.event.type === 'user/message')).toHaveLength(1)
      } finally {
        await client.close()
      }
    })

  it('surfaces a missing Kimi binary instead of reporting a ready backend', async () => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
    Object.assign(child, { stdin, stdout, stderr, exitCode: null, killed: false })
    child.kill = vi.fn(() => true)
    const client = new KimiAcpClient(undefined, undefined, () => {
      queueMicrotask(() => child.emit('error', new Error('spawn kimi ENOENT')))
      return child
    })
    await expect(client.start()).rejects.toMatchObject({ code: 'KIMI_BINARY_UNAVAILABLE' })
    expect(client.isReady()).toBe(false)
  })

  it('suppresses requests during Kimi session/load replay and after load timeout', async () => {
    const { client, children } = setup(message => message.method === 'session/load')
    const inbound = vi.fn()
    client.onInbound(inbound)
    try {
      await client.start()
      const timedOut = client.call('session/load', { sessionId: 'kimi-replay', cwd: '/work/repo' }, 25).then(
        result => ({ result, error: undefined }),
        error => ({ result: undefined, error }),
      )
      await vi.waitFor(() => expect(children[0]!.sent.some(m => m.method === 'session/load')).toBe(true))
      children[0]!.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 'kimi-perm-1',
        method: 'session/request_permission',
        params: { sessionId: 'kimi-replay', options: [] },
      })}\n`)
      expect((await timedOut).error).toMatchObject({ code: 'KIMI_REQUEST_TIMEOUT' })
      children[0]!.update('kimi-replay', chunk('agent_message_chunk', 'late-kimi-replay'))
      await tick()
      expect(inbound).not.toHaveBeenCalled()
      expect(children[0]!.sent.find(m => m.id === 'kimi-perm-1')?.result).toEqual({ outcome: { outcome: 'cancelled' } })
    } finally { await client.close() }
  })
})
