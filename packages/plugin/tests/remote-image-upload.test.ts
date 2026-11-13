import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import { RemoteTypertGateway } from '../src/remote-typert-gateway.js'
import type { RemoteClientCore } from '@dsh-remote/client-core'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteImageUploadFetch, REMOTE_IMAGE_UPLOAD_MAX_BYTES } from '../src/remote-image-upload-client.js'
import { PluginRouteBridge } from '../src/plugin-route-bridge.js'
import { createPluginRouteDispatcher } from '../src/plugin-route-dispatcher.js'

const base = 'http://localhost/'
function carrier(mode = 'remote', connected = true) {
  const calls: { method: string; payload: any }[] = []
  const original = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    calls.push(body)
    return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value:
      body.method === 'status' ? { mode, connected, target: { deviceId: 'host-1' } } : { status: 200, json: { ok: true, value: { receiptId: 'remote-receipt' } } } } })
  }) as unknown as typeof fetch
  return { original, calls, upload: createRemoteImageUploadFetch(original, base) }
}

describe('Remote prompt image upload', () => {
  it('transports exact bytes and keeps the Host receipt', async () => {
    const { upload, calls } = carrier()
    const response = await upload(`${base}api/session/uploadFileBinary?sessionId=s&mediaType=image/png&name=a.png`, {
      method: 'POST', body: new Uint8Array([0, 128, 255]),
    })
    expect(await response.json()).toEqual({ ok: true, value: { receiptId: 'remote-receipt' } })
    expect(calls[1]?.payload.targetDeviceId).toBe('host-1')
    expect(calls[1]?.payload.body.payload).toEqual({ sessionId: 's', mediaType: 'image/png', name: 'a.png', data: 'AID/' })
  })
  it('uploads a 9 MiB image through ordered bounded transfer frames exactly once', async () => {
    const bytes = Buffer.alloc(9 * 1024 * 1024, 173)
    const native = vi.fn(async (request: Request) => {
      expect(Buffer.from(await request.arrayBuffer()).equals(bytes)).toBe(true)
      return Response.json({ ok: true, value: { receiptId: 'large-image' } })
    })
    const plugin = new PluginRouteBridge(createPluginRouteDispatcher(() => ({ createSharedFetchHandler: () => ({ fetch: native }) }), () => undefined))
    const host = new HarnessRemoteBridge({} as LocalTypertGateway, vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined,
      body => plugin.call({ route: 'api/session/uploadFileBinary', body }, true))
    const rpc = vi.fn(async (method: string, params: unknown) => {
      expect(Buffer.byteLength(JSON.stringify(params))).toBeLessThan(4 * 1024 * 1024)
      switch (method) {
        case 'harness.remote.transfer.open': return host.openTransfer(params)
        case 'harness.remote.transfer.chunk': return host.appendTransfer(params)
        case 'harness.remote.transfer.commit': return host.commitTransfer(params)
        case 'harness.remote.transfer.close': return host.closeTransfer(params)
        default: throw new Error(`Unexpected direct call: ${method}`)
      }
    })
    const remote = new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore)
    await expect(remote.dispatch('remoteImages/upload', { args: { endpoint: 'image', payload: {
      sessionId: 's', mediaType: 'image/png', data: bytes.toString('base64'),
    } } }, new AbortController().signal)).resolves.toEqual({ ok: true, value: { status: 200, json: { ok: true, value: { receiptId: 'large-image' } } } })
    expect(native).toHaveBeenCalledOnce()
    expect(rpc.mock.calls.filter(([method]) => method === 'harness.remote.transfer.commit')).toHaveLength(1)
  })
  it('keeps local uploads on their original carrier', async () => {
    let count = 0
    const original = vi.fn(async (_input: unknown, init?: RequestInit) => {
      count++
      if (count === 1) {
        const request = JSON.parse(String(init?.body))
        return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { mode: 'local' } } })
      }
      expect(init?.body).toBe('local-image')
      return new Response('local-response')
    }) as unknown as typeof fetch
    const upload = createRemoteImageUploadFetch(original, base)
    expect(await (await upload(`${base}api/session/uploadFileBinary?sessionId=s&mediaType=image/png`, { method: 'POST', body: 'local-image' })).text()).toBe('local-response')
    expect(original).toHaveBeenCalledTimes(2)
  })
  it('fails closed offline and bounds input before any upload mutation', async () => {
    const offline = carrier('remote', false)
    await expect(offline.upload(`${base}api/session/uploadFileBinary?sessionId=s&mediaType=image/png`, { method: 'POST', body: 'x' })).rejects.toThrow('disconnected')
    expect(offline.calls).toHaveLength(1)
    const online = carrier()
    await expect(online.upload(`${base}api/session/uploadFileBinary?sessionId=s&mediaType=image/png`, { method: 'POST', body: new ReadableStream({ start(controller) { const chunk = new Uint8Array(1024 * 1024); for (let i = 0; i <= REMOTE_IMAGE_UPLOAD_MAX_BYTES / chunk.length; i++) controller.enqueue(chunk); controller.close() } }), duplex: 'half' } as RequestInit & { duplex: string })).rejects.toThrow('transfer safety limit')
    expect(online.calls).toHaveLength(1)
  })
  it('dispatches only validated image bytes to the official Host streaming route', async () => {
    const peer = {}
    const handler = vi.fn(async (request: Request, actualPeer: unknown) => {
      expect(actualPeer).toBe(peer)
      expect(new URL(request.url).searchParams.get('sessionId')).toBe('s')
      expect(request.headers.get('content-type')).toBe('application/octet-stream')
      expect([...new Uint8Array(await request.arrayBuffer())]).toEqual([0, 128, 255])
      return Response.json({ ok: true, value: { receiptId: 'host' } })
    })
    const bridge = new PluginRouteBridge(createPluginRouteDispatcher(() => ({ createSharedFetchHandler: () => ({ fetch: handler }) }), () => undefined, peer))
    const input = { route: 'api/session/uploadFileBinary', body: { endpoint: 'image', payload: { sessionId: 's', mediaType: 'image/png', data: 'AID/' } } }
    expect(await bridge.call(input)).toEqual({ status: 200, json: { ok: true, value: { receiptId: 'host' } } })
    await expect(bridge.call({ ...input, body: { ...input.body, payload: { ...input.body.payload, mediaType: 'text/html' } } })).rejects.toThrow()
    await expect(bridge.call({ ...input, body: { ...input.body, payload: { ...input.body.payload, path: '/tmp/x' } } })).rejects.toThrow()
    expect(handler).toHaveBeenCalledOnce()
  })
})
