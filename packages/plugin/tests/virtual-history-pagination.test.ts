import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  createRpcResponse,
  encodeMessage,
  MAX_SECURE_MESSAGE_BYTES,
  SecureMessageCodec,
} from '@dsh-remote/protocol'
import { describe, expect, it } from 'vitest'
import {
  selectVirtualHistorySlice,
  utf8JsonByteLength,
  VIRTUAL_HISTORY_HARD_MAX_BYTES,
  VIRTUAL_HISTORY_MAX_BYTES,
  VIRTUAL_HISTORY_RPC_ENVELOPE_RESERVE_BYTES,
  VirtualHistoryResponseTooLargeError,
} from '../src/virtual-history-pagination.js'

interface TestEntry {
  type: 'event'
  event: {
    type: string
    seq: number
    time: number
    data: Record<string, unknown>
    surfaceOp?: 'append'
    sourceEventSeqs?: number[]
  }
  view?: Record<string, unknown>
}

function makeTextEntry(seq: number, text: string): TestEntry {
  return {
    type: 'event',
    event: {
      type: 'assistant/message',
      seq,
      time: 1_700_000_000 + seq,
      surfaceOp: 'append',
      data: {
        turn: seq + 1,
        step: 1,
        message: {
          id: `msg-${seq}`,
          role: 'assistant',
          source: { kind: 'model', provider: 'test', model: 'm1' },
          content: [{ type: 'text', text }],
        },
      },
    },
  }
}

describe('virtual-history-pagination transport hard cap', () => {
  it('enforces the 4 MiB secure-channel hard ceiling across verbatim, progressive compaction, and fail-closed boundaries', async () => {
    expect(VIRTUAL_HISTORY_HARD_MAX_BYTES).toBe(
      MAX_SECURE_MESSAGE_BYTES - VIRTUAL_HISTORY_RPC_ENVELOPE_RESERVE_BYTES,
    )

    await runScenarios([
      {
        name: 'passes a single newest record in (256 KiB, 3.75 MiB] verbatim without compaction',
        run: () => {
          const older = makeTextEntry(0, 'older reply')
          const midSized = makeTextEntry(1, 'm'.repeat(512 * 1024))
          expect(utf8JsonByteLength(midSized)).toBeGreaterThan(VIRTUAL_HISTORY_MAX_BYTES)
          expect(utf8JsonByteLength(midSized)).toBeLessThanOrEqual(VIRTUAL_HISTORY_HARD_MAX_BYTES)

          const slice = selectVirtualHistorySlice([older, midSized])
          expect(slice.records).toHaveLength(1)
          expect(slice.records[0]).toBe(midSized)
          expect(slice.records[0]!.event.data.truncated).toBeUndefined()
          expect(slice.hasMore).toBe(true)
          expect(slice.cutIndex).toBe(1)
        },
      },
      {
        name: 'compacts a >4 MiB newest record with huge image + text without mutating source and preserves cursor pagination',
        run: () => {
          const older = [makeTextEntry(0, 'first'), makeTextEntry(1, 'second')]
          const hugeImageBase64 = 'A'.repeat(4 * 1024 * 1024)
          const emojiPrefix = '😀'.repeat(20_000)
          const hugeText = `${emojiPrefix}${'x'.repeat(4 * 1024 * 1024)}`
          const attachmentMeta = {
            attachmentId: 'img-att-1',
            mediaType: 'image/png',
            bytes: 3 * 1024 * 1024,
            width: 1024,
            height: 768,
          }
          const oversized: TestEntry = {
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: 2,
              time: 1_700_000_002,
              surfaceOp: 'append',
              sourceEventSeqs: [2],
              data: {
                turn: 2,
                step: 1,
                message: {
                  id: 'msg-giant',
                  role: 'assistant',
                  source: { kind: 'model', provider: 'codex', model: 'gpt-5' },
                  content: [
                    { type: 'text', text: hugeText },
                    {
                      type: 'image',
                      attachment: attachmentMeta,
                      mediaType: 'image/png',
                      data: hugeImageBase64,
                      url: `data:image/png;base64,${hugeImageBase64}`,
                    },
                  ],
                },
              },
            },
          }

          expect(utf8JsonByteLength(oversized)).toBeGreaterThan(MAX_SECURE_MESSAGE_BYTES)

          const window = [...older, oversized]
          const envelopeBytes = 1024
          const slice = selectVirtualHistorySlice(window, { envelopeBytes })
          expect(slice.records).toHaveLength(1)
          expect(slice.hasMore).toBe(true)
          expect(slice.cutIndex).toBe(2)

          const compacted = slice.records[0]!
          expect(compacted).not.toBe(oversized)
          expect(compacted.event.seq).toBe(2)
          expect(compacted.event.type).toBe('assistant/message')
          expect(compacted.event.surfaceOp).toBe('append')
          expect(compacted.event.sourceEventSeqs).toEqual([2])
          expect(compacted.event.data.truncated).toBe(true)
          expect(utf8JsonByteLength(compacted) + envelopeBytes).toBeLessThanOrEqual(VIRTUAL_HISTORY_HARD_MAX_BYTES)

          const rpcFrame = encodeMessage(createRpcResponse('req-oversized', {
            records: slice.records,
            hasMore: slice.hasMore,
            cursor: 2,
          }))
          expect(rpcFrame.byteLength).toBeLessThanOrEqual(MAX_SECURE_MESSAGE_BYTES)
          expect(() => new SecureMessageCodec().encode(rpcFrame)).not.toThrow()

          const compactedMessage = compacted.event.data.message as {
            id: string
            role: string
            source: Record<string, unknown>
            content: Array<Record<string, unknown>>
          }
          expect(compactedMessage.id).toBe('msg-giant')
          expect(compactedMessage.role).toBe('assistant')
          expect(compactedMessage.source).toEqual({ kind: 'model', provider: 'codex', model: 'gpt-5' })
          const compactedText = String(compactedMessage.content[0]!.text)
          expect(compactedText).toContain('[History record truncated to fit transport limit]')
          // Surrogate pairs must never be split into lone surrogates.
          expect(compactedText.match(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)).toBeNull()
          expect(compactedMessage.content[1]).toMatchObject({
            type: 'image',
            attachment: attachmentMeta,
            truncated: true,
          })
          expect(compactedMessage.content[1]!.data).toBeUndefined()
          expect(compactedMessage.content[1]!.url).toBeUndefined()

          // Original source object must remain completely unmutated.
          const originalMessage = oversized.event.data.message as {
            content: Array<Record<string, unknown>>
          }
          expect(oversized.event.data.truncated).toBeUndefined()
          expect(originalMessage.content[0]!.text).toBe(hugeText)
          expect(originalMessage.content[1]!.data).toBe(hugeImageBase64)
          expect(originalMessage.content[1]!.url).toBe(`data:image/png;base64,${hugeImageBase64}`)

          // Cursor advances cleanly to older records using beforeSeq = compacted.event.seq.
          const olderWindow = window.filter(entry => entry.event.seq < compacted.event.seq)
          const nextPage = selectVirtualHistorySlice(olderWindow)
          expect(nextPage.records.map(entry => entry.event.seq)).toEqual([0, 1])
          expect(nextPage.hasMore).toBe(false)
        },
      },
      {
        name: 'caps oversized arrays (>32 items) while preserving isError and falls back to Stage C stub for huge key maps',
        run: () => {
          const manyBlocks = Array.from({ length: 60 }, (_, idx) => ({
            type: 'tool-result',
            toolCallId: `tc-${idx}`,
            content: [{ type: 'text', text: 'y'.repeat(100 * 1024) }],
            ...(idx === 55 ? { isError: true } : {}),
          }))
          const arrayHeavy: TestEntry = {
            type: 'event',
            event: {
              type: 'tool/result',
              seq: 10,
              time: 1_700_000_010,
              surfaceOp: 'append',
              data: {
                turn: 3,
                step: 1,
                message: {
                  id: 'tool-many',
                  role: 'user',
                  content: manyBlocks,
                },
              },
            },
          }
          expect(utf8JsonByteLength(arrayHeavy)).toBeGreaterThan(MAX_SECURE_MESSAGE_BYTES)
          const arraySlice = selectVirtualHistorySlice([arrayHeavy])
          expect(arraySlice.records).toHaveLength(1)
          const cappedContent = (arraySlice.records[0]!.event.data.message as { content: Array<Record<string, unknown>> }).content
          expect(cappedContent).toHaveLength(33)
          expect(cappedContent.at(-1)).toMatchObject({
            truncated: true,
            isError: true,
          })
          expect(utf8JsonByteLength(arraySlice.records[0])).toBeLessThanOrEqual(VIRTUAL_HISTORY_HARD_MAX_BYTES)
          expect(manyBlocks).toHaveLength(60)

          // Huge wide-key object that cannot fit Stage B falls back to Stage C minimal stub.
          const widePayload: Record<string, string> = {}
          for (let i = 0; i < 20_000; i += 1) {
            widePayload[`k_${i}`] = 'v'.repeat(220)
          }
          const wideEntry: TestEntry = {
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: 11,
              time: 1_700_000_011,
              surfaceOp: 'append',
              data: {
                turn: 4,
                step: 1,
                message: {
                  id: 'wide-msg',
                  role: 'assistant',
                  source: { kind: 'model', provider: 'test' },
                  content: [{ type: 'text', text: 'preview' }],
                },
                widePayload,
              },
            },
          }
          expect(utf8JsonByteLength(wideEntry)).toBeGreaterThan(MAX_SECURE_MESSAGE_BYTES)
          const wideSlice = selectVirtualHistorySlice([wideEntry])
          expect(wideSlice.records).toHaveLength(1)
          expect(utf8JsonByteLength(wideSlice.records[0])).toBeLessThanOrEqual(VIRTUAL_HISTORY_HARD_MAX_BYTES)
          expect(wideSlice.records[0]!.event.data).toMatchObject({
            turn: 4,
            step: 1,
            truncated: true,
            message: {
              id: 'wide-msg',
              role: 'assistant',
              content: [{ type: 'text', text: '[History record omitted: exceeds transport size limit]' }],
            },
          })
        },
      },
      {
        name: 'throws non-retryable VirtualHistoryResponseTooLargeError when envelope or un-trimmable metadata exceeds hardMaxBytes',
        run: () => {
          const normal = makeTextEntry(0, 'small')
          let envelopeError: unknown
          try {
            selectVirtualHistorySlice([normal], {
              envelopeBytes: VIRTUAL_HISTORY_HARD_MAX_BYTES,
            })
          } catch (error) {
            envelopeError = error
          }
          expect(envelopeError).toBeInstanceOf(VirtualHistoryResponseTooLargeError)
          expect(envelopeError).toMatchObject({
            code: 'RESPONSE_TOO_LARGE',
            retryable: false,
            maxBytes: VIRTUAL_HISTORY_HARD_MAX_BYTES,
          })
          expect((envelopeError as VirtualHistoryResponseTooLargeError).actualBytes).toBeGreaterThan(
            VIRTUAL_HISTORY_HARD_MAX_BYTES,
          )

          const unTrimmable: TestEntry = {
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: 1,
              time: 1_700_000_001,
              data: {
                id: 'i'.repeat(MAX_SECURE_MESSAGE_BYTES),
                role: 'assistant',
              },
            },
          }
          let metadataError: unknown
          try {
            selectVirtualHistorySlice([unTrimmable])
          } catch (error) {
            metadataError = error
          }
          expect(metadataError).toBeInstanceOf(VirtualHistoryResponseTooLargeError)
          expect(metadataError).toMatchObject({
            code: 'RESPONSE_TOO_LARGE',
            retryable: false,
          })
        },
      },
      {
        name: 'handles 4,000-deep >4 MiB nested payloads without RangeError and strips own __proto__ keys safely',
        run: () => {
          // (a) 4,000-deep valid nested object whose serialized size exceeds 4 MiB.
          let deepLeaf: Record<string, unknown> = { leaf: 'd'.repeat(4 * 1024 * 1024 + 1024) }
          for (let depth = 0; depth < 4000; depth += 1) {
            deepLeaf = { next: deepLeaf }
          }
          const older = makeTextEntry(0, 'older entry')
          const deepEntry: TestEntry = {
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: 1,
              time: 1_700_000_001,
              surfaceOp: 'append',
              data: {
                turn: 2,
                step: 1,
                nested: deepLeaf,
              },
            },
          }
          expect(utf8JsonByteLength(deepEntry)).toBeGreaterThan(MAX_SECURE_MESSAGE_BYTES)
          const deepSlice = selectVirtualHistorySlice([older, deepEntry])
          expect(deepSlice.records).toHaveLength(1)
          expect(deepSlice.records[0]!.event.seq).toBe(1)
          expect(deepSlice.hasMore).toBe(true)
          expect(utf8JsonByteLength(deepSlice.records[0])).toBeLessThanOrEqual(VIRTUAL_HISTORY_HARD_MAX_BYTES)
          expect(deepSlice.records[0]!.event.data.truncated).toBe(true)

          // (b) JSON.parse with own "__proto__" key inside oversized >4 MiB image + text record.
          const poisonedImage = JSON.parse(
            `{"type":"image","__proto__":{"polluted":true},"mediaType":"image/png","data":"${'A'.repeat(4 * 1024 * 1024 + 1024)}","attachment":{"attachmentId":"att-proto","mediaType":"image/png","bytes":3000000,"width":100,"height":100}}`,
          ) as Record<string, unknown>
          const poisonedData = JSON.parse(
            `{"turn":3,"step":1,"__proto__":{"polluted":true},"payload":"${'p'.repeat(4 * 1024 * 1024 + 1024)}"}`,
          ) as Record<string, unknown>
          poisonedData.image = poisonedImage

          const protoEntry: TestEntry = {
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: 2,
              time: 1_700_000_002,
              surfaceOp: 'append',
              data: poisonedData,
            },
          }
          const protoSlice = selectVirtualHistorySlice([older, protoEntry])
          expect(protoSlice.records).toHaveLength(1)
          const compactedData = protoSlice.records[0]!.event.data
          expect(Object.getPrototypeOf(compactedData)).toBe(Object.prototype)
          expect(Object.hasOwn(compactedData, '__proto__')).toBe(false)
          expect((compactedData as { polluted?: unknown }).polluted).toBeUndefined()
          const compactedImg = compactedData.image as Record<string, unknown>
          expect(Object.getPrototypeOf(compactedImg)).toBe(Object.prototype)
          expect(Object.hasOwn(compactedImg, '__proto__')).toBe(false)
          expect((compactedImg as { polluted?: unknown }).polluted).toBeUndefined()
          expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
          expect(utf8JsonByteLength(protoSlice.records[0])).toBeLessThanOrEqual(VIRTUAL_HISTORY_HARD_MAX_BYTES)
        },
      },
      {
        name: 'extends surface-message windows past tool-only streaks to include dialogue prose and compacts oversized tool outputs inside the 256 KiB page without splitting tool call/result pairs',
        run: () => {
          const events: TestEntry[] = []
          let seq = 0
          events.push({
            type: 'event',
            event: {
              type: 'user/message',
              seq: seq++,
              time: 1000,
              surfaceOp: 'append',
              data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: 'Investigate the bug' }] },
            },
          })
          events.push({
            type: 'event',
            event: {
              type: 'assistant/message',
              seq: seq++,
              time: 1001,
              surfaceOp: 'append',
              data: {
                turn: 1,
                step: 1,
                message: {
                  id: 'a-1',
                  role: 'assistant',
                  source: { kind: 'model', provider: 'test', model: 'm1' },
                  content: [{ type: 'text', text: 'Let me check the files.' }],
                },
              },
            },
          })
          // 22 tool calls interspersed with reasoning-only assistant steps, several with 90 KiB outputs (>256 KiB total uncompacted).
          for (let toolIdx = 1; toolIdx <= 22; toolIdx += 1) {
            if (toolIdx % 4 === 0) {
              events.push({
                type: 'event',
                event: {
                  type: 'assistant/message',
                  seq: seq++,
                  time: 1001 + toolIdx,
                  surfaceOp: 'append',
                  data: {
                    turn: 1,
                    step: toolIdx,
                    message: {
                      id: `a-reason-${toolIdx}`,
                      role: 'assistant',
                      source: { kind: 'model', provider: 'test', model: 'm1' },
                      content: [{ type: 'reasoning', text: `Thinking before tool ${toolIdx}` }],
                    },
                  },
                },
              })
            }
            const callSeq = seq++
            events.push({
              type: 'event',
              event: {
                type: 'tool/call',
                seq: callSeq,
                time: 1001 + toolIdx,
                data: { turn: 1, step: toolIdx, callId: `tc-${toolIdx}`, name: 'read_file', arguments: '{}' },
              },
            })
            const bigResult = toolIdx >= 18 ? 'R'.repeat(90 * 1024) : `small-${toolIdx}`
            events.push({
              type: 'event',
              event: {
                type: 'tool/result',
                seq: seq++,
                time: 1001 + toolIdx,
                surfaceOp: 'append',
                sourceEventSeqs: [callSeq],
                data: {
                  turn: 1,
                  step: toolIdx,
                  message: {
                    id: `tr-${toolIdx}`,
                    role: 'user',
                    content: [{ type: 'tool-result', toolCallId: `tc-${toolIdx}`, content: [{ type: 'text', text: bigResult }] }],
                  },
                },
              },
            })
          }

          // Initial open (maxMessages: 16, countSurfaceMessages: true) extends past the 22 tool calls
          // to include both a-1 and u-1, and compacts the five 90 KiB tool outputs to fit inside 256 KiB.
          const slice = selectVirtualHistorySlice(events, {
            maxMessages: 16,
            countSurfaceMessages: true,
          })
          expect(slice.hasMore).toBe(false)
          expect(slice.records[0]!.event.type).toBe('user/message')
          expect(slice.records[1]!.event.type).toBe('assistant/message')
          const totalSliceBytes = slice.records.reduce((sum, item) => sum + utf8JsonByteLength(item), 0)
          expect(totalSliceBytes).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)
          // Source events remain unmutated.
          const lastSourceResult = events.at(-1)!.event.data.message as { content: Array<{ content: Array<{ text: string }> }> }
          expect(lastSourceResult.content[0]!.content[0]!.text).toHaveLength(90 * 1024)

          // When byte budget forces a cut across a tool pair, advancePastIncompleteSourceDependencies
          // never leaves an orphaned tool/result without its tool/call at the head of the slice.
          const tightSlice = selectVirtualHistorySlice(events, {
            maxMessages: 60,
            countSurfaceMessages: true,
            maxBytes: 10 * 1024,
          })
          expect(tightSlice.hasMore).toBe(true)
          const minIncludedSeq = tightSlice.records[0]!.event.seq
          for (const rec of tightSlice.records) {
            for (const depSeq of rec.event.sourceEventSeqs ?? []) {
              expect(depSeq).toBeGreaterThanOrEqual(minIncludedSeq)
            }
          }
        },
      },
    ])
  })
})
