import { describe, expect, it, vi } from 'vitest'
import {
  AcpVirtualHarness,
  createAcpWorkspaceView,
  acpCwdWorkspaceId,
} from '../src/acp/virtual-harness.js'

function fakeAcp() {
  return {
    createSession: vi.fn(async (cwd: string) => ({ sessionId: 'acp_1', cwd })),
    prompt: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    listDirectory: vi.fn(async (path: string) => ({
      path,
      home: path,
      crumbs: [{ name: 'repo', path, hidden: false }],
      entries: [],
      truncated: false,
    })),
    openStream: vi.fn(async () => ({ close: async () => undefined })),
    respond: vi.fn(async () => ({})),
  }
}

describe('AcpVirtualHarness', () => {
  it('creates a cwd workspace and session with cursor ids', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const workspace = await target.selectOrCreateWorkspace('/workspace/repo')
    expect(workspace.workspaceId).toBe(acpCwdWorkspaceId('/workspace/repo'))
    expect(createAcpWorkspaceView('/workspace/repo').title).toBe('repo')

    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: workspace.workspaceId } },
    }, new AbortController().signal)
    expect(created).toMatchObject({ ok: true, value: { sessionId: 'cursor:acp_1' } })
    expect(client.createSession).toHaveBeenCalledWith('/workspace/repo', 'agent', expect.any(AbortSignal))

    const listed = await target.dispatch('session/list', { args: {} }, new AbortController().signal)
    expect(listed).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({
          sessionId: 'cursor:acp_1',
          blank: true,
          cwd: '/workspace/repo',
        })],
      },
    })
    await target.close()
  })

  it('forwards text prompts to Agent ACP', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal)

    const prompted = await target.dispatch('session/prompt', {
      args: { request: {
        sessionId: 'cursor:acp_1',
        content: [{ type: 'text', text: 'List files' }],
      } },
    }, new AbortController().signal)
    expect(prompted.ok).toBe(true)
    expect(client.prompt).toHaveBeenCalledWith('acp_1', 'List files', expect.any(AbortSignal))
    expect(client.openStream).toHaveBeenCalled()
    await target.close()
  })

  it('maps ApiProxy approval outcomes to ACP respond decisions', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal)

    // Seed a pending approval the same way stream frames would.
    ;(target as unknown as { pendingApprovals: Map<string, { requestHandle: string; sessionId: string }> })
      .pendingApprovals.set('req_1', { requestHandle: 'req_1', sessionId: 'cursor:acp_1' })

    await expect(target.api.respond({
      type: 'client-response',
      rpcId: 'req_1' as never,
      result: { ok: true, value: 'allowed-once' },
    })).resolves.toEqual({ accepted: true })
    expect(client.respond).toHaveBeenCalledWith('req_1', 'allow-once')
    await target.close()
  })
})
