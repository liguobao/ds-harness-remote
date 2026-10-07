import { parseCodexSessionId } from './codex/session-id.js'
import { WorkspaceBridge, WorkspaceBridgeState, type WorkspaceCwdResolver, type RemoteTerminalSpawner, pipeTerminalSpawner } from './workspace-bridge.js'
export * from './workspace-bridge.js'
export { WorkspaceBridgeState as CodexWorkspaceState }
export type CodexCwdResolver = WorkspaceCwdResolver

/** CodeX supplies thread authority to the shared workspace implementation. */
export class CodexWorkspaceBridge extends WorkspaceBridge {
  constructor(resolveCwd: WorkspaceCwdResolver, terminalEnabled: () => boolean,
    state = new WorkspaceBridgeState(), spawnTerminal: RemoteTerminalSpawner = pipeTerminalSpawner()) {
    super(resolveCwd, terminalEnabled, state, spawnTerminal, {
      parse: value => { const parsed = parseCodexSessionId(value); return parsed ? { sessionId: parsed.sessionId, nativeId: parsed.threadId } : undefined }, domain: 'CODEX', owns: value => typeof value === 'string' && value.startsWith('codex:'),
    })
  }
  isCodeXScope(value: unknown): boolean { return this.isScope(value) }
}
