/** One-shot admission for the native confirmation -> Session Prompt boundary. */
export interface UiActionTicket { readonly id: number }

export class UiActionGuard {
  private lastId = 0
  private lastAdmittedAt = -Infinity
  private pending?: UiActionTicket
  private submitted = new WeakSet<UiActionTicket>()

  admit(id: unknown, now: number): UiActionTicket | undefined {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= this.lastId) return undefined
    // Consume even throttled/busy IDs: waiting must never make a replay valid.
    this.lastId = id
    if (this.pending || now - this.lastAdmittedAt < 1000) return undefined
    this.lastAdmittedAt = now
    return this.pending = { id }
  }

  isCurrent(ticket: UiActionTicket): boolean { return this.pending === ticket }

  submit(ticket: UiActionTicket): boolean {
    if (!this.isCurrent(ticket) || this.submitted.has(ticket)) return false
    this.submitted.add(ticket)
    return true
  }

  finish(ticket: UiActionTicket): void {
    if (this.isCurrent(ticket)) this.pending = undefined
  }

  // Disconnect, navigation, reload and unmount revoke an outstanding confirmation.
  invalidate(): UiActionTicket | undefined {
    const revoked = this.pending
    this.pending = undefined
    return revoked
  }
}

export function parseUiBridgeMessage(raw: string, token: string): Record<string, unknown> | undefined {
  // Bound work before JSON.parse, including escaped 4,000-character prompts.
  if (raw.length > 32_768) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const message = value as Record<string, unknown>
    return message.token === token ? message : undefined
  } catch { return undefined }
}
