import { describe, expect, it, vi } from 'vitest'
import { AntigravityExecutor } from '../src/acp/adapters/antigravity/executor.js'
import { AntigravityService } from '../src/acp/adapters/antigravity/service.js'

describe('AntigravityService and Executor', () => {
  it('assembles arguments correctly for single execution and session resume', async () => {
    const executor = new AntigravityExecutor()
    let capturedArgs: string[] = []

    vi.spyOn(executor as any, 'executeOnce').mockImplementation(async (_prompt, opts: any) => {
      capturedArgs = [
        '-p', _prompt,
        ...(opts?.conversationId ? ['--conversation', opts.conversationId] : []),
        ...(opts?.continueLast ? ['-c'] : []),
        ...(opts?.skipPermissions ? ['--dangerously-skip-permissions'] : []),
      ]
      return { conversationId: opts?.conversationId ?? 'new-conv-456', output: 'result output', raw: {} }
    })

    const service = new AntigravityService(executor)

    // New session
    const { session, result } = await service.createSession('Hello', { skipPermissions: true })
    expect(result.output).toBe('result output')
    expect(session.conversationId).toBe('new-conv-456')
    expect(capturedArgs).toContain('--dangerously-skip-permissions')
    expect(capturedArgs).not.toContain('--conversation')

    // Prompt in session (resume)
    await session.prompt('Follow up question')
    expect(capturedArgs).toContain('--conversation')
    expect(capturedArgs).toContain('new-conv-456')

    session.close()
  })
})
