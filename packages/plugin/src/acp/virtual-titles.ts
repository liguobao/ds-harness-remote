import type { AcpClientLike, AcpSessionState } from './virtual-contract.js'

const OPENCODE_DEFAULT_TITLE = /^(?:New|Child) session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** Title recovery belongs to the browser-safe projection, never to a native database. */
export class AcpSessionTitles {
  private readonly pending = new Map<string, AbortController>()
  private closed = false

  constructor(
    private readonly backend: string,
    private readonly client: AcpClientLike,
    private readonly sessions: ReadonlyMap<string, AcpSessionState>,
    private readonly publish: (sessionId: string, title: string) => void,
  ) {}

  nativeTitle(title: string | undefined): string | undefined {
    const next = title?.trim()
    if (!next || next === 'Untitled Session' || (this.backend === 'opencode' && OPENCODE_DEFAULT_TITLE.test(next))) return undefined
    return next
  }

  applyNative(session: AcpSessionState, title: string): void {
    const next = this.nativeTitle(title)
    if (this.closed || session.titleOverridden || !next || this.sessions.get(session.sessionId) !== session) return
    session.titleFromPrompt = false
    this.pending.get(session.sessionId)?.abort()
    if (next === session.title) return
    session.title = next
    this.publish(session.sessionId, next)
  }

  applyPrompt(session: AcpSessionState, text: string | undefined): void {
    if (this.backend !== 'opencode' || this.closed || session.titleOverridden || session.titleFromPrompt
      || (!session.blank && this.nativeTitle(session.title) !== undefined)) return
    const next = Array.from(text?.replace(/\s+/g, ' ').trim() ?? '').slice(0, 60).join('')
    if (!next) return
    session.titleFromPrompt = true
    session.title = next
    this.publish(session.sessionId, next)
  }

  async refresh(session: AcpSessionState): Promise<void> {
    if (this.backend === 'cursor' || this.closed || session.titleOverridden || !this.client.listSessions) return
    this.pending.get(session.sessionId)?.abort()
    const controller = new AbortController()
    const signal = controller.signal
    this.pending.set(session.sessionId, controller)
    const deadline = this.backend === 'opencode' ? setTimeout(() => controller.abort(), 20_000) : undefined
    try {
      // OpenCode generates titles independently of the reply and does not always
      // forward renames over ACP. Recover late titles for at most twenty seconds.
      for (const delay of this.backend === 'opencode' ? [0, 1000, 3000, 6000, 9000] : [0]) {
        if (delay) await waitForTitle(delay, signal)
        if (signal.aborted || this.closed || session.titleOverridden) return
        const previous = session.title
        try {
          const items = await this.client.listSessions(session.cwd, this.backend, 30, signal)
          if (signal.aborted || this.sessions.get(session.sessionId) !== session || session.title !== previous) return
          const current = items.find(item => item.conversationId === session.acpSessionId)
          if (current && this.nativeTitle(current.title) !== undefined) {
            this.applyNative(session, current.title)
            return
          }
        } catch {
          // Metadata recovery must never fail an already completed turn.
        }
      }
    } finally {
      if (deadline !== undefined) clearTimeout(deadline)
      if (this.pending.get(session.sessionId) === controller) this.pending.delete(session.sessionId)
    }
  }

  close(): void {
    this.closed = true
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
  }
}

function waitForTitle(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, delay)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}
