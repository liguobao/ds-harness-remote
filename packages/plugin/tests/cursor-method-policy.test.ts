import { describe, expect, it } from 'vitest'
import { CURSOR_APP_ALLOWLIST, parseCursorCall } from '../src/cursor/method-policy.js'
import { RpcError } from '../src/safe-error.js'

describe('Cursor method policy', () => {
  it('exposes a fixed allowlist', () => {
    expect(CURSOR_APP_ALLOWLIST).toEqual([
      'session/new',
      'session/load',
      'session/prompt',
      'session/cancel',
      'dsh/directoryList',
    ])
  })

  it('accepts text-only prompts and rejects unknown methods', () => {
    expect(parseCursorCall('session/prompt', {
      sessionId: 'sess_1',
      prompt: [{ type: 'text', text: 'hello' }],
    })).toMatchObject({ method: 'session/prompt' })

    expect(() => parseCursorCall('process/exec', {})).toThrow(RpcError)
    expect(() => parseCursorCall('session/prompt', {
      sessionId: 'sess_1',
      prompt: [{ type: 'image', data: 'aaaa' }],
    })).toThrow(RpcError)
    expect(() => parseCursorCall('session/new', {
      cwd: '/tmp/project',
      mcpServers: [{ name: 'blocked' }],
    })).toThrow(RpcError)
  })
})
