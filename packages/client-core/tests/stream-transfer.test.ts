import { expect, it } from 'vitest'
import { HARNESS_API_TRANSFER_CHUNK_BYTES as chunkSize, type EventPayload } from '@dsh-remote/protocol'
import type { RemoteClientCore } from '../src/index.js'
import { probeRemoteHostFeatures, RemoteTypertGateway } from '../src/remote-gateway.js'

it.each(['inline', 'chunked', 'wrong stream'])('receives session/control frames: %s', async mode => {
  let emit!: (event: EventPayload) => void
  let bytes = Buffer.alloc(0)
  let streamId = ''
  let released = 0
  const baseline = { type: 'baseline', title: mode === 'inline' ? 'old Host' : 'x'.repeat(4 * 1024 * 1024) }
  const delta = { type: 'projection' }
  const transferId = 'test-transfer'
  const core = {
    onEvent(handler: typeof emit) { emit = handler; return () => {} },
    onClose() { return () => {} },
    async rpc(method: string, params: Record<string, unknown>) {
      switch (method) {
        case 'harness.transport.describe':
          return { capabilities: ['harness.remote.v3', mode === 'inline' ? 'harness.remote.transfer.v1' : 'harness.remote.stream.transfer.v1'] }
        case 'harness.remote.stream.open': {
          expect(params.transferFrames).toBe(mode === 'inline' ? undefined : true)
          streamId = String(params.streamId)
          const frame = { streamId, hasValue: true as const, value: baseline }
          bytes = Buffer.from(JSON.stringify({ ...frame, streamId: mode === 'wrong stream' ? 'other' : streamId }))
          emit({ event: 'harness.remote.frame', data: mode === 'inline' ? frame : {
            streamId, hasValue: true, transfer: { kind: 'chunked', transferId, totalBytes: bytes.length, totalChunks: Math.ceil(bytes.length / chunkSize) },
          } })
          break
        }
        case 'harness.remote.transfer.read': {
          const index = Number(params.index)
          return { transferId, index, data: bytes.subarray(index * chunkSize, (index + 1) * chunkSize).toString('base64') }
        }
        case 'harness.remote.transfer.close':
          expect(params.transferId).toBe(transferId)
          released++
          emit({ event: 'harness.remote.frame', data: { streamId, hasValue: true, value: delta } })
          break
      }
      return {}
    },
  } as unknown as RemoteClientCore
  await probeRemoteHostFeatures(core)
  const stream = await new RemoteTypertGateway(core).open('session/control', { args: {} })
  const iterator = stream[Symbol.asyncIterator]()
  if (mode === 'wrong stream') {
    await expect(iterator.next()).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  } else {
    expect((await iterator.next()).value).toEqual(baseline)
    if (mode === 'chunked') expect((await iterator.next()).value).toEqual(delta)
  }
  expect(released).toBe(mode === 'inline' ? 0 : 1)
  await stream.close()
})

it('opens session follows with the last confirmed stream capability during a refresh', async () => {
  const supported = { capabilities: ['harness.remote.v3', 'harness.remote.stream.transfer.v1'] }
  let describe = async (): Promise<unknown> => supported
  let lastOpen: Record<string, unknown> | undefined
  const core = {
    onEvent: () => () => {},
    onClose: () => () => {},
    async rpc(method: string, params: Record<string, unknown>) {
      if (method === 'harness.transport.describe') return describe()
      if (method === 'harness.remote.stream.open') lastOpen = params
      return {}
    },
  } as unknown as RemoteClientCore
  const gateway = new RemoteTypertGateway(core)
  async function expectFollow(chunked: boolean) {
    lastOpen = undefined
    const stream = await gateway.open('session/follow', { args: {} })
    expect(lastOpen).toMatchObject({ endpoint: 'session/follow' })
    if (chunked) expect(lastOpen).toHaveProperty('transferFrames', true)
    else expect(lastOpen).not.toHaveProperty('transferFrames')
    await stream.close()
  }

  await expectFollow(false)
  await probeRemoteHostFeatures(core)
  let rejectRefresh!: (error: Error) => void
  describe = () => new Promise((_, reject) => { rejectRefresh = reject })
  const refresh = probeRemoteHostFeatures(core)
  await expectFollow(true)
  rejectRefresh(new Error('describe timed out'))
  await expect(refresh).rejects.toThrow('describe timed out')
  await expectFollow(true)
  describe = async () => ({ capabilities: ['harness.remote.v3'] })
  await probeRemoteHostFeatures(core)
  await expectFollow(false)
})
