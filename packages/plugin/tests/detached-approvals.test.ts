import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostAttentionTracker } from '../src/attention-tracker.js'
import {
  DEFAULT_DETACHED_APPROVAL_GRACE_SEC,
  MAX_DETACHED_APPROVAL_GRACE_SEC,
  clampDetachedApprovalGraceSec,
  resolveConfig,
} from '../src/config.js'
import { DetachedApprovalBudget } from '../src/detached-approval-budget.js'
import type { SafeLogger } from '../src/logging.js'
import { CodexRemoteDomain } from '../src/codex/domain.js'
import type { CodexAppServerInbound, CodexAppServerLike } from '../src/codex/app-server.js'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import type { CursorAcpInbound, CursorAcpLike } from '../src/acp/adapters/cursor-process.js'

const tempDirs: string[] = []
afterEach(() => {
  vi.useRealTimers()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-detached-approval-'))
  tempDirs.push(dir)
  return dir
}

function silentLogger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as SafeLogger
}

class FakeCodexAppServer implements CodexAppServerLike {
  readonly calls: Array<{ method: string; params: unknown }> = []
  readonly responses: Array<{ id: string | number; result: unknown }> = []
  readonly errors: Array<{ id: string | number; code: number; message: string }> = []
  private readonly inboundListeners = new Set<(message: CodexAppServerInbound) => void>()
  private readonly unavailableListeners = new Set<(code: string) => void>()
  private ready = false
  respondDelayMs = 0

  constructor(private readonly root: string) {}

  async start(): Promise<void> { this.ready = true }
  isReady(): boolean { return this.ready }

  async call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'account/read') return { requiresOpenaiAuth: false, account: { type: 'pro' } }
    if (method === 'project/list') {
      return { data: [{ id: 'proj-1', name: 'Repo', roots: [{ path: this.root }] }], nextCursor: null }
    }
    if (method === 'thread/read') {
      const threadId = (params as { threadId: string }).threadId
      return { thread: { id: threadId, projectId: 'proj-1', cwd: this.root, name: 'Test Thread', turns: [] } }
    }
    if (method === 'thread/goal/get') return { goal: null }
    if (method === 'turn/start') return { turn: { id: 'turn-1' } }
    if (method === 'turn/interrupt') return {}
    if (method === 'thread/unsubscribe') return { status: 'notLoaded' }
    if (method === 'thread/settings/update') return {}
    return {}
  }

  async respond(id: string | number, result: unknown): Promise<void> {
    if (this.respondDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.respondDelayMs))
    }
    this.responses.push({ id, result })
  }

  async respondError(id: string | number, code: number, message: string): Promise<void> {
    this.errors.push({ id, code, message })
  }

  onInbound(listener: (message: CodexAppServerInbound) => void): () => void {
    this.inboundListeners.add(listener)
    return () => { this.inboundListeners.delete(listener) }
  }

  onUnavailable(listener: (code: string) => void): () => void {
    this.unavailableListeners.add(listener)
    return () => { this.unavailableListeners.delete(listener) }
  }

  emit(message: CodexAppServerInbound): void {
    for (const listener of this.inboundListeners) listener(message)
  }

  async close(): Promise<void> { this.ready = false }
}

function makeAcpClient() {
  let ready = false
  let inboundListener: ((message: CursorAcpInbound) => void) | undefined
  let unavailableListener: ((code: string) => void) | undefined
  const responses: Array<{ id: string | number; result: unknown }> = []
  const errors: Array<{ id: string | number; code: number; message: string }> = []
  let respondDelayMs = 0

  const client: CursorAcpLike = {
    start: vi.fn(async () => { ready = true }),
    isReady: () => ready,
    call: vi.fn(async (method: string) => {
      if (method === 'session/new') return { sessionId: 'sess-1' }
      if (method === 'session/prompt') return new Promise(() => { /* stays in progress */ })
      if (method === 'session/cancel') return { stopReason: 'cancelled' }
      return {}
    }),
    respond: vi.fn(async (id: string | number, result: unknown) => {
      if (respondDelayMs > 0) await new Promise(resolve => setTimeout(resolve, respondDelayMs))
      responses.push({ id, result })
    }),
    respondError: vi.fn(async (id: string | number, code: number, message: string) => {
      errors.push({ id, code, message })
    }),
    onInbound: listener => { inboundListener = listener; return () => { inboundListener = undefined } },
    onUnavailable: listener => { unavailableListener = listener; return () => { unavailableListener = undefined } },
    close: vi.fn(async () => { ready = false }),
  }

  return {
    client,
    responses,
    errors,
    setRespondDelay(ms: number) { respondDelayMs = ms },
    emit: (message: CursorAcpInbound) => inboundListener?.(message),
    crash: (code = 'PROCESS_EXITED') => {
      ready = false
      unavailableListener?.(code)
    },
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10))

const ACP_OPTIONS = [
  { kind: 'allow_once', optionId: 'opt-allow' },
  { kind: 'reject_once', optionId: 'opt-reject' },
  { kind: 'allow_always', optionId: 'opt-always' },
]

function findCodexApprovalHandle(frames: Array<{ event: string; data: unknown }>): string | undefined {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const data = frames[i]!.data as { frame?: { method?: string; params?: { requestHandle?: string } } } | undefined
    if (data?.frame?.method === 'item/commandExecution/requestApproval' && typeof data.frame.params?.requestHandle === 'string') {
      return data.frame.params.requestHandle
    }
  }
  return undefined
}

function findAcpApprovalHandle(
  frames: Array<{ event: string; data: unknown }>,
  method: string,
): string | undefined {
  const match = frames.find(f => (f.data as { frame?: { method?: string } }).frame?.method === method)
  return (match?.data as { frame?: { params?: { requestHandle?: string } } } | undefined)?.frame?.params?.requestHandle
}

function createCodexHarness(options: {
  graceSec?: number
  budget?: DetachedApprovalBudget
  attention?: HostAttentionTracker
} = {}) {
  const root = tempRoot()
  const app = new FakeCodexAppServer(root)
  const attention = options.attention ?? new HostAttentionTracker({ debounceMs: 50 })
  const ownsAttention = options.attention === undefined
  const domain = new CodexRemoteDomain(
    { enabled: true, binary: 'codex' },
    silentLogger(),
    () => app,
    [1_000],
    60_000,
    30_000,
    options.graceSec ?? 120,
    attention,
    options.budget,
  )
  return {
    app,
    attention,
    domain,
    async dispose() {
      await domain.close()
      if (ownsAttention) await attention.close()
    },
  }
}

function createAcpHarness(options: {
  graceSec?: number
  restartDelaysMs?: readonly number[]
  budget?: DetachedApprovalBudget
  attention?: HostAttentionTracker
} = {}) {
  const acp = makeAcpClient()
  const attention = options.attention ?? new HostAttentionTracker({ debounceMs: 50 })
  const ownsAttention = options.attention === undefined
  const gateway = new AcpRemoteGateway(
    { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: [] }] },
    silentLogger(),
    () => acp.client,
    options.restartDelaysMs ?? [1_000],
    undefined,
    undefined,
    undefined,
    options.graceSec ?? 120,
    attention,
    options.budget,
  )
  const drainInbound = () => (gateway as unknown as { inboundChain: Promise<void> }).inboundChain
  return {
    acp,
    attention,
    gateway,
    drainInbound,
    async dispose() {
      await gateway.close()
      if (ownsAttention) await attention.close()
    },
  }
}

describe('detached approval config', () => {
  it('defaults to 300s and clamps into 0..600s', () => {
    expect(resolveConfig({}, {}).detachedApprovalGraceSec).toBe(DEFAULT_DETACHED_APPROVAL_GRACE_SEC)
    expect(resolveConfig({ detachedApprovalGraceSec: 0 }, {}).detachedApprovalGraceSec).toBe(0)
    expect(resolveConfig({ detachedApprovalGraceSec: -50 }, {}).detachedApprovalGraceSec).toBe(0)
    expect(resolveConfig({ detachedApprovalGraceSec: 999 }, {}).detachedApprovalGraceSec).toBe(MAX_DETACHED_APPROVAL_GRACE_SEC)
    expect(clampDetachedApprovalGraceSec(120.9)).toBe(120)
  })
})

describe('Codex detached approval hold invariants', () => {
  it('transitions a live approval to detached on disconnect without declining or unsubscribing', async () => {
    const h = createCodexHarness()
    try {
      await h.domain.start()
      const framesA: Array<{ event: string; data: unknown }> = []
      const peerA = h.domain.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async (event, data) => {
        framesA.push({ event, data })
      })!
      await peerA.openStream({ streamId: 's-a', threadId: 'thr-1' })
      await peerA.call({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Run build' }] } })

      h.app.emit({
        kind: 'request',
        id: 101,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'thr-1', turnId: 'turn-1', command: 'pnpm build' },
      })
      await flush()
      expect(findCodexApprovalHandle(framesA)).toBeTruthy()
      expect(h.attention.list().items.find(i => i.status === 'waiting_approval')?.detachedExpiresAt).toBeUndefined()

      await peerA.closeAll()
      expect(h.app.responses).toEqual([])
      expect(h.app.calls.filter(c => c.method === 'thread/unsubscribe')).toHaveLength(0)
      expect(h.attention.list().items.find(i => i.status === 'waiting_approval')?.detachedExpiresAt).toBeTypeOf('number')
    } finally {
      await h.dispose()
    }
  })

  it('rejects concurrent turn/start and permissionPreset mutations while a detached approval is pending', async () => {
    const h = createCodexHarness()
    try {
      await h.domain.start()
      const peerA = h.domain.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async () => undefined)!
      await peerA.openStream({ streamId: 's-a', threadId: 'thr-1' })
      await peerA.call({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Run build' }] } })
      h.app.emit({
        kind: 'request',
        id: 101,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'thr-1', turnId: 'turn-1', command: 'pnpm build' },
      })
      await flush()
      await peerA.closeAll()

      const peerB = h.domain.createPeer({ connectionId: 'conn-b', peerDeviceId: 'dev-b' }, async () => undefined)!
      await expect(peerB.call({
        method: 'turn/start',
        params: { threadId: 'thr-1', input: [{ type: 'text', text: 'New turn' }] },
      })).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY' })

      await expect(peerB.call({
        method: 'thread/resume',
        params: { threadId: 'thr-1', permissionPreset: 'danger-full-access' },
      })).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY' })

      await peerB.closeAll()
    } finally {
      await h.dispose()
    }
  })

  it('synthesizes detached approval on openStream without polluting recentFrames and enforces single-assignment under dual-peer respond', async () => {
    const h = createCodexHarness()
    try {
      await h.domain.start()
      const framesA: Array<{ event: string; data: unknown }> = []
      const peerA = h.domain.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async (event, data) => {
        framesA.push({ event, data })
      })!
      await peerA.openStream({ streamId: 's-a', threadId: 'thr-1' })
      await peerA.call({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Run build' }] } })
      h.app.emit({
        kind: 'request',
        id: 101,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'thr-1', turnId: 'turn-1', command: 'pnpm build' },
      })
      await flush()
      const handle = findCodexApprovalHandle(framesA)!
      await peerA.closeAll()

      const framesB: Array<{ event: string; data: unknown }> = []
      const peerB = h.domain.createPeer({ connectionId: 'conn-b', peerDeviceId: 'dev-b' }, async (event, data) => {
        framesB.push({ event, data })
      })!
      const peerC = h.domain.createPeer({ connectionId: 'conn-c', peerDeviceId: 'dev-c' }, async () => undefined)!

      await peerB.openStream({ streamId: 's-b', threadId: 'thr-1' })
      expect(findCodexApprovalHandle(framesB)).toBe(handle)
      const recentFrames = (h.domain as unknown as { recentFrames: Map<string, { frames: Array<{ method: string }> }> }).recentFrames
      expect(recentFrames.get('thr-1')?.frames.some(f => f.method.includes('requestApproval')) ?? false).toBe(false)

      h.app.respondDelayMs = 25
      const [resB, resC] = await Promise.allSettled([
        peerB.respond({ requestHandle: handle, decision: 'accept' }),
        peerC.respond({ requestHandle: handle, decision: 'decline' }),
      ])
      const fulfilled = [resB, resC].filter(r => r.status === 'fulfilled')
      const rejected = [resB, resC].filter(r => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CODEX_APPROVAL_NOT_FOUND' })
      expect(h.app.responses).toEqual([{ id: 101, result: { decision: 'accept' } }])
      expect(h.attention.list().items.some(i => i.status === 'waiting_approval')).toBe(false)

      await peerB.closeAll()
      await peerC.closeAll()
    } finally {
      await h.dispose()
    }
  })

  it('caps inbound detached approvals at 16 and auto-declines all held approvals on grace expiry', async () => {
    const h = createCodexHarness({ graceSec: 1 })
    vi.useFakeTimers()
    try {
      await h.domain.start()
      const peerA = h.domain.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async () => undefined)!
      await peerA.openStream({ streamId: 's-a', threadId: 'thr-1' })
      await peerA.call({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Work' }] } })
      h.app.emit({ kind: 'notification', method: 'turn/started', params: { threadId: 'thr-1', turn: { id: 'turn-1' } } })
      await vi.advanceTimersByTimeAsync(0)
      await peerA.closeAll()

      for (let i = 1; i <= 17; i += 1) {
        h.app.emit({
          kind: 'request',
          id: 200 + i,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'thr-1', turnId: 'turn-1', command: `cmd-${i}` },
        })
      }
      await vi.advanceTimersByTimeAsync(0)
      expect(h.app.responses).toEqual([{ id: 217, result: { decision: 'decline' } }])
      expect(h.attention.list().items.filter(i => i.status === 'waiting_approval')).toHaveLength(16)

      await vi.advanceTimersByTimeAsync(1_100)
      expect(h.app.responses).toHaveLength(17)
      expect(h.attention.list().items.filter(i => i.status === 'waiting_approval')).toHaveLength(0)
    } finally {
      await h.dispose()
    }
  })

  it('declines pending approvals synchronously on turn/interrupt', async () => {
    const h = createCodexHarness()
    try {
      await h.domain.start()
      const peer = h.domain.createPeer({ connectionId: 'conn-i', peerDeviceId: 'dev-i' }, async () => undefined)!
      await peer.openStream({ streamId: 's-i', threadId: 'thr-1' })
      await peer.call({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Work' }] } })
      h.app.emit({ kind: 'request', id: 301, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr-1', command: 'echo 1' } })
      await flush()
      await peer.call({ method: 'turn/interrupt', params: { threadId: 'thr-1', turnId: 'turn-1' } })
      await flush()
      expect(h.app.responses).toContainEqual({ id: 301, result: { decision: 'decline' } })
    } finally {
      await h.dispose()
    }
  })

  it('declines pending approvals on thread/closed notification', async () => {
    const h = createCodexHarness()
    try {
      await h.domain.start()
      const peer = h.domain.createPeer({ connectionId: 'conn-tc', peerDeviceId: 'dev-tc' }, async () => undefined)!
      await peer.openStream({ streamId: 's-tc', threadId: 'thr-1' })
      await peer.call({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Work' }] } })
      h.app.emit({ kind: 'request', id: 302, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr-1', command: 'echo 2' } })
      await flush()
      h.app.emit({ kind: 'notification', method: 'thread/closed', params: { threadId: 'thr-1' } })
      await flush()
      expect(h.app.responses).toContainEqual({ id: 302, result: { decision: 'decline' } })
    } finally {
      await h.dispose()
    }
  })

  it('declines pending approvals on domain close()', async () => {
    const h = createCodexHarness()
    try {
      await h.domain.start()
      const peer = h.domain.createPeer({ connectionId: 'conn-cl', peerDeviceId: 'dev-cl' }, async () => undefined)!
      await peer.openStream({ streamId: 's-cl', threadId: 'thr-1' })
      await peer.call({ method: 'turn/start', params: { threadId: 'thr-1', input: [{ type: 'text', text: 'Work' }] } })
      h.app.emit({ kind: 'request', id: 303, method: 'item/commandExecution/requestApproval', params: { threadId: 'thr-1', command: 'echo 3' } })
      await flush()
      await h.domain.close()
      expect(h.app.responses).toContainEqual({ id: 303, result: { decision: 'decline' } })
    } finally {
      await h.dispose()
    }
  })
})

describe('ACP detached approval hold invariants', () => {
  it('detaches allowlisted permission & ask_question on disconnect while rejecting non-allowlisted cursor/create_plan', async () => {
    const h = createAcpHarness()
    try {
      await h.gateway.start()
      const peerA = h.gateway.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async () => undefined)!
      await peerA.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peerA.openStream({ streamId: 's-a', sessionId: 'sess-1' })
      await peerA.call({ method: 'session/prompt', params: { backend: 'cursor', sessionId: 'sess-1', prompt: [{ type: 'text', text: 'Hi' }] } })

      h.acp.emit({ kind: 'request', id: 10, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      h.acp.emit({ kind: 'request', id: 11, method: 'cursor/ask_question', params: { sessionId: 'sess-1', question: 'Proceed?' } })
      h.acp.emit({ kind: 'request', id: 12, method: 'cursor/create_plan', params: { sessionId: 'sess-1', plan: 'step 1' } })
      await h.drainInbound()

      await peerA.closeAll()
      expect(h.acp.errors.map(e => e.id)).toEqual([12])
      expect(h.attention.list().items.filter(i => i.detachedExpiresAt !== undefined)).toHaveLength(2)
    } finally {
      await h.dispose()
    }
  })

  it('synthesizes detached approvals on openStream, guards live owner with REQUEST_CONFLICT, and forbids allow-always', async () => {
    const h = createAcpHarness()
    try {
      await h.gateway.start()
      const framesA: Array<{ event: string; data: unknown }> = []
      const peerA = h.gateway.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async (e, d) => {
        framesA.push({ event: e, data: d })
      })!
      await peerA.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peerA.openStream({ streamId: 's-a', sessionId: 'sess-1' })
      await peerA.call({ method: 'session/prompt', params: { backend: 'cursor', sessionId: 'sess-1', prompt: [{ type: 'text', text: 'Hi' }] } })

      h.acp.emit({ kind: 'request', id: 10, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      h.acp.emit({ kind: 'request', id: 11, method: 'cursor/ask_question', params: { sessionId: 'sess-1', question: 'Proceed?' } })
      await h.drainInbound()
      const permHandle = findAcpApprovalHandle(framesA, 'session/request_permission')!
      const qHandle = findAcpApprovalHandle(framesA, 'cursor/ask_question')!
      await peerA.closeAll()

      const framesB: Array<{ event: string; data: unknown }> = []
      const peerB = h.gateway.createPeer({ connectionId: 'conn-b', peerDeviceId: 'dev-b' }, async (e, d) => {
        framesB.push({ event: e, data: d })
      })!
      const peerC = h.gateway.createPeer({ connectionId: 'conn-c', peerDeviceId: 'dev-c' }, async () => undefined)!

      await peerB.openStream({ streamId: 's-b', sessionId: 'sess-1' })
      expect(findAcpApprovalHandle(framesB, 'session/request_permission')).toBe(permHandle)
      expect(findAcpApprovalHandle(framesB, 'cursor/ask_question')).toBe(qHandle)

      await expect(peerC.respond({ requestHandle: permHandle, decision: 'allow-once' })).rejects.toMatchObject({
        code: 'REQUEST_CONFLICT',
      })
      await expect(peerB.respond({ requestHandle: permHandle, decision: 'allow-always' })).rejects.toMatchObject({
        code: 'INVALID_MESSAGE',
      })
    } finally {
      await h.dispose()
    }
  })

  it('enforces single-assignment on concurrent detached respond and resolves question afterward', async () => {
    const h = createAcpHarness()
    try {
      await h.gateway.start()
      const framesA: Array<{ event: string; data: unknown }> = []
      const peerA = h.gateway.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async (e, d) => {
        framesA.push({ event: e, data: d })
      })!
      await peerA.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peerA.openStream({ streamId: 's-a', sessionId: 'sess-1' })
      await peerA.call({ method: 'session/prompt', params: { backend: 'cursor', sessionId: 'sess-1', prompt: [{ type: 'text', text: 'Hi' }] } })

      h.acp.emit({ kind: 'request', id: 10, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      h.acp.emit({ kind: 'request', id: 11, method: 'cursor/ask_question', params: { sessionId: 'sess-1', question: 'Proceed?' } })
      await h.drainInbound()
      const permHandle = findAcpApprovalHandle(framesA, 'session/request_permission')!
      const qHandle = findAcpApprovalHandle(framesA, 'cursor/ask_question')!
      await peerA.closeAll()

      const peerC = h.gateway.createPeer({ connectionId: 'conn-c', peerDeviceId: 'dev-c' }, async () => undefined)!
      const peerD = h.gateway.createPeer({ connectionId: 'conn-d', peerDeviceId: 'dev-d' }, async () => undefined)!
      h.acp.setRespondDelay(25)
      const [rC, rD] = await Promise.allSettled([
        peerC.respond({ requestHandle: permHandle, decision: 'allow-once' }),
        peerD.respond({ requestHandle: permHandle, decision: 'reject-once' }),
      ])
      expect([rC, rD].filter(r => r.status === 'fulfilled')).toHaveLength(1)
      expect([rC, rD].filter(r => r.status === 'rejected')).toHaveLength(1)
      expect(h.acp.responses).toEqual([{ id: 10, result: { outcome: { outcome: 'selected', optionId: 'opt-allow' } } }])

      const winner = rC.status === 'fulfilled' ? peerC : peerD
      await winner.respond({ requestHandle: qHandle, decision: 'allow-once', result: { outcome: 'answered', response: 'yes' } })
      expect(h.acp.responses).toHaveLength(2)
      expect(h.attention.list().items.some(i => i.status === 'waiting_approval' || i.status === 'waiting_question')).toBe(false)
    } finally {
      await h.dispose()
    }
  })

  it('caps inbound detached approvals at 16 and auto-rejects all held approvals on grace expiry', async () => {
    const h = createAcpHarness({ graceSec: 1 })
    vi.useFakeTimers()
    try {
      await h.gateway.start()
      const peerA = h.gateway.createPeer({ connectionId: 'conn-a', peerDeviceId: 'dev-a' }, async () => undefined)!
      await peerA.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peerA.call({ method: 'session/prompt', params: { backend: 'cursor', sessionId: 'sess-1', prompt: [{ type: 'text', text: 'Run' }] } })
      await peerA.closeAll()

      for (let i = 1; i <= 17; i += 1) {
        h.acp.emit({ kind: 'request', id: 500 + i, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      }
      await h.drainInbound()
      expect(h.acp.errors.map(e => e.id)).toEqual([517])
      expect(h.attention.list().items.filter(i => i.status === 'waiting_approval')).toHaveLength(16)

      await vi.advanceTimersByTimeAsync(1_100)
      expect(h.acp.errors).toHaveLength(17)
      expect(h.attention.list().items.filter(i => i.status === 'waiting_approval')).toHaveLength(0)
    } finally {
      await h.dispose()
    }
  })

  it('rejects pending approvals on session/cancel', async () => {
    const h = createAcpHarness()
    try {
      await h.gateway.start()
      const peer = h.gateway.createPeer({ connectionId: 'conn-c', peerDeviceId: 'dev-c' }, async () => undefined)!
      await peer.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peer.openStream({ streamId: 's-c', sessionId: 'sess-1' })
      h.acp.emit({ kind: 'request', id: 601, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      await h.drainInbound()
      await peer.call({ method: 'session/cancel', params: { sessionId: 'sess-1' } })
      expect(h.acp.errors.some(e => e.id === 601)).toBe(true)
    } finally {
      await h.dispose()
    }
  })

  it('rejects pending approvals on gateway close()', async () => {
    const h = createAcpHarness()
    try {
      await h.gateway.start()
      const peer = h.gateway.createPeer({ connectionId: 'conn-cl', peerDeviceId: 'dev-cl' }, async () => undefined)!
      await peer.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peer.openStream({ streamId: 's-cl', sessionId: 'sess-1' })
      h.acp.emit({ kind: 'request', id: 602, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      await h.drainInbound()
      await h.gateway.close()
      expect(h.acp.errors.some(e => e.id === 602)).toBe(true)
    } finally {
      await h.dispose()
    }
  })

  it('rejects pending approvals and clears attention on backend handleUnavailable crash', async () => {
    const h = createAcpHarness({ restartDelaysMs: [] })
    try {
      await h.gateway.start()
      const peer = h.gateway.createPeer({ connectionId: 'conn-u', peerDeviceId: 'dev-u' }, async () => undefined)!
      await peer.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peer.openStream({ streamId: 's-u', sessionId: 'sess-1' })
      h.acp.emit({ kind: 'request', id: 701, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      await h.drainInbound()
      expect(h.attention.list().items.some(i => i.status === 'waiting_approval')).toBe(true)

      h.acp.crash('PROCESS_EXITED')
      await flush()
      expect(h.acp.errors.some(e => e.id === 701)).toBe(true)
      expect(h.attention.list().items.some(i => i.status === 'waiting_approval')).toBe(false)
    } finally {
      await h.dispose()
    }
  })

  it('rejects pending approvals on backend reconfigure()', async () => {
    const h = createAcpHarness({ restartDelaysMs: [] })
    try {
      await h.gateway.start()
      const peer = h.gateway.createPeer({ connectionId: 'conn-r', peerDeviceId: 'dev-r' }, async () => undefined)!
      await peer.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await peer.openStream({ streamId: 's-r', sessionId: 'sess-1' })
      h.acp.emit({ kind: 'request', id: 702, method: 'session/request_permission', params: { sessionId: 'sess-1', options: ACP_OPTIONS } })
      await h.drainInbound()
      await h.gateway.reconfigure({ enabled: false, backends: [{ id: 'cursor', enabled: false, command: 'agent', args: [] }] })
      expect(h.acp.errors.some(e => e.id === 702)).toBe(true)
    } finally {
      await h.dispose()
    }
  })
})

describe('shared global detached approval cap across Codex + ACP', () => {
  it('enforces a combined <= 16 cap across Codex and ACP and frees slots cross-backend when resolved', async () => {
    const sharedBudget = new DetachedApprovalBudget()
    const attention = new HostAttentionTracker({ debounceMs: 50 })
    const codex = createCodexHarness({ graceSec: 120, budget: sharedBudget, attention })
    const acp = createAcpHarness({ graceSec: 120, budget: sharedBudget, attention })
    try {
      await codex.domain.start()
      await acp.gateway.start()

      // Start an active detached Codex turn
      const codexFrames: Array<{ event: string; data: unknown }> = []
      const codexPeerA = codex.domain.createPeer({ connectionId: 'codex-a', peerDeviceId: 'dev-1' }, async (e, d) => {
        codexFrames.push({ event: e, data: d })
      })!
      await codexPeerA.openStream({ streamId: 'cs-1', threadId: 'thr-shared' })
      await codexPeerA.call({ method: 'turn/start', params: { threadId: 'thr-shared', input: [{ type: 'text', text: 'Work' }] } })
      codex.app.emit({ kind: 'notification', method: 'turn/started', params: { threadId: 'thr-shared', turn: { id: 'turn-1' } } })
      await flush()
      // Emit 1 approval before disconnect so we have a known handle we can resolve later
      codex.app.emit({
        kind: 'request',
        id: 1001,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'thr-shared', turnId: 'turn-1', command: 'cmd-1' },
      })
      await flush()
      const firstCodexHandle = findCodexApprovalHandle(codexFrames)!
      expect(firstCodexHandle).toBeTruthy()
      await codexPeerA.closeAll()

      // Hold 9 more detached Codex approvals -> 10 Codex total
      for (let i = 2; i <= 10; i += 1) {
        codex.app.emit({
          kind: 'request',
          id: 1000 + i,
          method: 'item/commandExecution/requestApproval',
          params: { threadId: 'thr-shared', turnId: 'turn-1', command: `cmd-${i}` },
        })
      }
      await flush()
      expect(sharedBudget.count()).toBe(10)
      expect(codex.app.responses).toEqual([])

      // Start an active detached ACP prompt and hold 6 detached ACP approvals -> 10 + 6 = 16 total
      const acpPeerA = acp.gateway.createPeer({ connectionId: 'acp-a', peerDeviceId: 'dev-1' }, async () => undefined)!
      await acpPeerA.call({ method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      await acpPeerA.call({ method: 'session/prompt', params: { backend: 'cursor', sessionId: 'sess-1', prompt: [{ type: 'text', text: 'Run' }] } })
      await acpPeerA.closeAll()

      for (let i = 1; i <= 6; i += 1) {
        acp.acp.emit({
          kind: 'request',
          id: 2000 + i,
          method: 'session/request_permission',
          params: { sessionId: 'sess-1', options: ACP_OPTIONS },
        })
      }
      await acp.drainInbound()
      expect(sharedBudget.count()).toBe(16)
      expect(acp.acp.errors).toEqual([])

      // 17th detached approval on ACP is immediately rejected fail-closed
      acp.acp.emit({
        kind: 'request',
        id: 2007,
        method: 'session/request_permission',
        params: { sessionId: 'sess-1', options: ACP_OPTIONS },
      })
      await acp.drainInbound()
      expect(acp.acp.errors.map(e => e.id)).toEqual([2007])

      // 17th detached approval on Codex is also immediately declined fail-closed
      codex.app.emit({
        kind: 'request',
        id: 1011,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'thr-shared', turnId: 'turn-1', command: 'cmd-11' },
      })
      await flush()
      expect(codex.app.responses).toEqual([{ id: 1011, result: { decision: 'decline' } }])
      expect(sharedBudget.count()).toBe(16)

      // Resolving 1 Codex detached approval frees 1 slot for ACP!
      const codexPeerB = codex.domain.createPeer({ connectionId: 'codex-b', peerDeviceId: 'dev-2' }, async () => undefined)!
      await codexPeerB.respond({ requestHandle: firstCodexHandle, decision: 'accept' })
      expect(sharedBudget.count()).toBe(15)

      acp.acp.emit({
        kind: 'request',
        id: 2008,
        method: 'session/request_permission',
        params: { sessionId: 'sess-1', options: ACP_OPTIONS },
      })
      await acp.drainInbound()
      expect(sharedBudget.count()).toBe(16)
      expect(acp.acp.errors.map(e => e.id)).toEqual([2007])

      await codexPeerB.closeAll()
    } finally {
      await codex.dispose()
      await acp.dispose()
      await attention.close()
      expect(sharedBudget.count()).toBe(0)
    }
  })
})
