import { describe, expect, it } from 'vitest'
import { normalizeServerUrl, parsePairLink, websocketUrl } from '../src/lib/server-url'

describe('server URL handling', () => {
  it('normalizes secure server and websocket URLs', () => {
    expect(normalizeServerUrl('remote.example.com/')).toBe('https://remote.example.com')
    expect(websocketUrl('https://remote.example.com')).toBe('wss://remote.example.com/ws/v1/connect')
  })

  it('allows cleartext only for local development', () => {
    expect(normalizeServerUrl('http://10.0.2.2:8080')).toBe('http://10.0.2.2:8080')
    expect(() => normalizeServerUrl('http://remote.example.com')).toThrow(/HTTPS/)
    expect(() => normalizeServerUrl('http://8.8.8.8')).toThrow(/HTTPS/)
  })

  it('allows cleartext for private LAN and VPN addresses', () => {
    expect(normalizeServerUrl('http://192.168.31.9:8090')).toBe('http://192.168.31.9:8090')
    expect(normalizeServerUrl('http://10.1.2.3:8080')).toBe('http://10.1.2.3:8080')
    expect(normalizeServerUrl('http://172.20.0.2:8090')).toBe('http://172.20.0.2:8090')
    expect(normalizeServerUrl('http://100.64.0.3:8090')).toBe('http://100.64.0.3:8090')
    expect(normalizeServerUrl('http://169.254.1.1:8090')).toBe('http://169.254.1.1:8090')
    expect(normalizeServerUrl('http://[::1]:8080')).toBe('http://[::1]:8080')
    expect(normalizeServerUrl('http://[fd00:1234::1]:8080')).toBe('http://[fd00:1234::1]:8080')
    expect(normalizeServerUrl('http://[fe80::1]:8080')).toBe('http://[fe80::1]:8080')
    expect(() => normalizeServerUrl('http://[2001:4860:4860::8888]:8080')).toThrow(/HTTPS/)
  })

  it('parses server deep links without pairing codes', () => {
    expect(parsePairLink('dshremote://pair?v=1&server=https%3A%2F%2Fremote.example.com')).toEqual({
      server: 'https://remote.example.com',
    })
    expect(parsePairLink('dshremote://pair?v=2&server=https%3A%2F%2Fremote.example.com')).toEqual({})
    expect(parsePairLink('https://example.com/not-a-pair-link')).toEqual({})
  })
})
