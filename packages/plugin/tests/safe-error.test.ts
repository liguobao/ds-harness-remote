import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { IdentityInvalidError } from '../src/identity-store.js'
import { RpcError } from '../src/rpc-router.js'
import { safeErrorCode, safeStartupError } from '../src/safe-error.js'
import { ServerCredentialsBusyError, ServerCredentialsInvalidError } from '../src/server-credentials.js'

describe('safeErrorCode', () => {
  it('returns stable codes without reading error messages', () => {
    expect(safeErrorCode(new RpcError('METHOD_NOT_ALLOWED', 'prompt=secret'))).toBe('METHOD_NOT_ALLOWED')
    expect(safeErrorCode(Object.assign(new Error('prompt=secret'), { code: 'ENOENT' }))).toBe('INTERNAL_ERROR')
  })

  it('classifies schema, startup, and unknown errors without leaking raw messages or paths', () => {
    const schemaError = z.string().safeParse(1)
    expect(schemaError.success).toBe(false)
    if (schemaError.success) throw new Error('Expected schema validation to fail.')

    expect(safeErrorCode(schemaError.error)).toBe('INVALID_MESSAGE')
    expect(safeErrorCode(new Error('prompt=secret'))).toBe('INTERNAL_ERROR')
    expect(safeErrorCode('prompt=secret')).toBe('INTERNAL_ERROR')

    expect(safeStartupError(new IdentityInvalidError('device public and private keys do not match'))).toEqual({
      code: 'IDENTITY_INVALID',
      message: 'device public and private keys do not match',
    })
    expect(safeStartupError(new IdentityInvalidError('device identity is invalid: Unexpected token secret-key-material'))).toEqual({
      code: 'IDENTITY_INVALID',
      message: 'device identity is invalid',
    })
    expect(safeStartupError(new IdentityInvalidError('device identity is locked by another process; stop other DSH instances and retry', 'IDENTITY_LOCKED'))).toEqual({
      code: 'IDENTITY_LOCKED',
      message: 'device identity is locked by another process; stop other DSH instances and retry',
    })
    expect(safeStartupError(new IdentityInvalidError(
      'Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually. Unexpected entry "server-credentials.json.bak-1793870140999" was found.',
      'STORAGE_CONFLICT',
    ))).toEqual({
      code: 'STORAGE_CONFLICT',
      message: 'Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually. Unexpected entry "server-credentials.json.bak-1793870140999" was found.',
    })
    expect(safeStartupError(new ServerCredentialsInvalidError('server credentials are invalid: access-token-secret'))).toEqual({
      code: 'SERVER_CREDENTIALS_INVALID',
      message: 'Local Remote server credentials are invalid.',
    })
    expect(safeStartupError(new ServerCredentialsBusyError())).toMatchObject({
      code: 'SERVER_CREDENTIALS_BUSY',
    })
    const fsError = Object.assign(new Error('EACCES: permission denied, open C:\\Users\\secret\\device.key'), { code: 'EACCES' })
    expect(safeStartupError(fsError)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Remote plugin failed to start.',
    })
  })
})
