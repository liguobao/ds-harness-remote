import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRemoteAttentionClient,
  type AttentionRpcTransport,
} from '@dsh-remote/client-core'
import type {
  AttentionDigest,
  AttentionFollowEvent,
  AttentionItem,
} from '@dsh-remote/protocol'
import {
  AttentionDeepLinkBuffer,
  buildAttentionDeepLinkUrl,
  buildConversationDeepLinkUrl,
  parseAttentionDeepLink,
} from '../src/lib/attention-deeplink'
import {
  filterAttentionItemsByBackend,
  resolveAttentionBackendIdentity,
  selectAttentionBackendFilters,
} from '../src/lib/attention-backend'
import { RemoteServerApi } from '../src/services/api'
import { reconcileTrustedDevices, type DeviceDirectoryApi } from '../src/services/device-directory'
import {
  createLiveSurfaceController,
  syncPushTokensIfSupported,
  type LiveSurfaceForegroundBridge,
} from '../src/services/live-surface'
import {
  deriveLegacyAttentionItems,
  resolveHostAttentionOverview,
  selectAttentionCounts,
  selectAttentionGroups,
  selectCrossHostAttentionCounts,
  useAttentionStore,
} from '../src/state/attention-store'
import type { BotState } from '../src/services/bot-catalog'
import type { RemoteDevice } from '../src/types'

const VALID_TOKEN = '0123456789abcdef0123456789abcdef'

function makeDigest(overrides: Partial<AttentionDigest> = {}): AttentionDigest {
  return {
    revision: 1,
    pendingApprovals: 0,
    pendingQuestions: 0,
    runningSessions: 0,
    completedUnread: 0,
    urgentKind: null,
    urgency: 'silent',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function makeItem(overrides: Partial<AttentionItem> & Pick<AttentionItem, 'id' | 'sessionId' | 'status'>): AttentionItem {
  return {
    backend: 'harness',
    mode: 'agent',
    sessionTitle: 'Session',
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function createFakeAttentionTransport() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const calls: Array<{ method: string; params: unknown }> = []
  let callHandler: (method: string, params: unknown) => Promise<unknown> = async () => ({})

  const transport: AttentionRpcTransport = {
    call: async (method, params) => {
      calls.push({ method, params })
      return callHandler(method, params)
    },
    onEvent: (event, listener) => {
      let set = listeners.get(event)
      if (!set) {
        set = new Set()
        listeners.set(event, set)
      }
      set.add(listener)
      return () => set?.delete(listener)
    },
  }

  return {
    transport,
    calls,
    setHandler(fn: (method: string, params: unknown) => Promise<unknown>) {
      callHandler = fn
    },
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload)
      }
    },
  }
}

afterEach(() => {
  useAttentionStore.getState().reset()
  vi.restoreAllMocks()
})

describe('attention deep link parser and cold-start buffer', () => {
  it('parses dshremote://attention with and without valid opaque token', () => {
    const withToken = parseAttentionDeepLink(buildAttentionDeepLinkUrl('host-1', VALID_TOKEN))
    expect(withToken).toEqual({
      kind: 'attention',
      hostId: 'host-1',
      token: VALID_TOKEN,
      rawUrl: `dshremote://attention?host=host-1&token=${VALID_TOKEN}`,
    })

    const withoutToken = parseAttentionDeepLink('dshremote://attention?host=host-2')
    expect(withoutToken).toEqual({
      kind: 'attention',
      hostId: 'host-2',
      rawUrl: 'dshremote://attention?host=host-2',
    })
  })

  it('rejects invalid attention tokens and untrusted schemes fail-closed', () => {
    expect(parseAttentionDeepLink('dshremote://attention?host=host-1&token=not-hex')).toBeNull()
    expect(parseAttentionDeepLink('dshremote://attention?host=host-1&token=ABCDEF0123456789ABCDEF0123456789')).toBeNull()
    expect(parseAttentionDeepLink('https://example.com/attention?host=host-1')).toBeNull()
    expect(parseAttentionDeepLink('dshremote://unknown?host=host-1')).toBeNull()
    expect(parseAttentionDeepLink('dshremote://attention')).toBeNull()
    expect(parseAttentionDeepLink('not a url')).toBeNull()
  })

  it('parses dshremote://conversation with mode=bot, mode=agent, and default mode', () => {
    expect(parseAttentionDeepLink(buildConversationDeepLinkUrl('host-1', 'bot-sess', 'bot'))).toEqual({
      kind: 'conversation',
      hostId: 'host-1',
      sessionId: 'bot-sess',
      mode: 'bot',
      rawUrl: 'dshremote://conversation?host=host-1&session=bot-sess&mode=bot',
    })
    expect(parseAttentionDeepLink('dshremote://conversation?host=host-1&session=s1&mode=agent')).toMatchObject({
      kind: 'conversation',
      hostId: 'host-1',
      sessionId: 's1',
      mode: 'agent',
    })
    expect(parseAttentionDeepLink('dshremote://conversation?host=host-1&session=s1')).toMatchObject({
      kind: 'conversation',
      hostId: 'host-1',
      sessionId: 's1',
      mode: 'agent',
    })
    expect(parseAttentionDeepLink('dshremote://conversation?host=host-1&session=s1&mode=admin')).toBeNull()
  })

  it('buffers and deduplicates duplicate cold-start links', () => {
    const buffer = new AttentionDeepLinkBuffer()
    const url = buildAttentionDeepLinkUrl('host-1', VALID_TOKEN)
    expect(buffer.enqueueUrl(url)).not.toBeNull()
    expect(buffer.enqueueUrl(url)).toBeNull()
    expect(buffer.peek()?.kind).toBe('attention')
    const taken = buffer.take()
    expect(taken?.kind).toBe('attention')
    expect(buffer.peek()).toBeUndefined()
  })
})

describe('cross-host presence attentionDigest parsing and reconciliation', () => {
  it('parses valid digest for online hosts, ignores invalid digests, and clears offline digests', async () => {
    const validDigest = makeDigest({
      revision: 4,
      pendingApprovals: 1,
      runningSessions: 2,
      urgentKind: 'approval_needed',
      urgency: 'critical',
      attentionToken: VALID_TOKEN,
    })

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/devices')) {
        return new Response(JSON.stringify({
          items: [
            {
              deviceId: 'host-online',
              name: 'MacBook',
              platform: 'darwin',
              role: 'host',
              membershipId: 'm1',
              online: true,
              attentionDigest: validDigest,
            },
            {
              deviceId: 'host-bad-digest',
              name: 'Linux',
              platform: 'linux',
              role: 'host',
              membershipId: 'm2',
              online: true,
              attentionDigest: { ...validDigest, leakedPlaintext: 'secret' },
            },
            {
              deviceId: 'host-offline',
              name: 'Windows',
              platform: 'win32',
              role: 'host',
              membershipId: 'm3',
              online: false,
              attentionDigest: validDigest,
            },
          ],
        }), { status: 200 })
      }
      if (url.endsWith('/presence')) {
        return new Response(JSON.stringify({
          deviceId: 'host-online',
          online: true,
          attentionDigest: validDigest,
        }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })

    const api = new RemoteServerApi('https://remote.example.com', 'access-token', fetchMock as unknown as typeof fetch)
    const listed = await api.listDevices()
    expect(listed.find(d => d.deviceId === 'host-online')?.attentionDigest).toEqual(validDigest)
    expect(listed.find(d => d.deviceId === 'host-bad-digest')?.attentionDigest).toBeUndefined()
    expect(listed.find(d => d.deviceId === 'host-offline')?.attentionDigest).toBeUndefined()

    const presence = await api.getPresence('host-online')
    expect(presence.attentionDigest).toEqual(validDigest)

    const trusted: RemoteDevice[] = [
      {
        deviceId: 'host-1',
        name: 'Desk',
        platform: 'linux',
        identityKey: 'k1',
        membershipId: 'm1',
        online: true,
        trusted: true,
        attentionDigest: validDigest,
      },
    ]
    const dirApi: DeviceDirectoryApi = {
      listDevices: async () => [{
        deviceId: 'host-1',
        name: 'Desk',
        platform: 'linux',
        role: 'host',
        membershipId: 'm1',
        identityKey: '',
        online: false,
        trusted: false,
      }],
      deviceFor: async () => ({
        deviceId: 'host-1',
        name: 'Desk',
        role: 'host',
        platform: 'linux',
        identityKey: 'k1',
        membershipId: 'm1',
        online: false,
      }),
      getPresence: async () => ({ deviceId: 'host-1', online: false }),
    }
    const reconciled = await reconcileTrustedDevices(dirApi, trusted)
    expect(reconciled.devices[0]?.online).toBe(false)
    expect(reconciled.devices[0]?.attentionDigest).toBeUndefined()
  })
})

describe('attentionStore', () => {
  it('follows Noise stream events, rejects stale connection generations, and acks unread items', async () => {
    const fake1 = createFakeAttentionTransport()
    const initialApproval = makeItem({
      id: 'item-approval',
      sessionId: 's-approval',
      status: 'waiting_approval',
      updatedAt: 200,
    })
    const completedItem = makeItem({
      id: 'item-done',
      sessionId: 's-done',
      status: 'completed_unread',
      updatedAt: 100,
    })
    fake1.setHandler(async method => {
      if (method === 'attention.follow') {
        return {
          revision: 1,
          digest: makeDigest({ revision: 1, pendingApprovals: 1, completedUnread: 1 }),
          items: [completedItem, initialApproval],
        }
      }
      if (method === 'attention.ackUnread') {
        return { ok: true, revision: 3 }
      }
      if (method === 'attention.resolveToken') {
        return {
          kind: 'session',
          backend: 'ds-bot',
          mode: 'bot',
          sessionId: 'bot-s1',
          itemId: 'item-approval',
        }
      }
      return {}
    })

    const client1 = createRemoteAttentionClient(fake1.transport)
    await useAttentionStore.getState().attachConnection({
      hostId: 'host-1',
      generation: 1,
      advertisedSupported: true,
      client: client1,
    })

    expect(useAttentionStore.getState().supported).toBe(true)
    expect(useAttentionStore.getState().items.map(i => i.id)).toEqual(['item-approval', 'item-done'])

    // Upsert a waiting_question -> jumps to top priority
    const questionItem = makeItem({
      id: 'item-q',
      sessionId: 's-q',
      status: 'waiting_question',
      updatedAt: 150,
    })
    fake1.emit('attention.follow.event', {
      type: 'upsert',
      revision: 2,
      digest: makeDigest({ revision: 2, pendingApprovals: 1, pendingQuestions: 1, completedUnread: 1 }),
      item: questionItem,
    } satisfies AttentionFollowEvent)

    expect(useAttentionStore.getState().items.map(i => i.id)).toEqual(['item-q', 'item-approval', 'item-done'])

    // ackUnread removes completed_unread locally and calls RPC
    await useAttentionStore.getState().ackUnread(['item-done'])
    expect(useAttentionStore.getState().items.map(i => i.id)).toEqual(['item-q', 'item-approval'])
    expect(fake1.calls.some(c => c.method === 'attention.ackUnread')).toBe(true)

    // resolveToken resolves valid token
    const resolved = await useAttentionStore.getState().resolveToken(VALID_TOKEN)
    expect(resolved).toMatchObject({ kind: 'session', mode: 'bot', sessionId: 'bot-s1' })
    expect(await useAttentionStore.getState().resolveToken('bad')).toEqual({ kind: 'inbox' })

    // Attach generation 2 -> stale callbacks from generation 1 MUST be ignored
    const fake2 = createFakeAttentionTransport()
    fake2.setHandler(async method => {
      if (method === 'attention.follow') {
        return {
          revision: 1,
          digest: makeDigest({ revision: 1 }),
          items: [],
        }
      }
      return {}
    })
    await useAttentionStore.getState().attachConnection({
      hostId: 'host-2',
      generation: 2,
      advertisedSupported: true,
      client: createRemoteAttentionClient(fake2.transport),
    })

    fake1.emit('attention.follow.event', {
      type: 'upsert',
      revision: 99,
      digest: makeDigest({ revision: 99, pendingApprovals: 1 }),
      item: makeItem({ id: 'stale-item', sessionId: 's-stale', status: 'waiting_approval', updatedAt: 999 }),
    } satisfies AttentionFollowEvent)

    expect(useAttentionStore.getState().items).toEqual([])
  })

  it('falls back gracefully on legacy Hosts and includes DS-Bot approvals, questions, and work', async () => {
    const fake = createFakeAttentionTransport()
    fake.setHandler(async () => {
      throw Object.assign(new Error('Method not found'), { code: 'METHOD_NOT_FOUND' })
    })
    await useAttentionStore.getState().attachConnection({
      hostId: 'legacy-host',
      generation: 1,
      advertisedSupported: false,
      client: createRemoteAttentionClient(fake.transport),
    })

    expect(useAttentionStore.getState().supported).toBe(false)
    expect(await useAttentionStore.getState().resolveToken(VALID_TOKEN)).toEqual({ kind: 'inbox' })

    const botState: BotState = {
      bots: [{
        id: 'bot-1',
        sessionId: 'bot-sess-1',
        name: 'Research Bot',
        role: 'Analyst',
        instructions: '',
        model: 'ds',
        effort: 'medium',
        main: true,
      }],
      rooms: [{
        id: 'room-1',
        sessionId: 'room-sess-1',
        name: 'Core Room',
        members: ['bot-1'],
        notice: '',
        admin: 'bot-1',
      }],
      agents: [],
      exchangeTurns: {},
      btwCards: {},
      btwSupported: false,
      sideChats: {},
      activity: {},
      work: {
        bots: {},
        rooms: { 'room-1': { running: true, updatedAt: 500 } },
        waiting: {},
        turns: {},
        steered: {},
      },
      questions: {
        'bot-sess-1': { id: 'q-bot-1', question: 'Confirm deploy target?', updatedAt: 700 },
      },
      views: {},
      closedCards: {},
      imVia: {},
      connectorRequests: {},
      mailRequests: {},
      approvals: [
        { id: 'apr-bot-1', botId: 'bot-1', sessionId: 'bot-sess-2', answerable: true, toolName: 'bash', updatedAt: 600 },
      ],
      models: [],
    }

    const derived = deriveLegacyAttentionItems({
      sessions: [
        { sessionId: 's-codex', backend: 'codex', title: 'Fix tests', running: false, blank: false, updatedAt: 400 },
        { sessionId: 's-done', backend: 'harness', title: 'Build report', running: false, blank: false, updatedAt: 300 },
        { sessionId: 's-fail', backend: 'claude', title: 'Deploy', running: false, blank: false, updatedAt: 350 },
      ],
      sessionLifecycles: {
        's-done': { seq: 5, running: false, finished: 'completed' },
        's-fail': { seq: 6, running: false, finished: 'failed' },
      },
      messages: {
        's-codex': [{ id: 'a1', kind: 'approval', sessionId: 's-codex', createdAt: 400, approvalId: 'a1', toolName: 'shell' }],
      },
      botState,
      now: 1000,
    })

    const groups = selectAttentionGroups(derived)
    expect(groups.attention.map(i => i.status)).toEqual([
      'waiting_question',
      'waiting_approval',
      'waiting_approval',
      'failed_unread',
    ])
    expect(groups.attention[0]).toMatchObject({ backend: 'ds-bot', mode: 'bot', sessionTitle: 'Research Bot' })
    expect(groups.finished.map(i => i.sessionId)).toEqual(['s-done'])
    expect(groups.running.map(i => ({ backend: i.backend, sessionId: i.sessionId }))).toEqual([
      { backend: 'ds-bot', sessionId: 'room-sess-1' },
    ])

    const counts = selectAttentionCounts(derived)
    expect(counts).toEqual({
      pendingApprovals: 2,
      pendingQuestions: 1,
      runningSessions: 1,
      completedUnread: 1,
      failedUnread: 1,
      totalUrgent: 3,
      totalActive: 6,
    })
  })
})

describe('live-surface unified bridge', () => {
  it('updates Android LiveTaskV2 with extraCount & deep link, deduplicates alerts, and clears alerts when approvals resolve', async () => {
    const foreground: LiveSurfaceForegroundBridge = {
      notifyTask: vi.fn(),
      notifyAttention: vi.fn(),
      clearAttentionAlerts: vi.fn(async () => undefined),
      updateLiveTask: vi.fn(async () => undefined),
      updateLiveTaskV2: vi.fn(async () => undefined),
      clearLiveTask: vi.fn(async () => undefined),
    }

    const controller = createLiveSurfaceController({
      foreground,
      getReactNative: () => ({ Platform: { OS: 'android' }, NativeModules: {} }),
    })

    const approval = makeItem({
      id: 'item-a1',
      sessionId: 's1',
      backend: 'codex',
      mode: 'agent',
      sessionTitle: 'PR Review',
      status: 'waiting_approval',
      summary: 'Run git push',
      updatedAt: 2000,
    })
    const running = makeItem({
      id: 'item-r1',
      sessionId: 's2',
      backend: 'ds-bot',
      mode: 'bot',
      sessionTitle: 'Research Bot',
      status: 'running',
      updatedAt: 1500,
    })
    const digest = makeDigest({
      revision: 2,
      pendingApprovals: 1,
      runningSessions: 1,
      urgentKind: 'approval_needed',
      urgency: 'critical',
      attentionToken: VALID_TOKEN,
    })

    // 1. Backgrounded -> fires notifyAttention once and updates LiveTaskV2 with extraCount=1 & token deep link
    await controller.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'background',
      notificationsEnabled: true,
      activeSessionId: 's1',
      activeMode: 'agent',
      items: [running, approval],
      digest,
    })

    expect(foreground.updateLiveTaskV2).toHaveBeenCalledTimes(1)
    expect(foreground.updateLiveTaskV2).toHaveBeenCalledWith(
      'host-1',
      `dshremote://attention?host=host-1&token=${VALID_TOKEN}`,
      'X',
      'PR Review',
      expect.any(String),
      true,
      2000,
      'Run git push',
      1,
    )
    expect(foreground.notifyAttention).toHaveBeenCalledTimes(1)
    expect(foreground.notifyAttention).toHaveBeenCalledWith(
      'host-1',
      `dshremote://attention?host=host-1&token=${VALID_TOKEN}`,
      'attention:host-1:s1',
      'PR Review',
      expect.stringMatching(/^Codex · .*Run git push/),
    )

    // 2. Identical sync -> deduplicated (no duplicate alert or redundant LiveTaskV2 update)
    await controller.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'background',
      notificationsEnabled: true,
      activeSessionId: 's1',
      activeMode: 'agent',
      items: [running, approval],
      digest,
    })
    expect(foreground.notifyAttention).toHaveBeenCalledTimes(1)
    expect(foreground.updateLiveTaskV2).toHaveBeenCalledTimes(1)

    // 3. Approval resolved on Desktop -> pending approvals drop to 0 -> clearAttentionAlerts(hostId) called!
    await controller.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'background',
      notificationsEnabled: true,
      activeSessionId: 's1',
      activeMode: 'agent',
      items: [running],
      digest: makeDigest({ revision: 3, runningSessions: 1 }),
    })

    expect(foreground.clearAttentionAlerts).toHaveBeenCalledTimes(1)
    expect(foreground.clearAttentionAlerts).toHaveBeenCalledWith('host-1')
    expect(foreground.updateLiveTaskV2).toHaveBeenLastCalledWith(
      'host-1',
      'dshremote://conversation?host=host-1&session=s2&mode=bot',
      'B',
      'Research Bot',
      expect.any(String),
      false,
      1500,
      '',
      0,
    )

    // 4. Foregrounded on exact session -> suppresses new alert
    await controller.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'active',
      notificationsEnabled: true,
      activeSessionId: 's2',
      activeMode: 'bot',
      items: [makeItem({
        id: 'item-done-s2',
        sessionId: 's2',
        backend: 'ds-bot',
        mode: 'bot',
        sessionTitle: 'Research Bot',
        status: 'completed_unread',
        updatedAt: 3000,
      })],
      digest: makeDigest({ revision: 4, completedUnread: 1 }),
    })
    expect(foreground.notifyAttention).toHaveBeenCalledTimes(1)

    await controller.dispose()
  })

  it('guards iOS Live Activity safely when native module is absent and invokes it when linked', async () => {
    const foreground: LiveSurfaceForegroundBridge = {
      notifyTask: vi.fn(),
      notifyAttention: vi.fn(),
      clearAttentionAlerts: vi.fn(async () => undefined),
      updateLiveTask: vi.fn(async () => undefined),
      updateLiveTaskV2: vi.fn(async () => undefined),
      clearLiveTask: vi.fn(async () => undefined),
    }

    // Native iOS module absent -> zero crash!
    const absentController = createLiveSurfaceController({
      foreground,
      getReactNative: () => ({ Platform: { OS: 'ios' }, NativeModules: {} }),
    })
    await expect(absentController.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'active',
      notificationsEnabled: true,
      items: [makeItem({ id: 'r1', sessionId: 's1', status: 'running', updatedAt: 100 })],
      digest: makeDigest({ runningSessions: 1 }),
    })).resolves.toBeUndefined()
    await expect(absentController.dispose()).resolves.toBeUndefined()

    // Native iOS module linked -> calls update and end
    const iosUpdate = vi.fn(async () => undefined)
    const iosEnd = vi.fn(async () => undefined)
    const linkedController = createLiveSurfaceController({
      foreground,
      getReactNative: () => ({
        Platform: { OS: 'ios' },
        NativeModules: {
          DshRemoteLiveActivity: { update: iosUpdate, end: iosEnd },
        },
      }),
    })
    await linkedController.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'active',
      notificationsEnabled: true,
      items: [makeItem({ id: 'r1', sessionId: 's1', status: 'running', updatedAt: 100 })],
      digest: makeDigest({ runningSessions: 1 }),
    })
    expect(iosUpdate).toHaveBeenCalledTimes(1)
    expect(iosUpdate).toHaveBeenCalledWith({
      hostId: 'host-1',
      hostName: 'host-1',
      pendingApprovals: 0,
      pendingQuestions: 0,
      runningSessions: 1,
      completedUnread: 0,
      attentionToken: undefined,
    }, null)
    await linkedController.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'active',
      notificationsEnabled: true,
      items: [],
      digest: makeDigest(),
    })
    expect(iosEnd).toHaveBeenCalledWith('host-1')
  })

  it('gates push target sync strictly on push.wake.v1 capability', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, body: null }))

    const skipped = await syncPushTokensIfSupported({
      baseUrl: 'https://remote.example.com',
      accessToken: 'token-123',
      pushWakeSupported: false,
      pushTarget: { platform: 'ios', pushToken: 'apns-token' },
      fetchImpl: fetchMock,
    })
    expect(skipped).toEqual({ skippedUnsupported: true })
    expect(fetchMock).not.toHaveBeenCalled()

    const synced = await syncPushTokensIfSupported({
      baseUrl: 'https://remote.example.com',
      accessToken: 'token-123',
      pushWakeSupported: true,
      hostId: 'host-1',
      pushTarget: { platform: 'ios', pushToken: 'apns-token', environment: 'production' },
      liveActivity: { activityPushToken: 'la-token', environment: 'production' },
      fetchImpl: fetchMock,
    })
    expect(synced.skippedUnsupported).toBe(false)
    expect(synced.pushTarget).toEqual({ ok: true })
    expect(synced.liveActivity).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('attention platform differentiation and cross-host switching state', () => {
  it('resolves distinct labels, glyphs, filters, and notification prefixes for every agent backend', async () => {
    const samples: Array<{
      item: AttentionItem
      expectedKey: string
      expectedLabel: string
      expectedBadge: string
    }> = [
      { item: makeItem({ id: '1', sessionId: 's1', backend: 'harness', status: 'running' }), expectedKey: 'harness', expectedLabel: 'DeepSeek Harness', expectedBadge: 'D' },
      { item: makeItem({ id: '2', sessionId: 's2', backend: 'codex', status: 'waiting_approval' }), expectedKey: 'codex', expectedLabel: 'Codex', expectedBadge: 'X' },
      { item: makeItem({ id: '3', sessionId: 's3', backend: 'acp', acpAdapter: 'antigravity', status: 'waiting_question' }), expectedKey: 'antigravity', expectedLabel: 'Antigravity', expectedBadge: 'A' },
      { item: makeItem({ id: '4', sessionId: 's4', backend: 'acp', acpAdapter: 'hermes', status: 'running' }), expectedKey: 'hermes', expectedLabel: 'Hermes', expectedBadge: 'H' },
      { item: makeItem({ id: '5', sessionId: 's5', backend: 'acp', acpAdapter: 'cursor', status: 'completed_unread' }), expectedKey: 'cursor', expectedLabel: 'Cursor', expectedBadge: 'U' },
      { item: makeItem({ id: '6', sessionId: 's6', backend: 'acp', acpAdapter: 'claude', status: 'running' }), expectedKey: 'claude', expectedLabel: 'Claude', expectedBadge: 'C' },
      { item: makeItem({ id: '7', sessionId: 's7', backend: 'acp', acpAdapter: 'opencode', status: 'running' }), expectedKey: 'opencode', expectedLabel: 'OpenCode', expectedBadge: 'O' },
      { item: makeItem({ id: '8', sessionId: 's8', backend: 'acp', acpAdapter: 'pi', status: 'running' }), expectedKey: 'pi', expectedLabel: 'Pi', expectedBadge: 'P' },
      { item: makeItem({ id: '9', sessionId: 's9', backend: 'ds-bot', mode: 'bot', status: 'running' }), expectedKey: 'ds-bot', expectedLabel: 'DS-Bot', expectedBadge: 'B' },
      { item: makeItem({ id: '10', sessionId: 's10', backend: 'acp', acpAdapter: 'my-custom-agent', status: 'running' }), expectedKey: 'acp:my-custom-agent', expectedLabel: 'My Custom Agent', expectedBadge: 'M' },
    ]

    for (const sample of samples) {
      const resolved = resolveAttentionBackendIdentity(sample.item)
      expect(resolved.key).toBe(sample.expectedKey)
      expect(resolved.label).toBe(sample.expectedLabel)
      expect(resolved.shortBadge).toBe(sample.expectedBadge)
    }

    const filters = selectAttentionBackendFilters(samples.map(s => s.item))
    expect(filters.map(f => f.label)).toEqual([
      'DeepSeek Harness',
      'Codex',
      'Antigravity',
      'Hermes',
      'Cursor',
      'Claude',
      'OpenCode',
      'Pi',
      'DS-Bot',
      'My Custom Agent',
    ])
    expect(filterAttentionItemsByBackend(samples.map(s => s.item), 'hermes').map(i => i.id)).toEqual(['4'])
    expect(filterAttentionItemsByBackend(samples.map(s => s.item), 'all')).toHaveLength(10)

    const foreground: LiveSurfaceForegroundBridge = {
      notifyTask: vi.fn(),
      notifyAttention: vi.fn(),
      updateLiveTask: vi.fn(async () => undefined),
      updateLiveTaskV2: vi.fn(async () => undefined),
      clearLiveTask: vi.fn(async () => undefined),
    }
    const controller = createLiveSurfaceController({
      foreground,
      getReactNative: () => ({ Platform: { OS: 'android' }, NativeModules: {} }),
    })
    await controller.sync({
      hostId: 'host-1',
      connected: true,
      appState: 'background',
      notificationsEnabled: true,
      items: [makeItem({ id: 'ag1', sessionId: 'agy:1', backend: 'acp', acpAdapter: 'antigravity', status: 'waiting_approval', summary: 'Run build' })],
      digest: makeDigest({ pendingApprovals: 1 }),
    })
    expect(foreground.notifyAttention).toHaveBeenCalledWith(
      'host-1',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.stringMatching(/^Antigravity · .*Run build/),
    )
    expect(foreground.updateLiveTaskV2).toHaveBeenCalledWith(
      'host-1',
      expect.any(String),
      'A',
      expect.any(String),
      expect.stringMatching(/^Antigravity · /),
      true,
      expect.any(Number),
      'Run build',
      0,
    )
    await controller.dispose()
  })

  it('retains per-host snapshots across host switches while respecting Server digest freshness and sign-out eviction', async () => {
    const fakeA = createFakeAttentionTransport()
    const itemA = makeItem({
      id: 'hermes-approval',
      backend: 'acp',
      acpAdapter: 'hermes',
      sessionId: 'hermes:s1',
      sessionTitle: 'Hermes task on Host A',
      status: 'waiting_approval',
      updatedAt: 500,
    })
    fakeA.setHandler(async method => {
      if (method === 'attention.follow') {
        return {
          revision: 4,
          digest: makeDigest({ revision: 4, pendingApprovals: 1, urgentKind: 'approval_needed', urgency: 'critical' }),
          items: [itemA],
        }
      }
      return {}
    })
    await useAttentionStore.getState().attachConnection({
      hostId: 'host-a',
      generation: 1,
      advertisedSupported: true,
      client: createRemoteAttentionClient(fakeA.transport),
    })

    // Switching away detaches host-a active items synchronously while keeping cachedByHost['host-a']
    const detachPromise = useAttentionStore.getState().detachConnection()
    expect(useAttentionStore.getState().hostId).toBeUndefined()
    expect(useAttentionStore.getState().items).toEqual([])
    await detachPromise
    expect(useAttentionStore.getState().cachedByHost['host-a']?.items.map(i => i.id)).toEqual(['hermes-approval'])

    const fakeB = createFakeAttentionTransport()
    const itemB = makeItem({
      id: 'cursor-run',
      backend: 'acp',
      acpAdapter: 'cursor',
      sessionId: 'cursor:s2',
      sessionTitle: 'Cursor task on Host B',
      status: 'running',
      updatedAt: 600,
    })
    fakeB.setHandler(async method => {
      if (method === 'attention.follow') {
        return {
          revision: 2,
          digest: makeDigest({ revision: 2, runningSessions: 1 }),
          items: [itemB],
        }
      }
      return {}
    })
    await useAttentionStore.getState().attachConnection({
      hostId: 'host-b',
      generation: 2,
      advertisedSupported: true,
      client: createRemoteAttentionClient(fakeB.transport),
    })

    const cachedA = useAttentionStore.getState().cachedByHost['host-a']
    const deviceA: RemoteDevice = {
      deviceId: 'host-a',
      name: 'Workstation-A',
      platform: 'darwin',
      identityKey: 'key-a',
      membershipId: 'm-a',
      online: true,
      trusted: true,
      attentionDigest: makeDigest({ revision: 4, pendingApprovals: 1, urgentKind: 'approval_needed', urgency: 'critical' }),
    }
    const deviceB: RemoteDevice = {
      deviceId: 'host-b',
      name: 'Lab-Linux',
      platform: 'linux',
      identityKey: 'key-b',
      membershipId: 'm-b',
      online: true,
      trusted: true,
      attentionDigest: makeDigest({ revision: 99, pendingQuestions: 9, runningSessions: 9 }),
    }
    const deviceC: RemoteDevice = {
      deviceId: 'host-c',
      name: 'Cloud-Worker',
      platform: 'linux',
      identityKey: 'key-c',
      membershipId: 'm-c',
      online: true,
      trusted: true,
      attentionDigest: makeDigest({ revision: 1, pendingQuestions: 1, urgentKind: 'question_needed', urgency: 'critical' }),
    }
    const deviceUntrusted: RemoteDevice = {
      deviceId: 'host-d',
      name: 'Untrusted',
      platform: 'linux',
      identityKey: 'key-d',
      membershipId: 'm-d',
      online: true,
      trusted: false,
      attentionDigest: makeDigest({ revision: 1, pendingApprovals: 5 }),
    }

    // Connected host B ignores spoofed/stale REST digest and uses live E2EE items
    expect(resolveHostAttentionOverview({
      device: deviceB,
      connectedHostId: 'host-b',
      activeItems: [itemB],
      cachedSnapshot: useAttentionStore.getState().cachedByHost['host-b'],
    })).toMatchObject({ freshness: 'live', totalActive: 1, runningSessions: 1 })

    // Other host A matches digest rev 4 -> digest-match with cached Hermes preview item
    expect(resolveHostAttentionOverview({
      device: deviceA,
      connectedHostId: 'host-b',
      activeItems: [itemB],
      cachedSnapshot: cachedA,
    })).toMatchObject({ freshness: 'digest-match', pendingApprovals: 1, items: [itemA] })

    // Newer server revision marks cached snapshot stale
    expect(resolveHostAttentionOverview({
      device: { ...deviceA, attentionDigest: makeDigest({ revision: 5, pendingApprovals: 2 }) },
      connectedHostId: 'host-b',
      activeItems: [itemB],
      cachedSnapshot: cachedA,
    })).toMatchObject({ freshness: 'digest-stale', pendingApprovals: 2, items: [itemA] })

    // Server cleared (0 active) suppresses stale cached preview cards
    expect(resolveHostAttentionOverview({
      device: { ...deviceA, attentionDigest: makeDigest({ revision: 6, urgentKind: 'clear' }) },
      connectedHostId: 'host-b',
      activeItems: [itemB],
      cachedSnapshot: cachedA,
    })).toMatchObject({ freshness: 'digest-cleared', totalActive: 0, items: [] })

    // Cross-host pill counts combine connected host-b + trusted online host-a + host-c (excluding untrusted host-d)
    expect(selectCrossHostAttentionCounts({
      devices: [deviceB, deviceA, deviceC, deviceUntrusted],
      connectedHostId: 'host-b',
      activeItems: [itemB],
    })).toEqual({
      pendingApprovals: 1,
      pendingQuestions: 1,
      runningSessions: 1,
      completedUnread: 0,
      failedUnread: 0,
      totalUrgent: 2,
      totalActive: 3,
      otherHostsUrgent: 2,
      otherHostsActive: 2,
    })

    // evictHost drops only that host; reset drops everything
    useAttentionStore.getState().evictHost('host-a')
    expect(useAttentionStore.getState().cachedByHost['host-a']).toBeUndefined()
    expect(useAttentionStore.getState().cachedByHost['host-b']).toBeDefined()
    useAttentionStore.getState().reset()
    expect(useAttentionStore.getState().cachedByHost).toEqual({})
  })

  it('ignores prototype property names when resolving custom ACP adapter metadata', () => {
    expect(resolveAttentionBackendIdentity({ backend: 'acp', acpAdapter: 'constructor' })).toMatchObject({
      key: 'acp:constructor',
      label: 'Constructor',
      shortBadge: 'C',
    })
    expect(resolveAttentionBackendIdentity({ backend: 'acp', acpAdapter: 'toString' })).toMatchObject({
      key: 'acp:tostring',
      label: 'toString',
      shortBadge: 'T',
    })
  })
})
