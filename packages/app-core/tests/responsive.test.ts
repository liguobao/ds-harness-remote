import { describe, expect, it, vi } from 'vitest'

// Pure breakpoint helpers only; the react-native import exists for the hook.
vi.mock('react-native', () => ({ useWindowDimensions: () => ({ width: 390, height: 844 }) }))

import {
  COMPACT_WINDOW_HEIGHT,
  CONTENT_MAX_WIDTH,
  DRAWER_MAX_WIDTH,
  drawerWidthForWindow,
  modalSheetMaxHeight,
  persistentPaneForWindow,
  sheetDialogForWindow,
  windowSizeClassForWidth,
  WINDOW_SIZE_EXPANDED,
  WINDOW_SIZE_MEDIUM,
} from '../src/ui/responsive'

describe('windowSizeClassForWidth', () => {
  it('classifies phone portraits as compact', () => {
    expect(windowSizeClassForWidth(320)).toBe('compact')
    expect(windowSizeClassForWidth(390)).toBe('compact')
    expect(windowSizeClassForWidth(WINDOW_SIZE_MEDIUM - 1)).toBe('compact')
  })

  it('classifies iPad split view and small tablets as medium', () => {
    expect(windowSizeClassForWidth(WINDOW_SIZE_MEDIUM)).toBe('medium')
    expect(windowSizeClassForWidth(744)).toBe('medium') // iPad mini portrait
    expect(windowSizeClassForWidth(WINDOW_SIZE_EXPANDED - 1)).toBe('medium')
  })

  it('classifies tablets and iPad full windows as expanded', () => {
    expect(windowSizeClassForWidth(WINDOW_SIZE_EXPANDED)).toBe('expanded')
    expect(windowSizeClassForWidth(1024)).toBe('expanded')
    expect(windowSizeClassForWidth(1366)).toBe('expanded')
  })
})

describe('persistentPaneForWindow', () => {
  it('stays single-pane on phones in any orientation', () => {
    expect(persistentPaneForWindow(390, 844)).toBe(false)
    // Landscape phone: wide enough but vertically constrained.
    expect(persistentPaneForWindow(844, 390)).toBe(false)
    expect(persistentPaneForWindow(CONTENT_MAX_WIDTH - 1, 1280)).toBe(false)
  })

  it('keeps a side pane on tablets', () => {
    expect(persistentPaneForWindow(768, 1024)).toBe(true)
    expect(persistentPaneForWindow(800, 1280)).toBe(true)
    expect(persistentPaneForWindow(1280, 800)).toBe(true)
    expect(persistentPaneForWindow(CONTENT_MAX_WIDTH, COMPACT_WINDOW_HEIGHT)).toBe(true)
  })

  it('keeps the pane on very wide windows even when the IME shrinks the height', () => {
    expect(persistentPaneForWindow(1000, 400)).toBe(true)
    expect(persistentPaneForWindow(1280, 400)).toBe(true)
    // Just below the very-wide escape hatch the height guard still applies.
    expect(persistentPaneForWindow(999, COMPACT_WINDOW_HEIGHT - 1)).toBe(false)
  })
})

describe('drawerWidthForWindow', () => {
  it('fills compact windows', () => {
    expect(drawerWidthForWindow(390)).toBe(390)
    expect(drawerWidthForWindow(WINDOW_SIZE_MEDIUM - 1)).toBe(WINDOW_SIZE_MEDIUM - 1)
  })

  it('caps overlay drawers on wide windows', () => {
    expect(drawerWidthForWindow(WINDOW_SIZE_MEDIUM)).toBe(DRAWER_MAX_WIDTH)
    expect(drawerWidthForWindow(640)).toBe(DRAWER_MAX_WIDTH)
    expect(drawerWidthForWindow(768)).toBe(DRAWER_MAX_WIDTH)
    expect(drawerWidthForWindow(1280)).toBe(DRAWER_MAX_WIDTH)
  })
})

describe('sheetDialogForWindow', () => {
  it('promotes sheets to dialogs only from the medium class upward', () => {
    expect(sheetDialogForWindow(390, 844)).toBe(false)
    expect(sheetDialogForWindow(WINDOW_SIZE_MEDIUM - 1, 844)).toBe(false)
    expect(sheetDialogForWindow(WINDOW_SIZE_MEDIUM, 844)).toBe(true)
    expect(sheetDialogForWindow(1366, 1024)).toBe(true)
  })

  it('keeps the bottom sheet on landscape phones despite the wide window', () => {
    expect(sheetDialogForWindow(844, 390)).toBe(false)
    expect(sheetDialogForWindow(915, 412)).toBe(false)
  })

  it('keeps the dialog card on very wide windows while the IME shrinks the height', () => {
    expect(sheetDialogForWindow(1024, 400)).toBe(true)
    // Just below the very-wide escape hatch the height guard still applies.
    expect(sheetDialogForWindow(999, COMPACT_WINDOW_HEIGHT - 1)).toBe(false)
  })
})

describe('modalSheetMaxHeight', () => {
  it('gives landscape phones nearly the full window', () => {
    const height = COMPACT_WINDOW_HEIGHT - 1
    expect(modalSheetMaxHeight(height)).toBe(Math.min(height - 8, Math.round(height * 0.92)))
  })

  it('caps ordinary windows at 70% with a floor of 200', () => {
    expect(modalSheetMaxHeight(844)).toBe(Math.round(844 * 0.7))
    expect(modalSheetMaxHeight(600)).toBe(420)
    // On very short windows the windowHeight - 8 safety clamp wins over the floor.
    expect(modalSheetMaxHeight(150)).toBe(142)
  })
})
