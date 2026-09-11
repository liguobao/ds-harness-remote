import { describe, expect, it } from 'vitest'
import {
  errorCodes,
  errorCodeSchema,
  rpcErrorPayloadSchema,
  controlErrorPayloadSchema,
  createRpcError,
  registerOwnedRoleRequestSchema,
  transportCapabilities,
  harnessCapabilityValues,
  HELLO_TIMEOUT_MS,
  HOST_REGISTRATION_CODE_TTL_MS,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_DISCONNECT_MS,
  MAX_PENDING_RPC_PER_CONNECTION,
  MAX_PENDING_PERMISSION_PER_SESSION,
  MAX_ICE_CANDIDATES_PER_CONNECTION,
  MAX_ACTIVE_TRANSFERS_PER_DIRECTION,
  TRANSFER_IDLE_MS,
  MAX_RPC_TEXT_INPUT_BYTES,
  MAX_FILEVIEWER_RANGE_BYTES,
  MAX_FILEVIEWER_DIRECTORY_ENTRIES,
  MAX_ALPHA_STREAMS_PER_CONNECTION,
  MIN_REPLAY_WINDOW_EVENTS,
  MIN_REPLAY_WINDOW_MS,
} from '../src/index.js'

describe('errorCodes', () => {
  it('contains all §23 + §17 + transfer wire-protocol error codes', () => {
    const expected = [
      'INVALID_MESSAGE', 'UNSUPPORTED_VERSION', 'CAPABILITY_NOT_SUPPORTED',
      'METHOD_NOT_FOUND', 'METHOD_NOT_ALLOWED', 'REQUEST_CONFLICT',
      'FRAME_TOO_LARGE', 'RATE_LIMITED',
      'AUTH_REQUIRED', 'AUTH_INVALID', 'ACCOUNT_AUTH_REQUIRED', 'TOKEN_EXPIRED',
      'DEVICE_NOT_FOUND', 'DEVICE_REVOKED', 'DEVICE_OWNERSHIP_REQUIRED',
      'MEMBERSHIP_REQUIRED', 'PEER_IDENTITY_MISMATCH',
      'HOST_REGISTRATION_CODE_NOT_FOUND', 'HOST_REGISTRATION_CODE_EXPIRED',
      'HOST_REGISTRATION_CODE_CONSUMED',
      'HOST_OFFLINE', 'CONNECTION_NOT_FOUND', 'CONNECTION_FAILED',
      'CONNECTION_REPLACED', 'P2P_FAILED', 'TURN_UNAVAILABLE',
      'RELAY_UNAVAILABLE', 'SLOW_CONSUMER', 'SECURE_CHANNEL_FAILED',
      'HARNESS_UNAVAILABLE', 'HARNESS_VERSION_INCOMPATIBLE', 'RESPONSE_TOO_LARGE',
      'SESSION_NOT_FOUND', 'SESSION_NOT_READY', 'AGENT_BUSY',
      'PERMISSION_DENIED', 'PERMISSION_NOT_PENDING', 'RPC_TIMEOUT',
      'FULL_RESYNC_REQUIRED', 'INTERNAL_ERROR',
    ] as const
    for (const code of expected) {
      expect(errorCodes).toContain(code)
    }
  })

  it('contains no duplicate codes', () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length)
  })

  it('errorCodeSchema validates the full canonical set', () => {
    for (const code of errorCodes) {
      expect(errorCodeSchema.parse(code)).toBe(code)
    }
  })

  it('errorCodeSchema rejects unknown codes', () => {
    expect(() => errorCodeSchema.parse('UNKNOWN_CODE')).toThrow()
  })
})

describe('rpcErrorPayloadSchema', () => {
  it('accepts all canonical error codes', () => {
    for (const code of errorCodes) {
      expect(() => rpcErrorPayloadSchema.parse({
        requestId: 'req-1',
        code,
        message: 'test error',
      })).not.toThrow()
    }
  })

  it('accepts subsystem-specific error codes as valid wire strings', () => {
    const subsystemCodes = [
      'TRANSFER_NOT_FOUND', 'FEATURE_NOT_SUPPORTED',
      'CODEX_UNAVAILABLE', 'FILE_VIEWER_UNAVAILABLE', 'FILE_VIEWER_ERROR',
    ]
    for (const code of subsystemCodes) {
      expect(() => rpcErrorPayloadSchema.parse({
        requestId: 'req-1',
        code,
        message: 'test error',
      })).not.toThrow()
    }
  })

  it('rejects empty code', () => {
    expect(() => rpcErrorPayloadSchema.parse({
      requestId: 'req-1',
      code: '',
      message: 'test',
    })).toThrow()
  })

  it('rejects missing required fields', () => {
    expect(() => rpcErrorPayloadSchema.parse({
      code: 'INVALID_MESSAGE',
      message: 'test',
    })).toThrow()
  })
})

describe('controlErrorPayloadSchema', () => {
  it('accepts canonical error codes', () => {
    expect(() => controlErrorPayloadSchema.parse({
      code: 'HOST_OFFLINE',
      message: 'Host is not connected',
    })).not.toThrow()
  })

  it('accepts connectionId for scoped errors', () => {
    expect(() => controlErrorPayloadSchema.parse({
      code: 'CONNECTION_REPLACED',
      message: 'replaced',
      connectionId: 'conn-1',
    })).not.toThrow()
  })
})

describe('createRpcError', () => {
  it('creates a valid rpc.error message with canonical code', () => {
    const error = createRpcError('req-1', 'METHOD_NOT_FOUND', 'Unknown method')
    expect(error.type).toBe('rpc.error')
    expect(error.payload.code).toBe('METHOD_NOT_FOUND')
    expect(error.payload.requestId).toBe('req-1')
  })

  it('creates a valid rpc.error message with subsystem code', () => {
    const error = createRpcError('req-1', 'CODEX_UNAVAILABLE', 'App Server not ready')
    expect(error.payload.code).toBe('CODEX_UNAVAILABLE')
  })
})

describe('registerOwnedRoleRequestSchema', () => {
  const validHostDescriptor = {
    deviceId: '01HXYZABCDEF01234567890ABC',
    name: 'Workstation',
    role: 'host' as const,
    platform: 'linux',
    identityKey: 'A'.repeat(42) + 'A',
    clientVersion: '0.4.11',
  }

  it('accepts a valid host-owned-role registration request', () => {
    expect(() => registerOwnedRoleRequestSchema.parse({
      v: 1,
      device: validHostDescriptor,
    })).not.toThrow()
  })

  it('accepts a valid client-owned-role registration request', () => {
    expect(() => registerOwnedRoleRequestSchema.parse({
      v: 1,
      device: {
        ...validHostDescriptor,
        role: 'client',
      },
    })).not.toThrow()
  })

  it('rejects wrong protocol version', () => {
    expect(() => registerOwnedRoleRequestSchema.parse({
      v: 2,
      device: validHostDescriptor,
    })).toThrow()
  })

  it('rejects device with missing required fields', () => {
    expect(() => registerOwnedRoleRequestSchema.parse({
      v: 1,
      device: {
        deviceId: '01HXYZABCDEF01234567890ABC',
        name: 'Workstation',
      },
    })).toThrow()
  })

  it('rejects extra fields in envelope', () => {
    expect(() => registerOwnedRoleRequestSchema.parse({
      v: 1,
      device: validHostDescriptor,
      extra: 'not allowed',
    })).toThrow()
  })
})

describe('§24 default limit constants', () => {
  it('has correct timeout values', () => {
    expect(HELLO_TIMEOUT_MS).toBe(5_000)
    expect(HOST_REGISTRATION_CODE_TTL_MS).toBe(10 * 60_000)
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(25_000)
    expect(HEARTBEAT_DISCONNECT_MS).toBe(75_000)
    expect(TRANSFER_IDLE_MS).toBe(2 * 60_000)
  })

  it('has correct limit values', () => {
    expect(MAX_PENDING_RPC_PER_CONNECTION).toBe(128)
    expect(MAX_PENDING_PERMISSION_PER_SESSION).toBe(16)
    expect(MAX_ICE_CANDIDATES_PER_CONNECTION).toBe(256)
    expect(MAX_ACTIVE_TRANSFERS_PER_DIRECTION).toBe(2)
    expect(MAX_RPC_TEXT_INPUT_BYTES).toBe(64 * 1024)
    expect(MAX_FILEVIEWER_RANGE_BYTES).toBe(512 * 1024)
    expect(MAX_FILEVIEWER_DIRECTORY_ENTRIES).toBe(1_000)
    expect(MAX_ALPHA_STREAMS_PER_CONNECTION).toBe(16)
    expect(MIN_REPLAY_WINDOW_EVENTS).toBe(10_000)
    expect(MIN_REPLAY_WINDOW_MS).toBe(15 * 60_000)
  })

  it('heartbeat disconnect is 3x the interval', () => {
    expect(HEARTBEAT_DISCONNECT_MS).toBe(DEFAULT_HEARTBEAT_INTERVAL_MS * 3)
  })
})

describe('capability constants', () => {
  it('transportCapabilities matches §14 data plane negotiation set', () => {
    expect(transportCapabilities).toEqual([
      'transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay',
    ])
  })

  it('harnessCapabilityValues matches §17 universe of known values', () => {
    expect(harnessCapabilityValues).toEqual([
      'harness.api.v1',
      'harness.api.transfer.v1',
      'harness.remote.v1',
      'harness.remote.v3',
      'harness.remote.transfer.v1',
      'fileviewer.read.v1',
      'codex.appserver.v1',
      'codex.appserver.transfer.v1',
    ])
  })

  it('no overlap between transport and harness capability values', () => {
    const overlap = transportCapabilities.filter(c => (harnessCapabilityValues as readonly string[]).includes(c))
    expect(overlap).toEqual([])
  })

  it('no duplicates within each set', () => {
    expect(new Set(transportCapabilities).size).toBe(transportCapabilities.length)
    expect(new Set(harnessCapabilityValues).size).toBe(harnessCapabilityValues.length)
  })
})
