import { describe, expect, it, vi } from 'vitest'
import {
  imageMediaType,
  sanitizeBase64,
  sessionImageLimits,
  sniffImageMediaType,
} from '../src/screens/chat-images'
import { foldHistory } from '../src/state/event-reducer'
import type { RemoteSession } from '../src/types'
import { HarnessAlphaClient } from '@dsh-remote/client-core'
import { clearAttachmentCache, resolveAttachmentUri } from '../src/services/attachment-cache'

describe('chat images and attachment preview (Issue #159)', () => {
  it('sniffs image media type from canonical base64 prefixes', () => {
    // PNG starts with iVBORw0KGgo
    expect(sniffImageMediaType('iVBORw0KGgoAAAANSUhEUgAA...')).toBe('image/png')
    // JPEG starts with /9j/
    expect(sniffImageMediaType('/9j/4AAQSkZJRgABAQEASABIAAD...')).toBe('image/jpeg')
    // GIF starts with R0lGOD
    expect(sniffImageMediaType('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')).toBe('image/gif')
    // WebP starts with UklGR
    expect(sniffImageMediaType('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v39gAA=')).toBe('image/webp')
    // Unknown prefix
    expect(sniffImageMediaType('AAAA...')).toBeUndefined()
  })

  it('sanitizes base64 strings by stripping whitespace, newlines, and data URI prefixes', () => {
    const raw = '  data:image/png;base64,\niVBORw0KGgo\r\nAAAANSUhEUgAA  '
    expect(sanitizeBase64(raw)).toBe('iVBORw0KGgoAAAANSUhEUgAA')
  })

  it('normalizes image/x-png and falls back to sniffing when extension is missing', () => {
    expect(imageMediaType('image/x-png', 'blob')).toBe('image/png')
    expect(imageMediaType(undefined, '1000000161', 'iVBORw0KGgoAAAANSUhEUgAA')).toBe('image/png')
    expect(imageMediaType('application/octet-stream', 'unknown', '/9j/4AAQSkZJRg==')).toBe('image/jpeg')
  })

  it('ensures sessionImageLimits falls back to safe default count when missing', () => {
    const session = {
      sessionId: 's1',
      title: 'test',
      running: false,
      projections: {
        values: {
          imageLimits: {
            maxImageBytes: 10485760,
            maxMessageImageBytes: 20971520,
            maxImagePixels: 40000000,
            maxImageDimension: 8192,
            mediaTypes: ['image/png', 'image/jpeg'],
          },
        },
      },
    } as unknown as RemoteSession
    const limits = sessionImageLimits(session)
    expect(limits).toBeDefined()
    expect(limits?.maxImagesPerMessage).toBe(4)
  })

  it('preserves images in assistant messages in foldHistory', () => {
    const events = [
      {
        event: {
          type: 'assistant/message' as const,
          seq: 10,
          time: 1000,
          data: {
            message: {
              id: 'ast-img-1',
              role: 'assistant',
              content: [
                {
                  type: 'image',
                  attachment: {
                    attachmentId: 'sha256:abcd1234',
                    mediaType: 'image/png',
                    width: 300,
                    height: 200,
                    name: 'result.png',
                  },
                },
                { type: 'text', text: 'Here is the generated chart.' },
              ],
            },
          },
        },
      },
    ]

    const items = foldHistory(events, 's1')
    expect(items).toHaveLength(1)
    const item = items[0]
    expect(item?.kind).toBe('message')
    if (item?.kind === 'message') {
      expect(item.role).toBe('assistant')
      expect(item.text).toBe('Here is the generated chart.')
      expect(item.images).toEqual([
        {
          attachmentId: 'sha256:abcd1234',
          sessionId: 's1',
          mediaType: 'image/png',
          width: 300,
          height: 200,
          name: 'result.png',
        },
      ])
    }
  })

  it('calls sessionAttachment via HarnessAlphaClient using slash notation', async () => {
    const core = {
      rpc: vi.fn(async (method: string, params: any) => {
        if (method === 'harness.remote.call' && params.endpoint === 'session/attachment') {
          return {
            ok: true,
            value: {
              attachment: { mediaType: 'image/png' },
              data: 'iVBORw0KGgo==',
            },
          }
        }
        return { ok: true, value: {} }
      }),
    }
    const client = new HarnessAlphaClient(core as any)
    const result = await client.sessionAttachment('s1', 'att-1')
    expect(result.data).toBe('iVBORw0KGgo==')
    expect(core.rpc).toHaveBeenCalledWith(
      'harness.remote.call',
      expect.objectContaining({
        endpoint: 'session/attachment',
        payload: {
          args: {
            request: { sessionId: 's1', attachmentId: 'att-1' },
          },
        },
      }),
      expect.anything(),
      undefined,
    )
  })

  it('resolves attachments with LRU caching and clearing', async () => {
    clearAttachmentCache()
    const mockFetcher = vi.fn().mockResolvedValue({
      attachment: { mediaType: 'image/jpeg' },
      data: '/9j/4AAQSkZJRg==',
    })

    const uri1 = await resolveAttachmentUri('s1', 'att-1', mockFetcher)
    expect(uri1).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==')
    expect(mockFetcher).toHaveBeenCalledTimes(1)

    // Second call for same key returns cached promise without invoking fetcher again
    const uri2 = await resolveAttachmentUri('s1', 'att-1', mockFetcher)
    expect(uri2).toBe(uri1)
    expect(mockFetcher).toHaveBeenCalledTimes(1)

    // After clearAttachmentCache, next call refetches
    clearAttachmentCache()
    await resolveAttachmentUri('s1', 'att-1', mockFetcher)
    expect(mockFetcher).toHaveBeenCalledTimes(2)
  })
})
