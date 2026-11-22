import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemotePluginOptions } from '../src/client/settings.js'
import { createHostPairingPanel } from '../src/client/pairing.js'
import { createRemoteWorkspaceAction } from '../src/client/workspaces.js'
import type { ClientReact, PluginSettingsView } from '../src/client/types.js'

function createTestHarness() {
  let stateSlots: any[] = []
  let stateIndex = 0
  let prevDeps: any[][] = []
  let effectCleanups: (((() => void) | void))[] = []
  let effectIndex = 0

  const React: ClientReact = {
    Fragment: Symbol('Fragment'),
    createElement(type: any, props: any, ...children: any[]) {
      return { type, props: props || {}, children }
    },
    useEffect(effect: any, deps?: any[]) {
      const slot = effectIndex++
      const oldDeps = prevDeps[slot]
      const hasChanged = !oldDeps || !deps || deps.some((d, i) => !Object.is(d, oldDeps[i]))
      if (hasChanged) {
        if (typeof effectCleanups[slot] === 'function') {
          effectCleanups[slot]!()
        }
        prevDeps[slot] = deps || []
        effectCleanups[slot] = effect()
      }
    },
    useCallback(cb: any) { return cb },
    useMemo(factory: any) { return factory() },
    useRef(initial: any) {
      const slot = stateIndex++
      if (stateSlots[slot] === undefined) stateSlots[slot] = { current: initial }
      return stateSlots[slot]
    },
    useState(initial: any) {
      const slot = stateIndex++
      if (stateSlots[slot] === undefined) {
        stateSlots[slot] = typeof initial === 'function' ? initial() : initial
      }
      const setState = (val: any) => {
        stateSlots[slot] = typeof val === 'function' ? val(stateSlots[slot]) : val
      }
      return [stateSlots[slot], setState]
    },
    useSyncExternalStore(subscribe: any, getSnapshot: any) {
      return typeof getSnapshot === 'function' ? getSnapshot() : undefined
    },
  }

  const unmount = () => {
    for (const cleanup of effectCleanups) {
      if (typeof cleanup === 'function') cleanup()
    }
    effectCleanups = []
  }

  const resetRender = () => {
    stateIndex = 0
    effectIndex = 0
  }

  return { React, resetRender, unmount }
}

const findElement = (node: any, predicate: (n: any) => boolean): any => {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  if (node.children || Array.isArray(node)) {
    for (const child of Array.isArray(node) ? node : node.children) {
      const found = findElement(child, predicate)
      if (found) return found
    }
  }
  return null
}

const waitForElement = async (renderFn: () => any, predicate: (n: any) => boolean, timeoutMs = 4000): Promise<{ tree: any; el: any }> => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const tree = renderFn()
    const el = findElement(tree, predicate)
    if (el) return { tree, el }
    await new Promise(r => setTimeout(r, 25))
  }
  const tree = renderFn()
  return { tree, el: findElement(tree, predicate) }
}

describe.each(['settings', 'workspace'] as const)('%s provider fallback', entrance => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup())
    vi.unstubAllGlobals()
  })

  async function openLogin(providers: ReturnType<typeof vi.fn>) {
    const { React, resetRender, unmount } = createTestHarness()
    cleanups.push(unmount)
    vi.stubGlobal('window', {
      requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      setInterval: vi.fn(), clearInterval: vi.fn(),
    })
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
    let submitError: Error | undefined = new Error('password rejected by server')
    let signedIn = false
    let settings = { config: { serverUrl: 'https://dsh.r2049.cn' }, writable: true, associations: {} }
    const listeners = new Set<(status: any) => void>()
    const status = () => ({
      mode: 'local', available: true, serverUrl: settings.config.serverUrl,
      hostAuthorizationAvailable: true, clientAuthRequired: !signedIn,
    })
    const control = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') return settings
      if (endpoint === 'settings.server.set') {
        settings = { ...settings, config: { serverUrl: payload.serverUrl } }
        return { ...settings, applies: 'live' }
      }
      if (endpoint === 'status') return status()
      if (endpoint === 'client.account.providers') return providers()
      if (endpoint === 'client.account.qr.start') return new Promise(() => {})
      if (endpoint === 'devices') return []
      if (endpoint === 'settings.configure' || endpoint === 'client.account.login') {
        if (submitError) throw submitError
        signedIn = true
        return { settings: { ...settings, associations: { client: { email: 'user@example.com' } } } }
      }
      return {}
    })
    const props = {
      control, statusFeed: {
        subscribe: (listener: (next: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        getSnapshot: () => undefined,
      },
      t: (key: string) => key, view: 'page', wide: true, preferredQrProvider: 'zhihu',
      subscribeOpen: () => () => {},
      sidebarEntry: { read: () => 'standard', subscribe: () => () => {}, publish: () => {} },
    }
    const Component = (entrance === 'settings' ? createRemotePluginOptions(React) : createRemoteWorkspaceAction(React)) as any
    const render = () => { resetRender(); return Component(props) }
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); return render() }
    render()
    let tree = await settle()
    findElement(tree, (node: any) => entrance === 'settings'
      ? node.props?.['aria-controls'] === 'dsh-remote-inline-signin'
      : node.props?.className === 'dshRemoteModeButton').props.onClick()
    render()
    await settle()
    tree = await settle()
    return {
      render, settle, tree, props, control, allowSubmit: () => { submitError = undefined },
      pushServer: (serverUrl: string) => {
        settings = { ...settings, config: { serverUrl } }
        listeners.forEach(listener => listener(status()))
      },
    }
  }

  it('shows password after discovery settles and preserves real submit failure before success', async () => {
    let rejectDiscovery!: (reason: Error) => void
    const providers = vi.fn(() => new Promise((_, reject) => { rejectDiscovery = reject }))
    const login = await openLogin(providers)
    rejectDiscovery(new Error('provider network failed'))
    let tree = await login.settle()
    const panel = () => findElement(tree, (node: any) => node.props?.role === 'tabpanel'
      && node.props?.id?.endsWith('password-panel'))
    expect(panel()).toBeTruthy()
    expect(findElement(tree, (node: any) => node.type === 'p'
      && node.props?.className === 'dshRemoteError' && node.props.role === 'alert')).toBeNull()
    expect(findElement(tree, (node: any) => node.type === 'button' && node.children.includes('retryLoginProviders'))).toBeTruthy()
    findElement(panel(), (node: any) => node.props?.type === 'email').props.onChange({ target: { value: ' user@example.com ' } })
    findElement(panel(), (node: any) => node.props?.type === 'password').props.onChange({ target: { value: 'secret' } })
    tree = login.render()
    const submit = () => findElement(panel(), (node: any) => node.type === 'button' && node.children.includes('startSignIn')).props.onClick()
    submit()
    tree = await login.settle()
    expect(findElement(tree, (node: any) => node.type === 'p' && node.props?.className === 'dshRemoteError'
      && node.props.role === 'alert')?.children).toContain('password rejected by server')
    expect(panel()).toBeTruthy()
    login.allowSubmit()
    submit()
    tree = await login.settle()
    expect(panel()).toBeNull()
    expect(login.control).toHaveBeenCalledWith(entrance === 'settings' ? 'settings.configure' : 'client.account.login',
      expect.objectContaining({ email: 'user@example.com', password: 'secret' }))
  })

  it('clears the previous server pairing capability after saving another server', async () => {
    const providers = vi.fn().mockResolvedValueOnce([{ id: 'zhihu', devicePairing: true }])
      .mockRejectedValue(new Error('new server provider network failed'))
    const login = await openLogin(providers)
    findElement(login.tree, (node: any) => node.props?.role === 'tab' && node.children.includes('pairingLoginTab')).props.onClick()
    let tree = login.render()
    findElement(tree, (node: any) => node.props?.className === 'dshRemoteServiceAddressEdit').props.onClick()
    tree = login.render()
    findElement(tree, (node: any) => node.props?.type === 'url').props.onChange({ target: { value: 'https://other.example.com' } })
    tree = login.render()
    findElement(tree, (node: any) => node.type === 'form' && node.props?.className === 'dshRemoteLoginServer').props.onSubmit({ preventDefault() {} })
    await login.settle()
    tree = await login.settle()
    expect(providers).toHaveBeenCalledTimes(2)
    expect(findElement(tree, (node: any) => node.props?.role === 'tab' && node.children.includes('pairingLoginTab'))).toBeNull()
    expect(findElement(tree, (node: any) => node.props?.role === 'tabpanel' && node.props?.id?.endsWith('password-panel'))).toBeTruthy()
  })

  it('unmounts pairing when another window changes server before discovery settles', async () => {
    let rejectDiscovery!: (reason: Error) => void
    const providers = vi.fn().mockResolvedValueOnce([{ id: 'zhihu', devicePairing: true }])
      .mockImplementation(() => new Promise((_, reject) => { rejectDiscovery = reject }))
    const login = await openLogin(providers)
    findElement(login.tree, (node: any) => node.props?.role === 'tab' && node.children.includes('pairingLoginTab')).props.onClick()
    let tree = login.render()
    expect(findElement(tree, (node: any) => node.props?.role === 'tabpanel' && node.props?.id?.endsWith('pairing-panel'))).toBeTruthy()
    login.pushServer('https://other.example.com')
    tree = await login.settle()
    expect(findElement(tree, (node: any) => node.props?.role === 'tabpanel' && node.props?.id?.endsWith('pairing-panel'))).toBeNull()
    tree = await login.settle()
    expect(providers).toHaveBeenCalledTimes(2)
    rejectDiscovery(new Error('new server provider network failed'))
    tree = await login.settle()
    expect(findElement(tree, (node: any) => node.props?.role === 'tab' && node.children.includes('pairingLoginTab'))).toBeNull()
    expect(findElement(tree, (node: any) => node.props?.role === 'tabpanel' && node.props?.id?.endsWith('password-panel'))).toBeTruthy()
  })

  it('retries discovery and keeps pairing selected while a later discovery fails', async () => {
    let rejectDiscovery!: (reason: Error) => void
    const providers = vi.fn().mockRejectedValueOnce(new Error('provider network failed'))
      .mockResolvedValueOnce([{ id: 'zhihu', displayName: 'Zhihu', devicePairing: true, qrStartUrl: 'https://example.com/qr' }])
      .mockImplementation(() => new Promise((_, reject) => { rejectDiscovery = reject }))
    const login = await openLogin(providers)
    findElement(login.tree, (node: any) => node.type === 'button' && node.children.includes('retryLoginProviders')).props.onClick()
    login.render()
    let tree = await login.settle()
    expect(providers).toHaveBeenCalledTimes(2)
    expect(findElement(tree, (node: any) => node.props?.role === 'tab' && node.props?.id?.includes('oauth:zhihu'))?.props['aria-selected']).toBe(true)
    login.props.preferredQrProvider = 'github'
    login.render()
    tree = login.render()
    findElement(tree, (node: any) => node.props?.role === 'tab' && node.children.includes('pairingLoginTab')).props.onClick()
    rejectDiscovery(new Error('later provider network failed'))
    tree = await login.settle()
    expect(providers).toHaveBeenCalledTimes(3)
    expect(findElement(tree, (node: any) => node.props?.role === 'tab' && node.children.includes('pairingLoginTab'))?.props['aria-selected']).toBe(true)
    expect(findElement(tree, (node: any) => node.props?.role === 'tabpanel' && node.props?.id?.endsWith('pairing-panel'))).toBeTruthy()
    expect(findElement(tree, (node: any) => node.props?.className === 'dshRemoteError' && node.props.role === 'alert')).toBeNull()
  })
})

describe('RemotePluginOptions inline sign-in suite', () => {
  it('toggles inline sign-in with accessible attributes without invoking props.onSignIn', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    const onSignInSpy = vi.fn()
    const controlSpy = vi.fn(async (endpoint: string) => {
      if (endpoint === 'settings.get') {
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: {},
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') return []
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const t = (k: string) => k
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({ control: controlSpy, statusFeed, onSignIn: onSignInSpy, t, view: 'page' })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    expect(toggleBtn).not.toBeNull()
    expect(toggleBtn.props['aria-expanded']).toBe(false)
    expect(toggleBtn.children[0]).toBe('signInAccount')

    // Click toggle button
    toggleBtn.props.onClick()
    expect(onSignInSpy).not.toHaveBeenCalled()

    tree = render()
    await new Promise(r => setTimeout(r, 10))
    tree = render()

    const openBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    expect(openBtn.props['aria-expanded']).toBe(true)
    expect(openBtn.children[0]).toBe('close')

    const inlineSection = findElement(tree, (n: any) => n.props?.id === 'dsh-remote-inline-signin')
    expect(inlineSection).not.toBeNull()

    // Clicking close button folds it back
    openBtn.props.onClick()
    expect(onSignInSpy).not.toHaveBeenCalled()

    tree = render()
    const closedBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    expect(closedBtn.props['aria-expanded']).toBe(false)
    expect(findElement(tree, (n: any) => n.props?.id === 'dsh-remote-inline-signin')).toBeNull()

    unmount()
  })

  it('completes account & password sign-in flow inline', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    const controlSpy = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') {
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: {},
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') return []
      if (endpoint === 'settings.configure') {
        return {
          status: 'authorized',
          role: 'client',
          settings: {
            config: { serverUrl: 'https://dsh.r2049.cn' },
            deviceName: 'test-device',
            writable: true,
            applies: 'restart',
            associations: { client: { method: 'account', account: 'tester@example.com' } },
          },
        }
      }
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({ control: controlSpy, statusFeed, t: (k: string) => k, view: 'page' })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    toggleBtn.props.onClick()

    tree = render()
    await new Promise(r => setTimeout(r, 10))
    tree = render()

    const inline = findElement(tree, (n: any) => n.props?.id === 'dsh-remote-inline-signin')
    const emailInput = findElement(inline, (n: any) => n.props?.type === 'email')
    const passwordInput = findElement(inline, (n: any) => n.props?.type === 'password')

    emailInput.props.onChange({ target: { value: 'tester@example.com' } })
    passwordInput.props.onChange({ target: { value: 'mypassword' } })

    tree = render()
    const activeInline = findElement(tree, (n: any) => n.props?.id === 'dsh-remote-inline-signin')
    const submitBtn = findElement(activeInline, (n: any) => n.type === 'button' && n.children?.[0] === 'startSignIn')

    submitBtn.props.onClick()
    await new Promise(r => setTimeout(r, 10))

    expect(controlSpy).toHaveBeenCalledWith('settings.configure', {
      role: 'client',
      serverUrl: 'https://dsh.r2049.cn',
      email: 'tester@example.com',
      password: 'mypassword',
    })

    tree = render()
    expect(findElement(tree, (n: any) => n.props?.className?.includes('dshRemoteAssociation'))).not.toBeNull()
    expect(findElement(tree, (n: any) => n.props?.id === 'dsh-remote-inline-signin')).toBeNull()

    unmount()
  })

  it('completes OAuth QR login and handles polling completion', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    let pollCount = 0

    const controlSpy = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') {
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: pollCount >= 2 ? { client: { method: 'account', account: 'qr-user@example.com' } } : {},
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') {
        return [{ id: 'zhihu', displayName: 'Zhihu', qrStartUrl: 'https://example.com/qr' }]
      }
      if (endpoint === 'client.account.qr.start') {
        return { qrId: 'qr-session-test-id-1234567890', scanUrl: 'https://example.com/scan', expiresIn: 120 }
      }
      if (endpoint === 'client.account.qr.poll') {
        pollCount++
        if (pollCount === 1) return { status: 'pending' }
        return { status: 'complete' }
      }
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({
        control: controlSpy,
        statusFeed,
        preferredQrProvider: 'zhihu',
        t: (k: string) => k,
        view: 'page',
      })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    toggleBtn.props.onClick()

    const { tree: qrTree, el: qrImg } = await waitForElement(render, (n: any) => n.type === 'img')
    tree = qrTree
    expect(controlSpy).toHaveBeenCalledWith('client.account.qr.start', { provider: 'zhihu' })
    expect(qrImg).not.toBeNull()

    // Wait for polling to hit complete
    await new Promise(r => setTimeout(r, 1550))
    // Render triggers the completion effect which fetches settings.get
    tree = render()
    await new Promise(r => setTimeout(r, 20))
    tree = render()

    expect(controlSpy).toHaveBeenCalledWith('client.account.qr.poll', { qrId: 'qr-session-test-id-1234567890' })
    expect(findElement(tree, (n: any) => n.props?.className?.includes('dshRemoteAssociation'))).not.toBeNull()

    unmount()
  })

  it('handles QR startup failure without extra provider discovery and recovers on retry', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    let startCalls = 0
    let providerCalls = 0

    const controlSpy = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') {
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: {},
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') {
        providerCalls++
        return [{ id: 'github', displayName: 'GitHub', qrStartUrl: 'https://github.com/login' }]
      }
      if (endpoint === 'client.account.qr.start') {
        startCalls++
        if (startCalls === 1) throw new Error('network down')
        return { qrId: 'qr-session-recovered-1234567890', scanUrl: 'https://github.com/scan', expiresIn: 120 }
      }
      if (endpoint === 'client.account.qr.poll') {
        return { status: 'pending' }
      }
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({
        control: controlSpy,
        statusFeed,
        preferredQrProvider: 'github',
        t: (k: string) => k,
        view: 'page',
      })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    toggleBtn.props.onClick()

    const { el: retryBtn } = await waitForElement(
      render,
      (n: any) => n.props?.className?.includes('dshRemoteReconnect') && n.children?.[0] === 'retryLoginProviders'
    )
    expect(startCalls).toBe(1)
    expect(providerCalls).toBe(1)
    expect(retryBtn).not.toBeNull()

    // Clicking retry button attempts QR start again WITHOUT re-fetching providers!
    retryBtn.props.onClick()

    const { el: qrImg } = await waitForElement(render, (n: any) => n.type === 'img')
    expect(qrImg).not.toBeNull()

    expect(providerCalls).toBe(1) // Providers was NOT re-fetched
    expect(startCalls).toBe(2)    // Exactly 1 new start attempt

    unmount()
  })

  it('handles QR expiration and refresh', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    let startCount = 0

    const controlSpy = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') {
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: {},
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') {
        return [{ id: 'zhihu', displayName: 'Zhihu', qrStartUrl: 'https://example.com/qr' }]
      }
      if (endpoint === 'client.account.qr.start') {
        startCount++
        return { qrId: `qr-session-${startCount}`, scanUrl: `https://example.com/scan/${startCount}`, expiresIn: 30 }
      }
      if (endpoint === 'client.account.qr.poll') {
        if (startCount === 1) return { status: 'expired' }
        return { status: 'pending' }
      }
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({
        control: controlSpy,
        statusFeed,
        preferredQrProvider: 'zhihu',
        t: (k: string) => k,
        view: 'page',
      })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    toggleBtn.props.onClick()

    const { el: qrImg1 } = await waitForElement(render, (n: any) => n.type === 'img')
    expect(qrImg1).not.toBeNull()
    expect(startCount).toBe(1)

    // Wait for poll to return expired and refresh button to appear
    const { el: refreshBtn } = await waitForElement(
      render,
      (n: any) => n.props?.className?.includes('dshRemoteReconnect') && n.children?.[0] === 'refreshQrCode',
      4000
    )
    expect(refreshBtn).not.toBeNull()

    // Click refresh QR code
    refreshBtn.props.onClick()

    const { el: qrImg2 } = await waitForElement(render, (n: any) => n.type === 'img')
    expect(qrImg2).not.toBeNull()
    expect(startCount).toBe(2)

    unmount()
  })

  it('cancels polling and rejects late state updates when closing inline sign-in', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    let lateResolve: ((value: any) => void) | undefined

    const controlSpy = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') {
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: {},
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') {
        return [{ id: 'zhihu', displayName: 'Zhihu', qrStartUrl: 'https://example.com/qr' }]
      }
      if (endpoint === 'client.account.qr.start') {
        return { qrId: 'qr-session-closing-test', scanUrl: 'https://example.com/scan', expiresIn: 120 }
      }
      if (endpoint === 'client.account.qr.poll') {
        return new Promise(resolve => { lateResolve = resolve })
      }
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({
        control: controlSpy,
        statusFeed,
        preferredQrProvider: 'zhihu',
        t: (k: string) => k,
        view: 'page',
      })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    toggleBtn.props.onClick()

    tree = render()
    await new Promise(r => setTimeout(r, 20))
    tree = render()
    await new Promise(r => setTimeout(r, 30))
    tree = render()

    // Close the section while polling is outstanding
    const openBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    openBtn.props.onClick()

    tree = render()
    expect(findElement(tree, (n: any) => n.props?.id === 'dsh-remote-inline-signin')).toBeNull()

    // Late poll resolution must not throw or resurrect association
    if (lateResolve) lateResolve({ status: 'complete' })
    await new Promise(r => setTimeout(r, 20))

    tree = render()
    expect(findElement(tree, (n: any) => n.props?.className?.includes('dshRemoteAssociation'))).toBeNull()

    unmount()
  })

  it('preserves completed QR authorization when settings.get transiently fails and retries without new QR session', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    let startCalls = 0
    let providerCalls = 0
    let settingsGetCalls = 0
    let settingsGetShouldFail = true

    const controlSpy = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'client.account.providers') {
        providerCalls++
        return [{ id: 'zhihu', displayName: 'Zhihu', qrStartUrl: 'https://example.com/qr' }]
      }
      if (endpoint === 'settings.get') {
        settingsGetCalls++
        if (settingsGetCalls === 1) {
          // initial load
          return {
            config: { serverUrl: 'https://dsh.r2049.cn' },
            deviceName: 'test-device',
            writable: true,
            applies: 'restart',
            associations: {},
          } as PluginSettingsView
        }
        if (settingsGetShouldFail) {
          throw new Error('transient settings network failure')
        }
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: { client: { method: 'account', account: 'authorized-qr@example.com' } },
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') {
        return [{ id: 'zhihu', displayName: 'Zhihu', qrStartUrl: 'https://example.com/qr' }]
      }
      if (endpoint === 'client.account.qr.start') {
        startCalls++
        return { qrId: 'qr-session-auth-preserved-1234567890', scanUrl: 'https://example.com/scan', expiresIn: 120 }
      }
      if (endpoint === 'client.account.qr.poll') {
        return { status: 'complete' }
      }
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({
        control: controlSpy,
        statusFeed,
        preferredQrProvider: 'zhihu',
        t: (k: string) => k,
        view: 'page',
      })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    toggleBtn.props.onClick()

    const { el: qrImg } = await waitForElement(render, (n: any) => n.type === 'img')
    expect(qrImg).not.toBeNull()
    expect(startCalls).toBe(1)

    // Wait for poll completion -> triggers settings.get which will fail -> shows retry button
    const { el: retryBtn } = await waitForElement(
      render,
      (n: any) => n.props?.className?.includes('dshRemoteReconnect') && n.children?.[0] === 'retryLoginProviders',
      4000
    )
    expect(startCalls).toBe(1)
    expect(retryBtn).not.toBeNull()

    // Now resolve settings.get successfully on retry
    settingsGetShouldFail = false
    retryBtn.props.onClick()

    const { tree: assocTree, el: assoc } = await waitForElement(render, (n: any) => n.props?.className?.includes('dshRemoteAssociation'))
    expect(assoc).not.toBeNull()

    // Verified: startCalls is STILL exactly 1 and provider discovery was NOT rerun!
    expect(startCalls).toBe(1)
    expect(providerCalls).toBe(1)
    expect(findElement(assocTree, (n: any) => n.props?.id === 'dsh-remote-inline-signin')).toBeNull()

    unmount()
  })

  it('handles provider discovery failure and recovers when reopened', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    let providerCalls = 0

    const controlSpy = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') {
        return {
          config: { serverUrl: 'https://dsh.r2049.cn' },
          deviceName: 'test-device',
          writable: true,
          applies: 'restart',
          associations: {},
        } as PluginSettingsView
      }
      if (endpoint === 'status') {
        return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      }
      if (endpoint === 'client.account.providers') {
        providerCalls++
        if (providerCalls === 1) throw new Error('failed loading providers')
        return [{ id: 'zhihu', displayName: 'Zhihu', qrStartUrl: 'https://example.com/qr' }]
      }
      if (endpoint === 'client.account.qr.start') {
        return { qrId: 'qr-session-providers-recovered', scanUrl: 'https://example.com/scan', expiresIn: 120 }
      }
      return {}
    })

    const statusFeed = { subscribe: vi.fn(() => () => {}), close: vi.fn(), getSnapshot: () => undefined } as any
    const Component = createRemotePluginOptions(React) as any
    const render = () => {
      resetRender()
      return Component({
        control: controlSpy,
        statusFeed,
        preferredQrProvider: 'zhihu',
        t: (k: string) => k,
        view: 'page',
      })
    }

    render()
    await new Promise(r => setTimeout(r, 10))
    let tree = render()

    const toggleBtn = findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin')
    toggleBtn.props.onClick()

    await new Promise(r => setTimeout(r, 10))
    const failedTree = render()
    expect(providerCalls).toBe(1)
    expect(findElement(failedTree, (n: any) => n.props?.type === 'password')).not.toBeNull()

    // Discovery retries when the login panel is reopened; no separate retry control.
    findElement(failedTree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin').props.onClick()
    tree = render()
    findElement(tree, (n: any) => n.props?.['aria-controls'] === 'dsh-remote-inline-signin').props.onClick()

    const { tree: qrTree, el: qrImg } = await waitForElement(render, (n: any) => n.type === 'img')
    expect(qrImg).not.toBeNull()
    expect(findElement(qrTree, (n: any) => n.props?.type === 'password')).toBeNull()

    // Flat password tab switches to password form and can return to QR tab
    const passwordTab = findElement(qrTree, (n: any) => n.props?.id === 'dsh-remote-settings-password-tab')
    expect(passwordTab).not.toBeNull()
    passwordTab.props.onClick()
    tree = render()
    expect(findElement(tree, (n: any) => n.props?.type === 'password')).not.toBeNull()
    expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePasswordHint')?.children?.[0]).toBe('passwordHint')

    const qrTab = findElement(tree, (n: any) => n.props?.id === 'dsh-remote-settings-oauth:zhihu-tab')
    expect(qrTab).not.toBeNull()
    qrTab.props.onClick()
    const { el: qrImgAgain } = await waitForElement(render, (n: any) => n.type === 'img')
    expect(qrImgAgain).not.toBeNull()

    expect(providerCalls).toBe(2)

    unmount()
  })

})

describe('HostPairingPanel completion and polling lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hydrates once when idle, stops polling in completed state, keeps pairingDone across disabled toggles, and retries failed onComplete', async () => {
    vi.useFakeTimers()
    const { React, resetRender, unmount } = createTestHarness()
    let statusCalls = 0
    let state: 'idle' | 'created' | 'claimed' | 'completed' = 'idle'
    const session = {
      sessionId: '019a0000-0000-7000-8000-000000000099',
      expiresAt: Date.now() + 180_000,
      serverUrl: 'https://dsh.r2049.cn',
      hostFingerprint: 'host-fp',
      canRetry: false,
      localSaved: false,
    }
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'host.pairing.status') {
        statusCalls += 1
        if (state === 'idle' || state === 'completed') return undefined
        if (state === 'created') return { ...session, state: 'created', qrPayload: 'https://dsh.r2049.cn/pair#v1.abc' }
        return { ...session, state: 'claimed', mobile: { deviceId: 'phone-1', name: 'Pixel', fingerprint: 'phone-fp' } }
      }
      if (endpoint === 'host.pairing.start') {
        state = 'created'
        return { ...session, state: 'created', qrPayload: 'https://dsh.r2049.cn/pair#v1.abc' }
      }
      if (endpoint === 'host.pairing.confirm') {
        state = 'completed'
        return {
          ...session,
          state: 'completed',
          localSaved: true,
          mobile: { deviceId: 'phone-1', name: 'Pixel', fingerprint: 'phone-fp' },
        }
      }
      return undefined
    })

    let failComplete = true
    const onComplete = vi.fn(async () => {
      if (failComplete) throw new Error('refresh failed')
    })

    let disabled = false
    const Panel = createHostPairingPanel(React) as any
    const render = () => {
      resetRender()
      return Panel({
        control,
        serverUrl: 'https://dsh.r2049.cn',
        disabled,
        t: (k: string) => k,
        onComplete,
      })
    }

    try {
      let tree = render()
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(statusCalls).toBe(1)
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingHint')
      const startBtn = findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingStart'))
      expect(startBtn).not.toBeNull()

      await vi.advanceTimersByTimeAsync(6000)
      expect(statusCalls).toBe(1)

      startBtn.props.onClick()
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      state = 'claimed'
      await vi.advanceTimersByTimeAsync(2500)
      tree = render()
      expect(statusCalls).toBe(2)

      const codeInput = findElement(tree, (n: any) => n.type === 'input' && n.props?.maxLength === 8)
      codeInput.props.onChange({ target: { value: '12345678' } })
      tree = render()
      const codeForm = findElement(tree, (n: any) => n.type === 'form' && n.props?.className === 'dshRemotePairingCodeForm')
      codeForm.props.onSubmit({ preventDefault() {}, nativeEvent: { isTrusted: true } })
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(onComplete).toHaveBeenCalledTimes(1)
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingComplete')
      expect(findElement(tree, (n: any) => n.props?.role === 'alert')?.children).toContain('refresh failed')
      expect(findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingStart'))).toBeNull()
      const doneBtn = findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingDone'))
      expect(doneBtn).not.toBeNull()

      const statusAtComplete = statusCalls
      disabled = true
      tree = render()
      disabled = false
      tree = render()
      await vi.advanceTimersByTimeAsync(6000)
      tree = render()
      expect(statusCalls).toBe(statusAtComplete)
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingComplete')

      failComplete = false
      findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingDone')).props.onClick()
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(onComplete).toHaveBeenCalledTimes(2)
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingHint')
      expect(findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingStart'))).not.toBeNull()
      expect(findElement(tree, (n: any) => n.props?.role === 'alert')).toBeNull()
    } finally {
      unmount()
    }
  })

  it('coalesces pairingDone with an in-flight auto onComplete and drops stale rejection after reset', async () => {
    vi.useFakeTimers()
    const { React, resetRender, unmount } = createTestHarness()
    let rejectFirst!: (reason?: unknown) => void
    let resolveSecond!: () => void
    let call = 0
    const onComplete = vi.fn(() => {
      call += 1
      if (call === 1) return new Promise<void>((_, reject) => { rejectFirst = reject })
      return new Promise<void>((resolve) => { resolveSecond = resolve })
    })
    const session = {
      sessionId: '019a0000-0000-7000-8000-000000000100',
      expiresAt: Date.now() + 180_000,
      serverUrl: 'https://dsh.r2049.cn',
      hostFingerprint: 'host-fp',
      canRetry: false,
      localSaved: false,
    }
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'host.pairing.status') return { ...session, state: 'claimed', mobile: { deviceId: 'phone-1', name: 'Pixel', fingerprint: 'phone-fp' } }
      return { ...session, state: 'completed', localSaved: true, mobile: { deviceId: 'phone-1', name: 'Pixel', fingerprint: 'phone-fp' } }
    })
    const Panel = createHostPairingPanel(React) as any
    const render = () => {
      resetRender()
      return Panel({ control, serverUrl: 'https://dsh.r2049.cn', disabled: false, t: (k: string) => k, onComplete })
    }
    try {
      let tree = render()
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      const codeInput = findElement(tree, (n: any) => n.type === 'input' && n.props?.maxLength === 8)
      codeInput.props.onChange({ target: { value: '12345678' } })
      tree = render()
      findElement(tree, (n: any) => n.type === 'form' && n.props?.className === 'dshRemotePairingCodeForm').props.onSubmit({
        preventDefault() {}, nativeEvent: { isTrusted: true },
      })
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(onComplete).toHaveBeenCalledTimes(1)

      findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingDone')).props.onClick()
      await vi.advanceTimersByTimeAsync(0)
      expect(onComplete).toHaveBeenCalledTimes(1)

      rejectFirst(new Error('late auto error'))
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(findElement(tree, (n: any) => n.props?.role === 'alert')?.children).toContain('late auto error')

      findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingDone')).props.onClick()
      expect(onComplete).toHaveBeenCalledTimes(2)
      resolveSecond()
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingHint')
      expect(findElement(tree, (n: any) => n.props?.role === 'alert')).toBeNull()
    } finally {
      unmount()
    }
  })

  it('surfaces explicit error alerts for failureReason and pairing error codes, and handles add mode + onDone', async () => {
    vi.useFakeTimers()
    const { React, resetRender, unmount } = createTestHarness()
    let mode: 'sign-in' | 'add' = 'add'
    let statusResponse: any
    let startError: any
    let completeError: Error | undefined
    const onDone = vi.fn()
    const onComplete = vi.fn(async () => {
      if (completeError) throw completeError
    })
    const baseSession = {
      sessionId: '019a0000-0000-7000-8000-000000000200',
      expiresAt: Date.now() + 180_000,
      serverUrl: 'https://dsh.r2049.cn',
      hostFingerprint: 'host-fp',
      canRetry: false,
      localSaved: false,
    }
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'host.pairing.status') return statusResponse
      if (endpoint === 'host.pairing.start') {
        if (startError) throw startError
        return { ...baseSession, state: 'created', qrPayload: 'https://dsh.r2049.cn/pair#v1.xyz' }
      }
      if (endpoint === 'host.pairing.confirm') {
        return { ...baseSession, state: 'completed', localSaved: true, mobile: { deviceId: 'phone-2', name: 'Phone 2', fingerprint: 'fp-2' } }
      }
      return undefined
    })

    const Panel = createHostPairingPanel(React) as any
    const render = () => {
      resetRender()
      return Panel({
        control,
        serverUrl: 'https://dsh.r2049.cn',
        disabled: false,
        mode,
        t: (k: string) => k,
        onComplete,
        onDone,
      })
    }

    try {
      for (const [failureReason, expectedKey] of [
        ['PAIRING_ACCOUNT_CONFLICT', 'pairingAccountConflict'],
        ['HOST_DEVICE_LIMIT_REACHED', 'pairingHostDeviceLimitReached'],
        ['verification_failed', 'pairingVerificationFailed'],
      ] as const) {
        statusResponse = { ...baseSession, state: 'failed', failureReason }
        const harness = createTestHarness()
        const LocalPanel = createHostPairingPanel(harness.React) as any
        const renderLocal = () => {
          harness.resetRender()
          return LocalPanel({ control, serverUrl: 'https://dsh.r2049.cn', disabled: false, mode: 'add', t: (k: string) => k, onComplete })
        }
        renderLocal()
        await vi.advanceTimersByTimeAsync(0)
        const failedTree = renderLocal()
        expect(findElement(failedTree, (n: any) => n.props?.role === 'alert')?.children).toContain(expectedKey)
        harness.unmount()
      }

      statusResponse = undefined
      let tree = render()
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingAddHint')

      for (const [errorObj, expectedKey] of [
        [Object.assign(new Error('unsupported'), { code: 'PAIRING_UNSUPPORTED' }), 'pairingUnsupported'],
        [Object.assign(new Error('conflict'), { details: { remoteCode: 'PAIRING_ACCOUNT_CONFLICT' } }), 'pairingAccountConflict'],
        [Object.assign(new Error('limit'), { code: 'HOST_DEVICE_LIMIT_REACHED' }), 'pairingHostDeviceLimitReached'],
        [Object.assign(new Error('device conflict'), { details: { remoteCode: 'PAIRING_DEVICE_CONFLICT' } }), 'pairingDeviceConflict'],
      ] as const) {
        startError = errorObj
        findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingStart')).props.onClick()
        await vi.advanceTimersByTimeAsync(0)
        tree = render()
        expect(findElement(tree, (n: any) => n.props?.role === 'alert')?.children).toContain(expectedKey)
      }

      startError = undefined
      findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingStart')).props.onClick()
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingAddScan')

      statusResponse = { ...baseSession, state: 'claimed', mobile: { deviceId: 'phone-2', name: 'Phone 2', fingerprint: 'fp-2' } }
      await vi.advanceTimersByTimeAsync(2500)
      tree = render()
      findElement(tree, (n: any) => n.type === 'input' && n.props?.maxLength === 8).props.onChange({ target: { value: '87654321' } })
      tree = render()
      completeError = new Error('transient refresh error')
      findElement(tree, (n: any) => n.type === 'form' && n.props?.className === 'dshRemotePairingCodeForm').props.onSubmit({
        preventDefault() {}, nativeEvent: { isTrusted: true },
      })
      await vi.advanceTimersByTimeAsync(0)
      tree = render()
      expect(findElement(tree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingAddComplete')
      expect(onDone).not.toHaveBeenCalled()

      // Failing finish must not invoke onDone; succeeding finish invokes onDone.
      findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingDone')).props.onClick()
      await vi.advanceTimersByTimeAsync(0)
      expect(onDone).not.toHaveBeenCalled()

      completeError = undefined
      findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingDone')).props.onClick()
      await vi.advanceTimersByTimeAsync(0)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })
})

describe.each(['settings', 'workspace'] as const)('%s signed-in DSH Go device pairing', entrance => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    cleanups.splice(0).forEach(cleanup => cleanup())
    vi.unstubAllGlobals()
  })

  async function openSignedIn(options: {
    pairingHostOnly?: boolean
    authorized?: boolean
    accountRequired?: boolean
    providers?: ReturnType<typeof vi.fn>
    serverUrl?: string
  } = {}) {
    const { React, resetRender, unmount } = createTestHarness()
    cleanups.push(unmount)
    vi.stubGlobal('window', {
      requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      setInterval: vi.fn(), clearInterval: vi.fn(),
    })
    vi.stubGlobal('document', { documentElement: { classList: { toggle: vi.fn(), remove: vi.fn() } } })

    const pairingHostOnly = options.pairingHostOnly ?? true
    const authorized = options.authorized ?? true
    const accountRequired = options.accountRequired ?? false
    let serverUrl = options.serverUrl ?? 'https://dsh.r2049.cn'
    const providers = options.providers ?? vi.fn(async () => [{ id: 'dsh-go-pairing-v1', devicePairing: true }])
    const listeners = new Set<(status: any) => void>()

    const makeSettings = (): PluginSettingsView => ({
      config: { serverUrl },
      deviceName: 'test-host',
      writable: true,
      applies: 'restart',
      associations: {
        ...(pairingHostOnly ? {} : { client: { method: 'account', account: 'user@example.com' } }),
        host: { method: pairingHostOnly ? 'device_pairing' : 'account', account: pairingHostOnly ? 'dsh-device:1' : 'user@example.com' },
      },
    })
    const makeStatus = () => ({
      mode: 'local',
      available: true,
      serverUrl,
      hostAuthorizationAvailable: true,
      host: {
        deviceId: 'host-1',
        configured: true,
        online: true,
        reconnecting: false,
        authorized,
        accountRequired,
        pairingHostOnly,
        connectedClients: [],
      },
    })

    let pairingState: 'idle' | 'created' | 'claimed' | 'completed' = 'idle'
    const session = {
      sessionId: '019a0000-0000-7000-8000-000000000300',
      expiresAt: Date.now() + 180_000,
      serverUrl,
      hostFingerprint: 'host-fp',
      canRetry: false,
      localSaved: false,
    }
    const control = vi.fn(async (endpoint: string) => {
      if (endpoint === 'settings.get') return makeSettings()
      if (endpoint === 'status') return makeStatus()
      if (endpoint === 'client.authorization.status') return { hasCredentials: true }
      if (endpoint === 'devices') return []
      if (endpoint === 'client.account.providers') return providers()
      if (endpoint === 'host.pairing.status') {
        if (pairingState === 'created') return { ...session, state: 'created', qrPayload: `${serverUrl}/pair#v1.abc` }
        if (pairingState === 'claimed') return { ...session, state: 'claimed', mobile: { deviceId: 'phone-2', name: 'Phone 2', fingerprint: 'fp-2' } }
        return undefined
      }
      if (endpoint === 'host.pairing.start') {
        pairingState = 'created'
        return { ...session, state: 'created', qrPayload: `${serverUrl}/pair#v1.abc` }
      }
      if (endpoint === 'host.pairing.confirm') {
        pairingState = 'completed'
        return {
          ...session,
          state: 'completed',
          localSaved: true,
          mobile: { deviceId: 'phone-2', name: 'Phone 2', fingerprint: 'fp-2' },
        }
      }
      return {}
    })

    const Component = (entrance === 'settings' ? createRemotePluginOptions(React) : createRemoteWorkspaceAction(React)) as any
    const props = {
      control,
      statusFeed: {
        subscribe: (listener: (next: any) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        getSnapshot: () => undefined,
      },
      t: (key: string) => key,
      view: 'page',
      wide: true,
      preferredQrProvider: 'zhihu',
      subscribeOpen: () => () => {},
      sidebarEntry: { read: () => 'standard', subscribe: () => () => {}, publish: () => {} },
    }
    const render = () => { resetRender(); return Component(props) }
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 10)); return render() }

    render()
    let tree = await settle()
    if (entrance === 'workspace') {
      findElement(tree, (n: any) => n.props?.className === 'dshRemoteModeButton').props.onClick()
      render()
      tree = await settle()
      tree = await settle()
    } else {
      tree = await settle()
    }

    return {
      render,
      settle,
      tree,
      control,
      providers,
      claimPhone: () => { pairingState = 'claimed' },
      pushServer: (nextServerUrl: string) => {
        serverUrl = nextServerUrl
        listeners.forEach(listener => listener(makeStatus()))
      },
    }
  }

  it.each([
    { label: 'pairingHostOnly', pairingHostOnly: true },
    { label: 'standard authorized host', pairingHostOnly: false },
  ])('discovers devicePairing once and pairs another device without logout ($label)', async ({ pairingHostOnly }) => {
    const providers = vi.fn(async () => [{ id: 'dsh-go-pairing-v1', devicePairing: true }])
    const view = await openSignedIn({ pairingHostOnly, providers })

    let tree = view.render()
    tree = await view.settle()
    expect(providers).toHaveBeenCalledTimes(1)

    const addButton = findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingAddButton'))
    expect(addButton).not.toBeNull()
    expect(addButton.props['aria-expanded']).toBe(false)

    addButton.props.onClick()
    tree = view.render()
    tree = await view.settle()
    const addPanelContainer = findElement(tree, (n: any) => n.props?.id?.endsWith('-add-pairing'))
    expect(addPanelContainer).not.toBeNull()
    const addPanel = findElement(addPanelContainer, (n: any) => typeof n.type === 'function' && n.props?.mode === 'add')
    expect(addPanel).not.toBeNull()
    expect(addPanel.props).toMatchObject({
      serverUrl: 'https://dsh.r2049.cn',
      disabled: false,
      mode: 'add',
    })

    const panelHarness = createTestHarness()
    cleanups.push(panelHarness.unmount)
    const MountedPanel = createHostPairingPanel(panelHarness.React) as any
    const renderPanel = () => {
      panelHarness.resetRender()
      const currentProps = findElement(view.render(), (n: any) => typeof n.type === 'function' && n.props?.mode === 'add')?.props ?? addPanel.props
      return MountedPanel(currentProps)
    }

    renderPanel()
    let panelTree = await (async () => { await new Promise(resolve => setTimeout(resolve, 10)); return renderPanel() })()
    expect(findElement(panelTree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingAddHint')

    findElement(panelTree, (n: any) => n.type === 'button' && n.children?.includes('pairingStart')).props.onClick()
    await new Promise(resolve => setTimeout(resolve, 10))
    panelTree = renderPanel()
    expect(findElement(panelTree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingAddScan')

    const statusCallsBefore = view.control.mock.calls.filter(([ep]) => ep === 'settings.get' || ep === 'status').length
    view.claimPhone()
    const { el: codeInput } = await waitForElement(renderPanel, (n: any) => n.type === 'input' && n.props?.maxLength === 8, 4000)
    expect(codeInput).not.toBeNull()
    codeInput.props.onChange({ target: { value: '12345678' } })
    panelTree = renderPanel()
    findElement(panelTree, (n: any) => n.type === 'form' && n.props?.className === 'dshRemotePairingCodeForm').props.onSubmit({
      preventDefault() {}, nativeEvent: { isTrusted: true },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    panelTree = renderPanel()
    tree = await view.settle()

    expect(view.control).toHaveBeenCalledWith('host.pairing.confirm', {
      sessionId: '019a0000-0000-7000-8000-000000000300',
      verificationCode: '12345678',
    })
    expect(view.control).not.toHaveBeenCalledWith('settings.logout', expect.anything())
    expect(findElement(panelTree, (n: any) => n.props?.className === 'dshRemotePairingInstructionPrimary')?.children).toContain('pairingAddComplete')
    expect(findElement(tree, (n: any) => n.props?.className === 'dshRemoteNotice' && n.children?.includes('pairingAddSuccessNotice'))).not.toBeNull()
    const statusCallsAfter = view.control.mock.calls.filter(([ep]) => ep === 'settings.get' || ep === 'status').length
    expect(statusCallsAfter).toBeGreaterThan(statusCallsBefore)

    findElement(panelTree, (n: any) => n.type === 'button' && n.children?.includes('pairingDone')).props.onClick()
    await new Promise(resolve => setTimeout(resolve, 10))
    tree = await view.settle()
    expect(findElement(tree, (n: any) => n.props?.id?.endsWith('-add-pairing'))).toBeNull()
    expect(findElement(tree, (n: any) => n.props?.['aria-controls']?.endsWith('-add-pairing'))?.props['aria-expanded']).toBe(false)
  }, 10_000)

  it('hides add-pairing entry when capability is missing, discovery fails, or Host is unauthorized, and resets on server switch', async () => {
    // 1. Missing devicePairing capability
    const missingProviders = vi.fn(async () => [{ id: 'github', displayName: 'GitHub', qrStartUrl: 'https://example.com/qr' }])
    const missingView = await openSignedIn({ providers: missingProviders })
    expect(findElement(missingView.tree, (n: any) => n.type === 'button' && n.children?.includes('pairingAddButton'))).toBeNull()
    expect(missingProviders).toHaveBeenCalledTimes(1)

    // 2. Discovery fails (no retry loop)
    const failingProviders = vi.fn(async () => { throw new Error('network failed') })
    const failingView = await openSignedIn({ providers: failingProviders })
    await failingView.settle()
    expect(findElement(failingView.tree, (n: any) => n.type === 'button' && n.children?.includes('pairingAddButton'))).toBeNull()
    expect(failingProviders).toHaveBeenCalledTimes(1)

    // 3. Client signed in but Host is unauthorized or requires account
    for (const hostState of [{ authorized: false, accountRequired: false }, { authorized: true, accountRequired: true }]) {
      const hostProviders = vi.fn(async () => [{ id: 'dsh-go-pairing-v1', devicePairing: true }])
      const unauthorizedView = await openSignedIn({ pairingHostOnly: false, ...hostState, providers: hostProviders })
      expect(findElement(unauthorizedView.tree, (n: any) => n.type === 'button' && n.children?.includes('pairingAddButton'))).toBeNull()
      expect(hostProviders).not.toHaveBeenCalled()
    }

    // 4. Server switch via statusFeed clears capability and collapses open add-pairing panel
    const switchProviders = vi.fn()
      .mockResolvedValueOnce([{ id: 'dsh-go-pairing-v1', devicePairing: true }])
      .mockResolvedValueOnce([])
    const switchView = await openSignedIn({ providers: switchProviders })
    findElement(switchView.tree, (n: any) => n.type === 'button' && n.children?.includes('pairingAddButton')).props.onClick()
    let tree = await switchView.settle()
    expect(findElement(tree, (n: any) => n.props?.id?.endsWith('-add-pairing'))).not.toBeNull()

    switchView.pushServer('https://other.example.com')
    await switchView.settle()
    tree = await switchView.settle()
    expect(switchProviders).toHaveBeenCalledTimes(2)
    expect(findElement(tree, (n: any) => n.props?.id?.endsWith('-add-pairing'))).toBeNull()
    expect(findElement(tree, (n: any) => n.type === 'button' && n.children?.includes('pairingAddButton'))).toBeNull()
  })
})
