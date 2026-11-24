import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  ATTENTION_INBOX_CAPABILITY,
  ATTENTION_SIGNAL_CAPABILITY,
  ATTENTION_TOKEN_PATTERN,
  MAX_ATTENTION_COUNT,
  MAX_ATTENTION_ITEMS,
  MAX_ATTENTION_SUMMARY_CHARS,
  MAX_ATTENTION_TITLE_CHARS,
  PUSH_WAKE_CAPABILITY,
  acceptNegotiatedCapabilities,
  attentionAckUnreadRequestSchema,
  attentionAckUnreadResultSchema,
  attentionDigestSchema,
  attentionFollowEventSchema,
  attentionItemSchema,
  attentionListResultSchema,
  attentionResolveTokenRequestSchema,
  attentionTargetSchema,
  compareAttentionItems,
  controlCapabilities,
  createControlFrame,
  decodeControlFrame,
  deviceDescriptorSchema,
  devicePresenceResponseSchema,
  encodeControlFrame,
  hostAttentionSignalPayloadSchema,
  liveActivityTokenRegistrationRequestSchema,
  parseControlFrame,
  pushTargetRegistrationRequestSchema,
  remoteEvents,
  rpcMethods,
  type AttentionDigest,
  type AttentionItem,
} from '../src/index.js'

const VALID_TOKEN = '0123456789abcdef0123456789abcdef'

function makeDigest(overrides: Partial<AttentionDigest> = {}): AttentionDigest {
  return {
    revision: 1,
    pendingApprovals: 1,
    pendingQuestions: 0,
    runningSessions: 2,
    completedUnread: 0,
    urgentKind: 'approval_needed',
    urgency: 'critical',
    attentionToken: VALID_TOKEN,
    updatedAt: 1786000000000,
    ...overrides,
  }
}

function makeItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'harness:sess-1:approval-1',
    backend: 'harness',
    mode: 'agent',
    workspaceId: 'ws-1',
    workspaceLabel: 'Repo',
    sessionId: 'sess-1',
    sessionTitle: 'Fix build',
    status: 'waiting_approval',
    summary: 'Approve shell command',
    updatedAt: 1786000000000,
    ...overrides,
  }
}

describe('AttentionDigest and host.attention.signal strict zero-plaintext contracts', () => {
  it('validates and round-trips valid AttentionDigest and host.attention.signal frames', async () => {
    await runScenarios([
      {
        name: 'round-trips host.attention.signal through encodeControlFrame/decodeControlFrame',
        run: () => {
          const frame = createControlFrame('host.attention.signal', { digest: makeDigest() })
          const decoded = decodeControlFrame(encodeControlFrame(frame))
          expect(decoded).toEqual(frame)
        },
      },
      {
        name: 'accepts zero counts, boundary 99 counts, null urgentKind, and omitted attentionToken',
        run: () => {
          const zero = makeDigest({
            revision: 0,
            pendingApprovals: 0,
            pendingQuestions: 0,
            runningSessions: 0,
            completedUnread: 0,
            urgentKind: null,
            urgency: 'silent',
            attentionToken: undefined,
            updatedAt: 0,
          })
          delete (zero as Record<string, unknown>).attentionToken
          expect(attentionDigestSchema.parse(zero)).toEqual(zero)

          const maxed = makeDigest({
            revision: Number.MAX_SAFE_INTEGER,
            pendingApprovals: MAX_ATTENTION_COUNT,
            pendingQuestions: MAX_ATTENTION_COUNT,
            runningSessions: MAX_ATTENTION_COUNT,
            completedUnread: MAX_ATTENTION_COUNT,
            urgentKind: 'turn_failed',
            urgency: 'normal',
          })
          expect(attentionDigestSchema.parse(maxed)).toEqual(maxed)
        },
      },
      {
        name: 'exposes capability constants, control capability list, and RPC/event registrations',
        run: () => {
          expect(ATTENTION_SIGNAL_CAPABILITY).toBe('attention.signal.v1')
          expect(ATTENTION_INBOX_CAPABILITY).toBe('attention.inbox.v1')
          expect(PUSH_WAKE_CAPABILITY).toBe('push.wake.v1')
          expect(ATTENTION_TOKEN_PATTERN.test(VALID_TOKEN)).toBe(true)
          expect(controlCapabilities).toContain(ATTENTION_SIGNAL_CAPABILITY)
          expect(rpcMethods).toContain('attention.list')
          expect(rpcMethods).toContain('attention.follow')
          expect(rpcMethods).toContain('attention.resolveToken')
          expect(rpcMethods).toContain('attention.ackUnread')
          expect(remoteEvents).toContain('attention.follow.event')
        },
      },
    ])
  })

  it('strictly rejects extra/plaintext fields, invalid tokens, and out-of-range counts', async () => {
    const base = makeDigest()
    await runScenarios([
      ...(['title', 'sessionId', 'prompt', 'path', 'command', 'summary'] as const).map(field => ({
        name: `rejects plaintext field "${field}" on AttentionDigest`,
        run: () => {
          expect(() => attentionDigestSchema.parse({ ...base, [field]: 'secret' })).toThrow()
          expect(() => hostAttentionSignalPayloadSchema.parse({ digest: { ...base, [field]: 'secret' } })).toThrow()
        },
      })),
      ...(['connectionId', 'targetDeviceId', 'sessionId', 'title'] as const).map(field => ({
        name: `rejects extra field "${field}" on host.attention.signal payload`,
        run: () => {
          expect(() => hostAttentionSignalPayloadSchema.parse({ digest: base, [field]: 'nope' })).toThrow()
        },
      })),
      ...[
        ['too short (31 hex)', '0123456789abcdef0123456789abcde'],
        ['too long (33 hex)', '0123456789abcdef0123456789abcdef0'],
        ['uppercase hex', '0123456789ABCDEF0123456789abcdef'],
        ['UUID with hyphens', '0198abc7-1001-7abc-8123-123456789abc'],
        ['non-hex characters', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
        ['empty string', ''],
      ].map(([label, token]) => ({
        name: `rejects invalid attentionToken (${label})`,
        run: () => {
          expect(() => attentionDigestSchema.parse({ ...base, attentionToken: token })).toThrow()
          expect(() => attentionResolveTokenRequestSchema.parse({ token })).toThrow()
        },
      })),
      ...(['pendingApprovals', 'pendingQuestions', 'runningSessions', 'completedUnread'] as const).flatMap(field => [
        {
          name: `rejects negative ${field}`,
          run: () => expect(() => attentionDigestSchema.parse({ ...base, [field]: -1 })).toThrow(),
        },
        {
          name: `rejects ${field} > 99`,
          run: () => expect(() => attentionDigestSchema.parse({ ...base, [field]: MAX_ATTENTION_COUNT + 1 })).toThrow(),
        },
        {
          name: `rejects fractional ${field}`,
          run: () => expect(() => attentionDigestSchema.parse({ ...base, [field]: 1.5 })).toThrow(),
        },
      ]),
      {
        name: 'rejects invalid revision and updatedAt numbers',
        run: () => {
          expect(() => attentionDigestSchema.parse({ ...base, revision: -1 })).toThrow()
          expect(() => attentionDigestSchema.parse({ ...base, revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
          expect(() => attentionDigestSchema.parse({ ...base, updatedAt: -1 })).toThrow()
          expect(() => attentionDigestSchema.parse({ ...base, updatedAt: Number.POSITIVE_INFINITY })).toThrow()
        },
      },
    ])
  })
})

describe('Encrypted-tunnel Attention Inbox and Push Wake schemas', () => {
  it('validates AttentionItem, list, follow events, targets, ack, and bounds', async () => {
    const digest = makeDigest()
    const item = makeItem({
      backend: 'acp',
      acpAdapter: 'cursor',
      detachedExpiresAt: 1786000060000,
    })

    await runScenarios([
      {
        name: 'accepts valid list result and all follow event variants',
        run: () => {
          expect(attentionListResultSchema.parse({ revision: 1, digest, items: [item] }).items).toHaveLength(1)
          expect(attentionFollowEventSchema.parse({ type: 'snapshot', revision: 1, digest, items: [item] }).type).toBe('snapshot')
          expect(attentionFollowEventSchema.parse({ type: 'upsert', revision: 2, digest, item }).type).toBe('upsert')
          expect(attentionFollowEventSchema.parse({ type: 'remove', revision: 3, digest, itemId: item.id }).type).toBe('remove')
        },
      },
      {
        name: 'accepts both session and inbox AttentionTarget variants',
        run: () => {
          expect(attentionTargetSchema.parse({
            kind: 'session',
            backend: 'codex',
            mode: 'agent',
            workspaceId: 'codex:/repo',
            sessionId: 'codex:thread-1',
            itemId: 'codex:thread-1:approval',
          })).toMatchObject({ kind: 'session', backend: 'codex' })
          expect(attentionTargetSchema.parse({ kind: 'inbox' })).toEqual({ kind: 'inbox' })
          expect(() => attentionTargetSchema.parse({ kind: 'inbox', sessionId: 'extra' })).toThrow()
        },
      },
      {
        name: 'validates ackUnread request/result and resolveToken request',
        run: () => {
          expect(attentionResolveTokenRequestSchema.parse({ token: VALID_TOKEN })).toEqual({ token: VALID_TOKEN })
          expect(attentionAckUnreadRequestSchema.parse({ itemIds: [item.id] })).toEqual({ itemIds: [item.id] })
          expect(attentionAckUnreadResultSchema.parse({ ok: true, revision: 4 })).toEqual({ ok: true, revision: 4 })
        },
      },
      {
        name: 'enforces item count, title, and summary length ceilings',
        run: () => {
          expect(() => attentionItemSchema.parse(makeItem({ sessionTitle: 'x'.repeat(MAX_ATTENTION_TITLE_CHARS + 1) }))).toThrow()
          expect(() => attentionItemSchema.parse(makeItem({ summary: 'x'.repeat(MAX_ATTENTION_SUMMARY_CHARS + 1) }))).toThrow()
          const tooMany = Array.from({ length: MAX_ATTENTION_ITEMS + 1 }, (_, i) => makeItem({ id: `item-${i}` }))
          expect(() => attentionListResultSchema.parse({ revision: 1, digest, items: tooMany })).toThrow()
        },
      },
      {
        name: 'validates Hosted Server push target and Live Activity registration requests',
        run: () => {
          expect(pushTargetRegistrationRequestSchema.parse({
            platform: 'ios',
            pushToken: 'apns-token-hex',
            environment: 'production',
            appId: 'com.example.dshremote',
            locale: 'zh-CN',
          })).toMatchObject({ platform: 'ios' })
          expect(liveActivityTokenRegistrationRequestSchema.parse({
            activityPushToken: 'live-activity-token-hex',
            pushToStartToken: 'push-to-start-token-hex',
            environment: 'sandbox',
            activityId: 'act-1',
          })).toMatchObject({ activityPushToken: 'live-activity-token-hex' })
          expect(() => pushTargetRegistrationRequestSchema.parse({ platform: 'web', pushToken: 'x' })).toThrow()
          expect(() => liveActivityTokenRegistrationRequestSchema.parse({ activityPushToken: 'x', sessionTitle: 'leak' })).toThrow()
        },
      },
    ])
  })
})

describe('compareAttentionItems priority and determinism', () => {
  it('orders by status priority, then updatedAt desc, then id lexical asc', () => {
    const items: AttentionItem[] = [
      makeItem({ id: 'completed-new', status: 'completed_unread', updatedAt: 9000 }),
      makeItem({ id: 'failed-old', status: 'failed_unread', updatedAt: 1000 }),
      makeItem({ id: 'running-b', status: 'running', updatedAt: 5000 }),
      makeItem({ id: 'running-a', status: 'running', updatedAt: 5000 }),
      makeItem({ id: 'running-newer', status: 'running', updatedAt: 6000 }),
      makeItem({ id: 'approval-old', status: 'waiting_approval', updatedAt: 100 }),
      makeItem({ id: 'question-oldest', status: 'waiting_question', updatedAt: 50 }),
      makeItem({ id: 'question-tie-10', status: 'waiting_question', updatedAt: 50 }),
      makeItem({ id: 'question-tie-2', status: 'waiting_question', updatedAt: 50 }),
    ]

    const expectedOrder = [
      'question-oldest',
      'question-tie-10',
      'question-tie-2',
      'approval-old',
      'running-newer',
      'running-a',
      'running-b',
      'failed-old',
      'completed-new',
    ]

    expect([...items].sort(compareAttentionItems).map(item => item.id)).toEqual(expectedOrder)
    expect([...items].reverse().sort(compareAttentionItems).map(item => item.id)).toEqual(expectedOrder)
  })
})

describe('backward compatibility without attentionDigest or attention.signal.v1', () => {
  it('accepts legacy DeviceDescriptor, DevicePresenceResponse, and hello.ack payloads', async () => {
    const legacyDevice = {
      deviceId: '0198f7c0-1234-7abc-8def-0123456789ab',
      name: 'Workstation',
      role: 'host' as const,
      platform: 'linux',
      identityKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      clientVersion: '0.5.20',
      harnessVersion: '0.1.5',
    }
    const digest = makeDigest()

    await runScenarios([
      {
        name: 'DeviceDescriptor validates both without and with attentionDigest',
        run: () => {
          expect(deviceDescriptorSchema.parse(legacyDevice)).toEqual(legacyDevice)
          expect(deviceDescriptorSchema.parse({ ...legacyDevice, attentionDigest: digest }).attentionDigest).toEqual(digest)
          expect(() => deviceDescriptorSchema.parse({
            ...legacyDevice,
            attentionDigest: { ...digest, title: 'plaintext-leak' },
          })).toThrow()
        },
      },
      {
        name: 'DevicePresenceResponse validates both without and with attentionDigest',
        run: () => {
          expect(devicePresenceResponseSchema.parse({
            deviceId: 'host-1',
            online: true,
            lastSeenAt: 1786000000000,
          })).toEqual({ deviceId: 'host-1', online: true, lastSeenAt: 1786000000000 })
          expect(devicePresenceResponseSchema.parse({
            deviceId: 'host-1',
            online: true,
            lastSeenAt: null,
            attentionDigest: digest,
          }).attentionDigest).toEqual(digest)
        },
      },
      {
        name: 'hello.ack and capability negotiation tolerate servers without attention.signal.v1',
        run: () => {
          const legacyAck = parseControlFrame({
            v: 1,
            id: 'ack-1',
            type: 'hello.ack',
            timestamp: 1786000000000,
            payload: {
              protocol: 1,
              serverVersion: '0.5.0',
              connectionSessionId: 'sess-1',
              heartbeatIntervalMs: 25000,
              maxControlFrameBytes: 65536,
              maxRelayFrameBytes: 1048576,
            },
          })
          expect(legacyAck.type).toBe('hello.ack')
          expect(acceptNegotiatedCapabilities(
            ['transport.relay', ATTENTION_SIGNAL_CAPABILITY],
            undefined,
          )).toEqual(['transport.relay'])
          expect(acceptNegotiatedCapabilities(
            ['transport.relay', ATTENTION_SIGNAL_CAPABILITY],
            ['transport.relay'],
          )).toEqual(['transport.relay'])
          expect(acceptNegotiatedCapabilities(
            ['transport.relay', ATTENTION_SIGNAL_CAPABILITY],
            ['transport.relay', ATTENTION_SIGNAL_CAPABILITY],
          )).toEqual(['transport.relay', ATTENTION_SIGNAL_CAPABILITY])
          expect(() => acceptNegotiatedCapabilities(
            ['transport.relay'],
            ['transport.relay', ATTENTION_SIGNAL_CAPABILITY],
          )).toThrow()
        },
      },
    ])
  })
})
