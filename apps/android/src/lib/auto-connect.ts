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

export interface StartupAutoConnectInput {
  devices: readonly RemoteDevice[]
  autoConnectHost: boolean
  resumeConversation: boolean
  lastBrowse?: { scope: string; deviceId: string; sessionId: string }
  lastConnectedDeviceId?: string
  hostModes?: Readonly<Record<string, 'agent' | 'bot'>>
  scopeForDevice: (device: RemoteDevice) => string
}

export type StartupAutoConnectTarget =
  | { kind: 'none' }
  | { kind: 'connect'; device: RemoteDevice; sessionId?: string }

/** Pure startup decision: whether to auto-connect a host, and to which session. */
export function resolveStartupAutoConnect(input: StartupAutoConnectInput): StartupAutoConnectTarget {
  // A disabled preference keeps startup on the device list, even with resume
  // enabled or a single online host.
  if (!input.autoConnectHost) return { kind: 'none' }

  // (a) Resume the remembered conversation when it still maps to a trusted,
  // online host with the same scope.
  if (input.resumeConversation && input.lastBrowse) {
    const { deviceId, scope, sessionId } = input.lastBrowse
    const device = input.devices.find(candidate => (
      candidate.deviceId === deviceId
      && candidate.trusted
      && candidate.online
      && input.scopeForDevice(candidate) === scope
    ))
    if (device !== undefined) {
      return input.hostModes?.[scope] === 'bot'
        ? { kind: 'connect', device }
        : { kind: 'connect', device, sessionId }
    }
  }

  // (b) Reconnect the last used host even when conversation resume is off.
  const remembered = resolveAutoConnectDevice([...input.devices], input.lastConnectedDeviceId)
  if (remembered !== undefined) return { kind: 'connect', device: remembered }

  // (c) A single trusted, online host is an unambiguous default.
  const only = input.devices.length === 1 ? input.devices[0] : undefined
  if (only?.trusted && only.online) return { kind: 'connect', device: only }

  // (d) Offline, untrusted or ambiguous multi-host lists stay on the list.
  return { kind: 'none' }
}
