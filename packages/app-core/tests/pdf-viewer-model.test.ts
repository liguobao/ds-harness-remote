import { describe, expect, it } from 'vitest'
import {
  computeActivePageWindow,
  findPageAtScrollOffset,
} from '../scripts/pdf-viewport-math.js'
import {
  isValidThumbnailDataUrl,
  PDF_THUMBNAIL_MAX_DATA_URL_CHARS,
  ThumbnailLruCache,
} from '../src/screens/pdf-viewer-model'

describe('pdf-viewer-model', () => {
  it('bounds active page window across 207-page documents and tightens when zoomed > 1.5x', () => {
    expect(computeActivePageWindow(1, 207, 1)).toEqual({ start: 1, end: 3 })
    expect(computeActivePageWindow(2, 207, 1)).toEqual({ start: 1, end: 4 })
    expect(computeActivePageWindow(100, 207, 1)).toEqual({ start: 99, end: 102 })
    expect(computeActivePageWindow(100, 207, 2)).toEqual({ start: 99, end: 101 })
    expect(computeActivePageWindow(207, 207, 1)).toEqual({ start: 206, end: 207 })
  })

  it('locates current page with O(log N) binary search over WebView slot offsets', () => {
    const slots = [{ top: 12 }, { top: 524 }, { top: 1036 }, { top: 1848 }, { top: 2360 }]
    expect(findPageAtScrollOffset(0, slots)).toBe(1)
    expect(findPageAtScrollOffset(523, slots)).toBe(1)
    expect(findPageAtScrollOffset(524, slots)).toBe(2)
    expect(findPageAtScrollOffset(1600, slots)).toBe(3)
    expect(findPageAtScrollOffset(2500, slots)).toBe(5)
  })

  it('validates sandboxed thumbnail JPEG data URLs and enforces bounded LRU eviction', () => {
    const valid = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    expect(isValidThumbnailDataUrl(valid)).toBe(true)
    expect(isValidThumbnailDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isValidThumbnailDataUrl('https://evil.example/thumb.jpg')).toBe(false)
    expect(isValidThumbnailDataUrl(`data:image/jpeg;base64,${'A'.repeat(PDF_THUMBNAIL_MAX_DATA_URL_CHARS)}`)).toBe(false)

    const lru = new ThumbnailLruCache(3)
    expect(lru.set(1, valid)).toBe(true)
    expect(lru.set(2, valid)).toBe(true)
    expect(lru.set(3, valid)).toBe(true)
    expect(lru.get(1)).toBe(valid)
    expect(lru.set(4, valid)).toBe(true)
    expect(lru.has(1)).toBe(true)
    expect(lru.has(2)).toBe(false)
    expect(lru.has(3)).toBe(true)
    expect(lru.has(4)).toBe(true)
  })
})
