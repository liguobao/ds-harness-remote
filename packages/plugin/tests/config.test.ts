import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, resolveConfig } from '../src/config.js'

describe('plugin config', () => {
  it('applies safe defaults', () => {
    expect(resolveConfig({}, {})).toMatchObject({
      enabled: true,
      role: 'host',
      hostControl: { enabled: true },
      terminal: { enabled: true },
      remoteTools: { enabled: true },
      forceRelay: false,
      reconnect: { enabled: true, initialDelayMs: 1_000, maxDelayMs: 30_000, jitter: 0.2 },
      codex: { enabled: true, binary: 'codex' },
      cursor: { enabled: false, binary: 'agent' },
    })
    expect(resolveConfig({}, { DSH_REMOTE_TERMINAL_ENABLED: 'false' }).terminal.enabled).toBe(false)
  })

  it('keeps Remote Tools enabled by default while allowing an explicit opt-out', () => {
    expect(resolveConfig({}, {}).remoteTools?.enabled).toBe(true)
    expect(resolveConfig({ remoteTools: { enabled: false } }, {}).remoteTools?.enabled).toBe(false)
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

  it('preserves independent ACP launch options and scopes legacy Cursor configuration to Cursor', () => {
    const legacy = resolveConfig({ cursor: { enabled: true, binary: '/custom/cursor' } }, {})
    expect(legacy.acp?.backends.find(item => item.id === 'cursor')).toMatchObject({ enabled: true, command: '/custom/cursor' })
    expect(legacy.acp?.backends.find(item => item.id === 'antigravity')?.enabled).toBe(false)
    const config = resolveConfig({ acp: { enabled: false, backends: [
      { id: 'cursor', enabled: false },
      { id: 'antigravity', enabled: true, command: '/custom/agy', args: ['--custom'], cwd: '/host' },
    ] } }, {})
    expect(config.acp?.enabled).toBe(false)
    expect(config.acp?.backends.find(item => item.id === 'antigravity')).toEqual({
      id: 'antigravity', enabled: true, command: '/custom/agy', args: ['--custom'], cwd: '/host',
    })
  })

  it('uses one CodeX backend setting and drops unimplemented Kimi', () => {
    const config = resolveConfig({ codex: { enabled: true, binary: '/old/codex' }, acp: {
      enabled: true, backends: [{ id: 'codex', enabled: false, command: '/new/codex' }, { id: 'kimi', enabled: true }],
    } }, {})
    expect(config.codex).toEqual({ enabled: false, binary: '/new/codex' })
    expect(config.acp?.backends.some(item => item.id === 'kimi')).toBe(false)
    expect(resolveConfig({ acp: { enabled: false, backends: [{ id: 'codex', enabled: true }] } }, {}).codex.enabled).toBe(false)
  })

  it('registers the Hermes backend as an explicitly enabled standard ACP backend', () => {
    const off = resolveConfig({}, {})
    expect(off.acp?.backends.find(item => item.id === 'hermes')).toMatchObject({ enabled: false, command: 'hermes', args: ['acp'] })
    const on = resolveConfig({ acp: { enabled: true, backends: [{ id: 'hermes', enabled: true }] } }, {})
    expect(on.acp?.backends.find(item => item.id === 'hermes')).toMatchObject({ enabled: true, command: 'hermes', args: ['acp'] })
    const custom = resolveConfig({ acp: { enabled: true, backends: [{ id: 'hermes', enabled: true, command: '/opt/hermes/bin/hermes-acp', args: [], cwd: '/srv/repo' }] } }, {})
    expect(custom.acp?.backends.find(item => item.id === 'hermes')).toEqual({
      id: 'hermes', enabled: true, command: '/opt/hermes/bin/hermes-acp', args: [], cwd: '/srv/repo',
    })
  })

  it('allows HTTP on private networks while rejecting insecure public servers and embedded credentials', () => {
    expect(() => resolveConfig({ serverUrl: 'http://remote.example.com' })).toThrow(/HTTPS/)
    expect(() => resolveConfig({ serverUrl: 'http://100.128.0.1:8080' })).toThrow(/HTTPS/)
    expect(() => resolveConfig({ serverUrl: 'https://user:password@remote.example.com' })).toThrow(/credentials/)
    expect(() => resolveConfig({ serverUrl: 'https://remote.example.com?token=secret' })).toThrow(/query parameters/)
    expect(() => resolveConfig({ serverUrl: 'https://remote.example.com/api' })).toThrow(/without a path/)
    expect(resolveConfig({ serverUrl: 'http://localhost:8080' }).serverUrl).toBe('http://localhost:8080')
    expect(resolveConfig({ serverUrl: 'http://192.168.1.20:8080' }).serverUrl).toBe('http://192.168.1.20:8080')
    expect(resolveConfig({ serverUrl: 'http://100.79.68.68:8080' }).serverUrl).toBe('http://100.79.68.68:8080')
    expect(normalizeServerUrl('https://REMOTE.example.com/')).toBe('https://remote.example.com')
  })

  it('rejects an inverted reconnect range', () => {
    expect(() => resolveConfig({ reconnect: { initialDelayMs: 5_000, maxDelayMs: 1_000 } })).toThrow(/maxDelayMs/)
  })
})
