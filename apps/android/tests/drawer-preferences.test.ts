import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeData: Record<string, string> = {}

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => storeData[key] ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    storeData[key] = value
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    delete storeData[key]
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}))

vi.mock('@dsh-remote/crypto', () => ({
  generateKeyPair: vi.fn(),
}))

vi.mock('expo-application', () => ({
  applicationId: 'com.dsh.test',
}))

vi.mock('expo-device', () => ({
  modelName: 'Test Phone',
}))

vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn(),
  randomUUID: vi.fn(() => 'mock-uuid'),
}))

import {
  isSessionFilterMode,
  isSessionGroupBy,
  isSessionOrderBy,
  loadHostSessionsDrawerGroups,
  loadHostSessionsDrawerPreferences,
  saveHostSessionsDrawerGroup,
  saveHostSessionsDrawerPreferences,
} from '../src/services/storage'

describe('drawer preferences and view persistence', () => {
  beforeEach(() => {
    for (const k of Object.keys(storeData)) {
      delete storeData[k]
    }
  })

  it('validates preference guards strictly', () => {
    expect(isSessionGroupBy('workspace')).toBe(true)
    expect(isSessionGroupBy('workspace-tree')).toBe(true)
    expect(isSessionGroupBy('list')).toBe(true)
    expect(isSessionGroupBy('invalid')).toBe(false)
    expect(isSessionGroupBy(undefined)).toBe(false)

    expect(isSessionOrderBy('manual')).toBe(true)
    expect(isSessionOrderBy('updated')).toBe(true)
    expect(isSessionOrderBy('created')).toBe(false)
    expect(isSessionOrderBy(null)).toBe(false)

    expect(isSessionFilterMode('hideArchived')).toBe(true)
    expect(isSessionFilterMode('all')).toBe(true)
    expect(isSessionFilterMode('archivedOnly')).toBe(true)
    expect(isSessionFilterMode('none')).toBe(false)
  })

  it('loads empty preferences when nothing is stored', async () => {
    const prefs = await loadHostSessionsDrawerPreferences('device-1')
    expect(prefs).toEqual({})
  })

  it('saves and reloads device-specific and global preferences', async () => {
    await saveHostSessionsDrawerPreferences('device-1', {
      groupBy: 'workspace-tree',
      orderBy: 'manual',
      filterMode: 'archivedOnly',
      manualOrders: { all: ['sess-1', 'sess-2'] },
    })

    const prefs1 = await loadHostSessionsDrawerPreferences('device-1')
    expect(prefs1.groupBy).toBe('workspace-tree')
    expect(prefs1.orderBy).toBe('manual')
    expect(prefs1.filterMode).toBe('archivedOnly')
    expect(prefs1.manualOrders).toEqual({ all: ['sess-1', 'sess-2'] })

    // Device 2 without explicit override falls back to global preferences for groupBy, orderBy, filterMode
    const prefs2 = await loadHostSessionsDrawerPreferences('device-2')
    expect(prefs2.groupBy).toBe('workspace-tree')
    expect(prefs2.orderBy).toBe('manual')
    expect(prefs2.filterMode).toBe('archivedOnly')
    expect(prefs2.manualOrders).toBeUndefined() // manualOrders are device-specific

    // Device 2 can independently override its own preferences
    await saveHostSessionsDrawerPreferences('device-2', {
      groupBy: 'list',
      orderBy: 'updated',
    })

    const prefs2Updated = await loadHostSessionsDrawerPreferences('device-2')
    expect(prefs2Updated.groupBy).toBe('list')
    expect(prefs2Updated.orderBy).toBe('updated')

    // Device 1 remains unaffected
    const prefs1Again = await loadHostSessionsDrawerPreferences('device-1')
    expect(prefs1Again.groupBy).toBe('workspace-tree')
    expect(prefs1Again.orderBy).toBe('manual')
  })

  it('preserves drawer group expansion state alongside view preferences', async () => {
    // 1. Expand a workspace group
    await saveHostSessionsDrawerGroup('device-1', 'ws-abc', true)

    // 2. Save view preferences
    await saveHostSessionsDrawerPreferences('device-1', {
      groupBy: 'list',
    })

    // 3. Verify group expansion is intact
    const groups = await loadHostSessionsDrawerGroups('device-1')
    expect(groups['ws-abc']).toBe(true)

    // 4. Update another group
    await saveHostSessionsDrawerGroup('device-1', 'ws-def', false)

    // 5. Verify preferences are still intact
    const prefs = await loadHostSessionsDrawerPreferences('device-1')
    expect(prefs.groupBy).toBe('list')
    const groupsAfter = await loadHostSessionsDrawerGroups('device-1')
    expect(groupsAfter['ws-abc']).toBe(true)
    expect(groupsAfter['ws-def']).toBe(false)
  })

  it('handles legacy storage without preferences gracefully', async () => {
    // Simulate legacy storage schema where only byDevice was stored
    storeData['dshremote.host-sessions-drawer.v1'] = JSON.stringify({
      byDevice: {
        'legacy-dev': { 'ws-1': true, 'ws-2': false },
      },
    })

    const groups = await loadHostSessionsDrawerGroups('legacy-dev')
    expect(groups).toEqual({ 'ws-1': true, 'ws-2': false })

    const prefs = await loadHostSessionsDrawerPreferences('legacy-dev')
    expect(prefs).toEqual({})
  })

  it('filters corrupt or unexpected data types safely', async () => {
    // Malformed preferences stored from external bug or old version
    storeData['dshremote.host-sessions-drawer.v1'] = JSON.stringify({
      preferencesByDevice: {
        'corrupt-dev': {
          groupBy: 'unknown-grouping',
          orderBy: 12345,
          filterMode: ['not', 'a', 'string'],
          manualOrders: 'not-an-object',
        },
      },
      globalPreferences: {
        groupBy: false,
        orderBy: 'not-a-valid-order',
      },
    })

    const prefs = await loadHostSessionsDrawerPreferences('corrupt-dev')
    expect(prefs.groupBy).toBeUndefined()
    expect(prefs.orderBy).toBeUndefined()
    expect(prefs.filterMode).toBeUndefined()
    expect(prefs.manualOrders).toBeUndefined()
  })
})
