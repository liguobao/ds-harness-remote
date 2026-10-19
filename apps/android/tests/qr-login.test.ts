import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { RemoteServerApi, type OAuthProviderInfo } from '../src/services/api'

const baseUrl = 'https://remote.example.com'
const zhihu: OAuthProviderInfo = {
  id: 'zhihu',
  displayName: '知乎',
  startUrl: '/api/v1/auth/oauth/start',
  qrStartUrl: '/api/v1/auth/oauth/qr/start?provider=zhihu',
}

describe('QR sign-in Server API', () => {
  it('discovers Server-owned providers and falls back to legacy status endpoints', async () => {
    const discovery = vi.fn<typeof fetch>(async () => jsonResponse({
      items: [
        zhihu,
        { id: 'google', displayName: 'Google', startUrl: '/api/v1/auth/oauth/google/start', qrStartUrl: '/api/v1/auth/oauth/qr/start?provider=google' },
        { id: 'github', displayName: 'GitHub', startUrl: '/api/v1/auth/oauth/github/start' },
      ],
    }))
    expect(await new RemoteServerApi(baseUrl, undefined, discovery).oauthProviders()).toEqual([
      zhihu,
      { id: 'google', displayName: 'Google', startUrl: '/api/v1/auth/oauth/google/start', qrStartUrl: '/api/v1/auth/oauth/qr/start?provider=google' },
      { id: 'github', displayName: 'GitHub', startUrl: '/api/v1/auth/oauth/github/start' },
    ])
    expect(discovery).toHaveBeenCalledTimes(1)

    const fallback = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/api/v1/auth/oauth/providers')) return jsonResponse({}, 404)
      if (url.endsWith('/api/v1/auth/oauth/status')) return jsonResponse({ configured: true })
      if (url.endsWith('/api/v1/auth/oauth/github/status')) return jsonResponse({ configured: false })
      return jsonResponse({}, 404)
    })
    expect(await new RemoteServerApi(baseUrl, undefined, fallback).oauthProviders()).toEqual([{
      id: 'zhihu',
      displayName: '知乎',
      startUrl: '/api/v1/auth/oauth/start',
      qrStartUrl: '/api/v1/auth/oauth/qr/start?provider=zhihu',
    }])
  })

  it('rejects unsafe or malformed provider descriptors', async () => {
    await runScenarios([
      { name: 'cross-origin provider start URL', item: { ...zhihu, startUrl: 'https://evil.example/api/v1/auth/oauth/start' } },
      { name: 'protocol-relative QR URL', item: { ...zhihu, qrStartUrl: '//evil.example/api/v1/auth/oauth/qr/start' } },
      { name: 'path traversal', item: { ...zhihu, qrStartUrl: '/api/v1/auth/../oauth/qr/start' } },
      { name: 'missing display name', item: { ...zhihu, displayName: ' ' } },
      { name: 'invalid provider id', item: { ...zhihu, id: 'bad id' } },
      { name: 'duplicate provider id', items: [zhihu, zhihu] },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => {
        const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({
          items: 'items' in scenario ? scenario.items : [scenario.item],
        }))
        await expect(new RemoteServerApi(baseUrl, undefined, fetchImplementation).oauthProviders())
          .rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      },
    })))
  })

  it('creates a QR session and rejects unsafe session responses', async () => {
    await runScenarios([
      { name: 'valid session', body: { qrId: 'q'.repeat(24), scanUrl: 'https://remote.example.com/api/v1/auth/q/qr', expiresIn: 600, provider: 'zhihu' }, accepted: true },
      { name: 'cross-origin scan URL', body: { qrId: 'q'.repeat(24), scanUrl: 'https://evil.example/api/v1/auth/q/qr', expiresIn: 600 }, accepted: false },
      { name: 'short QR id', body: { qrId: 'short', scanUrl: 'https://remote.example.com/api/v1/auth/q/qr', expiresIn: 600 }, accepted: false },
      { name: 'invalid expiry', body: { qrId: 'q'.repeat(24), scanUrl: 'https://remote.example.com/api/v1/auth/q/qr', expiresIn: 0 }, accepted: false },
      { name: 'provider mismatch', body: { qrId: 'q'.repeat(24), scanUrl: 'https://remote.example.com/api/v1/auth/q/qr', expiresIn: 600, provider: 'github' }, accepted: false },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => {
        const calls: Array<{ url: string; init?: RequestInit }> = []
        const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
          calls.push({ url: String(input), init })
          return jsonResponse(scenario.body)
        })
        const api = new RemoteServerApi(baseUrl, undefined, fetchImplementation)
        if (scenario.accepted) {
          expect(await api.startOAuthQrLogin(zhihu)).toEqual({
            qrId: 'q'.repeat(24),
            scanUrl: 'https://remote.example.com/api/v1/auth/q/qr',
            expiresIn: 600,
          })
          expect(calls[0]?.url).toBe(`${baseUrl}${zhihu.qrStartUrl}`)
          expect(calls[0]?.init?.method).toBe('POST')
        } else {
          await expect(api.startOAuthQrLogin(zhihu)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
        }
      },
    })))
  })

  it('polls pending, expired and complete QR states', async () => {
    await runScenarios([
      { name: 'pending', body: { status: 'pending' }, expected: { status: 'pending' } },
      { name: 'expired', body: { status: 'expired' }, expected: { status: 'expired' } },
      { name: 'complete', body: { status: 'complete', token: 't'.repeat(24) }, expected: { status: 'complete', token: 't'.repeat(24) } },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => {
        const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse(scenario.body))
        const api = new RemoteServerApi(baseUrl, undefined, fetchImplementation)
        expect(await api.pollOAuthQrLogin('q'.repeat(24))).toEqual(scenario.expected)
        expect(fetchImplementation.mock.calls[0]?.[0]).toBe(`${baseUrl}/api/v1/auth/oauth/qr/${'q'.repeat(24)}`)
      },
    })))

    for (const body of [{ status: 'complete' }, { status: 'unknown' }, { status: 'complete', token: 'short' }]) {
      const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse(body))
      await expect(new RemoteServerApi(baseUrl, undefined, fetchImplementation).pollOAuthQrLogin('q'.repeat(24)))
        .rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    }
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
