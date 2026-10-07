import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'

export type HarnessMode = 'local' | 'remote'

export interface RemoteTarget {
  deviceId: string
  name: string
}

const SWITCHED_DOMAINS = [
  'sessions',
  'subagents',
  'host',
  'workspace',
  'skills',
  'agentPresets',
  'events',
  'goals',
  'llm',
  'settings',
  'credentials',
] as const satisfies ReadonlyArray<keyof ApiProxy>

/**
 * Installs stable forwarding objects into the official ApiProxy instance.
 * Existing HTTP/WebSocket carriers retain the same service identity while new
 * requests resolve against the currently selected local or remote target.
 */
export class ApiProxySwitch {
  private remote?: ApiProxy
  private target?: RemoteTarget
  private mode: HarnessMode = 'local'
  private installed = false
  private disconnected = false
  private readonly local: ApiProxy
  private readonly originals: Map<typeof SWITCHED_DOMAINS[number], ApiProxy[typeof SWITCHED_DOMAINS[number]]>
  private readonly localRespond: ApiProxy['respond']

  constructor(local: ApiProxy) {
    this.local = local
    this.originals = new Map(SWITCHED_DOMAINS.map(domain => [domain, local[domain]]))
    this.localRespond = local.respond.bind(local)
  }

  install(): void {
    if (this.installed) return
    for (const domain of SWITCHED_DOMAINS) {
      const localDomain = this.local[domain]
      const forwarder = new Proxy({}, {
        get: (_target, key) => {
          const selected = this.selected(domain) as unknown as Record<PropertyKey, unknown>
          const value = selected[key]
          return typeof value === 'function' ? value.bind(selected) : value
        },
      })
      Object.defineProperty(this.local, domain, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: forwarder as typeof localDomain,
      })
    }
    Object.defineProperty(this.local, 'respond', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: (...args: Parameters<ApiProxy['respond']>) => this.mode === 'remote'
        ? this.requireRemote().respond(...args)
        : this.localRespond(...args),
    })
    this.installed = true
  }

  selectRemote(api: ApiProxy, target: RemoteTarget): void {
    if (!this.installed) throw new Error('The Harness API switch is not installed.')
    this.remote = api
    this.disconnected = false
    this.target = { ...target }
    this.mode = 'remote'
  }

  selectLocal(): void {
    this.disconnected = false
    this.mode = 'local'
    this.remote = undefined
    this.target = undefined
  }

  disconnectRemote(): void {
    if (this.mode === 'remote') this.disconnected = true
  }

  status(): { mode: HarnessMode; target?: RemoteTarget } {
    return { mode: this.mode, ...(this.target === undefined ? {} : { target: { ...this.target } }) }
  }

  restore(): void {
    if (!this.installed) return
    this.selectLocal()
    for (const [domain, value] of this.originals) Object.defineProperty(this.local, domain, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    })
    Object.defineProperty(this.local, 'respond', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: this.localRespond,
    })
    this.installed = false
  }

  private selected(domain: typeof SWITCHED_DOMAINS[number]): ApiProxy[typeof domain] {
    if (this.mode === 'local') return this.originalDomain(domain)
    return this.requireRemote()[domain]
  }

  private originalDomain(domain: typeof SWITCHED_DOMAINS[number]): ApiProxy[typeof domain] {
    return this.originals.get(domain) as ApiProxy[typeof domain]
  }

  private requireRemote(): ApiProxy {
    if (this.disconnected) throw Object.assign(new Error('The Remote connection was lost. Reconnect to continue.'), { code: 'remote/disconnected' })
    if (this.remote === undefined) throw new Error('No remote Harness target is selected.')
    return this.remote
  }
}
