const MAX_ATTACHMENT_CACHE_ENTRIES = 50
const attachmentMemoryCache = new Map<string, Promise<string>>()

export function clearAttachmentCache(): void {
  attachmentMemoryCache.clear()
}

export type AttachmentFetcher = (
  sessionId: string,
  attachmentId: string,
) => Promise<{ attachment: unknown; data: string }>

export function resolveAttachmentUri(
  sessionId: string,
  attachmentId: string,
  fetcher?: AttachmentFetcher,
): Promise<string> {
  const key = `${sessionId}:${attachmentId}`
  const existing = attachmentMemoryCache.get(key)
  if (existing !== undefined) {
    attachmentMemoryCache.delete(key)
    attachmentMemoryCache.set(key, existing)
    return existing
  }
  const pending = (async () => {
    let result: { attachment: unknown; data: string }
    if (fetcher) {
      result = await fetcher(sessionId, attachmentId)
    } else {
      const { requireProxy } = await import('../state/store')
      const proxy = requireProxy()
      result = await proxy.sessionAttachment(sessionId, attachmentId)
    }
    const attachment = result.attachment as { mediaType?: string; width?: number; height?: number } | undefined
    const mediaType = typeof attachment?.mediaType === 'string' ? attachment.mediaType : 'image/png'
    const data = result.data
    if (!data || data.length === 0) throw new Error('empty-attachment')
    return data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`
  })()
  if (attachmentMemoryCache.size >= MAX_ATTACHMENT_CACHE_ENTRIES) {
    const oldestKey = attachmentMemoryCache.keys().next().value
    if (oldestKey !== undefined) attachmentMemoryCache.delete(oldestKey)
  }
  attachmentMemoryCache.set(key, pending)
  pending.catch(() => {
    attachmentMemoryCache.delete(key)
  })
  return pending
}
