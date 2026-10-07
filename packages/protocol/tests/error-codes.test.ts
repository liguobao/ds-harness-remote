import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it } from 'vitest'
import {
  errorCodes,
  errorCodeSchema,
  rpcErrorPayloadSchema,
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

  it('validates the canonical error code schema', async () => {
    await runScenarios([
      {
        name: 'errorCodeSchema validates the full canonical set',
        run: () => {
          for (const code of errorCodes) {
            expect(errorCodeSchema.parse(code)).toBe(code)
          }
        },
      },
      {
        name: 'errorCodeSchema rejects unknown codes',
        run: () => {
          expect(() => errorCodeSchema.parse('UNKNOWN_CODE')).toThrow()
        },
      },
    ])
  }, 10000)

})

describe('rpcErrorPayloadSchema', () => {
  it('accepts canonical and subsystem RPC error codes', async () => {
    await runScenarios([
      {
        name: 'accepts all canonical error codes',
        run: () => {
          for (const code of errorCodes) {
            expect(() =>
              rpcErrorPayloadSchema.parse({
                requestId: 'req-1',
                code,
                message: 'test error',
              }),
            ).not.toThrow()
          }
        },
      },
      {
        name: 'accepts subsystem-specific error codes as valid wire strings',
        run: () => {
          const subsystemCodes = [
            'TRANSFER_NOT_FOUND',
            'FEATURE_NOT_SUPPORTED',
            'CODEX_UNAVAILABLE',
            'FILE_VIEWER_UNAVAILABLE',
            'FILE_VIEWER_ERROR',
          ]
          for (const code of subsystemCodes) {
            expect(() =>
              rpcErrorPayloadSchema.parse({
                requestId: 'req-1',
                code,
                message: 'test error',
              }),
            ).not.toThrow()
          }
        },
      },
    ])
  }, 10000)

  it('rejects missing required fields', () => {
    expect(() => rpcErrorPayloadSchema.parse({
      code: 'INVALID_MESSAGE',
      message: 'test',
    })).toThrow()
  })
})

describe('createRpcError', () => {
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

  it('validates owned-role registration requests', async () => {
    await runScenarios([
      {
        name: 'accepts a valid host-owned-role registration request',
        run: () => {
          expect(() =>
            registerOwnedRoleRequestSchema.parse({
              v: 1,
              device: validHostDescriptor,
            }),
          ).not.toThrow()
        },
      },
      {
        name: 'accepts a valid client-owned-role registration request',
        run: () => {
          expect(() =>
            registerOwnedRoleRequestSchema.parse({
              v: 1,
              device: {
                ...validHostDescriptor,
                role: 'client',
              },
            }),
          ).not.toThrow()
        },
      },
      {
        name: 'rejects wrong protocol version',
        run: () => {
          expect(() =>
            registerOwnedRoleRequestSchema.parse({
              v: 2,
              device: validHostDescriptor,
            }),
          ).toThrow()
        },
      },
      {
        name: 'rejects device with missing required fields',
        run: () => {
          expect(() =>
            registerOwnedRoleRequestSchema.parse({
              v: 1,
              device: {
                deviceId: '01HXYZABCDEF01234567890ABC',
                name: 'Workstation',
              },
            }),
          ).toThrow()
        },
      },
      {
        name: 'rejects extra fields in envelope',
        run: () => {
          expect(() =>
            registerOwnedRoleRequestSchema.parse({
              v: 1,
              device: validHostDescriptor,
              extra: 'not allowed',
            }),
          ).toThrow()
        },
      },
    ])
  }, 25000)

})

describe('§24 default limit constants', () => {
  it('preserves timeout and resource limit defaults', async () => {
    await runScenarios([
      {
        name: 'has correct timeout values',
        run: () => {
          expect(HELLO_TIMEOUT_MS).toBe(5_000)
          expect(HOST_REGISTRATION_CODE_TTL_MS).toBe(10 * 60_000)
          expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(25_000)
          expect(HEARTBEAT_DISCONNECT_MS).toBe(75_000)
          expect(TRANSFER_IDLE_MS).toBe(2 * 60_000)
        },
      },
      {
        name: 'has correct limit values',
        run: () => {
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
        },
      },
    ])
  }, 10000)

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
})
