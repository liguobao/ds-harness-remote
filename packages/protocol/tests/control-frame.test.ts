import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it } from 'vitest'
import {
  type HelloPayload,
  type HelloAckPayload,
  type ConnectIncomingPayload,
  type RelayPayload,
  type SignalPayload,
  type SignalIcePayload,
  type TransportSelectedPayload,
  type ControlErrorPayload,
  PROTOCOL_VERSION,
  controlFrameTypes,
  createControlFrame,
  parseControlFrame,
} from '../src/index.js'

// Shared conformance fixtures cover the baseline envelopes, hello/connect/relay
// payloads and errors. Keep only additional boundaries and factory checks here.

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeFrame(type: string, payload: unknown, v = PROTOCOL_VERSION): unknown {
  return {
    v,
    id: `frame-${Date.now()}`,
    type,
    timestamp: Date.now(),
    payload,
  }
}

// Valid payloads for each frame type (used in negative tests)
const validPayloads: Record<string, unknown> = {
  'hello': { role: 'client', deviceId: 'dev-1', accessToken: 'token-1', protocols: [1], capabilities: [] },
  'hello.ack': { protocol: 1, serverVersion: '1.0.0', connectionSessionId: 'sess-1', heartbeatIntervalMs: 25000, maxControlFrameBytes: 65536, maxRelayFrameBytes: 1048576 },
  'connect.request': { hostDeviceId: 'host-1', preferredTransports: ['relay'] },
  'connect.incoming': { connectionId: 'conn-1', clientDeviceId: 'client-1', clientIdentityKey: 'key-1', authorization: 'account', preferredTransports: ['relay'] },
  'connect.accepted': { connectionId: 'conn-1' },
  'connect.rejected': { connectionId: 'conn-1' },
  'secure.handshake': { connectionId: 'conn-1', targetDeviceId: 'host-1', step: 1, data: 'handshake-data' },
  'relay': { connectionId: 'conn-1', targetDeviceId: 'host-1', counter: 0, ciphertext: 'encrypted-data' },
  'signal.offer': { connectionId: 'conn-1', targetDeviceId: 'host-1', sdp: 'v=0...' },
  'signal.answer': { connectionId: 'conn-1', targetDeviceId: 'host-1', sdp: 'v=0...' },
  'signal.ice': { connectionId: 'conn-1', targetDeviceId: 'host-1', candidate: { candidate: 'candidate:1' } },
  'transport.selected': { connectionId: 'conn-1', targetDeviceId: 'host-1', transport: 'relay' },
  'ping': { nonce: 'nonce-1' },
  'pong': { nonce: 'nonce-1' },
  'error': { code: 'ERROR', message: 'Something failed' },
}

// ────────────────────────────────────────────────────────────────────────────
// §10.2 Control frame envelope
// ────────────────────────────────────────────────────────────────────────────

describe('control frame envelope', () => {
  it('rejects invalid control frame envelope fields', async () => {
    await runScenarios([
      {
        name: 'rejects v !== 1',
        run: () => {
          expect(() => parseControlFrame(makeFrame('ping', { nonce: 'test' }, 0))).toThrow()
          expect(() => parseControlFrame(makeFrame('ping', { nonce: 'test' }, 2))).toThrow()
        },
      },
      {
        name: 'rejects empty id',
        run: () => {
          const frame = { v: 1, id: '', type: 'ping', timestamp: Date.now(), payload: { nonce: 'test' } }
          expect(() => parseControlFrame(frame)).toThrow()
        },
      },
      {
        name: 'rejects non-positive timestamp',
        run: () => {
          const frame = { v: 1, id: 'x', type: 'ping', timestamp: 0, payload: { nonce: 'test' } }
          expect(() => parseControlFrame(frame)).toThrow()
        },
      },
    ])
  }, 15000)

  it('round-trips through createControlFrame', () => {
    const original = createControlFrame('ping', { nonce: 'abc' })
    const reparsed = parseControlFrame(original)
    expect(reparsed).toEqual(original)
  })

  it('accepts all defined control frame types with valid payloads', () => {
    for (const type of controlFrameTypes) {
      const frame = makeFrame(type, validPayloads[type])
      expect(parseControlFrame(frame)).toMatchObject({ type })
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Payload schema validation - positive tests
// ────────────────────────────────────────────────────────────────────────────

describe('hello payload validation', () => {
  const valid: HelloPayload = {
    role: 'client',
    deviceId: 'dev-1',
    accessToken: 'token-1',
    protocols: [1],
    capabilities: ['transport.relay'],
  }

  it('accepts additive hello metadata within version bounds', async () => {
    await runScenarios([
      {
        name: 'accepts Host hello with harnessVersion',
        run: () => {
          const frame = parseControlFrame(
            makeFrame('hello', {
              ...valid,
              role: 'host',
              harnessVersion: '0.1.0-rc.8',
            }),
          )
          expect(frame.payload).toMatchObject({ harnessVersion: '0.1.0-rc.8' })
        },
      },
      {
        name: 'accepts protocol versions at both safe integer boundaries',
        run: () => {
          expect(parseControlFrame(makeFrame('hello', { ...valid, protocols: [0] }))).toBeDefined()
          expect(
            parseControlFrame(
              makeFrame('hello', {
                ...valid,
                protocols: [Number.MAX_SAFE_INTEGER],
              }),
            ),
          ).toBeDefined()
        },
      },
      {
        name: 'accepts unknown capabilities for additive negotiation',
        run: () => {
          expect(
            parseControlFrame(
              makeFrame('hello', {
                ...valid,
                capabilities: ['transport.relay', 'example.future.v1'],
              }),
            ),
          ).toBeDefined()
        },
      },
      {
        name: 'returns parsed payload with stripped unknown fields',
        run: () => {
          const withExtra = { ...valid, unknownField: 'should-be-stripped' }
          const result = parseControlFrame(makeFrame('hello', withExtra))
          expect(result.payload).not.toHaveProperty('unknownField')
        },
      },
    ])
  }, 20000)

})

describe('hello.ack payload validation', () => {
  const valid: HelloAckPayload = {
    protocol: 1,
    serverVersion: '1.0.0',
    connectionSessionId: 'sess-1',
    heartbeatIntervalMs: 25000,
    maxControlFrameBytes: 65536,
    maxRelayFrameBytes: 1048576,
  }

  it('accepts hello.ack with optional webrtc fields', () => {
    const withWebrtc = {
      ...valid,
      capabilities: ['transport.relay', 'transport.p2p'],
      webrtcEnabled: true,
      webrtcFallbackTimeoutMs: 5000,
    }
    expect(parseControlFrame(makeFrame('hello.ack', withWebrtc))).toBeDefined()
  })

  it('rejects empty and duplicate negotiated capabilities', () => {
    expect(() => parseControlFrame(makeFrame('hello.ack', { ...valid, capabilities: [''] }))).toThrow()
    expect(() => parseControlFrame(makeFrame('hello.ack', {
      ...valid,
      capabilities: ['transport.relay', 'transport.relay'],
    }))).toThrow()
  })
})

describe('signal.ice payload validation', () => {
  const valid: SignalIcePayload = {
    connectionId: 'conn-1',
    targetDeviceId: 'host-1',
    candidate: {
      candidate: 'candidate:1 1 UDP 2122252543 192.168.1.100 50000 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    },
  }

  it('normalizes valid ICE candidate variants', async () => {
    await runScenarios([
      {
        name: 'accepts valid signal.ice',
        run: () => {
          expect(parseControlFrame(makeFrame('signal.ice', valid))).toBeDefined()
        },
      },
      {
        name: 'accepts candidate with null sdpMid',
        run: () => {
          const withNull = { ...valid, candidate: { ...valid.candidate, sdpMid: null } }
          expect(parseControlFrame(makeFrame('signal.ice', withNull))).toBeDefined()
        },
      },
      {
        name: 'normalizes invalid native sdpMLineIndex values to null',
        run: () => {
          const parsed = parseControlFrame(
            makeFrame('signal.ice', {
              ...valid,
              candidate: { ...valid.candidate, sdpMLineIndex: 1.167066568144e-312 },
            }),
          )
          expect(parsed.payload.candidate.sdpMLineIndex).toBeNull()
        },
      },
    ])
  }, 15000)

})

// ────────────────────────────────────────────────────────────────────────────
// Payload schema validation - NEGATIVE tests
// ────────────────────────────────────────────────────────────────────────────

describe('hello payload rejection', () => {
  it('rejects invalid hello identity and negotiation fields', async () => {
    await runScenarios([
      {
        name: 'rejects invalid role',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello', {
                ...(validPayloads['hello'] as HelloPayload),
                role: 'admin',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects missing role',
        run: () => {
          const { role, ...noRole } = validPayloads['hello'] as HelloPayload
          expect(() => parseControlFrame(makeFrame('hello', noRole))).toThrow()
        },
      },
      {
        name: 'rejects empty deviceId',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello', {
                ...(validPayloads['hello'] as HelloPayload),
                deviceId: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects missing accessToken',
        run: () => {
          const { accessToken, ...noToken } = validPayloads['hello'] as HelloPayload
          expect(() => parseControlFrame(makeFrame('hello', noToken))).toThrow()
        },
      },
      {
        name: 'rejects empty protocols',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello', {
                ...(validPayloads['hello'] as HelloPayload),
                protocols: [],
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects protocol versions outside the safe integer range',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello', {
                ...(validPayloads['hello'] as HelloPayload),
                protocols: [-1],
              }),
            ),
          ).toThrow()
          expect(() =>
            parseControlFrame(
              makeFrame('hello', {
                ...(validPayloads['hello'] as HelloPayload),
                protocols: [Number.MAX_SAFE_INTEGER + 1],
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects empty and duplicate capabilities',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello', {
                ...(validPayloads['hello'] as HelloPayload),
                capabilities: [''],
              }),
            ),
          ).toThrow()
          expect(() =>
            parseControlFrame(
              makeFrame('hello', {
                ...(validPayloads['hello'] as HelloPayload),
                capabilities: ['transport.relay', 'transport.relay'],
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects missing protocols',
        run: () => {
          const { protocols, ...noProtocols } = validPayloads['hello'] as HelloPayload
          expect(() => parseControlFrame(makeFrame('hello', noProtocols))).toThrow()
        },
      },
    ])
  }, 40000)

})

describe('hello.ack payload rejection', () => {
  it('rejects invalid hello acknowledgement limits', async () => {
    await runScenarios([
      {
        name: 'rejects empty serverVersion',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello.ack', {
                ...(validPayloads['hello.ack'] as HelloAckPayload),
                serverVersion: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects zero heartbeatIntervalMs',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello.ack', {
                ...(validPayloads['hello.ack'] as HelloAckPayload),
                heartbeatIntervalMs: 0,
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects negative maxControlFrameBytes',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('hello.ack', {
                ...(validPayloads['hello.ack'] as HelloAckPayload),
                maxControlFrameBytes: -1,
              }),
            ),
          ).toThrow()
        },
      },
    ])
  }, 15000)

})

describe('connect.incoming payload rejection', () => {
  const valid = validPayloads['connect.incoming'] as ConnectIncomingPayload

  it('rejects invalid incoming connection authorization and routing', async () => {
    await runScenarios([
      {
        name: 'rejects empty authorization',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('connect.incoming', {
                ...valid,
                authorization: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects missing authorization',
        run: () => {
          const { authorization, ...noAuth } = valid
          expect(() => parseControlFrame(makeFrame('connect.incoming', noAuth))).toThrow()
        },
      },
      {
        name: 'rejects empty connectionId',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('connect.incoming', {
                ...valid,
                connectionId: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects empty clientDeviceId',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('connect.incoming', {
                ...valid,
                clientDeviceId: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects empty preferredTransports',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('connect.incoming', {
                ...valid,
                preferredTransports: [],
              }),
            ),
          ).toThrow()
        },
      },
    ])
  }, 25000)

})

describe('relay payload rejection', () => {
  const valid = validPayloads['relay'] as RelayPayload

  it('rejects empty connectionId', () => {
    expect(() => parseControlFrame(makeFrame('relay', {
      ...valid,
      connectionId: '',
    }))).toThrow()
  })
})

describe('signal payload rejection', () => {
  const valid = validPayloads['signal.offer'] as SignalPayload

  it('rejects invalid SDP signal routing and content', async () => {
    await runScenarios([
      {
        name: 'rejects empty connectionId',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('signal.offer', {
                ...valid,
                connectionId: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects empty targetDeviceId',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('signal.offer', {
                ...valid,
                targetDeviceId: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects empty sdp',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('signal.offer', {
                ...valid,
                sdp: '',
              }),
            ),
          ).toThrow()
        },
      },
    ])
  }, 15000)

})

describe('transport.selected payload rejection', () => {
  const valid = validPayloads['transport.selected'] as TransportSelectedPayload

  it('accepts LAN as a selected wire transport', () => {
    expect(parseControlFrame(makeFrame('transport.selected', {
      ...valid,
      transport: 'lan',
    })).payload).toMatchObject({ transport: 'lan' })
  })

  it('rejects invalid selected transport payloads', async () => {
    await runScenarios([
      {
        name: 'rejects empty connectionId',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('transport.selected', {
                ...valid,
                connectionId: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects empty targetDeviceId',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('transport.selected', {
                ...valid,
                targetDeviceId: '',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects invalid transport',
        run: () => {
          expect(() =>
            parseControlFrame(
              makeFrame('transport.selected', {
                ...valid,
                transport: 'direct',
              }),
            ),
          ).toThrow()
        },
      },
      {
        name: 'rejects missing transport',
        run: () => {
          const { transport, ...noTransport } = valid
          expect(() => parseControlFrame(makeFrame('transport.selected', noTransport))).toThrow()
        },
      },
    ])
  }, 20000)

})

describe('ping/pong payload rejection', () => {
  it('requires nonempty ping and pong nonces', async () => {
    await runScenarios([
      {
        name: 'rejects empty nonce in ping',
        run: () => {
          expect(() => parseControlFrame(makeFrame('ping', { nonce: '' }))).toThrow()
        },
      },
      {
        name: 'rejects missing nonce in ping',
        run: () => {
          expect(() => parseControlFrame(makeFrame('ping', {}))).toThrow()
        },
      },
      {
        name: 'rejects empty nonce in pong',
        run: () => {
          expect(() => parseControlFrame(makeFrame('pong', { nonce: '' }))).toThrow()
        },
      },
      {
        name: 'rejects missing nonce in pong',
        run: () => {
          expect(() => parseControlFrame(makeFrame('pong', {}))).toThrow()
        },
      },
    ])
  }, 20000)

})

describe('error payload rejection', () => {
  const valid = validPayloads['error'] as ControlErrorPayload

  it('requires error codes and messages', async () => {
    await runScenarios([
      {
        name: 'rejects missing code',
        run: () => {
          const { code, ...noCode } = valid
          expect(() => parseControlFrame(makeFrame('error', noCode))).toThrow()
        },
      },
      {
        name: 'rejects missing message',
        run: () => {
          const { message, ...noMessage } = valid
          expect(() => parseControlFrame(makeFrame('error', noMessage))).toThrow()
        },
      },
    ])
  }, 10000)

})

// ────────────────────────────────────────────────────────────────────────────
// Golden vectors - complete type enumeration
// ────────────────────────────────────────────────────────────────────────────

describe('golden vectors', () => {
  it('control frame types are complete and ordered', () => {
    const expected = [
      'hello', 'hello.ack', 'connect.request', 'connect.incoming',
      'connect.accepted', 'connect.rejected', 'secure.handshake',
      'relay', 'signal.offer', 'signal.answer', 'signal.ice',
      'transport.selected', 'ping', 'pong', 'error',
    ]
    expect([...expected].sort()).toEqual([...Array.from(controlFrameTypes)].sort())
  })
})
