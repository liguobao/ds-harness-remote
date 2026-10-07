import { describe, expect, it } from 'vitest'
import {
  harnessSessionGeneration,
  normalizeHarnessVersion,
  selectHarnessVersion,
} from '../src/harness-version.js'

describe('Harness version discovery', () => {
  it('prefers a valid host.describe version', () => {
    expect(selectHarnessVersion('0.1.0-rc.8', '0.1.0-rc.6')).toBe('0.1.0-rc.8')
  })

  it('replaces the legacy host.describe placeholder with the distribution version', () => {
    expect(selectHarnessVersion('0.0.1', '0.1.0-rc.6')).toBe('0.1.0-rc.6')
  })

  it('rejects malformed reported versions', () => {
    expect(normalizeHarnessVersion('  ')).toBeUndefined()
    expect(normalizeHarnessVersion('0.1.0\ninvalid')).toBeUndefined()
  })

  it('separates the v0.1.5 Session V3 wire from the v0.1.2 profile', () => {
    expect(harnessSessionGeneration('0.1.2-rc.1')).toBe('legacy')
    expect(harnessSessionGeneration('dsh-v0.1.5-alpha.1')).toBe('v3')
    expect(harnessSessionGeneration('0.1.5-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.1.7-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.2.0-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.2.0-rc.2')).toBe('v3')
    expect(harnessSessionGeneration('dsh-v0.2.0-rc.1')).toBe('v3')
    expect(harnessSessionGeneration('0.3.0')).toBe('legacy')
    expect(harnessSessionGeneration('1.0.0')).toBe('legacy')
    expect(harnessSessionGeneration(undefined)).toBe('legacy')
  })
})
