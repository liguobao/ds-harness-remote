import { randomUUID } from 'node:crypto'
import { compareVersions } from './version-compare.js'
import type { PluginUpdateSnapshot } from './update-check.js'

/** npm package name the official plugin manager uses for this bundle. */
export const REMOTE_PLUGIN_PACKAGE = 'ds-harness-remote'

/**
 * Result of asking the local Host to replace this plugin.
 * `rejected` is a version the registry check did not publish.
 * `manual` means this install cannot use the official online update.
 * `started` means the manager passed its preflight and is replacing the bundle;
 * the caller must return before that replacement unloads this plugin.
 */
export type PluginSelfUpdateResult =
  | { status: 'rejected' }
  | { status: 'manual' }
  | { status: 'started' }
  | { status: 'failed'; message: string }

/** Official plugin-manager face this plugin needs. Older hosts simply lack it. */
export interface PluginManagerUpdate {
  listBundles(): Promise<unknown>
  updateBundle(name: string, version: string, options: { requestId: string }): Promise<unknown>
}

interface UpdateProgress {
  requestId?: unknown
  step?: unknown
}

interface UpdateChecker {
  snapshot(): PluginUpdateSnapshot | undefined
}

/**
 * Local Desktop upgrade through Harness `pluginManager.updateBundle`.
 *
 * The encrypted Remote channel must not call this: replacing this plugin from
 * a connected device is refused in the Host bridge. Only the loopback control
 * plane on this computer may start it, and only for the version the registry
 * check already published.
 */
export class LocalPluginUpgrade {
  private decidedVersion: string | undefined
  private ready = false
  private probeFlight: Promise<void> | undefined
  private startFlight: Promise<PluginSelfUpdateResult> | undefined

  constructor(
    private readonly checker: UpdateChecker,
    private readonly manager: () => PluginManagerUpdate | undefined,
    private readonly subscribe: (listener: (event: UpdateProgress) => void) => () => void,
    private readonly requestId: () => string = randomUUID,
  ) {}

  /** Registry snapshot, plus `upgrade: 'ready'` once this install is confirmed updatable. */
  snapshot(): PluginUpdateSnapshot | undefined {
    const base = this.checker.snapshot()
    if (base === undefined) return undefined
    if (compareVersions(base.currentVersion, base.latestVersion) < 0) {
      if (this.decidedVersion !== base.latestVersion) this.probe(base.latestVersion)
      if (this.ready && this.decidedVersion === base.latestVersion) return { ...base, upgrade: 'ready' }
    }
    return base
  }

  /**
   * Replace this plugin with `version` when it is the checked latest and the
   * official manager marks the installed bundle updatable.
   */
  start(version: string): Promise<PluginSelfUpdateResult> {
    const refused = this.refusal(version)
    if (refused !== undefined) return Promise.resolve(refused)
    this.startFlight ??= this.execute(version).finally(() => { this.startFlight = undefined })
    return this.startFlight
  }

  private refusal(version: string): PluginSelfUpdateResult | undefined {
    const current = this.checker.snapshot()
    if (
      current === undefined
      || version !== current.latestVersion
      || compareVersions(current.currentVersion, version) >= 0
    ) return { status: 'rejected' }
    return undefined
  }

  private probe(version: string): void {
    if (this.probeFlight !== undefined) return
    this.probeFlight = this.readReady()
      .then(ready => {
        this.ready = ready
        this.decidedVersion = version
      })
      .finally(() => { this.probeFlight = undefined })
  }

  private async readReady(): Promise<boolean> {
    try {
      const manager = this.manager()
      if (manager === undefined) return false
      return bundleUpdatable(await manager.listBundles(), REMOTE_PLUGIN_PACKAGE)
    } catch {
      return false
    }
  }

  private async execute(version: string): Promise<PluginSelfUpdateResult> {
    const manager = this.manager()
    if (manager === undefined) return { status: 'manual' }
    let updatable = false
    try {
      updatable = bundleUpdatable(await manager.listBundles(), REMOTE_PLUGIN_PACKAGE)
    } catch {
      return { status: 'manual' }
    }
    if (!updatable) return { status: 'manual' }

    const requestId = this.requestId()
    let dispose = (): void => {}
    const started = new Promise<PluginSelfUpdateResult>(resolve => {
      dispose = this.subscribe(event => {
        if (event.requestId !== requestId) return
        if (event.step === 'removing' || event.step === 'installing') resolve({ status: 'started' })
      })
    })
    try {
      const settled = manager.updateBundle(REMOTE_PLUGIN_PACKAGE, version, { requestId })
        .then(result => classifyUpdateResult(result))
        .catch(() => ({ status: 'failed', message: 'update-failed' }) satisfies PluginSelfUpdateResult)
      return await Promise.race([started, settled])
    } finally {
      dispose()
    }
  }
}

/** Whether one `listBundles` row is this package and officially updatable. */
export function bundleUpdatable(listed: unknown, packageName: string): boolean {
  if (!Array.isArray(listed)) return false
  return listed.some(row => isRecord(row) && row.name === packageName && row.updatable === true)
}

function classifyUpdateResult(result: unknown): PluginSelfUpdateResult {
  if (!isRecord(result) || !isRecord(result.result)) return { status: 'failed', message: 'update-failed' }
  const application = result.result.application
  if (application === 'applied' || application === 'restart-required') return { status: 'started' }
  return { status: 'failed', message: failureMessage(result.result.error) }
}

function failureMessage(error: unknown): string {
  if (!isRecord(error)) return 'update-failed'
  const code = typeof error.code === 'string' && error.code.length > 0 && error.code.length <= 80
    ? error.code
    : 'update-failed'
  const diagnostic = typeof error.diagnostic === 'string'
    ? error.diagnostic.replace(/\s+/g, ' ').trim().slice(0, 180)
    : ''
  return diagnostic === '' ? code : `${code}: ${diagnostic}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
