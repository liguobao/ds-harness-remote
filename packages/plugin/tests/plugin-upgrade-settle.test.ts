import { describe, expect, it } from 'vitest'
import { settleLostUpgrade } from '../src/client/plugin-upgrade.js'
import type { RemoteStatus } from '../src/client/types.js'

const LATEST = '0.6.4'

function status(currentVersion: string | undefined, extra: Partial<RemoteStatus> = {}): RemoteStatus {
  return {
    mode: 'local',
    available: true,
    hostAuthorizationAvailable: false,
    ...(currentVersion === undefined ? {} : { update: { currentVersion, latestVersion: LATEST, checkedAt: 1 } }),
    ...extra,
  }
}

/** Replays `script` one read at a time; the last entry repeats. Errors are thrown. */
function reads(script: Array<RemoteStatus | Error>): { read(): Promise<RemoteStatus>; count(): number } {
  let index = 0
  return {
    read: async () => {
      const next = script[Math.min(index, script.length - 1)]!
      index += 1
      if (next instanceof Error) throw next
      return next
    },
    count: () => index,
  }
}

describe('lost plugin.update response', () => {
  it('concludes from the Host version, never from the error text', async () => {
    const failures: string[] = []
    const scenarios: Array<{ name: string; run(): Promise<void> }> = [
      {
        name: 'connection dropped before the upgrade started: Host still old and live -> unknown, retryable',
        async run() {
          const source = reads([status('0.6.3')])
          const outcome = await settleLostUpgrade(source.read, LATEST, { sleep: async () => {} })
          expect(outcome).toBe('unknown')
          expect(source.count()).toBe(3)
        },
      },
      {
        name: 'plugin unloaded then reloaded on the new version -> upgraded',
        async run() {
          const source = reads([
            new Error('failed to fetch'),
            status(undefined, { controlUnavailable: true, available: false }),
            status('0.6.4'),
          ])
          expect(await settleLostUpgrade(source.read, LATEST, { sleep: async () => {} })).toBe('upgraded')
        },
      },
      {
        name: 'plugin down for the whole deadline -> unknown, not a fake success',
        async run() {
          const source = reads([new Error('failed to fetch')])
          const outcome = await settleLostUpgrade(source.read, LATEST, {
            sleep: async () => {},
            intervalMs: 1_000,
            unreachableDeadlineMs: 5_000,
          })
          expect(outcome).toBe('unknown')
          expect(source.count()).toBe(6)
        },
      },
      {
        name: 'fresh plugin without registry snapshot does not count as stalled',
        async run() {
          const source = reads([status(undefined), status(undefined), status(undefined), status(undefined), status('0.6.4')])
          expect(await settleLostUpgrade(source.read, LATEST, { sleep: async () => {} })).toBe('upgraded')
        },
      },
      {
        name: 'old version seen while the plugin is still unloading, then new version -> upgraded',
        async run() {
          const source = reads([status('0.6.3'), status('0.6.3'), status('0.6.4')])
          expect(await settleLostUpgrade(source.read, LATEST, { sleep: async () => {} })).toBe('upgraded')
        },
      },
    ]
    for (const scenario of scenarios) {
      try {
        await scenario.run()
      } catch (error) {
        failures.push(`${scenario.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    expect(failures).toEqual([])
  })
})
