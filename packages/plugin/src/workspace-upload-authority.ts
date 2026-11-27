import { isValidAcpBackendId } from './acp/method-policy.js'
import { parseCodexSessionId } from './codex/session-id.js'
import { RpcError } from './safe-error.js'
import type { LocalTypertGateway } from './typert-gateway-contract.js'

/** Resolve a session workspace root only through backend authority; never accept a Client cwd/path. */
export function resolveSessionWorkspaceRoot(
  gateway: LocalTypertGateway | undefined,
  supportsHarnessSessions: () => boolean,
  codex: (threadId: string) => Promise<string | undefined>,
  acp: (publicId: string) => string | Promise<string | undefined>,
  unavailableError: () => RpcError = unavailable,
): (sessionId: string, signal: AbortSignal) => Promise<string | undefined> {
  return async (sessionId, signal) => {
    signal.throwIfAborted()
    if (sessionId.startsWith('codex:')) {
      const parsed = parseCodexSessionId(sessionId)
      if (!parsed) throw unavailableError()
      return codex(parsed.threadId)
    }
    const colonIndex = sessionId.indexOf(':')
    if (colonIndex > 0) {
      const prefix = sessionId.slice(0, colonIndex)
      if (
        prefix === 'acp'
        || (
          prefix !== 'codex'
          && prefix !== 'harness'
          && prefix === prefix.trim()
          && isValidAcpBackendId(prefix)
        )
      ) {
        return acp(sessionId)
      }
    }
    if (!gateway?.supportsCarrier || !supportsHarnessSessions()) throw unavailableError()
    // The official authenticated Peer filters this list by session visibility.
    const result = await gateway.dispatch('session/list', { args: { _request: {} } }, signal)
    signal.throwIfAborted()
    const value = result.ok ? result.value as { items?: { sessionId?: string; cwd?: string }[] } | undefined : undefined
    return value?.items?.find(item => item.sessionId === sessionId)?.cwd
  }
}

/** Resolve only through backend authority; never accept a Client cwd/path. */
export function workspaceUploadRootResolver(
  gateway: LocalTypertGateway | undefined,
  supportsHarnessSessions: () => boolean,
  codex: (threadId: string) => Promise<string | undefined>,
  acp: (publicId: string) => string,
): (sessionId: string, signal: AbortSignal) => Promise<string | undefined> {
  return resolveSessionWorkspaceRoot(gateway, supportsHarnessSessions, codex, acp, unavailable)
}

function unavailable() {
  return new RpcError('UPLOAD_WORKSPACE_UNAVAILABLE', 'The session workspace is unavailable.')
}
