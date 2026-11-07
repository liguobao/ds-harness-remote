import { identityFingerprint } from '@dsh-remote/crypto'
import type { DevicePresence, RemoteDevice } from '../types'
import type { AuthorizedPeerDevice } from './api'
import { connectionLog } from './connection-log'

export interface DeviceDirectoryApi {
  listDevices(): Promise<RemoteDevice[]>
  deviceFor(deviceId: string): Promise<AuthorizedPeerDevice>
  getPresence(deviceId: string): Promise<DevicePresence>
}

export interface ReconciledDevices {
  devices: RemoteDevice[]
  /** Locally pinned hosts the Server no longer authorizes for this account. */
  missingTrustedDeviceIds: string[]
  /** Hosts the account can see that are not yet pinned on this phone. */
  unpinnedDeviceIds: string[]
  /** Locally pinned hosts whose Server identity key no longer matches. */
  keyMismatchDeviceIds: string[]
  /** Hosts whose descriptor lookup failed. */
  lookupFailedDeviceIds: string[]
  /** First descriptor lookup failure, if any. */
  lookupError?: unknown
}

/**
 * Reconcile Server membership with locally pinned Host identities.
 *
 * The Server intentionally omits identityKey from the device list, so the
 * client fetches each authorized Host's descriptor through `deviceFor` and
 * pins its Noise identity key locally. A locally pinned key that differs from
 * the Server descriptor fails closed (the Host was re-registered with a new
 * key); a missing local pin is reported for the pairing/trust decision.
 */
export async function reconcileTrustedDevices(
  api: DeviceDirectoryApi,
  trusted: RemoteDevice[],
): Promise<ReconciledDevices> {
  const memberships = await api.listDevices()
  const byId = new Map(memberships.map(device => [device.deviceId, device]))
  const missingTrustedDeviceIds = trusted
    .filter(device => !byId.has(device.deviceId))
    .map(device => device.deviceId)

  const devices: RemoteDevice[] = []
  const unpinnedDeviceIds: string[] = []
  const keyMismatchDeviceIds: string[] = []
  const lookupFailedDeviceIds: string[] = []
  let lookupError: unknown

  const lookup = async (deviceId: string): Promise<AuthorizedPeerDevice | undefined> => {
    try {
      return await api.deviceFor(deviceId)
    } catch (error) {
      lookupError ??= error
      lookupFailedDeviceIds.push(deviceId)
      return undefined
    }
  }

  for (const membership of memberships) {
    const local = trusted.find(device => device.deviceId === membership.deviceId)
    if (local !== undefined) {
      if (local.identityKey.length === 0) {
        unpinnedDeviceIds.push(membership.deviceId)
        continue
      }
      const descriptor = await lookup(membership.deviceId)
      if (descriptor !== undefined && descriptor.identityKey !== local.identityKey) {
        // The Host re-registered with a different key: refuse to trust it.
        keyMismatchDeviceIds.push(membership.deviceId)
        continue
      }
      const presence = await api.getPresence(membership.deviceId).catch(() => undefined)
      devices.push({
        ...local,
        ...membership,
        identityKey: local.identityKey,
        fingerprint: local.fingerprint ?? formatFingerprint(identityFingerprint(local.identityKey)),
        online: presence?.online ?? membership.online === true,
        lastSeenAt: presence?.lastSeenAt ?? local.lastSeenAt ?? membership.lastSeenAt,
        trusted: true,
      })
      continue
    }
    const descriptor = await lookup(membership.deviceId)
    if (descriptor === undefined || descriptor.role !== 'host' || descriptor.identityKey.length === 0) {
      unpinnedDeviceIds.push(membership.deviceId)
      continue
    }
    const presence = await api.getPresence(membership.deviceId).catch(() => undefined)
    devices.push({
      ...membership,
      identityKey: descriptor.identityKey,
      fingerprint: formatFingerprint(identityFingerprint(descriptor.identityKey)),
      online: presence?.online ?? membership.online === true,
      lastSeenAt: presence?.lastSeenAt ?? membership.lastSeenAt,
      trusted: false,
    })
  }
  connectionLog('devices', {
    listed: memberships.length,
    resolved: devices.length,
    unpinned: unpinnedDeviceIds.length,
    keyMismatch: keyMismatchDeviceIds.length,
    lookupFailed: lookupFailedDeviceIds.length,
    missingTrusted: missingTrustedDeviceIds.length,
  })
  return {
    devices,
    missingTrustedDeviceIds,
    unpinnedDeviceIds,
    keyMismatchDeviceIds,
    lookupFailedDeviceIds,
    ...(lookupError === undefined ? {} : { lookupError }),
  }
}

function formatFingerprint(value: string): string {
  return value.match(/.{1,4}/g)?.join(' ') ?? value
}
