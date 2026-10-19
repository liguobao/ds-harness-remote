import { parseCodexSessionId } from './codex/session-id.js'
import { RpcError } from './safe-error.js'
import type { LocalTypertGateway } from './typert-gateway-contract.js'

/** Resolve only through backend authority; never accept a Client cwd/path. */
export function workspaceUploadRootResolver(
  gateway: LocalTypertGateway | undefined,
  supportsHarnessSessions: () => boolean,
  codex: (threadId: string) => Promise<string | undefined>,
  acp: (publicId: string) => string,
): (sessionId: string, signal: AbortSignal) => Promise<string | undefined> {
  return async (sessionId, signal) => {
    signal.throwIfAborted()
    if (sessionId.startsWith('codex:')) {
      const parsed = parseCodexSessionId(sessionId)
      if (!parsed) throw unavailable()
      return codex(parsed.threadId)
    }
    if (/^(acp|cursor|pi|opencode|claude):/.test(sessionId)) return acp(sessionId)
    if (!gateway?.supportsCarrier || !supportsHarnessSessions()) throw unavailable()
    // The official authenticated Peer filters this list by session visibility.
    const result = await gateway.dispatch('session/list', { args: { _request: {} } }, signal)
    signal.throwIfAborted()
    const value = result.ok ? result.value as { items?: { sessionId?: string; cwd?: string }[] } | undefined : undefined
    return value?.items?.find(item => item.sessionId === sessionId)?.cwd
  }
}
function unavailable() { return new RpcError('UPLOAD_WORKSPACE_UNAVAILABLE', 'The session workspace is unavailable.') }
