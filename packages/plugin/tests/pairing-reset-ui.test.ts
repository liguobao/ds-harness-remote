import { afterEach, describe, expect, it, vi } from 'vitest'
import { en, zh } from '../src/client-locale.js'
import { connectionErrorMessage, messageOf } from '../src/client/presentation.js'
import { createRemotePluginOptions } from '../src/client/settings.js'
import { createRemoteWorkspaceAction } from '../src/client/workspaces.js'
import type { ClientReact } from '../src/client/types.js'

function createTestHarness() {
  let stateSlots: any[] = []
  let stateIndex = 0
  let prevDeps: any[][] = []
  let effectCleanups: (((() => void) | void))[] = []
  let effectIndex = 0
  const React: ClientReact = {
    Fragment: Symbol('Fragment'),
    createElement(type: any, props: any, ...children: any[]) { return { type, props: props || {}, children } },
    useEffect(effect: any, deps?: any[]) {
      const slot = effectIndex++
      const oldDeps = prevDeps[slot]
      const hasChanged = !oldDeps || !deps || deps.some((d, i) => !Object.is(d, oldDeps[i]))
      if (hasChanged) {
        if (typeof effectCleanups[slot] === 'function') effectCleanups[slot]!()
        prevDeps[slot] = deps || []
        effectCleanups[slot] = effect()
      }
    },
    useCallback(cb: any) { return cb },
    useMemo(factory: any) { return factory() },
    useRef(initial: any) { const slot = stateIndex++; if (stateSlots[slot] === undefined) stateSlots[slot] = { current: initial }; return stateSlots[slot] },
    useState(initial: any) {
      const slot = stateIndex++
      if (stateSlots[slot] === undefined) stateSlots[slot] = typeof initial === 'function' ? initial() : initial
      const setState = (val: any) => { stateSlots[slot] = typeof val === 'function' ? val(stateSlots[slot]) : val }
      return [stateSlots[slot], setState]
    },
    useSyncExternalStore(_subscribe: any, getSnapshot: any) { return typeof getSnapshot === 'function' ? getSnapshot() : undefined },
  }
  return {
    React,
    resetRender: () => { stateIndex = 0; effectIndex = 0 },
    unmount: () => { for (const cleanup of effectCleanups) if (typeof cleanup === 'function') cleanup(); effectCleanups = [] },
  }
}

function findElement(node: any, predicate: (n: any) => boolean): any {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  const children = Array.isArray(node) ? node : node.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  }
  return null
}

function textContent(node: any): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (typeof node === 'object') return textContent(node.children)
  return ''
}

describe('pairingHostOnly UI and desktop identity reset overhaul', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.unstubAllGlobals() })

  it('translates DEVICE_SCOPE_REQUIRED in both presentation helpers and locales', () => {
    const tZh = (key: keyof typeof en) => zh[key]
    const tEn = (key: keyof typeof en) => en[key]
    const err = Object.assign(new Error('This Host only accepts incoming Remote connections.'), { code: 'DEVICE_SCOPE_REQUIRED' })
    expect(messageOf(err, tZh)).toBe(zh.pairingHostOnly)
    expect(connectionErrorMessage('DEVICE_SCOPE_REQUIRED', tZh)).toBe(zh.pairingHostOnly)
    expect(messageOf(err, tEn)).toBe(en.pairingHostOnly)
    expect(connectionErrorMessage('DEVICE_SCOPE_REQUIRED', tEn)).toBe(en.pairingHostOnly)
  })

  it('hides client login tabs/polling under pairingHostOnly and exits pairing mode cleanly', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    cleanups.push(unmount)
    vi.stubGlobal('window', {
      requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      setInterval: vi.fn(), clearInterval: vi.fn(),
    })
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
    let pairingHostOnly = true
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'settings.get') return { config: { serverUrl: 'https://dsh.r2049.cn' }, writable: true, associations: {} }
      if (endpoint === 'status') return {
        mode: 'local', available: true, serverUrl: 'https://dsh.r2049.cn',
        hostAuthorizationAvailable: true,
        host: { configured: true, online: false, reconnecting: false, authorized: false, accountRequired: false, pairingHostOnly },
      }
      if (endpoint === 'client.account.providers') return [
        { id: 'google', displayName: 'Google', qrStartUrl: 'https://example.com/g' },
        { id: 'zhihu', displayName: '知乎', devicePairing: true, qrStartUrl: 'https://example.com/z' },
      ]
      if (endpoint === 'settings.logout') { pairingHostOnly = false; return { config: { serverUrl: 'https://dsh.r2049.cn' }, writable: true, associations: {} } }
      if (endpoint === 'client.authorization.status') return { hasCredentials: false }
      if (endpoint === 'host.pairing.status') return undefined
      if (endpoint === 'client.account.qr.start') return { qrId: 'qr-1', scanUrl: 'https://example.com/scan' }
      return {}
    })
    const Workspace = createRemoteWorkspaceAction(React) as any
    const render = () => { resetRender(); return Workspace({
      wide: true, control, preferredQrProvider: 'google',
      statusFeed: { subscribe: () => () => {}, getSnapshot: () => undefined },
      subscribeOpen: () => () => {},
      sidebarEntry: { read: () => 'standard', subscribe: () => () => {}, publish: () => {} },
      t: (key: keyof typeof en) => zh[key],
    }) }
    const settle = async () => { await new Promise(r => setTimeout(r, 15)); return render() }
    let tree = await settle()
    findElement(tree, n => n.props?.className === 'dshRemoteModeButton').props.onClick()
    tree = await settle()
    tree = await settle()
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id?.includes('oauth:google'))).toBeNull()
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id === 'dsh-remote-password-tab')).toBeNull()
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id === 'dsh-remote-pairing-tab')).toBeTruthy()
    expect(control).not.toHaveBeenCalledWith('client.account.qr.start', expect.anything())
    expect(control).not.toHaveBeenCalledWith('client.account.qr.poll', expect.anything())
    expect(textContent(tree)).not.toContain('This Host only accepts incoming Remote connections.')
    const exitBtn = findElement(tree, n => n.type === 'button' && textContent(n).includes(zh.exitPairingMode))
    expect(exitBtn).toBeTruthy()
    exitBtn.props.onClick()
    tree = await settle()
    tree = await settle()
    expect(control).toHaveBeenCalledWith('settings.logout')
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id?.includes('oauth:google'))).toBeTruthy()
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id === 'dsh-remote-password-tab')).toBeTruthy()
  })

  it('places desktop identity reset in a collapsible drawer with unified full reset and inline confirm (no window.confirm)', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    cleanups.push(unmount)
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('window', { confirm: confirmSpy })
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'settings.get' || endpoint === 'settings.identity.reset') {
        return { config: { serverUrl: 'https://dsh.r2049.cn' }, deviceName: 'dev', writable: true, associations: {} }
      }
      if (endpoint === 'status') return { mode: 'local', available: true, deviceName: 'dev', host: { deviceId: 'host-1', authorized: false } }
      return {}
    })
    const Options = createRemotePluginOptions(React) as any
    const render = () => { resetRender(); return Options({
      control, statusFeed: { subscribe: () => () => {}, getSnapshot: () => undefined },
      t: (key: keyof typeof en) => zh[key], view: 'page',
    }) }
    const settle = async () => { await new Promise(r => setTimeout(r, 10)); return render() }
    render()
    let tree = await settle()
    const details = findElement(tree, n => n.type === 'details' && String(n.props?.className).includes('dshRemoteResetDetails'))
    expect(details).toBeTruthy()
    expect(findElement(tree, n => n.props?.role === 'alertdialog')).toBeNull()
    expect(findElement(details, n => n.props?.role === 'radiogroup')).toBeNull()
    findElement(tree, n => n.type === 'button' && String(n.props?.className).includes('dshRemoteDangerBtn')).props.onClick()
    tree = render()
    const dialog = findElement(tree, n => n.props?.role === 'alertdialog')
    expect(dialog).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()
    findElement(dialog, n => n.type === 'button' && textContent(n).includes(zh.confirmResetIdentity)).props.onClick()
    tree = await settle()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(control).toHaveBeenCalledWith('settings.identity.reset', { role: 'all' })
    expect(findElement(tree, n => n.props?.role === 'alertdialog')).toBeNull()
  })

  it('surfaces direct identity reset recovery inside startupErrorBanner when IDENTITY_INVALID occurs', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    cleanups.push(unmount)
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'settings.get') return {
        config: { serverUrl: 'https://dsh.r2049.cn' }, deviceName: 'dev', writable: true, associations: {},
        startupError: { code: 'IDENTITY_INVALID', message: 'corrupt' },
      }
      if (endpoint === 'settings.identity.reset') return {
        config: { serverUrl: 'https://dsh.r2049.cn' }, deviceName: 'dev', writable: true, associations: {},
      }
      if (endpoint === 'status') return { mode: 'local', available: true, deviceName: 'dev', host: { deviceId: 'host-2', authorized: false } }
      return {}
    })
    const Options = createRemotePluginOptions(React) as any
    const render = () => { resetRender(); return Options({
      control, statusFeed: { subscribe: () => () => {}, getSnapshot: () => undefined },
      t: (key: keyof typeof en) => zh[key], view: 'page',
    }) }
    const settle = async () => { await new Promise(r => setTimeout(r, 10)); return render() }
    render()
    let tree = await settle()
    const banner = findElement(tree, n => String(n.props?.className).includes('dshRemoteStartupBanner'))
    expect(banner).toBeTruthy()
    findElement(banner, n => n.type === 'button' && String(n.props?.className).includes('dshRemoteDangerBtn')).props.onClick()
    tree = render()
    const bannerDialog = findElement(findElement(tree, n => String(n.props?.className).includes('dshRemoteStartupBanner')), n => n.props?.role === 'alertdialog')
    expect(bannerDialog).toBeTruthy()
    findElement(bannerDialog, n => n.type === 'button' && textContent(n).includes(zh.confirmResetIdentity)).props.onClick()
    tree = await settle()
    expect(control).toHaveBeenCalledWith('settings.identity.reset', { role: 'all' })
  })
  it('hides client sign-in tabs and QR polling in Desktop Settings inlineSignIn when pairingHostOnly is true', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    cleanups.push(unmount)
    let pairingHostOnly = true
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'settings.get') return { config: { serverUrl: 'https://dsh.r2049.cn' }, deviceName: 'dev', writable: true, associations: {} }
      if (endpoint === 'status') return {
        mode: 'local', available: true, deviceName: 'dev',
        host: { deviceId: 'host-1', configured: true, online: false, reconnecting: false, authorized: false, accountRequired: false, pairingHostOnly },
      }
      if (endpoint === 'client.account.providers') return [
        { id: 'google', displayName: 'Google', qrStartUrl: 'https://example.com/g' },
        { id: 'zhihu', displayName: '知乎', devicePairing: true, qrStartUrl: 'https://example.com/z' },
      ]
      if (endpoint === 'host.pairing.status') return undefined
      if (endpoint === 'settings.logout') { pairingHostOnly = false; return { config: { serverUrl: 'https://dsh.r2049.cn' }, deviceName: 'dev', writable: true, associations: {} } }
      if (endpoint === 'client.account.qr.start') return { qrId: 'qr-1', scanUrl: 'https://example.com/scan' }
      return {}
    })
    const Options = createRemotePluginOptions(React) as any
    const render = () => { resetRender(); return Options({
      control, statusFeed: { subscribe: () => () => {}, getSnapshot: () => undefined },
      preferredQrProvider: 'google', t: (key: keyof typeof en) => zh[key], view: 'page',
    }) }
    const settle = async () => { await new Promise(r => setTimeout(r, 15)); return render() }
    render()
    let tree = await settle()
    findElement(tree, n => n.props?.['aria-controls'] === 'dsh-remote-inline-signin').props.onClick()
    tree = await settle()
    tree = await settle()
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id?.includes('oauth:google'))).toBeNull()
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id === 'dsh-remote-settings-password-tab')).toBeNull()
    expect(findElement(tree, n => n.props?.role === 'tab' && n.props?.id === 'dsh-remote-settings-device-pairing-tab')).toBeTruthy()
    expect(control).not.toHaveBeenCalledWith('client.account.qr.start', expect.anything())
    const exitBtn = findElement(tree, n => n.type === 'button' && textContent(n).includes(zh.exitPairingMode))
    expect(exitBtn).toBeTruthy()
    exitBtn.props.onClick()
    tree = await settle()
    expect(control).toHaveBeenCalledWith('settings.logout')
  })
})
