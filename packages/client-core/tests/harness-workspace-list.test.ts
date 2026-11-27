import { describe, expect, it, vi } from 'vitest'
import { HarnessAlphaClient, normalizeWorkspaceList } from '../src/harness-alpha-client.js'

describe('normalizeWorkspaceList and workspaceList pinnedSessionIds handling', () => {
  it('omits pinnedSessionIds when workspace/follow baseline omits the field', () => {
    const result = normalizeWorkspaceList({
      items: [
        {
          workspaceId: 'ws-1',
          path: '/repo/demo',
          title: 'Demo',
          sessionIds: ['s-1', 's-2'],
          createdAt: '2026-11-26T00:00:00.000Z',
          updatedAt: '2026-11-26T00:00:00.000Z',
        },
      ],
      archivedSessionIds: ['s-2'],
    })

    expect(result.items).toHaveLength(1)
    expect(result.archivedSessionIds).toEqual(['s-2'])
    expect(result.pinnedSessionIds).toBeUndefined()
    expect('pinnedSessionIds' in result).toBe(false)
  })

  it('preserves explicit empty and non-empty pinnedSessionIds arrays from Host baseline', () => {
    const empty = normalizeWorkspaceList({
      items: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    })
    expect(empty.pinnedSessionIds).toEqual([])

    const populated = normalizeWorkspaceList({
      items: [],
      archivedSessionIds: [],
      pinnedSessionIds: ['s-1', 's-1', 42, 's-3'],
    })
    expect(populated.pinnedSessionIds).toEqual(['s-1', 's-3'])
  })

  it('collects per-workspace pinnedSessionIds when top-level field is absent', () => {
    const result = normalizeWorkspaceList({
      items: [
        {
          workspaceId: 'ws-1',
          path: '/repo/a',
          title: 'A',
          sessionIds: ['s-1'],
          pinnedSessionIds: ['s-1'],
          createdAt: '2026-11-26T00:00:00.000Z',
          updatedAt: '2026-11-26T00:00:00.000Z',
        },
        {
          workspaceId: 'ws-2',
          path: '/repo/b',
          title: 'B',
          sessionIds: ['s-2'],
          pinnedSessionIds: ['s-1', 's-2'],
          createdAt: '2026-11-26T00:00:00.000Z',
          updatedAt: '2026-11-26T00:00:00.000Z',
        },
      ],
      archivedSessionIds: [],
    })

    expect(result.pinnedSessionIds).toEqual(['s-1', 's-2'])
  })

  it('returns undefined pinnedSessionIds from workspaceList() when baseline omits it', async () => {
    const returnSpy = vi.fn(async () => ({ done: true as const, value: undefined }))
    const open = vi.fn(async () => ({
      [Symbol.asyncIterator]() {
        let yielded = false
        return {
          async next() {
            if (!yielded) {
              yielded = true
              return {
                done: false as const,
                value: {
                  type: 'baseline',
                  value: {
                    items: [
                      {
                        workspaceId: 'ws-1',
                        path: '/repo/demo',
                        title: 'Demo',
                        sessionIds: ['s-1'],
                        createdAt: '2026-11-26T00:00:00.000Z',
                        updatedAt: '2026-11-26T00:00:00.000Z',
                      },
                    ],
                    archivedSessionIds: [],
                  },
                },
              }
            }
            return { done: true as const, value: undefined }
          },
          return: returnSpy,
        }
      },
    }))

    const list = await HarnessAlphaClient.prototype.workspaceList.call(
      { gateway: { open } } as unknown as HarnessAlphaClient,
    )
    expect(open).toHaveBeenCalledWith('workspace/follow', { args: {} })
    expect(returnSpy).toHaveBeenCalledOnce()
    expect(list.pinnedSessionIds).toBeUndefined()
  })
})
