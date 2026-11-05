import { describe, expect, it } from 'vitest'
import {
  SERVER_SHUTDOWN_CLOSE_CODE,
  SERVER_SHUTDOWN_CLOSE_REASON,
  classifyControlClose,
  isHeartbeatTimeoutClose,
  isServerShutdownClose,
} from '../src/index.js'

describe('isServerShutdownClose', () => {
  it('accepts the self-hosted Server shutdown close', () => {
    expect(isServerShutdownClose(SERVER_SHUTDOWN_CLOSE_CODE, SERVER_SHUTDOWN_CLOSE_REASON)).toBe(true)
  })

  it('accepts the hosted Server historical 4001 shutdown alias', () => {
    expect(isServerShutdownClose(4001, 'server shutdown')).toBe(true)
    expect(isServerShutdownClose(1013, 'server shutdown')).toBe(true)
  })

  it('never treats a bare close code as a Server restart', () => {
    // The hosted Server uses 4009 for heartbeat expiry and 4001 for hello
    // timeouts, heartbeats and authorization failures.
    expect(isServerShutdownClose(4009, 'heartbeat timeout')).toBe(false)
    expect(isServerShutdownClose(4009, undefined)).toBe(false)
    expect(isServerShutdownClose(4001, 'CONNECTION_FAILED')).toBe(false)
    expect(isServerShutdownClose(4001, 'AUTH_INVALID')).toBe(false)
    expect(isServerShutdownClose(1006, '')).toBe(false)
  })

  it('matches the reason exactly, including surrounding whitespace from the wire', () => {
    expect(isServerShutdownClose(4009, '  server shutdown  ')).toBe(true)
    expect(isServerShutdownClose(4009, 'server shutdown now')).toBe(false)
    expect(isServerShutdownClose(4009, 'Server shutdown')).toBe(false)
  })
})

describe('isHeartbeatTimeoutClose', () => {
  it('matches the hosted Server heartbeat expiry and the documented 4001 variant', () => {
    expect(isHeartbeatTimeoutClose(4009, 'heartbeat timeout')).toBe(true)
    expect(isHeartbeatTimeoutClose(4001, 'CONNECTION_FAILED')).toBe(true)
  })

  it('does not match a Server shutdown', () => {
    expect(isHeartbeatTimeoutClose(4001, 'server shutdown')).toBe(false)
    expect(isHeartbeatTimeoutClose(4009, 'server shutdown')).toBe(false)
  })
})

describe('classifyControlClose', () => {
  it('classifies a shutdown close as retryable and retaining, not heartbeat', () => {
    expect(classifyControlClose(4001, 'server shutdown')).toEqual({
      serverShutdown: true, heartbeatTimeout: false, retryable: true, replaced: false,
    })
    expect(classifyControlClose(4009, 'server shutdown').serverShutdown).toBe(true)
  })

  it('classifies heartbeat expiry as retryable but never as a Server restart', () => {
    expect(classifyControlClose(4009, 'heartbeat timeout')).toEqual({
      serverShutdown: false, heartbeatTimeout: true, retryable: true, replaced: false,
    })
  })

  it('never retries replacement, revocation, protocol or authorization closes', () => {
    for (const [code, reason] of [[4003, 'connection replaced'], [4002, 'auth failed'], [4004, 'device revoked'], [4008, 'invalid control frame'], [4011, 'unsupported version']] as const) {
      const result = classifyControlClose(code, reason)
      expect(result.retryable, `${code} should not be retryable`).toBe(false)
    }
    expect(classifyControlClose(4003, 'connection replaced').replaced).toBe(true)
  })

  it('keeps ordinary network loss retryable', () => {
    for (const code of [1000, 1001, 1006, 1011, 1012]) {
      expect(classifyControlClose(code, '').retryable, `${code} should be retryable`).toBe(true)
    }
  })
})
