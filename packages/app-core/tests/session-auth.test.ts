import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it } from 'vitest'
import { isSessionAuthError, RemoteApiError } from '../src/lib/errors'
import { AccountRequiredError } from '../src/services/server-session-manager'

describe('isSessionAuthError', () => {
  it('requires sign-in only for account and token failures', async () => {
    await runScenarios([
      {
        name: 'matches account / token failures that require sign-in',
        run: () => {
          expect(isSessionAuthError(new AccountRequiredError('reauth'))).toBe(true)
          expect(isSessionAuthError(new RemoteApiError('AUTH_INVALID', 'bad'))).toBe(true)
          expect(isSessionAuthError(new RemoteApiError('TOKEN_EXPIRED', 'expired'))).toBe(true)
          expect(isSessionAuthError(new RemoteApiError('DEVICE_REVOKED', 'revoked'))).toBe(true)
        },
      },
      {
        name: 'ignores unrelated failures',
        run: () => {
          expect(isSessionAuthError(new RemoteApiError('CONNECTION_FAILED', 'down', undefined, true))).toBe(
            false,
          )
          expect(isSessionAuthError(new RemoteApiError('HOST_OFFLINE', 'offline'))).toBe(false)
          expect(isSessionAuthError(new Error('network request failed'))).toBe(false)
        },
      },
    ])
  }, 10000)

})
