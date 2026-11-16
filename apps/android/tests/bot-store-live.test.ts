import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo', () => ({ requireOptionalNativeModule: () => undefined }))
vi.mock('expo-haptics', () => ({ impactAsync: async () => undefined, ImpactFeedbackStyle: { Light: 'light' } }))
vi.mock('../src/services/network-route', () => ({ resolveAutomaticPreferredTransports: async () => ['relay'] }))
vi.mock('../src/services/storage', () => ({
  saveRecentWorkspaces: vi.fn(),
  saveLastConnectedDeviceId: vi.fn(),
  loadCodexPermissionPresets: vi.fn(),
  saveCodexPermissionPreset: vi.fn(),
}))
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate: vi.fn() } }))

import { BotRemoteClient, type BotObject, type BotOperation } from '../src/services/bot-catalog'
import { useBotTeamStore } from '../src/state/bot-store'
import * as storeMod from '../src/state/store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeClient(dispatch: (body: { endpoint: BotOperation; payload: BotObject | null }, signal?: AbortSignal) => Promise<unknown>) {
  return new BotRemoteClient(
    dispatch,
    async () => [{ sessionId: 'part-1', backend: 'harness', updatedAt: 1, running: false, blank: false }],
    () => {},
  )
}

describe('useBotTeamStore live sync and offline isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    storeMod.useAppStore.setState({
      config: undefined,
      selectedDevice: undefined,
      selectedSession: undefined,
      connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } },
    })
    useBotTeamStore.getState().ensureScope('')
  })

  it('coalesces concurrent live refreshes and blocks stale writes after reconnect', async () => {
    let currentEpochGen = 1
    vi.spyOn(storeMod, 'getConnectionGeneration').mockImplementation(() => currentEpochGen)

    const initialPayload = {
      revision: 1,
      liveKey: 'k1',
      bots: [{ id: 'bot-a', sessionId: 'part-1', name: 'Bot A', main: true }],
      rooms: [],
      mainBotId: 'bot-a',
      questions: {},
      btwCards: {},
    }
    const questionPayload = {
      ...initialPayload,
      revision: 2,
      liveKey: 'k2',
      questions: { 'part-1': { id: 'q-live', question: 'Choose?', options: [{ label: 'A' }] } },
    }

    let pendingGate: ReturnType<typeof deferred<unknown>> | undefined
    let mode: 'initial' | 'gated' | 'stale-gen' = 'initial'
    const dispatch = vi.fn(async () => {
      if (mode === 'initial') return { status: 200, json: { ok: true, value: initialPayload } }
      if (mode === 'gated' || mode === 'stale-gen') {
        return pendingGate!.promise
      }
      return { status: 200, json: { ok: true, value: questionPayload } }
    })

    const client = makeClient(dispatch)
    vi.spyOn(storeMod, 'requireBotClient').mockReturnValue(client)

    storeMod.useAppStore.setState({
      config: { baseUrl: 'https://example.test', account: 'u1', deviceId: 'c1', token: 't1', refreshToken: 'r1' } as never,
      selectedDevice: { deviceId: 'host-1', name: 'Host 1', identityKey: 'id-1', online: true } as never,
      connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
    })

    await useBotTeamStore.getState().refresh(true)
    expect(useBotTeamStore.getState().state?.revision).toBe(1)

    // Concurrent incremental live refreshes share one in-flight RPC.
    mode = 'gated'
    pendingGate = deferred()
    dispatch.mockClear()
    const p1 = useBotTeamStore.getState().refreshLive()
    const p2 = useBotTeamStore.getState().refreshLive()
    expect(dispatch).toHaveBeenCalledTimes(1)
    pendingGate.resolve({ status: 200, json: { ok: true, value: questionPayload } })
    await Promise.all([p1, p2])
    expect(useBotTeamStore.getState().state?.questions['part-1']).toMatchObject({ id: 'q-live' })

    // Concurrent refresh() supersedes older in-flight refreshLive() so stale unchanged cannot roll back.
    mode = 'gated'
    pendingGate = deferred()
    const racingLive = useBotTeamStore.getState().refreshLive()
    mode = 'initial'
    const freshDispatch = vi.fn(async () => ({
      status: 200,
      json: {
        ok: true,
        value: {
          ...questionPayload,
          revision: 5,
          liveKey: 'k5',
          questions: { 'part-1': { id: 'q-newer', question: 'Newer?', options: [{ label: 'B' }] } },
        },
      },
    }))
    vi.spyOn(storeMod, 'requireBotClient').mockReturnValue(makeClient(freshDispatch))
    await useBotTeamStore.getState().refresh(true)
    expect(useBotTeamStore.getState().state?.revision).toBe(5)
    pendingGate.resolve({ status: 200, json: { ok: true, value: { revision: 2, unchanged: true, liveKey: 'k2' } } })
    await racingLive
    expect(useBotTeamStore.getState().state?.revision).toBe(5)
    expect(useBotTeamStore.getState().state?.questions['part-1']).toMatchObject({ id: 'q-newer' })

    // Connection generation replacement drops stale in-flight live refresh results.
    vi.spyOn(storeMod, 'requireBotClient').mockReturnValue(client)
    mode = 'stale-gen'
    pendingGate = deferred()
    const staleRefresh = useBotTeamStore.getState().refreshLive({ forceFull: true })
    currentEpochGen = 2
    pendingGate.resolve({
      status: 200,
      json: { ok: true, value: { ...questionPayload, revision: 99, questions: { 'part-1': { id: 'q-stale' } } } },
    })
    await staleRefresh
    expect(useBotTeamStore.getState().state?.questions['part-1']).toMatchObject({ id: 'q-newer' })

    // Offline target switch clears mismatched session instead of keeping previous Bot session.
    useBotTeamStore.setState({
      state: {
        ...useBotTeamStore.getState().state!,
        bots: [
          { id: 'bot-a', sessionId: 'part-1', name: 'Bot A', role: '', instructions: '', model: '', effort: '', main: true },
          { id: 'bot-b', sessionId: 'part-2', name: 'Bot B', role: '', instructions: '', model: '', effort: '', main: false },
        ],
      },
      selectedId: 'bot-a',
      session: { sessionId: 'part-1', backend: 'harness', updatedAt: 1, running: false, blank: false },
    })
    storeMod.useAppStore.setState({
      connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } },
    })
    const offlineResult = await useBotTeamStore.getState().syncSelectedSession({ selectedId: 'bot-b' })
    expect(offlineResult).toBeUndefined()
    expect(useBotTeamStore.getState().session).toBeUndefined()
  })
})
