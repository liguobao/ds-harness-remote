import { describe, expect, it } from 'vitest'
import { projectTurnError, turnEndReason } from '../src/codex/turn-end-reason.js'

describe('turnEndReason', () => {
  it('preserves upstream failure message and codex_error_info', () => {
    expect(turnEndReason({
      status: 'failed',
      error: {
        message: "You've hit your usage limit. Try again at 12:34 PM.",
        codex_error_info: 'usage_limit_exceeded',
      },
    })).toEqual({
      kind: 'error',
      error: {
        message: "You've hit your usage limit. Try again at 12:34 PM.",
        code: 'usage_limit_exceeded',
        codex_error_info: 'usage_limit_exceeded',
      },
    })
  })

  it('falls back to a generic failure when error details are missing', () => {
    expect(turnEndReason({ status: 'failed' })).toEqual({
      kind: 'error',
      error: { message: 'CodeX turn failed.', code: 'codex-turn-failed' },
    })
    expect(projectTurnError(null)).toEqual({
      message: 'CodeX turn failed.',
      code: 'codex-turn-failed',
    })
  })

  it('maps interrupted statuses without inventing an error payload', () => {
    expect(turnEndReason({ status: 'interrupted' })).toEqual({ kind: 'interrupted' })
    expect(turnEndReason({ status: 'completed' })).toEqual({ kind: 'completed' })
  })
})
