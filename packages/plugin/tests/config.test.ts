import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, resolveConfig } from '../src/config.js'

describe('plugin config', () => {
  it('applies safe defaults', () => {
    expect(resolveConfig({}, {})).toMatchObject({
      enabled: true,
      role: 'host',
      forceRelay: false,
      reconnect: { enabled: true, initialDelayMs: 1_000, maxDelayMs: 30_000, jitter: 0.2 },
      codex: { enabled: true, binary: 'codex' },
      cursor: { enabled: false, binary: 'agent' },
    })
  })

  it('allows the default-on Codex domain to be disabled and rejects obsolete workspace filters', () => {
    expect(resolveConfig({ codex: { enabled: false } }, {})).toMatchObject({
      codex: { enabled: false, binary: 'codex' },
    })
    expect(resolveConfig({ codex: {
      enabled: true,
      binary: '/opt/codex/bin/codex',
    } }, {})).toMatchObject({
      codex: { enabled: true, binary: '/opt/codex/bin/codex' },
    })
    expect(() => resolveConfig({ codex: { enabled: true, allowedRoots: ['/workspace'] } } as never)).toThrow()
  })

  it('keeps Cursor ACP opt-in and accepts an explicit binary', () => {
    expect(resolveConfig({ cursor: { enabled: true } }, {})).toMatchObject({
      cursor: { enabled: true, binary: 'agent' },
    })
    expect(resolveConfig({ cursor: { enabled: true, binary: '/Users/me/.local/bin/agent' } }, {})).toMatchObject({
      cursor: { enabled: true, binary: '/Users/me/.local/bin/agent' },
    })
  })

  it('rejects insecure non-local servers and embedded credentials', () => {
    expect(() => resolveConfig({ serverUrl: 'http://remote.example.com' })).toThrow(/HTTPS/)
    expect(() => resolveConfig({ serverUrl: 'https://user:password@remote.example.com' })).toThrow(/credentials/)
    expect(() => resolveConfig({ serverUrl: 'https://remote.example.com?token=secret' })).toThrow(/query parameters/)
    expect(() => resolveConfig({ serverUrl: 'https://remote.example.com/api' })).toThrow(/without a path/)
    expect(resolveConfig({ serverUrl: 'http://localhost:8080' }).serverUrl).toBe('http://localhost:8080')
    expect(normalizeServerUrl('https://REMOTE.example.com/')).toBe('https://remote.example.com')
  })

  it('rejects an inverted reconnect range', () => {
    expect(() => resolveConfig({ reconnect: { initialDelayMs: 5_000, maxDelayMs: 1_000 } })).toThrow(/maxDelayMs/)
  })
})
