import { describe, expect, it } from 'vitest'
import {
  effectiveTopScreenIndex,
  isRouteActiveScreen,
  isSheetConnectionRoute,
  resolveTopLevelHardwareBack,
  shouldHideSplashScreen,
  shouldSuppressAutoSessionSelect,
  type AppRoute,
} from '../src/lib/navigation'

describe('top-level navigation state decisions', () => {
  it('keeps the underlying full-screen route active index below a sheet-style connection route', () => {
    const sheetStack: AppRoute[] = [
      { name: 'chat' },
      { name: 'connecting', deviceId: 'host-1', sheet: true, sessionId: 'sess-1' },
    ]
    expect(isSheetConnectionRoute(sheetStack[1]!)).toBe(true)
    expect(effectiveTopScreenIndex(sheetStack)).toBe(0)
    expect(isRouteActiveScreen(sheetStack, 0, true)).toBe(false)
    expect(isRouteActiveScreen(sheetStack, 0, false)).toBe(true)

    const settingsStack: AppRoute[] = [{ name: 'chat' }, { name: 'settings' }]
    expect(isSheetConnectionRoute(settingsStack[1]!)).toBe(false)
    expect(effectiveTopScreenIndex(settingsStack)).toBe(1)
    expect(isRouteActiveScreen(settingsStack, 0, false)).toBe(false)
    expect(isRouteActiveScreen(settingsStack, 1, false)).toBe(true)
    expect(isRouteActiveScreen(settingsStack, 1, true)).toBe(false)
  })

  it('keeps splash visible until boot is ready, browse memory loaded, and initial route committed', () => {
    expect(shouldHideSplashScreen({ bootPhase: 'loading', browseReady: true, initialRouteChosen: true })).toBe(false)
    expect(shouldHideSplashScreen({ bootPhase: 'ready', browseReady: false, initialRouteChosen: true })).toBe(false)
    expect(shouldHideSplashScreen({ bootPhase: 'ready', browseReady: true, initialRouteChosen: false })).toBe(false)
    expect(shouldHideSplashScreen({ bootPhase: 'ready', browseReady: true, initialRouteChosen: true })).toBe(true)
    expect(shouldHideSplashScreen({ bootPhase: 'error', browseReady: false, initialRouteChosen: false })).toBe(true)
  })

  it('suppresses automatic session selection while connecting, restoring a known session, or in bot mode', () => {
    const cases: Array<{
      label: string
      input: Parameters<typeof shouldSuppressAutoSessionSelect>[0]
      expected: boolean
    }> = [
      {
        label: 'bot mode active',
        input: { botMode: true, routeName: 'chat', connectionPhase: 'connected', resolvingKnownSession: false },
        expected: true,
      },
      {
        label: 'connecting route active',
        input: { botMode: false, routeName: 'connecting', connectionPhase: 'connected', resolvingKnownSession: false },
        expected: true,
      },
      {
        label: 'host transport connecting with cached catalog',
        input: { botMode: false, routeName: 'chat', connectionPhase: 'connecting', resolvingKnownSession: false },
        expected: true,
      },
      {
        label: 'host transport reconnecting',
        input: { botMode: false, routeName: 'chat', connectionPhase: 'reconnecting', resolvingKnownSession: false },
        expected: true,
      },
      {
        label: 'resolving deep-link or resume session',
        input: { botMode: false, routeName: 'chat', connectionPhase: 'connected', resolvingKnownSession: true },
        expected: true,
      },
      {
        label: 'settled connected chat',
        input: { botMode: false, routeName: 'chat', connectionPhase: 'connected', resolvingKnownSession: false },
        expected: false,
      },
      {
        label: 'settled offline trusted host',
        input: { botMode: false, routeName: 'chat', connectionPhase: 'offline', resolvingKnownSession: false },
        expected: false,
      },
    ]

    const failures: string[] = []
    for (const item of cases) {
      const actual = shouldSuppressAutoSessionSelect(item.input)
      if (actual !== item.expected) failures.push(`${item.label}: expected ${item.expected}, got ${actual}`)
    }
    expect(failures).toEqual([])
  })

  it('resolves hardware back deterministically without listener reorder races', () => {
    expect(resolveTopLevelHardwareBack({
      signingOut: true,
      hostSwitcherOpen: false,
      homeMenuOpen: false,
      route: { name: 'settings' },
      routesLength: 2,
    })).toEqual({ action: 'consume' })

    expect(resolveTopLevelHardwareBack({
      hostSwitcherOpen: true,
      homeMenuOpen: true,
      route: { name: 'chat' },
      routesLength: 1,
    })).toEqual({ action: 'close-host-switcher' })

    expect(resolveTopLevelHardwareBack({
      hostSwitcherOpen: false,
      homeMenuOpen: true,
      route: { name: 'server' },
      routesLength: 1,
    })).toEqual({ action: 'close-home-menu' })

    expect(resolveTopLevelHardwareBack({
      hostSwitcherOpen: false,
      homeMenuOpen: false,
      route: { name: 'connecting', deviceId: 'host-1' },
      routesLength: 2,
    })).toEqual({ action: 'delegate' })

    expect(resolveTopLevelHardwareBack({
      hostSwitcherOpen: false,
      homeMenuOpen: false,
      route: { name: 'settings' },
      routesLength: 2,
    })).toEqual({ action: 'pop' })

    expect(resolveTopLevelHardwareBack({
      hostSwitcherOpen: false,
      homeMenuOpen: false,
      route: { name: 'chat' },
      routesLength: 1,
    })).toEqual({ action: 'delegate' })
  })
})
