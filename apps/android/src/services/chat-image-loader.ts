import type { ChatImage } from '../types'
import { imagePreviewMetadata } from './image-preview-metadata'
import { MAX_PREVIEW_BYTES } from './workspace-file-preview'

export type ChatImageLoader = (image: ChatImage, signal: AbortSignal) => Promise<string>

/**
 * Build the `session/attachment` reference from a chat image. The 0.2.2 Host
 * verifies media type, byte length and dimensions when supplied, and can
 * recover the rest from session events. Messages recorded before the full ref
 * was persisted may only carry the id; keep every field we do have instead of
 * dropping back to an id-only reference when one dimension is missing.
 */
export function chatImageAttachmentReference(image: ChatImage): Record<string, unknown> {
  const { attachmentId } = image
  if (attachmentId === undefined) return {}
  return {
    attachmentId,
    ...(typeof image.mediaType === 'string' ? { mediaType: image.mediaType } : {}),
    ...(typeof image.bytes === 'number' ? { bytes: image.bytes } : {}),
    ...(typeof image.width === 'number' ? { width: image.width } : {}),
    ...(typeof image.height === 'number' ? { height: image.height } : {}),
    ...(typeof image.name === 'string' ? { name: image.name } : {}),
  }
}

/** All Host reads stay on the captured authenticated connection. No URL fetching or disk cache. */
export function createChatImageLoader(sources: {
  sessionId: string
  assertCurrent: () => void
  attachment: (sessionId: string, attachment: ChatImage, signal: AbortSignal) => Promise<unknown>
  workspace: (path: string, signal: AbortSignal) => Promise<{ data: string; mimeType: string }>
}): ChatImageLoader {
  return async (image, signal) => {
    const active = () => {
      if (signal.aborted) throw Object.assign(new Error('Image loading cancelled'), { code: 'RPC_ABORTED' })
      sources.assertCurrent()
    }
    active()
    let uri: string
    if (image.uri?.startsWith('data:')) {
      uri = validatedImageDataUri(image.uri)
    } else if (image.attachmentId !== undefined) {
      const result = await sources.attachment(image.sessionId ?? sources.sessionId, image, signal)
      active()
      if (!record(result) || typeof result.data !== 'string') throw invalidImage()
      const echoed: Record<string, unknown> = record(result.attachment) ? result.attachment : {}
      // Only reject an explicit conflict with the supplied reference. Older
      // Hosts may echo just the id (or omit the verified fields entirely), so
      // an incomplete echo must not be treated as an invalid image.
      if (typeof echoed.attachmentId === 'string' && echoed.attachmentId !== image.attachmentId) throw invalidImage()
      if (image.bytes !== undefined && typeof echoed.bytes === 'number' && echoed.bytes !== image.bytes) throw invalidImage()
      if (image.width !== undefined && typeof echoed.width === 'number' && echoed.width !== image.width) throw invalidImage()
      if (image.height !== undefined && typeof echoed.height === 'number' && echoed.height !== image.height) throw invalidImage()
      const mediaType = typeof echoed.mediaType === 'string' ? echoed.mediaType
        : typeof image.mediaType === 'string' ? image.mediaType
          : typeof result.mediaType === 'string' ? result.mediaType : undefined
      if (mediaType === undefined) throw invalidImage()
      uri = validatedImageDataUri(`data:${mediaType};base64,${result.data}`)
    } else {
      const path = chatImageWorkspacePath(image.uri ?? '')
      if (path === undefined) throw invalidImage()
      const result = await sources.workspace(path, signal)
      active()
      uri = validatedImageDataUri(`data:${result.mimeType};base64,${result.data}`)
    }
    active()
    return uri
  }
}

/** Only Host paths; reject network/protocol-relative URLs, encoded schemes and NUL. */
export function chatImageWorkspacePath(value: string): string | undefined {
  try {
    let path = value.trim()
    if (path.startsWith('file://')) {
      const url = new URL(path)
      if (url.hostname !== '') return undefined
      path = decodeURIComponent(url.pathname)
      if (/^\/[A-Za-z]:\//u.test(path)) path = path.slice(1)
    } else path = decodeURIComponent(path.split(/[?#]/u, 1)[0] ?? '')
    if (path.length === 0 || path.length > 4096 || /[\u0000-\u001f]/u.test(path)
      || /^[\\/]{2}/u.test(path)
      || (/^[a-z][a-z\d+.-]*:/iu.test(path) && !/^[A-Za-z]:[\\/]/u.test(path))) return undefined
    return path
  } catch { return undefined }
}

/** Bound compressed bytes and decoded pixels before passing untrusted data to the native decoder. */
export function validatedImageDataUri(uri: string): string {
  if (uri.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 + 64) throw invalidImage()
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(uri)
  if (!match || match[2]!.length % 4 !== 0) throw invalidImage()
  let binary: string
  try { binary = atob(match[2]!) } catch { throw invalidImage() }
  if (binary.length > MAX_PREVIEW_BYTES || btoa(binary) !== match[2]) throw invalidImage()
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const metadata = imagePreviewMetadata(bytes)
  if (!metadata.ok || metadata.mimeType !== match[1]) throw invalidImage()
  return uri
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function invalidImage(): Error {
  return Object.assign(new Error('Image unavailable or outside preview limits'), { code: 'INVALID_IMAGE' })
}
