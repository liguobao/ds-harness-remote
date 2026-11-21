export const MAX_DETACHED_APPROVALS = 16

/**
 * Shared Host-wide cap for detached approvals held concurrently across
 * Codex and ACP. Keyed by unique approval tokens so repeated releases are
 * idempotent and combined detached holds can never exceed `max`.
 */
export class DetachedApprovalBudget {
  private readonly held = new Set<string>()

  constructor(readonly max: number = MAX_DETACHED_APPROVALS) {}

  count(): number {
    return this.held.size
  }

  hasCapacity(): boolean {
    return this.held.size < this.max
  }

  tryAcquire(token: string): boolean {
    if (this.held.has(token)) return true
    if (this.held.size >= this.max) return false
    this.held.add(token)
    return true
  }

  release(token: string): void {
    this.held.delete(token)
  }

  releasePrefix(prefix: string): void {
    for (const token of [...this.held]) {
      if (token.startsWith(prefix)) this.held.delete(token)
    }
  }
}
