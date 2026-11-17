import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it } from 'vitest'
import {
  resolveAutoConnectDevice,
  resolveStartupAutoConnect,
  type StartupAutoConnectInput,
  type StartupAutoConnectTarget,
} from '../src/lib/auto-connect'
import type { RemoteDevice } from '../src/types'

const device = (deviceId: string, overrides: Partial<RemoteDevice> = {}): RemoteDevice => ({
  deviceId, name: deviceId, platform: 'linux', identityKey: `key-${deviceId}`,
  membershipId: `member-${deviceId}`, online: true, trusted: true, ...overrides,
})
const scopeForDevice = (d: RemoteDevice): string => `scope:${d.deviceId}`
const base = (over: Partial<StartupAutoConnectInput> = {}): StartupAutoConnectInput => ({
  devices: [], autoConnectHost: true, resumeConversation: false, scopeForDevice, ...over,
})
type Case = { name: string; input: StartupAutoConnectInput; expected: StartupAutoConnectTarget }
const matrix = (cases: Case[]) => runScenarios(cases.map(({ name, input, expected }) => ({
  name, run: () => expect(resolveStartupAutoConnect(input)).toEqual(expected),
})))

describe('resolveStartupAutoConnect', () => {
  const hostA = device('host-a')
  const hostB = device('host-b')
  const offlineA = device('host-a', { online: false })
  const untrustedA = device('host-a', { trusted: false })
  const browseA = { scope: 'scope:host-a', deviceId: 'host-a', sessionId: 'session-1' }

  it('keeps startup on the device list whenever autoConnectHost is off', async () => {
    await matrix([
      { name: 'off: resume + single trusted online host', input: base({ devices: [hostA], autoConnectHost: false, resumeConversation: true, lastBrowse: browseA }), expected: { kind: 'none' } },
      { name: 'off: single trusted online host without resume', input: base({ devices: [hostA], autoConnectHost: false }), expected: { kind: 'none' } },
      { name: 'off: valid remembered host among several', input: base({ devices: [hostA, hostB], autoConnectHost: false, lastConnectedDeviceId: 'host-a' }), expected: { kind: 'none' } },
      { name: 'off: empty device list', input: base({ devices: [], autoConnectHost: false }), expected: { kind: 'none' } },
    ])
  })

  it('resumes the remembered conversation first and falls back when it is stale', async () => {
    await matrix([
      { name: 'resume: agent mode restores the session id', input: base({ devices: [hostA, hostB], resumeConversation: true, lastBrowse: browseA, hostModes: { 'scope:host-a': 'agent' } }), expected: { kind: 'connect', device: hostA, sessionId: 'session-1' } },
      { name: 'resume: no host mode also restores the session id', input: base({ devices: [hostA, hostB], resumeConversation: true, lastBrowse: browseA }), expected: { kind: 'connect', device: hostA, sessionId: 'session-1' } },
      { name: 'resume: bot mode omits the session id', input: base({ devices: [hostA, hostB], resumeConversation: true, lastBrowse: browseA, hostModes: { 'scope:host-a': 'bot' } }), expected: { kind: 'connect', device: hostA } },
      { name: 'resume: bot mode wins over a remembered host', input: base({ devices: [hostA, hostB], resumeConversation: true, lastBrowse: browseA, hostModes: { 'scope:host-a': 'bot' }, lastConnectedDeviceId: 'host-b' }), expected: { kind: 'connect', device: hostA } },
      { name: 'resume: scope mismatch falls back to the remembered host', input: base({ devices: [hostA, hostB], resumeConversation: true, lastBrowse: { ...browseA, scope: 'stale' }, lastConnectedDeviceId: 'host-b', hostModes: { 'scope:host-a': 'agent' } }), expected: { kind: 'connect', device: hostB } },
      { name: 'resume: scope mismatch falls back to the single online host', input: base({ devices: [hostA], resumeConversation: true, lastBrowse: { ...browseA, scope: 'stale' } }), expected: { kind: 'connect', device: hostA } },
      { name: 'resume: matching host offline does not connect', input: base({ devices: [offlineA], resumeConversation: true, lastBrowse: browseA }), expected: { kind: 'none' } },
      { name: 'resume: matching host untrusted does not connect', input: base({ devices: [untrustedA], resumeConversation: true, lastBrowse: browseA }), expected: { kind: 'none' } },
      { name: 'resume: enabled without a last browse falls through', input: base({ devices: [hostA], resumeConversation: true }), expected: { kind: 'connect', device: hostA } },
      { name: 'resume: unknown last device with several hosts stays put', input: base({ devices: [hostA, hostB], resumeConversation: true, lastBrowse: { ...browseA, deviceId: 'missing', scope: 'scope:missing' } }), expected: { kind: 'none' } },
    ])
  })

  it('reconnects the last host or a single trusted online host, and stays put otherwise', async () => {
    await matrix([
      { name: 'multi-host: reconnect last host without conversation resume', input: base({ devices: [hostA, hostB], lastConnectedDeviceId: 'host-a' }), expected: { kind: 'connect', device: hostA } },
      { name: 'remembered host offline: do not misconnect another online host', input: base({ devices: [offlineA, hostB], lastConnectedDeviceId: 'host-a' }), expected: { kind: 'none' } },
      { name: 'remembered host untrusted: do not misconnect another online host', input: base({ devices: [untrustedA, hostB], lastConnectedDeviceId: 'host-a' }), expected: { kind: 'none' } },
      { name: 'blank remembered id: single online host is still used', input: base({ devices: [hostA], lastConnectedDeviceId: '   ' }), expected: { kind: 'connect', device: hostA } },
      { name: 'single trusted online host is the default', input: base({ devices: [hostA] }), expected: { kind: 'connect', device: hostA } },
      { name: 'single offline host stays put', input: base({ devices: [offlineA] }), expected: { kind: 'none' } },
      { name: 'single untrusted host stays put', input: base({ devices: [untrustedA] }), expected: { kind: 'none' } },
      { name: 'empty device list stays put', input: base({ devices: [] }), expected: { kind: 'none' } },
      { name: 'several hosts with no valid last host stay put', input: base({ devices: [hostA, hostB] }), expected: { kind: 'none' } },
    ])
  })

  it('preserves resolveAutoConnectDevice as the trusted, online last-host lookup', async () => {
    await runScenarios([
      { name: 'finds a trusted, online remembered host', run: () => expect(resolveAutoConnectDevice([hostA, hostB], 'host-a')).toBe(hostA) },
      { name: 'ignores an offline remembered host', run: () => expect(resolveAutoConnectDevice([offlineA, hostB], 'host-a')).toBeUndefined() },
      { name: 'ignores an untrusted remembered host', run: () => expect(resolveAutoConnectDevice([untrustedA, hostB], 'host-a')).toBeUndefined() },
      { name: 'ignores a blank remembered id', run: () => expect(resolveAutoConnectDevice([hostA], '  ')).toBeUndefined() },
      { name: 'ignores an unknown remembered id', run: () => expect(resolveAutoConnectDevice([hostA], 'missing')).toBeUndefined() },
      { name: 'ignores an undefined remembered id', run: () => expect(resolveAutoConnectDevice([hostA], undefined)).toBeUndefined() },
    ])
  })
})
