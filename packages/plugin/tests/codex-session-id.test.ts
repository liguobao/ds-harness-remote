import { describe, expect, it } from 'vitest'
import { parseCodexSessionId, requireCodexSessionId } from '../src/codex/session-id.js'

describe('CodeX session ids', () => {
  it('parses codex thread ids without treating them as Harness ids', () => {
    expect(parseCodexSessionId('codex:thread_1')).toEqual({ sessionId: 'codex:thread_1', threadId: 'thread_1' })
    expect(parseCodexSessionId('harness:thread_1')).toBeUndefined()
  })
  it('rejects malformed ids with a stable code', () => {
    expect(() => requireCodexSessionId('codex:')).toThrowError(expect.objectContaining({ code: 'CODEX_SESSION_INVALID' }))
  })
})
