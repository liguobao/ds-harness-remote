import { isBotObject, object, text, type BotRemoteClient } from './bot-catalog'

export const BOT_STAGED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
export const BOT_STAGED_MAX_BYTES = 16 * 1024 * 1024
export const BOT_FILE_CHUNK_BYTES = 512 * 1024

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1)
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i
  }
  return table
})()

export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const hasB = i + 1 < bytes.length
    const hasC = i + 2 < bytes.length
    const b = hasB ? bytes[i + 1]! : 0
    const c = hasC ? bytes[i + 2]! : 0
    const triple = (a << 16) | (b << 8) | c
    out.push(
      BASE64_ALPHABET[(triple >> 18) & 63]!,
      BASE64_ALPHABET[(triple >> 12) & 63]!,
      hasB ? BASE64_ALPHABET[(triple >> 6) & 63]! : '=',
      hasC ? BASE64_ALPHABET[triple & 63]! : '=',
    )
  }
  return out.join('')
}

export function base64ToBytes(encoded: string): Uint8Array {
  const clean = encoded.replace(/\s+/g, '')
  if (clean.length === 0) return new Uint8Array(0)
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
    throw new Error('Invalid base64 payload')
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  const outLength = (clean.length / 4) * 3 - padding
  const out = new Uint8Array(outLength)
  let offset = 0
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = BASE64_LOOKUP[clean.charCodeAt(i)]!
    const c2 = BASE64_LOOKUP[clean.charCodeAt(i + 1)]!
    const c3 = clean[i + 2] === '=' ? 0 : BASE64_LOOKUP[clean.charCodeAt(i + 2)]!
    const c4 = clean[i + 3] === '=' ? 0 : BASE64_LOOKUP[clean.charCodeAt(i + 3)]!
    const triple = (c1 << 18) | (c2 << 12) | (c3 << 6) | c4
    if (offset < outLength) out[offset++] = (triple >> 16) & 0xff
    if (offset < outLength) out[offset++] = (triple >> 8) & 0xff
    if (offset < outLength) out[offset++] = triple & 0xff
  }
  return out
}

export function sanitizeBotFileName(raw: string | undefined, fallback = 'file'): string {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').replace(/[:*?"<>|]/g, '_').trim().slice(0, 200)
  return clean === '' || clean === '.' || clean === '..' ? fallback : clean
}

export async function stageBotImage(
  client: Pick<BotRemoteClient, 'call'>,
  params: { mediaType: string; data: string; name?: string },
  signal?: AbortSignal,
): Promise<string> {
  if (!BOT_STAGED_IMAGE_TYPES.has(params.mediaType)) {
    throw new Error('Unsupported image format for DS Bot')
  }
  const bytes = base64ToBytes(params.data)
  if (bytes.byteLength === 0 || bytes.byteLength > BOT_STAGED_MAX_BYTES) {
    throw new Error('Image exceeds the 16 MiB DS Bot limit')
  }
  const cleanName = params.name ? sanitizeBotFileName(params.name, '') : ''
  const result = object(await client.call('stage-image', {
    mediaType: params.mediaType,
    data: params.data,
    ...(cleanName ? { name: cleanName } : {}),
  }, signal))
  const id = text(result.id)
  if (!id) throw new Error('Host returned no staged image ID')
  return id
}

export async function stageBotFile(
  client: Pick<BotRemoteClient, 'call'>,
  params: { name: string; data: string },
  signal?: AbortSignal,
): Promise<string> {
  const cleanName = sanitizeBotFileName(params.name, '')
  if (!cleanName) throw new Error('Invalid file name')
  const bytes = base64ToBytes(params.data)
  if (bytes.byteLength > BOT_STAGED_MAX_BYTES) {
    throw new Error('File exceeds the 16 MiB DS Bot limit')
  }
  const result = object(await client.call('stage-file', {
    name: cleanName,
    data: params.data,
  }, signal))
  const id = text(result.id)
  if (!id) throw new Error('Host returned no staged file ID')
  return id
}

export interface BotFileDownloadTarget {
  sessionId: string
  attachmentId?: string
  seq?: number
  index?: number
  name?: string
}

export interface BotDownloadedFile {
  name: string
  mime: string
  size: number
  bytes: Uint8Array
}

function fileTargetPayload(target: BotFileDownloadTarget): Record<string, unknown> {
  const payload: Record<string, unknown> = { sessionId: target.sessionId }
  if (typeof target.attachmentId === 'string' && target.attachmentId.length > 0) {
    payload.attachmentId = target.attachmentId
  }
  if (typeof target.seq === 'number' && Number.isInteger(target.seq)) {
    payload.seq = target.seq
  }
  if (typeof target.index === 'number' && Number.isInteger(target.index)) {
    payload.index = target.index
  }
  return payload
}

export const BOT_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024
export const BOT_DOWNLOAD_MAX_CHUNKS = 256

function createAbortError(): Error {
  return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
}

export async function downloadBotFileChunked(
  client: Pick<BotRemoteClient, 'call'>,
  target: BotFileDownloadTarget,
  options?: {
    signal?: AbortSignal
    chunked?: boolean
    onProgress?: (loaded: number, total: number) => void
  },
): Promise<BotDownloadedFile> {
  if (options?.signal?.aborted) {
    throw createAbortError()
  }
  const basePayload = fileTargetPayload(target)
  const fallbackName = sanitizeBotFileName(target.name, 'download')
  if (options?.chunked !== true) {
    const raw = await client.call('file-download', basePayload, options?.signal)
    if (options?.signal?.aborted) {
      throw createAbortError()
    }
    if (!isBotObject(raw)) throw new Error('Invalid file download response')
    const bytes = base64ToBytes(text(raw.bytes))
    if (bytes.byteLength > BOT_DOWNLOAD_MAX_BYTES) {
      throw new Error('Delivered file exceeds maximum download size')
    }
    const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? raw.size : bytes.byteLength
    options?.onProgress?.(bytes.byteLength, size)
    return {
      name: sanitizeBotFileName(text(raw.name) || fallbackName, fallbackName),
      mime: text(raw.mime) || 'application/octet-stream',
      size,
      bytes,
    }
  }

  let offset = 0
  let lockedVersion: string | undefined
  let resolvedName = fallbackName
  let resolvedMime = 'application/octet-stream'
  let totalSize = 0
  const chunks: Uint8Array[] = []
  let loaded = 0
  let chunkCount = 0

  for (;;) {
    if (options?.signal?.aborted) {
      throw createAbortError()
    }
    if (++chunkCount > BOT_DOWNLOAD_MAX_CHUNKS) {
      throw new Error('Delivered file exceeded maximum chunk limit')
    }
    const raw = await client.call('file-download', {
      ...basePayload,
      offset,
      ...(lockedVersion !== undefined ? { version: lockedVersion } : {}),
    }, options?.signal)
    if (options?.signal?.aborted) {
      throw createAbortError()
    }
    if (!isBotObject(raw)) throw new Error('Invalid file download chunk')
    const chunkVersion = typeof raw.version === 'string' ? raw.version : undefined
    if (lockedVersion === undefined) {
      lockedVersion = chunkVersion
    } else if (chunkVersion !== undefined && chunkVersion !== lockedVersion) {
      throw new Error('Delivered file changed during download')
    }
    if (text(raw.name)) resolvedName = sanitizeBotFileName(text(raw.name), resolvedName)
    if (text(raw.mime)) resolvedMime = text(raw.mime)
    if (typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size >= 0) {
      if (raw.size > BOT_DOWNLOAD_MAX_BYTES) {
        throw new Error('Delivered file exceeds maximum download size')
      }
      totalSize = raw.size
    }
    const bytes = base64ToBytes(text(raw.bytes))
    if (loaded + bytes.byteLength > BOT_DOWNLOAD_MAX_BYTES) {
      throw new Error('Delivered file exceeds maximum download size')
    }
    if (bytes.byteLength > 0) {
      chunks.push(bytes)
      loaded += bytes.byteLength
    }
    options?.onProgress?.(loaded, totalSize || loaded)

    if (raw.done === true || (raw.done === undefined && typeof raw.nextOffset !== 'number')) break
    const nextOffset = typeof raw.nextOffset === 'number' && Number.isSafeInteger(raw.nextOffset)
      ? raw.nextOffset
      : offset + bytes.byteLength
    if (nextOffset <= offset || bytes.byteLength === 0) {
      throw new Error('Stalled chunked file download')
    }
    offset = nextOffset
  }

  const combined = new Uint8Array(loaded)
  let cursor = 0
  for (const part of chunks) {
    combined.set(part, cursor)
    cursor += part.byteLength
  }
  return {
    name: resolvedName,
    mime: resolvedMime,
    size: totalSize || loaded,
    bytes: combined,
  }
}

export async function fetchBotImagePreview(
  client: Pick<BotRemoteClient, 'call'>,
  params: { sessionId: string; attachmentId: string; preview?: boolean },
  signal?: AbortSignal,
): Promise<string | undefined> {
  const raw = await client.call('image', {
    sessionId: params.sessionId,
    attachmentId: params.attachmentId,
    preview: params.preview !== false,
  }, signal)
  if (!isBotObject(raw)) return undefined
  const direct = text(raw.image)
  if (direct.startsWith('data:image/')) return direct
  const data = text(raw.data)
  if (!data) return undefined
  const mime = text(raw.mime) || text(raw.mediaType) || 'image/png'
  return `data:${mime};base64,${data}`
}

export async function saveBotDownloadedFile(file: BotDownloadedFile): Promise<boolean> {
  const [{ Platform, Share }, { File: LocalFile, FileMode, Paths }, { StorageAccessFramework }] = await Promise.all([
    import('react-native'),
    import('expo-file-system'),
    import('expo-file-system/legacy'),
  ])
  const safeName = sanitizeBotFileName(file.name, 'download')
  if (Platform.OS === 'android') {
    const directory = await StorageAccessFramework.requestDirectoryPermissionsAsync()
    if (!directory.granted) return false
    const uri = await StorageAccessFramework.createFileAsync(
      directory.directoryUri,
      safeName,
      file.mime || 'application/octet-stream',
    )
    const handle = new LocalFile(uri).open(FileMode.Truncate)
    try {
      handle.writeBytes(file.bytes)
    } finally {
      handle.close()
    }
    return true
  }

  const temp = new LocalFile(Paths.cache, `bot-${Date.now()}-${safeName}`)
  const handle = temp.open(FileMode.Truncate)
  try {
    handle.writeBytes(file.bytes)
  } finally {
    handle.close()
  }
  try {
    await Share.share({ url: temp.uri, title: safeName })
    return true
  } finally {
    try {
      if (temp.exists) temp.delete()
    } catch {
      // Best-effort cleanup of share staging file.
    }
  }
}
