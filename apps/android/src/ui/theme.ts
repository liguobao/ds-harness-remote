export type ColorScheme = 'light' | 'dark'

export type ThemePreference = 'system' | ColorScheme

export type TypographyDensity = 'standard' | 'compact'

export type ActivityDockMode = 'compact' | 'cards' | 'hidden'

export type DrawerLayoutMode = 'compact' | 'classic'

export function isTypographyDensity(value: unknown): value is TypographyDensity {
  return value === 'standard' || value === 'compact'
}

export function isActivityDockMode(value: unknown): value is ActivityDockMode {
  return value === 'compact' || value === 'cards' || value === 'hidden'
}

export function isDrawerLayoutMode(value: unknown): value is DrawerLayoutMode {
  return value === 'compact' || value === 'classic'
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function resolveColorScheme(
  preference: ThemePreference,
  systemScheme: ColorScheme | null | undefined,
): ColorScheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemScheme === 'dark' ? 'dark' : 'light'
}

export interface ThemeColors {
  /** Page canvas behind cards and grouped lists. */
  background: string
  /** Opaque sheets, inputs and the composer. */
  surface: string
  /** White card fill; alpha applies only to the background, never its children. */
  card: string
  /** Card composited over the canvas, for swipe rows that must hide actions underneath. */
  cardOpaque: string
  /** Pills, pressed rows and other fills drawn on a surface. */
  surfaceStrong: string
  /** Inset grouped lists (settings-style sections) drawn on the canvas. */
  grouped: string
  /** Floating header chips and other controls that hover over content. */
  elevated: string
  ink: string
  muted: string
  subtle: string
  primary: string
  primaryPressed: string
  primarySoft: string
  accent: string
  accentSoft: string
  /** High-contrast fill for the main floating call to action (black in light, white in dark). */
  inverse: string
  onInverse: string
  success: string
  successSoft: string
  warning: string
  warningSoft: string
  danger: string
  dangerSoft: string
  border: string
  separator: string
  disabled: string
  white: string
  scrim: string
  modalBackdrop: string
  menuDismiss: string
  shadow: string
  /** Soft neutral user message bubble fill in standard 1:1 chats. */
  userBubble?: string
  /** Subtle nested surface for tool cards and reasoning bodies. */
  toolSurface?: string
  /** Elevated code block body surface and header fill. */
  codeSurface?: string
  codeHeader?: string
  /** Foreground text/icon color drawn on top of `primary`. */
  onPrimary?: string
}

// DeepSeek palette: ink #0F0F0F, DeepSeek blue (#4D6BFE) accents, white cards (#FFFFFF)
// on a soft canvas (#F8F8F8) with #EDEDED hairline dividers and #59606D readable muted text.
export const lightColors: ThemeColors = {
  background: '#F8F8F8',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardOpaque: '#FFFFFF',
  surfaceStrong: '#ECEFF4',
  grouped: '#FFFFFF',
  elevated: '#FFFFFF',
  ink: '#0F0F0F',
  muted: '#59606D',
  subtle: '#B9B9BB',
  primary: '#4D6BFE',
  primaryPressed: '#3A56E6',
  primarySoft: '#EBEFFF',
  accent: '#4D6BFE',
  accentSoft: '#EBEFFF',
  inverse: '#0F0F0F',
  onInverse: '#FFFFFF',
  success: '#1E8449',
  successSoft: '#E2F3E9',
  warning: '#95600A',
  warningSoft: '#FBEFD5',
  danger: '#C2362F',
  dangerSoft: '#FBE7E5',
  border: '#EDEDED',
  separator: '#EDEDED',
  disabled: '#B3B9C4',
  white: '#FFFFFF',
  scrim: 'rgba(15, 15, 15, 0.40)',
  modalBackdrop: 'rgba(15, 15, 15, 0.42)',
  menuDismiss: 'rgba(15, 15, 15, 0.14)',
  shadow: '#1A2638',
  userBubble: '#ECEFF5',
  toolSurface: '#F2F4F8',
  codeSurface: '#F6F8FB',
  codeHeader: '#EDF1F7',
  onPrimary: '#FFFFFF',
}

export const darkColors: ThemeColors = {
  background: '#0B0D11',
  surface: '#161A21',
  card: 'rgba(255, 255, 255, 0.05)',
  cardOpaque: '#17191D',
  surfaceStrong: '#232832',
  grouped: 'rgba(255, 255, 255, 0.05)',
  elevated: '#1D222B',
  ink: '#F2F4F7',
  muted: '#A2A9B6',
  subtle: '#7A8291',
  primary: '#6F89FF',
  primaryPressed: '#5672F5',
  primarySoft: '#19213F',
  accent: '#6F89FF',
  accentSoft: '#19213F',
  inverse: '#F2F4F7',
  onInverse: '#0B0D11',
  success: '#4CC07D',
  successSoft: '#122A1D',
  warning: '#E0A53A',
  warningSoft: '#2C2312',
  danger: '#F2736C',
  dangerSoft: '#2E1618',
  border: '#2B313C',
  separator: '#252B35',
  disabled: '#4E5562',
  white: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.58)',
  modalBackdrop: 'rgba(0, 0, 0, 0.62)',
  menuDismiss: 'rgba(0, 0, 0, 0.45)',
  shadow: '#000000',
  userBubble: '#1E2430',
  toolSurface: '#141820',
  codeSurface: '#131720',
  codeHeader: '#1B212E',
  onPrimary: '#FFFFFF',
}

export function colorsForScheme(scheme: ColorScheme): ThemeColors {
  return scheme === 'dark' ? darkColors : lightColors
}

export type ChatFontScale = 'sm' | 'md' | 'lg' | 'xl'
export type ChatSpacingScale = 'tight' | 'balanced' | 'relaxed'
export type ChatLetterSpacing = 'normal' | 'wide' | 'wider'
export type ChatAccentPreset = 'deepseek' | 'emerald' | 'violet' | 'amber' | 'graphite'
export type ChatBubbleStyle = 'soft' | 'tinted' | 'solid' | 'minimal'
export type ChatCodeTheme = 'auto' | 'dark' | 'light'

export interface ChatAppearance {
  fontScale: ChatFontScale
  spacingScale: ChatSpacingScale
  letterSpacing: ChatLetterSpacing
  accent: ChatAccentPreset
  bubbleStyle: ChatBubbleStyle
  codeTheme: ChatCodeTheme
}

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  fontScale: 'md',
  spacingScale: 'balanced',
  letterSpacing: 'wide',
  accent: 'deepseek',
  bubbleStyle: 'soft',
  codeTheme: 'auto',
}

export function isChatFontScale(value: unknown): value is ChatFontScale {
  return value === 'sm' || value === 'md' || value === 'lg' || value === 'xl'
}

export function isChatSpacingScale(value: unknown): value is ChatSpacingScale {
  return value === 'tight' || value === 'balanced' || value === 'relaxed'
}

export function isChatLetterSpacing(value: unknown): value is ChatLetterSpacing {
  return value === 'normal' || value === 'wide' || value === 'wider'
}

export function isChatAccentPreset(value: unknown): value is ChatAccentPreset {
  return value === 'deepseek' || value === 'emerald' || value === 'violet' || value === 'amber' || value === 'graphite'
}

export function isChatBubbleStyle(value: unknown): value is ChatBubbleStyle {
  return value === 'soft' || value === 'tinted' || value === 'solid' || value === 'minimal'
}

export function isChatCodeTheme(value: unknown): value is ChatCodeTheme {
  return value === 'auto' || value === 'dark' || value === 'light'
}

export function normalizeChatAppearance(raw: unknown): ChatAppearance {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_CHAT_APPEARANCE }
  }
  const obj = raw as Record<string, unknown>
  return {
    fontScale: isChatFontScale(obj.fontScale) ? obj.fontScale : DEFAULT_CHAT_APPEARANCE.fontScale,
    spacingScale: isChatSpacingScale(obj.spacingScale) ? obj.spacingScale : DEFAULT_CHAT_APPEARANCE.spacingScale,
    letterSpacing: isChatLetterSpacing(obj.letterSpacing) ? obj.letterSpacing : DEFAULT_CHAT_APPEARANCE.letterSpacing,
    accent: isChatAccentPreset(obj.accent) ? obj.accent : DEFAULT_CHAT_APPEARANCE.accent,
    bubbleStyle: isChatBubbleStyle(obj.bubbleStyle) ? obj.bubbleStyle : DEFAULT_CHAT_APPEARANCE.bubbleStyle,
    codeTheme: isChatCodeTheme(obj.codeTheme) ? obj.codeTheme : DEFAULT_CHAT_APPEARANCE.codeTheme,
  }
}

export const CHAT_ACCENT_SWATCHES: Record<ChatAccentPreset, {
  light: { primary: string; primaryPressed: string; primarySoft: string; onPrimary: string }
  dark: { primary: string; primaryPressed: string; primarySoft: string; onPrimary: string }
}> = {
  deepseek: {
    light: { primary: '#4D6BFE', primaryPressed: '#3A56E6', primarySoft: '#EBEFFF', onPrimary: '#FFFFFF' },
    dark: { primary: '#6F89FF', primaryPressed: '#5672F5', primarySoft: '#19213F', onPrimary: '#FFFFFF' },
  },
  emerald: {
    light: { primary: '#0D9488', primaryPressed: '#0F766E', primarySoft: '#E6F7F5', onPrimary: '#FFFFFF' },
    dark: { primary: '#2DD4BF', primaryPressed: '#14B8A6', primarySoft: '#112E2B', onPrimary: '#08201E' },
  },
  violet: {
    light: { primary: '#7C5CFC', primaryPressed: '#6442EE', primarySoft: '#F1EDFF', onPrimary: '#FFFFFF' },
    dark: { primary: '#A78BFA', primaryPressed: '#8B5CF6', primarySoft: '#221C3D', onPrimary: '#FFFFFF' },
  },
  amber: {
    light: { primary: '#D97706', primaryPressed: '#B45309', primarySoft: '#FEF3C7', onPrimary: '#FFFFFF' },
    dark: { primary: '#F59E0B', primaryPressed: '#D97706', primarySoft: '#33240E', onPrimary: '#1A1104' },
  },
  graphite: {
    light: { primary: '#27272A', primaryPressed: '#18181B', primarySoft: '#ECEEF2', onPrimary: '#FFFFFF' },
    dark: { primary: '#E4E4E7', primaryPressed: '#D4D4D8', primarySoft: '#272A32', onPrimary: '#0B0D11' },
  },
}

export function resolveThemeColors(scheme: ColorScheme, accent: ChatAccentPreset = 'deepseek'): ThemeColors {
  const base = colorsForScheme(scheme)
  if (accent === 'deepseek') return base
  const swatch = CHAT_ACCENT_SWATCHES[accent][scheme]
  return {
    ...base,
    primary: swatch.primary,
    primaryPressed: swatch.primaryPressed,
    primarySoft: swatch.primarySoft,
    accent: swatch.primary,
    accentSoft: swatch.primarySoft,
    onPrimary: swatch.onPrimary,
  }
}

export interface ChatMetrics {
  bodyFontSize: number
  bodyLineHeight: number
  letterSpacing: number
  codeFontSize: number
  codeLineHeight: number
  inlineCodeFontSize: number
  h1Size: number
  h1LineHeight: number
  h2Size: number
  h2LineHeight: number
  h3Size: number
  h3LineHeight: number
  h4Size: number
  h4LineHeight: number
  paragraphGap: number
  headingTopGap: number
  headingBottomGap: number
  listGap: number
  turnTopGap: number
  turnBottomGap: number
  assistantGap: number
}

export function resolveChatMetrics(
  density: TypographyDensity,
  appearance: ChatAppearance = DEFAULT_CHAT_APPEARANCE,
): ChatMetrics {
  const baseFont = density === 'compact' ? 14.5 : 15.5
  const fontDelta = appearance.fontScale === 'sm' ? -1
    : appearance.fontScale === 'lg' ? 1.5
      : appearance.fontScale === 'xl' ? 3
        : 0
  const bodyFontSize = baseFont + fontDelta
  const lineRatio = appearance.spacingScale === 'tight' ? 1.48
    : appearance.spacingScale === 'relaxed' ? 1.74
      : 1.60
  const bodyLineHeight = Math.round(bodyFontSize * lineRatio)
  const letterSpacing = appearance.letterSpacing === 'normal' ? 0
    : appearance.letterSpacing === 'wider' ? 0.5
      : 0.25

  const codeFontSize = Math.max(11.5, bodyFontSize - 2.5)
  const codeLineHeight = Math.round(codeFontSize * (appearance.spacingScale === 'relaxed' ? 1.58 : appearance.spacingScale === 'tight' ? 1.38 : 1.48))
  const inlineCodeFontSize = Math.max(11.5, bodyFontSize - 2)

  const h1Size = Math.round(bodyFontSize + 6.5)
  const h2Size = Math.round(bodyFontSize + 3.5)
  const h3Size = Math.round(bodyFontSize + 1.5)
  const h4Size = Math.round(bodyFontSize)

  const paragraphGap = appearance.spacingScale === 'tight' ? 5
    : appearance.spacingScale === 'relaxed' ? 12
      : 8
  const listGap = appearance.spacingScale === 'tight' ? 2
    : appearance.spacingScale === 'relaxed' ? 8
      : 5
  const turnTopGap = appearance.spacingScale === 'tight' ? 8
    : appearance.spacingScale === 'relaxed' ? 18
      : 13
  const turnBottomGap = appearance.spacingScale === 'tight' ? 4
    : appearance.spacingScale === 'relaxed' ? 10
      : 6
  const assistantGap = appearance.spacingScale === 'tight' ? 3
    : appearance.spacingScale === 'relaxed' ? 10
      : 6

  return {
    bodyFontSize,
    bodyLineHeight,
    letterSpacing,
    codeFontSize,
    codeLineHeight,
    inlineCodeFontSize,
    h1Size,
    h1LineHeight: Math.round(h1Size * 1.32),
    h2Size,
    h2LineHeight: Math.round(h2Size * 1.34),
    h3Size,
    h3LineHeight: Math.round(h3Size * 1.36),
    h4Size,
    h4LineHeight: Math.round(h4Size * 1.38),
    paragraphGap,
    headingTopGap: paragraphGap + 4,
    headingBottomGap: Math.max(4, paragraphGap - 1),
    listGap,
    turnTopGap,
    turnBottomGap,
    assistantGap,
  }
}

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  /** Grouped lists, cards and sheets. */
  xl: 22,
  /** The composer and other large floating surfaces. */
  xxl: 28,
  pill: 999,
} as const

/** Soft lift for floating controls (header chips, cards, composer). */
export function floatingShadow(colors: { shadow: string }, strength: 'low' | 'high' = 'low') {
  return strength === 'high'
    ? { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 }
    : { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2 }
}

/** Soft brand glow for prominent floating call-to-action pills (e.g. create session). */
export function brandGlowShadow(colors: { primary: string; shadow: string }) {
  return {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 4,
  }
}

export const standardType = {
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.6, includeFontPadding: false },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.3, includeFontPadding: false },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const, includeFontPadding: false },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const, includeFontPadding: false },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const, includeFontPadding: false },
  small: { fontSize: 14, lineHeight: 19, fontWeight: '400' as const, includeFontPadding: false },
  smallStrong: { fontSize: 14, lineHeight: 19, fontWeight: '600' as const, includeFontPadding: false },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, includeFontPadding: false },
} as const

export const compactType = {
  hero: { fontSize: 30, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.6, includeFontPadding: false },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3, includeFontPadding: false },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, includeFontPadding: false },
  body: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const, includeFontPadding: false },
  bodyStrong: { fontSize: 15, lineHeight: 20, fontWeight: '600' as const, includeFontPadding: false },
  small: { fontSize: 13, lineHeight: 17, fontWeight: '400' as const, includeFontPadding: false },
  smallStrong: { fontSize: 13, lineHeight: 17, fontWeight: '600' as const, includeFontPadding: false },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '500' as const, includeFontPadding: false },
} as const

export function typeForDensity(density: TypographyDensity) {
  return density === 'compact' ? compactType : standardType
}

export const type = standardType
