import { compareVersions } from '../version-compare.js'
import type { RemoteStatus } from './types.js'

/**
 * What the Desktop popup can conclude after `plugin.update` died without a
 * response. `upgraded`: the Host reports the target version. `unknown`: no
 * proof the upgrade ran; the caller must re-enable the button.
 */
export type LostUpgradeOutcome = 'upgraded' | 'unknown'

export interface LostUpgradeOptions {
  intervalMs?: number
  /** Total wait while the Host control route is unreachable (plugin being replaced). */
  unreachableDeadlineMs?: number
  /** Consecutive reads of the old version from a live Host that prove nothing started. */
  stalledReads?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULTS = {
  intervalMs: 1_000,
  unreachableDeadlineMs: 60_000,
  stalledReads: 3,
}

/**
 * A lost `plugin.update` response is ambiguous: the manager unloads this
 * plugin once installation begins (the response dies with it), but a plain
 * network error before the request reached the Host looks identical. Resolve
 * it from the Host's own status instead of from the error text.
 *
 * - Version at or above `latest`: the upgrade happened.
 * - Control route unreachable: keep waiting, the plugin may be reinstalling,
 *   until the deadline.
 * - Live Host still on the old version for `stalledReads` reads in a row: the
 *   request never started an upgrade.
 */
export async function settleLostUpgrade(
  readStatus: () => Promise<RemoteStatus>,
  latest: string,
  options: LostUpgradeOptions = {},
): Promise<LostUpgradeOutcome> {
  const intervalMs = options.intervalMs ?? DEFAULTS.intervalMs
  const deadlineMs = options.unreachableDeadlineMs ?? DEFAULTS.unreachableDeadlineMs
  const stalledReads = options.stalledReads ?? DEFAULTS.stalledReads
  // `Promise.withResolvers` is not in this package's tsconfig `lib`.
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  let waited = 0
  let stalled = 0
  while (waited <= deadlineMs) {
    let status: RemoteStatus | undefined
    try {
      status = await readStatus()
    } catch {
      status = undefined
    }
    const current = status !== undefined && status.controlUnavailable !== true
      ? status.update?.currentVersion
      : undefined
    if (current !== undefined) {
      if (compareVersions(current, latest) >= 0) return 'upgraded'
      stalled += 1
      if (stalled >= stalledReads) return 'unknown'
    } else {
      // Unreachable, or a freshly loaded plugin that has not finished its
      // registry check: neither proves anything about the upgrade.
      stalled = 0
    }
    await sleep(intervalMs)
    waited += intervalMs
  }
  return 'unknown'
}
