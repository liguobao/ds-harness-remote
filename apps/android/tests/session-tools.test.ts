import { describe, expect, it, vi } from 'vitest'
import { RemoteTypertGateway, type RemoteClientCore } from '@dsh-remote/client-core'
import { sessionPermissions } from '../src/services/session-permissions'
import type { RemoteSession } from '../src/types'
import { HarnessSessionTools, OFFICE_PREVIEW_MAX_RESPONSE_BYTES, OFFICE_PREVIEW_TIMEOUT_MS } from '../src/services/session-tools'

function setup(value: unknown) {
  const rpc = vi.fn(async (..._args: unknown[]) => ({ ok: true, value }))
  const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))
  return { rpc, tools }
}

describe('native session tools', () => {
  it('reads the new process catalog without changing permissions', async () => {
    const options = [{ value: 'read-only', name: 'Read only' }, { value: 'auto', name: 'Auto' }]
    const { tools, rpc } = setup({ options })
    await expect(tools.permissionOptions()).resolves.toEqual(options)
    expect(rpc).toHaveBeenCalledWith('harness.remote.call', { endpoint: 'permissionPresets/catalog', payload: { args: {} } }, expect.any(AbortSignal), undefined)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed catalogs instead of inventing permission grants', async () => {
    await expect(setup({ options: [{ value: 'full' }] }).tools.permissionOptions()).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })
  it('keeps Host rejection authoritative without falling back to a different endpoint', async () => {
    const rpc = vi.fn(async () => ({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported', details: {} } }))
    const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))
    await expect(tools.permissionOptions()).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('uses the official Session lookup for file listing and bounded reads', async () => {
    const { tools, rpc } = setup({})
    await tools.listFiles('s1', 'src')
    await tools.readFile('s1', 'src/main.ts', 201)
    expect(rpc.mock.calls.map(call => call.slice(0, 2))).toMatchObject([
      ['harness.remote.call', { endpoint: 'workspaceFiles/list', payload: { args: { workspaceFileScopeId: 's1', path: 'src' } } }],
      ['harness.remote.call', { endpoint: 'workspaceFiles/read', payload: { args: { workspaceFileScopeId: 's1', path: 'src/main.ts', range: { offset: 201, limit: 200 } } } }],
    ])
  })
  it('addresses the workspace root as a non-empty path the Host accepts', async () => {
    const { tools, rpc } = setup({})
    await tools.listFiles('s1', '')
    expect(rpc.mock.calls[0]?.slice(0, 2)).toMatchObject([
      'harness.remote.call', { endpoint: 'workspaceFiles/list', payload: { args: { workspaceFileScopeId: 's1', path: '.' } } },
    ])
  })
  it('reads byte ranges and converts Office previews with their own deadline', async () => {
    const { tools, rpc } = setup({})
    await tools.statFile('s1', 'assets/logo.png')
    await tools.readBytes('s1', 'assets/logo.png', 0, 512)
    await tools.officeGeneration()
    await tools.renderOfficePdf('s1', 'docs/report.docx')
    expect(rpc.mock.calls.map(call => call.slice(0, 2))).toMatchObject([
      ['harness.remote.call', { endpoint: 'workspaceFiles/stat', payload: { args: { workspaceFileScopeId: 's1', path: 'assets/logo.png' } } }],
      ['harness.remote.call', { endpoint: 'workspaceFiles/readBytes', payload: { args: { workspaceFileScopeId: 's1', path: 'assets/logo.png', range: { offset: 0, length: 512 } } } }],
      ['harness.remote.call', { endpoint: 'officeToPdf/generation', payload: { args: {} } }],
      ['harness.remote.call', { endpoint: 'officeToPdf/render', payload: { args: { workspaceFileScopeId: 's1', path: 'docs/report.docx', priority: 'foreground' } } }],
    ])
    expect(rpc.mock.calls.map(call => call[3])).toEqual([
      undefined,
      { maxResponseBytes: 4 * Math.ceil(512 / 3) + 64 * 1024 },
      { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS },
      { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS, maxResponseBytes: OFFICE_PREVIEW_MAX_RESPONSE_BYTES },
    ])
  })
  it('loads the human-invocable skill catalog with modelInvocable flags', async () => {
    const rawSkills = [
      { name: 'office-docx', description: 'Word docs', modelInvocable: true },
      { name: 'backup', description: 'Internal backup', modelInvocable: false },
      { invalid: true },
    ]
    const { tools, rpc } = setup({ skills: rawSkills })
    const rows = await tools.listSkills('s1')
    expect(rows).toEqual([
      { name: 'office-docx', description: 'Word docs', modelInvocable: true },
      { name: 'backup', description: 'Internal backup', modelInvocable: false },
    ])
    expect(rpc).toHaveBeenCalledWith('harness.remote.call', { endpoint: 'skills/list', payload: { args: { request: { sessionId: 's1' } } } }, expect.any(AbortSignal), undefined)
  })
  it('executes slash lines through the Host command dispatcher', async () => {
    const { tools, rpc } = setup({ result: { kind: 'success', text: 'exported to zip' } })
    const outcome = await tools.executeCommand('s1', '/export')
    expect(outcome).toEqual({ kind: 'success', text: 'exported to zip' })
    expect(rpc).toHaveBeenCalledWith('harness.remote.call', { endpoint: 'commands/execute', payload: { args: { agentId: 's1', line: '/export', submittedAttachments: [] } } }, expect.any(AbortSignal), undefined)
  })
})


describe('permission projection versions', () => {
  const session = (permissions?: unknown) => ({ sessionId: 's1', updatedAt: 0, running: false, blank: false, projections: { values: { permissions } } }) as RemoteSession
  it('preserves old inline options including deployment-specific presets', () => {
    const permissions = { currentValue: 'custom-preset', options: [{ value: 'custom-preset', name: 'Configured preset' }] }
    expect(sessionPermissions(session(permissions))).toEqual(permissions)
  })
  it('preserves 0.1.6 current selection while the separate catalog is loading', () => {
    expect(sessionPermissions(session({ currentValue: 'read-only' }))).toEqual({ currentValue: 'read-only', options: [] })
  })
  it('never invents a current permission for missing or malformed projections', () => {
    expect(sessionPermissions(session())).toBeUndefined()
    expect(sessionPermissions(session({ options: [] }))).toBeUndefined()
  })
})
