export const PDF_THUMBNAIL_MAX_CACHE = 60
export const PDF_THUMBNAIL_MAX_DATA_URL_CHARS = 65_536
const JPEG_DATA_URL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u

/** Validate thumbnail JPEG data URLs emitted from the sandboxed PDF WebView. */
export function isValidThumbnailDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string'
    && value.length > 0
    && value.length <= PDF_THUMBNAIL_MAX_DATA_URL_CHARS
    && JPEG_DATA_URL_RE.test(value)
  )
}

/** Bounded LRU cache for rendered PDF page thumbnails (1-based page keys). */
export class ThumbnailLruCache {
  private readonly entries = new Map<number, string>()

  constructor(private readonly maxEntries = PDF_THUMBNAIL_MAX_CACHE) {}

  get size(): number {
    return this.entries.size
  }

  has(page: number): boolean {
    return this.entries.has(page)
  }

  get(page: number): string | undefined {
    const value = this.entries.get(page)
    if (value === undefined) return undefined
    this.entries.delete(page)
    this.entries.set(page, value)
    return value
  }

  set(page: number, dataUrl: string): boolean {
    if (!Number.isSafeInteger(page) || page < 1 || !isValidThumbnailDataUrl(dataUrl)) {
      return false
    }
    this.entries.delete(page)
    this.entries.set(page, dataUrl)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return true
  }

  clear(): void {
    this.entries.clear()
  }
}
