import { describe, expect, it } from 'vitest'
import { isSessionAuthError, RemoteApiError } from '../src/lib/errors'
import { AccountRequiredError } from '../src/services/server-session-manager'

describe('isSessionAuthError', () => {
  it('matches account / token failures that require sign-in', () => {
    expect(isSessionAuthError(new AccountRequiredError('reauth'))).toBe(true)
    expect(isSessionAuthError(new RemoteApiError('AUTH_INVALID', 'bad'))).toBe(true)
    expect(isSessionAuthError(new RemoteApiError('TOKEN_EXPIRED', 'expired'))).toBe(true)
    expect(isSessionAuthError(new RemoteApiError('DEVICE_REVOKED', 'revoked'))).toBe(true)
  })

  it('ignores unrelated failures', () => {
    expect(isSessionAuthError(new RemoteApiError('CONNECTION_FAILED', 'down', undefined, true))).toBe(false)
    expect(isSessionAuthError(new RemoteApiError('HOST_OFFLINE', 'offline'))).toBe(false)
    expect(isSessionAuthError(new Error('network request failed'))).toBe(false)
  })
})
