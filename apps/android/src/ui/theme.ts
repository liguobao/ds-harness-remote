export type ColorScheme = 'light' | 'dark'

export type ThemePreference = 'system' | ColorScheme

export type TypographyDensity = 'standard' | 'compact'

export function isTypographyDensity(value: unknown): value is TypographyDensity {
  return value === 'standard' || value === 'compact'
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
  background: string
  surface: string
  surfaceStrong: string
  ink: string
  muted: string
  subtle: string
  primary: string
  primaryPressed: string
  primarySoft: string
  accent: string
  accentSoft: string
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

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceStrong: '#F0F2F5',
  ink: '#1D1D1F',
  muted: '#5F636B',
  subtle: '#70757D',
  primary: '#1677FF',
  primaryPressed: '#0958D9',
  primarySoft: '#E8F3FF',
  accent: '#1677FF',
  accentSoft: '#E8F3FF',
  success: '#276A3C',
  successSoft: '#E2F2E7',
  warning: '#825306',
  warningSoft: '#FAEDCC',
  danger: '#A73A32',
  dangerSoft: '#F9E5E2',
  border: '#D9E2EC',
  separator: '#E8E8ED',
  disabled: '#A7ABB3',
  white: '#FFFFFF',
  scrim: 'rgba(23, 24, 29, 0.42)',
  modalBackdrop: 'rgba(0, 0, 0, 0.45)',
  menuDismiss: 'rgba(23, 24, 29, 0.16)',
  shadow: '#000000',
}

export const darkColors: ThemeColors = {
  background: '#0F1114',
  surface: '#1A1D23',
  surfaceStrong: '#252932',
  ink: '#F2F3F5',
  muted: '#9AA0A6',
  subtle: '#7C828A',
  primary: '#4096FF',
  primaryPressed: '#1668DC',
  primarySoft: '#111A2C',
  accent: '#4096FF',
  accentSoft: '#111A2C',
  success: '#49AA6E',
  successSoft: '#162312',
  warning: '#D89614',
  warningSoft: '#2B2111',
  danger: '#E86E6B',
  dangerSoft: '#2A1215',
  border: '#3A4048',
  separator: '#2E343C',
  disabled: '#5F636B',
  white: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.55)',
  modalBackdrop: 'rgba(0, 0, 0, 0.6)',
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
  pill: 999,
} as const

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
