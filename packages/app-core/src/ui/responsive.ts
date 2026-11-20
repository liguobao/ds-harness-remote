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
 * Window size classes aligned with Material 3 window size classes. iPad split
 * view and Android split screen slide through the same classes as the window
 * is resized, so every layout decision follows the window, never the device.
 */
export const WINDOW_SIZE_MEDIUM = 600
export const WINDOW_SIZE_EXPANDED = 840

/**
 * Overlay drawers fill compact windows but are capped on medium/expanded
 * ones (Material 3 modal drawer width) so the conversation behind the scrim
 * stays visible with comfortable breathing room and close-tap target.
 */
export const DRAWER_MAX_WIDTH = 360

/**
 * Reading width cap for full-width non-dismissible drawers (cold start / host
 * switch) on wide windows so workspace rows do not stretch edge-to-edge.
 */
export const DRAWER_FULL_CONTENT_MAX_WIDTH = 560

/** Width cap for bottom sheets promoted to centered dialog cards on wide windows. */
export const DIALOG_SHEET_MAX_WIDTH = 560

export type WindowSizeClass = 'compact' | 'medium' | 'expanded'

export function windowSizeClassForWidth(width: number): WindowSizeClass {
  if (width < WINDOW_SIZE_MEDIUM) return 'compact'
  if (width < WINDOW_SIZE_EXPANDED) return 'medium'
  return 'expanded'
}

/**
 * Whether the window keeps a persistent side pane (conversation split).
 * Landscape phones are excluded by the height
 * guard; very wide windows keep the pane even while the IME shrinks the
 * window height.
 */
export function persistentPaneForWindow(width: number, height: number): boolean {
  return width >= CONTENT_MAX_WIDTH && (height >= COMPACT_WINDOW_HEIGHT || width >= 1000)
}

/** Overlay drawer travel width: full width on phones, capped on wide windows. */
export function drawerWidthForWindow(width: number): number {
  return width < WINDOW_SIZE_MEDIUM ? width : Math.min(width, DRAWER_MAX_WIDTH)
}

/**
 * Whether bottom sheets render as centered dialog cards. Height-guarded like
 * `persistentPaneForWindow` so landscape phones keep the full-width bottom
 * sheet; very wide windows keep the card even while the IME shrinks the
 * window height.
 */
export function sheetDialogForWindow(width: number, height: number): boolean {
  return width >= WINDOW_SIZE_MEDIUM && (height >= COMPACT_WINDOW_HEIGHT || width >= 1000)
}

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
  /** Material-style window size class driven by width. */
  sizeClass: WindowSizeClass
  /** Keep a persistent side pane: conversation split. */
  splitNav: boolean
  /** Bottom sheets render as centered dialog cards. */
  sheetAsDialog: boolean
  /** Travel width of the overlay sessions drawer. */
  drawerWidth: number
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
    sizeClass: windowSizeClassForWidth(width),
    splitNav: persistentPaneForWindow(width, height),
    sheetAsDialog: sheetDialogForWindow(width, height),
    drawerWidth: drawerWidthForWindow(width),
  }
}
