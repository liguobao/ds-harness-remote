import { describe, expect, it } from 'vitest'
import {
  applyLanguagePreference,
  messageCatalogs,
  remoteHostVisibilityCatalogs,
  remoteHostVisibilityStrings,
  type AppLanguage,
} from '../src/locales/i18n'
import { hostListScope, isHostHidden } from '../src/services/browse-memory'

describe('remote host local visibility', () => {
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
      expect(remoteHostVisibilityStrings.hiddenHint).not.toMatch(/Unbind|解除绑定|解除繫結|バインド解除|Desvincular|Délier|Отвязать|Відвʼязати/)
    }
    applyLanguagePreference('system')
  })
})
