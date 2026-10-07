import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import type { CodexRemoteClient } from '@dsh-remote/client-core'
import {
  codexPermissionPresetFromResponse,
  loadCodexCatalog,
  readCodexHistoryPage,
} from '../src/services/codex'

describe('Android CodeX Remote projection', () => {
  it('prefers project/list workspaces and keeps unprojected Threads hidden', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'project/list') return {
        data: [{ id: 'project-1', name: 'Project', roots: [{ path: '/workspace/project' }], position: 0 }],
        nextCursor: null,
      }
      if (method === 'thread/list') return {
        data: [
          { id: 'thread-1', projectId: 'project-1', cwd: '/workspace/project', updatedAt: 20 },
          { id: 'thread-2', cwd: '/workspace/project/subdir', updatedAt: 10 },
          { id: 'hidden-thread', cwd: '/workspace/other', updatedAt: 30 },
        ],
        nextCursor: null,
      }
      throw new Error(`unexpected ${method}`)
    })

    const catalog = await loadCodexCatalog({ request } as unknown as CodexRemoteClient)

    expect(catalog.workspaces).toMatchObject([{
      workspaceId: 'codex:project:project-1',
      backend: 'codex',
      sessionIds: ['codex:thread-1', 'codex:thread-2'],
    }])
    expect(catalog.sessions.map(session => session.sessionId)).toEqual(['codex:thread-1', 'codex:thread-2'])
  })

  it('derives exact cwd workspaces for unavailable and empty project listings', async () => {
    const rows = ['empty', 'unsupported'] as const
    await runScenarios(
      rows.map((row, index) => {
        const projectListMode = row
        return {
          name: scenarioName('derives exact thread cwd workspaces when project/list is %s', row, index),
          run: async () => {
            const request = vi.fn(async (method: string) => {
              if (method === 'project/list') {
                if (projectListMode === 'unsupported') {
                  throw Object.assign(new Error('The requested Codex method is not available over Remote.'), {
                    code: 'METHOD_NOT_ALLOWED',
                  })
                }
                return { data: [], nextCursor: null }
              }
              if (method === 'thread/list')
                return {
                  data: [
                    { id: 'thread-1', cwd: '/workspace/project', updatedAt: 20 },
                    { id: 'thread-2', cwd: '/workspace/other', updatedAt: 10 },
                    { id: 'hidden-thread', updatedAt: 30 },
                  ],
                  nextCursor: null,
                }
              throw new Error(`unexpected ${method}`)
            })

            const catalog = await loadCodexCatalog({ request } as unknown as CodexRemoteClient)

            expect(catalog.workspaces).toEqual([
              expect.objectContaining({ path: '/workspace/project', sessionIds: ['codex:thread-1'] }),
              expect.objectContaining({ path: '/workspace/other', sessionIds: ['codex:thread-2'] }),
            ])
            expect(catalog.sessions.map((session) => session.sessionId)).toEqual([
              'codex:thread-1',
              'codex:thread-2',
            ])
          },
        }
      }),
    )
  })

  it('accepts only the bounded native History page shape', async () => {
    const client = {
      request: vi.fn(async () => ({
        header: { id: 'codex:thread-1' },
        records: [{
          type: 'event',
          event: { type: 'assistant/message', seq: 4, time: 10, data: { message: { id: 'a1' } } },
        }],
        hasMore: true,
        activeTurnId: 'turn-1',
      })),
    } as unknown as CodexRemoteClient

    await expect(readCodexHistoryPage(client, 'thread-1', 5, 20)).resolves.toMatchObject({
      hasMore: true,
      activeTurnId: 'turn-1',
      events: [{ event: { type: 'assistant/message', seq: 4 } }],
    })
    expect(client.request).toHaveBeenCalledWith('dsh/sessionHistory', {
      threadId: 'thread-1', beforeSeq: 5, maxMessages: 20,
    })
  })

  it('derives the mobile permission preset from App Server settings', () => {
    expect(codexPermissionPresetFromResponse({
      approvalPolicy: 'never',
      sandbox: { type: 'dangerFullAccess' },
    })).toBe('danger-full-access')
    expect(codexPermissionPresetFromResponse({
      threadSettings: {
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/workspace/project'], networkAccess: false },
      },
    })).toBe('workspace-write')
    expect(codexPermissionPresetFromResponse({
      approvalPolicy: 'never',
      sandbox: { type: 'workspaceWrite', writableRoots: ['/workspace/project'], networkAccess: false },
    })).toBeUndefined()
  })
})
