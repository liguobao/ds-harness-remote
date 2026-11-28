import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { IdentityInvalidError } from '../src/identity-store.js'
import { RpcError } from '../src/rpc-router.js'
import { en, ru, uk, zh, type LocaleKey } from '../src/client-locale.js'
import { messageOf, startupErrorMessage } from '../src/client/presentation.js'
import { safeErrorCode, safeStartupError, workspaceFileFailure, workspaceFileFailureReason } from '../src/safe-error.js'
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

  it('extracts only known workspace file reasons from error details', () => {
    const denial = workspaceFileFailure('WORKSPACE_PATH_DENIED', 'The requested workspace path is unavailable.', 'symlink')
    expect(denial).toMatchObject({ code: 'WORKSPACE_PATH_DENIED', details: { reason: 'symlink' } })
    expect(workspaceFileFailureReason(denial)).toBe('symlink')
    expect(workspaceFileFailureReason(Object.assign(denial, { details: { reason: 'C:\\secret\\file.txt' } }))).toBeUndefined()
    expect(workspaceFileFailureReason(new RpcError('WORKSPACE_PATH_DENIED', 'denied'))).toBeUndefined()
    expect(workspaceFileFailureReason(null)).toBeUndefined()
  })

  it('preserves bounded multi-entry and foreign-plugin STORAGE_CONFLICT diagnostics while stripping unsafe paths', () => {
    const tunnelConflict = new IdentityInvalidError(
      'Remote storage ownership could not be verified; nothing was moved. Legacy directory contains no Remote identity records and matches another Remote/tunnel plugin layout. Set legacyStorageRoot to false (or DSH_REMOTE_LEGACY_STORAGE_ROOT=false) to start with fresh ds-harness-remote storage. Unexpected entries "access.json", "bin", "machines.json" were found.',
      'STORAGE_CONFLICT',
    )
    expect(safeStartupError(tunnelConflict)).toEqual({
      code: 'STORAGE_CONFLICT',
      message: tunnelConflict.message,
    })

    const foreignOverflow = new IdentityInvalidError(
      'Remote storage ownership could not be verified; nothing was moved. Legacy directory contains no Remote identity records and may belong to another plugin. Set legacyStorageRoot to false (or DSH_REMOTE_LEGACY_STORAGE_ROOT=false) to skip legacy migration, or inspect it manually. Unexpected entries "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8" (and 3 more) were found.',
      'STORAGE_CONFLICT',
    )
    expect(safeStartupError(foreignOverflow)).toEqual({
      code: 'STORAGE_CONFLICT',
      message: foreignOverflow.message,
    })

    const mixedMulti = new IdentityInvalidError(
      'Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually. Unexpected entries "extra.txt", "foreign.txt" were found.',
      'STORAGE_CONFLICT',
    )
    expect(safeStartupError(mixedMulti)).toEqual({
      code: 'STORAGE_CONFLICT',
      message: mixedMulti.message,
    })

    const unsafePathLeak = new IdentityInvalidError(
      'Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually. Unexpected entry "C:\\Users\\alice\\access.json" was found.',
      'STORAGE_CONFLICT',
    )
    expect(safeStartupError(unsafePathLeak)).toEqual({
      code: 'STORAGE_CONFLICT',
      message: 'Remote storage ownership could not be verified; nothing was moved. Inspect the legacy directory manually.',
    })

    for (const dict of [en, zh, ru, uk]) {
      const translate = (key: LocaleKey, params?: Record<string, string | number>) => {
        let template: string = dict[key]
        for (const [k, v] of Object.entries(params ?? {})) {
          template = template.replaceAll(`{${k}}`, String(v))
        }
        return template
      }
      const renderedTunnel = startupErrorMessage(safeStartupError(tunnelConflict), translate)
      expect(renderedTunnel).toContain('"access.json", "bin", "machines.json"')
      expect(renderedTunnel).toContain('legacyStorageRoot: false')

      const renderedOverflow = messageOf(
        { code: 'STORAGE_CONFLICT', message: foreignOverflow.message },
        translate,
      )
      expect(renderedOverflow).toContain('"a1"')
      expect(renderedOverflow).toContain('3')

      const renderedMixed = startupErrorMessage(safeStartupError(mixedMulti), translate)
      expect(renderedMixed).toContain('"extra.txt", "foreign.txt"')
    }
  })
})
