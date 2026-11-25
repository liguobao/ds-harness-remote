import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, HistoryEntry, MuxStreamFrame, RemoteSession } from '../src/types'
import { applyMuxFrame, foldHistory } from '../src/state/event-reducer'
import { mergeAcpHistoryAndLive } from '../src/services/cursor'
import { inboxQueuedItems, mergeHistoryAndLive, prependHistory, reconcileDeliveryStates } from '../src/state/message-helpers'
import { workspaceStableKey } from '../src/lib/workspace-key'
import { ForegroundConnectionRecovery } from '../src/services/connection-recovery'

const { proxy, transport, storage, authenticate, acp, codex, botDispatch, network } = vi.hoisted(() => ({
  proxy: { sessionHistory: vi.fn(), messageFeedbackList: vi.fn(), sessionModels: vi.fn(), sessionSelectModel: vi.fn(),
    agentPresetList: vi.fn(), agentPresetSelect: vi.fn(), sessionCancel: vi.fn(),
    sessionList: vi.fn(), sessionCreate: vi.fn(), hostDescribe: vi.fn(), workspaceList: vi.fn(), workspaceArchiveSession: vi.fn(), sessionSelectPermission: vi.fn(), sessionPrompt: vi.fn(), sessionUpdateQueue: vi.fn() },
  transport: { connect: vi.fn(), close: vi.fn(), checkHealth: vi.fn(), getNetworkDetails: vi.fn(), refreshBackends: vi.fn(), hasCodex: vi.fn(), hasCursor: vi.fn(), hasAntigravity: vi.fn(), hasPi: vi.fn(), hasOpencode: vi.fn(), hasClaude: vi.fn(), hasHermes: vi.fn(), requireClaude: vi.fn(), requireHermes: vi.fn(), requireSessionTools: vi.fn() },
  acp: { call: vi.fn(), transferCall: vi.fn(), openStream: vi.fn(), prompt: vi.fn(), sessionModels: vi.fn(), selectModel: vi.fn(), setMode: vi.fn(), selectPermission: vi.fn(), archiveSession: vi.fn(), createSession: vi.fn() },
  storage: { saveRecentWorkspaces: vi.fn(), saveLastConnectedDeviceId: vi.fn(), loadCodexPermissionPresets: vi.fn(), saveCodexPermissionPreset: vi.fn() },
  codex: { request: vi.fn(), subscribe: vi.fn() },
  authenticate: vi.fn(),
  botDispatch: vi.fn(),
  network: { preferred: ['relay'] as Array<'lan' | 'p2p' | 'turn' | 'relay'> },
}))
vi.mock('expo-haptics', () => ({ impactAsync: async () => undefined, ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' } }))
vi.mock('../src/services/network-route', () => ({ resolveAutomaticPreferredTransports: async () => network.preferred }))
vi.mock('../src/services/connection', async () => {
  const { BotRemoteClient } = await import('../src/services/bot-catalog')
  return { AndroidRemoteConnection: class {
    async configureHistory() {}
    requireProxy() { return proxy }
    requireBotClient() { return new BotRemoteClient(botDispatch, () => proxy.sessionList(), () => undefined) }
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
    requireSessionTools = transport.requireSessionTools
    requireCursor() { return acp }
    requireAntigravity() { return acp }
    requirePi() { return acp }
    requireOpencode() { return acp }
    requireClaude() { transport.requireClaude(); return acp }
    requireHermes() { transport.requireHermes(); return acp }
    getNetworkDetails = transport.getNetworkDetails
    getStats() { return { mode: 'Relay', connected: true } }
  } }
})
vi.mock('../src/services/storage', () => storage)
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate } }))
import { sessionChatImageLoader, useAppStore } from '../src/state/store'
import { createCursorWorkspaceSession } from '../src/services/cursor'
import { useBotTeamStore } from '../src/state/bot-store'

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
  network.preferred = ['relay']
  transport.checkHealth.mockResolvedValue(true)
  transport.getNetworkDetails.mockResolvedValue(undefined)
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
    busyAction: undefined,
    error: undefined,
    busySendMode: 'queue',
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
          expect(row()).toMatchObject({ queuedAdopted: true, sendState: inQueue ? 'queued' : undefined })
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

  it('keeps idle send inbox claim out of unconfirmed while still settling lost adopted prompts on stop', async () => {
    await runScenarios([
      {
        name: 'idle send inbox add then claim awaits echo without flagging unconfirmed',
        run: async () => {
          const idle = { ...session, running: false }
          useAppStore.setState({ selectedSession: idle, sessions: [idle] })
          let acknowledge!: () => void
          proxy.sessionPrompt.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve }))
          const rpcId = 'idle-claim-1'
          const sending = useAppStore.getState().sendMessage('what is zhihu', [], rpcId)
          const message = { id: 'host-idle-1', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'what is zhihu' }] }
          const inbox = (items: unknown[], seq: number) => useAppStore.getState().handleMuxFrame({ rpcId: '', payload: {
            type: 'session/projection', sessionId: 's1', key: 'inbox', seq, value: { 'next-turn': items },
          } } as MuxStreamFrame)
          inbox([message], 1)
          expect(useAppStore.getState().messages.s1?.[0]).toMatchObject({ id: `local:${rpcId}`, queuedAdopted: true, sendState: 'queued' })
          inbox([], 2)
          acknowledge()
          expect(await sending).toBe('sent')
          const claimed = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
          expect(claimed).toMatchObject({ id: `local:${rpcId}`, queuedAdopted: true, sendState: undefined })
          useAppStore.getState().handleMuxFrame(frame(entry('user/message', 10, { turn: 1, message })))
          const echoed = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
          expect(echoed).toMatchObject({ id: 'host-idle-1', nativeSeq: 10 })
          expect(echoed).not.toHaveProperty('sendState')
          expect(echoed).not.toHaveProperty('queuedAdopted')
        },
      },
      {
        name: 'claimed adopted prompt without echo settles to unconfirmed on stopped turn/end',
        run: async () => {
          const running = { ...session, running: true }
          useAppStore.setState({ selectedSession: running, sessions: [running] })
          proxy.sessionPrompt.mockResolvedValueOnce(undefined)
          const rpcId = 'claimed-aborted-1'
          expect(await useAppStore.getState().sendMessage('aborted after claim', [], rpcId)).toBe('sent')
          const message = { id: 'host-abort-1', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'aborted after claim' }] }
          useAppStore.getState().handleMuxFrame({ rpcId: '', payload: {
            type: 'session/projection', sessionId: 's1', key: 'inbox', seq: 1, value: { 'next-turn': [message] },
          } } as MuxStreamFrame)
          useAppStore.getState().handleMuxFrame({ rpcId: '', payload: {
            type: 'session/projection', sessionId: 's1', key: 'inbox', seq: 2, value: { 'next-turn': [] },
          } } as MuxStreamFrame)
          expect(useAppStore.getState().messages.s1?.[0]).toMatchObject({ id: `local:${rpcId}`, queuedAdopted: true, sendState: undefined })
          useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 25, { turn: 1, reason: { kind: 'aborted' } })))
          expect(useAppStore.getState().messages.s1?.[0]).toMatchObject({ id: `local:${rpcId}`, sendState: 'unconfirmed' })
        },
      },
    ], prepareScenario1)
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
        } else expect(row).toMatchObject({ sendState: action === 'remove' ? 'canceled' : undefined })
      },
    }))), prepareScenario1)
  })

  it('handles busySendMode steer/queue delivery, busyAction release, and unconfirmed retry', async () => {
    const scenarios = [
      'steer-while-running',
      'idle-fallback-to-queue',
      'in-flight-first-send-uses-steer',
      'steer-timeout-unconfirmed-and-retry',
    ] as const
    await runScenarios(scenarios.map(name => ({ name, run: async () => {
      if (name === 'steer-while-running') {
        const running = { ...session, running: true }
        useAppStore.setState({ selectedSession: running, sessions: [running], busySendMode: 'steer' })
        proxy.sessionPrompt.mockResolvedValueOnce(undefined)
        const rpcId = 'steer-direct-1'
        expect(await useAppStore.getState().sendMessage('interrupt now', [], rpcId)).toBe('sent')
        expect(proxy.sessionPrompt).toHaveBeenCalledWith('s1', 'interrupt now', rpcId, [], [], 'steer')
        expect(useAppStore.getState().busyAction).toBeUndefined()
        const row = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
        expect(row).toMatchObject({ id: `local:${rpcId}`, role: 'user', text: 'interrupt now' })
        expect(row?.kind === 'message' ? row.sendState : undefined).toBeUndefined()
        const message = { id: 'host-steer-1', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'interrupt now' }] }
        useAppStore.getState().handleMuxFrame(frame(entry('user/message', 25, { message })))
        const echoed = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
        expect(echoed).toMatchObject({ id: 'host-steer-1', nativeSeq: 25 })
        expect(echoed).not.toHaveProperty('sendState')
      } else if (name === 'idle-fallback-to-queue') {
        const idle = { ...session, running: false }
        useAppStore.setState({ selectedSession: idle, sessions: [idle], busySendMode: 'steer' })
        proxy.sessionPrompt.mockResolvedValueOnce(undefined)
        const rpcId = 'idle-normal-1'
        expect(await useAppStore.getState().sendMessage('new turn', [], rpcId)).toBe('sent')
        expect(proxy.sessionPrompt).toHaveBeenCalledWith('s1', 'new turn', rpcId, [], [], 'queue')
      } else if (name === 'in-flight-first-send-uses-steer') {
        const idle = { ...session, running: false }
        useAppStore.setState({ selectedSession: idle, sessions: [idle], busySendMode: 'steer', busyAction: 'send-message' })
        proxy.sessionPrompt.mockResolvedValueOnce(undefined)
        const rpcId = 'inflight-steer-1'
        expect(await useAppStore.getState().sendMessage('second send', [], rpcId)).toBe('sent')
        expect(proxy.sessionPrompt).toHaveBeenCalledWith('s1', 'second send', rpcId, [], [], 'steer')
      } else {
        const running = { ...session, running: true }
        useAppStore.setState({ selectedSession: running, sessions: [running], busySendMode: 'steer' })
        proxy.sessionPrompt.mockRejectedValueOnce(Object.assign(new Error('synthetic timeout'), { code: 'TIMEOUT' }))
        const rpcId = 'steer-timeout-1'
        expect(await useAppStore.getState().sendMessage('retryable steer', [], rpcId)).toBe('kept')
        expect(useAppStore.getState().busyAction).toBeUndefined()
        const timedOut = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
        expect(timedOut).toMatchObject({ id: `local:${rpcId}`, sendState: 'unconfirmed' })
        proxy.sessionPrompt.mockResolvedValueOnce(undefined)
        expect(await useAppStore.getState().retrySendMessage(`local:${rpcId}`)).toBe(true)
        expect(proxy.sessionPrompt).toHaveBeenLastCalledWith('s1', 'retryable steer', rpcId, [], [], 'steer')
      }
    } })), prepareScenario1)
  })

  it('settles an acknowledged prompt that history and inbox never recorded, and releases the composer', async () => {
    const local = (): ChatItem => ({ kind: 'message', id: 'local:rpc-lost', sessionId: 's1', role: 'user',
      text: '@missing.png', createdAt: 2, requestRpcId: 'rpc-lost' })
    const withInbox = (inbox: unknown, running = false) => ({ ...session, running,
      projections: { values: { permissions: { currentValue: 'default' }, inbox } } })
    await runScenarios([
      { name: 'idle session with no record', inbox: { 'next-turn': [] }, running: false, settled: true },
      { name: 'inbox still owns the request', inbox: { 'next-turn': [{ id: 'q1', source: { kind: 'user', rpcId: 'rpc-lost' }, content: [] }] }, running: false, settled: false },
      { name: 'session is still running', inbox: { 'next-turn': [] }, running: true, settled: false },
    ].map(({ name, inbox, running, settled }) => ({ name, run: async () => {
      const target = withInbox(inbox, running)
      useAppStore.setState({
        ...useAppStore.getInitialState(),
        selectedSession: target,
        selectedDevice: { deviceId: 'host' } as never,
        sessions: [target],
        connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
        messages: { s1: [local()] },
        busyAction: 'send-message',
      })
      proxy.sessionHistory.mockResolvedValueOnce(page([]))
      proxy.sessionList.mockResolvedValueOnce([target])
      expect(await useAppStore.getState().openSession(target)).toBe(true)
      const row = useAppStore.getState().messages.s1?.[0]
      if (settled) expect(row).toMatchObject({ sendState: 'unconfirmed' })
      else expect(row).not.toHaveProperty('sendState')
      expect(useAppStore.getState().busyAction).toBeUndefined()
    } })), prepareScenario1)
  })

  it('rejects an offline prompt before creating an optimistic row for every backend', async () => {
    // A tap that cannot reach the Host must not leave a `local:` row or a queued
    // acknowledgement: the composer keeps the draft and the user sends manually
    // after reconnection. Both send paths fail closed before the optimistic row.
    await runScenarios((['harness', 'codex', 'claude'] as const).map(backend => ({ name: backend, run: async () => {
      const target: RemoteSession = { ...session, sessionId: `offline-${backend}`, backend }
      useAppStore.setState({
        ...useAppStore.getInitialState(),
        selectedSession: target,
        selectedDevice: { deviceId: 'host' } as never,
        sessions: [target],
        connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } },
      })
      proxy.sessionPrompt.mockClear()
      acp.prompt.mockClear()
      codex.request.mockClear()
      expect(await useAppStore.getState().sendMessage('draft typed offline')).toBe('rejected')
      expect(proxy.sessionPrompt).not.toHaveBeenCalled()
      expect(acp.prompt).not.toHaveBeenCalled()
      expect(codex.request).not.toHaveBeenCalled()
      expect(useAppStore.getState().messages[target.sessionId] ?? []).toHaveLength(0)
      expect(useAppStore.getState().busyAction).toBeUndefined()
    } })), prepareScenario1)
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
  it('ignores remembered Relay downgrade on LAN-capable networks while honoring explicit Relay', async () => {
    await runScenarios([
      { name: 'Wi-Fi after cellular failures', preferred: ['lan', 'p2p', 'turn', 'relay'], preference: 'auto', force: false },
      { name: 'cellular cooldown', preferred: ['p2p', 'turn', 'relay'], preference: 'auto', force: true },
      { name: 'explicit Relay on Wi-Fi', preferred: ['lan', 'p2p', 'turn', 'relay'], preference: 'relay', force: true },
    ].map(row => ({ name: row.name, run: async () => {
      prepareScenario1()
      network.preferred = row.preferred as typeof network.preferred
      useAppStore.setState({
        config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never,
        transportPreference: row.preference as 'auto' | 'relay', relayOnlyUntil: Date.now() + 600_000,
      })
      expect(await useAppStore.getState().connectDevice({ deviceId: 'host' } as never)).toBe(true)
      const options = transport.connect.mock.calls[0]![5]
      expect(options.forceRelay).toBe(row.force)
      expect(options.preferredTransports).toEqual(row.force ? ['relay'] : row.preferred)
    } })), prepareScenario1)
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
  it('clears running state on setOffline and reopens a dropped Codex stream on healthy resumeConnection', async () => {
    const thread = (id: string) => ({
      id, cwd: '/project', status: { type: 'active', activeFlags: [] }, createdAt: 1, updatedAt: 2,
    })
    const openDroppedCodexSession = async () => {
      transport.hasCodex.mockReturnValue(true)
      codex.request.mockImplementation(async (method: string, args?: { threadId?: string }) => {
        if (method === 'thread/list') return { data: [thread('thread-1')] }
        if (method === 'project/list') return { data: [] }
        if (method === 'thread/read') return { thread: thread(args?.threadId ?? 'thread-1') }
        if (method === 'dsh/sessionHistory') {
          return { header: { id: `codex:${args?.threadId ?? 'thread-1'}` }, records: [], hasMore: false }
        }
        if (method === 'model/list') return { data: [{ model: 'model-1' }] }
        throw new Error(`Unexpected Codex RPC: ${method}`)
      })
      codex.subscribe.mockImplementation(async () => ({
        streamId: `stream-${codex.subscribe.mock.calls.length}`,
        close: async () => undefined,
      }))
      useAppStore.setState({ config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
      expect(await useAppStore.getState().connectDevice({ deviceId: 'host' } as never)).toBe(true)
      await useAppStore.getState().refreshWorkspaces('codex')
      const selected = useAppStore.getState().sessions.find(item => item.sessionId === 'codex:thread-1')!
      expect(await useAppStore.getState().openSession(selected)).toBe(true)
      expect(codex.subscribe).toHaveBeenCalledTimes(1)

      const onStreamClose = codex.subscribe.mock.calls[0]![3] as (reason: string) => void
      onStreamClose('peer-disconnected')
      expect(useAppStore.getState().connection.phase).toBe('connected')
      expect(useAppStore.getState().codexReadySessionId).toBeUndefined()
    }
    try {
      await runScenarios([
        {
          name: 'setOffline resets running on selected and background Codex sessions without remote close',
          run: async () => {
            transport.hasCodex.mockReturnValue(true)
            const streamClose = vi.fn(async () => undefined)
            codex.request.mockImplementation(async (method: string, args?: { threadId?: string }) => {
              if (method === 'thread/list') return { data: [thread('thread-1'), thread('thread-2')] }
              if (method === 'project/list') return { data: [] }
              if (method === 'thread/read') return { thread: thread(args?.threadId ?? 'thread-1') }
              if (method === 'dsh/sessionHistory') {
                return { header: { id: `codex:${args?.threadId ?? 'thread-1'}` }, records: [], hasMore: false, activeTurnId: 'turn-1' }
              }
              if (method === 'model/list') return { data: [{ model: 'model-1' }] }
              throw new Error(`Unexpected Codex RPC: ${method}`)
            })
            codex.subscribe.mockResolvedValue({ streamId: 'stream-1', close: streamClose })
            useAppStore.setState({ config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
            expect(await useAppStore.getState().connectDevice({ deviceId: 'host' } as never)).toBe(true)
            await useAppStore.getState().refreshWorkspaces('codex')
            const selected = useAppStore.getState().sessions.find(item => item.sessionId === 'codex:thread-1')!
            expect(await useAppStore.getState().openSession(selected)).toBe(true)
            const codexSessionsBefore = useAppStore.getState().sessions.filter(item => item.backend === 'codex')
            expect(codexSessionsBefore).toHaveLength(2)
            expect(codexSessionsBefore.every(item => item.running)).toBe(true)
            expect(useAppStore.getState().selectedSession?.running).toBe(true)

            useAppStore.getState().setOffline()

            expect(useAppStore.getState().connection.phase).toBe('offline')
            expect(useAppStore.getState().codexReadySessionId).toBeUndefined()
            expect(useAppStore.getState().selectedSession?.running).toBe(false)
            expect(useAppStore.getState().sessions.filter(item => item.backend === 'codex').every(item => !item.running)).toBe(true)
            expect(streamClose).not.toHaveBeenCalled()
          },
        },
        {
          name: 'resumeConnection reopens a dropped Codex stream when connected and healthy without reconnecting transport',
          run: async () => {
            await openDroppedCodexSession()

            await useAppStore.getState().resumeConnection()
            await vi.waitFor(() => expect(codex.subscribe).toHaveBeenCalledTimes(2))
            await vi.waitFor(() => expect(useAppStore.getState().codexReadySessionId).toBe('codex:thread-1'))
            expect(transport.connect).toHaveBeenCalledTimes(1)
            expect(useAppStore.getState().busyAction).toBeUndefined()

            await useAppStore.getState().resumeConnection()
            expect(codex.subscribe).toHaveBeenCalledTimes(2)
          },
        },
        {
          name: 'resumeConnection keeps zero reconnect and zero Codex reopen when no session is selected',
          run: async () => {
            transport.hasCodex.mockReturnValue(true)
            useAppStore.setState({
              selectedDevice: { deviceId: 'host' } as never,
              selectedSession: undefined,
              sessions: [],
              config: { baseUrl: 'https://example.invalid' } as never,
              identity: {} as never,
            })
            await useAppStore.getState().resumeConnection()
            expect(transport.connect).not.toHaveBeenCalled()
            expect(codex.subscribe).not.toHaveBeenCalled()
            expect(codex.request).not.toHaveBeenCalled()
            expect(proxy.sessionHistory).not.toHaveBeenCalled()
          },
        },
        {
          name: 'resumeConnection rebuilds a dropped Codex stream when initial checkHealth fails and retry succeeds',
          run: async () => {
            await openDroppedCodexSession()

            const openSessionSpy = vi.fn(useAppStore.getState().openSession)
            useAppStore.setState({ openSession: openSessionSpy })
            transport.checkHealth.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

            await useAppStore.getState().resumeConnection()
            expect(transport.checkHealth).toHaveBeenCalledTimes(2)
            expect(transport.connect).toHaveBeenCalledTimes(1)
            expect(openSessionSpy).toHaveBeenCalledTimes(1)
            expect(openSessionSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'codex:thread-1' }))
            await vi.waitFor(() => expect(codex.subscribe).toHaveBeenCalledTimes(2))
            await vi.waitFor(() => expect(useAppStore.getState().codexReadySessionId).toBe('codex:thread-1'))
            expect(useAppStore.getState().busyAction).toBeUndefined()
          },
        },
        ...(['offline', 'disconnect'] as const).map(interruption => ({
          name: `resumeConnection does not call openSession when transitioning to ${interruption} while refreshing network details`,
          run: async () => {
            await openDroppedCodexSession()

            const openSessionSpy = vi.fn(useAppStore.getState().openSession)
            useAppStore.setState({ openSession: openSessionSpy })
            let resolveDetails!: (details: undefined) => void
            transport.getNetworkDetails.mockClear()
            transport.getNetworkDetails.mockImplementationOnce(() => new Promise<undefined>(resolve => { resolveDetails = resolve }))

            const resuming = useAppStore.getState().resumeConnection()
            await vi.waitFor(() => expect(transport.getNetworkDetails).toHaveBeenCalledTimes(1))
            if (interruption === 'offline') useAppStore.getState().setOffline()
            else await useAppStore.getState().disconnect()
            resolveDetails(undefined)
            await resuming

            expect(openSessionSpy).not.toHaveBeenCalled()
            expect(codex.subscribe).toHaveBeenCalledTimes(1)
            expect(transport.connect).toHaveBeenCalledTimes(1)
          },
        })),
      ], async () => {
        await useAppStore.getState().disconnect()
        prepareScenario1()
      })
    } finally {
      await useAppStore.getState().disconnect()
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
              expect(acp.transferCall).toHaveBeenCalledWith(
                'dsh/sessionHistory', { sessionId: 'native-session', backend },
                ...(backend === 'antigravity' ? [expect.any(AbortSignal)] : []),
              )
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

  it('reconciles cached ACP prompts against their completed turns when reopening', async () => {
    const scenarios = ['complete history', 'stale history', 'history ends at user message', 'history ends mid-reply',
      'assistant-only history', 'live user echoes', 'tool-only turns']
    await runScenarios(scenarios.map(name => ({ name, run: async () => {
      const backend = name === 'live user echoes' ? 'antigravity' : 'pi'
      const selected = { ...session, backend, sessionId: `${backend}:reopen`, nativeId: 'reopen' }
      const toolOnly = name === 'tool-only turns'
      const answerId = (turn: number) => `host-answer-${turn}`
      const history = [1, 2].flatMap(turn => [
        entry('user/message', turn * 10, { id: `host-user-${turn}`, source: { kind: 'user' }, content: [{ type: 'text', text: 'repeat' }] }),
        toolOnly ? call(turn * 10 + 1, turn, answerId(turn))
          : entry('assistant/message', turn * 10 + 1, { turn, message: { id: answerId(turn), content: [{ type: 'text', text: 'same reply' }] } }),
        entry('turn/end', turn * 10 + 2, { turn, reason: { kind: 'completed' } }),
      ])
      const partial = name === 'history ends at user message' || name === 'history ends mid-reply'
      const assistantOnly = name === 'assistant-only history'
      const stale = name === 'stale history' || partial
      if (stale) acp.transferCall.mockResolvedValueOnce({ events: history.slice(0, 3) })
      expect(await useAppStore.getState().openSession(selected)).toBe(true)
      const receive = acp.openStream.mock.calls[0]![1]
      const update = (value: Record<string, unknown>) => receive({ streamId: 'acp-test',
        frame: { method: 'session/update', params: { sessionId: 'reopen', update: value } } })

      for (let turn = stale ? 2 : 1; turn <= 2; turn++) {
        expect(await useAppStore.getState().sendMessage('repeat')).toBe('sent')
        if (name === 'live user echoes') update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'repeat' } })
        if (toolOnly) update({ sessionUpdate: 'tool_call', toolCallId: answerId(turn), title: 'bash', status: 'completed' })
        else update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'same reply' } })
        update({ sessionUpdate: 'prompt_completed', stopReason: 'end_turn' })
      }
      const expectedIds = ['host-user-1', answerId(1), 'host-user-2', answerId(2)]
      const cached = useAppStore.getState().messages[selected.sessionId]!
      const pending = { kind: 'message', id: 'local:pending', sessionId: selected.sessionId, role: 'user', text: 'repeat', createdAt: 3000 } as const
      const failed = { ...pending, id: 'local:failed', text: 'failed', sendState: 'failed' } as const
      useAppStore.setState(state => ({ messages: { ...state.messages,
        [selected.sessionId]: [...state.messages[selected.sessionId]!, pending, failed],
      } }))

      let reopenedHistory = stale ? history.slice(0, partial ? 4 : 3) : assistantOnly ? history.slice(-2) : history
      if (name === 'history ends mid-reply') reopenedHistory = [...reopenedHistory, entry('assistant/message', 21, {
        turn: 2, message: { id: answerId(2), content: [{ type: 'text', text: 'same' }] },
      })]
      acp.transferCall.mockResolvedValueOnce({ events: reopenedHistory })
      expect(await useAppStore.getState().openSession(selected)).toBe(true)
      const messages = useAppStore.getState().messages[selected.sessionId]!
      const turnIds = (items: ChatItem[]) => items.filter(item => item.id !== pending.id && item.id !== failed.id).map(item => item.id)
      expect(turnIds(messages)).toEqual(partial ? [...expectedIds.slice(0, 3), cached[3]!.id]
        : stale ? cached.map(item => item.id)
          : assistantOnly ? [answerId(2), ...cached.filter(item => item.id.startsWith('local:')).map(item => item.id)] : expectedIds)
      expect(messages).toContainEqual(pending)
      expect(messages).toContainEqual(failed)
      if (stale) {
        acp.transferCall.mockResolvedValueOnce({ events: history })
        expect(await useAppStore.getState().openSession(selected)).toBe(true)
        expect(turnIds(useAppStore.getState().messages[selected.sessionId]!)).toEqual(expectedIds)
        expect(useAppStore.getState().messages[selected.sessionId]).toHaveLength(6)
      }
      expect(acp.prompt).toHaveBeenCalledTimes(stale ? 1 : 2)
    } })), prepareScenario1)
  })

  it('keeps only new ACP subscription deltas while history is loading', async () => {
    await runScenarios((['pi', 'antigravity'] as const).flatMap(backend =>
      ['live', 'completed', 'switch', 'reject'].map(mode => ({ name: `${backend}: ${mode}`, run: async () => {
        const selected = { ...session, backend, sessionId: `${backend}:old`, nativeId: 'old' }
        useAppStore.setState({ messages: { [selected.sessionId]: [
          { kind: 'message', id: 'cursor-assistant-live', sessionId: selected.sessionId, role: 'assistant', text: 'stale cache', createdAt: 1, streaming: true },
          { kind: 'approval', id: 'cursor-approval:pre-open', sessionId: selected.sessionId, approvalId: 'pre-open', toolName: 'Ask Question', frameRpcId: 'pre-open', createdAt: 2 },
        ] } })
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
          expect.objectContaining({ kind: 'approval', approvalId: 'pre-open' }),
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

  it('shows AGY history when another peer owns the live stream', async () => {
    const selected = { ...session, sessionId: 'antigravity:owned', nativeId: 'owned', backend: 'antigravity' } as const
    acp.openStream.mockRejectedValueOnce(Object.assign(new Error('owned'), { code: 'CURSOR_SESSION_OWNED' }))
    acp.transferCall.mockResolvedValueOnce({ events: [entry('assistant/message', 1, {
      turn: 1, message: { id: 'history', content: [{ type: 'text', text: 'read-only history' }] },
    })] })
    expect(await useAppStore.getState().openSession(selected)).toBe(true)
    expect(useAppStore.getState().messages[selected.sessionId]).toEqual([
      expect.objectContaining({ kind: 'message', text: 'read-only history' }),
    ])
    expect(useAppStore.getState().acpReadOnlySessionId).toBe(selected.sessionId)
    expect(useAppStore.getState().busyAction).toBeUndefined()
    expect(await useAppStore.getState().sendMessage('new message')).toBe('rejected')
    expect(acp.prompt).not.toHaveBeenCalled()
    expect(await useAppStore.getState().openSession(selected)).toBe(true)
    expect(useAppStore.getState().acpReadOnlySessionId).toBeUndefined()
  })

  it('aborts AGY history on navigation without changing the next conversation', async () => {
    let signal: AbortSignal | undefined
    acp.transferCall.mockImplementationOnce((_method, _params, readSignal: AbortSignal) => {
      signal = readSignal
      return new Promise((_resolve, reject) => {
        readSignal.addEventListener('abort', () => reject(readSignal.reason), { once: true })
      })
    })
    const old = useAppStore.getState().openSession({ ...session, sessionId: 'antigravity:old', nativeId: 'old', backend: 'antigravity' })
    await vi.waitFor(() => expect(signal?.aborted).toBe(false))
    expect(await useAppStore.getState().openSession({ ...session, sessionId: 'new' })).toBe(true)
    expect(signal?.aborted).toBe(true)
    expect(await old).toBe(false)
    expect(useAppStore.getState().selectedSession?.sessionId).toBe('new')
    expect(useAppStore.getState().messages['antigravity:old']).toBeUndefined()
    expect(useAppStore.getState().error).toBeUndefined()
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
  it('reuses the newest idle blank in the same workspace and backend on repeated new-chat requests', async () => {
    const older = { ...session, sessionId: 'older', blank: true }
    const newest = { ...older, sessionId: 'newest', updatedAt: 2 }
    const foreign = { ...newest, sessionId: 'foreign', updatedAt: 3 }
    const archived = { ...newest, sessionId: 'archived', updatedAt: 4 }
    const running = { ...newest, sessionId: 'running', running: true, updatedAt: 5 }
    const otherBackend = { ...newest, sessionId: 'codex:blank', backend: 'codex' as const, updatedAt: 6 }
    useAppStore.setState({
      sessions: [older, newest, foreign, archived, running, otherBackend],
      archivedSessionIds: ['archived'],
      workspaces: [{ workspaceId: 'workspace-a', title: 'A', path: '/a', createdAt: '', updatedAt: '',
        sessionIds: ['older', 'newest', 'archived', 'running', 'codex:blank'] }],
    })
    expect(await useAppStore.getState().createSession('workspace-a')).toBe(true)
    expect(await useAppStore.getState().createSession('workspace-a')).toBe(true)
    expect(useAppStore.getState().selectedSession?.sessionId).toBe('newest')
    expect(proxy.sessionCreate).not.toHaveBeenCalled()
    expect(proxy.sessionSelectPermission).not.toHaveBeenCalled()
    expect(useAppStore.getState().busyAction).toBeUndefined()
  })

  it('creates when the workspace only has nonempty conversations, even with a new-chat title', async () => {
    useAppStore.setState({ sessions: [{ ...session, title: '新对话' }],
      workspaces: [{ workspaceId: 'workspace-a', title: 'A', path: '/a', createdAt: '', updatedAt: '', sessionIds: ['s1'] }] })
    const created = { ...session, sessionId: 'new', blank: true }
    proxy.sessionCreate.mockResolvedValue({ sessionId: 'new' })
    proxy.sessionList.mockResolvedValue([session, created])
    expect(await useAppStore.getState().createSession('workspace-a')).toBe(true)
    expect(proxy.sessionCreate).toHaveBeenCalledOnce()
  })

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
  transport.getNetworkDetails.mockResolvedValue(undefined)
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

  it('opens Bot sessions only on identity, part, or connection/Host changes without disrupting pagination on status polls', async () => {
    const chiefPart1: RemoteSession = { sessionId: 'chief-part-1', title: 'Chief Part 1', updatedAt: 1, running: false, blank: false }
    const chiefPart2: RemoteSession = { sessionId: 'chief-part-2', title: 'Chief Part 2', updatedAt: 2, running: false, blank: false }
    const writerPart1: RemoteSession = { sessionId: 'writer-part-1', title: 'Writer Part 1', updatedAt: 3, running: false, blank: false }

    await runScenarios([
      {
        name: 'repeated status polls keep the current Bot session without re-calling openSession, aborting older-history pagination, or resetting sessionModels',
        run: async () => {
          useAppStore.setState({
            config: { baseUrl: 'https://remote.example' } as never,
            identity: { deviceId: 'phone' } as never,
            selectedDevice: { deviceId: 'host-a', name: 'Host A', identityKey: 'key-a', online: true, trusted: true } as never,
            sessions: [chiefPart1, chiefPart2, writerPart1],
          })
          useBotTeamStore.getState().ensureScope('reset-poll-test')
          proxy.sessionList.mockResolvedValue([chiefPart1, chiefPart2, writerPart1])
          proxy.sessionModels.mockResolvedValue({
            current: { model: 'deepseek-chat' },
            routable: true,
            groups: [],
            failures: [],
          })
          proxy.sessionHistory.mockResolvedValueOnce({ events: [call(10, 1, 'tail-call'), result(11, 1, 'tail-call')], throughSeq: 11, hasMore: true })
          botDispatch.mockImplementation(async ({ endpoint }: { endpoint: string }) => ({
            status: 200,
            json: {
              ok: true,
              value: endpoint === 'state'
                ? {
                    mainBotId: 'chief',
                    bots: [
                      { id: 'chief', sessionId: 'chief-part-2', parts: ['chief-part-1'], name: 'Chief', role: 'Lead', main: true },
                      { id: 'writer', sessionId: 'writer-part-1', name: 'Writer', role: 'Docs', main: false },
                    ],
                    rooms: [],
                  }
                : {},
            },
          }))

          await useBotTeamStore.getState().refresh()
          await useBotTeamStore.getState().syncSelectedSession()
          expect(useBotTeamStore.getState().session?.sessionId).toBe('chief-part-2')
          expect(useAppStore.getState().selectedSession?.sessionId).toBe('chief-part-2')
          expect(useAppStore.getState().sessionModels?.current?.model).toBe('deepseek-chat')
          expect(proxy.sessionHistory).toHaveBeenCalledTimes(1)

          // Start an in-flight older history pagination read while 3s Bot status polls arrive.
          let resolveOlderPage!: (value: { events: HistoryEntry[]; throughSeq: number; hasMore: boolean }) => void
          proxy.sessionHistory.mockImplementationOnce(
            () => new Promise(resolve => { resolveOlderPage = resolve }),
          )
          const olderFlight = useAppStore.getState().loadOlderHistory()
          expect(useAppStore.getState().historyLoadingOlder).toBe(true)

          // Three consecutive status polls allocate fresh bots/rooms arrays for the same Bot/sessionId.
          for (let i = 0; i < 3; i++) {
            await useBotTeamStore.getState().refresh()
            await useBotTeamStore.getState().syncSelectedSession()
          }

          // openSession must not have been re-invoked: pagination stays in flight and sessionModels stays intact.
          expect(proxy.sessionHistory).toHaveBeenCalledTimes(2)
          expect(useAppStore.getState().historyLoadingOlder).toBe(true)
          expect(useAppStore.getState().sessionModels?.current?.model).toBe('deepseek-chat')

          resolveOlderPage({
            events: [call(4, 0, 'older-call'), result(5, 0, 'older-call')],
            throughSeq: 5,
            hasMore: false,
          })
          await olderFlight
          expect(useAppStore.getState().historyLoadingOlder).toBe(false)
          expect(useAppStore.getState().oldestLoadedSeq).toBe(4)
          expect(useAppStore.getState().messages['chief-part-2']?.map(item => item.id)).toEqual(['older-call', 'tail-call'])
        },
      },
      {
        name: 'switches Bot or historical part and opens the corresponding session',
        run: async () => {
          let activeChiefSessionId = 'chief-part-2'
          useAppStore.setState({
            config: { baseUrl: 'https://remote.example' } as never,
            identity: { deviceId: 'phone' } as never,
            selectedDevice: { deviceId: 'host-a', name: 'Host A', identityKey: 'key-a', online: true, trusted: true } as never,
            sessions: [chiefPart1, chiefPart2, writerPart1],
          })
          useBotTeamStore.getState().ensureScope('reset-switch-test')
          proxy.sessionList.mockResolvedValue([chiefPart1, chiefPart2, writerPart1])
          botDispatch.mockImplementation(async ({ endpoint, payload }: { endpoint: string; payload?: Record<string, unknown> }) => {
            if (endpoint === 'bot-open-part' && typeof payload?.sessionId === 'string') {
              activeChiefSessionId = payload.sessionId
              return { status: 200, json: { ok: true, value: true } }
            }
            return {
              status: 200,
              json: {
                ok: true,
                value: {
                  mainBotId: 'chief',
                  bots: [
                    { id: 'chief', sessionId: activeChiefSessionId, parts: ['chief-part-1', 'chief-part-2'], name: 'Chief', role: 'Lead', main: true },
                    { id: 'writer', sessionId: 'writer-part-1', name: 'Writer', role: 'Docs', main: false },
                  ],
                  rooms: [],
                },
              },
            }
          })

          await useBotTeamStore.getState().refresh()
          await useBotTeamStore.getState().syncSelectedSession()
          expect(useBotTeamStore.getState().session?.sessionId).toBe('chief-part-2')
          expect(proxy.sessionHistory).toHaveBeenLastCalledWith('chief-part-2', undefined, 16, undefined)

          // Switch Chief to its earlier historical part.
          await useBotTeamStore.getState().perform('bot-open-part', { botId: 'chief', sessionId: 'chief-part-1' })
          expect(useBotTeamStore.getState().session?.sessionId).toBe('chief-part-1')
          expect(useAppStore.getState().selectedSession?.sessionId).toBe('chief-part-1')
          expect(proxy.sessionHistory).toHaveBeenLastCalledWith('chief-part-1', undefined, 16, undefined)

          // Switch to another Bot.
          useBotTeamStore.getState().setSelectedId('writer')
          await useBotTeamStore.getState().syncSelectedSession()
          expect(useBotTeamStore.getState().session?.sessionId).toBe('writer-part-1')
          expect(useAppStore.getState().selectedSession?.sessionId).toBe('writer-part-1')
          expect(proxy.sessionHistory).toHaveBeenLastCalledWith('writer-part-1', undefined, 16, undefined)
        },
      },
      {
        name: 're-establishes the Bot session after disconnect recovery or switching to another Host with the same sessionId',
        run: async () => {
          const hostAChief: RemoteSession = { sessionId: 'chief-part-1', title: 'Host A Chief', updatedAt: 1, running: false, blank: false }
          const hostBChief: RemoteSession = { sessionId: 'chief-part-1', title: 'Host B Chief', updatedAt: 2, running: false, blank: false }
          useAppStore.setState({
            config: { baseUrl: 'https://remote.example' } as never,
            identity: { deviceId: 'phone' } as never,
            selectedDevice: { deviceId: 'host-a', name: 'Host A', identityKey: 'key-a', online: true, trusted: true } as never,
            sessions: [hostAChief],
          })
          useBotTeamStore.getState().ensureScope('reset-reconnect-test')
          proxy.sessionList.mockImplementation(async () =>
            useAppStore.getState().selectedDevice?.deviceId === 'host-b' ? [hostBChief] : [hostAChief],
          )
          botDispatch.mockResolvedValue({
            status: 200,
            json: {
              ok: true,
              value: {
                mainBotId: 'chief',
                bots: [{ id: 'chief', sessionId: 'chief-part-1', name: 'Chief', role: 'Lead', main: true }],
                rooms: [],
              },
            },
          })

          await useBotTeamStore.getState().refresh()
          await useBotTeamStore.getState().syncSelectedSession()
          expect(useBotTeamStore.getState().session?.title).toBe('Host A Chief')
          expect(proxy.sessionHistory).toHaveBeenCalledTimes(1)

          // Disconnect and recover on Host A: same Bot and sessionId must re-open on the recovered connection.
          useAppStore.getState().setOffline()
          expect(useAppStore.getState().connection.phase).toBe('offline')
          expect(await useAppStore.getState().connectDevice({
            deviceId: 'host-a', name: 'Host A', identityKey: 'key-a', online: true, trusted: true,
          } as never)).toBe(true)
          await useBotTeamStore.getState().refresh()
          await useBotTeamStore.getState().syncSelectedSession()
          expect(proxy.sessionHistory).toHaveBeenCalledTimes(2)
          expect(useBotTeamStore.getState().session?.title).toBe('Host A Chief')

          // Switch to Host B which happens to use the same Bot id ('chief') and sessionId ('chief-part-1').
          expect(await useAppStore.getState().connectDevice({
            deviceId: 'host-b', name: 'Host B', identityKey: 'key-b', online: true, trusted: true,
          } as never)).toBe(true)
          await useBotTeamStore.getState().refresh()
          await useBotTeamStore.getState().syncSelectedSession()
          expect(proxy.sessionHistory).toHaveBeenCalledTimes(3)
          expect(useBotTeamStore.getState().session?.title).toBe('Host B Chief')
          expect(useAppStore.getState().selectedSession?.title).toBe('Host B Chief')
        },
      },
      {
        name: 'deletes an active or main Bot cleanly without bouncing back to the deleted selection',
        run: async () => {
          let bots = [
            { id: 'chief', sessionId: 'chief-part-2', name: 'Chief', role: 'Lead', main: true },
            { id: 'writer', sessionId: 'writer-part-1', name: 'Writer', role: 'Docs', main: true },
            { id: 'helper', sessionId: ' chief-part-1', name: 'Helper', role: 'Ops', main: false },
          ]
          useAppStore.setState({
            config: { baseUrl: 'https://remote.example' } as never,
            identity: { deviceId: 'phone' } as never,
            selectedDevice: { deviceId: 'host-a', name: 'Host A', identityKey: 'key-a', online: true, trusted: true } as never,
            sessions: [chiefPart1, chiefPart2, writerPart1],
          })
          useBotTeamStore.getState().ensureScope('reset-delete-bot-test')
          proxy.sessionList.mockResolvedValue([chiefPart1, chiefPart2, writerPart1])
          const calls: Array<{ endpoint: string; payload?: Record<string, unknown> }> = []
          botDispatch.mockImplementation(async ({ endpoint, payload }: { endpoint: string; payload?: Record<string, unknown> }) => {
            calls.push({ endpoint, payload })
            if (endpoint === 'set-main') {
              const id = String(payload?.id ?? '')
              const main = Boolean(payload?.main)
              const replace = typeof payload?.replace === 'string' ? payload.replace : undefined
              bots = bots.map(entry => {
                if (entry.id === id) return { ...entry, main }
                if (replace && entry.id === replace) return { ...entry, main: false }
                return entry
              })
              return { status: 200, json: { ok: true, value: { mainBotId: bots.find(b => b.main)?.id, mainBotIds: bots.filter(b => b.main).map(b => b.id), bots, rooms: [] } } }
            }
            if (endpoint === 'delete-bot') {
              const id = String(payload?.id ?? '')
              const target = bots.find(b => b.id === id)
              if (target?.main) {
                return { status: 200, json: { ok: false, error: { message: 'A Main Bot cannot be deleted' } } }
              }
              bots = bots.filter(entry => entry.id !== id)
              return { status: 200, json: { ok: true, value: { mainBotId: bots.find(b => b.main)?.id, mainBotIds: bots.filter(b => b.main).map(b => b.id), bots, rooms: [] } } }
            }
            return {
              status: 200,
              json: {
                ok: true,
                value: {
                  mainBotId: bots.find(b => b.main)?.id,
                  mainBotIds: bots.filter(b => b.main).map(b => b.id),
                  bots,
                  rooms: [],
                },
              },
            }
          })

          await useBotTeamStore.getState().refresh()
          useBotTeamStore.getState().setSelectedId('writer')
          await useBotTeamStore.getState().syncSelectedSession()
          expect(useBotTeamStore.getState().selectedId).toBe('writer')
          expect(useBotTeamStore.getState().session?.sessionId).toBe('writer-part-1')

          // Deleting 'writer' (which is one of two main bots) demotes it first, deletes it, and leaves selectedId undefined.
          const delWriter = await useBotTeamStore.getState().perform('delete-bot', { id: 'writer' })
          expect(delWriter.ok).toBe(true)
          expect(calls.some(c => c.endpoint === 'set-main' && c.payload?.id === 'writer' && c.payload?.main === false)).toBe(true)
          expect(calls.some(c => c.endpoint === 'delete-bot' && c.payload?.id === 'writer')).toBe(true)
          expect(useBotTeamStore.getState().selectedId).toBeUndefined()
          expect(useBotTeamStore.getState().session).toBeUndefined()
          expect(useBotTeamStore.getState().state?.bots.map(b => b.id)).toEqual(['chief', 'helper'])

          // Deleting 'chief' (now the sole main bot, with non-private 'helper' available) hands over main role to 'helper' first.
          const delChief = await useBotTeamStore.getState().perform('delete-bot', { id: 'chief' })
          expect(delChief.ok).toBe(true)
          expect(calls.some(c => c.endpoint === 'set-main' && c.payload?.id === 'helper' && c.payload?.replace === 'chief')).toBe(true)
          expect(calls.some(c => c.endpoint === 'delete-bot' && c.payload?.id === 'chief')).toBe(true)
          expect(useBotTeamStore.getState().state?.bots.map(b => b.id)).toEqual(['helper'])
        },
      },
      {
        name: 'retains background ask_user_question and approval cards across notification openSession and re-entry',
        run: async () => {
          const askCall = entry('tool/call', 10, {
            turn: 2,
            callId: 'call-ask-1',
            name: 'ask_user_question',
            arguments: JSON.stringify({ questions: [{ id: 'q1', question: 'Deploy target?' }] }),
          })
          // Background state: session s1 only received the mux question/approval frames (no cached native history overlap).
          useAppStore.getState().handleMuxFrame({
            rpcId: 'evt-question-1',
            payload: {
              type: 'question/requested',
              sessionId: 's1',
              questions: [{ id: 'q1', question: 'Deploy target?', options: [{ label: 'Staging' }, { label: 'Prod' }] }],
            },
          })
          useAppStore.getState().handleMuxFrame({
            rpcId: 'evt-approval-1',
            payload: {
              type: 'approval/requested',
              sessionId: 's1',
              approvalId: 'evt-approval-1',
              toolName: 'bash',
              callId: 'call-ask-1',
            },
          })
          expect(useAppStore.getState().messages.s1).toMatchObject([
            { kind: 'question', id: 'question:evt-question-1' },
            { kind: 'approval', id: 'approval:evt-approval-1' },
          ])

          // Notification tap opens s1; history tail has no overlap with cachedIds (`contiguousCache === false`)
          // and `session.running` may even be stale false while `ask_user_question` tool/call is still running.
          proxy.sessionHistory.mockResolvedValueOnce(page([askCall]))
          expect(await useAppStore.getState().openSession({ ...session, running: false })).toBe(true)
          expect(useAppStore.getState().messages.s1).toMatchObject([
            { kind: 'tool', id: 'call-ask-1', state: 'running', turn: '2' },
            { kind: 'question', id: 'question:evt-question-1', turn: '2' },
            { kind: 'approval', id: 'approval:evt-approval-1', turn: '2' },
          ])
          expect(useAppStore.getState().messages.s1?.find(item => item.kind === 'question')?.outcome).toBeUndefined()
          expect(useAppStore.getState().messages.s1?.find(item => item.kind === 'approval')?.outcome).toBeUndefined()

          // Re-entering the session preserves the active question and approval cards.
          proxy.sessionHistory.mockResolvedValueOnce(page([askCall]))
          expect(await useAppStore.getState().openSession({ ...session, running: true })).toBe(true)
          expect(useAppStore.getState().messages.s1).toMatchObject([
            { kind: 'tool', id: 'call-ask-1', state: 'running', turn: '2' },
            { kind: 'question', id: 'question:evt-question-1', turn: '2' },
            { kind: 'approval', id: 'approval:evt-approval-1', turn: '2' },
          ])
          expect(useAppStore.getState().messages.s1?.find(item => item.kind === 'question')?.outcome).toBeUndefined()
          expect(useAppStore.getState().messages.s1?.find(item => item.kind === 'approval')?.outcome).toBeUndefined()
        },
      },
      {
        name: 'restores timed userQuestions projection on openSession even when no prior mux frame was cached',
        run: async () => {
          const askCall = entry('tool/call', 10, {
            turn: 2,
            callId: 'call-timed-1',
            name: 'ask_user_question',
            arguments: JSON.stringify({ questions: [{ id: 'q1', question: 'Pick mode?' }] }),
          })
          const targetWithProjection = {
            ...session,
            running: true,
            projections: {
              asOfSeq: 10,
              values: {
                userQuestions: {
                  active: [{
                    callId: 'call-timed-1',
                    state: 'open',
                    questions: [{ id: 'q1', question: 'Pick mode?', options: [{ label: 'Fast' }] }],
                  }],
                  settled: [],
                },
              },
            },
          }
          useAppStore.setState({ sessions: [targetWithProjection], messages: {} })
          proxy.sessionHistory.mockResolvedValueOnce(page([askCall]))
          expect(await useAppStore.getState().openSession(targetWithProjection)).toBe(true)
          expect(useAppStore.getState().messages.s1).toMatchObject([
            { kind: 'tool', id: 'call-timed-1', turn: '2' },
            {
              kind: 'question',
              id: 'question:timed-question:["s1","call-timed-1"]',
              callId: 'call-timed-1',
              questionState: 'open',
              turn: '2',
            },
          ])
          expect(useAppStore.getState().messages.s1?.find(item => item.kind === 'question')?.outcome).toBeUndefined()
        },
      },
    ], async () => {
      await prepareScenario1()
    })
  }, 15000)

})

describe('selector guards, post-stop queue cleanup, and failed message history ordering (#494)', () => {
  it('resets permissionSelecting on disconnect/offline/navigation and blocks stale model and preset completions', async () => {
    await runScenarios([
      ...(['onClose', 'setOffline', 'openSession'] as const).flatMap(interruption =>
        (['resolve', 'reject'] as const).map(outcome => ({
          name: `selectPermission interrupted by ${interruption} then ${outcome}`,
          run: async () => {
            const device = { deviceId: 'host' } as never
            useAppStore.setState({ config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
            expect(await useAppStore.getState().connectDevice(device)).toBe(true)
            const s2: RemoteSession = { ...session, sessionId: 's2' }
            useAppStore.setState({ selectedSession: session, sessions: [session, s2] })

            let finishPerm!: () => void
            let failPerm!: (error: Error) => void
            proxy.sessionSelectPermission.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
              finishPerm = resolve
              failPerm = reject
            }))
            proxy.sessionList.mockResolvedValue([
              { ...session, projections: { values: { permissions: { currentValue: 'read-only' } } } },
              s2,
            ])

            const selecting = useAppStore.getState().selectPermission('read-only')
            expect(useAppStore.getState().permissionSelecting).toBe(true)

            let s2Selecting: Promise<boolean> | undefined
            let finishS2Perm: (() => void) | undefined
            if (interruption === 'onClose') {
              const options = transport.connect.mock.calls[0]![5] as { onClose?: () => void }
              options.onClose?.()
            } else if (interruption === 'setOffline') {
              useAppStore.getState().setOffline()
            } else {
              expect(await useAppStore.getState().openSession(s2)).toBe(true)
              expect(useAppStore.getState().permissionSelecting).toBe(false)
              // Start a fresh permission change on s2 so the stale s1 completion must not clear s2's flag.
              proxy.sessionSelectPermission.mockImplementationOnce(() => new Promise<void>(resolve => {
                finishS2Perm = resolve
              }))
              proxy.sessionList.mockResolvedValue([
                session,
                { ...s2, projections: { values: { permissions: { currentValue: 'workspace-write' } } } },
              ])
              s2Selecting = useAppStore.getState().selectPermission('workspace-write')
              expect(useAppStore.getState().permissionSelecting).toBe(true)
            }

            if (interruption !== 'openSession') {
              expect(useAppStore.getState().permissionSelecting).toBe(false)
            }
            if (outcome === 'resolve') finishPerm()
            else failPerm(new Error('stale permission failure'))

            expect(await selecting).toBe(false)
            expect(useAppStore.getState().error).toBeUndefined()
            if (interruption === 'openSession') {
              expect(useAppStore.getState().selectedSession?.sessionId).toBe('s2')
              expect(useAppStore.getState().permissionSelecting).toBe(true)
              finishS2Perm?.()
              expect(await s2Selecting).toBe(true)
              expect(useAppStore.getState().permissionSelecting).toBe(false)
              expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({
                currentValue: 'workspace-write',
              })
            } else {
              expect(useAppStore.getState().permissionSelecting).toBe(false)
              expect(useAppStore.getState().selectedSession?.projections?.values?.permissions).toEqual({
                currentValue: 'default',
              })
            }
          },
        }))),
      ...(['resolve', 'reject'] as const).map(outcome => ({
        name: `Harness selectModel stale ${outcome} does not pollute new session`,
        run: async () => {
          const s2: RemoteSession = { ...session, sessionId: 's2' }
          useAppStore.setState({
            selectedSession: session,
            sessions: [session, s2],
            sessionModels: { current: { provider: 'deepseek', model: 'chat' }, routable: true, groups: [], failures: [] },
          })
          let finishModel!: (value: { provider: string; model: string }) => void
          let failModel!: (error: Error) => void
          proxy.sessionSelectModel.mockImplementationOnce(() => new Promise((resolve, reject) => {
            finishModel = resolve
            failModel = reject
          }))
          const selecting = useAppStore.getState().selectModel({ provider: 'deepseek', model: 'reasoner' })
          expect(useAppStore.getState().modelSelecting).toBe(true)
          expect(await useAppStore.getState().openSession(s2)).toBe(true)
          expect(useAppStore.getState().modelSelecting).toBe(false)
          useAppStore.setState({
            sessionModels: { current: { provider: 'deepseek', model: 's2-model' }, routable: true, groups: [], failures: [] },
          })
          if (outcome === 'resolve') finishModel({ provider: 'deepseek', model: 'reasoner' })
          else failModel(new Error('late model error'))
          expect(await selecting).toBe(false)
          expect(useAppStore.getState().sessionModels?.current).toEqual({ provider: 'deepseek', model: 's2-model' })
          expect(useAppStore.getState().modelSelecting).toBe(false)
          expect(useAppStore.getState().error).toBeUndefined()
        },
      })),
      ...(['openSession', 'setOffline'] as const).flatMap(interruption =>
        (['resolve', 'reject'] as const).map(outcome => ({
          name: `selectAgentPreset interrupted by ${interruption} then ${outcome}`,
          run: async () => {
            const s2: RemoteSession = { ...session, sessionId: 's2', agentPreset: 'default' }
            useAppStore.setState({ selectedSession: { ...session, agentPreset: 'default' }, sessions: [{ ...session, agentPreset: 'default' }, s2] })
            let finishPreset!: (value: string) => void
            let failPreset!: (error: Error) => void
            proxy.agentPresetSelect.mockImplementationOnce(() => new Promise<string>((resolve, reject) => {
              finishPreset = resolve
              failPreset = reject
            }))
            const selecting = useAppStore.getState().selectAgentPreset('plan')
            expect(useAppStore.getState().agentPresetSelecting).toBe(true)
            if (interruption === 'openSession') {
              expect(await useAppStore.getState().openSession(s2)).toBe(true)
            } else {
              useAppStore.getState().setOffline()
            }
            expect(useAppStore.getState().agentPresetSelecting).toBe(false)
            if (outcome === 'resolve') finishPreset('plan')
            else failPreset(new Error('late preset error'))
            expect(await selecting).toBe(false)
            expect(useAppStore.getState().agentPresetSelecting).toBe(false)
            expect(useAppStore.getState().error).toBeUndefined()
            expect(useAppStore.getState().selectedSession?.agentPreset).toBe('default')
          },
        }))),
      {
        name: 'loadAgentPresets ignores stale completion after navigation without clearing new session loading state, and archiveSession resets selector flags',
        run: async () => {
          const s2: RemoteSession = { ...session, sessionId: 's2' }
          useAppStore.setState({ selectedSession: session, sessions: [session, s2] })
          let finishS1!: (value: { presets: Array<{ id: string; isDefault: boolean }> }) => void
          let finishS2!: (value: { presets: Array<{ id: string; isDefault: boolean }> }) => void
          proxy.agentPresetList
            .mockImplementationOnce(() => new Promise(resolve => { finishS1 = resolve }))
            .mockImplementationOnce(() => new Promise(resolve => { finishS2 = resolve }))
          const loadingS1 = useAppStore.getState().loadAgentPresets()
          expect(useAppStore.getState().agentPresetLoading).toBe(true)
          expect(await useAppStore.getState().openSession(s2)).toBe(true)
          expect(useAppStore.getState().agentPresetLoading).toBe(false)
          const loadingS2 = useAppStore.getState().loadAgentPresets()
          expect(useAppStore.getState().agentPresetLoading).toBe(true)
          finishS1({ presets: [{ id: 'stale', isDefault: false }] })
          expect(await loadingS1).toBe(false)
          expect(useAppStore.getState().agentPresetLoading).toBe(true)
          finishS2({ presets: [{ id: 'fresh', isDefault: true }] })
          expect(await loadingS2).toBe(true)
          expect(useAppStore.getState().agentPresetOptions).toEqual([{ id: 'fresh', isDefault: true }])
          expect(useAppStore.getState().agentPresetLoading).toBe(false)

          useAppStore.setState({ permissionSelecting: true, modelSelecting: true, agentPresetSelecting: true, agentPresetLoading: true })
          proxy.workspaceArchiveSession.mockResolvedValueOnce(['s2'])
          expect(await useAppStore.getState().archiveSession('s2')).toBe(true)
          expect(useAppStore.getState()).toMatchObject({
            selectedSession: undefined,
            permissionSelecting: false,
            modelSelecting: false,
            agentPresetSelecting: false,
            agentPresetLoading: false,
          })
        },
      },
    ], prepareScenario1)
  })

  it('cleans up stale QueueDock items after stop without global error banners while preserving real errors and live queued turns', async () => {
    await runScenarios([
      ...(['session/queue-item-not-found', 'queue-item-not-found'] as const).map(code => ({
        name: `post-stop remove hitting ${code} prunes inbox and local row silently`,
        run: async () => {
          const running = { ...session, running: true }
          useAppStore.setState({ selectedSession: running, sessions: [running] })
          proxy.sessionPrompt.mockResolvedValueOnce(undefined)
          proxy.sessionCancel.mockResolvedValueOnce(undefined)
          const rpcId = `stop-remove-${code}`
          expect(await useAppStore.getState().sendMessage('queued after stop', [], rpcId)).toBe('sent')
          const inboxEntry = { id: 'q-stale-1', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'queued after stop' }] }
          useAppStore.getState().handleMuxFrame({
            rpcId: '',
            payload: { type: 'session/projection', sessionId: 's1', key: 'inbox', seq: 1, value: { 'next-turn': [inboxEntry] } },
          } as MuxStreamFrame)
          await useAppStore.getState().stopSession()
          useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 20, { turn: 1, reason: { kind: 'aborted' } })))
          // Stale inbox still carries q-stale-1; user taps remove and Host reports it is already gone.
          proxy.sessionUpdateQueue.mockRejectedValueOnce(Object.assign(new Error('Queue item not found'), { code }))
          expect(await useAppStore.getState().updateQueueItem('q-stale-1', 'remove', rpcId)).toBe(true)
          expect(useAppStore.getState().error).toBeUndefined()
          expect(inboxQueuedItems(useAppStore.getState().selectedSession?.projections?.values?.inbox)).toEqual([])
          expect(inboxQueuedItems(useAppStore.getState().sessions.find(s => s.sessionId === 's1')?.projections?.values?.inbox)).toEqual([])
          const row = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
          expect(row).toMatchObject({ id: `local:${rpcId}`, sendState: 'canceled', queuedAdopted: true })
        },
      })),
      {
        name: 'real updateQueueItem failure still surfaces global error and preserves inbox',
        run: async () => {
          const withQueue: RemoteSession = {
            ...session,
            running: true,
            projections: {
              values: {
                inbox: { 'next-turn': [{ id: 'q-live-1', source: { kind: 'user', rpcId: 'rpc-live' }, content: [{ type: 'text', text: 'keep me' }] }] },
              },
            },
          }
          useAppStore.setState({ selectedSession: withQueue, sessions: [withQueue] })
          proxy.sessionUpdateQueue.mockRejectedValueOnce(Object.assign(new Error('session/writer-held'), { code: 'session/writer-held' }))
          expect(await useAppStore.getState().updateQueueItem('q-live-1', 'remove', 'rpc-live')).toBe(false)
          expect(useAppStore.getState().error).toBeTruthy()
          expect(inboxQueuedItems(useAppStore.getState().selectedSession?.projections?.values?.inbox)).toHaveLength(1)
        },
      },
      {
        name: 'steer hitting queue-item-not-found marks local row unconfirmed (retryable and healable by echo) without global error',
        run: async () => {
          const rpcId = 'steer-not-found-1'
          const running: RemoteSession = {
            ...session,
            running: true,
            projections: {
              values: {
                inbox: { 'next-turn': [{ id: 'q-steer-1', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'steer me' }] }] },
              },
            },
          }
          const preAckLocal: ChatItem = {
            kind: 'message', id: `local:${rpcId}`, sessionId: 's1', role: 'user',
            text: 'steer me', createdAt: 10, requestRpcId: rpcId,
          }
          useAppStore.setState({ selectedSession: running, sessions: [running], messages: { s1: [preAckLocal] } })
          proxy.sessionUpdateQueue.mockRejectedValueOnce(Object.assign(new Error('Queue item not found'), { code: 'session/queue-item-not-found' }))
          expect(await useAppStore.getState().updateQueueItem('q-steer-1', 'steer', rpcId)).toBe(true)
          expect(useAppStore.getState().error).toBeUndefined()
          expect(inboxQueuedItems(useAppStore.getState().selectedSession?.projections?.values?.inbox)).toEqual([])
          expect(useAppStore.getState().messages.s1?.[0]).toMatchObject({
            id: `local:${rpcId}`, sendState: 'unconfirmed', queuedAdopted: true,
          })
          // Unconfirmed row remains retryable...
          proxy.sessionPrompt.mockResolvedValueOnce(undefined)
          expect(await useAppStore.getState().retrySendMessage(`local:${rpcId}`)).toBe(true)
          // ...and is cleanly replaced when a late durable user/message echo arrives.
          const echoed = { id: 'host-steer-echo', source: { kind: 'user', rpcId }, content: [{ type: 'text', text: 'steer me' }] }
          useAppStore.getState().handleMuxFrame(frame(entry('user/message', 30, { turn: 2, message: echoed })))
          const settled = useAppStore.getState().messages.s1?.find(item => item.kind === 'message' && item.requestRpcId === rpcId)
          expect(settled).toMatchObject({ id: 'host-steer-echo', nativeSeq: 30 })
          expect(settled).not.toHaveProperty('sendState')
        },
      },
      {
        name: 'completed turn/end arriving before delayed inbox projection keeps newly ACKed prompt queued',
        run: async () => {
          const running: RemoteSession = {
            ...session,
            running: true,
            projections: { values: { inbox: { 'next-turn': [] } } },
          }
          useAppStore.setState({ selectedSession: running, sessions: [running] })
          proxy.sessionPrompt.mockResolvedValueOnce(undefined)
          const rpcId = 'race-completed-before-inbox'
          expect(await useAppStore.getState().sendMessage('next turn prompt', [], rpcId)).toBe('sent')
          expect(useAppStore.getState().messages.s1?.[0]).toMatchObject({ id: `local:${rpcId}`, sendState: 'queued' })
          useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 22, { turn: 1, reason: { kind: 'completed' } })))
          expect(useAppStore.getState().messages.s1?.[0]).toMatchObject({ id: `local:${rpcId}`, sendState: 'queued' })
        },
      },
      {
        name: 'stopSession turn/end arriving before sessionPrompt ACK settles as unconfirmed instead of sticking queued',
        run: async () => {
          const running: RemoteSession = {
            ...session,
            running: true,
            projections: { values: { inbox: { 'next-turn': [] } } },
          }
          useAppStore.setState({ selectedSession: running, sessions: [running] })
          let ackPrompt!: () => void
          proxy.sessionPrompt.mockImplementationOnce(() => new Promise<void>(resolve => { ackPrompt = resolve }))
          const rpcId = 'race-stop-before-ack'
          const sending = useAppStore.getState().sendMessage('stopped before ack', [], rpcId)
          useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 23, { turn: 1, reason: { kind: 'aborted' } })))
          ackPrompt()
          expect(await sending).toBe('sent')
          expect(useAppStore.getState().busyAction).toBeUndefined()
          expect(useAppStore.getState().messages.s1?.[0]).toMatchObject({ id: `local:${rpcId}`, sendState: 'unconfirmed' })
        },
      },
      {
        name: 'turn/end settles unadopted local queued ghost rows while keeping inbox-backed prompts queued for the next turn',
        run: async () => {
          const running: RemoteSession = {
            ...session,
            running: true,
            projections: {
              values: {
                inbox: {
                  'next-turn': [
                    { id: 'q-kept', source: { kind: 'user', rpcId: 'rpc-kept' }, content: [{ type: 'text', text: 'valid next turn' }] },
                  ],
                },
              },
            },
          }
          const orphanLocal: ChatItem = {
            kind: 'message', id: 'local:rpc-orphan', sessionId: 's1', role: 'user',
            text: 'unadopted ghost', createdAt: 10, requestRpcId: 'rpc-orphan', sendState: 'queued',
          }
          const keptLocal: ChatItem = {
            kind: 'message', id: 'local:rpc-kept', sessionId: 's1', role: 'user',
            text: 'valid next turn', createdAt: 11, requestRpcId: 'rpc-kept', sendState: 'queued', queuedAdopted: true,
          }
          useAppStore.setState({ selectedSession: running, sessions: [running], messages: { s1: [orphanLocal, keptLocal] } })
          useAppStore.getState().handleMuxFrame(frame(entry('turn/end', 25, { turn: 1, reason: { kind: 'aborted' } })))
          const messages = useAppStore.getState().messages.s1 ?? []
          expect(messages.find(item => item.id === 'local:rpc-orphan')).toMatchObject({ sendState: 'unconfirmed' })
          expect(messages.find(item => item.id === 'local:rpc-kept')).toMatchObject({ sendState: 'queued', queuedAdopted: true })
        },
      },
    ], prepareScenario1)
  })

  it('preserves chronological position of failed/unconfirmed/canceled local rows across Harness and ACP history merges', async () => {
    await runScenarios([
      {
        name: 'Harness mergeHistoryAndLive and prependHistory keep early terminal local rows in place while keeping in-flight rows at the tail',
        run: () => {
          const history = foldHistory([
            { event: { type: 'user/message', seq: 1, time: 1000, data: { turn: 1, message: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } } } },
            { event: { type: 'assistant/message', seq: 2, time: 1100, data: { turn: 1, message: { id: 'a1', content: [{ type: 'text', text: 'reply 1' }] } } } },
            { event: { type: 'user/message', seq: 3, time: 2000, data: { turn: 2, message: { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } } } },
            { event: { type: 'assistant/message', seq: 4, time: 2100, data: { turn: 2, message: { id: 'a2', content: [{ type: 'text', text: 'reply 2' }] } } } },
            { event: { type: 'user/message', seq: 5, time: 3000, data: { turn: 3, message: { id: 'u3', source: { kind: 'user' }, content: [{ type: 'text', text: 'third' }] } } } },
          ], 's1')
          const failedA: ChatItem = {
            kind: 'message', id: 'local:fail-1', sessionId: 's1', role: 'user',
            text: 'failed mid', createdAt: 1500, requestRpcId: 'fail-1', sendState: 'failed',
          }
          const failedTie: ChatItem = {
            kind: 'message', id: 'local:fail-2', sessionId: 's1', role: 'user',
            text: 'failed tie', createdAt: 1500, requestRpcId: 'fail-2', sendState: 'unconfirmed',
          }
          const canceledLater: ChatItem = {
            kind: 'message', id: 'local:cancel-1', sessionId: 's1', role: 'user',
            text: 'canceled mid', createdAt: 2500, requestRpcId: 'cancel-1', sendState: 'canceled',
          }
          const inFlight: ChatItem = {
            kind: 'message', id: 'local:sending-1', sessionId: 's1', role: 'user',
            text: 'still sending', createdAt: 1200, requestRpcId: 'sending-1',
          }
          const merged = mergeHistoryAndLive(history, [failedA, failedTie, canceledLater, inFlight])
          expect(merged.map(item => item.id)).toEqual([
            'u1', 'a1', 'local:fail-1', 'local:fail-2', 'u2', 'a2', 'local:cancel-1', 'u3', 'local:sending-1',
          ])
          // Pagination prepend keeps the failed row between older and newer pages.
          const tailOnly = mergeHistoryAndLive(history.slice(2), [failedA])
          expect(tailOnly.map(item => item.id)).toEqual(['local:fail-1', 'u2', 'a2', 'u3'])
          expect(prependHistory(history.slice(0, 2), tailOnly).map(item => item.id)).toEqual([
            'u1', 'a1', 'local:fail-1', 'u2', 'a2', 'u3',
          ])
        },
      },
      {
        name: 'ACP mergeAcpHistoryAndLive keeps early failed local rows in place with or without boundary overlap and ignores untimestamped history',
        run: () => {
          const msg = (id: string, role: 'user' | 'assistant', text: string, nativeTime?: number, nativeSeq?: number): ChatItem => ({
            kind: 'message', id, sessionId: 'pi:s1', role, text,
            createdAt: nativeTime ?? 999_999,
            ...(nativeTime === undefined ? {} : { nativeTime }),
            ...(nativeSeq === undefined ? {} : { nativeSeq, nativeOrderSeq: nativeSeq }),
          })
          const failed: ChatItem = {
            kind: 'message', id: 'local:acp-fail', sessionId: 'pi:s1', role: 'user',
            text: 'failed prompt', createdAt: 1500, requestRpcId: 'acp-fail', sendState: 'failed',
          }
          const history = [msg('u1', 'user', 'one', 1000, 0), msg('a1', 'assistant', 'r1', 1100, 1), msg('u2', 'user', 'two', 2000, 2), msg('a2', 'assistant', 'r2', 2100, 3)]
          expect(mergeAcpHistoryAndLive(history, [failed]).map(item => item.id)).toEqual([
            'u1', 'a1', 'local:acp-fail', 'u2', 'a2',
          ])
          // With boundary overlap plus a failed row earlier in live: overlap still collapses and failed stays at 1500.
          const tool: ChatItem = { kind: 'tool', id: 'call-1', sessionId: 'pi:s1', toolName: 'bash', state: 'running', createdAt: 2000, nativeTime: 2000, nativeSeq: 2, nativeOrderSeq: 2 }
          const liveTool: ChatItem = { ...tool, id: 'cursor-tool:acp-live:1:call-1', state: 'finished', nativeSeq: undefined, nativeOrderSeq: undefined }
          expect(mergeAcpHistoryAndLive([msg('u1', 'user', 'one', 1000, 0), tool], [failed, liveTool]).map(item => item.id)).toEqual([
            'u1', 'local:acp-fail', 'cursor-tool:acp-live:1:call-1',
          ])
          // Untimestamped history (nativeSeq present, nativeTime absent) must not push failed rows to index 0.
          const untimestamped = [msg('u1', 'user', 'one', undefined, 0), msg('a1', 'assistant', 'r1', undefined, 1)]
          expect(mergeAcpHistoryAndLive(untimestamped, [failed]).map(item => item.id)).toEqual([
            'u1', 'a1', 'local:acp-fail',
          ])
        },
      },
      {
        name: 'Harness openSession after reconnect settles an early orphaned local row and places it chronologically on first open',
        run: async () => {
          const device = { deviceId: 'host' } as never
          useAppStore.setState({ config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          expect(await useAppStore.getState().connectDevice(device)).toBe(true)
          const historyEvents: HistoryEntry[] = [
            { event: { type: 'user/message', seq: 1, time: 1000, data: { turn: 1, message: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'first' }] } } } },
            { event: { type: 'assistant/message', seq: 2, time: 1100, data: { turn: 1, message: { id: 'a1', content: [{ type: 'text', text: 'reply 1' }] } } } },
            { event: { type: 'user/message', seq: 3, time: 2000, data: { turn: 2, message: { id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: 'second' }] } } } },
            { event: { type: 'assistant/message', seq: 4, time: 2100, data: { turn: 2, message: { id: 'a2', content: [{ type: 'text', text: 'reply 2' }] } } } },
          ]
          const idleWithInbox: RemoteSession = {
            ...session,
            running: false,
            projections: { values: { permissions: { currentValue: 'default' }, inbox: { 'next-turn': [] } } },
          }
          const orphanedLocal: ChatItem = {
            kind: 'message', id: 'local:orphan-early', sessionId: 's1', role: 'user',
            text: 'orphaned mid', createdAt: 1500, requestRpcId: 'orphan-early', sendState: 'queued',
          }
          useAppStore.setState({
            selectedSession: idleWithInbox,
            sessions: [idleWithInbox],
            messages: { s1: [...foldHistory(historyEvents.slice(0, 2), 's1', true), orphanedLocal] },
          })
          proxy.sessionHistory.mockResolvedValueOnce(page(historyEvents, 4))
          expect(await useAppStore.getState().openSession(idleWithInbox)).toBe(true)
          const restored = useAppStore.getState().messages.s1 ?? []
          expect(restored.map(item => item.id)).toEqual(['u1', 'a1', 'local:orphan-early', 'u2', 'a2'])
          expect(restored.find(item => item.id === 'local:orphan-early')).toMatchObject({ sendState: 'canceled' })
        },
      },
    ], prepareScenario1)
  })
})

describe('Issue #468 remaining fixes (image loader, cursor blank session, ACP reconnect running, setOffline cleanup, opencode catalog)', () => {
  it('loads ACP image attachments by Host capability and allows claude/hermes workspace image preview while blocking codex', async () => {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    const expectedUri = `data:image/png;base64,${pngBase64}`
    const statFile = vi.fn(async () => ({ absolutePath: '/work/chart.png', version: 'v1', bytes: 68 }))
    const readBytes = vi.fn(async () => ({ absolutePath: '/work/chart.png', version: 'v1', offset: 0, eof: true, bytes: 68, data: pngBase64 }))
    transport.requireSessionTools.mockReturnValue({ statFile, readBytes })
    transport.hasAntigravity.mockReturnValue(true)
    transport.hasHermes.mockReturnValue(true)
    transport.hasClaude.mockReturnValue(true)
    acp.transferCall.mockResolvedValue({
      events: [{
        event: {
          type: 'user/message',
          seq: 0,
          time: 100,
          data: {
            id: 'u1',
            source: { kind: 'user' },
            content: [{
              type: 'image',
              attachment: { attachmentId: 'agy-image:1', mediaType: 'image/png', bytes: 68, width: 1, height: 1 },
              mediaType: 'image/png',
              data: pngBase64,
            }],
          },
        },
      }],
    })

    const agySession: RemoteSession = { sessionId: 'antigravity:s1', nativeId: 's1', backend: 'antigravity', updatedAt: 1, running: false, blank: false }
    useAppStore.setState({ selectedSession: agySession, sessions: [agySession] })
    const agyLoader = sessionChatImageLoader(agySession)
    await expect(agyLoader({ attachmentId: 'agy-image:1', mediaType: 'image/png', bytes: 68, width: 1, height: 1 }, new AbortController().signal))
      .resolves.toBe(expectedUri)

    transport.hasAntigravity.mockReturnValue(false)
    await expect(agyLoader({ attachmentId: 'agy-image:1', mediaType: 'image/png' }, new AbortController().signal))
      .rejects.toThrow('Image attachment unavailable')

    // Concurrent multi-image load in one session deduplicates dsh/sessionHistory to a single RPC
    // and survives individual image AbortSignal cancellation.
    transport.hasHermes.mockReturnValue(true)
    acp.transferCall.mockClear()
    acp.transferCall.mockResolvedValue({
      events: [{
        event: {
          type: 'user/message',
          seq: 0,
          time: 100,
          data: {
            id: 'u-multi',
            source: { kind: 'user' },
            content: [
              { type: 'image', attachment: { attachmentId: 'agy-image:m1', mediaType: 'image/png', bytes: 68, width: 1, height: 1 }, mediaType: 'image/png', data: pngBase64 },
              { type: 'image', attachment: { attachmentId: 'agy-image:m2', mediaType: 'image/png', bytes: 68, width: 1, height: 1 }, mediaType: 'image/png', data: pngBase64 },
            ],
          },
        },
      }],
    })
    const hermesMulti: RemoteSession = { sessionId: 'hermes:multi', nativeId: 'multi', backend: 'hermes', updatedAt: 1, running: false, blank: false }
    useAppStore.setState({ selectedSession: hermesMulti, sessions: [hermesMulti] })
    const multiLoader = sessionChatImageLoader(hermesMulti)
    const c1 = new AbortController()
    const c2 = new AbortController()
    const p1 = multiLoader({ attachmentId: 'agy-image:m1', mediaType: 'image/png', bytes: 68, width: 1, height: 1 }, c1.signal)
    const p2 = multiLoader({ attachmentId: 'agy-image:m2', mediaType: 'image/png', bytes: 68, width: 1, height: 1 }, c2.signal)
    c1.abort()
    await expect(p1).rejects.toThrow()
    await expect(p2).resolves.toBe(expectedUri)
    expect(acp.transferCall).toHaveBeenCalledTimes(1)

    for (const backend of ['claude', 'hermes'] as const) {
      const acpSession: RemoteSession = { sessionId: `${backend}:s1`, nativeId: 's1', backend, updatedAt: 1, running: false, blank: false }
      useAppStore.setState({ selectedSession: acpSession, sessions: [acpSession] })
      const loader = sessionChatImageLoader(acpSession)
      await expect(loader({ uri: '/work/chart.png' }, new AbortController().signal)).resolves.toBe(expectedUri)
    }

    const codexSession: RemoteSession = { sessionId: 'codex:t1', nativeId: 't1', backend: 'codex', updatedAt: 1, running: false, blank: false }
    useAppStore.setState({ selectedSession: codexSession, sessions: [codexSession] })
    await expect(sessionChatImageLoader(codexSession)({ uri: '/work/chart.png' }, new AbortController().signal))
      .rejects.toThrow('Image preview unavailable')
  })

  it('creates new Cursor sessions with blank: true and no hardcoded title', async () => {
    transport.hasCursor.mockReturnValue(true)
    acp.createSession.mockResolvedValue({ sessionId: 'cur-new-1' })
    const workspace = { workspaceId: 'cursor:cwd:%2Fwork', backend: 'cursor' as const, path: '/work', title: 'work', sessionIds: [], createdAt: '', updatedAt: '' }
    useAppStore.setState({ workspaces: [workspace], sessions: [] })
    expect(await useAppStore.getState().createSession(workspace.workspaceId, 'cursor')).toBe(true)
    const created = useAppStore.getState().sessions.find(s => s.sessionId === 'cursor:cur-new-1')
    expect(created).toMatchObject({ blank: true })
    expect(created?.title).toBeUndefined()

    const helperResult = await createCursorWorkspaceSession(acp as never, '/work')
    expect(helperResult.session.blank).toBe(true)
    expect(helperResult.session.title).toBeUndefined()
  })

  it('restores ACP running: true on reconnect when live frames are active, and closes Codex/Cursor streams in setOffline', async () => {
    const agy: RemoteSession = { sessionId: 'antigravity:live-1', nativeId: 'live-1', backend: 'antigravity', updatedAt: 1, running: false, blank: false }
    useAppStore.setState({ selectedSession: agy, sessions: [agy], messages: {} })

    let receive!: (frame: unknown) => void
    const streamClose = vi.fn(async () => undefined)
    acp.openStream.mockImplementationOnce(async (_sid: string, onFrame: (f: unknown) => void) => {
      receive = onFrame
      return { streamId: 's-live', close: streamClose }
    })
    let finishHistory!: (v: unknown) => void
    acp.transferCall.mockReturnValueOnce(new Promise(resolve => { finishHistory = resolve }))

    const opening = useAppStore.getState().openSession(agy)
    await vi.waitFor(() => expect(acp.openStream).toHaveBeenCalled())
    receive({ streamId: 's-live', frame: { method: 'session/update', params: { sessionId: 'live-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'still streaming' } } } } })
    expect(useAppStore.getState().selectedSession?.running).toBe(true)

    finishHistory({ events: [] })
    expect(await opening).toBe(true)
    expect(useAppStore.getState().selectedSession?.running).toBe(true)
    expect(useAppStore.getState().sessions.find(s => s.sessionId === agy.sessionId)?.running).toBe(true)

    // setOffline must clear active Cursor & Codex stream handles so no remote close or ghost frames fire.
    useAppStore.setState({ codexReadySessionId: 'codex:c1' })
    useAppStore.getState().setOffline()
    expect(useAppStore.getState().connection.phase).toBe('offline')
    expect(useAppStore.getState().codexReadySessionId).toBeUndefined()
    expect(streamClose).not.toHaveBeenCalled()
    // Re-opening after setOffline should not observe stale stream state.
    receive({ streamId: 's-live', frame: { method: 'session/update', params: { sessionId: 'live-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ghost' } } } } })
    expect(useAppStore.getState().messages[agy.sessionId]?.some(m => m.kind === 'message' && m.text.includes('ghost'))).toBe(false)

    // setOffline resets ACP running=false; if the turn finished while offline (history settled, no live frames), reconnect stays running=false.
    expect(useAppStore.getState().selectedSession?.running).toBe(false)
    expect(useAppStore.getState().sessions.find(s => s.sessionId === agy.sessionId)?.running).toBe(false)
    useAppStore.setState({ connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } } })
    acp.openStream.mockResolvedValueOnce({ streamId: 's-reconnected', close: async () => undefined })
    acp.transferCall.mockResolvedValueOnce({
      events: [
        entry('user/message', 0, { id: 'u-done', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }),
        entry('assistant/message', 1, { turn: 1, message: { id: 'a-done', content: [{ type: 'text', text: 'done offline' }] } }),
        entry('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
      ],
    })
    expect(await useAppStore.getState().openSession(useAppStore.getState().selectedSession!)).toBe(true)
    expect(useAppStore.getState().selectedSession?.running).toBe(false)
    expect(useAppStore.getState().sessions.find(s => s.sessionId === agy.sessionId)?.running).toBe(false)
  })

  it('preserves a newly completed OpenCode session across immediate refreshOpencodeCatalog when Host has not flushed yet', async () => {
    transport.hasOpencode.mockReturnValue(true)
    const opc: RemoteSession = { sessionId: 'opencode:fresh-turn', nativeId: 'fresh-turn', backend: 'opencode', updatedAt: 1, running: true, blank: false, title: 'My question' }
    const ws = { workspaceId: 'opencode:cwd:%2Fproj', backend: 'opencode' as const, path: '/proj', title: 'proj', sessionIds: [opc.sessionId], createdAt: '', updatedAt: '' }
    useAppStore.setState({ selectedSession: opc, sessions: [opc], workspaces: [ws], messages: { [opc.sessionId]: [] } })

    acp.call.mockImplementation(async (method: string) => {
      if (method === 'dsh/workspaceList') return [{ path: '/proj', title: 'proj' }]
      if (method === 'dsh/sessionList') return { items: [] }
      return []
    })

    useAppStore.getState().handleCursorFrame({
      streamId: 's-opc',
      frame: { method: 'session/update', params: { sessionId: 'fresh-turn', update: { sessionUpdate: 'prompt_completed', stopReason: 'end_turn' } } },
    })

    await vi.waitFor(() => expect(acp.call).toHaveBeenCalledWith('dsh/sessionList', expect.objectContaining({ backend: 'opencode' })))
    expect(useAppStore.getState().sessions.some(s => s.sessionId === opc.sessionId)).toBe(true)
    expect(useAppStore.getState().sessions.find(s => s.sessionId === opc.sessionId)?.running).toBe(false)
    expect(useAppStore.getState().workspaces[0]?.sessionIds).toContain(opc.sessionId)
  })

  it('keeps the active ACP stream and live text during healthy resume', async () => {
    await prepareScenario1()
    transport.hasAntigravity.mockReturnValue(true)
    const selected: RemoteSession = { sessionId: 'antigravity:live', nativeId: 'live', backend: 'antigravity', updatedAt: 1, running: true, blank: false }
    useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, selectedSession: selected, sessions: [selected], messages: {}, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
    const loadSessionDetails = vi.fn(async () => ({ events: [] as HistoryEntry[], running: true }))
    Object.assign(acp, { loadSessionDetails })
    const close = vi.fn(async () => undefined)
    acp.openStream.mockResolvedValueOnce({ streamId: 'live-stream', close })
    try {
      await useAppStore.getState().openSession(selected)
      const receive = acp.openStream.mock.calls[0]![1]
      receive({ streamId: 'live-stream', frame: { method: 'session/update', params: { sessionId: 'live', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } } } } })
      receive({ streamId: 'live-stream', frame: { method: 'session/update', params: { sessionId: 'live', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first half' } } } } })
      await useAppStore.getState().resumeConnection()
      await vi.waitFor(() => expect(loadSessionDetails).toHaveBeenCalledTimes(2))
      expect(close).not.toHaveBeenCalled()
      expect(acp.openStream).toHaveBeenCalledTimes(1)
      expect(useAppStore.getState().messages[selected.sessionId]?.some(item => item.kind === 'message' && item.text.includes('first half'))).toBe(true)
      // A frame that arrives while the read is in flight retires the read: running stays true.
      let finish!: (value: { events: HistoryEntry[], running: boolean }) => void
      loadSessionDetails.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      await useAppStore.getState().resumeConnection()
      await vi.waitFor(() => expect(loadSessionDetails).toHaveBeenCalledTimes(3))
      receive({ streamId: 'live-stream', frame: { method: 'session/update', params: { sessionId: 'live', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' second half' } } } } })
      finish({ events: [], running: false })
      await vi.waitFor(() => expect(useAppStore.getState().messages[selected.sessionId]?.some(item => item.kind === 'message' && item.text.includes('second half'))).toBe(true))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(useAppStore.getState().selectedSession?.running).toBe(true)
      expect(close).not.toHaveBeenCalled()
      expect(acp.openStream).toHaveBeenCalledTimes(1)
      // Host authority settles the stale running state without closing the stream or
      // dropping the streamed reply, and the transcript merge does not duplicate it.
      let settle!: (value: { events: HistoryEntry[], running: boolean }) => void
      loadSessionDetails.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
      await useAppStore.getState().resumeConnection()
      await vi.waitFor(() => expect(loadSessionDetails).toHaveBeenCalledTimes(4))
      settle({
        events: [
          entry('user/message', 0, { id: 'u-live', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }),
          entry('assistant/message', 1, { turn: 1, message: { id: 'a-live', content: [{ type: 'text', text: 'first half second half' }] } }),
          entry('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
        ],
        running: false,
      })
      await vi.waitFor(() => expect(useAppStore.getState().selectedSession?.running).toBe(false))
      expect(close).not.toHaveBeenCalled()
      expect(acp.openStream).toHaveBeenCalledTimes(1)
      const settled = useAppStore.getState().messages[selected.sessionId] ?? []
      expect(settled.flatMap(item => item.kind === 'message' && item.role === 'assistant' ? [item.text] : []))
        .toEqual(['first half second half'])
      expect(settled.flatMap(item => item.kind === 'message' && item.role === 'user' ? [item.text] : []))
        .toEqual(['hi'])
    } finally {
      await useAppStore.getState().setOffline()
      delete (acp as Record<string, unknown>).loadSessionDetails
    }
  })

  it('reconciles missed background output on active ACP stream without duplicating partial live rows or wiping replay-less history', async () => {
    await runScenarios([
      {
        name: 'replaces truncated pre-background live reply and optimistic local prompt with Host history while preserving terminal local errors',
        run: async () => {
          transport.hasAntigravity.mockReturnValue(true)
          const selected: RemoteSession = { sessionId: 'antigravity:partial-1', nativeId: 'partial-1', backend: 'antigravity', updatedAt: 1, running: true, blank: false }
          const failedLocal: ChatItem = { kind: 'message', id: 'local:failed-0', sessionId: selected.sessionId, role: 'user', text: 'earlier failed', createdAt: 1, sendState: 'failed' }
          const optimistic: ChatItem = { kind: 'message', id: 'local:req-1', sessionId: selected.sessionId, role: 'user', text: 'hi', createdAt: 2 }
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, selectedSession: selected, sessions: [selected], messages: {}, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          const loadSessionDetails = vi.fn(async () => ({ events: [] as HistoryEntry[], running: true }))
          Object.assign(acp, { loadSessionDetails })
          const close = vi.fn(async () => undefined)
          acp.openStream.mockResolvedValueOnce({ streamId: 'live-partial', close })
          try {
            await useAppStore.getState().openSession(selected)
            const receive = acp.openStream.mock.calls[0]![1]
            useAppStore.setState(state => ({
              messages: { ...state.messages, [selected.sessionId]: [failedLocal, optimistic] },
            }))
            receive({ streamId: 'live-partial', frame: { method: 'session/update', params: { sessionId: 'partial-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first half' } } } } })
            loadSessionDetails.mockResolvedValueOnce({
              events: [
                entry('user/message', 0, { id: 'u-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }),
                entry('assistant/message', 1, { turn: 1, message: { id: 'a-1', content: [{ type: 'text', text: 'first half + completed in background' }] } }),
                entry('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
              ],
              running: false,
            })
            await useAppStore.getState().resumeConnection()
            await vi.waitFor(() => expect(useAppStore.getState().selectedSession?.running).toBe(false))
            expect(close).not.toHaveBeenCalled()
            expect(acp.openStream).toHaveBeenCalledTimes(1)
            const items = useAppStore.getState().messages[selected.sessionId] ?? []
            expect(items.flatMap(item => item.kind === 'message' && item.role === 'user' ? [item.text] : []))
              .toEqual(['earlier failed', 'hi'])
            expect(items.flatMap(item => item.kind === 'message' && item.role === 'assistant' ? [item.text] : []))
              .toEqual(['first half + completed in background'])
          } finally {
            await useAppStore.getState().setOffline()
            delete (acp as Record<string, unknown>).loadSessionDetails
          }
        },
      },
      {
        name: 'settles active live items in place without wiping earlier messages when backend returns empty history events',
        run: async () => {
          transport.hasCursor.mockReturnValue(true)
          const selected: RemoteSession = { sessionId: 'cursor:no-replay', nativeId: 'no-replay', backend: 'cursor', updatedAt: 1, running: true, blank: false }
          const earlier: ChatItem = { kind: 'message', id: 'history-u0', sessionId: selected.sessionId, role: 'user', text: 'earlier turn', createdAt: 1 }
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, selectedSession: selected, sessions: [selected], messages: { [selected.sessionId]: [earlier] }, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          const loadSessionDetails = vi.fn(async () => ({ events: [] as HistoryEntry[], running: true }))
          Object.assign(acp, { loadSessionDetails })
          const close = vi.fn(async () => undefined)
          acp.openStream.mockResolvedValueOnce({ streamId: 'live-cursor', close })
          try {
            await useAppStore.getState().openSession(selected)
            const receive = acp.openStream.mock.calls[0]![1]
            useAppStore.setState(state => ({
              messages: { ...state.messages, [selected.sessionId]: [earlier] },
            }))
            receive({ streamId: 'live-cursor', frame: { method: 'session/update', params: { sessionId: 'no-replay', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'streamed reply' } } } } })
            loadSessionDetails.mockResolvedValueOnce({ events: [] as HistoryEntry[], running: false })
            await useAppStore.getState().resumeConnection()
            await vi.waitFor(() => expect(useAppStore.getState().selectedSession?.running).toBe(false))
            expect(close).not.toHaveBeenCalled()
            const items = useAppStore.getState().messages[selected.sessionId] ?? []
            expect(items.some(item => item.id === 'history-u0')).toBe(true)
            expect(items.some(item => item.kind === 'message' && item.role === 'assistant' && item.text === 'streamed reply' && item.streaming !== true)).toBe(true)
          } finally {
            await useAppStore.getState().setOffline()
            delete (acp as Record<string, unknown>).loadSessionDetails
          }
        },
      },
      {
        name: 'skips active-stream reconcile while sendMessage is in flight',
        run: async () => {
          transport.hasAntigravity.mockReturnValue(true)
          const selected: RemoteSession = { sessionId: 'antigravity:sending', nativeId: 'sending', backend: 'antigravity', updatedAt: 1, running: true, blank: false }
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, selectedSession: selected, sessions: [selected], messages: {}, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          const loadSessionDetails = vi.fn(async () => ({ events: [] as HistoryEntry[], running: true }))
          Object.assign(acp, { loadSessionDetails })
          acp.openStream.mockResolvedValueOnce({ streamId: 'live-sending', close: async () => undefined })
          try {
            await useAppStore.getState().openSession(selected)
            useAppStore.setState({ busyAction: 'send-message' })
            loadSessionDetails.mockResolvedValueOnce({ events: [] as HistoryEntry[], running: false })
            await useAppStore.getState().resumeConnection()
            await new Promise(resolve => setTimeout(resolve, 0))
            expect(loadSessionDetails).toHaveBeenCalledTimes(1)
            expect(useAppStore.getState().selectedSession?.running).toBe(true)
          } finally {
            useAppStore.setState({ busyAction: undefined })
            await useAppStore.getState().setOffline()
            delete (acp as Record<string, unknown>).loadSessionDetails
          }
        },
      },
      {
        name: 'aborts stale active-stream settle when a new local prompt is appended during the read',
        run: async () => {
          transport.hasAntigravity.mockReturnValue(true)
          const selected: RemoteSession = { sessionId: 'antigravity:send-race', nativeId: 'send-race', backend: 'antigravity', updatedAt: 1, running: true, blank: false }
          useAppStore.setState({ selectedDevice: { deviceId: 'host' } as never, selectedSession: selected, sessions: [selected], messages: {}, config: { baseUrl: 'https://example.invalid' } as never, identity: {} as never })
          const loadSessionDetails = vi.fn(async () => ({ events: [] as HistoryEntry[], running: true }))
          Object.assign(acp, { loadSessionDetails })
          acp.openStream.mockResolvedValueOnce({ streamId: 'live-race', close: async () => undefined })
          try {
            await useAppStore.getState().openSession(selected)
            let resolveStale!: (value: { events: HistoryEntry[]; running: boolean }) => void
            loadSessionDetails.mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve }))
            await useAppStore.getState().resumeConnection()
            await vi.waitFor(() => expect(loadSessionDetails).toHaveBeenCalledTimes(2))
            const nextPrompt: ChatItem = { kind: 'message', id: 'local:req-2', sessionId: selected.sessionId, role: 'user', text: 'follow-up', createdAt: 3 }
            useAppStore.setState(state => ({
              busyAction: 'send-message',
              messages: { ...state.messages, [selected.sessionId]: [...(state.messages[selected.sessionId] ?? []), nextPrompt] },
            }))
            useAppStore.setState({ busyAction: undefined })
            resolveStale({
              events: [
                entry('user/message', 0, { id: 'u-old', source: { kind: 'user' }, content: [{ type: 'text', text: 'older' }] }),
                entry('assistant/message', 1, { turn: 1, message: { id: 'a-old', content: [{ type: 'text', text: 'older reply' }] } }),
                entry('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
              ],
              running: false,
            })
            await new Promise(resolve => setTimeout(resolve, 0))
            expect(useAppStore.getState().selectedSession?.running).toBe(true)
            expect(useAppStore.getState().messages[selected.sessionId]?.some(item => item.id === 'local:req-2')).toBe(true)
          } finally {
            useAppStore.setState({ busyAction: undefined })
            await useAppStore.getState().setOffline()
            delete (acp as Record<string, unknown>).loadSessionDetails
          }
        },
      },
    ], async () => {
      await prepareScenario1()
      await useAppStore.getState().setOffline()
      useAppStore.setState({ connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } } })
    })
  })

  it('recovers Antigravity sessions on healthy resumeConnection and clears stale running via Host authority', async () => {
    await runScenarios([
      { name: 'reopens running AGY session on resumeConnection and clears stale running when Host reports running: false', hostRunning: false, expectedRunning: false },
      { name: 'keeps running: true when Host reports running: true on resumeConnection', hostRunning: true, expectedRunning: true },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => {
        // Drop the live stream left by the previous scenario while staying on the healthy carrier.
        useAppStore.getState().setOffline()
        useAppStore.setState({ connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } } })
        transport.hasAntigravity.mockReturnValue(true)
        const agy: RemoteSession = {
          sessionId: 'antigravity:resume-1',
          nativeId: 'resume-1',
          backend: 'antigravity',
          updatedAt: 1,
          running: true,
          blank: false,
        }
        useAppStore.setState({
          selectedDevice: { deviceId: 'host' } as never,
          selectedSession: agy,
          sessions: [agy],
          messages: {},
          config: { baseUrl: 'https://example.invalid' } as never,
          identity: {} as never,
        })
        const loadSessionDetails = vi.fn(async () => ({
          events: [
            entry('user/message', 0, { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
            entry('assistant/message', 1, { turn: 1, message: { id: 'a1', content: [{ type: 'text', text: 'done' }] } }),
            entry('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
          ],
          running: scenario.hostRunning,
        }))
        Object.assign(acp, { loadSessionDetails })
        acp.openStream.mockResolvedValueOnce({ streamId: 's-resume', close: async () => undefined })
        try {
          await useAppStore.getState().resumeConnection()
          await vi.waitFor(() => expect(loadSessionDetails).toHaveBeenCalledWith('resume-1', 'antigravity', expect.any(AbortSignal)))
          await vi.waitFor(() => expect(useAppStore.getState().busyAction).toBeUndefined())
          expect(acp.openStream).toHaveBeenCalledTimes(1)
          expect(useAppStore.getState().selectedSession?.running).toBe(scenario.expectedRunning)
          expect(useAppStore.getState().sessions.find(s => s.sessionId === agy.sessionId)?.running).toBe(scenario.expectedRunning)
        } finally {
          delete (acp as Record<string, unknown>).loadSessionDetails
        }
      },
    })), prepareScenario1)
  })
})
