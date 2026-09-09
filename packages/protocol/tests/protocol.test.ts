import { describe, expect, it } from 'vitest'
import {
  acceptNegotiatedCapabilities,
  SECURE_FRAGMENT_CHUNK_BYTES,
  SecureMessageCodec,
  controlFrameTypes,
  createControlFrame,
  createEvent,
  createRpcError,
  createRpcRequest,
  decodeMessage,
  encodeMessage,
  parseControlFrame,
  parseRemoteMessage,
  remoteEvents,
  rpcMethods,
  selectCapabilities,
  selectProtocolVersion,
} from '../src/index.js'

describe('protocol envelope', () => {
  it('contains every Server control frame used by protocol v1', () => {
    expect(controlFrameTypes).toContain('connect.incoming')
    expect(controlFrameTypes).not.toContain('pairing.resolved')
  })

  it('round-trips RPC messages', () => {
    const message = createRpcRequest('harness.api.call', { method: 'session.list', rpcId: 'native-1', payload: {} })
    expect(decodeMessage(encodeMessage(message))).toEqual(message)
  })

  it('advertises the native Harness bridge as closed protocol methods and events', () => {
    expect(rpcMethods).toContain('harness.api.call')
    expect(rpcMethods).toContain('harness.api.transfer.open')
    expect(rpcMethods).toContain('harness.api.stream.open')
    expect(rpcMethods).toContain('fileviewer.call')
    expect(remoteEvents).toContain('harness.api.frame')
    expect(remoteEvents).toContain('harness.api.stream.closed')
  })

  it('keeps Codex as an explicit Remote domain instead of a Harness session method', () => {
    expect(rpcMethods).toContain('codex.app.call')
    expect(rpcMethods).toContain('codex.app.transfer.commit')
    expect(remoteEvents).toContain('codex.app.frame')
    expect(remoteEvents).toContain('codex.app.stream.closed')
    expect(rpcMethods).not.toContain('harness.api.codex')
  })

  it('rejects unsupported protocol versions', () => {
    expect(() => parseRemoteMessage({ v: 2, id: 'x', type: 'rpc.request', timestamp: Date.now(), payload: {} })).toThrow()
  })

  it('selects the highest common hello protocol version', () => {
    expect(selectProtocolVersion([1])).toBe(1)
    expect(selectProtocolVersion([1, 3, 2], [1, 2])).toBe(2)
    expect(selectProtocolVersion([2, 3])).toBeUndefined()
  })

  it('selects supported capabilities and ignores unknown values', () => {
    expect(selectCapabilities(
      ['example.future.v1', 'transport.relay', 'transport.p2p'],
      ['transport.p2p', 'transport.turn', 'transport.relay'],
    )).toEqual(['transport.p2p', 'transport.relay'])
  })

  it('negotiates LAN independently from internet P2P', () => {
    expect(selectCapabilities(
      ['transport.lan', 'transport.p2p'],
      ['transport.lan'],
    )).toEqual(['transport.lan'])
  })

  it('accepts negotiated capabilities and uses a Relay-only legacy fallback', () => {
    expect(acceptNegotiatedCapabilities(
      ['transport.p2p', 'transport.relay'],
      ['transport.p2p'],
    )).toEqual(['transport.p2p'])
    expect(acceptNegotiatedCapabilities(['transport.relay'], undefined)).toEqual(['transport.relay'])
    expect(() => acceptNegotiatedCapabilities(
      ['transport.relay'],
      ['transport.p2p'],
    )).toThrow('did not offer')
  })

  it('carries event metadata and retryable RPC errors', () => {
    expect(createEvent('harness.api.frame', { streamId: 's1', frame: {} }, { seq: 7, sessionId: 's1' })).toMatchObject({
      payload: { seq: 7, sessionId: 's1', event: 'harness.api.frame' },
    })
    expect(createRpcError('r1', 'RATE_LIMITED', 'Busy', undefined, true)).toMatchObject({
      payload: { requestId: 'r1', retryable: true },
    })
    expect(createRpcRequest('harness.api.stream.close', { streamId: 'stream-1' }).payload.method).toBe('harness.api.stream.close')
  })

  it('creates and validates canonical control frames', () => {
    const frame = createControlFrame('hello', {
      role: 'client',
      deviceId: 'client-1',
      accessToken: 'secret',
      protocols: [1],
      clientVersion: '0.2.9',
      capabilities: ['transport.relay'],
    })
    expect(parseControlFrame(frame)).toEqual(frame)
    expect(() => parseControlFrame({ ...frame, v: 2 })).toThrow()
  })

  it('fragments large Noise plaintext and reassembles it with strict ordering', () => {
    const source = Uint8Array.from(
      { length: SECURE_FRAGMENT_CHUNK_BYTES * 2 + 37 },
      (_, index) => index % 251,
    )
    const encoder = new SecureMessageCodec()
    const frames = encoder.encode(source)
    expect(frames).toHaveLength(3)
    expect(frames.every(frame => frame.byteLength < 65_519)).toBe(true)

    const decoder = new SecureMessageCodec()
    expect(decoder.decode(frames[0]!)).toBeUndefined()
    expect(decoder.decode(frames[1]!)).toBeUndefined()
    expect(decoder.decode(frames[2]!)).toEqual(source)

    const outOfOrder = new SecureMessageCodec()
    expect(() => outOfOrder.decode(frames[1]!)).toThrow('Secure fragment sequence is invalid.')
    const small = new TextEncoder().encode('small message')
    expect(new SecureMessageCodec().decode(encoder.encode(small)[0]!)).toEqual(small)
  })
})
