import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createRpcRequest } from '@dsh-remote/protocol'
import { compactHistory } from '../src/compact-history.js'
import { RpcRouter } from '../src/rpc-router.js'
import { CodexPeerBridge } from '../src/codex/peer-bridge.js'

const output = 'sensitive tool output '.repeat(4000)
const MARKER = '\n[Compact history: output omitted]'
const page = () => ({ cursor: 91, throughSeq: 91, hasMore: true, activeTurnId: 'turn-2', records: [
  { type: 'event', event: { type: 'user/message', seq: 40, data: { content: [{ type: 'text', text: output }] } } },
  { type: 'event', event: { type: 'tool/result', seq: 41, data: { callId: 'tool-1', turn: 2, failed: true, message: { source: { callId: 'tool-1' }, content: [{ type: 'tool-result', toolCallId: 'tool-1', isError: true, content: [{ type: 'text', text: output }] }] } } }, view: { for: 'result', view: { title: 'Read', output } } },
  { type: 'event', event: { type: 'turn/end', seq: 91, data: { reason: { kind: 'failed' } } } },
] })

// ds-bot writes one `{"replies":[...],"passed":N}` text per group round.
const groupReply = (text: string, name = 'Chief', time = 1) => ({ botId: 'session-1', name, colour: 'deepseek', text, time })
const groupRound = (replies: unknown[]) => JSON.stringify({ replies, passed: replies.length })
const groupRecord = (seq: number, content: unknown[]) => ({
  type: 'event',
  event: {
    type: 'tool/result', seq,
    data: {
      callId: `tool-${seq}`, turn: 2, name: 'group_relay',
      message: { source: { callId: `tool-${seq}` }, content },
    },
  },
  view: { for: 'result', view: { title: '群聊接力' } },
})
const groupResultRecord = (seq: number, text: string, isError = false) => groupRecord(seq, [
  { type: 'tool-result', toolCallId: `tool-${seq}`, ...(isError ? { isError: true } : {}), content: [{ type: 'text', text }] },
])
/** First text that reached the client inside one record's message content. */
const textIn = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textIn(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as { text?: unknown; content?: unknown }
  if (typeof record.text === 'string') return record.text
  return textIn(record.content)
}
const messageText = (record: unknown): string => textIn((record as { event: { data: { message: { content: unknown } } } }).event.data.message.content)!
/** Plain text block at one position of the message content array. */
const blockText = (record: unknown, index: number): string =>
  (record as { event: { data: { message: { content: { text: string }[] } } } }).event.data.message.content[index]!.text
const parsedRound = (text: string) => JSON.parse(text) as { replies: { name?: string; text?: string; kind?: string }[]; truncated?: boolean }

describe('compact history recovery contract', () => {
  it('preserves cursors, correlation, errors, text and lifecycle without mutating stored history', () => {
    const original = page(), snapshot = structuredClone(original)
    const result = compactHistory(original)
    expect(result).toMatchObject({ cursor: 91, throughSeq: 91, hasMore: true, activeTurnId: 'turn-2' })
    expect(result.records.map(row => row.event.seq)).toEqual([40, 41, 91])
    expect(result.records[0]).toEqual(original.records[0])
    expect(result.records[2]).toEqual(original.records[2])
    expect(result.records[1]).toMatchObject({ event: { data: { callId: 'tool-1', failed: true, message: { source: { callId: 'tool-1' }, content: [{ toolCallId: 'tool-1', isError: true }] } } } })
    expect(JSON.stringify(result.records[1]).length).toBeLessThan(2000)
    expect(original).toEqual(snapshot)
    const hiddenError = compactHistory({ type: 'tool/result', data: { message: { content: [
      { type: 'text', text: output }, { type: 'text', text: output },
      { type: 'text', text: output, isError: true },
      { type: 'tool-result', toolCallId: 'other-tool', isError: true, content: [{ type: 'text', text: output }] },
    ] } } })
    expect(hiddenError.data.message.content[0]).toMatchObject({ isError: true })
    expect(hiddenError.data.message.content.at(-1)).toMatchObject({ toolCallId: 'other-tool', isError: true })
  })

  it('isolates authenticated peer modes and restores complete responses when disabled', async () => {
    const source = page(), call = vi.fn(async () => source)
    const domain = { call, detachPeer: vi.fn(async () => undefined) }
    const a = new CodexPeerBridge(domain as never, { connectionId: 'a' } as never, async () => undefined)
    const b = new CodexPeerBridge(domain as never, { connectionId: 'b' } as never, async () => undefined)
    const router = new RpcRouter(128, undefined, undefined, undefined, undefined, a)
    const request = { method: 'dsh/sessionHistory', params: { threadId: 'thread' } }
    expect(await router.handle(createRpcRequest('remote.history.configure', { compact: true }))).toMatchObject({ type: 'rpc.response' })
    expect(await a.call(request)).toEqual(compactHistory(source))
    expect(await b.call(request)).toEqual(source)
    await router.handle(createRpcRequest('remote.history.configure', { compact: false }))
    expect(await a.call(request)).toEqual(source)
    expect(await router.handle(createRpcRequest('remote.history.configure', { compact: 'yes' }))).toMatchObject({ type: 'rpc.error' })
    expect(a.compactHistoryEnabled).toBe(false)
    expect(await a.call({ method: 'thread/read', params: { threadId: 'thread' } })).toEqual(source)
    await a.closeAll(); await b.closeAll()
  })
})

it('compacts Harness snapshots and older pages while forwarding live events unchanged', async () => {
  const { HarnessRemoteBridge } = await import('../src/harness-remote-bridge.js')
  const snapshot = { type: 'snapshot', ...page() }
  const live = page().records[1]
  const publish = vi.fn(async () => undefined)
  const gateway = {
    dispatch: vi.fn(async () => ({ ok: true, value: page() })),
    open: vi.fn(async () => (async function* () { yield snapshot; yield live })()),
    failure: () => ({ code: 'FAILED', message: '', details: {} }),
    supportsCarrier: true,
  }
  const bridge = new HarnessRemoteBridge(gateway as never, publish)
  bridge.compactHistoryEnabled = true
  expect(await bridge.call({ endpoint: 'session/page', payload: { args: {} } })).toEqual({ ok: true, value: compactHistory(page()) })
  await bridge.openStream({ streamId: 'follow', endpoint: 'session/follow', payload: { args: {} } })
  await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('harness.remote.stream.closed', { streamId: 'follow', reason: 'completed' }))
  expect(publish.mock.calls[0]).toEqual(['harness.remote.frame', { streamId: 'follow', hasValue: true, value: compactHistory(snapshot) }])
  expect(publish.mock.calls[1]).toEqual(['harness.remote.frame', { streamId: 'follow', hasValue: true, value: live }])
  await bridge.closeAll()
})

describe('compact group round preservation', () => {
  it('keeps completed group rounds readable in pages, snapshots and failed results', async () => {
    const longRound = groupRound([
      groupReply('甲'.repeat(500), 'Chief'),
      groupReply('乙'.repeat(500), 'Monitor'),
      { kind: 'user', text: '丙'.repeat(400), time: 3 },
    ])
    const pageWithRounds = (record: unknown) => ({ cursor: 7, throughSeq: 7, hasMore: false, records: [record] })
    const scenarios = [
      { name: 'session/page', wrap: (record: unknown) => pageWithRounds(record) },
      { name: 'session/follow snapshot', wrap: (record: unknown) => ({ type: 'snapshot', ...pageWithRounds(record) }) },
    ]
    for (const scenario of scenarios) {
      const result = compactHistory(scenario.wrap(groupResultRecord(2, longRound))) as { records: unknown[] }
      const text = messageText(result.records[0])
      const round = parsedRound(text)
      expect(round.replies.map(reply => reply.name ?? reply.kind)).toEqual(['Chief', 'Monitor', 'user'])
      expect(round.replies.map(reply => reply.text?.[0])).toEqual(['甲', '乙', '丙'])
      expect(round.truncated).toBeUndefined()
      expect(JSON.stringify(result).length).toBeLessThan(16 * 1024)
      // No storage mutation and idempotent re-projection.
      const source = scenario.wrap(groupResultRecord(2, longRound))
      const snapshot = structuredClone(source)
      const once = compactHistory(source)
      expect(source).toEqual(snapshot)
      expect(compactHistory(once)).toEqual(once)
    }

    const failed = compactHistory(pageWithRounds(groupResultRecord(3, longRound, true))) as { records: { event: { data: { message: { content: { isError?: boolean }[] } } } }[] }
    expect(failed.records[0]!.event.data.message.content[0]!.isError).toBe(true)
    expect(parsedRound(messageText(failed.records[0])).replies).toHaveLength(3)
  })

  it('keeps a round that falls outside the two-preview budget', () => {
    const record = groupRecord(4, [
      { type: 'text', text: 'first preview' },
      { type: 'text', text: 'second preview' },
      { type: 'text', text: groupRound([groupReply('丁'.repeat(400), 'Chief'), groupReply('戊'.repeat(400), 'Monitor')]) },
    ])
    const result = compactHistory({ cursor: 4, throughSeq: 4, hasMore: false, records: [record] }) as { records: unknown[] }
    const text = blockText(result.records[0], 2)
    expect(parsedRound(text).replies.map(reply => reply.name)).toEqual(['Chief', 'Monitor'])
  })

  it('bounds preserved round growth and keeps the truncation fallback for the rest', () => {
    const text = '己'.repeat(2000)
    const records = Array.from({ length: 40 }, (_, index) => groupResultRecord(index + 1, groupRound([
      groupReply(text, 'Chief', index), groupReply(text, 'Monitor', index),
      groupReply(text, 'Scribe', index), groupReply(text, 'Reviewer', index),
    ])))
    const result = compactHistory({ cursor: 40, throughSeq: 40, hasMore: true, records }) as { records: unknown[] }
    const texts = result.records.map(record => messageText(record))
    expect(JSON.stringify(result).length).toBeLessThan(200 * 1024)
    expect(texts.every(value => value.startsWith('{"replies"'))).toBe(true)
    const preserved = texts.filter(value => !value.endsWith(MARKER))
    const fallbacks = texts.filter(value => value.endsWith(MARKER))
    expect(preserved.length).toBeGreaterThan(5)
    expect(fallbacks.length).toBeGreaterThan(0)
    const first = parsedRound(preserved[0]!)
    expect(first.replies).toHaveLength(3)
    expect(first.truncated).toBe(true)
    expect(first.replies.every(reply => reply.text!.length === 2000)).toBe(true)
  })

  it('leaves ordinary and already truncated tool text on the 512-character fallback', () => {
    const cases: Array<{ name: string; text: string }> = [
      { name: 'ordinary output', text: output },
      { name: 'already truncated source', text: groupRound([groupReply('庚'.repeat(2000))]).slice(0, 600) },
    ]
    for (const row of cases) {
      const result = compactHistory({ cursor: 2, throughSeq: 2, hasMore: false, records: [groupResultRecord(8, row.text)] }) as { records: unknown[] }
      const text = messageText(result.records[0])
      expect(text).toBe(row.text.slice(0, 512) + MARKER)
      expect(JSON.stringify(result).length).toBeLessThan(2000)
    }
  })

  it('does not grow an empty replies array', () => {
    const empty = groupRound([])
    const result = compactHistory({ cursor: 2, throughSeq: 2, hasMore: false, records: [groupResultRecord(9, empty)] }) as { records: unknown[] }
    expect(messageText(result.records[0])).toBe(empty)
  })

  it('never truncates human user prompts containing literal <system-reminder> tags (with or without source metadata)', () => {
    const literalReminder = '<system-reminder>\n' + 'Human pasted prompt '.repeat(80) + '</system-reminder>'
    const cases = [
      { source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: literalReminder }] },
      { message: { role: 'user', source: { kind: 'user', requestId: 'req-1' }, content: [{ type: 'text', text: literalReminder }] } },
      { content: [{ type: 'text', text: literalReminder }] },
    ]
    for (const data of cases) {
      const projected = compactHistory({
        type: 'snapshot',
        records: [{ type: 'event', event: { type: 'user/message', seq: 1, time: 1, data } }],
      })
      const d = (projected.records[0]!.event as { data: Record<string, unknown> }).data
      const content = Array.isArray(d.content)
        ? d.content
        : ((d.message as { content: unknown[] }).content)
      expect((content[0] as { text: string }).text).toBe(literalReminder)
    }
  })

  it('projects a Session V3 snapshot fixture while preserving seq continuity, human attachments, model/usage metadata and final markdown', () => {
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/session-v3-snapshot.json')
    const rawJson = readFileSync(fixturePath, 'utf8')
    const rawSnapshot = JSON.parse(rawJson) as {
      type: string
      cursor: number
      throughSeq: number
      hasMore: boolean
      header: Record<string, unknown>
      assistantStream: Record<string, unknown>
      records: Array<{ type: string; event: Record<string, unknown> }>
    }
    const projected = compactHistory(rawSnapshot)

    expect(projected.cursor).toBe(rawSnapshot.cursor)
    expect(projected.throughSeq).toBe(rawSnapshot.throughSeq)
    expect(projected.hasMore).toBe(true)
    expect(projected.header).toEqual(rawSnapshot.header)
    expect(projected.assistantStream).toEqual(rawSnapshot.assistantStream)
    expect(projected.records.map(r => r.event.seq)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18])

    // Seq 11: human prompt with <system-reminder> literal + image attachment is 100% intact.
    expect(projected.records[1]).toEqual(rawSnapshot.records[1])

    // Seq 12: injected skill-catalog user/message drops source.entries and summarizes text.
    const injected = projected.records[2]!.event.data as { source: Record<string, unknown>; content: Array<{ text: string }> }
    expect(injected.source).toEqual({ kind: 'skill-catalog', form: 'catalog' })
    expect(injected.content[0]!.text).toContain(MARKER)

    // Seq 13: request/header keeps config, omits tools/system schemas.
    expect(projected.records[3]!.event.data).toEqual({
      reason: 'step',
      header: { config: { provider: 'openai', model: 'gpt-test', reasoningEffort: 'medium' } },
    })

    // Seq 14 & 17: assistant/message keeps usage, reasoning, surfaceOp, tool-call correlation, model, and full final markdown, while omitting stream & replayState.
    const step1 = projected.records[4]!.event as { surfaceOp: unknown; data: Record<string, unknown> }
    expect(step1.surfaceOp).toEqual({ op: 'append' })
    expect(step1.data).not.toHaveProperty('stream')
    expect(step1.data.usage).toEqual({ inputTokens: 4200, outputTokens: 350, cacheReadTokens: 3000 })
    const step1Msg = step1.data.message as { id: string; role: string; source: unknown; content: Array<Record<string, unknown>> }
    expect(step1Msg.source).toEqual({ kind: 'model', provider: 'openai', model: 'gpt-test' })
    expect(step1Msg.content[0]).toEqual({ type: 'reasoning', text: 'Checking workspace files' })
    expect(step1Msg.content[1]!.id).toBe('call_1')
    expect(step1Msg.content[1]!.name).toBe('run_code')
    expect(String(step1Msg.content[1]!.arguments)).toContain(MARKER)

    const step2 = projected.records[7]!.event.data as { message: { content: Array<{ text: string }>; source: unknown }; usage: unknown }
    expect(step2.message.content[0]!.text).toBe((rawSnapshot.records[7]!.event.data as typeof step2).message.content[0]!.text)
    expect(step2.message.source).toEqual({ kind: 'model', provider: 'openai', model: 'gpt-test' })
    expect(step2.usage).toEqual({ inputTokens: 4800, outputTokens: 180 })

    // Seq 15: tool/ptc-dispatch summarizes code & output while keeping callId.
    const ptc = projected.records[5]!.event.data as { callId: string; code: string; output: string }
    expect(ptc.callId).toBe('call_1')
    expect(ptc.code).toContain(MARKER)
    expect(ptc.output).toContain(MARKER)

    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(rawSnapshot).length * 0.2)
  })
})
