import { describe, expect, it, vi } from 'vitest'
import type { BotOperation } from '../src/services/bot-catalog'
import {
  base64ToBytes,
  bytesToBase64,
  downloadBotFileChunked,
  fetchBotImagePreview,
  stageBotFile,
  stageBotImage,
} from '../src/services/bot-media'

describe('bot media upload staging and chunked download', () => {
  it('roundtrips bytes through Hermes-safe base64 helpers', () => {
    const sample = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
    expect(Array.from(base64ToBytes(bytesToBase64(sample)))).toEqual(Array.from(sample))
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    expect(() => base64ToBytes('not!valid')).toThrow('Invalid base64 payload')
  })

  it('stages validated images and files and rejects invalid/oversized payloads locally', async () => {
    const call = vi.fn(async (endpoint: BotOperation) => ({ id: `${endpoint}-1` }))
    const client = { call }

    await expect(stageBotImage(client, { mediaType: 'image/svg+xml', data: 'AQID' })).rejects.toThrow('Unsupported image format')
    await expect(stageBotImage(client, { mediaType: 'image/png', data: bytesToBase64(new Uint8Array([1, 2, 3])), name: '../pic.png' })).resolves.toBe('stage-image-1')
    expect(call).toHaveBeenCalledWith('stage-image', {
      mediaType: 'image/png',
      data: 'AQID',
      name: 'pic.png',
    }, undefined)

    await expect(stageBotFile(client, { name: '..', data: 'AQID' })).rejects.toThrow('Invalid file name')
    await expect(stageBotFile(client, { name: 'notes.txt', data: bytesToBase64(new TextEncoder().encode('hello')) })).resolves.toBe('stage-file-1')
    expect(call).toHaveBeenLastCalledWith('stage-file', {
      name: 'notes.txt',
      data: 'aGVsbG8=',
    }, undefined)
  })

  it('assembles chunked 512 KiB downloads, verifies version consistency, and falls back to single-shot reads', async () => {
    const part1 = new TextEncoder().encode('hello ')
    const part2 = new TextEncoder().encode('world!')
    const chunkedCall = vi.fn(async (_endpoint: BotOperation, payload: Record<string, unknown> | null) => {
      if (payload?.offset === 0) {
        return {
          name: 'report.txt',
          mime: 'text/plain',
          size: part1.length + part2.length,
          version: 'v1',
          bytes: bytesToBase64(part1),
          nextOffset: part1.length,
          done: false,
        }
      }
      expect(payload?.version).toBe('v1')
      return {
        name: 'report.txt',
        mime: 'text/plain',
        size: part1.length + part2.length,
        version: 'v1',
        bytes: bytesToBase64(part2),
        nextOffset: part1.length + part2.length,
        done: true,
      }
    })
    const progress: Array<[number, number]> = []
    const assembled = await downloadBotFileChunked(
      { call: chunkedCall },
      { sessionId: 'bot-s1', seq: 42, index: 0 },
      { onProgress: (loaded, total) => progress.push([loaded, total]) },
    )
    expect(assembled.name).toBe('report.txt')
    expect(assembled.mime).toBe('text/plain')
    expect(assembled.size).toBe(12)
    expect(new TextDecoder().decode(assembled.bytes)).toBe('hello world!')
    expect(progress).toEqual([[6, 12], [12, 12]])

    // Version drift between chunks fails closed.
    const driftCall = vi.fn()
      .mockResolvedValueOnce({ name: 'a.bin', size: 10, version: 'v1', bytes: bytesToBase64(part1), nextOffset: 6, done: false })
      .mockResolvedValueOnce({ name: 'a.bin', size: 10, version: 'v2', bytes: bytesToBase64(part2), nextOffset: 12, done: true })
    await expect(downloadBotFileChunked({ call: driftCall }, { sessionId: 'bot-s1', attachmentId: 'att-1' })).rejects.toThrow('changed')

    // Non-chunked legacy fallback.
    const legacyCall = vi.fn(async () => ({
      name: 'legacy.txt',
      mime: 'text/plain',
      size: 5,
      bytes: bytesToBase64(new TextEncoder().encode('12345')),
    }))
    const legacy = await downloadBotFileChunked({ call: legacyCall }, { sessionId: 'bot-s1', attachmentId: 'att-1' }, { chunked: false })
    expect(new TextDecoder().decode(legacy.bytes)).toBe('12345')
  })

  it('fetches bounded image previews with data URI normalization', async () => {
    const call = vi.fn(async () => ({ mime: 'image/webp', data: bytesToBase64(new Uint8Array([9, 8, 7])) }))
    await expect(fetchBotImagePreview({ call }, { sessionId: 'bot-s1', attachmentId: 'img-1' })).resolves.toBe('data:image/webp;base64,CQgH')
    expect(call).toHaveBeenCalledWith('image', { sessionId: 'bot-s1', attachmentId: 'img-1', preview: true }, undefined)
  })
})
