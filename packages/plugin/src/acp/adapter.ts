import type { CursorAcpInbound, CursorAcpLike } from './adapters/cursor-process.js'

/**
 * Backend adapter contract for the Host Agent ACP gateway (#65).
 * Public Remote methods stay backend-neutral; adapters own runtime mapping.
 */
export interface AcpBackendAdapter {
  readonly id: 'cursor'
  start(): Promise<void>
  close(): Promise<void>
  isReady(): boolean
  call(method: string, params: unknown, timeoutMs?: number): Promise<unknown>
  respond(id: string | number, result: unknown): Promise<void>
  respondError(id: string | number, code: number, message: string): Promise<void>
  onInbound(handler: (message: CursorAcpInbound) => void): () => void
  onUnavailable(handler: (code: string) => void): () => void
}

export function adaptCursorProcess(process: CursorAcpLike): AcpBackendAdapter {
  return {
    id: 'cursor',
    start: () => process.start(),
    close: () => process.close(),
    isReady: () => process.isReady(),
    call: (method, params, timeoutMs) => process.call(method, params, timeoutMs),
    respond: (id, result) => process.respond(id, result),
    respondError: (id, code, message) => process.respondError(id, code, message),
    onInbound: handler => process.onInbound(handler),
    onUnavailable: handler => process.onUnavailable(handler),
  }
}
