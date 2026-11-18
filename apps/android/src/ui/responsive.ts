import { useWindowDimensions } from 'react-native'

/**
 * Window heights below this are landscape phones (and other vertically
 * constrained windows such as split screen), where bottom sheets and the
 * composer compete with the IME for room.
 */
export const COMPACT_WINDOW_HEIGHT = 520

/** Reading width cap so chat content does not stretch across landscape tablets. */
export const CONTENT_MAX_WIDTH = 760

/**
 * Height a bottom sheet may occupy. Landscape phones use nearly the full
 * window because a sheet capped at 70% would clip fixed, non-scrolling
 * content (the composer "+" menu and workspace dialogs).
 */
export function modalSheetMaxHeight(windowHeight: number): number {
  const ratio = windowHeight < COMPACT_WINDOW_HEIGHT ? 0.92 : 0.7
  return Math.min(windowHeight - 8, Math.max(200, Math.round(windowHeight * ratio)))
}

export interface ResponsiveLayout {
  width: number
  height: number
  /** True when the screen is wider than it is tall. */
  landscape: boolean
  /** True for landscape phones and other short windows. */
  compactHeight: boolean
  contentMaxWidth: number
  sheetMaxHeight: number
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions()
  return {
    width,
    height,
    landscape: width > height,
    compactHeight: height < COMPACT_WINDOW_HEIGHT,
    contentMaxWidth: CONTENT_MAX_WIDTH,
    sheetMaxHeight: modalSheetMaxHeight(height),
  }
}
