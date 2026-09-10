import { describe, expect, it } from 'vitest'
import { resolveAutoConnectDevice } from '../src/lib/auto-connect'
import type { RemoteDevice } from '../src/types'

function device(partial: Partial<RemoteDevice> & Pick<RemoteDevice, 'deviceId'>): RemoteDevice {
  return {
    name: partial.name ?? partial.deviceId,
    online: partial.online ?? false,
    trusted: partial.trusted ?? false,
    identityKey: partial.identityKey ?? '',
    membershipId: partial.membershipId ?? `m-${partial.deviceId}`,
    platform: partial.platform ?? 'darwin',
    ...partial,
  }
}

describe('resolveAutoConnectDevice', () => {
  const devices = [
    device({ deviceId: 'offline-trusted', trusted: true, online: false }),
    device({ deviceId: 'online-untrusted', trusted: false, online: true }),
    device({ deviceId: 'ready', trusted: true, online: true, name: 'Desk' }),
  ]

  it('returns the remembered host when trusted and online', () => {
    expect(resolveAutoConnectDevice(devices, 'ready')?.deviceId).toBe('ready')
  })

  it('skips offline or untrusted hosts', () => {
    expect(resolveAutoConnectDevice(devices, 'offline-trusted')).toBeUndefined()
    expect(resolveAutoConnectDevice(devices, 'online-untrusted')).toBeUndefined()
  })

  it('returns undefined without a remembered id', () => {
    expect(resolveAutoConnectDevice(devices, undefined)).toBeUndefined()
    expect(resolveAutoConnectDevice(devices, '   ')).toBeUndefined()
    expect(resolveAutoConnectDevice(devices, 'missing')).toBeUndefined()
  })
})
