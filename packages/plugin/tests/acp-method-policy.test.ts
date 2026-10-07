import { describe, expect, it } from 'vitest'
import { ACP_METHOD_ALLOWLIST, parseAcpCall } from '../src/acp/method-policy.js'
import { RpcError } from '../src/safe-error.js'

describe('ACP method policy', () => {
  it('exposes a fixed allowlist including initialize', () => {
    expect(ACP_METHOD_ALLOWLIST).toEqual([
      'dsh/toolCall',
      'dsh/sessionModels',
      'dsh/selectModel',
      'initialize',
      'session/new',
      'session/load',
      'session/prompt',
      'session/cancel',
      'dsh/directoryList',
      'dsh/workspaceList',
      'dsh/sessionList',
      'dsh/sessionHistory',
    ])
  })

  it('accepts text-only prompts and rejects unknown methods', () => {
    expect(parseAcpCall('initialize', { protocolVersion: 1, backend: 'antigravity' })).toMatchObject({ method: 'initialize' })
    expect(parseAcpCall('session/new', { cwd: '/tmp/project', backend: 'antigravity' })).toMatchObject({ method: 'session/new' })
    expect(parseAcpCall('session/load', { sessionId: 'sess_1', backend: 'antigravity' })).toMatchObject({ method: 'session/load' })
    expect(parseAcpCall('session/prompt', {
      sessionId: 'sess_1',
      prompt: [{ type: 'text', text: 'hello' }],
    })).toMatchObject({ method: 'session/prompt' })

    expect(() => parseAcpCall('process/exec', {})).toThrow(RpcError)
    for (const method of ['toString', 'constructor', '__proto__']) {
      expect(() => parseAcpCall(method, {})).toThrow(RpcError)
    }
    expect(() => parseAcpCall('session/prompt', {
      sessionId: 'sess_1',
      prompt: [{ type: 'image', data: 'aaaa' }],
    })).toThrow(RpcError)
    expect(() => parseAcpCall('session/new', {
      cwd: '/tmp/project',
      mcpServers: [{ name: 'blocked' }],
    })).toThrow(RpcError)
  })
})
