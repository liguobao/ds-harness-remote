import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { chatImageAttachmentReference, chatImageWorkspacePath, createChatImageLoader, validatedImageDataUri } from '../src/services/chat-image-loader'

const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const uri = `data:image/png;base64,${data}`
function setup() {
  const attachment = vi.fn(async () => ({ attachment: { attachmentId: 'a1', mediaType: 'image/png' }, data }))
  const workspace = vi.fn(async () => ({ data, mimeType: 'image/png' }))
  const assertCurrent = vi.fn()
  const load = createChatImageLoader({ sessionId: 's1', attachment, workspace, assertCurrent })
  const controller = new AbortController()
  return { attachment, workspace, assertCurrent, load, controller }
}

describe('chat image reads', () => {
  it('resolves session references and workspace images without a network or device-file fallback', async () => {
    await runScenarios([
      { name: 'session attachment authority', run: async () => {
        const { load, attachment, workspace, controller } = setup()
        const image = { attachmentId: 'a1', sessionId: 'child' }
        expect(await load(image, controller.signal)).toBe(uri)
        expect(attachment).toHaveBeenCalledWith('child', image, controller.signal)
        expect(workspace).not.toHaveBeenCalled()
      } },
      { name: 'Host path through authorized workspace reader', run: async () => {
        const { load, workspace, controller } = setup()
        expect(await load({ uri: 'file:///workspace/a%20b.png' }, controller.signal)).toBe(uri)
        expect(workspace).toHaveBeenCalledWith('/workspace/a b.png', controller.signal)
      } },
      ...['https://example.test/a.png', '//server/a.png', '\\\\server\\a.png', 'file://server/a.png', 'content://phone/a.png', 'data:image/svg+xml;base64,AAAA', '%68ttps%3A%2F%2Fexample.test/a.png', 'x%00.png'].map(value => ({
        name: `reject untrusted source ${value}`, run: async () => {
          const { load, attachment, workspace, controller } = setup()
          await expect(load({ uri: value }, controller.signal)).rejects.toThrow()
          expect(attachment).not.toHaveBeenCalled()
          expect(workspace).not.toHaveBeenCalled()
        },
      })),
    ])
    expect(chatImageWorkspacePath('C:\\work\\image.png')).toBe('C:\\work\\image.png')
  })

  it('sends the full 0.2.2 reference and rejects a response that disagrees with it', async () => {
    await runScenarios(['accepted', 'byte-length', 'dimensions'].map(mode => ({ name: mode, run: async () => {
      const { load, attachment, controller } = setup()
      const reference = { attachmentId: 'a1', mediaType: 'image/png', bytes: 79, width: 1, height: 1, name: 'a.png' }
      attachment.mockImplementation(async () => ({
        attachment: {
          ...reference,
          ...(mode === 'byte-length' ? { bytes: 80 } : {}),
          ...(mode === 'dimensions' ? { width: 2 } : {}),
        },
        data,
      }))
      if (mode === 'accepted') expect(await load(reference, controller.signal)).toBe(uri)
      else await expect(load(reference, controller.signal)).rejects.toThrow()
      expect(attachment).toHaveBeenCalledWith('s1', reference, controller.signal)
    } })))
  })

  it('rejects mismatched responses and stale or cancelled reads', async () => {
    await runScenarios(['attachment-id', 'mime', 'cancelled-before', 'cancelled-after', 'replaced'].map(mode => ({ name: mode, run: async () => {
      const { load, attachment, assertCurrent, controller } = setup()
      if (mode === 'cancelled-before') controller.abort()
      attachment.mockImplementation(async () => {
        if (mode === 'cancelled-after') controller.abort()
        if (mode === 'replaced') assertCurrent.mockImplementation(() => { throw new Error('expired') })
        return { attachment: { attachmentId: mode === 'attachment-id' ? 'other' : 'a1', mediaType: mode === 'mime' ? 'image/jpeg' : 'image/png' }, data }
      })
      await expect(load({ attachmentId: 'a1' }, controller.signal)).rejects.toThrow()
      if (mode === 'cancelled-before') expect(attachment).not.toHaveBeenCalled()
    } })))
  })

  it('checks image bytes before native decoding', async () => {
    expect(validatedImageDataUri(uri)).toBe(uri)
    await runScenarios([
      'data:image/png;base64,aW1hZ2U=',
      `data:image/jpeg;base64,${data}`,
      'data:image/png;base64,' + 'A'.repeat(12 * 1024 * 1024),
    ].map((value, index) => ({ name: `invalid bytes or budget ${index}`, run: () => {
      expect(() => validatedImageDataUri(value)).toThrow()
    } })))
  })
})


describe('chat image attachment reference and echo tolerance', () => {
  it('retains every available reference field even when bytes are missing', () => {
    expect(chatImageAttachmentReference({ attachmentId: 'a1' })).toEqual({ attachmentId: 'a1' })
    expect(chatImageAttachmentReference({
      attachmentId: 'a1', mediaType: 'image/png', width: 4, height: 2, name: 'a.png',
    })).toEqual({ attachmentId: 'a1', mediaType: 'image/png', width: 4, height: 2, name: 'a.png' })
    expect(chatImageAttachmentReference({ attachmentId: 'a1', bytes: 79 })).toEqual({ attachmentId: 'a1', bytes: 79 })
    expect(chatImageAttachmentReference({ uri: 'file:///x.png' })).toEqual({})
  })

  it('tolerates an attachment echo that omits the verified fields', async () => {
    const { load, attachment, controller } = setup()
    const reference = { attachmentId: 'a1', mediaType: 'image/png', bytes: 79, width: 1, height: 1, name: 'a.png' }
    // setup() echoes only { attachmentId, mediaType }; bytes/width/height are absent.
    await expect(load(reference, controller.signal)).resolves.toBe(uri)
    expect(attachment).toHaveBeenCalledWith('s1', reference, controller.signal)
  })
})
