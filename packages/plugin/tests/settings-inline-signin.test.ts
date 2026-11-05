import { describe, expect, it, vi } from 'vitest'
import { createRemotePluginOptions } from '../src/client/settings.js'
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
  if (node.children) {
    for (const child of node.children) {
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
    const submitBtn = findElement(activeInline, (n: any) => n.type === 'button' && n.props?.onClick)

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

  it('handles provider discovery failure and recovers on retry', async () => {
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

    const { el: retryBtn } = await waitForElement(
      render,
      (n: any) => n.props?.className?.includes('dshRemoteReconnect') && n.children?.[0] === 'retryLoginProviders'
    )
    expect(providerCalls).toBe(1)
    expect(retryBtn).not.toBeNull()

    // Clicking retry button restarts provider discovery
    retryBtn.props.onClick()

    const { el: qrImg } = await waitForElement(render, (n: any) => n.type === 'img')
    expect(qrImg).not.toBeNull()

    expect(providerCalls).toBe(2)

    unmount()
  })
})
