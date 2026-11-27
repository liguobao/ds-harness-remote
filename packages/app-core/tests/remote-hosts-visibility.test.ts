import { describe, expect, it, vi } from 'vitest'
import {
  applyLanguagePreference,
  messageCatalogs,
  remoteHostVisibilityCatalogs,
  remoteHostVisibilityStrings,
  type AppLanguage,
} from '../src/locales/i18n'
import { RemoteServerApi } from '../src/services/api'
import { hostListScope, isHostHidden } from '../src/services/browse-memory'

describe('remote host visibility and account device API contracts', () => {
  it('hides only offline non-selected hosts and automatically reveals hosts that come back online', () => {
    const hidden = ['maso-rc1', 'linux-rc1', 'maso-rc5']

    expect(isHostHidden({ deviceId: 'maso-rc1', online: false }, hidden)).toBe(true)
    expect(isHostHidden({ deviceId: 'other-offline', online: false }, hidden)).toBe(false)
    // Online hosts are never hidden, even if an older offline hide entry exists.
    expect(isHostHidden({ deviceId: 'maso-rc5', online: true }, hidden)).toBe(false)
    // Currently selected host is never hidden while viewing or reconnecting to it.
    expect(isHostHidden({ deviceId: 'maso-rc1', online: false }, hidden, 'maso-rc1')).toBe(false)
  })

  it('scopes hidden host lists strictly by server origin and account', () => {
    const officialA = hostListScope({ baseUrl: 'https://dsh.r2049.cn', account: 'a@example.com' })
    const officialB = hostListScope({ baseUrl: 'https://dsh.r2049.cn', account: 'b@example.com' })
    const selfHostedA = hostListScope({ baseUrl: 'https://remote.example.com', account: 'a@example.com' })

    expect(officialA).not.toBe('')
    expect(officialA).not.toBe(officialB)
    expect(officialA).not.toBe(selfHostedA)
    expect(hostListScope({ baseUrl: 'https://dsh.r2049.cn' })).toBe('')
  })

  it('provides complete 9-language translations and live language switching for offline host visibility', () => {
    const languages = Object.keys(messageCatalogs) as AppLanguage[]
    expect(Object.keys(remoteHostVisibilityCatalogs).sort()).toEqual([...languages].sort())

    for (const lang of languages) {
      applyLanguagePreference(lang)
      expect(remoteHostVisibilityStrings).toBe(remoteHostVisibilityCatalogs[lang])
      expect(remoteHostVisibilityStrings.hideOffline.trim().length).toBeGreaterThan(0)
      expect(remoteHostVisibilityStrings.unhideOffline.trim().length).toBeGreaterThan(0)
      expect(remoteHostVisibilityStrings.hiddenSection(2)).toContain('2')
      expect(remoteHostVisibilityStrings.hiddenHint.trim().length).toBeGreaterThan(0)
      expect(remoteHostVisibilityStrings.allHiddenTitle.trim().length).toBeGreaterThan(0)
      expect(remoteHostVisibilityStrings.allHiddenManageBody.trim().length).toBeGreaterThan(0)
      expect(remoteHostVisibilityStrings.allHiddenSectionBody.trim().length).toBeGreaterThan(0)
    }
    applyLanguagePreference('system')
  })

  it('sends URL-encoded DELETE and PATCH requests with client Bearer credentials for host management', () => {
    return (async () => {
      const calls: Array<{ url: string; init: RequestInit | undefined }> = []
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify({ name: '书房主机' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(JSON.stringify({ status: 'revoked' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
      const originalFetch = globalThis.fetch
      globalThis.fetch = fetchMock as typeof fetch
      try {
        const api = new RemoteServerApi('https://dsh.r2049.cn', 'client-bearer-token')
        const renamed = await api.renameAccountDevice('host /中文', '  书房主机  ')
        expect(renamed).toEqual({ name: '书房主机' })
        await api.removeAccountDevice('host /中文')

        expect(calls).toHaveLength(2)
        expect(calls[0]!.url).toBe('https://dsh.r2049.cn/api/v1/account/devices/host%20%2F%E4%B8%AD%E6%96%87')
        expect(calls[0]!.init?.method).toBe('PATCH')
        expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer client-bearer-token')
        expect(calls[1]!.url).toBe('https://dsh.r2049.cn/api/v1/account/devices/host%20%2F%E4%B8%AD%E6%96%87')
        expect(calls[1]!.init?.method).toBe('DELETE')
        expect(new Headers(calls[1]!.init?.headers).get('authorization')).toBe('Bearer client-bearer-token')
      } finally {
        globalThis.fetch = originalFetch
      }
    })()
  })
})
