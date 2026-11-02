import type { FetchImplementation } from './server-api.js'
import type { SafeLogger } from './logging.js'
import { PLUGIN_VERSION } from './version.js'

/**
 * Update state published through the control-plane `status` payload. It is
 * kept after every successful registry check, even when the local version is
 * current, because the client also marks remote Hosts running an older
 * plugin than the registry's `latest`.
 */
export interface PluginUpdateSnapshot {
  currentVersion: string
  latestVersion: string
  checkedAt: number
}

/** dist-tags endpoints raced in parallel; the mirror backs up the official registry. */
const DIST_TAG_URLS = [
  'https://registry.npmjs.org/-/package/ds-harness-remote/dist-tags',
  'https://registry.npmmirror.com/-/package/ds-harness-remote/dist-tags',
]
const FETCH_TIMEOUT_MS = 10_000
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

/**
 * Startup and daily lookup of the plugin's latest published version against
 * the npm registry. The check is fire-and-forget: failures are logged at
 * debug level and never surface to the user or block plugin startup.
 */
export class PluginUpdateChecker {
  private state?: PluginUpdateSnapshot
  private timer: ReturnType<typeof setInterval> | undefined
  private flight?: Promise<void>
  private stopped = false

  constructor(
    private readonly logger: SafeLogger,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  /** Latest successful registry check, or `undefined` before the first one. */
  snapshot(): PluginUpdateSnapshot | undefined {
    return this.state
  }

  /** Run the first check and re-check daily. Safe to call more than once. */
  start(): void {
    if (this.stopped || this.timer !== undefined) return
    void this.check()
    this.timer = setInterval(() => { void this.check() }, RECHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  /** One registry check; concurrent callers share the in-flight request. */
  check(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.flight ??= this.run().finally(() => { this.flight = undefined })
    return this.flight
  }

  private async run(): Promise<void> {
    try {
      const latest = await this.fetchLatestVersion()
      if (latest === undefined) return
      this.state = { currentVersion: PLUGIN_VERSION, latestVersion: latest, checkedAt: Date.now() }
      this.logger.debug('plugin update check complete', { current: PLUGIN_VERSION, latest })
    } catch {
      // Registry reachability varies by network; a failed check must stay invisible.
      this.logger.debug('plugin update check failed', { code: 'UPDATE_CHECK_FAILED' })
    }
  }

  /**
   * Race every dist-tags endpoint in parallel: the first valid answer wins, so
   * a network that stalls the official registry does not wait out its timeout
   * before the mirror is consulted.
   */
  private fetchLatestVersion(): Promise<string | undefined> {
    return new Promise(resolve => {
      let pending = DIST_TAG_URLS.length
      let settled = false
      const settle = (latest: string | undefined): void => {
        if (settled) return
        if (latest !== undefined) {
          settled = true
          resolve(latest)
          return
        }
        pending -= 1
        if (pending === 0) resolve(undefined)
      }
      for (const url of DIST_TAG_URLS) {
        this.fetchDistTags(url).then(settle, () => settle(undefined))
      }
    })
  }

  private async fetchDistTags(url: string): Promise<string | undefined> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    timeout.unref?.()
    try {
      const response = await this.fetchImplementation(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`dist-tags responded ${response.status}`)
      const tags = await response.json() as Record<string, unknown>
      if (typeof tags.latest !== 'string' || !SEMVER_PATTERN.test(tags.latest)) return undefined
      return tags.latest
    } finally {
      clearTimeout(timeout)
    }
  }
}
