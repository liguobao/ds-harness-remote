import { describe, expect, it, vi } from 'vitest'
import type { RemoteTypertGatewayTarget } from '../src/typert-gateway-contract.js'
import { uploadLocalMentions } from '../src/local-mention-upload.js'

const path = 'C:\\Users\\liguobao\\Downloads\\dsh-latest-windows-x64.exe'
const prompt = { args: { request: { sessionId: 's1', content: [{ type: 'text', text: `@${path} 这个文件是什么` }] } } }
const signal = new AbortController().signal
function setup(receipt = 'receipt-1', remotePaths: string[] = []) {
  const remote = { dispatch: vi.fn(async (endpoint: string) => endpoint === 'fileReferences/list'
    ? { ok: true as const, value: remotePaths.map(path => ({ path, kind: 'file' })) }
    : { ok: true as const, value: { receiptId: receipt } }) } as unknown as RemoteTypertGatewayTarget
  const fileIO = { lstat: vi.fn(async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 4 })),
    readFile: vi.fn(async () => Buffer.from([0, 1, 2, 3])) } as unknown as NonNullable<Parameters<typeof uploadLocalMentions>[4]>
  return { remote, fileIO }
}

describe('local file mention upload', () => {
  it('stages exact bytes in the selected Session and submits the Host receipt', async () => {
    const { remote, fileIO } = setup()
    const result = await uploadLocalMentions(prompt, remote, signal, 'win32', fileIO)
    expect(remote.dispatch).toHaveBeenCalledWith('fileUploads/upload', { args: {
      agentId: 's1', request: { data: 'AAECAw==', name: 'dsh-latest-windows-x64.exe' },
    } }, signal)
    expect((result as typeof prompt).args.request.content).toEqual([
      { type: 'file', receiptId: 'receipt-1' }, { type: 'text', text: ' 这个文件是什么' },
    ])
  })
  it('uploads quoted macOS and Linux paths through the same Session flow', async () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const { remote, fileIO } = setup()
      const local = { args: { request: { sessionId: 's2', content: [{ type: 'text', text: '@"/Users/liguobao/Downloads/report draft.pdf" 请查看' }] } } }
      const result = await uploadLocalMentions(local, remote, signal, platform, fileIO)
      expect(remote.dispatch).toHaveBeenCalledWith('fileUploads/upload', { args: {
        agentId: 's2', request: { data: 'AAECAw==', name: 'report draft.pdf' },
      } }, signal)
      expect((result as typeof local).args.request.content).toEqual([
        { type: 'file', receiptId: 'receipt-1' }, { type: 'text', text: ' 请查看' },
      ])
    }
  })
  it('preserves text on other platforms and fails closed when the local read fails', async () => {
    const { remote, fileIO } = setup()
    expect(await uploadLocalMentions(prompt, remote, signal, 'darwin', fileIO)).toBe(prompt)
    expect(remote.dispatch).not.toHaveBeenCalled()
    vi.mocked(fileIO.lstat).mockRejectedValueOnce(new Error('ENOENT'))
    await expect(uploadLocalMentions(prompt, remote, signal, 'win32', fileIO)).rejects.toThrow('ENOENT')
    expect(remote.dispatch).not.toHaveBeenCalledWith('fileUploads/upload', expect.anything(), signal)
  })
  it('keeps a remote workspace file on the remote Host even when the client has the same path', async () => {
    const { remote, fileIO } = setup('receipt-1', [path])
    expect(await uploadLocalMentions(prompt, remote, signal, 'win32', fileIO)).toBe(prompt)
    expect(fileIO.lstat).not.toHaveBeenCalled()
    expect(remote.dispatch).not.toHaveBeenCalledWith('fileUploads/upload', expect.anything(), signal)
  })
  it('keeps an absent client path for remote Host resolution', async () => {
    const { remote, fileIO } = setup()
    vi.mocked(fileIO.lstat).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    expect(await uploadLocalMentions(prompt, remote, signal, 'win32', fileIO)).toBe(prompt)
  })
  it('rejects missing Host receipts and non-regular files before sending the prompt', async () => {
    const { remote, fileIO } = setup('')
    await expect(uploadLocalMentions(prompt, remote, signal, 'win32', fileIO)).rejects.toThrow('receipt')
    vi.mocked(fileIO.lstat).mockResolvedValueOnce({ isFile: () => false, isSymbolicLink: () => false, size: 4 } as never)
    await expect(uploadLocalMentions(prompt, remote, signal, 'win32', fileIO)).rejects.toThrow('unavailable')
  })
})
