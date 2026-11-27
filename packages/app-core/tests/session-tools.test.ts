import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import { RemoteTypertGateway, type AgentAcpClient, type RemoteClientCore } from '@dsh-remote/client-core'
import type { AgentAcpFrameData } from '@dsh-remote/protocol'
import { sessionPermissions } from '../src/services/session-permissions'
import type { RemoteSession } from '../src/types'
import { AcpSessionTools, HarnessSessionTools, OFFICE_PREVIEW_MAX_RESPONSE_BYTES, OFFICE_PREVIEW_TIMEOUT_MS } from '../src/services/session-tools'

function setup(value: unknown) {
  const rpc = vi.fn(async (..._args: unknown[]) => ({ ok: true, value }))
  const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))
  return { rpc, tools }
}

describe('native session tools', () => {
  it('validates the Host permission catalog without inventing grants or fallback', async () => {
    await runScenarios([
      {
        name: 'reads the new process catalog without changing permissions',
        run: async () => {
          const options = [
            { value: 'read-only', name: 'Read only' },
            { value: 'auto', name: 'Auto' },
          ]
          const { tools, rpc } = setup({ options })
          await expect(tools.permissionOptions()).resolves.toEqual(options)
          expect(rpc).toHaveBeenCalledWith(
            'harness.remote.call',
            { endpoint: 'permissionPresets/catalog', payload: { args: {} } },
            expect.any(AbortSignal),
            undefined,
          )
          expect(rpc).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'rejects malformed catalogs instead of inventing permission grants',
        run: async () => {
          await expect(setup({ options: [{ value: 'full' }] }).tools.permissionOptions()).rejects.toMatchObject(
            { code: 'INVALID_MESSAGE' },
          )
        },
      },
      {
        name: 'keeps Host rejection authoritative without falling back to a different endpoint',
        run: async () => {
          const rpc = vi.fn(async () => ({
            ok: false,
            error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported', details: {} },
          }))
          const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))
          await expect(tools.permissionOptions()).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
          expect(rpc).toHaveBeenCalledTimes(1)
        },
      },
    ])
  }, 15000)

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
      ['harness.remote.call', { endpoint: 'officeKit/generation', payload: { args: {} } }],
      ['harness.remote.call', { endpoint: 'officeKit/render', payload: { args: { workspaceFileScopeId: 's1', path: 'docs/report.docx', priority: 'foreground' } } }],
    ])
    expect(rpc.mock.calls.map(call => call[3])).toEqual([
      undefined,
      { maxResponseBytes: 4 * Math.ceil(512 / 3) + 64 * 1024 },
      { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS },
      { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS, maxResponseBytes: OFFICE_PREVIEW_MAX_RESPONSE_BYTES },
    ])
  })

  it('falls back from officeKit/* to legacy officeToPdf/* only when the endpoint is unregistered', async () => {
    await runScenarios([
      {
        name: 'falls back to officeToPdf/* on endpoint registration failures and locks subsequent calls',
        run: async () => {
          const fallbackCodes = [
            'METHOD_NOT_ALLOWED',
            'METHOD_NOT_FOUND',
            'unknown-endpoint',
            'gateway/invocation-unavailable',
            'gateway/method-unavailable',
            'gateway/definition-unavailable',
          ] as const
          for (const code of fallbackCodes) {
            const rpc = vi.fn(async (_method: string, request: { endpoint: string }, _signal?: AbortSignal, _options?: unknown) => {
              if (request.endpoint.startsWith('officeKit/')) {
                return { ok: false, error: { code, message: 'Unavailable', details: {} } }
              }
              if (request.endpoint === 'officeToPdf/generation') return { ok: true, value: 'gen-legacy' }
              if (request.endpoint === 'officeToPdf/render') return { ok: true, value: { generation: 'gen-legacy' } }
              throw new Error(`Unexpected endpoint: ${request.endpoint}`)
            })
            const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))

            await expect(tools.officeGeneration()).resolves.toBe('gen-legacy')
            await expect(tools.renderOfficePdf('s1', 'docs/report.docx')).resolves.toEqual({ generation: 'gen-legacy' })

            expect(rpc.mock.calls.map(call => (call[1] as { endpoint: string }).endpoint)).toEqual([
              'officeKit/generation',
              'officeToPdf/generation',
              'officeToPdf/render',
            ])
            expect(rpc.mock.calls.map(call => call[3])).toEqual([
              { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS },
              { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS },
              { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS, maxResponseBytes: OFFICE_PREVIEW_MAX_RESPONSE_BYTES },
            ])
          }
        },
      },
      {
        name: 'falls back from renderOfficePdf directly and locks subsequent officeGeneration',
        run: async () => {
          const rpc = vi.fn(async (_method: string, request: { endpoint: string }) => {
            if (request.endpoint === 'officeKit/render') {
              return { ok: false, error: { code: 'gateway/invocation-unavailable', message: 'Unavailable', details: {} } }
            }
            if (request.endpoint === 'officeToPdf/render') return { ok: true, value: { generation: 'gen-legacy' } }
            if (request.endpoint === 'officeToPdf/generation') return { ok: true, value: 'gen-legacy' }
            throw new Error(`Unexpected endpoint: ${request.endpoint}`)
          })
          const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))

          await expect(tools.renderOfficePdf('s1', 'docs/report.docx')).resolves.toEqual({ generation: 'gen-legacy' })
          await expect(tools.officeGeneration()).resolves.toBe('gen-legacy')

          expect(rpc.mock.calls.map(call => (call[1] as { endpoint: string }).endpoint)).toEqual([
            'officeKit/render',
            'officeToPdf/render',
            'officeToPdf/generation',
          ])
        },
      },
      {
        name: 'does not fall back after officeKit has already been confirmed for this connection',
        run: async () => {
          const rpc = vi.fn(async (_method: string, request: { endpoint: string }) => {
            if (request.endpoint === 'officeKit/generation') return { ok: true, value: 'gen-kit' }
            return { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Denied', details: {} } }
          })
          const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))

          await expect(tools.officeGeneration()).resolves.toBe('gen-kit')
          await expect(tools.renderOfficePdf('s1', 'docs/report.docx')).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
          expect(rpc.mock.calls.map(call => (call[1] as { endpoint: string }).endpoint)).toEqual([
            'officeKit/generation',
            'officeKit/render',
          ])
        },
      },
      {
        name: 'does not fall back on non-registration failures such as document-render/failed or service-unavailable',
        run: async () => {
          const nonFallbackCodes = [
            { code: 'document-render/failed', transportError: false },
            { code: 'gateway/service-unavailable', transportError: false },
            { code: 'RPC_TIMEOUT', transportError: true },
            { code: 'RPC_ABORTED', transportError: true },
          ] as const
          for (const entry of nonFallbackCodes) {
            const rpc = vi.fn(async (_method: string, _request: { endpoint: string }) => {
              if (entry.transportError) throw Object.assign(new Error(entry.code), { code: entry.code })
              return { ok: false, error: { code: entry.code, message: 'Failed', details: {} } }
            })
            const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))

            await expect(tools.officeGeneration()).rejects.toMatchObject({ code: entry.code })
            expect(rpc).toHaveBeenCalledTimes(1)
            expect((rpc.mock.calls[0]?.[1] as { endpoint: string }).endpoint).toBe('officeKit/generation')
          }
        },
      },
      {
        name: 'does not fall back when the caller aborts the request',
        run: async () => {
          const controller = new AbortController()
          const rpc = vi.fn(async () => {
            controller.abort()
            return { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Cancelled', details: {} } }
          })
          const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))

          await expect(tools.officeGeneration(controller.signal)).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
          expect(rpc).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'does not lock the namespace when both officeKit/* and officeToPdf/* fail',
        run: async () => {
          let phase: 'both-unavailable' | 'officeKit-ready' = 'both-unavailable'
          const rpc = vi.fn(async (_method: string, request: { endpoint: string }) => {
            if (phase === 'both-unavailable') {
              const code = request.endpoint.startsWith('officeKit/') ? 'gateway/invocation-unavailable' : 'METHOD_NOT_ALLOWED'
              return { ok: false, error: { code, message: 'Unavailable', details: {} } }
            }
            if (request.endpoint === 'officeKit/generation') return { ok: true, value: 'gen-2' }
            throw new Error(`Unexpected endpoint: ${request.endpoint}`)
          })
          const tools = new HarnessSessionTools(new RemoteTypertGateway({ rpc } as unknown as RemoteClientCore))

          await expect(tools.officeGeneration()).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
          phase = 'officeKit-ready'
          await expect(tools.officeGeneration()).resolves.toBe('gen-2')

          expect(rpc.mock.calls.map(call => (call[1] as { endpoint: string }).endpoint)).toEqual([
            'officeKit/generation',
            'officeToPdf/generation',
            'officeKit/generation',
          ])
        },
      },
    ])
  }, 15000)
  it('executes slash lines through the Host command dispatcher', async () => {
    const { tools, rpc } = setup({ result: { kind: 'success', text: 'exported to zip' } })
    const outcome = await tools.executeCommand('s1', '/export')
    expect(outcome).toEqual({ kind: 'success', text: 'exported to zip' })
    expect(rpc).toHaveBeenCalledWith('harness.remote.call', { endpoint: 'commands/execute', payload: { args: { agentId: 's1', line: '/export', submittedAttachments: [] } } }, expect.any(AbortSignal), undefined)
  })

  it('forwards job observation with offset and stops jobs via job.kill', async () => {
    const { tools, rpc } = setup({ outcome: 'requested' })
    const killOutcome = await tools.killJob('s1', 'job-123')
    expect(killOutcome).toEqual({ outcome: 'requested' })
    expect(rpc).toHaveBeenCalledWith(
      'harness.remote.call',
      { endpoint: 'job/kill', payload: { args: { request: { sessionId: 's1', jobId: 'job-123' } } } },
      expect.any(AbortSignal),
      undefined,
    )
  })
})

describe('permission projection versions', () => {
  const session = (permissions?: unknown) => ({ sessionId: 's1', updatedAt: 0, running: false, blank: false, projections: { values: { permissions } } }) as RemoteSession
  it('preserves only authoritative inline permission selections', async () => {
    await runScenarios([
      {
        name: 'preserves old inline options including deployment-specific presets',
        run: () => {
          const permissions = {
            currentValue: 'custom-preset',
            options: [{ value: 'custom-preset', name: 'Configured preset' }],
          }
          expect(sessionPermissions(session(permissions))).toEqual(permissions)
        },
      },
      {
        name: 'preserves 0.1.6 current selection while the separate catalog is loading',
        run: () => {
          expect(sessionPermissions(session({ currentValue: 'read-only' }))).toEqual({
            currentValue: 'read-only',
            options: [],
          })
        },
      },
      {
        name: 'never invents a current permission for missing or malformed projections',
        run: () => {
          expect(sessionPermissions(session())).toBeUndefined()
          expect(sessionPermissions(session({ options: [] }))).toBeUndefined()
        },
      },
    ])
  }, 15000)

})

it.each(['claude', 'hermes', 'kimi'] as const)('%s uses its own scope for files and terminal operations', async backend => {
  const workspaceToolCall = vi.fn(async () => ({}))
  const tools = new AcpSessionTools({ workspaceToolCall } as unknown as import('@dsh-remote/client-core').AgentAcpClient, backend)
  await tools.listFiles(`${backend}:saved`, '.')
  expect(workspaceToolCall).toHaveBeenLastCalledWith('saved', backend, 'workspaceFiles/list', { workspaceFileScopeId: `${backend}:saved`, path: '.' }, undefined)
  await tools.createTerminal(`${backend}:saved`, 'term', 80, 24)
  expect(workspaceToolCall).toHaveBeenLastCalledWith('saved', backend, 'terminal/create', { agentId: `${backend}:saved`, request: { id: 'term', cols: 80, rows: 24 } }, undefined)
})

it('finishes an ACP tool stream waiting for its next frame without yielding a phantom value', async () => {
  let end!: () => void
  const close = vi.fn(async () => undefined)
  const openStream = vi.fn(async (_sessionId: string, onFrame: (frame: AgentAcpFrameData) => void, onClose: () => void) => {
    end = onClose
    onFrame({
      streamId: 'terminal-stream',
      frame: { method: 'dsh/workspaceTool', params: { value: { type: 'ready' } } },
    })
    return { close }
  })
  const tools = new AcpSessionTools({ openStream } as unknown as AgentAcpClient, 'cursor')
  const stream = await tools.followTerminal('cursor:session', 'terminal', 'attachment', new AbortController().signal)
  const iterator = stream[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toEqual({ done: false, value: { type: 'ready' } })
  const pending = iterator.next()
  end()
  await expect(pending).resolves.toEqual({ done: true, value: undefined })
  await stream.close()
  expect(close).toHaveBeenCalledOnce()
})
