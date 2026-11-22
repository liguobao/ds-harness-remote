import type { AgentBackend, WorkspaceView } from '../types'
import { isAbsoluteHostPath, normalizeWorkspacePath } from './workspace-key'

export interface HandoffBackendAvailability {
  codexAvailable: boolean
  cursorAvailable: boolean
  antigravityAvailable: boolean
  piAvailable: boolean
  opencodeAvailable: boolean
  claudeAvailable: boolean
  hermesAvailable: boolean
  customAcpBackends?: readonly string[]
}

const TARGET_BACKEND_ORDER: readonly AgentBackend[] = [
  'codex',
  'claude',
  'harness',
  'hermes',
  'opencode',
  'cursor',
  'antigravity',
  'pi',
]

/** Map Host platform strings to `normalizeWorkspacePath` conventions. */
export function normalizeHostPlatform(platform?: string): string | undefined {
  if (!platform) return undefined
  const lower = platform.trim().toLowerCase()
  if (!lower) return undefined
  if (lower === 'windows' || lower === 'win32') return 'win32'
  return lower
}

function isBackendAvailable(availability: HandoffBackendAvailability, backend: AgentBackend): boolean {
  switch (backend) {
    case 'harness':
      return true
    case 'codex':
      return availability.codexAvailable
    case 'claude':
      return availability.claudeAvailable
    case 'hermes':
      return availability.hermesAvailable
    case 'opencode':
      return availability.opencodeAvailable
    case 'cursor':
      return availability.cursorAvailable
    case 'antigravity':
      return availability.antigravityAvailable
    case 'pi':
      return availability.piAvailable
    default:
      return (availability.customAcpBackends ?? []).includes(backend)
  }
}

/** Return available handoff targets with cross-backend agents ordered first and `sourceBackend` last. */
export function availableHandoffTargets(
  availability: HandoffBackendAvailability,
  sourceBackend: AgentBackend,
): AgentBackend[] {
  const ordered: AgentBackend[] = []
  const seen = new Set<AgentBackend>()

  for (const backend of TARGET_BACKEND_ORDER) {
    if (!seen.has(backend) && isBackendAvailable(availability, backend)) {
      seen.add(backend)
      ordered.push(backend)
    }
  }
  for (const custom of availability.customAcpBackends ?? []) {
    if (custom && custom !== 'harness' && custom !== 'codex'
      && !TARGET_BACKEND_ORDER.includes(custom) && !seen.has(custom)) {
      seen.add(custom)
      ordered.push(custom)
    }
  }

  const cross = ordered.filter(backend => backend !== sourceBackend)
  const same = ordered.filter(backend => backend === sourceBackend)
  return [...cross, ...same]
}

/** Match a target workspace by exact normalized path; fail-closed without guessing unrelated paths. */
export function matchTargetWorkspace({
  workspaces,
  targetBackend,
  sourceCwd,
  hostPlatform,
}: {
  workspaces: readonly WorkspaceView[]
  targetBackend: AgentBackend
  sourceCwd?: string
  hostPlatform?: string
}): {
  matched?: WorkspaceView
  otherWorkspaces: WorkspaceView[]
  normalizedSourceCwd?: string
  canRegisterSourceCwd: boolean
} {
  const platform = normalizeHostPlatform(hostPlatform)
  const targetWorkspaces = workspaces.filter(workspace => (workspace.backend ?? 'harness') === targetBackend)
  const trimmedCwd = sourceCwd?.trim()
  const hasAbsoluteCwd = trimmedCwd !== undefined && trimmedCwd.length > 0 && !trimmedCwd.includes('\0') && isAbsoluteHostPath(trimmedCwd)
  const normalizedSourceCwd = hasAbsoluteCwd ? normalizeWorkspacePath(trimmedCwd, platform) : undefined

  const matched = normalizedSourceCwd === undefined
    ? undefined
    : targetWorkspaces.find(workspace => normalizeWorkspacePath(workspace.path, platform) === normalizedSourceCwd)

  const otherWorkspaces = matched === undefined
    ? targetWorkspaces
    : targetWorkspaces.filter(workspace => workspace.workspaceId !== matched.workspaceId)

  return {
    ...(matched !== undefined ? { matched } : {}),
    otherWorkspaces,
    ...(normalizedSourceCwd !== undefined ? { normalizedSourceCwd } : {}),
    canRegisterSourceCwd: hasAbsoluteCwd && matched === undefined,
  }
}
