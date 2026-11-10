export type ColorScheme = 'light' | 'dark'

export type ThemePreference = 'system' | ColorScheme

export type TypographyDensity = 'standard' | 'compact'

export type ActivityDockMode = 'compact' | 'cards' | 'hidden'

export function isTypographyDensity(value: unknown): value is TypographyDensity {
  return value === 'standard' || value === 'compact'
}

export function isActivityDockMode(value: unknown): value is ActivityDockMode {
  return value === 'compact' || value === 'cards' || value === 'hidden'
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
}

export function colorsForScheme(scheme: ColorScheme): ThemeColors {
  return scheme === 'dark' ? darkColors : lightColors
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
