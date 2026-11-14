import { beforeEach, expect, it, vi } from 'vitest'
import { uploadStagedFileToWorkspace, UPLOAD_CHUNK_BYTES as CHUNK } from '../src/screens/chat-files'

const native = vi.hoisted(() => ({ data: new Uint8Array(0), close: vi.fn(), read: vi.fn() }))
vi.mock('expo-file-system', () => ({
  FileMode: { ReadOnly: 'r' },
  File: class { get size() { return native.data.length }; open() { return { size: native.data.length, close: native.close, readBytes: () => { throw new Error('should use native base64') } } } },
}))
vi.mock('expo-file-system/legacy', () => ({ EncodingType: { Base64: 'base64' }, readAsStringAsync: native.read }))
beforeEach(() => {
  vi.clearAllMocks()
  native.data = new Uint8Array(CHUNK * 6 + 3).map((_, i) => i % 251)
  native.read.mockImplementation(async (_uri, { position, length }) => Buffer.from(native.data.slice(position, position + length)).toString('base64'))
})
const file = () => ({ id: 'file', name: 'test.bin', uri: 'file:///test.bin', size: native.data.length })
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

it('bounds the window, reads native ranges, preserves byte order and reports only confirmed progress', async () => {
  const pending: (() => void)[] = []
  const received: Buffer[] = []
  const progress = vi.fn()
  let offset = 0
  const rpc = vi.fn(async (method: string, params: any) => {
    if (method.endsWith('.open')) return { chunkBytes: CHUNK }
    if (method.endsWith('.commit')) return { name: file().name, path: './test.bin', bytes: offset }
    if (method.endsWith('.chunk')) {
      expect(params.offset).toBe(offset)
      const bytes = Buffer.from(params.data, 'base64')
      received.push(bytes); offset += bytes.length
      return new Promise(resolve => pending.push(() => resolve({ receivedBytes: params.offset + bytes.length })))
    }
    throw new Error(method)
  })
  const upload = uploadStagedFileToWorkspace(rpc, 's1', file(), undefined, progress)
  await vi.waitFor(() => expect(pending).toHaveLength(4))
  expect(progress.mock.calls).toEqual([[0, native.data.length]])
  pending.shift()!()
  await tick()
  expect(pending).toHaveLength(4)
  expect(progress).toHaveBeenLastCalledWith(CHUNK, native.data.length)
  while (offset < native.data.length || pending.length) { pending.shift()?.(); await tick() }
  await expect(upload).resolves.toMatchObject({ bytes: native.data.length })
  expect(Buffer.concat(received)).toEqual(Buffer.from(native.data))
  expect(native.close).toHaveBeenCalledTimes(1)
  expect(native.read).toHaveBeenCalledWith(file().uri, { encoding: 'base64', position: CHUNK * 6, length: 3 })
})

it('handles a later in-flight failure immediately, drains requests, aborts, and never commits', async () => {
  const replies: { resolve: (v: object) => void; reject: (e: Error) => void }[] = []
  const methods: string[] = []
  const rpc = async (method: string) => {
    methods.push(method)
    if (method.endsWith('.open')) return { chunkBytes: CHUNK }
    if (method.endsWith('.chunk')) return new Promise<object>((resolve, reject) => replies.push({ resolve, reject }))
    return { aborted: true }
  }
  const upload = uploadStagedFileToWorkspace(rpc, 's1', file())
  const rejected = expect(upload).rejects.toThrow('lost chunk')
  await vi.waitFor(() => expect(replies).toHaveLength(4))
  replies[3]!.reject(new Error('lost chunk'))
  await tick()
  replies.slice(0, 3).forEach(reply => reply.resolve({}))
  await rejected
  expect(methods.filter(m => m.endsWith('.chunk'))).toHaveLength(4)
  expect(methods.at(-1)).toBe('workspace.upload.abort')
  expect(methods).not.toContain('workspace.upload.commit')
})

it('rejects a truncated native range before it can send or commit', async () => {
  native.read.mockResolvedValue('AA==')
  const rpc = vi.fn(async (_method: string, _params: unknown) => ({ chunkBytes: CHUNK }))
  await expect(uploadStagedFileToWorkspace(rpc, 's1', file())).rejects.toThrow('Unexpected chunk length')
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['workspace.upload.open', 'workspace.upload.abort'])
})

it('cancels the full in-flight window without submitting more data or committing', async () => {
  const controller = new AbortController()
  const methods: string[] = []
  const rpc = async (method: string, _params: unknown, signal?: AbortSignal) => {
    methods.push(method)
    if (method.endsWith('.open')) return { chunkBytes: CHUNK }
    if (method.endsWith('.chunk')) return new Promise((_, reject) => {
      signal!.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true })
    })
    return { aborted: true }
  }
  const upload = uploadStagedFileToWorkspace(rpc, 's1', file(), controller.signal)
  const rejected = expect(upload).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(methods.filter(m => m.endsWith('.chunk'))).toHaveLength(4))
  controller.abort()
  await rejected
  expect(methods.filter(m => m.endsWith('.chunk'))).toHaveLength(4)
  expect(methods.at(-1)).toBe('workspace.upload.abort')
  expect(methods).not.toContain('workspace.upload.commit')
  expect(native.close).toHaveBeenCalledTimes(1)
})

it.each([0, -1, 0.5, CHUNK + 1, Infinity])('rejects unsafe negotiated chunk sizes (%s)', async chunkBytes => {
  const rpc = vi.fn(async (_method: string, _params: unknown) => ({ chunkBytes }))
  await expect(uploadStagedFileToWorkspace(rpc, 's1', file())).rejects.toThrow('Invalid upload chunk size')
  expect(rpc.mock.calls.map(call => call[0])).toEqual(['workspace.upload.open', 'workspace.upload.abort'])
})
