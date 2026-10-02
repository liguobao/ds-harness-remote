import { z } from 'zod'
import { RpcError } from './safe-error.js'
import type { TypertRpcResult } from './typert-gateway-contract.js'
import { parseCodexSessionId } from './codex/session-id.js'

export const TERMINAL_CALLS = new Set(['terminal/environment', 'terminal/shells', 'terminal/list',
  'terminal/create', 'terminal/write', 'terminal/resize', 'terminal/rename', 'terminal/close'])
export const TERMINAL_STREAMS = new Set(['terminal/follow', 'terminal/retain'])
const id = z.string().regex(/^[A-Za-z0-9_:-]{1,256}$/)

/** Host-lifetime device ownership survives transport reconnects; never supplied by the client. */
export class TerminalPolicy {
  private readonly attachments = new Map<string, string>()
  constructor(private readonly enabled: boolean | (() => boolean), private readonly deviceId: string,
    private readonly owners: Map<string, string>) {}

  check(endpoint: string, payload: unknown): { key?: string; created?: boolean } {
    if (!(typeof this.enabled === 'function' ? this.enabled() : this.enabled)) throw new RpcError('TERMINAL_DISABLED',
      'Remote terminal is disabled on this Host. Enable Remote terminal in the Host Remote settings; the switch saves and applies immediately. / 远程终端未开启，请在 Host 的 Remote 设置中开启「远程终端」，开关切换后立即保存并生效。')
    const args = z.object({ args: z.record(z.unknown()) }).strict().parse(payload).args
    const rawSessionId = args.agentId ?? args.sessionId
    const sessionId = id.parse(rawSessionId)
    // CodeX sessions are deliberately opaque keys here. Their thread/cwd
    // authority is resolved by the CodeX Host domain, never by Harness lookup.
    const codexSession = parseCodexSessionId(sessionId)
    void codexSession
    if (endpoint === 'terminal/environment' || endpoint === 'terminal/shells' || endpoint === 'terminal/list') return {}
    const request = endpoint === 'terminal/create' ? z.object({ id }).passthrough().parse(args.request) : undefined
    const terminalId = id.parse(request?.id ?? args.id)
    const key = `${sessionId}/${terminalId}`
    if (endpoint === 'terminal/create') {
      if (this.owners.has(key) && this.owners.get(key) !== this.deviceId) this.deny()
      if (!this.owners.has(key) && this.owners.size >= 256) throw new RpcError('RATE_LIMITED', 'Too many retained remote terminals.')
      const created = !this.owners.has(key)
      this.owners.set(key, this.deviceId)
      return { key, created }
    }
    if (this.owners.get(key) !== this.deviceId) this.deny()
    if (endpoint === 'terminal/follow') this.attachments.set(key, id.parse(args.attachmentId))
    if (endpoint === 'terminal/write' || endpoint === 'terminal/resize') {
      if (this.attachments.get(key) !== id.parse(args.attachmentId)) this.deny()
    }
    return { key }
  }

  result(endpoint: string, payload: unknown, result: TypertRpcResult, reservation: { key?: string; created?: boolean }): TypertRpcResult {
    if (reservation.key !== undefined && ((!result.ok && reservation.created) || (result.ok && endpoint === 'terminal/close'))) {
      this.owners.delete(reservation.key)
      this.attachments.delete(reservation.key)
    }
    if (endpoint === 'terminal/list' && result.ok && Array.isArray(result.value)) {
      const args = (payload as { args: Record<string, unknown> }).args
      const session = args.sessionId ?? args.agentId
      return { ok: true, value: result.value.filter(value => typeof value?.id === 'string'
        && this.owners.get(`${session}/${value.id}`) === this.deviceId) }
    }
    return result
  }

  private deny(): never { throw new RpcError('PERMISSION_DENIED', 'This terminal or input attachment belongs to another connection or device.') }
}
