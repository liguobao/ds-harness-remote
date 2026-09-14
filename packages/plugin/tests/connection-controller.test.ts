import { MAX_SECURE_MESSAGE_BYTES, createRpcRequest, createRpcResponse, type RemoteMessage } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionController, ConnectionRejectedError } from '../src/connection-controller.js'
import type { IdentityStore } from '../src/identity-store.js'
import type { RpcRouter } from '../src/rpc-router.js'
import type { AuthenticatedPeerChannel } from '../src/types.js'

describe('ConnectionController', () => {
  it('rejects an identity that is absent from local trust', async () => {
    const channel = fakeChannel()
    const controller = new ConnectionController(
      { isTrusted: () => false } as unknown as IdentityStore,
      () => ({ handle: vi.fn(), closePeerStreams: vi.fn() } as unknown as RpcRouter),
    )
    await expect(controller.accept(channel)).rejects.toBeInstanceOf(ConnectionRejectedError)
    expect(channel.close).toHaveBeenCalledWith('PEER_IDENTITY_MISMATCH')
  })

  it('keeps different Client devices connected and routes responses to their own channel', async () => {
    const routers = new Map<string, RpcRouter>()
    const controller = new ConnectionController(
      { isTrusted: () => true } as unknown as IdentityStore,
      context => {
        const response = createRpcRequest('harness.api.call', { connectionId: context.connectionId }) as RemoteMessage
        const router = {
          handle: vi.fn(async () => response),
          closePeerStreams: vi.fn(async () => undefined),
        } as unknown as RpcRouter
        routers.set(context.connectionId, router)
        return router
      },
    )
    const phone = fakeChannel('connection-phone', 'client-phone')
    const desktop = fakeChannel('connection-desktop', 'client-desktop')
    await controller.accept(phone)
    await controller.accept(desktop)

    expect(controller.connectionCount()).toBe(2)
    expect(controller.peerDeviceIds()).toEqual(['client-phone', 'client-desktop'])
    expect(controller.connectedPeers()).toEqual([
      { deviceId: 'client-phone' },
      { deviceId: 'client-desktop' },
    ])
    expect(controller.peerDeviceId()).toBeUndefined()
    expect(phone.close).not.toHaveBeenCalled()
    expect(desktop.close).not.toHaveBeenCalled()

    phone.push(createRpcRequest('harness.api.call', { method: 'session.list' }))
    desktop.push(createRpcRequest('harness.api.call', { method: 'host.describe' }))
    await vi.waitFor(() => {
      expect(phone.send).toHaveBeenCalledOnce()
      expect(desktop.send).toHaveBeenCalledOnce()
    })
    expect(routers.get('connection-phone')!.handle).toHaveBeenCalledOnce()
    expect(routers.get('connection-desktop')!.handle).toHaveBeenCalledOnce()
    expect(phone.send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ params: { connectionId: 'connection-phone' } }),
    }))
    expect(desktop.send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ params: { connectionId: 'connection-desktop' } }),
    }))
  })

  it('replaces only the previous connection from the same Client device', async () => {
    const routers = new Map<string, { handle: ReturnType<typeof vi.fn>; closePeerStreams: ReturnType<typeof vi.fn> }>()
    const controller = new ConnectionController(
      { isTrusted: () => true } as unknown as IdentityStore,
      context => {
        const router = {
          handle: vi.fn(async () => createRpcRequest('harness.api.call', {}) as RemoteMessage),
          closePeerStreams: vi.fn(async () => undefined),
        }
        routers.set(context.connectionId, router)
        return router as unknown as RpcRouter
      },
    )
    const firstPhone = fakeChannel('connection-phone-1', 'client-phone')
    const desktop = fakeChannel('connection-desktop', 'client-desktop')
    const nextPhone = fakeChannel('connection-phone-2', 'client-phone')
    await controller.accept(firstPhone)
    await controller.accept(desktop)
    await controller.accept(nextPhone)

    expect(firstPhone.close).toHaveBeenCalledWith('CONNECTION_REPLACED')
    expect(routers.get('connection-phone-1')!.closePeerStreams).toHaveBeenCalledOnce()
    expect(desktop.close).not.toHaveBeenCalled()
    expect(routers.get('connection-desktop')!.closePeerStreams).not.toHaveBeenCalled()
    expect(nextPhone.close).not.toHaveBeenCalled()
    expect(controller.connectionCount()).toBe(2)
    expect(controller.peerDeviceIds()).toEqual(['client-desktop', 'client-phone'])

    desktop.push(createRpcRequest('harness.api.call', { method: 'session.list' }))
    nextPhone.push(createRpcRequest('harness.api.call', { method: 'session.list' }))
    await vi.waitFor(() => {
      expect(desktop.send).toHaveBeenCalledOnce()
      expect(nextPhone.send).toHaveBeenCalledOnce()
    })
  })

  it('delivers stream events only through the connection that opened the stream', async () => {
    const publishers = new Map<string, (message: RemoteMessage) => Promise<void>>()
    const controller = new ConnectionController(
      { isTrusted: () => true } as unknown as IdentityStore,
      (context, send) => {
        publishers.set(context.connectionId, send)
        return {
          handle: vi.fn(),
          closePeerStreams: vi.fn(async () => undefined),
        } as unknown as RpcRouter
      },
    )
    const phone = fakeChannel('connection-phone', 'client-phone')
    const desktop = fakeChannel('connection-desktop', 'client-desktop')
    await controller.accept(phone)
    await controller.accept(desktop)

    const phoneFrame = createRpcRequest('harness.api.call', { streamId: 'phone-stream' }) as RemoteMessage
    await publishers.get('connection-phone')!(phoneFrame)

    expect(phone.send).toHaveBeenCalledWith(phoneFrame)
    expect(desktop.send).not.toHaveBeenCalled()
  })

  it('returns a small RPC error instead of silently dropping an oversized response', async () => {
    const oversized = createRpcResponse('request-1', { value: 'x'.repeat(MAX_SECURE_MESSAGE_BYTES) })
    const controller = new ConnectionController(
      { isTrusted: () => true } as unknown as IdentityStore,
      () => ({
        handle: vi.fn(async () => oversized),
        closePeerStreams: vi.fn(async () => undefined),
      } as unknown as RpcRouter),
    )
    const channel = fakeChannel()
    await controller.accept(channel)

    channel.push(createRpcRequest('harness.api.call', { method: 'session.history' }))

    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledOnce())
    expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'rpc.error',
      payload: expect.objectContaining({
        code: 'RESPONSE_TOO_LARGE',
        retryable: true,
      }),
    }))
    expect(channel.close).not.toHaveBeenCalled()
  })

  it('closes only the connection named by a Server connection error', async () => {
    const routers = new Map<string, { closePeerStreams: ReturnType<typeof vi.fn> }>()
    const controller = new ConnectionController(
      { isTrusted: () => true } as unknown as IdentityStore,
      context => {
        const router = {
          handle: vi.fn(),
          closePeerStreams: vi.fn(async () => undefined),
        }
        routers.set(context.connectionId, router)
        return router as unknown as RpcRouter
      },
    )
    const phone = fakeChannel('connection-phone', 'client-phone')
    const desktop = fakeChannel('connection-desktop', 'client-desktop')
    await controller.accept(phone)
    await controller.accept(desktop)

    await expect(controller.closeConnection('connection-phone', 'CONNECTION_FAILED')).resolves.toBe(true)

    expect(phone.close).toHaveBeenCalledWith('CONNECTION_FAILED')
    expect(routers.get('connection-phone')!.closePeerStreams).toHaveBeenCalledOnce()
    expect(desktop.close).not.toHaveBeenCalled()
    expect(routers.get('connection-desktop')!.closePeerStreams).not.toHaveBeenCalled()
    expect(controller.connectionCount()).toBe(1)
    await expect(controller.closeConnection('missing')).resolves.toBe(false)
  })
})

function fakeChannel(connectionId = 'connection-1', peerDeviceId = 'client-1'): AuthenticatedPeerChannel & { push(message: RemoteMessage): void } {
  let handler: (message: RemoteMessage) => void = () => undefined
  return {
    security: { protocol: 'Noise_IK_25519_ChaChaPoly_SHA256', connectionId, membershipId: 'membership-1' },
    peerDeviceId,
    peerIdentityKey: `key-${peerDeviceId}`,
    send: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    onMessage: vi.fn(next => { handler = next; return () => { handler = () => undefined } }),
    push: message => handler(message),
  }
}
