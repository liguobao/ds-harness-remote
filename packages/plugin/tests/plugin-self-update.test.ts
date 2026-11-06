import { describe, expect, it, vi } from 'vitest'
import { LocalPluginUpgrade, type PluginManagerUpdate } from '../src/plugin-self-update.js'
import type { PluginUpdateSnapshot } from '../src/update-check.js'

const CURRENT = '0.6.3'
const LATEST = '0.6.4'

function checker(latest = LATEST): { snapshot(): PluginUpdateSnapshot } {
  return { snapshot: () => ({ currentVersion: CURRENT, latestVersion: latest, checkedAt: 1 }) }
}

describe('local plugin online upgrade', () => {
  it('updates only an updatable registry install of the checked version', async () => {
    const failures: string[] = []
    const scenarios: Array<{ name: string; run(): Promise<void> }> = [
      {
        name: 'registry bundle becomes ready after listBundles',
        async run() {
          const manager: PluginManagerUpdate = {
            listBundles: async () => [{ name: 'ds-harness-remote', updatable: true }],
            updateBundle: vi.fn(),
          }
          const upgrade = new LocalPluginUpgrade(checker(), () => manager, () => () => undefined)
          expect(upgrade.snapshot()?.upgrade).toBeUndefined()
          await vi.waitFor(() => expect(upgrade.snapshot()?.upgrade).toBe('ready'))
        },
      },
      {
        name: 'github install stays manual and is not replaced',
        async run() {
          const updateBundle = vi.fn()
          const manager: PluginManagerUpdate = {
            listBundles: async () => [{ name: 'ds-harness-remote', updatable: false }],
            updateBundle,
          }
          const upgrade = new LocalPluginUpgrade(checker(), () => manager, () => () => undefined)
          upgrade.snapshot()
          await vi.waitFor(() => expect(upgrade.snapshot()?.upgrade).toBeUndefined())
          expect(await upgrade.start(LATEST)).toEqual({ status: 'manual' })
          expect(updateBundle).not.toHaveBeenCalled()
        },
      },
      {
        name: 'a version other than the registry latest is rejected',
        async run() {
          const updateBundle = vi.fn()
          const upgrade = new LocalPluginUpgrade(checker(), () => ({
            listBundles: async () => [{ name: 'ds-harness-remote', updatable: true }],
            updateBundle,
          }), () => () => undefined)
          expect(await upgrade.start('9.9.9')).toEqual({ status: 'rejected' })
          expect(await upgrade.start(CURRENT)).toEqual({ status: 'rejected' })
          expect(updateBundle).not.toHaveBeenCalled()
        },
      },
      {
        name: 'a preflight refusal is returned before the bundle is removed',
        async run() {
          const updateBundle = vi.fn(async () => ({
            step: 'check',
            result: { application: 'failed', error: { code: 'incompatible-version', diagnostic: 'needs a newer Harness' } },
          }))
          const upgrade = new LocalPluginUpgrade(checker(), () => ({
            listBundles: async () => [{ name: 'ds-harness-remote', updatable: true }],
            updateBundle,
          }), () => () => undefined)
          expect(await upgrade.start(LATEST)).toEqual({
            status: 'failed',
            message: 'incompatible-version: needs a newer Harness',
          })
          expect(updateBundle).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'removal announcement returns before the manager unloads this plugin',
        async run() {
          const listeners: Array<(event: { requestId?: unknown; step?: unknown }) => void> = []
          let release: (value: unknown) => void = () => undefined
          const pending = new Promise(resolve => { release = resolve })
          const updateBundle = vi.fn((_name: string, _version: string, options: { requestId: string }) => {
            for (const listener of listeners) listener({ requestId: options.requestId, step: 'removing' })
            return pending
          })
          const upgrade = new LocalPluginUpgrade(checker(), () => ({
            listBundles: async () => [{ name: 'ds-harness-remote', updatable: true }],
            updateBundle,
          }), listener => {
            listeners.push(listener)
            return () => { listeners.splice(listeners.indexOf(listener), 1) }
          })
          const first = upgrade.start(LATEST)
          const second = upgrade.start(LATEST)
          await expect(first).resolves.toEqual({ status: 'started' })
          await expect(second).resolves.toEqual({ status: 'started' })
          expect(updateBundle).toHaveBeenCalledTimes(1)
          expect(updateBundle.mock.calls[0]?.[0]).toBe('ds-harness-remote')
          expect(updateBundle.mock.calls[0]?.[1]).toBe(LATEST)
          expect(listeners).toEqual([])
          release({})
          await pending
        },
      },
      {
        name: 'a missing plugin manager stays on the manual path',
        async run() {
          const upgrade = new LocalPluginUpgrade(checker(), () => undefined, () => () => undefined)
          expect(await upgrade.start(LATEST)).toEqual({ status: 'manual' })
          expect(upgrade.snapshot()?.upgrade).toBeUndefined()
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
