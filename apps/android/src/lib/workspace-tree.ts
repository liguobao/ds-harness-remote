/**
 * Workspace tree derivation and ordering utilities.
 * Aligned with deepseek-harness packages/client/ui-workspace/src/client/tree.ts:
 *   - folderPath: normalizes paths for consistent prefix comparisons
 *   - owningParentFolder: finds the nearest registered ancestor workspace
 *   - buildWorkspaceTreeParents: builds mapping from workspaceId to parent workspaceId
 *   - getWorkspaceAncestors: computes complete ancestor list for any workspace
 *   - resolveSearchHitAncestors: expands all ancestors of workspaces with matching sessions
 *   - applyManualOrder: reorders sessions according to saved manual positions
 */

import type { RemoteSession } from '../types'

/** Normalize separators for comparison without interpreting POSIX backslashes as separators. */
export function folderPath(path: string): string {
  const windows = /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
  return (windows ? path.replaceAll('\\', '/') : path).replace(/\/+$/, '')
}

/**
 * Find the nearest registered ancestor, excluding the Workspace directory itself.
 * Paths use Host spelling; matching is case-sensitive, like Workspace identity.
 * @param path - Workspace directory.
 * @param parents - registered Workspace directory paths.
 * @returns the owning parent path, or undefined when no parent contains the Workspace.
 */
export function owningParentFolder(path: string, parents: readonly string[]): string | undefined {
  const child = folderPath(path)
  let owner: string | undefined
  let length = -1
  for (const parent of parents) {
    const root = folderPath(parent)
    if (root.length > length && child !== root && child.startsWith(`${root}/`)) {
      owner = parent
      length = root.length
    }
  }
  return owner
}

export interface WorkspaceItemLike {
  workspaceId: string
  title: string
  path: string
  sessionIds: string[]
}

/**
 * Build parent mapping for registered workspaces.
 * Returns a Map of workspaceId -> parent workspaceId (or undefined for root workspaces).
 */
export function buildWorkspaceTreeParents(
  workspaces: readonly WorkspaceItemLike[]
): Map<string, string | undefined> {
  const keysByPath = new Map<string, string>()
  for (const ws of workspaces) {
    if (ws.path) {
      keysByPath.set(ws.path, ws.workspaceId)
    }
  }
  const paths = [...keysByPath.keys()]
  const parents = new Map<string, string | undefined>()
  for (const ws of workspaces) {
    if (!ws.path) {
      parents.set(ws.workspaceId, undefined)
      continue
    }
    const parentPath = owningParentFolder(ws.path, paths)
    parents.set(ws.workspaceId, parentPath ? keysByPath.get(parentPath) : undefined)
  }
  return parents
}

/**
 * Returns all ancestor workspace IDs from nearest parent to root.
 */
export function getWorkspaceAncestors(
  workspaceId: string,
  parents: Map<string, string | undefined>
): string[] {
  const ancestors: string[] = []
  let current = parents.get(workspaceId)
  while (current !== undefined) {
    ancestors.push(current)
    current = parents.get(current)
  }
  return ancestors
}

/**
 * Given workspaces that contain search hits, resolves the complete set of
 * ancestor workspace IDs that must be expanded so the hits are visible.
 */
export function resolveSearchHitAncestors(
  hitWorkspaceIds: readonly string[],
  parents: Map<string, string | undefined>
): Set<string> {
  const expanded = new Set<string>()
  for (const wsId of hitWorkspaceIds) {
    expanded.add(wsId)
    for (const ancestor of getWorkspaceAncestors(wsId, parents)) {
      expanded.add(ancestor)
    }
  }
  return expanded
}

/**
 * Reconcile a manual order with current sessions.
 * Preserves the relative order of saved session IDs and appends any new/missing
 * sessions by recency.
 */
export function applyManualOrder(
  sessions: readonly RemoteSession[],
  savedOrder: readonly string[] | undefined
): RemoteSession[] {
  if (!savedOrder || savedOrder.length === 0) return [...sessions]
  const byId = new Map(sessions.map(s => [s.sessionId, s]))
  const result: RemoteSession[] = []
  const included = new Set<string>()

  for (const id of savedOrder) {
    const s = byId.get(id)
    if (s && !included.has(id)) {
      result.push(s)
      included.add(id)
    }
  }

  for (const s of sessions) {
    if (!included.has(s.sessionId)) {
      result.push(s)
    }
  }

  return result
}

export interface TreeSectionResult {
  id: string
  title: string
  total: number
  expanded: boolean
  data: RemoteSession[]
  depth: number
  workspaceId?: string
  hasMoreFooter?: boolean
}

/**
 * Reorder a session in the complete session ID array.
 * When dragging downward (fromIndex < overIndex), the session is inserted after targetId.
 * When dragging upward (fromIndex > overIndex), the session is inserted before targetId.
 * Hidden, archived, and unrendered sessions in allIds preserve their relative order.
 */
export function reorderSessionIds(
  allIds: readonly string[],
  sourceId: string,
  targetId: string,
  direction?: 'before' | 'after'
): string[] {
  if (sourceId === targetId) return [...allIds]
  const sourceIndex = allIds.indexOf(sourceId)
  const targetIndex = allIds.indexOf(targetId)
  if (sourceIndex === -1 || targetIndex === -1) return [...allIds]

  const isAfter = direction !== undefined ? direction === 'after' : sourceIndex < targetIndex
  const next = allIds.filter(id => id !== sourceId)
  const newTargetIndex = next.indexOf(targetId)
  if (newTargetIndex === -1) return [...allIds]

  next.splice(newTargetIndex + (isAfter ? 1 : 0), 0, sourceId)
  return next
}

export function buildTreeSections({
  backend,
  wsList,
  filteredSessions,
  backendWorkspaces,
  expandedWorkspaces,
  visibleCounts,
  manualOrders,
  orderBy,
  searchQuery,
  partitionPinned,
  pageSize = 3,
  defaultExpanded = true,
}: {
  backend: string
  wsList: readonly WorkspaceItemLike[]
  filteredSessions: readonly RemoteSession[]
  backendWorkspaces: readonly { sessionIds: string[] }[]
  expandedWorkspaces: Record<string, boolean>
  visibleCounts: Record<string, number>
  manualOrders: Record<string, string[]>
  orderBy: 'manual' | 'updated'
  searchQuery: string
  partitionPinned: (items: RemoteSession[]) => RemoteSession[]
  pageSize?: number
  defaultExpanded?: boolean
}): TreeSectionResult[] {
  const parents = buildWorkspaceTreeParents(wsList)
  const allAncestorIds = new Set<string>()
  for (const parentId of parents.values()) {
    if (parentId) allAncestorIds.add(parentId)
  }

  let searchAncestors = new Set<string>()
  if (searchQuery.trim()) {
    const hitWorkspaceIds = wsList
      .filter(ws => {
        const isDefault = ws.workspaceId === 'default'
        return filteredSessions.some(s =>
          isDefault ? !backendWorkspaces.some(w => w.sessionIds.includes(s.sessionId)) : ws.sessionIds.includes(s.sessionId)
        )
      })
      .map(ws => ws.workspaceId)
    searchAncestors = resolveSearchHitAncestors(hitWorkspaceIds, parents)
  }

  const childrenByParent = new Map<string | undefined, WorkspaceItemLike[]>()
  for (const ws of wsList) {
    const p = parents.get(ws.workspaceId)
    const list = childrenByParent.get(p) ?? []
    list.push(ws)
    childrenByParent.set(p, list)
  }
  const rootWorkspaces = childrenByParent.get(undefined) ?? []

  const treeSections: TreeSectionResult[] = []

  const renderWorkspaceNode = (ws: WorkspaceItemLike, depth: number) => {
    const groupId = `workspace:${backend}:${ws.workspaceId}`
    const isDefault = ws.workspaceId === 'default'
    let wsSessions = filteredSessions.filter(s =>
      isDefault ? !backendWorkspaces.some(w => w.sessionIds.includes(s.sessionId)) : ws.sessionIds.includes(s.sessionId)
    )
    if (orderBy === 'manual') {
      wsSessions = applyManualOrder(wsSessions, manualOrders[groupId])
    }
    const partitioned = partitionPinned(wsSessions)
    const isAncestor = allAncestorIds.has(ws.workspaceId)
    const searchExp = searchAncestors.has(ws.workspaceId)
    const isExpanded = searchExp ? true : (expandedWorkspaces[groupId] ?? (isAncestor ? defaultExpanded : defaultExpanded))
    const limit = visibleCounts[groupId] ?? pageSize
    const title = ws.title || ws.path || ws.workspaceId
    const visibleData = isExpanded ? partitioned.slice(0, limit) : []

    const children = childrenByParent.get(ws.workspaceId) ?? []

    if (children.length === 0) {
      treeSections.push({
        id: groupId,
        title,
        total: partitioned.length,
        expanded: isExpanded,
        data: visibleData,
        depth,
        workspaceId: ws.workspaceId,
        hasMoreFooter: true,
      })
    } else {
      // Child workspaces appear before parent workspace's own sessions
      treeSections.push({
        id: groupId,
        title,
        total: partitioned.length,
        expanded: isExpanded,
        data: [],
        depth,
        workspaceId: ws.workspaceId,
        hasMoreFooter: false,
      })
      if (isExpanded) {
        for (const child of children) {
          renderWorkspaceNode(child, depth + 1)
        }
        if (partitioned.length > 0) {
          treeSections.push({
            id: `workspace-sessions:${backend}:${ws.workspaceId}`,
            title: '',
            total: partitioned.length,
            expanded: true,
            data: visibleData,
            depth,
            workspaceId: ws.workspaceId,
            hasMoreFooter: true,
          })
        }
      }
    }
  }

  for (const root of rootWorkspaces) {
    renderWorkspaceNode(root, 0)
  }

  return treeSections
}
