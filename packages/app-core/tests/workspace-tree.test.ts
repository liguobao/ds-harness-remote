import { describe, expect, it } from 'vitest'
import {
  applyManualOrder,
  buildTreeSections,
  buildWorkspaceTreeParents,
  folderPath,
  getWorkspaceAncestors,
  owningParentFolder,
  reorderSessionIds,
  resolveSearchHitAncestors,
  type WorkspaceItemLike,
} from '../src/lib/workspace-tree'
import type { RemoteSession } from '../src/types'

describe('workspace-tree utilities', () => {
  describe('folderPath', () => {
    it('normalizes backslashes to forward slashes on Windows paths', () => {
      expect(folderPath('C:\\Users\\dev\\project')).toBe('C:/Users/dev/project')
      expect(folderPath('D:\\repo\\sub\\')).toBe('D:/repo/sub')
    })

    it('strips trailing slashes but preserves single root slash', () => {
      expect(folderPath('/home/user/app/')).toBe('/home/user/app')
      expect(folderPath('/home/user/app///')).toBe('/home/user/app')
      expect(folderPath('/')).toBe('')
      expect(folderPath('')).toBe('')
    })
  })

  describe('owningParentFolder', () => {
    it('finds the nearest registered ancestor workspace path', () => {
      const registered = [
        '/home/user/repo',
        '/home/user/repo/apps',
        '/home/user/repo/apps/web',
      ]
      expect(owningParentFolder('/home/user/repo/apps/android', registered)).toBe('/home/user/repo/apps')
      expect(owningParentFolder('/home/user/repo/apps/web', registered)).toBe('/home/user/repo/apps')
      expect(owningParentFolder('/home/user/repo/docs', registered)).toBe('/home/user/repo')
      expect(owningParentFolder('/home/user/other', registered)).toBeUndefined()
    })

    it('enforces directory boundary matching so partial segment matches are rejected', () => {
      const registered = ['/home/user/repo']
      expect(owningParentFolder('/home/user/report', registered)).toBeUndefined()
      expect(owningParentFolder('/home/user/repo-fork', registered)).toBeUndefined()
      expect(owningParentFolder('/home/user/repo/sub', registered)).toBe('/home/user/repo')
    })

    it('handles Windows drive paths with mixed separators', () => {
      const registered = ['C:\\Projects\\MyApp', 'C:\\Projects\\MyApp\\modules']
      expect(owningParentFolder('C:/Projects/MyApp/modules/core', registered)).toBe('C:\\Projects\\MyApp\\modules')
      expect(owningParentFolder('C:\\Projects\\MyApp\\readme.md', registered)).toBe('C:\\Projects\\MyApp')
    })
  })

  describe('buildWorkspaceTreeParents & getWorkspaceAncestors', () => {
    const workspaces: WorkspaceItemLike[] = [
      { workspaceId: 'root', title: 'Root', path: '/workspace', sessionIds: ['s1'] },
      { workspaceId: 'pkgA', title: 'Package A', path: '/workspace/packages/a', sessionIds: ['s2'] },
      { workspaceId: 'pkgB', title: 'Package B', path: '/workspace/packages/b', sessionIds: ['s3'] },
      { workspaceId: 'pkgA_sub', title: 'A Sub', path: '/workspace/packages/a/sub', sessionIds: ['s4'] },
      { workspaceId: 'independent', title: 'Independent', path: '/other/path', sessionIds: ['s5'] },
    ]

    it('builds parent relationships correctly', () => {
      const parents = buildWorkspaceTreeParents(workspaces)
      expect(parents.get('root')).toBeUndefined()
      expect(parents.get('pkgA')).toBe('root')
      expect(parents.get('pkgB')).toBe('root')
      expect(parents.get('pkgA_sub')).toBe('pkgA')
      expect(parents.get('independent')).toBeUndefined()
    })

    it('computes ancestors from nearest to root', () => {
      const parents = buildWorkspaceTreeParents(workspaces)
      expect(getWorkspaceAncestors('pkgA_sub', parents)).toEqual(['pkgA', 'root'])
      expect(getWorkspaceAncestors('pkgA', parents)).toEqual(['root'])
      expect(getWorkspaceAncestors('root', parents)).toEqual([])
      expect(getWorkspaceAncestors('independent', parents)).toEqual([])
    })

    it('resolves search hit ancestors to expand all parents of matching workspaces', () => {
      const parents = buildWorkspaceTreeParents(workspaces)
      const expanded = resolveSearchHitAncestors(['pkgA_sub'], parents)
      expect(expanded.has('pkgA_sub')).toBe(true)
      expect(expanded.has('pkgA')).toBe(true)
      expect(expanded.has('root')).toBe(true)
      expect(expanded.has('pkgB')).toBe(false)
      expect(expanded.has('independent')).toBe(false)
    })
  })

  describe('applyManualOrder', () => {
    const makeSession = (id: string, updatedAt: number): RemoteSession => ({
      sessionId: id,
      title: `Session ${id}`,
      updatedAt,
      backend: 'harness',
      running: false,
      blank: false,
    })

    it('reorders sessions according to saved manual positions', () => {
      const sessions = [
        makeSession('s1', 100),
        makeSession('s2', 200),
        makeSession('s3', 300),
      ]
      const savedOrder = ['s3', 's1', 's2']
      const reordered = applyManualOrder(sessions, savedOrder)
      expect(reordered.map(s => s.sessionId)).toEqual(['s3', 's1', 's2'])
    })

    it('preserves existing saved positions and appends newly created sessions at the end', () => {
      const sessions = [
        makeSession('s1', 100),
        makeSession('s2', 200),
        makeSession('s3', 300),
        makeSession('s4_new', 400),
      ]
      const savedOrder = ['s2', 's1', 's3']
      const reordered = applyManualOrder(sessions, savedOrder)
      expect(reordered.map(s => s.sessionId)).toEqual(['s2', 's1', 's3', 's4_new'])
    })

    it('returns original list if saved order is empty or undefined', () => {
      const sessions = [makeSession('s1', 100), makeSession('s2', 200)]
      expect(applyManualOrder(sessions, undefined).map(s => s.sessionId)).toEqual(['s1', 's2'])
      expect(applyManualOrder(sessions, []).map(s => s.sessionId)).toEqual(['s1', 's2'])
    })
  })

  describe('reorderSessionIds', () => {
    const list = ['s1', 's2', 's3', 's4', 's5']

    it('moves an item forward/downward (after target) and shifts intermediate items left', () => {
      // Dragging s1 down to s2 inserts s1 after s2
      expect(reorderSessionIds(list, 's1', 's2', 'after')).toEqual(['s2', 's1', 's3', 's4', 's5'])
      // Dragging s1 down to s3 inserts s1 after s3
      expect(reorderSessionIds(list, 's1', 's3', 'after')).toEqual(['s2', 's3', 's1', 's4', 's5'])
    })

    it('moves an item backward/upward (before target) and shifts intermediate items right', () => {
      // Dragging s4 up to s2 inserts s4 before s2
      expect(reorderSessionIds(list, 's4', 's2', 'before')).toEqual(['s1', 's4', 's2', 's3', 's5'])
      // Dragging s5 up to s1 inserts s5 before s1
      expect(reorderSessionIds(list, 's5', 's1', 'before')).toEqual(['s5', 's1', 's2', 's3', 's4'])
    })

    it('preserves hidden/archived sessions in their relative positions during reordering', () => {
      const withArchived = ['s1', 'archived1', 's2', 's3']
      // Moving s3 up to s1 inserts s3 before s1 while archived1 stays right after s1
      expect(reorderSessionIds(withArchived, 's3', 's1', 'before')).toEqual(['s3', 's1', 'archived1', 's2'])
      // Moving s1 down to s2 inserts s1 after s2 while archived1 stays ahead
      expect(reorderSessionIds(withArchived, 's1', 's2', 'after')).toEqual(['archived1', 's2', 's1', 's3'])
    })

    it('preserves order if source and target are the same or not found', () => {
      expect(reorderSessionIds(list, 's2', 's2')).toEqual(list)
      expect(reorderSessionIds(list, 'missing', 's2')).toEqual(list)
    })
  })

  describe('buildTreeSections', () => {
    const makeSession = (id: string, updatedAt: number): RemoteSession => ({
      sessionId: id,
      title: `Session ${id}`,
      updatedAt,
      backend: 'harness',
      running: false,
      blank: false,
    })

    const rootWs: WorkspaceItemLike = {
      workspaceId: 'root',
      title: 'Root Project',
      path: '/home/project',
      sessionIds: ['r1', 'r2'],
    }
    const childWs: WorkspaceItemLike = {
      workspaceId: 'child',
      title: 'Child Module',
      path: '/home/project/module',
      sessionIds: ['c1'],
    }
    const grandchildWs: WorkspaceItemLike = {
      workspaceId: 'grandchild',
      title: 'Grandchild App',
      path: '/home/project/module/app',
      sessionIds: ['gc1'],
    }

    const sessions = [
      makeSession('gc1', 400),
      makeSession('c1', 300),
      makeSession('r2', 200),
      makeSession('r1', 100),
    ]

    it('displays sub-workspaces before parent workspace own sessions', () => {
      const sections = buildTreeSections({
        backend: 'harness',
        wsList: [rootWs, childWs],
        filteredSessions: sessions,
        backendWorkspaces: [rootWs, childWs],
        expandedWorkspaces: {},
        visibleCounts: {},
        manualOrders: {},
        orderBy: 'updated',
        searchQuery: '',
        partitionPinned: items => [...items],
      })

      // Section 0: Root header (data empty, child comes first, no show-more footer)
      expect(sections[0]).toMatchObject({
        id: 'workspace:harness:root',
        title: 'Root Project',
        depth: 0,
        expanded: true,
        data: [],
        hasMoreFooter: false,
      })
      // Section 1: Child module header + sessions (child comes before parent's own sessions)
      expect(sections[1]).toMatchObject({
        id: 'workspace:harness:child',
        title: 'Child Module',
        depth: 1,
        expanded: true,
        hasMoreFooter: true,
      })
      expect(sections[1]!.data.map(s => s.sessionId)).toEqual(['c1'])

      // Section 2: Parent root workspace own sessions bucket
      expect(sections[2]).toMatchObject({
        id: 'workspace-sessions:harness:root',
        title: '',
        depth: 0,
        hasMoreFooter: true,
      })
      expect(sections[2]!.data.map(s => s.sessionId)).toEqual(['r2', 'r1'])
    })

    it('handles 3-level hierarchy (root -> child -> grandchild) with correct depths', () => {
      const sections = buildTreeSections({
        backend: 'harness',
        wsList: [rootWs, childWs, grandchildWs],
        filteredSessions: sessions,
        backendWorkspaces: [rootWs, childWs, grandchildWs],
        expandedWorkspaces: {},
        visibleCounts: {},
        manualOrders: {},
        orderBy: 'updated',
        searchQuery: '',
        partitionPinned: items => [...items],
      })

      expect(sections.map(s => ({ id: s.id, depth: s.depth }))).toEqual([
        { id: 'workspace:harness:root', depth: 0 },
        { id: 'workspace:harness:child', depth: 1 },
        { id: 'workspace:harness:grandchild', depth: 2 },
        { id: 'workspace-sessions:harness:child', depth: 1 },
        { id: 'workspace-sessions:harness:root', depth: 0 },
      ])
    })

    it('collapses all descendants when parent workspace is folded', () => {
      const sections = buildTreeSections({
        backend: 'harness',
        wsList: [rootWs, childWs, grandchildWs],
        filteredSessions: sessions,
        backendWorkspaces: [rootWs, childWs, grandchildWs],
        expandedWorkspaces: { 'workspace:harness:root': false },
        visibleCounts: {},
        manualOrders: {},
        orderBy: 'updated',
        searchQuery: '',
        partitionPinned: items => [...items],
      })

      expect(sections).toHaveLength(1)
      expect(sections[0]).toMatchObject({
        id: 'workspace:harness:root',
        expanded: false,
        data: [],
      })
    })

    it('collapses child workspace while keeping parent workspace own sessions visible', () => {
      const sections = buildTreeSections({
        backend: 'harness',
        wsList: [rootWs, childWs],
        filteredSessions: sessions,
        backendWorkspaces: [rootWs, childWs],
        expandedWorkspaces: { 'workspace:harness:child': false },
        visibleCounts: {},
        manualOrders: {},
        orderBy: 'updated',
        searchQuery: '',
        partitionPinned: items => [...items],
      })

      expect(sections).toHaveLength(3)
      expect(sections[0]).toMatchObject({ id: 'workspace:harness:root', expanded: true })
      expect(sections[1]).toMatchObject({ id: 'workspace:harness:child', expanded: false, data: [] })
      expect(sections[2]).toMatchObject({
        id: 'workspace-sessions:harness:root',
        data: [expect.objectContaining({ sessionId: 'r2' }), expect.objectContaining({ sessionId: 'r1' })],
      })
    })

    it('force expands all ancestors when a search query matches a nested workspace session', () => {
      // Both root and child are explicitly set to collapsed (false)
      const sections = buildTreeSections({
        backend: 'harness',
        wsList: [rootWs, childWs],
        filteredSessions: [makeSession('c1', 300)], // only c1 matches
        backendWorkspaces: [rootWs, childWs],
        expandedWorkspaces: {
          'workspace:harness:root': false,
          'workspace:harness:child': false,
        },
        visibleCounts: {},
        manualOrders: {},
        orderBy: 'updated',
        searchQuery: 'Session c1',
        partitionPinned: items => [...items],
      })

      // Both root and child must be force-expanded because c1 matched
      expect(sections[0]).toMatchObject({ id: 'workspace:harness:root', expanded: true })
      expect(sections[1]).toMatchObject({ id: 'workspace:harness:child', expanded: true })
      expect(sections[1]!.data.map(s => s.sessionId)).toEqual(['c1'])
    })

    it('applies manual reordering within the workspace section when orderBy is manual', () => {
      const sections = buildTreeSections({
        backend: 'harness',
        wsList: [rootWs],
        filteredSessions: [makeSession('r2', 200), makeSession('r1', 100)],
        backendWorkspaces: [rootWs],
        expandedWorkspaces: {},
        visibleCounts: {},
        manualOrders: { 'workspace:harness:root': ['r1', 'r2'] }, // r1 placed before r2
        orderBy: 'manual',
        searchQuery: '',
        partitionPinned: items => [...items],
      })

      expect(sections[0]!.data.map(s => s.sessionId)).toEqual(['r1', 'r2'])
    })

    it('integrates with real partitionPinned so pinned sessions lead in tree sections', () => {
      const pinnedSessionIds = ['r1']
      const partitionPinned = (items: RemoteSession[]) => {
        const pinned = items.filter(s => pinnedSessionIds.includes(s.sessionId))
        const ordinary = items.filter(s => !pinnedSessionIds.includes(s.sessionId))
        return [...pinned, ...ordinary]
      }

      const sections = buildTreeSections({
        backend: 'harness',
        wsList: [rootWs],
        filteredSessions: [makeSession('r2', 200), makeSession('r1', 100)],
        backendWorkspaces: [rootWs],
        expandedWorkspaces: {},
        visibleCounts: {},
        manualOrders: {},
        orderBy: 'updated',
        searchQuery: '',
        partitionPinned,
      })

      // r1 is pinned, so even though r2 has higher updatedAt (200 vs 100), r1 leads
      expect(sections[0]!.data.map(s => s.sessionId)).toEqual(['r1', 'r2'])
    })
  })
})
