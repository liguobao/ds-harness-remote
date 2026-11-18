export const MAX_IMAGE_DIMENSION = 8192
export const MAX_IMAGE_PIXELS = 16_000_000

export type ImagePreviewMetadataResult =
  | { ok: true; mimeType: string; width: number; height: number }
  | { ok: false; reason: 'unsupported' }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'too-large'; mimeType: string; width: number; height: number }

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8])
const WEBP_IMAGE_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X'])
const MAX_JPEG_SEGMENTS = 512
const MAX_WEBP_CHUNKS = 32

/**
 * Compressed bytes can stay under the payload cap while still decoding into a
 * huge bitmap, so the pixel budget is enforced from the header before rendering.
 */
export function imagePreviewMetadata(bytes: Uint8Array): ImagePreviewMetadataResult {
  const mimeType = imageMagicMimeType(bytes)
  if (mimeType === undefined) return { ok: false, reason: 'unsupported' }
  const size = mimeType === 'image/png'
    ? pngSize(bytes)
    : mimeType === 'image/gif'
      ? gifSize(bytes)
      : mimeType === 'image/jpeg'
        ? jpegSize(bytes)
        : webpSize(bytes)
  if (size === undefined) return { ok: false, reason: 'invalid' }
  const [width, height] = size
  if (width <= 0 || height <= 0) return { ok: false, reason: 'invalid' }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    return { ok: false, reason: 'too-large', mimeType, width, height }
  }
  return { ok: true, mimeType, width, height }
}

function imageMagicMimeType(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png'
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.byteLength >= 6) {
    const signature = ascii(bytes, 0, 6)
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function pngSize(bytes: Uint8Array): [number, number] | undefined {
  if (bytes.byteLength < 24 || ascii(bytes, 12, 16) !== 'IHDR') return undefined
  return [readUint32BE(bytes, 16), readUint32BE(bytes, 20)]
}

function gifSize(bytes: Uint8Array): [number, number] | undefined {
  if (bytes.byteLength < 10) return undefined
  return [readUint16LE(bytes, 6), readUint16LE(bytes, 8)]
}

function jpegSize(bytes: Uint8Array): [number, number] | undefined {
  let offset = 2
  for (let segment = 0; segment < MAX_JPEG_SEGMENTS && offset + 4 <= bytes.byteLength; segment += 1) {
    if (bytes[offset] !== 0xff) return undefined
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset] as number
    offset += 1
    if (JPEG_STANDALONE_MARKERS.has(marker)) continue
    if (marker === 0xda || marker === 0xd9) return undefined
    const length = readUint16BE(bytes, offset)
    if (length < 2 || offset + length > bytes.byteLength) return undefined
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 7) return undefined
      return [readUint16BE(bytes, offset + 5), readUint16BE(bytes, offset + 3)]
    }
    offset += length
  }
  return undefined
}

function webpSize(bytes: Uint8Array): [number, number] | undefined {
  let offset = 12
  for (let chunk = 0; chunk < MAX_WEBP_CHUNKS && offset + 8 <= bytes.byteLength; chunk += 1) {
    const fourcc = ascii(bytes, offset, offset + 4)
    const size = readUint32LE(bytes, offset + 4)
    const payload = offset + 8
    if (size > bytes.byteLength - payload) return undefined
    if (WEBP_IMAGE_CHUNKS.has(fourcc)) {
      const dimensions = fourcc === 'VP8X'
        ? webpExtendedSize(bytes, payload, size)
        : fourcc === 'VP8L'
          ? webpLosslessSize(bytes, payload, size)
          : webpLossySize(bytes, payload, size)
      return dimensions
    }
    offset = payload + size + (size % 2)
  }
  return undefined
}

function webpLossySize(bytes: Uint8Array, payload: number, size: number): [number, number] | undefined {
  if (size < 10 || bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) return undefined
  return [readUint16LE(bytes, payload + 6) & 0x3fff, readUint16LE(bytes, payload + 8) & 0x3fff]
}

function webpLosslessSize(bytes: Uint8Array, payload: number, size: number): [number, number] | undefined {
  if (size < 5 || bytes[payload] !== 0x2f) return undefined
  const bits = readUint32LE(bytes, payload + 1)
  return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]
}

function webpExtendedSize(bytes: Uint8Array, payload: number, size: number): [number, number] | undefined {
  if (size < 10) return undefined
  return [readUint24LE(bytes, payload + 4) + 1, readUint24LE(bytes, payload + 7) + 1]
}

function startsWith(bytes: Uint8Array, pattern: readonly number[]): boolean {
  if (bytes.byteLength < pattern.length) return false
  for (let index = 0; index < pattern.length; index += 1) {
    if (bytes[index] !== pattern[index]) return false
  }
  return true
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = ''
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index] as number)
  return value
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8)
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8) | ((bytes[offset + 2] as number) << 16)
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number)
    | ((bytes[offset + 1] as number) << 8)
    | ((bytes[offset + 2] as number) << 16)
    | ((bytes[offset + 3] as number) << 24)) >>> 0
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] as number) << 24)
    | ((bytes[offset + 1] as number) << 16)
    | ((bytes[offset + 2] as number) << 8)
    | (bytes[offset + 3] as number)) >>> 0
}
