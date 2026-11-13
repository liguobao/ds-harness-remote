import enUS from './en-US'
import type { Messages } from './types'
import zhCN from './zh-CN'
import zhTW from './zh-TW'
import jaJP from './ja-JP'
import esES from './es-ES'
import deDE from './de-DE'
import frFR from './fr-FR'
import ruRU from './ru-RU'
import ukUA from './uk-UA'

export type AppLanguage = 'en-US' | 'zh-CN' | 'zh-TW' | 'ja-JP' | 'es-ES' | 'de-DE' | 'fr-FR' | 'ru-RU' | 'uk-UA'
export type LanguagePreference = 'system' | AppLanguage

export const messageCatalogs: Record<AppLanguage, Messages> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'es-ES': esES,
  'de-DE': deDE,
  'fr-FR': frFR,
  'ru-RU': ruRU,
  'uk-UA': ukUA,
}

let systemLocaleTags = [defaultSystemLocale()]
let preference: LanguagePreference = 'system'
let activeLanguage = resolveLanguage(preference, systemLocaleTags)

/** Live binding used by UI and service code so a language change applies immediately. */
export let strings: Messages = messageCatalogs[activeLanguage]

export function applyLanguagePreference(
  nextPreference: LanguagePreference,
  localeTags: readonly string[] = systemLocaleTags,
): AppLanguage {
  preference = nextPreference
  systemLocaleTags = [...localeTags]
  activeLanguage = resolveLanguage(preference, systemLocaleTags)
  strings = messageCatalogs[activeLanguage]
  return activeLanguage
}

export function updateSystemLocales(localeTags: readonly string[]): AppLanguage {
  systemLocaleTags = [...localeTags]
  if (preference === 'system') {
    activeLanguage = resolveLanguage(preference, systemLocaleTags)
    strings = messageCatalogs[activeLanguage]
  }
  return activeLanguage
}

export function getActiveLanguage(): AppLanguage {
  return activeLanguage
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || (typeof value === 'string' && Object.hasOwn(messageCatalogs, value))
}

function resolveLanguage(nextPreference: LanguagePreference, localeTags: readonly string[]): AppLanguage {
  if (nextPreference !== 'system') return nextPreference
  for (const tag of localeTags) {
    const parts = tag.toLowerCase().replaceAll('_', '-').split('-')
    const language = parts[0]
    if (language === 'zh') {
      // An explicit script takes precedence over the region (e.g. zh-Hans-HK).
      if (parts.includes('hant')) return 'zh-TW'
      if (parts.includes('hans')) return 'zh-CN'
      return parts.some(part => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN'
    }
    if (language === 'en') return 'en-US'
    if (language === 'ja') return 'ja-JP'
    if (language === 'es') return 'es-ES'
    if (language === 'de') return 'de-DE'
    if (language === 'fr') return 'fr-FR'
    if (language === 'ru') return 'ru-RU'
    if (language === 'uk') return 'uk-UA'
  }
  return 'en-US'
}

function defaultSystemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return 'en-US'
  }
}
