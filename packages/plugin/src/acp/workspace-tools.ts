import { WorkspaceBridge } from '../workspace-bridge.js'
import { TerminalPolicy } from '../terminal-policy.js'
import { RpcError } from '../safe-error.js'

/** ACP supplies session authority; shared tools enforce containment and ownership. */
export class AcpWorkspaceTools {
  constructor(private readonly bridge: WorkspaceBridge, private readonly terminal: TerminalPolicy) {}

  private payload(sessionId: string, backend: string, args: Record<string, unknown>) {
    const scopedId = `${backend === 'antigravity' ? 'acp' : 'cursor'}:${sessionId}`
    const ids = [args.workspaceFileScopeId, args.agentId, args.sessionId].filter(id => id !== undefined)
    if (!ids.length || ids.some(id => id !== scopedId)) throw new RpcError('PERMISSION_DENIED', 'The tool scope does not match the ACP session.')
    return { args }
  }

  async call(sessionId: string, backend: string, endpoint: string, args: Record<string, unknown>) {
    const payload = this.payload(sessionId, backend, args)
    const reservation = endpoint.startsWith('terminal/') ? this.terminal.check(endpoint, payload) : undefined
    try {
      const result = await this.bridge.call(endpoint, payload, AbortSignal.timeout(60_000))
      if (!result) throw new RpcError('METHOD_NOT_ALLOWED', 'The ACP workspace tool is unavailable.')
      const checked = reservation ? this.terminal.result(endpoint, payload, result, reservation) : result
      if (!checked.ok) throw new RpcError(checked.error.code, checked.error.message)
      return checked.value
    } catch (error) {
      if (reservation) this.terminal.result(endpoint, payload, { ok: false, error: { code: 'FAILED', message: '', details: {} } }, reservation)
      throw error
    }
  }

  async open(sessionId: string, backend: string, endpoint: string, args: Record<string, unknown>, signal: AbortSignal) {
    const payload = this.payload(sessionId, backend, args)
    if (endpoint.startsWith('terminal/')) this.terminal.check(endpoint, payload)
    const source = await this.bridge.open(endpoint, payload, signal)
    if (!source) throw new RpcError('METHOD_NOT_ALLOWED', 'The ACP tool stream is unavailable.')
    return source
  }

  close(): Promise<void> { return this.bridge.closeAll() }
}
