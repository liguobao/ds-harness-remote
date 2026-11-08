import { describe, expect, it, vi } from 'vitest'
import {
  createOwnerPeerFactory,
  ownerPeerConstructor,
  type OwnerPeerLike,
  type OwnerPeerServiceLike,
} from '../src/owner-peer.js'

describe('owner Peer resolution', () => {
  it('prefers the official Peer export and reports the owner principal', () => {
    const owner = {}
    const Peer = vi.fn(function (this: Record<string, unknown>, _ctx: unknown, options: { principal: unknown; interactions?: string }) {
      this.options = options
      this.dispose = vi.fn()
    })
    const ctor = ownerPeerConstructor({ Peer })
    const factory = createOwnerPeerFactory(owner, ctor, undefined)
    const peer = factory() as OwnerPeerLike & { options?: { principal: unknown; interactions?: string } }
    expect(Peer).toHaveBeenCalledTimes(1)
    expect(Peer.mock.calls[0]![0]).toBe(owner)
    expect(peer.options).toEqual({ principal: { kind: 'owner' }, interactions: 'answer' })
  })

  it('accepts the legacy OperatorPeer export when Peer is absent', () => {
    const OperatorPeer = vi.fn(function (this: Record<string, unknown>) { this.dispose = vi.fn() })
    expect(ownerPeerConstructor({ OperatorPeer })).toBe(OperatorPeer)
    expect(ownerPeerConstructor({ Peer: 'not-a-function' })).toBeUndefined()
    expect(ownerPeerConstructor({})).toBeUndefined()
  })

  it('falls back to the Connection Host service when the Peer export is missing or throws', () => {
    const servicePeer = { dispose: vi.fn() }
    const createPeer = vi.fn(() => servicePeer)
    const connection: OwnerPeerServiceLike = { createPeer }
    const missingExport = createOwnerPeerFactory({}, undefined, connection)
    expect(missingExport()).toBe(servicePeer)
    expect(createPeer).toHaveBeenCalledWith({ principal: { kind: 'owner' }, interactions: 'answer' })

    const throwing = vi.fn(function () { throw new TypeError('unsupported Peer constructor') })
    const throwingFactory = createOwnerPeerFactory({}, ownerPeerConstructor({ Peer: throwing }), connection)
    expect(throwingFactory()).toBe(servicePeer)
    expect(throwing).toHaveBeenCalledTimes(1)
    expect(createPeer).toHaveBeenCalledTimes(2)
  })

  it('resolves undefined when no owner Peer mechanism is available', () => {
    const factory = createOwnerPeerFactory({}, undefined, undefined)
    expect(factory()).toBeUndefined()
    const failing: OwnerPeerServiceLike = { createPeer: () => { throw new Error('connection closed') } }
    expect(createOwnerPeerFactory({}, undefined, failing)()).toBeUndefined()
  })
})
