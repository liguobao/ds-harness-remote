import { describe, expect, it, vi } from 'vitest'
import type { HarnessSessionTools } from '../src/services/session-tools'
import { imagePreviewMetadata, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from '../src/services/image-preview-metadata'
import {
  classifyWorkspaceFile,
  loadWorkspacePreview,
  MAX_MISSING_FONTS,
  MAX_OFFICE_SOURCE_BYTES,
  MAX_PREVIEW_BYTES,
  PREVIEW_CHUNK_BYTES,
  WORKSPACE_PREVIEW_CHANGED,
  WORKSPACE_PREVIEW_INVALID,
  WORKSPACE_PREVIEW_TOO_LARGE,
  WORKSPACE_PREVIEW_UNSUPPORTED,
} from '../src/services/workspace-file-preview'

const IMAGE_PATH = 'assets/logo.png'
const IMAGE_ABSOLUTE = '/workspace/assets/logo.png'
const DOC_PATH = 'docs/report.docx'
const DOC_ABSOLUTE = '/workspace/docs/report.docx'
const VERSION = 'v1'
const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')
const encoder = new TextEncoder()

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

function writeUint16LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function writeUint16BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function writeUint24LE(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
}

function png(width: number, height: number, tail = 0): Uint8Array {
  const bytes = new Uint8Array(24 + tail)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
  writeUint32BE(bytes, 16, width)
  writeUint32BE(bytes, 20, height)
  bytes.fill(7, 24)
  return bytes
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13)
  bytes.set(encoder.encode('GIF89a'))
  writeUint16LE(bytes, 6, width)
  writeUint16LE(bytes, 8, height)
  return bytes
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08])
  writeUint16BE(bytes, 7, height)
  writeUint16BE(bytes, 9, width)
  return bytes
}

function webp(width: number, height: number, flavor: 'lossy' | 'lossless' | 'extended' = 'lossy'): Uint8Array {
  const bytes = new Uint8Array(flavor === 'lossless' ? 25 : 30)
  bytes.set(encoder.encode('RIFF'))
  writeUint32LE(bytes, 4, bytes.byteLength - 8)
  bytes.set(encoder.encode('WEBP'), 8)
  if (flavor === 'lossy') {
    bytes.set(encoder.encode('VP8 '), 12)
    writeUint32LE(bytes, 16, 10)
    bytes.set([0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a], 20)
    writeUint16LE(bytes, 26, width)
    writeUint16LE(bytes, 28, height)
  } else if (flavor === 'lossless') {
    bytes.set(encoder.encode('VP8L'), 12)
    writeUint32LE(bytes, 16, 5)
    bytes[20] = 0x2f
    writeUint32LE(bytes, 21, (((height - 1) << 14) | (width - 1)) >>> 0)
  } else {
    bytes.set(encoder.encode('VP8X'), 12)
    writeUint32LE(bytes, 16, 10)
    writeUint24LE(bytes, 24, width - 1)
    writeUint24LE(bytes, 27, height - 1)
  }
  return bytes
}

function fakeTools() {
  const mocks = {
    statFile: vi.fn(),
    readBytes: vi.fn(),
    officeGeneration: vi.fn(),
    renderOfficePdf: vi.fn(),
  }
  return { mocks, tools: mocks as unknown as HarnessSessionTools }
}

function stat(overrides: Record<string, unknown> = {}) {
  return { absolutePath: IMAGE_ABSOLUTE, version: VERSION, ...overrides }
}

function chunk(data: Uint8Array, offset: number, eof: boolean, overrides: Record<string, unknown> = {}) {
  return { absolutePath: IMAGE_ABSOLUTE, version: VERSION, offset, data: base64(data), eof, ...overrides }
}

function imageTools(image: Uint8Array, overrides: Record<string, unknown> = {}) {
  const fixture = fakeTools()
  fixture.mocks.statFile.mockResolvedValue(stat({ bytes: image.byteLength, ...overrides }))
  fixture.mocks.readBytes.mockImplementation(async (_session, _path, offset) =>
    chunk(image.subarray(offset as number), offset as number, true, { bytes: image.byteLength }))
  return fixture
}

describe('workspace file classification', () => {
  it('routes known extensions and keeps unknown ones unsupported', () => {
    expect(classifyWorkspaceFile(IMAGE_PATH)).toBe('image')
    expect(classifyWorkspaceFile('assets/photo.JPEG')).toBe('image')
    expect(classifyWorkspaceFile('docs/report.pdf')).toBe('pdf')
    expect(classifyWorkspaceFile(DOC_PATH)).toBe('office')
    expect(classifyWorkspaceFile('docs/report.docm')).toBe('unsupported')
    expect(classifyWorkspaceFile('src/main.ts')).toBe('text')
    expect(classifyWorkspaceFile('Dockerfile')).toBe('text')
    expect(classifyWorkspaceFile('assets/logo.svg')).toBe('text')
    expect(classifyWorkspaceFile('index.html')).toBe('text')
    expect(classifyWorkspaceFile('assets/photo.bmp')).toBe('unsupported')
    expect(classifyWorkspaceFile('archive')).toBe('unsupported')
  })
})

describe('image preview metadata', () => {
  it('reads the smallest reliable headers for each supported format', () => {
    expect(imagePreviewMetadata(png(640, 480))).toEqual({ ok: true, mimeType: 'image/png', width: 640, height: 480 })
    expect(imagePreviewMetadata(gif(640, 480))).toEqual({ ok: true, mimeType: 'image/gif', width: 640, height: 480 })
    expect(imagePreviewMetadata(jpeg(640, 480))).toEqual({ ok: true, mimeType: 'image/jpeg', width: 640, height: 480 })
    expect(imagePreviewMetadata(webp(640, 480))).toEqual({ ok: true, mimeType: 'image/webp', width: 640, height: 480 })
    expect(imagePreviewMetadata(webp(640, 480, 'lossless'))).toEqual({ ok: true, mimeType: 'image/webp', width: 640, height: 480 })
    expect(imagePreviewMetadata(webp(640, 480, 'extended'))).toEqual({ ok: true, mimeType: 'image/webp', width: 640, height: 480 })
  })

  it('fails closed on unknown, truncated, or implausible headers', () => {
    expect(imagePreviewMetadata(new Uint8Array(64))).toEqual({ ok: false, reason: 'unsupported' })
    expect(imagePreviewMetadata(png(1, 1).subarray(0, 12))).toEqual({ ok: false, reason: 'invalid' })
    expect(imagePreviewMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]))).toEqual({ ok: false, reason: 'invalid' })
    expect(imagePreviewMetadata(webp(1, 1).subarray(0, 24))).toEqual({ ok: false, reason: 'invalid' })
    expect(imagePreviewMetadata(png(0, 480))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports a decode budget failure with the declared dimensions', () => {
    expect(imagePreviewMetadata(png(65535, 65535))).toEqual({
      ok: false,
      reason: 'too-large',
      mimeType: 'image/png',
      width: 65535,
      height: 65535,
    })
  })
})

describe('workspace image and PDF previews', () => {
  it('assembles bounded readBytes chunks into canonical base64 and re-checks the file status', async () => {
    const { mocks, tools } = fakeTools()
    const image = png(2, 2, 7)
    const head = image.subarray(0, 8)
    const signal = new AbortController().signal
    mocks.statFile.mockResolvedValue(stat({ bytes: image.byteLength }))
    mocks.readBytes
      .mockResolvedValueOnce(chunk(head, 0, false, { bytes: image.byteLength }))
      .mockResolvedValueOnce(chunk(image.subarray(8), 8, true, { bytes: image.byteLength }))

    const preview = await loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image', signal)

    expect(preview).toEqual({ data: base64(image), mimeType: 'image/png', missingFonts: [] })
    expect(preview.data).not.toBe(base64(head) + base64(image.subarray(8)))
    expect(mocks.statFile).toHaveBeenCalledTimes(2)
    expect(mocks.readBytes.mock.calls).toEqual([
      ['s1', IMAGE_PATH, 0, image.byteLength, signal],
      ['s1', IMAGE_PATH, 8, image.byteLength - 8, signal],
    ])
  })

  it('reads unknown-size files in 512 KiB chunks until the Host reports the end', async () => {
    const { mocks, tools } = fakeTools()
    const image = png(1, 1, PREVIEW_CHUNK_BYTES)
    mocks.statFile.mockResolvedValue(stat())
    mocks.readBytes
      .mockImplementationOnce(async (_session, _path, offset, length) =>
        chunk(image.subarray(0, length as number), offset as number, false, { bytes: image.byteLength }))
      .mockImplementationOnce(async (_session, _path, offset) =>
        chunk(image.subarray(PREVIEW_CHUNK_BYTES), offset as number, true, { bytes: image.byteLength }))

    const preview = await loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image')

    expect(preview.data).toBe(base64(image))
    expect(preview.mimeType).toBe('image/png')
    expect(mocks.readBytes.mock.calls[0]?.[3]).toBe(PREVIEW_CHUNK_BYTES)
  })

  it('parses dimensions from PNG, GIF, JPEG, and WebP headers', async () => {
    const cases: Array<[string, Uint8Array, string]> = [
      ['assets/logo.png', png(320, 240), 'image/png'],
      ['assets/logo.gif', gif(320, 240), 'image/gif'],
      ['assets/logo.jpg', jpeg(320, 240), 'image/jpeg'],
      ['assets/logo.webp', webp(320, 240), 'image/webp'],
      ['assets/logo.webp', webp(320, 240, 'lossless'), 'image/webp'],
      ['assets/logo.webp', webp(320, 240, 'extended'), 'image/webp'],
    ]
    for (const [path, image, mimeType] of cases) {
      const { tools } = imageTools(image)
      await expect(loadWorkspacePreview(tools, 's1', path, 'image')).resolves.toMatchObject({ mimeType })
    }
  })

  it('refuses images whose decoded bitmap would exceed the pixel budget', async () => {
    const pixels = imageTools(png(4096, 4096))
    await expect(loadWorkspacePreview(pixels.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_TOO_LARGE,
      details: { width: 4096, height: 4096, maxPixels: MAX_IMAGE_PIXELS },
    })

    const wide = imageTools(gif(MAX_IMAGE_DIMENSION + 1, 1))
    await expect(loadWorkspacePreview(wide.tools, 's1', 'assets/logo.gif', 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_TOO_LARGE,
      details: { width: MAX_IMAGE_DIMENSION + 1, maxDimension: MAX_IMAGE_DIMENSION },
    })
  })

  it('rejects content whose header or extension does not match the request', async () => {
    const truncated = imageTools(png(1, 1).subarray(0, 12))
    await expect(loadWorkspacePreview(truncated.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_INVALID,
    })

    const renamed = imageTools(gif(320, 240))
    await expect(loadWorkspacePreview(renamed.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_UNSUPPORTED,
    })

    const notAnImage = imageTools(PDF_BYTES)
    await expect(loadWorkspacePreview(notAnImage.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_UNSUPPORTED,
    })
  })

  it('rejects malformed, short, and oversized chunk payloads', async () => {
    const cases: Array<{ response: unknown; code: string }> = [
      { response: chunk(encoder.encode('x'), 0, true, { data: 'AQIDBA' }), code: WORKSPACE_PREVIEW_INVALID },
      { response: chunk(encoder.encode('x'), 0, true, { data: ' AQIDBAU=' }), code: WORKSPACE_PREVIEW_INVALID },
      { response: chunk(encoder.encode('x'), 0, true, { data: 'AQIDBAUGBw==' }), code: WORKSPACE_PREVIEW_INVALID },
      { response: chunk(encoder.encode('x'), 4, true), code: WORKSPACE_PREVIEW_INVALID },
      { response: chunk(encoder.encode(''), 0, false), code: WORKSPACE_PREVIEW_INVALID },
      { response: chunk(encoder.encode('xx'), 0, true, { bytes: 99 }), code: WORKSPACE_PREVIEW_CHANGED },
    ]
    for (const testCase of cases) {
      const { mocks, tools } = fakeTools()
      mocks.statFile.mockResolvedValue(stat({ bytes: 1 }))
      mocks.readBytes.mockResolvedValue(testCase.response)
      await expect(loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({ code: testCase.code })
    }
  })

  it('rejects a chunk that belongs to another version or path', async () => {
    const { mocks, tools } = fakeTools()
    mocks.statFile.mockResolvedValue(stat({ bytes: 1 }))
    mocks.readBytes.mockResolvedValueOnce(chunk(encoder.encode('x'), 0, true, { version: 'v2' }))
    await expect(loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_CHANGED })

    const other = fakeTools()
    other.mocks.statFile.mockResolvedValue(stat({ bytes: 1 }))
    other.mocks.readBytes.mockResolvedValueOnce(chunk(encoder.encode('x'), 0, true, { absolutePath: '/workspace/other.png' }))
    await expect(loadWorkspacePreview(other.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_INVALID })
  })

  it('fails closed when the file changes before or after the bytes are read', async () => {
    const { mocks, tools } = fakeTools()
    mocks.statFile.mockResolvedValueOnce(stat({ bytes: 1 })).mockResolvedValueOnce(stat({ version: 'v2', bytes: 1 }))
    mocks.readBytes.mockResolvedValueOnce(chunk(encoder.encode('x'), 0, true))
    await expect(loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_CHANGED })

    const grew = fakeTools()
    grew.mocks.statFile.mockResolvedValue(stat({ bytes: 1 }))
    grew.mocks.readBytes.mockResolvedValueOnce(chunk(encoder.encode('xx'), 0, true, { bytes: 2 }))
    await expect(loadWorkspacePreview(grew.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_CHANGED })
  })

  it('does not treat a declared size as complete until the Host confirms the end of file', async () => {
    const image = png(1, 1)
    const { mocks, tools } = fakeTools()
    mocks.statFile.mockResolvedValue(stat({ bytes: image.byteLength }))
    mocks.readBytes
      .mockResolvedValueOnce(chunk(image, 0, false, { bytes: image.byteLength }))
      .mockResolvedValueOnce(chunk(new Uint8Array(0), image.byteLength, true, { bytes: image.byteLength }))
    await expect(loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image')).resolves.toMatchObject({ mimeType: 'image/png' })
    expect(mocks.readBytes.mock.calls[1]).toEqual(['s1', IMAGE_PATH, image.byteLength, 1, undefined])

    const grown = fakeTools()
    grown.mocks.statFile.mockResolvedValue(stat({ bytes: image.byteLength }))
    grown.mocks.readBytes
      .mockResolvedValueOnce(chunk(image, 0, false, { bytes: image.byteLength }))
      .mockResolvedValueOnce(chunk(Uint8Array.from([9]), image.byteLength, true))
    await expect(loadWorkspacePreview(grown.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_CHANGED,
    })
  })

  it('rejects unusable file statuses before reading anything', async () => {
    const nullBytes = fakeTools()
    nullBytes.mocks.statFile.mockResolvedValue(stat({ bytes: null }))
    await expect(loadWorkspacePreview(nullBytes.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_INVALID,
    })
    expect(nullBytes.mocks.readBytes).not.toHaveBeenCalled()

    const noVersion = fakeTools()
    noVersion.mocks.statFile.mockResolvedValue(stat({ version: '', bytes: 1 }))
    await expect(loadWorkspacePreview(noVersion.tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_INVALID,
    })
  })

  it('bounds files whose size the Host does not report', async () => {
    const { mocks, tools } = fakeTools()
    mocks.statFile.mockResolvedValue(stat())
    mocks.readBytes.mockImplementation(async (_session, _path, offset, length) =>
      chunk(new Uint8Array(length as number).fill(7), offset as number, false))
    await expect(loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_TOO_LARGE,
      details: { maxBytes: MAX_PREVIEW_BYTES },
    })
    expect(mocks.readBytes.mock.calls.length).toBeLessThanOrEqual(Math.ceil((MAX_PREVIEW_BYTES + 1) / PREVIEW_CHUNK_BYTES) + 1)
  })

  it('refuses oversized files before reading and cancels without replaying', async () => {
    const { mocks, tools } = fakeTools()
    mocks.statFile.mockResolvedValue(stat({ bytes: MAX_PREVIEW_BYTES + 1 }))
    await expect(loadWorkspacePreview(tools, 's1', IMAGE_PATH, 'image')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_TOO_LARGE })
    expect(mocks.readBytes).not.toHaveBeenCalled()

    const cancelled = fakeTools()
    const controller = new AbortController()
    cancelled.mocks.statFile.mockResolvedValue(stat())
    cancelled.mocks.readBytes.mockImplementation(async () => {
      controller.abort()
      return chunk(png(1, 1), 0, false)
    })
    await expect(loadWorkspacePreview(cancelled.tools, 's1', IMAGE_PATH, 'image', controller.signal))
      .rejects.toMatchObject({ code: 'RPC_ABORTED' })
    expect(cancelled.mocks.readBytes).toHaveBeenCalledTimes(1)
    expect(cancelled.mocks.statFile).toHaveBeenCalledTimes(1)
  })

  it('validates PDF content and extension agreement', async () => {
    const { mocks, tools } = fakeTools()
    mocks.statFile.mockResolvedValue({ absolutePath: '/workspace/docs/guide.pdf', version: VERSION, bytes: PDF_BYTES.byteLength })
    mocks.readBytes.mockResolvedValue({
      absolutePath: '/workspace/docs/guide.pdf', version: VERSION, offset: 0, data: base64(PDF_BYTES), eof: true, bytes: PDF_BYTES.byteLength,
    })
    await expect(loadWorkspacePreview(tools, 's1', 'docs/guide.pdf', 'pdf')).resolves.toEqual({
      data: base64(PDF_BYTES), mimeType: 'application/pdf', missingFonts: [],
    })

    const renamed = fakeTools()
    renamed.mocks.statFile.mockResolvedValue({ absolutePath: IMAGE_ABSOLUTE, version: VERSION, bytes: PDF_BYTES.byteLength })
    renamed.mocks.readBytes.mockResolvedValue({
      absolutePath: IMAGE_ABSOLUTE, version: VERSION, offset: 0, data: base64(PDF_BYTES), eof: true, bytes: PDF_BYTES.byteLength,
    })
    await expect(loadWorkspacePreview(renamed.tools, 's1', IMAGE_PATH, 'pdf')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_UNSUPPORTED })
  })
})

describe('workspace Office previews', () => {
  function officeFixture() {
    const order: string[] = []
    const { mocks, tools } = fakeTools()
    mocks.statFile.mockImplementation(async () => {
      order.push('stat')
      return { absolutePath: DOC_ABSOLUTE, version: VERSION, bytes: 4096 }
    })
    mocks.officeGeneration.mockImplementation(async () => {
      order.push('generation')
      return 'gen-7'
    })
    mocks.renderOfficePdf.mockImplementation(async () => {
      order.push('render')
      return {
        absolutePath: DOC_ABSOLUTE,
        version: VERSION,
        bytes: PDF_BYTES.byteLength,
        offset: 0,
        data: base64(PDF_BYTES),
        eof: true,
        generation: 'gen-7',
        missingFonts: ['Arial'],
      }
    })
    return { mocks, tools, order }
  }

  it('converts through stat, generation and render with a re-check afterwards', async () => {
    const { mocks, tools, order } = officeFixture()
    const signal = new AbortController().signal

    const preview = await loadWorkspacePreview(tools, 's1', DOC_PATH, 'office', signal)

    expect(preview).toEqual({ data: base64(PDF_BYTES), mimeType: 'application/pdf', missingFonts: ['Arial'] })
    expect(order).toEqual(['stat', 'generation', 'render', 'stat'])
    expect(mocks.statFile).toHaveBeenCalledTimes(2)
    expect(mocks.officeGeneration).toHaveBeenCalledWith(signal)
    expect(mocks.renderOfficePdf).toHaveBeenCalledWith('s1', DOC_PATH, signal)
  })

  it('refuses unknown document types and oversized sources before converting', async () => {
    const unknown = fakeTools()
    await expect(loadWorkspacePreview(unknown.tools, 's1', 'docs/report.txt', 'office')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_UNSUPPORTED })
    expect(unknown.mocks.statFile).not.toHaveBeenCalled()

    const legacy = fakeTools()
    await expect(loadWorkspacePreview(legacy.tools, 's1', 'docs/report.odt', 'office')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_UNSUPPORTED })
    expect(legacy.mocks.statFile).not.toHaveBeenCalled()

    const huge = fakeTools()
    huge.mocks.statFile.mockResolvedValue({ absolutePath: DOC_ABSOLUTE, version: VERSION, bytes: MAX_OFFICE_SOURCE_BYTES + 1 })
    await expect(loadWorkspacePreview(huge.tools, 's1', DOC_PATH, 'office')).rejects.toMatchObject({
      code: WORKSPACE_PREVIEW_TOO_LARGE,
      details: { maxBytes: MAX_OFFICE_SOURCE_BYTES },
    })
    expect(huge.mocks.officeGeneration).not.toHaveBeenCalled()
    expect(huge.mocks.renderOfficePdf).not.toHaveBeenCalled()
  })

  it('rejects a conversion that belongs to another document state', async () => {
    const cases: Array<{ response: Record<string, unknown>; code: string }> = [
      { response: { version: 'v2' }, code: WORKSPACE_PREVIEW_CHANGED },
      { response: { generation: 'gen-8' }, code: WORKSPACE_PREVIEW_CHANGED },
      { response: { absolutePath: '/workspace/docs/other.docx' }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { offset: 1 }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { eof: false }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { data: 'AQIDBA' }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { data: base64(encoder.encode('not a pdf')), bytes: 9 }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { bytes: PDF_BYTES.byteLength + 1 }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { bytes: MAX_PREVIEW_BYTES + 1 }, code: WORKSPACE_PREVIEW_TOO_LARGE },
      { response: { missingFonts: undefined }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { missingFonts: ['Arial', 7] }, code: WORKSPACE_PREVIEW_INVALID },
      { response: { missingFonts: ['F'.repeat(257)] }, code: WORKSPACE_PREVIEW_INVALID },
    ]
    for (const testCase of cases) {
      const { mocks, tools } = officeFixture()
      mocks.renderOfficePdf.mockResolvedValue({
        absolutePath: DOC_ABSOLUTE,
        version: VERSION,
        bytes: PDF_BYTES.byteLength,
        offset: 0,
        data: base64(PDF_BYTES),
        eof: true,
        generation: 'gen-7',
        missingFonts: [],
        ...testCase.response,
      })
      await expect(loadWorkspacePreview(tools, 's1', DOC_PATH, 'office')).rejects.toMatchObject({ code: testCase.code })
    }
  })

  it('caps the reported missing fonts and detects source changes after conversion', async () => {
    const many = officeFixture()
    many.mocks.renderOfficePdf.mockResolvedValue({
      absolutePath: DOC_ABSOLUTE,
      version: VERSION,
      bytes: PDF_BYTES.byteLength,
      offset: 0,
      data: base64(PDF_BYTES),
      eof: true,
      generation: 'gen-7',
      missingFonts: new Array(MAX_MISSING_FONTS + 5).fill('Missing'),
    })
    await expect(loadWorkspacePreview(many.tools, 's1', DOC_PATH, 'office')).resolves.toMatchObject({
      missingFonts: new Array(MAX_MISSING_FONTS).fill('Missing'),
    })

    const changed = officeFixture()
    changed.mocks.statFile
      .mockResolvedValueOnce({ absolutePath: DOC_ABSOLUTE, version: VERSION, bytes: 4096 })
      .mockResolvedValueOnce({ absolutePath: DOC_ABSOLUTE, version: 'v2', bytes: 4096 })
    await expect(loadWorkspacePreview(changed.tools, 's1', DOC_PATH, 'office')).rejects.toMatchObject({ code: WORKSPACE_PREVIEW_CHANGED })
  })

  it('preserves Host Office failures and never converts after a cancellation', async () => {
    const failing = officeFixture()
    const failure = Object.assign(new Error('The conversion engine is busy.'), {
      code: 'office/engine-busy',
      details: { retryAfterMs: 500 },
    })
    failing.mocks.renderOfficePdf.mockRejectedValue(failure)
    await expect(loadWorkspacePreview(failing.tools, 's1', DOC_PATH, 'office')).rejects.toBe(failure)

    const cancelled = officeFixture()
    const controller = new AbortController()
    cancelled.mocks.officeGeneration.mockImplementation(async () => {
      controller.abort()
      return 'gen-7'
    })
    await expect(loadWorkspacePreview(cancelled.tools, 's1', DOC_PATH, 'office', controller.signal))
      .rejects.toMatchObject({ code: 'RPC_ABORTED' })
    expect(cancelled.mocks.renderOfficePdf).not.toHaveBeenCalled()
    expect(cancelled.mocks.statFile).toHaveBeenCalledTimes(1)
  })
})
