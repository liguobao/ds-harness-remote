import { describe, expect, it, vi } from 'vitest'
import type { RemoteGatewayStream } from '@dsh-remote/client-core'
import { HarnessSessionTools, type TerminalFrame, type TerminalInfo } from '../src/services/session-tools'
import { TerminalAttachment } from '../src/services/terminal-attachment'

function fixture() {
  let push: (frame: TerminalFrame) => void = () => { throw new Error('Not following') }
  let end = () => {}
  let attachmentId = ''
  const frames: TerminalFrame[] = []
  let wake = () => {}
  let done = false
  const stream: RemoteGatewayStream = {
    async *[Symbol.asyncIterator]() {
      while (!done) {
        if (frames.length) yield frames.shift()!
        else await new Promise<void>(resolve => { wake = resolve })
      }
    },
    close: vi.fn(async () => { done = true; wake() }),
  }
  const retention: RemoteGatewayStream = {
    async *[Symbol.asyncIterator]() { yield { type: 'retained' } }, close: vi.fn(async () => undefined),
  }
  const tools = {
    retainTerminal: vi.fn(async () => retention),
    followTerminal: vi.fn(async (_session: string, _id: string, controllerId: string) => {
      attachmentId = controllerId
      push = frame => { frames.push(frame); wake() }
      end = () => { done = true; wake() }
      return stream
    }),
    writeTerminal: vi.fn(async () => undefined), resizeTerminal: vi.fn(async () => undefined),
  }
  const info = (controllerId = attachmentId): TerminalInfo => ({ id: 't1', title: 'shell', state: 'running', controllerId, cols: 80, rows: 24, exitCode: null })
  const render = vi.fn(async () => undefined)
  const state = vi.fn()
  const client = new TerminalAttachment(tools as unknown as HarnessSessionTools, 's1', 't1', 32, render, state)
  const start = async () => {
    const result = client.follow()
    void result.catch(() => undefined)
    await vi.waitFor(() => expect(tools.followTerminal).toHaveBeenCalled())
    return { result }
  }
  return { client, tools, render, state, stream, retention, start, info, push: (value: TerminalFrame) => push(value), end: () => end() }
}

describe('terminal attachment state machine', () => {
  it('requires a rendered snapshot and current input ownership; revokes on handoff', async () => {
    const f = fixture()
    const { result } = await f.start()
    await expect(f.client.write('pwd\r')).rejects.toThrow()
    f.push({ type: 'snapshot', sequence: 5, screen: 'prompt', info: f.info() })
    await vi.waitFor(() => expect(f.state).toHaveBeenLastCalledWith(f.info(), true))
    await f.client.write('pwd\r')
    f.push({ type: 'state', info: f.info('other') })
    await vi.waitFor(() => expect(f.state).toHaveBeenLastCalledWith(f.info('other'), false))
    await expect(f.client.write('rm\r')).rejects.toThrow()
    expect(f.tools.writeTerminal).toHaveBeenCalledTimes(1)
    f.client.dispose(); await result
    expect(f.retention.close).toHaveBeenCalled()
  })
  it('fails closed on output gaps and never writes after disconnection', async () => {
    const f = fixture(); const { result } = await f.start()
    f.push({ type: 'snapshot', sequence: 0, screen: '', info: f.info() })
    f.push({ type: 'output', sequence: 2, data: 'missing earlier frame' })
    await expect(result).rejects.toThrow('out of order')
    await expect(f.client.write('pwd\r')).rejects.toThrow()
    expect(f.render).toHaveBeenCalledTimes(1)
    expect(f.stream.close).toHaveBeenCalled()
  })
  it('serializes writes and drops queued input after an uncertain write failure', async () => {
    const f = fixture(); const { result } = await f.start()
    f.push({ type: 'snapshot', sequence: 0, screen: '', info: f.info() })
    await vi.waitFor(() => expect(f.state).toHaveBeenCalled())
    f.tools.writeTerminal.mockRejectedValueOnce(new Error('timeout'))
    const first = f.client.write('first\r')
    const second = f.client.write('second\r')
    await expect(first).rejects.toThrow('timeout')
    await expect(second).rejects.toThrow('detached')
    expect(f.tools.writeTerminal).toHaveBeenCalledTimes(1)
    await result
  })
  it('enforces UTF-8 input limits before sending', async () => {
    const f = fixture(); const { result } = await f.start()
    f.push({ type: 'snapshot', sequence: 0, screen: '', info: f.info() })
    await vi.waitFor(() => expect(f.state).toHaveBeenCalled())
    await expect(f.client.write('中'.repeat(11))).rejects.toThrow()
    expect(f.tools.writeTerminal).not.toHaveBeenCalled()
    f.client.dispose(); await result
  })
})
