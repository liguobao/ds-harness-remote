import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, HistoryEntry, MuxStreamFrame, RemoteSession } from '../src/types'
import { applyMuxFrame, foldHistory } from '../src/state/event-reducer'
import { mergeAcpHistoryAndLive } from '../src/services/cursor'
import { mergeHistoryAndLive, prependHistory, reconcileDeliveryStates } from '../src/state/message-helpers'
import { workspaceStableKey } from '../src/lib/workspace-key'
import { ForegroundConnectionRecovery } from '../src/services/connection-recovery'

const { proxy, transport, storage, authenticate, acp, codex } = vi.hoisted(() => ({
  proxy: { sessionHistory: vi.fn(), messageFeedbackList: vi.fn(), sessionModels: vi.fn(),
    sessionList: vi.fn(), sessionCreate: vi.fn(), hostDescribe: vi.fn(), workspaceList: vi.fn(), workspaceArchiveSession: vi.fn(), sessionSelectPermission: vi.fn(), sessionPrompt: vi.fn(), sessionUpdateQueue: vi.fn() },
  transport: { connect: vi.fn(), close: vi.fn(), checkHealth: vi.fn(), refreshBackends: vi.fn(), hasCodex: vi.fn(), hasCursor: vi.fn(), hasAntigravity: vi.fn(), hasPi: vi.fn(), hasOpencode: vi.fn(), hasClaude: vi.fn(), hasHermes: vi.fn(), requireClaude: vi.fn(), requireHermes: vi.fn() },
  acp: { call: vi.fn(), transferCall: vi.fn(), openStream: vi.fn(), prompt: vi.fn(), sessionModels: vi.fn(), selectModel: vi.fn(), archiveSession: vi.fn(), createSession: vi.fn() },
  storage: { saveRecentWorkspaces: vi.fn(), saveLastConnectedDeviceId: vi.fn(), loadCodexPermissionPresets: vi.fn(), saveCodexPermissionPreset: vi.fn() },
  codex: { request: vi.fn(), subscribe: vi.fn() },
  authenticate: vi.fn(),
}))
vi.mock('expo-haptics', () => ({ impactAsync: async () => undefined, ImpactFeedbackStyle: { Light: 'light' } }))
vi.mock('../src/services/network-route', () => ({ resolveAutomaticPreferredTransports: async () => ['relay'] }))
vi.mock('../src/services/connection', () => ({ AndroidRemoteConnection: class {
  async configureHistory() {}
  requireProxy() { return proxy }
  connect = transport.connect
  close = transport.close
  checkHealth = transport.checkHealth
  refreshBackends = transport.refreshBackends
  hasCodex = transport.hasCodex
  requireCodex() { return codex }
  hasCursor = transport.hasCursor
  hasPi = transport.hasPi
  hasAntigravity = transport.hasAntigravity
  hasOpencode = transport.hasOpencode
  hasClaude = transport.hasClaude
  hasHermes = transport.hasHermes
  requireCursor() { return acp }
  requireAntigravity() { return acp }
  requirePi() { return acp }
  requireOpencode() { return acp }
  requireClaude() { transport.requireClaude(); return acp }
  requireHermes() { transport.requireHermes(); return acp }
  getNetworkDetails() { return Promise.resolve(undefined) }
  getStats() { return { mode: 'Relay', connected: true } }
} }))
vi.mock('../src/services/storage', () => storage)
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate } }))
import { useAppStore } from '../src/state/store'

const session: RemoteSession = { sessionId: 's1', updatedAt: 1, running: false, blank: false,
  projections: { values: { permissions: { currentValue: 'default' } } } }
const entry = (type: string, seq: number, data: Record<string, unknown>): HistoryEntry => ({
  event: { type, seq, time: 1000 + seq, data },
})
const call = (seq = 2, turn = 1, callId = 'c1') => entry('tool/call', seq, { turn, callId, name: 'bash' })
const result = (seq = 3, turn = 1, callId = 'c1') => entry('tool/result', seq, { turn, message: { source: { callId }, content: [] } })
const frame = (row: HistoryEntry): MuxStreamFrame => ({ rpcId: '', payload: { type: 'session/event', sessionId: 's1', event: row.event } })
const page = (events: HistoryEntry[], throughSeq = 10) => ({ events, throughSeq, hasMore: false })

const prepareScenario1 = () => {
  vi.resetAllMocks()
  transport.checkHealth.mockResolvedValue(true)
  transport.hasCodex.mockReturnValue(false)
  transport.hasCursor.mockReturnValue(false)
  transport.hasAntigravity.mockReturnValue(false)
  transport.hasPi.mockReturnValue(false)
  transport.hasOpencode.mockReturnValue(false)
  transport.hasClaude.mockReturnValue(false)
  transport.hasHermes.mockReturnValue(false)
  acp.call.mockResolvedValue([])
  acp.transferCall.mockResolvedValue({ events: [] })
  acp.prompt.mockResolvedValue({ accepted: true, stopReason: 'in_progress' })
  acp.openStream.mockImplementation(async () => ({ streamId: 'acp-test', close: async () => undefined }))
  useAppStore.setState({
    ...useAppStore.getInitialState(),
    selectedSession: session,
    selectedDevice: { deviceId: 'host' } as never,
    sessions: [session],
    connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
  })
  proxy.sessionHistory.mockResolvedValue(page([]))
  proxy.messageFeedbackList.mockResolvedValue([])
  proxy.sessionList.mockResolvedValue([session])
  proxy.workspaceList.mockResolvedValue({ items: [], archivedSessionIds: [] })
  proxy.hostDescribe.mockResolvedValue({})
  storage.loadCodexPermissionPresets.mockResolvedValue({})
  authenticate.mockResolvedValue({ api: {}, credentials: { accessToken: 'synthetic' } })
}
beforeEach(prepareScenario1)

describe('Harness session history routing', () => {
  it('uses subagent parent routing only for explicit subagent origins on open and pagination', async () => {
    await runScenarios([
      { name: 'ordinary session', metadata: {}, parent: undefined },
      { name: 'fork with ancestry', metadata: { parentSessionId: 'source' }, parent: undefined },
      { name: 'subagent child', metadata: { parentSessionId: 'source', origin: 'subagent' as const }, parent: 'source' },
    ].map(({ name, metadata, parent }) => ({ name, run: async () => {
      const target = { ...session, ...metadata }
      useAppStore.setState({ sessions: [target], selectedSession: target })
      proxy.sessionHistory.mockResolvedValueOnce({ ...page([call()]), hasMore: true })
      expect(await useAppStore.getState().openSession(target)).toBe(true)
      expect(proxy.sessionHistory).toHaveBeenNthCalledWith(1, 's1', undefined, 16, parent)
      await useAppStore.getState().loadOlderHistory()
      expect(proxy.sessionHistory).toHaveBeenNthCalledWith(2, 's1', 2, 60, parent)
      expect(useAppStore.getState().error).toBeUndefined()
      expect(useAppStore.getState().selectedSession).toMatchObject(target)
    } })), prepareScenario1)
  })

  it('recovers stalled forks while keeping subagent timeout and authorization failures bounded', async () => {
    await runScenarios([
      { name: 'fork follow timeout retries', origin: undefined, code: 'STREAM_TIMEOUT', recover: true },
      { name: 'subagent follow timeout stops', origin: 'subagent' as const, code: 'STREAM_TIMEOUT', recover: false },
      { name: 'subagent authorization rejection never downgrades', origin: 'subagent' as const, code: 'subagent/unauthorized', recover: false },
    ].map(({ name, origin, code, recover }) => ({ name, run: async () => {
      const target = { ...session, parentSessionId: 'source', origin }
      const reconnect = vi.fn(async () => true)
      useAppStore.setState({ sessions: [target], selectedSession: target, reconnect })
      proxy.sessionHistory.mockRejectedValueOnce(Object.assign(new Error(code === 'STREAM_TIMEOUT' ? 'Stream timed out' : 'Unauthorized'), { code }))
      expect(await useAppStore.getState().openSession(target)).toBe(recover)
      expect(reconnect).toHaveBeenCalledTimes(recover ? 1 : 0)
      if (recover) expect(reconnect).toHaveBeenCalledWith({ forceRelay: true, restoreSession: false })
      expect(proxy.sessionHistory).toHaveBeenCalledTimes(recover ? 2 : 1)
      for (const args of proxy.sessionHistory.mock.calls) {
        expect(args).toEqual(['s1', undefined, 16, origin === 'subagent' ? 'source' : undefined])
      }
    } })), prepareScenario1)
  })
})

describe('Host-confirmed Harness archive recovery', () => {
  it('keeps archive state across refresh and reconnect without removing catalog membership', async () => {
    const other = { ...session, sessionId: 's2', updatedAt: 0 }
    const workspace = { workspaceId: 'w1', title: 'Project', path: '/project',
      sessionIds: ['s1', 's2'], createdAt: '', updatedAt: '' }
    const device = { deviceId: 'host', name: 'Host', platform: 'linux', identityKey: 'key', membershipId: 'member', online: true, trusted: true }
    const openSession = vi.fn(async (_session: RemoteSession) => true)
    useAppStore.setState({ workspaces: [workspace], sessions: [session, other], selectedDevice: device,
      config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never, openSession })
    proxy.workspaceArchiveSession.mockResolvedValue(['s1'])
    // A successful archive must not depend on another catalog RPC succeeding.
    proxy.sessionList.mockRejectedValueOnce(new Error('read unavailable'))
    expect(await useAppStore.getState().archiveSession('s1')).toBe(true)
    expect(proxy.workspaceArchiveSession).toHaveBeenCalledWith('s1')
    expect(proxy.sessionList).not.toHaveBeenCalled()
    expect(useAppStore.getState().workspaces[0]?.sessionIds).toEqual(['s1', 's2'])
    expect(useAppStore.getState().selectedSession).toBeUndefined()
    proxy.sessionList.mockReset().mockResolvedValue([session, other])
    proxy.workspaceList.mockResolvedValue({ items: [workspace], archivedSessionIds: ['s1'] })
    await useAppStore.getState().refreshWorkspaces()
    expect(useAppStore.getState().error).toBeUndefined()
    expect(useAppStore.getState().archivedSessionIds).toEqual(['s1'])
    expect(await useAppStore.getState().openFavoriteWorkspaceSession(workspaceStableKey(workspace, 'linux'))).toEqual(other)
    await useAppStore.getState().disconnect()
    expect(await useAppStore.getState().connectDevice(device)).toBe(true)
    await useAppStore.getState().refreshWorkspaces('harness')
    expect(useAppStore.getState().archivedSessionIds).toEqual(['s1'])
    expect(await useAppStore.getState().openFavoriteWorkspaceSession(workspaceStableKey(workspace, 'linux'))).toEqual(other)
    expect(openSession.mock.calls.every(([item]) => item.sessionId === 's2')).toBe(true)
  })

  it('preserves state on rejection and ignores archive completions from a retired connection', async () => {
    await runScenarios(['rejected', 'late-success', 'late-error'].map(name => ({ name, run: async () => {
      let resolve!: (ids: string[]) => void
      let reject!: (error: Error) => void
      proxy.workspaceArchiveSession.mockImplementation(() => new Promise<string[]>((yes, no) => { resolve = yes; reject = no }))
      const pending = useAppStore.getState().archiveSession('s1')
      if (name !== 'rejected') {
        await useAppStore.getState().disconnect()
        useAppStore.setState({ archivedSessionIds: ['other-host'], busyAction: 'other-operation', error: 'other-error' })
      }
      if (name === 'late-success') resolve(['s1'])
      else reject(new Error('archive rejected'))
      expect(await pending).toBe(false)
      if (name === 'rejected') {
        expect(useAppStore.getState().archivedSessionIds).toEqual([])
        expect(useAppStore.getState().selectedSession).toEqual(session)
      } else {
        expect(useAppStore.getState()).toMatchObject({ archivedSessionIds: ['other-host'], busyAction: 'other-operation', error: 'other-error' })
      }
    } })), prepareScenario1)
  })
})

describe('OpenCode native archive confirmation', () => {
  it('updates only after native success and preserves state on rejection or retired connections', async () => {
    await runScenarios(['success', 'rejected', 'late-success', 'late-error'].map(name => ({ name, run: async () => {
      const current = { ...session, backend: 'opencode' as const, sessionId: 'opencode:ses_1', acpSessionId: 'ses_1' }
      const workspace = { workspaceId: 'opencode:cwd:fixture', title: 'Project', path: '/project', backend: 'opencode' as const,
        sessionIds: [current.sessionId], createdAt: '', updatedAt: '' }
      useAppStore.setState({ sessions: [current], selectedSession: current, workspaces: [workspace], messages: { [current.sessionId]: [] } })
      let resolve!: () => void, reject!: (error: Error) => void
      acp.archiveSession.mockImplementation(() => new Promise<void>((yes, no) => { resolve = yes; reject = no }))
      const pending = useAppStore.getState().archiveSession(current.sessionId)
      expect(acp.archiveSession).toHaveBeenCalledWith('ses_1', 'opencode')
      expect(useAppStore.getState().sessions).toEqual([current])
      if (name.startsWith('late')) {
        await useAppStore.getState().disconnect()
        useAppStore.setState({ sessions: [session], busyAction: 'new-host', error: 'new-error' })
      }
      if (name === 'success' || name === 'late-success') resolve()
      else reject(new Error('native archive rejected'))
      expect(await pending).toBe(name === 'success')
      if (name === 'success') {
        expect(useAppStore.getState().sessions).toEqual([])
        expect(useAppStore.getState().workspaces[0]?.sessionIds).toEqual([])
        expect(useAppStore.getState().messages[current.sessionId]).toEqual([])
      } else if (name === 'rejected') {
        expect(useAppStore.getState().sessions).toEqual([current])
        expect(useAppStore.getState().selectedSession).toEqual(current)
      } else expect(useAppStore.getState()).toMatchObject({ sessions: [session], busyAction: 'new-host', error: 'new-error' })
    } })), prepareScenario1)
  })
})

describe('ordered history recovery', () => {
  it('keeps queue delivery state visible across acknowledgement, projection and echo orderings', async () => {
    const scenarios = [
      { name: 'ack before inbox, missing echo', steps: ['ack', 'in', 'out', 'end', 'out'] },
      { name: 'inbox before ack, missing echo', steps: ['in', 'ack', 'out', 'end'] },
      { name: 'inbox released before ack', steps: ['in', 'out', 'ack', 'end'] },
      { name: 'echo before delayed inbox', steps: ['ack', 'echo', 'in', 'out', 'out'] },
      { name: 'echo after inbox', steps: ['ack', 'in', 'out', 'echo'] },
      { name: 'echo before ack', steps: ['in', 'out', 'echo', 'ack'] },
      { name: 'timeout after inbox acceptance', steps: ['in', 'timeout', 'out', 'end'] },
      { name: 'timeout after inbox release', steps: ['in', 'out', 'timeout', 'end'] },
    ]
    await runScenarios(scenarios.map(({ name, steps }) => ({ name, run: async () => {
      const running = { ...session, running: true }
      useAppStore.setState({ selectedSession: running, sessions: [running] })
      let acknowledge!: () => void
      let reject!: (error: Error) => void
      proxy.sessionPrompt.mockImplementation(() => new Promise<void>((resolve, fail) => { acknowledge = resolve; reject = fail }))
      const rpcId = `adoption-${name}`
      const sending = useAppStore.getState().sendMessage('queued prompt', [], rpcId)
      const message = { id: 'host-item', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'queued prompt' }] }
      const echo = frame(entry('user/message', 20, { turn: 2, message }))
      const row = () => useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
      let seq = 1
      let adopted = false
      let echoed = false
      for (const step of steps) {
        if (step === 'ack' || step === 'timeout') {
          if (step === 'ack') acknowledge()
          else reject(Object.assign(new Error('synthetic timeout'), { code: 'TIMEOUT' }))
          expect(await sending).toBe(step === 'ack' ? 'sent' : 'kept')
        } else if (step === 'in' || step === 'out') {
          useAppStore.getState().handleMuxFrame({ rpcId: '', payload: {
            type: 'session/projection', sessionId: 's1', key: 'inbox', seq: seq++,
            value: { 'next-turn': step === 'in' ? [message] : [] },
          } } as MuxStreamFrame)
          if (step === 'in') adopted = true
        } else if (step === 'echo') {
          useAppStore.getState().handleMuxFrame(echo)
          echoed = true
        } else useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 21, { turn: 2, reason: { kind: 'completed' } })))
        if (echoed) {
          expect(row()).toMatchObject({ id: 'host-item', nativeSeq: 20 })
          expect(row()).not.toHaveProperty('queuedAdopted')
          expect(row()).not.toHaveProperty('sendState')
        } else if (adopted) {
          const inQueue = (useAppStore.getState().selectedSession?.projections?.values?.inbox as { 'next-turn': unknown[] })['next-turn'].length > 0
          expect(row()).toMatchObject({ queuedAdopted: true, sendState: inQueue ? 'queued' : 'unconfirmed' })
        }
      }
      // A late echo heals the released row once, retaining native identity.
      useAppStore.getState().handleMuxFrame(echo)
      expect(useAppStore.getState().messages.s1?.filter(item => item.kind === 'message' && item.requestRpcId === rpcId)).toHaveLength(1)
      expect(row()).toMatchObject({ id: 'host-item', nativeSeq: 20 })
      expect(row()).not.toHaveProperty('sendState')
      expect(row()).not.toHaveProperty('queuedAdopted')
    } })), prepareScenario1)
  })

  it('settles explicit queue actions without reviving removed rows or overwriting durable echoes', async () => {
    await runScenarios(['remove', 'steer'].flatMap(action => ['queue-first', 'release-first', 'echo-first'].map(order => ({
      name: `${action}, ${order}`, run: async () => {
        const running = { ...session, running: true }
        useAppStore.setState({ selectedSession: running, sessions: [running] })
        let acknowledge!: () => void
        proxy.sessionPrompt.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve }))
        const rpcId = `action-${action}-${order}`
        const sending = useAppStore.getState().sendMessage('queued prompt', [], rpcId)
        const message = { id: 'host-item', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'queued prompt' }] }
        const inbox = (items: unknown[], seq: number) => useAppStore.getState().handleMuxFrame({ rpcId: '', payload: {
          type: 'session/projection', sessionId: 's1', key: 'inbox', seq, value: { 'next-turn': items },
        } } as MuxStreamFrame)
        inbox([message], 1)
        proxy.sessionUpdateQueue.mockImplementation(async () => {
          if (order !== 'queue-first') inbox([], 2)
          if (order === 'echo-first') useAppStore.getState().handleMuxFrame(frame(entry('user/message', 3, { message })))
        })
        expect(await useAppStore.getState().updateQueueItem('host-item', action as 'remove' | 'steer', rpcId)).toBe(true)
        // Even a stale inbox snapshot must not undo an explicit action on ACK.
        acknowledge()
        expect(await sending).toBe('sent')
        const row = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
        if (order === 'echo-first') {
          expect(row).toMatchObject({ id: 'host-item', nativeSeq: 3 })
          expect(row).not.toHaveProperty('sendState')
          expect(row).not.toHaveProperty('queuedAdopted')
        } else expect(row).toMatchObject({ sendState: action === 'remove' ? 'canceled' : 'unconfirmed' })
      },
    }))), prepareScenario1)
  })

  it('reconciles local delivery states by marking, never by deleting', async () => {
    const row = (id: string, requestRpcId: string, sendState: 'queued' | 'failed' | 'unconfirmed', createdAt = 1): ChatItem => ({
      kind: 'message', id, sessionId: 's1', role: 'user', text: 'hello', createdAt, requestRpcId, sendState,
    })
    await runScenarios([
      {
        name: 'marks pre-connection queued orphans canceled and unconfirmed orphans failed',
        run: () => {
          const merged = reconcileDeliveryStates(
            [row('local:a', 'rpc-a', 'queued'), row('local:b', 'rpc-b', 'unconfirmed')],
            new Set<string>(), new Set<string>(), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual(['canceled', 'failed'])
          expect(merged.map(item => item.id)).toEqual(['local:a', 'local:b'])
        },
      },
      {
        name: 'keeps rows still sitting in the Host inbox',
        run: () => {
          const merged = reconcileDeliveryStates([row('local:a', 'rpc-a', 'queued')], new Set(['rpc-a']), new Set<string>(), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual(['queued'])
        },
      },
      {
        name: 'keeps failed rows as user retry material',
        run: () => {
          const merged = reconcileDeliveryStates([row('local:c', 'rpc-c', 'failed')], new Set<string>(), new Set<string>(), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual(['failed'])
        },
      },
      {
        name: 'keeps canceled rows terminal — user removal is never re-judged',
        run: () => {
          const removed: ChatItem = {
            kind: 'message', id: 'local:g', sessionId: 's1', role: 'user', text: 'gone',
            createdAt: 1, requestRpcId: 'rpc-g', sendState: 'canceled',
          }
          const merged = reconcileDeliveryStates([removed], new Set<string>(), new Set<string>(), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual(['canceled'])
        },
      },
      {
        name: 'settles adopted rows whose echo never landed (lost-echo hole)',
        run: () => {
          const lost: ChatItem = {
            kind: 'message', id: 'local:lost', sessionId: 's1', role: 'user', text: 'queued then lost',
            createdAt: 1, requestRpcId: 'rpc-lost', queuedAdopted: true,
          }
          const merged = reconcileDeliveryStates([lost], new Set<string>(), new Set<string>(), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual(['canceled'])
        },
      },
      {
        name: 'keeps adopted rows echoed in history or still queued host-side',
        run: () => {
          const echoed: ChatItem = {
            kind: 'message', id: 'local:echo', sessionId: 's1', role: 'user', text: 'x',
            createdAt: 1, requestRpcId: 'rpc-echo', queuedAdopted: true,
          }
          const merged = reconcileDeliveryStates([echoed], new Set<string>(), new Set(['rpc-echo']), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual([undefined])
        },
      },
      {
        name: 'keeps rows sent during the current connection for live-frame reconciliation',
        run: () => {
          const merged = reconcileDeliveryStates([row('local:d', 'rpc-d', 'unconfirmed', 200)], new Set<string>(), new Set<string>(), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual(['unconfirmed'])
        },
      },
      {
        name: 'keeps rows whose prompt is echoed in the loaded history',
        run: () => {
          const merged = reconcileDeliveryStates([row('local:e', 'rpc-e', 'queued')], new Set<string>(), new Set(['rpc-e']), 100)
          expect(merged.map(item => item.kind === 'message' ? item.sendState : undefined)).toEqual(['queued'])
        },
      },
    ])
  })

  it('merges cached tool results using snapshot and live ordering', async () => {
    await runScenarios(
      [
        {
          name: 'does not overwrite a completed history tool with its older running cache',
          run: () => {
            const live = foldHistory([call()], 's1')
            const history = foldHistory([call(), result()], 's1')
            expect(mergeHistoryAndLive(history, live)).toMatchObject([{ state: 'finished', nativeSeq: 3 }])
          },
        },
        {
          name: 'preserves a live result newer than the snapshot and rejects an older replayed call',
          run: () => {
            const history = foldHistory([call()], 's1')
            const live = foldHistory([call(), result()], 's1')
            expect(mergeHistoryAndLive(history, live)).toMatchObject([{ state: 'finished' }])
            expect(applyMuxFrame(live, frame(call()))).toEqual(live)
          },
        },
        {
          name: 'retains tool position and owner when a delayed result arrives in a later turn',
          run: () => {
            const rows = [
              call(),
              entry('user/message', 5, {
                turn: 2,
                message: { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] },
              }),
              result(6, 2),
            ]
            expect(foldHistory(rows, 's1')[0]).toMatchObject({ turn: '1', nativeOrderSeq: 2, nativeSeq: 6 })
          },
        },
        {
          name: 'inserts cached older rows before new history instead of appending them after the answer',
          run: () => {
            const older = foldHistory([call()], 's1')
            const newer = foldHistory([call(20, 2, 'c2')], 's1')
            expect(mergeHistoryAndLive(newer, older).map((item) => item.id)).toEqual(['c1', 'c2'])
          },
        },
        {
          name: 'recovers a missing older result during pagination without replaying a stale stream',
          run: () => {
            const incomplete = foldHistory([call(), entry('turn/end', 5, { turn: 1 })], 's1')
            expect(prependHistory(foldHistory([call(), result()], 's1'), incomplete)).toMatchObject([
              { state: 'finished' },
            ])
            const stream = foldHistory(
              [
                entry('assistant/chunk', 10, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'a' } }),
                entry('assistant/chunk', 10.5, { turn: 2, step: 1, chunk: { type: 'text-delta', text: 'b' } }),
              ],
              's1',
            )
            expect(mergeHistoryAndLive([], stream, 10)).toMatchObject([{ text: 'ab' }])
          },
        },
      ],
      async () => {
        await prepareScenario1()
      },
    )
  }, 25000)

  it('settles history turns without replaying stale streams', async () => {
    await runScenarios(
      [
        {
          name: 'drops covered transient streams but keeps new deltas beyond the snapshot cursor',
          run: () => {
            const chunk = (seq: number) =>
              entry('assistant/chunk', seq, {
                turn: 1,
                step: 1,
                chunk: { type: 'text-delta', text: 'partial' },
              })
            expect(mergeHistoryAndLive([], foldHistory([chunk(2.5)], 's1'), 10)).toEqual([])
            expect(mergeHistoryAndLive([], foldHistory([chunk(11.5)], 's1'), 10)).toHaveLength(1)
          },
        },
        {
          name: 'settles closed turns without claiming a missing tool result succeeded',
          run: () => {
            const rows = [
              call(),
              entry('assistant/chunk', 4, { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'partial' } }),
              entry('turn/end', 5, { turn: 1 }),
            ]
            expect(foldHistory(rows, 's1')).toMatchObject([{ state: 'failed' }, { streaming: false }])
          },
        },
        {
          name: 'does not close current-turn tools when an earlier turn ends',
          run: () => {
            expect(
              foldHistory([call(2, 1), call(4, 2, 'c2'), entry('turn/end', 5, { turn: 1 })], 's1'),
            ).toMatchObject([{ state: 'failed' }, { state: 'running' }])
          },
        },
      ],
      async () => {
        await prepareScenario1()
      },
    )
  }, 15000)

})

describe('session restore state machine', () => {
  it('recovers only current turn lifecycle from snapshots', async () => {
    await runScenarios(
      [
        {
          name: 'restores a closed turn from history and clears stale generating rows',
          run: async () => {
            useAppStore.setState({
              selectedSession: { ...session, running: true },
              sessions: [{ ...session, running: true }],
              messages: { s1: foldHistory([call()], 's1') },
            })
            proxy.sessionHistory.mockResolvedValue(page([call(), result(), entry('turn/end', 4, { turn: 1 })]))
            expect(await useAppStore.getState().openSession({ ...session, running: true })).toBe(true)
            expect(useAppStore.getState().selectedSession?.running).toBe(false)
            expect(useAppStore.getState().messages.s1).toMatchObject([{ state: 'finished' }])
          },
        },
        {
          name: 'keeps live lifecycle events newer than the snapshot',
          run: async () => {
            proxy.sessionHistory.mockImplementation(async () => {
              useAppStore.getState().handleMuxFrame(frame(entry('turn/start', 11, { turn: 2 })))
              useAppStore.getState().handleMuxFrame(frame(call(12, 2, 'c2')))
              return page([entry('turn/end', 10, { turn: 1 })])
            })
            await useAppStore.getState().openSession(session)
            expect(useAppStore.getState().selectedSession?.running).toBe(true)
            expect(useAppStore.getState().messages.s1).toMatchObject([{ state: 'running', turn: '2' }])
          },
        },
        {
          name: 'does not let an older turn-start reopen a completed turn',
          run: () => {
            useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 20, { turn: 1 })))
            useAppStore.getState().handleMuxFrame(frame(entry('turn/start', 10, { turn: 1 })))
            expect(useAppStore.getState().selectedSession?.running).toBe(false)
          },
        },
      ],
      async () => {
        await prepareScenario1()
      },
    )
  }, 15000)

  it('ignores an earlier session load completing after a later navigation', async () => {
    let finish!: (value: ReturnType<typeof page>) => void
    proxy.sessionHistory.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const old = useAppStore.getState().openSession(session)
    await vi.waitFor(() => expect(proxy.sessionHistory).toHaveBeenCalled())
    const next = { ...session, sessionId: 's2' }
    expect(await useAppStore.getState().openSession(next)).toBe(true)
    finish(page([call()]))
    expect(await old).toBe(false)
    expect(useAppStore.getState().selectedSession?.sessionId).toBe('s2')
  })
  it('restores the selected conversation once for overlapping reconnect requests', async () => {
    useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
    const first = useAppStore.getState().reconnect()
    const second = useAppStore.getState().reconnect()
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(transport.connect).toHaveBeenCalledTimes(1)
    expect(proxy.sessionHistory).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().selectedSession?.sessionId).toBe('s1')
  })
  it('recovers the selected CodeX history and live stream after a foreground carrier close without replaying prompts', async () => {
    vi.useFakeTimers()
    const recovery = new ForegroundConnectionRecovery(useAppStore.getState, options => useAppStore.getState().reconnect(options))
    const unsubscribe = useAppStore.subscribe(() => recovery.update())
    try {
      const thread = { id: 'thread-1', cwd: '/project', status: { type: 'active', activeFlags: [] }, createdAt: 1, updatedAt: 2 }
      transport.hasCodex.mockReturnValue(true)
      codex.request.mockImplementation(async (method: string) => {
        if (method === 'thread/list') return { data: [thread] }
        if (method === 'project/list') return { data: [] }
        if (method === 'thread/read') return { thread }
        if (method === 'dsh/sessionHistory') return { header: { id: 'codex:thread-1' }, records: [], hasMore: false, activeTurnId: 'turn-1' }
        if (method === 'model/list') return { data: [{ model: 'model-1' }] }
        throw new Error(`Unexpected recovery mutation: ${method}`)
      })
      codex.subscribe.mockImplementation(async () => ({ streamId: `stream-${codex.subscribe.mock.calls.length}`, close: async () => undefined }))
      useAppStore.setState({ config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
      expect(await useAppStore.getState().connectDevice({ deviceId: 'host' } as never)).toBe(true)
      // Connecting probes availability; only opening CodeX loads its catalog.
      expect(codex.request).not.toHaveBeenCalled()
      expect(proxy.workspaceList).not.toHaveBeenCalled()
      expect(proxy.sessionList).not.toHaveBeenCalled()
      await useAppStore.getState().refreshWorkspaces('codex')
      const selected = useAppStore.getState().sessions.find(item => item.backend === 'codex')!
      expect(await useAppStore.getState().openSession(selected)).toBe(true)
      recovery.setActive(true)
      const options = transport.connect.mock.calls[0]![5] as { onClose: (options: { retryable: boolean }) => void }
      options.onClose({ retryable: true })
      expect(useAppStore.getState().connection.phase).toBe('offline')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(transport.connect).toHaveBeenCalledTimes(2)
      expect(codex.subscribe).toHaveBeenCalledTimes(2)
      expect(codex.request.mock.calls.filter(([method]) => method === 'dsh/sessionHistory')).toHaveLength(2)
      expect(codex.request.mock.calls.every(([method]) => ['thread/list', 'project/list', 'thread/read', 'dsh/sessionHistory', 'model/list'].includes(method))).toBe(true)
      expect(useAppStore.getState().selectedSession).toMatchObject({ sessionId: 'codex:thread-1', running: true })
      // The restored stream still drives completion; recovery did not create a turn.
      const onFrame = codex.subscribe.mock.calls[1]![1] as (frame: unknown) => void
      const beforeBurst = useAppStore.getState().messages
      let publishes = 0
      const stopCounting = useAppStore.subscribe((state, previous) => {
        if (state.messages !== previous.messages) publishes += 1
      })
      try {
        for (let index = 0; index < 100; index += 1) {
          onFrame({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reply', delta: String(index % 10) } })
        }
        expect(useAppStore.getState().messages).toBe(beforeBurst)
        await vi.advanceTimersByTimeAsync(100)
        expect(publishes).toBe(1)
        expect(useAppStore.getState().messages['codex:thread-1']).toEqual(expect.arrayContaining([
          expect.objectContaining({ text: '0123456789'.repeat(10) }),
        ]))
        const afterBurst = useAppStore.getState().messages
        onFrame({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1' } })
        await vi.advanceTimersByTimeAsync(100)
        expect(useAppStore.getState().messages).toBe(afterBurst)
        expect(publishes).toBe(1)
      } finally { stopCounting() }
      // Completion must drain a final pending delta without waiting for a timer.
      onFrame({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reply', delta: 'final' } })
      onFrame({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', items: [] } } })
      expect(useAppStore.getState().selectedSession?.running).toBe(false)
      expect(useAppStore.getState().messages['codex:thread-1']).toEqual(expect.arrayContaining([
        expect.objectContaining({ text: `${'0123456789'.repeat(10)}final` }),
      ]))
      // Reopening retires the old callback and its queued work, even on one Host.
      expect(await useAppStore.getState().openSession(selected)).toBe(true)
      const reopened = useAppStore.getState().messages
      onFrame({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'stale', delta: 'late old stream' } })
      await vi.advanceTimersByTimeAsync(100)
      expect(useAppStore.getState().messages).toBe(reopened)
    } finally {
      recovery.setActive(false)
      unsubscribe()
      await useAppStore.getState().disconnect()
      vi.useRealTimers()
    }
  })
  it('retains healthy carriers on resume and restores half-open connections without reviving a disconnected Host', async () => {
    await runScenarios([
      {
        name: 'a replaced or refused carrier stays offline across resume and network notifications',
        run: async () => {
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never,
            connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false }, retryable: false } })
          await useAppStore.getState().resumeConnection()
          useAppStore.getState().setOffline()
          await useAppStore.getState().resumeConnection()
          expect(useAppStore.getState().connection.retryable).toBe(false)
          expect(transport.connect).not.toHaveBeenCalled()
        },
      },
      ...[true, false].map(healthy => ({
        name: healthy ? 'keeps a healthy carrier' : 'reconnects a half-open carrier and restores the session',
        run: async () => {
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          transport.checkHealth.mockResolvedValue(healthy)
          await useAppStore.getState().resumeConnection()
          expect(transport.connect).toHaveBeenCalledTimes(healthy ? 0 : 1)
          expect(proxy.sessionHistory).toHaveBeenCalledTimes(healthy ? 0 : 1)
        },
      })),
      {
        name: 'preserves carrier and bypasses reconnect when resume health probe succeeds on retry',
        run: async () => {
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          transport.checkHealth.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
          await useAppStore.getState().resumeConnection()
          expect(transport.connect).not.toHaveBeenCalled()
          expect(proxy.sessionHistory).not.toHaveBeenCalled()
        },
      },
      {
        name: 'reconnects when resume health probe retry rejects',
        run: async () => {
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          transport.checkHealth.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('NETWORK_TIMEOUT'))
          await useAppStore.getState().resumeConnection()
          expect(transport.connect).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'recovers when the carrier closes while the resume probe is in flight',
        run: async () => {
          const device = { deviceId: 'host' } as never
          useAppStore.setState({ config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          await useAppStore.getState().connectDevice(device)
          let finish!: (healthy: boolean) => void
          transport.checkHealth.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
          const checking = useAppStore.getState().resumeConnection()
          const options = transport.connect.mock.calls[0]![5] as { onClose?: () => void }
          options.onClose?.()
          expect(useAppStore.getState().connection.phase).toBe('offline')
          finish(false)
          await checking
          expect(transport.connect).toHaveBeenCalledTimes(2)
          expect(useAppStore.getState().connection.phase).toBe('connected')
        },
      },
      ...['healthy', 'failed', 'rejected', 'disconnect', 'refused', 'replacement'].map(outcome => ({
        name: `handles ${outcome} while the second resume probe is in flight`,
        run: async () => {
          const device = { deviceId: 'host' } as never
          useAppStore.setState({ config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          await useAppStore.getState().connectDevice(device)
          let finish!: (healthy: boolean) => void
          let reject!: (error: Error) => void
          transport.checkHealth.mockResolvedValueOnce(false).mockImplementationOnce(() => new Promise((resolve, fail) => {
            finish = resolve
            reject = fail
          }))
          const checking = useAppStore.getState().resumeConnection()
          await vi.waitFor(() => expect(transport.checkHealth).toHaveBeenCalledTimes(2))
          if (outcome === 'disconnect') await useAppStore.getState().disconnect()
          else if (outcome === 'replacement') {
            await useAppStore.getState().connectDevice({ deviceId: 'other-host' } as never)
          } else {
            const options = transport.connect.mock.calls[0]![5] as { onClose?: () => void }
            options.onClose?.()
            expect(useAppStore.getState().connection.phase).toBe('offline')
            if (outcome === 'refused') useAppStore.setState(state => ({ connection: { ...state.connection, retryable: false } }))
          }
          if (outcome === 'rejected') reject(new Error('NETWORK_TIMEOUT'))
          else finish(outcome === 'healthy')
          await checking
          const recovers = !['disconnect', 'refused', 'replacement'].includes(outcome)
          expect(transport.connect).toHaveBeenCalledTimes(recovers || outcome === 'replacement' ? 2 : 1)
          if (recovers) expect(useAppStore.getState().connection.phase).toBe('connected')
          if (outcome === 'disconnect') expect(useAppStore.getState().selectedDevice).toBeUndefined()
          if (outcome === 'replacement') expect(useAppStore.getState().selectedDevice?.deviceId).toBe('other-host')
          if (outcome === 'refused') expect(useAppStore.getState().connection.phase).toBe('offline')
        },
      })),
      {
        name: 'ignores an old failed health check after explicit disconnect',
        run: async () => {
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never })
          let finish!: (healthy: boolean) => void
          transport.checkHealth.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
          const checking = useAppStore.getState().resumeConnection()
          await useAppStore.getState().disconnect()
          finish(false)
          await checking
          expect(transport.connect).not.toHaveBeenCalled()
          expect(useAppStore.getState().selectedDevice).toBeUndefined()
        },
      },
    ], prepareScenario1)
  })
  it('restores ACP sessions once across overlapping reconnects and respects restoreSession=false', async () => {
    const rows = ['cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes'] as const
    await runScenarios(
      rows.map((row, index) => {
        const backend = row
        return {
          name: scenarioName(
            'restores %s once for overlapping reconnects and respects restoreSession=false',
            row,
            index,
          ),
          run: async () => {
            const selected = {
              ...session,
              sessionId: `${backend}:native-session`,
              nativeId: 'native-session',
              backend,
            }
            useAppStore.setState({
              selectedSession: selected,
              sessions: [selected],
              selectedDevice: { deviceId: 'host' } as never,
              config: { baseUrl: 'https://example.invalid' } as never,
              identity: {} as never,
            })
            transport.hasCursor.mockReturnValue(backend === 'cursor')
            transport.hasAntigravity.mockReturnValue(backend === 'antigravity')
            transport.hasPi.mockReturnValue(backend === 'pi')
            transport.hasOpencode.mockReturnValue(backend === 'opencode')
            transport.hasClaude.mockReturnValue(backend === 'claude')
            transport.hasHermes.mockReturnValue(backend === 'hermes')
            const first = useAppStore.getState().reconnect()
            const second = useAppStore.getState().reconnect()
            expect(await first).toBe(true)
            expect(await second).toBe(true)
            expect(transport.connect).toHaveBeenCalledTimes(1)
            expect(acp.openStream).toHaveBeenCalledTimes(1)
            expect(acp.transferCall).toHaveBeenCalledTimes(backend !== 'cursor' ? 1 : 0)
            if (backend !== 'cursor') {
              // Restoring a session must read its history from its own backend.
              expect(acp.transferCall).toHaveBeenCalledWith('dsh/sessionHistory', { sessionId: 'native-session', backend })
            }
            expect(await useAppStore.getState().reconnect({ restoreSession: false })).toBe(true)
            expect(acp.openStream).toHaveBeenCalledTimes(1)
            expect(acp.transferCall).toHaveBeenCalledTimes(backend !== 'cursor' ? 1 : 0)
          },
        }
      }),
      async () => {
        await prepareScenario1()
      },
    )
  })
  it('ignores ACP model commits completing after navigation and releases the old selector state', async () => {
    await runScenarios((['cursor', 'claude', 'pi', 'opencode', 'antigravity'] as const).flatMap(backend => ['resolve', 'reject'].map(outcome => ({ name: `${backend}/${outcome}`, run: async () => {
      let finish!: () => void
      acp.selectModel.mockReturnValueOnce(new Promise((resolve, reject) => {
        finish = () => outcome === 'resolve' ? resolve({ provider: backend, model: 'm', reasoningEffort: 'high' }) : reject(new Error('late rejection'))
      }))
      acp.sessionModels.mockResolvedValue({ current: { provider: backend, model: 'm', reasoningEffort: 'high' }, groups: [], failures: [], routable: true })
      const selected = { ...session, backend, sessionId: `${backend}:old`, nativeId: 'old' }
      useAppStore.setState({ selectedSession: selected, sessions: [selected] })
      const selecting = useAppStore.getState().selectModel({ provider: backend, model: 'm', reasoningEffort: 'high' })
      expect(useAppStore.getState().modelSelecting).toBe(true)
      expect(await useAppStore.getState().openSession({ ...session, sessionId: 'new' })).toBe(true)
      expect(useAppStore.getState().modelSelecting).toBe(false)
      finish()
      expect(await selecting).toBe(false)
      expect(useAppStore.getState().selectedSession?.sessionId).toBe('new')
      expect(useAppStore.getState().sessionModels).toBeUndefined()
      expect(useAppStore.getState().error).toBeUndefined()
    } }))), prepareScenario1)
  })

  it('deduplicates ACP boundary overlap only with an identity anchor', () => {
    const message = (id: string): ChatItem => ({ kind: 'message', id, sessionId: 'pi:s', role: 'assistant', text: 'OK', createdAt: 0 })
    expect(mergeAcpHistoryAndLive([message('old')], [message('new')])).toHaveLength(2)
    const tool: ChatItem = { kind: 'tool', id: 'call-id', sessionId: 'pi:s', toolName: 'bash', state: 'running', createdAt: 0 }
    const liveTool: ChatItem = { ...tool, id: 'cursor-tool:acp-live:1:call-id', state: 'finished', resultDetail: { text: 'done', format: 'code' } }
    expect(mergeAcpHistoryAndLive([tool, message('history')], [liveTool, message('live')])).toEqual([liveTool, message('live')])
    expect(mergeAcpHistoryAndLive([message('prior'), tool], [liveTool, message('tail')])).toEqual([message('prior'), liveTool, message('tail')])
  })

  it('keeps only new ACP subscription deltas while history is loading', async () => {
    await runScenarios((['pi', 'antigravity'] as const).flatMap(backend =>
      ['live', 'completed', 'switch', 'reject'].map(mode => ({ name: `${backend}: ${mode}`, run: async () => {
        const selected = { ...session, backend, sessionId: `${backend}:old`, nativeId: 'old' }
        useAppStore.setState({ messages: { [selected.sessionId]: [{ kind: 'message', id: 'cursor-assistant-live',
          sessionId: selected.sessionId, role: 'assistant', text: 'stale cache', createdAt: 1, streaming: true }] } })
        let finish!: (value: { events: HistoryEntry[] }) => void
        let fail!: (error: Error) => void
        acp.transferCall.mockReturnValueOnce(new Promise((resolve, reject) => { finish = resolve; fail = reject }))
        const opening = useAppStore.getState().openSession(selected)
        await vi.waitFor(() => expect(acp.openStream).toHaveBeenCalled())
        const receive = acp.openStream.mock.calls[0]![1]
        const update = (value: Record<string, unknown>) => receive({ streamId: 'acp-test',
          frame: { method: 'session/update', params: { sessionId: 'old', update: value } } })
        const chunks = [
          { sessionUpdate: 'tool_call', toolCallId: 'tail-tool', title: 'bash', status: 'in_progress' },
          { sessionUpdate: 'tool_call_update', toolCallId: 'tail-tool', title: 'bash', status: 'completed', rawOutput: 'tail output' },
          { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'tail answer' } },
        ]
        if (mode === 'completed') update({ sessionUpdate: 'prompt_completed', catchUp: chunks.map(value => ({
          method: 'session/update', params: { update: value },
        })) })
        else chunks.forEach(update)
        receive({ streamId: 'acp-test', frame: { method: 'session/request_permission', params: {
          sessionId: 'old', requestHandle: 'current-approval', toolCall: { title: 'Run bash' },
          options: [{ optionId: 'once', kind: 'allow_once' }],
        } } })
        // The catalog explicitly says running:false, but this subscription has
        // already delivered live content and an actionable approval.
        expect(selected.running).toBe(false)
        expect(useAppStore.getState().messages[selected.sessionId]).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'approval', approvalId: 'current-approval' }),
        ]))
        if (mode === 'switch') {
          expect(await useAppStore.getState().openSession({ ...session, sessionId: 'new' })).toBe(true)
          update({ sessionUpdate: 'agent_message_chunk', content: { text: 'late old delta' } })
        }
        if (mode === 'reject') fail(new Error('history unavailable'))
        else finish({ events: [entry('assistant/message', 1, { turn: 1, message: { id: 'history',
          content: [{ type: 'text', text: 'old history' }] } })] })
        expect(await opening).toBe(mode !== 'switch' && mode !== 'reject')
        const items = useAppStore.getState().messages[selected.sessionId] ?? []
        expect(items.some(item => item.kind === 'message' && item.text.includes('stale cache'))).toBe(false)
        expect(items).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'tool', state: 'finished', resultDetail: { text: 'tail output', format: 'code' } }),
          expect.objectContaining({ kind: 'message', text: 'tail answer', streaming: mode !== 'completed' }),
          expect.objectContaining({ kind: 'approval', approvalId: 'current-approval' }),
        ]))
        if (mode === 'completed') expect(useAppStore.getState().selectedSession?.running).toBe(false)
        if (mode === 'switch') {
          expect(useAppStore.getState().selectedSession?.sessionId).toBe('new')
          expect(useAppStore.getState().messages.new).toEqual([])
          expect(items.some(item => item.kind === 'message' && item.text.includes('late old delta'))).toBe(false)
        }
        if (mode === 'reject') expect(useAppStore.getState().error).toContain('history unavailable')
      } }))), prepareScenario1)
  })

  it('ignores AGY history completing after navigation to another conversation', async () => {
    let finish!: (result: { events: unknown[] }) => void
    acp.transferCall.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const old = useAppStore.getState().openSession({ ...session, sessionId: 'antigravity:old', nativeId: 'old', backend: 'antigravity' })
    await vi.waitFor(() => expect(acp.transferCall).toHaveBeenCalled())
    expect(await useAppStore.getState().openSession({ ...session, sessionId: 'new' })).toBe(true)
    finish({ events: [] })
    expect(await old).toBe(false)
    expect(useAppStore.getState().selectedSession?.sessionId).toBe('new')
    expect(useAppStore.getState().messages['antigravity:old']).toBeUndefined()
  })

  it('closes late ACP subscriptions after navigation', async () => {
    const rows = ['cursor', 'antigravity', 'pi'] as const
    await runScenarios(
      rows.map((row, index) => {
        const backend = row
        return {
          name: scenarioName('closes a late %s subscription after navigation', row, index),
          run: async () => {
            let finish!: (stream: { streamId: string; close: () => Promise<void> }) => void
            acp.openStream.mockReturnValueOnce(
              new Promise((resolve) => {
                finish = resolve
              }),
            )
            const old = useAppStore
              .getState()
              .openSession({ ...session, sessionId: `${backend}:old`, nativeId: 'old', backend })
            await vi.waitFor(() => expect(acp.openStream).toHaveBeenCalled())
            expect(
              await useAppStore
                .getState()
                .openSession({ ...session, sessionId: `${backend}:new`, nativeId: 'new', backend }),
            ).toBe(true)
            const close = vi.fn(async () => undefined)
            finish({ streamId: 'old-stream', close })
            expect(await old).toBe(false)
            expect(close).toHaveBeenCalledOnce()
            expect(useAppStore.getState().selectedSession?.sessionId).toBe(`${backend}:new`)
          },
        }
      }),
      async () => {
        await prepareScenario1()
      },
    )
  })

  it('isolates late ACP prompt subscriptions from the new conversation', async () => {
    const rows = ['cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes'] as const
    await runScenarios(
      rows.map((row, index) => {
        const backend = row
        return {
          name: scenarioName('keeps a late %s prompt subscription out of the new conversation', row, index),
          run: async () => {
            const selected = { ...session, sessionId: `${backend}:old`, nativeId: 'old', backend }
            useAppStore.setState({ selectedSession: selected, sessions: [selected] })
            let finish!: (stream: { streamId: string; close: () => Promise<void> }) => void
            acp.openStream.mockReturnValueOnce(
              new Promise((resolve) => {
                finish = resolve
              }),
            )
            const sending = useAppStore.getState().sendMessage('hello')
            await vi.waitFor(() => expect(acp.openStream).toHaveBeenCalled())
            expect(
              await useAppStore
                .getState()
                .openSession({ ...selected, sessionId: `${backend}:new`, nativeId: 'new' }),
            ).toBe(true)
            const close = vi.fn(async () => undefined)
            finish({ streamId: 'old-prompt-stream', close })
            expect(await sending).toBe('sent')
            expect(close).toHaveBeenCalledOnce()
            expect(useAppStore.getState().selectedSession?.sessionId).toBe(`${backend}:new`)
            expect(acp.prompt).toHaveBeenCalledWith('old', 'hello', undefined, [], backend)
          },
        }
      }),
      async () => {
        await prepareScenario1()
      },
    )
  })

})

describe('session creation single flight', () => {
  it('locks the real creation and opening lifecycle and releases after success or failure', async () => {
    await runScenarios(['success', 'create failure', 'history failure'].map(outcome => ({
      name: outcome,
      run: async () => {
        const created = { ...session, sessionId: 'new', blank: true }
        useAppStore.setState({ defaultPermissionPreset: 'default' })
        proxy.sessionList.mockResolvedValue([session, created])
        let finishCreate!: (value: { sessionId: string }) => void
        let failCreate!: (error: Error) => void
        proxy.sessionCreate.mockImplementationOnce(() => new Promise((resolve, reject) => {
          finishCreate = resolve
          failCreate = reject
        }))
        let finishHistory!: (value: ReturnType<typeof page>) => void
        let failHistory!: (error: Error) => void
        proxy.sessionHistory.mockImplementationOnce(() => new Promise((resolve, reject) => {
          finishHistory = resolve
          failHistory = reject
        }))
        const first = useAppStore.getState().createSession('workspace-a')
        expect(await useAppStore.getState().createSession('workspace-b')).toBe(false)
        expect(proxy.sessionCreate).toHaveBeenCalledOnce()
        if (outcome === 'create failure') {
          failCreate(new Error('CREATE_FAILED'))
        } else {
          finishCreate({ sessionId: 'new' })
          await vi.waitFor(() => expect(proxy.sessionHistory).toHaveBeenCalledOnce())
          // busyAction has moved from creation to opening; the runtime lock must
          // still reject a second entry until the actual history load settles.
          expect(useAppStore.getState().busyAction).toBe('session:new')
          expect(await useAppStore.getState().createSession('workspace-b')).toBe(false)
          expect(proxy.sessionCreate).toHaveBeenCalledOnce()
          if (outcome === 'history failure') failHistory(new Error('HISTORY_FAILED'))
          else finishHistory(page([]))
        }
        expect(await first).toBe(outcome === 'success')
        expect(useAppStore.getState().busyAction).toBeUndefined()
        // A subsequent request runs normally after either completion path.
        proxy.sessionCreate.mockResolvedValue({ sessionId: 'new' })
        proxy.sessionHistory.mockReset().mockResolvedValue(page([]))
        expect(await useAppStore.getState().createSession('workspace-b')).toBe(true)
        expect(proxy.sessionCreate).toHaveBeenCalledTimes(2)
        expect(proxy.sessionCreate).toHaveBeenLastCalledWith('workspace-b')
      },
    })), prepareScenario1)
  })
})

describe('ACP session creation targets the workspace backend', () => {
  it('creates Claude and Hermes sessions through their own backend', async () => {
    await runScenarios((['claude', 'hermes'] as const).map(backend => ({
      name: backend,
      run: async () => {
        vi.resetAllMocks()
        transport.checkHealth.mockResolvedValue(true)
        transport.hasClaude.mockReturnValue(backend === 'claude')
        transport.hasHermes.mockReturnValue(backend === 'hermes')
        acp.transferCall.mockResolvedValue({ events: [] })
        acp.openStream.mockResolvedValue({ streamId: 'stream', close: async () => undefined })
        acp.createSession.mockResolvedValue({ sessionId: 'new-1' })
        const workspace = {
          workspaceId: `${backend}:cwd:/repo`, backend, title: 'repo', path: '/repo',
          sessionIds: [], createdAt: '', updatedAt: '',
        }
        useAppStore.setState({
          ...useAppStore.getInitialState(),
          selectedDevice: { deviceId: 'host', platform: 'linux' } as never,
          connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
          workspaces: [workspace],
          sessions: [],
          workspaceCatalog: { backend, loading: false } as never,
        })
        expect(await useAppStore.getState().createSession(workspace.workspaceId)).toBe(true)
        // A Hermes workspace must never be created through the Claude client.
        expect(acp.createSession).toHaveBeenCalledWith('/repo', 'agent', backend)
        // Opening the new session also reads history and opens a stream through the
        // same capability, so only the absence is exact.
        if (backend === 'hermes') {
          expect(transport.requireHermes).toHaveBeenCalled()
          expect(transport.requireClaude).not.toHaveBeenCalled()
        } else {
          expect(transport.requireClaude).toHaveBeenCalled()
          expect(transport.requireHermes).not.toHaveBeenCalled()
        }
        expect(useAppStore.getState().sessions.some(item => item.sessionId === `${backend}:new-1`)).toBe(true)
        expect(useAppStore.getState().selectedSession?.sessionId).toBe(`${backend}:new-1`)
      },
    })))
  })
})

describe('authoritative permission projection', () => {
  it('applies new Harness chat defaults only after Host confirmation', async () => {
    await runScenarios([
      ...(['default', 'workspace-write', 'danger-full-access'] as const).map(preset => ({
        name: `creates with ${preset} without changing the existing conversation`,
        run: async () => {
          const created = { ...session, sessionId: 'new', blank: true,
            projections: { values: { permissions: { currentValue: preset } } } }
          useAppStore.setState({ defaultPermissionPreset: preset })
          proxy.sessionCreate.mockResolvedValue({ sessionId: 'new' })
          proxy.sessionList.mockResolvedValue([session, created])
          expect(await useAppStore.getState().createSession()).toBe(true)
          expect(proxy.sessionSelectPermission.mock.calls).toEqual(preset === 'default' ? [] : [['new', preset]])
          expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({ currentValue: preset })
          expect(useAppStore.getState().sessions.find(item => item.sessionId === 's1')).toEqual(session)
        },
      })),
      ...(['rejected', 'unconfirmed', 'disconnected'] as const).map(reason => ({
        name: `does not open a new conversation when permissions are ${reason}`,
        run: async () => {
          useAppStore.setState({ defaultPermissionPreset: 'danger-full-access' })
          proxy.sessionCreate.mockResolvedValue({ sessionId: 'new' })
          proxy.sessionList.mockResolvedValue([session, { ...session, sessionId: 'new' }])
          if (reason === 'rejected') proxy.sessionSelectPermission.mockRejectedValue(new Error('refused'))
          if (reason === 'disconnected') proxy.sessionCreate.mockImplementation(async () => {
            await useAppStore.getState().disconnect()
            return { sessionId: 'new' }
          })
          expect(await useAppStore.getState().createSession()).toBe(false)
          expect(useAppStore.getState().selectedSession?.sessionId).not.toBe('new')
          if (reason === 'disconnected') expect(proxy.sessionSelectPermission).not.toHaveBeenCalled()
        },
      })),
      {
        name: 'opening an existing conversation never applies the configured default',
        run: async () => {
          useAppStore.setState({ defaultPermissionPreset: 'danger-full-access' })
          expect(await useAppStore.getState().openSession(session)).toBe(true)
          expect(proxy.sessionSelectPermission).not.toHaveBeenCalled()
          expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({ currentValue: 'default' })
        },
      },
    ], prepareScenario1)
  })

  it('starts CodeX with the default and remembers the actual permission for that Host and Thread', async () => {
    await runScenarios([
      ...(['default', 'workspace-write', 'danger-full-access'] as const).flatMap(preset =>
        (preset === 'danger-full-access' ? ['workspace-write', 'danger-full-access'] as const : ['workspace-write'] as const).map(effective => ({
          name: `requests ${preset} and preserves the returned ${effective} policy`,
          run: async () => {
            const workspace = { workspaceId: 'codex:project', backend: 'codex' as const, title: 'project', path: '/project', sessionIds: [], createdAt: '', updatedAt: '' }
            const openSession = vi.fn(async () => true)
            useAppStore.setState({ defaultPermissionPreset: preset, workspaces: [workspace], openSession,
              selectedDevice: { deviceId: 'host', name: 'Host', platform: 'linux', identityKey: 'key', membershipId: 'member', online: true, trusted: true } })
            codex.request.mockResolvedValue({ thread: { id: 'thread', cwd: '/project' },
              approvalPolicy: effective === 'danger-full-access' ? 'never' : 'on-request', sandbox: effective })
            expect(await useAppStore.getState().createSession(workspace.workspaceId)).toBe(true)
            expect(codex.request).toHaveBeenCalledWith('thread/start', {
              cwd: '/project', permissionPreset: preset === 'default' ? 'workspace-write' : preset,
            })
            expect(storage.saveCodexPermissionPreset).toHaveBeenCalledWith('host', 'thread', effective)
            expect(openSession).toHaveBeenCalledWith(expect.objectContaining({
              nativeId: 'thread', projections: { values: expect.objectContaining({ permissions: expect.objectContaining({ currentValue: effective }) }) },
            }))
            expect(proxy.sessionSelectPermission).not.toHaveBeenCalled()
          },
        }))),
    ], prepareScenario1)
  })

  const projection = (value: string, seq: number): MuxStreamFrame => ({ rpcId: '', payload: { type: 'session/projection', sessionId: 's1', key: 'permissions', value: { currentValue: value }, seq } })
  it('requires authoritative permission projections and change confirmation', async () => {
    await runScenarios(
      [
        {
          name: 'updates the selected session and rejects older permission projections',
          run: () => {
            useAppStore.getState().handleMuxFrame(projection('read-only', 20))
            useAppStore.getState().handleMuxFrame(projection('default', 10))
            expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({
              currentValue: 'read-only',
            })
          },
        },
        {
          name: 'reads back a successful permission change from the Host',
          run: async () => {
            proxy.sessionList.mockResolvedValue([
              { ...session, projections: { values: { permissions: { currentValue: 'read-only' } } } },
            ])
            expect(await useAppStore.getState().selectPermission('read-only')).toBe(true)
            expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({
              currentValue: 'read-only',
            })
          },
        },
        {
          name: 'does not invent a grant when the command succeeded but the Host did not confirm it',
          run: async () => {
            expect(await useAppStore.getState().selectPermission('full-access')).toBe(false)
            expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({
              currentValue: 'default',
            })
          },
        },
      ],
      async () => {
        await prepareScenario1()
      },
    )
  }, 15000)

})
