import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { AndroidConnectionOptions } from '../src/services/connection'
import type { DeviceIdentity, RemoteDevice } from '../src/types'

const { client, service } = vi.hoisted(() => ({
  client: { connect: vi.fn(), close: vi.fn(), rpc: vi.fn(), supportsBinaryUpload: vi.fn() },
  service: { start: vi.fn(), stop: vi.fn(), setStatus: vi.fn() },
}))
vi.mock('../src/services/connection', () => ({ AndroidRemoteConnection: class {
  connect = client.connect
  close = client.close
  rpc = client.rpc
  supportsBinaryUpload = client.supportsBinaryUpload
} }))
vi.mock('../src/services/foreground-service', () => ({ foregroundService: service }))
import { AndroidRemoteRuntime } from '../src/services/remote-runtime'

const connect = (runtime: AndroidRemoteRuntime, options: AndroidConnectionOptions = {}) => runtime.connect(
  'https://example.invalid', {} as DeviceIdentity, {} as RemoteDevice, 'synthetic', () => undefined, options,
)
const deferred = () => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const prepare = () => {
  vi.resetAllMocks()
  service.start.mockResolvedValue(undefined)
  service.stop.mockResolvedValue(undefined)
  client.connect.mockResolvedValue(undefined)
  client.close.mockResolvedValue(undefined)
}
beforeEach(prepare)

describe('Android carrier foreground service ownership', () => {
  it('retains the existing service only for bounded retryable recovery, including failed attempts', async () => {
    await runScenarios(['exhausted', 'recovered', 'refused', 'manual-disconnect'].map(outcome => ({ name: outcome, run: async () => {
      const runtime = new AndroidRemoteRuntime()
      const closed = vi.fn()
      await connect(runtime, { onClose: closed })
      expect(service.setStatus).toHaveBeenLastCalledWith('connected')
      const options = client.connect.mock.calls[0]![5] as AndroidConnectionOptions
      options.onClose?.({ retryable: outcome !== 'refused' })
      await Promise.resolve()
      if (outcome === 'refused') {
        await runtime.stopRecovery()
        expect(service.stop).toHaveBeenCalledTimes(1)
      } else {
        expect(service.stop).not.toHaveBeenCalled()
        await runtime.prepareConnection(true)
        expect(service.setStatus).toHaveBeenLastCalledWith('reconnecting')
        client.connect.mockRejectedValueOnce(new Error('network still down'))
        await expect(connect(runtime)).rejects.toThrow('network still down')
        await runtime.close({ preserveRecovery: true })
        expect(service.start).toHaveBeenCalledTimes(1)
        expect(service.stop).not.toHaveBeenCalled()
        if (outcome === 'recovered') {
          await connect(runtime)
          await runtime.stopRecovery()
          expect(service.setStatus).toHaveBeenLastCalledWith('connected')
          expect(service.stop).not.toHaveBeenCalled()
        } else if (outcome === 'exhausted') {
          await runtime.stopRecovery()
          expect(service.stop).toHaveBeenCalledTimes(1)
        }
      }
      await runtime.close()
      expect(service.stop).toHaveBeenCalledTimes(1)
    } })), prepare)
  })

  it('serializes native start/stop and fences retired connection lifetimes', async () => {
    await runScenarios([
      {
        name: 'service preparation precedes network work and is reused by carrier setup',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          await runtime.prepareConnection()
          expect(service.start).toHaveBeenCalledTimes(1)
          expect(client.connect).not.toHaveBeenCalled()
          await connect(runtime)
          expect(service.start).toHaveBeenCalledTimes(1)
          await runtime.close()
        },
      },
      {
        name: 'disconnect during a native start releases the service and never opens a carrier',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          const start = deferred()
          service.start.mockReturnValueOnce(start.promise)
          const connecting = connect(runtime).catch(error => error)
          await vi.waitFor(() => expect(service.start).toHaveBeenCalledTimes(1))
          const closing = runtime.close()
          start.resolve()
          expect(await connecting).toBeInstanceOf(Error)
          await closing
          expect(client.connect).not.toHaveBeenCalled()
          expect(service.stop).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'a late connection failure cannot stop its replacement service',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          const first = deferred()
          client.connect.mockReturnValueOnce(first.promise)
          const connecting = connect(runtime).catch(error => error)
          await vi.waitFor(() => expect(client.connect).toHaveBeenCalledTimes(1))
          await connect(runtime)
          first.reject(new Error('retired connection'))
          expect(await connecting).toBeInstanceOf(Error)
          expect(service.start).toHaveBeenCalledTimes(1)
          expect(service.stop).not.toHaveBeenCalled()
          await runtime.close()
          expect(service.stop).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'an obsolete close callback cannot tear down a new carrier',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          const closed = vi.fn()
          await connect(runtime, { onClose: closed })
          const oldOptions = client.connect.mock.calls[0]![5] as AndroidConnectionOptions
          await connect(runtime)
          oldOptions.onClose?.()
          expect(closed).not.toHaveBeenCalled()
          expect(service.stop).not.toHaveBeenCalled()
          await runtime.close()
        },
      },
      {
        name: 'a delayed native stop finishes before the next start',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          await connect(runtime)
          const stop = deferred()
          service.stop.mockReturnValueOnce(stop.promise)
          const closing = runtime.close()
          await vi.waitFor(() => expect(service.stop).toHaveBeenCalledTimes(1))
          const next = connect(runtime)
          await Promise.resolve()
          expect(service.start).toHaveBeenCalledTimes(1)
          stop.resolve()
          await closing
          await next
          expect(service.start).toHaveBeenCalledTimes(2)
          await runtime.close()
        },
      },
    ], prepare)
  })

  it('reports native startup failure and releases resources on connection failures', async () => {
    await runScenarios([
      {
        name: 'native rejection prevents carrier setup and permits a fresh attempt',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          service.start.mockRejectedValueOnce(new Error('Android rejected the service'))
          await expect(connect(runtime)).rejects.toThrow('Android rejected the service')
          expect(client.connect).not.toHaveBeenCalled()
          await connect(runtime)
          expect(service.start).toHaveBeenCalledTimes(2)
          await runtime.close()
        },
      },
      {
        name: 'setup failure releases the foreground service',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          client.connect.mockRejectedValueOnce(new Error('handshake failed'))
          await expect(connect(runtime)).rejects.toThrow('handshake failed')
          expect(service.stop).toHaveBeenCalledTimes(1)
          await runtime.close()
          expect(service.stop).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'transport close failure still releases the foreground service',
        run: async () => {
          const runtime = new AndroidRemoteRuntime()
          await connect(runtime)
          client.close.mockRejectedValueOnce(new Error('close failed'))
          await expect(runtime.close()).rejects.toThrow('close failed')
          expect(service.stop).toHaveBeenCalledTimes(1)
        },
      },
    ], prepare)
  })
})

it('binds upload RPC callers to one connection generation, including reconnect to the same Host', async () => {
  const runtime = new AndroidRemoteRuntime()
  client.supportsBinaryUpload.mockReturnValue(true)
  client.rpc.mockResolvedValue({ok:true})
  await connect(runtime)
  const first = runtime.createRpcCaller()
  expect(first.supportsBinaryUpload).toBe(true)
  await first('workspace.upload.open',{})
  await runtime.close()
  await connect(runtime)
  await expect(first('workspace.upload.chunk.binary',{})).rejects.toThrow('replaced')
  expect(client.rpc).toHaveBeenCalledTimes(1)
  const second = runtime.createRpcCaller()
  await second('workspace.upload.open',{})
  const options = client.connect.mock.calls.at(-1)![5] as AndroidConnectionOptions
  options.onClose?.({retryable:true})
  await expect(second('workspace.upload.commit',{})).rejects.toThrow('closed')
  expect(client.rpc).toHaveBeenCalledTimes(2)
  await runtime.close()
})
