import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import { reconcileTrustedDevices, type DeviceDirectoryApi } from '../src/services/device-directory'
import type { RemoteDevice } from '../src/types'

describe('trusted device reconciliation', () => {
  it('reconciles authorized Host descriptors with pinned identities', async () => {
    await runScenarios([
      {
        name: 'keeps the locally pinned identity key and follows Server membership and presence',
        run: async () => {
          const trusted: RemoteDevice[] = [
            {
              deviceId: 'host-1',
              name: 'Old name',
              platform: 'linux',
              identityKey: 'pinned-key',
              membershipId: 'membership-1',
              online: false,
              fingerprint: 'AABB',
              trusted: true,
            },
            {
              deviceId: 'revoked-host',
              name: 'Revoked',
              platform: 'linux',
              identityKey: 'old-key',
              membershipId: 'membership-old',
              online: true,
              trusted: true,
            },
          ]
          const api: DeviceDirectoryApi = {
            listDevices: vi.fn(async () => [
              {
                deviceId: 'host-1',
                name: 'Current name',
                platform: 'linux',
                role: 'host' as const,
                membershipId: 'membership-1',
                harnessVersion: '0.1.0',
                identityKey: '',
                online: false,
                trusted: false,
              },
            ]),
            deviceFor: vi.fn(async () => ({
              deviceId: 'host-1',
              name: 'Current name',
              role: 'host' as const,
              platform: 'linux',
              identityKey: 'pinned-key',
              membershipId: 'membership-1',
            })),
            getPresence: vi.fn(async () => ({ deviceId: 'host-1', online: true, lastSeenAt: 1234 })),
          }
          const result = await reconcileTrustedDevices(api, trusted)
          expect(result.missingTrustedDeviceIds).toEqual(['revoked-host'])
          expect(result.devices).toEqual([
            expect.objectContaining({
              deviceId: 'host-1',
              name: 'Current name',
              membershipId: 'membership-1',
              identityKey: 'pinned-key',
              fingerprint: 'AABB',
              online: true,
              lastSeenAt: 1234,
              trusted: true,
            }),
          ])
        },
      },
      {
        name: 'fails closed when the Server descriptor presents a different identity key',
        run: async () => {
          const trusted: RemoteDevice[] = [
            {
              deviceId: 'host-1',
              name: 'Host',
              platform: 'linux',
              identityKey: 'pinned-key',
              membershipId: 'membership-1',
              online: false,
              trusted: true,
            },
          ]
          const api: DeviceDirectoryApi = {
            listDevices: vi.fn(async () => [
              {
                deviceId: 'host-1',
                name: 'Host',
                platform: 'linux',
                role: 'host' as const,
                membershipId: 'membership-1',
                identityKey: '',
                online: false,
                trusted: false,
              },
            ]),
            deviceFor: vi.fn(async () => ({
              deviceId: 'host-1',
              name: 'Host',
              role: 'host' as const,
              platform: 'linux',
              identityKey: 'different-key',
              membershipId: 'membership-1',
            })),
            getPresence: vi.fn(async () => ({ deviceId: 'host-1', online: true })),
          }
          const result = await reconcileTrustedDevices(api, trusted)
          expect(result.devices).toEqual([])
          expect(result.missingTrustedDeviceIds).toEqual([])
        },
      },
      {
        name: 'pins new Host identity keys from the authorized peer descriptor',
        run: async () => {
          const api: DeviceDirectoryApi = {
            listDevices: vi.fn(async () => [
              {
                deviceId: 'host-2',
                name: 'New host',
                platform: 'linux',
                role: 'host' as const,
                membershipId: 'membership-2',
                online: true,
                identityKey: '',
                trusted: false,
              },
            ]),
            deviceFor: vi.fn(async () => ({
              deviceId: 'host-2',
              name: 'New host',
              role: 'host' as const,
              platform: 'linux',
              identityKey: 'new-key',
              membershipId: 'membership-2',
              online: true,
            })),
            getPresence: vi.fn(async () => ({ deviceId: 'host-2', online: true })),
          }
          const result = await reconcileTrustedDevices(api, [])
          expect(result.unpinnedDeviceIds).toEqual([])
          expect(result.devices).toEqual([
            expect.objectContaining({
              deviceId: 'host-2',
              identityKey: 'new-key',
              online: true,
              trusted: false,
            }),
          ])
        },
      },
      {
        name: 'reports hosts whose descriptor cannot be read as unpinned',
        run: async () => {
          const api: DeviceDirectoryApi = {
            listDevices: vi.fn(async () => [
              {
                deviceId: 'host-3',
                name: 'Unreadable',
                platform: 'linux',
                role: 'host' as const,
                membershipId: 'membership-3',
                identityKey: '',
                online: false,
                trusted: false,
              },
            ]),
            deviceFor: vi.fn(async () => {
              throw new Error('offline')
            }),
            getPresence: vi.fn(async () => ({ deviceId: 'host-3', online: false })),
          }
          const result = await reconcileTrustedDevices(api, [])
          expect(result.unpinnedDeviceIds).toEqual(['host-3'])
          expect(result.devices).toEqual([])
        },
      },
    ])
  }, 20000)

})
