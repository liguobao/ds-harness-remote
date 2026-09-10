import type { RemoteDevice } from '../types'

/** Pick the remembered host when it is still trusted and currently online. */
export function resolveAutoConnectDevice(
  devices: RemoteDevice[],
  lastConnectedDeviceId: string | undefined,
): RemoteDevice | undefined {
  if (lastConnectedDeviceId === undefined || lastConnectedDeviceId.trim() === '') return undefined
  return devices.find(device => (
    device.deviceId === lastConnectedDeviceId
    && device.trusted
    && device.online
  ))
}
