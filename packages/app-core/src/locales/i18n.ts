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

export interface RemoteHostVisibilityStrings {
  readonly hideOffline: string
  readonly unhideOffline: string
  readonly hiddenSection: (count: number) => string
  readonly hiddenHint: string
  readonly allHiddenTitle: string
  readonly allHiddenManageBody: string
  readonly allHiddenSectionBody: string
}

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

export const remoteHostVisibilityCatalogs: Record<AppLanguage, RemoteHostVisibilityStrings> = {
  'en-US': {
    hideOffline: 'Hide on this phone',
    unhideOffline: 'Show again',
    hiddenSection: (count: number) => `Hidden offline hosts (${count})`,
    hiddenHint: 'Hiding only affects this phone and automatically clears while a host is online. To remove a device from your account, use the Web management console.',
    allHiddenTitle: 'Offline hosts are hidden',
    allHiddenManageBody: 'Open Manage remote hosts below to show them again.',
    allHiddenSectionBody: 'Show hidden hosts again in the section below.',
  },
  'zh-CN': {
    hideOffline: '从这台手机隐藏',
    unhideOffline: '恢复显示',
    hiddenSection: (count: number) => `已隐藏的离线主机（${count}）`,
    hiddenHint: '隐藏仅影响这台手机的列表展示；若主机重新上线会自动恢复显示。如需从账号移除设备，请在 Web 管理台处理。',
    allHiddenTitle: '离线主机已隐藏',
    allHiddenManageBody: '可在下方“管理远程主机”中恢复显示。',
    allHiddenSectionBody: '可在下方“已隐藏的离线主机”中恢复显示。',
  },
  'zh-TW': {
    hideOffline: '從這臺手機隱藏',
    unhideOffline: '恢復顯示',
    hiddenSection: (count: number) => `已隱藏的離線主機（${count}）`,
    hiddenHint: '隱藏僅影響這臺手機的列表顯示；若主機重新上線會自動恢復顯示。如需從帳號移除裝置，請在 Web 管理台處理。',
    allHiddenTitle: '離線主機已隱藏',
    allHiddenManageBody: '可在下方「管理遠端主機」中恢復顯示。',
    allHiddenSectionBody: '可在下方「已隱藏的離線主機」中恢復顯示。',
  },
  'ja-JP': {
    hideOffline: 'この端末で非表示',
    unhideOffline: '再表示',
    hiddenSection: (count: number) => `非表示のオフラインホスト (${count})`,
    hiddenHint: '非表示はこの端末の表示にのみ反映され、ホストがオンラインに戻ると自動で表示されます。アカウントからデバイスを削除するには Web 管理コンソールをご利用ください。',
    allHiddenTitle: 'オフラインホストは非表示です',
    allHiddenManageBody: '下の「リモートホストの管理」から再表示できます。',
    allHiddenSectionBody: '下の「非表示のオフラインホスト」から再表示できます。',
  },
  'es-ES': {
    hideOffline: 'Ocultar en este teléfono',
    unhideOffline: 'Volver a mostrar',
    hiddenSection: (count: number) => `Hosts sin conexión ocultos (${count})`,
    hiddenHint: 'Ocultar solo afecta a este teléfono y el host vuelve a mostrarse si se conecta. Para quitar un dispositivo de tu cuenta, hazlo desde la consola web.',
    allHiddenTitle: 'Los hosts sin conexión están ocultos',
    allHiddenManageBody: 'Abre «Gestionar hosts remotos» abajo para mostrarlos de nuevo.',
    allHiddenSectionBody: 'Vuelve a mostrar los hosts ocultos en la sección inferior.',
  },
  'de-DE': {
    hideOffline: 'Auf diesem Telefon ausblenden',
    unhideOffline: 'Wieder einblenden',
    hiddenSection: (count: number) => `Ausgeblendete Offline-Hosts (${count})`,
    hiddenHint: 'Das Ausblenden gilt nur für dieses Telefon; sobald ein Host online ist, erscheint er wieder. Um ein Gerät aus dem Konto zu entfernen, nutze die Web-Verwaltung.',
    allHiddenTitle: 'Offline-Hosts sind ausgeblendet',
    allHiddenManageBody: 'Öffne unten „Remote-Hosts verwalten“, um sie wieder einzublenden.',
    allHiddenSectionBody: 'Blende ausgeblendete Hosts im Abschnitt unten wieder ein.',
  },
  'fr-FR': {
    hideOffline: 'Masquer sur ce téléphone',
    unhideOffline: 'Réafficher',
    hiddenSection: (count: number) => `Hôtes hors ligne masqués (${count})`,
    hiddenHint: 'Le masquage ne concerne que ce téléphone ; un hôte réapparaît automatiquement lorsqu’il est en ligne. Pour retirer un appareil du compte, utilisez l’interface Web de gestion.',
    allHiddenTitle: 'Les hôtes hors ligne sont masqués',
    allHiddenManageBody: 'Ouvrez « Gérer les hôtes distants » ci-dessous pour les réafficher.',
    allHiddenSectionBody: 'Réaffichez les hôtes masqués dans la section ci-dessous.',
  },
  'ru-RU': {
    hideOffline: 'Скрыть на этом телефоне',
    unhideOffline: 'Показать снова',
    hiddenSection: (count: number) => `Скрытые хосты не в сети (${count})`,
    hiddenHint: 'Скрытие действует только на этом телефоне; когда хост снова в сети, он отображается автоматически. Чтобы удалить устройство из аккаунта, воспользуйтесь веб-консолью управления.',
    allHiddenTitle: 'Хосты не в сети скрыты',
    allHiddenManageBody: 'Откройте «Управление удалёнными хостами» ниже, чтобы показать их снова.',
    allHiddenSectionBody: 'Показать скрытые хосты можно в разделе ниже.',
  },
  'uk-UA': {
    hideOffline: 'Приховати на цьому телефоні',
    unhideOffline: 'Показати знову',
    hiddenSection: (count: number) => `Приховані Хости не в мережі (${count})`,
    hiddenHint: 'Приховування діє лише на цьому телефоні; коли Хост знову в мережі, він автоматично зʼявляється. Щоб видалити пристрій з облікового запису, скористайтеся веб-консоллю керування.',
    allHiddenTitle: 'Хости не в мережі приховано',
    allHiddenManageBody: 'Відкрийте «Керувати віддаленими Хостами» нижче, щоб показати їх знову.',
    allHiddenSectionBody: 'Показати приховані Хости можна в розділі нижче.',
  },
}

let systemLocaleTags = [defaultSystemLocale()]
let preference: LanguagePreference = 'system'
let activeLanguage = resolveLanguage(preference, systemLocaleTags)

/** Live binding used by UI and service code so a language change applies immediately. */
export let strings: Messages = messageCatalogs[activeLanguage]
export let remoteHostVisibilityStrings: RemoteHostVisibilityStrings = remoteHostVisibilityCatalogs[activeLanguage]

export function applyLanguagePreference(
  nextPreference: LanguagePreference,
  localeTags: readonly string[] = systemLocaleTags,
): AppLanguage {
  preference = nextPreference
  systemLocaleTags = [...localeTags]
  activeLanguage = resolveLanguage(preference, systemLocaleTags)
  strings = messageCatalogs[activeLanguage]
  remoteHostVisibilityStrings = remoteHostVisibilityCatalogs[activeLanguage]
  return activeLanguage
}

export function updateSystemLocales(localeTags: readonly string[]): AppLanguage {
  systemLocaleTags = [...localeTags]
  if (preference === 'system') {
    activeLanguage = resolveLanguage(preference, systemLocaleTags)
    strings = messageCatalogs[activeLanguage]
    remoteHostVisibilityStrings = remoteHostVisibilityCatalogs[activeLanguage]
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
