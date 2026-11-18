import { HarnessRemoteSession, HarnessWorkspace } from '../net/HarnessClient';

export class WorkspaceGroup {
  workspaceId: string = '';
  title: string = '';
  path: string = '';
  totalCount: number = 0;
  sessions: HarnessRemoteSession[] = [];
  hasCurrent: boolean = false;
  isSynthetic: boolean = false;
  workspace: HarnessWorkspace | undefined = undefined;
}

export function normalizePathKey(raw: string): string {
  const trimmed: string = raw.trim();
  if (trimmed.length <= 1) {
    return trimmed;
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, trimmed.length - 1) : trimmed;
}

export function workspaceDisplayTitle(ws: HarnessWorkspace): string {
  if (ws.title.trim().length > 0) {
    return ws.title.trim();
  }
  const clean: string = normalizePathKey(ws.path);
  if (clean.length === 0) {
    return ws.workspaceId.length > 0 ? ws.workspaceId : 'default-workspace';
  }
  const slash: number = clean.lastIndexOf('/');
  return slash >= 0 && slash + 1 < clean.length ? clean.slice(slash + 1) : clean;
}

export function cwdFolderName(cwd: string): string {
  const clean: string = normalizePathKey(cwd);
  if (clean.length === 0) {
    return 'default-workspace';
  }
  const slash: number = clean.lastIndexOf('/');
  return slash >= 0 && slash + 1 < clean.length ? clean.slice(slash + 1) : clean;
}

/**
 * Group sessions under their declared workspaces, matching Android's collapsible
 * workspace card hierarchy (`workspace -> recent sessions + expand remaining`).
 */
export function groupSessionsByWorkspace(
  workspaces: HarnessWorkspace[],
  sessions: HarnessRemoteSession[],
  currentSessionId: string,
  selectedWorkspaceId: string
): WorkspaceGroup[] {
  const sessionIdToWsId: Map<string, string> = new Map();
  const pathToWsId: Map<string, string> = new Map();
  const groupsById: Map<string, WorkspaceGroup> = new Map();
  const orderedIds: string[] = [];

  for (const ws of workspaces) {
    if (ws.workspaceId.length === 0 || groupsById.has(ws.workspaceId)) {
      continue;
    }
    const group: WorkspaceGroup = new WorkspaceGroup();
    group.workspaceId = ws.workspaceId;
    group.title = workspaceDisplayTitle(ws);
    group.path = ws.path;
    group.workspace = ws;
    groupsById.set(ws.workspaceId, group);
    orderedIds.push(ws.workspaceId);

    const normPath: string = normalizePathKey(ws.path);
    if (normPath.length > 0 && !pathToWsId.has(normPath)) {
      pathToWsId.set(normPath, ws.workspaceId);
    }
    for (const sid of ws.sessionIds) {
      if (sid.length > 0 && !sessionIdToWsId.has(sid)) {
        sessionIdToWsId.set(sid, ws.workspaceId);
      }
    }
  }

  // Match Android's `backendWorkspaces` grouping: sessions not explicitly bound to any
  // registered workspace fall back to the `default` workspace instead of spawning
  // extra synthetic `cwd:...` cards.
  let defaultWsId: string = '';
  for (const wsId of orderedIds) {
    const g: WorkspaceGroup | undefined = groupsById.get(wsId);
    if (g !== undefined && (wsId === 'default' || g.title === 'default-workspace' || g.title === 'Default')) {
      defaultWsId = wsId;
      break;
    }
  }
  if (defaultWsId.length === 0 && orderedIds.length > 0) {
    defaultWsId = orderedIds[orderedIds.length - 1];
  }

  const fallbackDefault: WorkspaceGroup = new WorkspaceGroup();
  fallbackDefault.workspaceId = 'default';
  fallbackDefault.title = 'default-workspace';
  fallbackDefault.isSynthetic = true;

  for (const session of sessions) {
    let targetWsId: string = sessionIdToWsId.get(session.sessionId) ?? '';
    if (targetWsId.length === 0) {
      const normCwd: string = normalizePathKey(session.cwd);
      if (normCwd.length > 0) {
        targetWsId = pathToWsId.get(normCwd) ?? '';
      }
    }
    if (targetWsId.length === 0) {
      targetWsId = defaultWsId;
    }
    if (targetWsId.length > 0) {
      const group: WorkspaceGroup | undefined = groupsById.get(targetWsId);
      if (group !== undefined) {
        group.sessions.push(session);
        continue;
      }
    }
    fallbackDefault.sessions.push(session);
  }

  const result: WorkspaceGroup[] = [];
  for (const wsId of orderedIds) {
    const group: WorkspaceGroup | undefined = groupsById.get(wsId);
    if (group !== undefined) {
      group.sessions.sort((a: HarnessRemoteSession, b: HarnessRemoteSession) => (b.updatedAt || 0) - (a.updatedAt || 0));
      group.totalCount = group.sessions.length;
      group.hasCurrent = (selectedWorkspaceId.length > 0 && group.workspaceId === selectedWorkspaceId)
        || group.sessions.some((s: HarnessRemoteSession) => s.sessionId === currentSessionId);
      result.push(group);
    }
  }
  if (fallbackDefault.sessions.length > 0) {
    fallbackDefault.sessions.sort((a: HarnessRemoteSession, b: HarnessRemoteSession) => (b.updatedAt || 0) - (a.updatedAt || 0));
    fallbackDefault.totalCount = fallbackDefault.sessions.length;
    fallbackDefault.hasCurrent = fallbackDefault.sessions.some((s: HarnessRemoteSession) => s.sessionId === currentSessionId);
    result.push(fallbackDefault);
  }
  return result;
}

/**
 * Compact relative time string matching Android session rows (`16h`, `3d`, `5m`).
 */
export function formatRelativeShort(updatedAt: number, nowMs: number = Date.now()): string {
  if (updatedAt <= 0) {
    return '';
  }
  const diffMs: number = Math.max(0, nowMs - updatedAt);
  const mins: number = Math.floor(diffMs / 60000);
  if (mins < 1) {
    return '1m';
  }
  if (mins < 60) {
    return `${mins}m`;
  }
  const hours: number = Math.floor(diffMs / 3600000);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days: number = Math.floor(diffMs / 86400000);
  if (days < 30) {
    return `${days}d`;
  }
  const months: number = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo`;
  }
  return `${Math.floor(days / 365)}y`;
}
