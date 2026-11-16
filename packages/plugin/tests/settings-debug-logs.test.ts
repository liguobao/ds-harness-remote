import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemotePluginOptions } from '../src/client/settings.js'
import type { ClientReact, PluginLogEntry, PluginLogView, PluginSettingsView } from '../src/client/types.js'

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
        if (typeof effectCleanups[slot] === 'function') effectCleanups[slot]!()
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
    useSyncExternalStore(_subscribe: any, getSnapshot: any) {
      return typeof getSnapshot === 'function' ? getSnapshot() : undefined
    },
  }

  return {
    React,
    resetRender: () => { stateIndex = 0; effectIndex = 0 },
    unmount: () => {
      for (const cleanup of effectCleanups) {
        if (typeof cleanup === 'function') cleanup()
      }
      effectCleanups = []
    },
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

describe('settings debug log entry and drawer', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    cleanups.splice(0).forEach(fn => fn())
    vi.unstubAllGlobals()
  })

  it('expands logs from the Debug logging entry, filters, switches debug level, and clears', async () => {
    const { React, resetRender, unmount } = createTestHarness()
    cleanups.push(unmount)
    vi.stubGlobal('window', {
      requestAnimationFrame: vi.fn(), cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })

    let logLevel: 'info' | 'debug' = 'info'
    let entries: PluginLogEntry[] = [
      { seq: 1, timestamp: '2026-11-13T10:00:00.000Z', level: 'info' as const, line: '2026-11-13T10:00:00.000Z [INFO] [ds-harness-remote] host ready' },
      { seq: 2, timestamp: '2026-11-13T10:00:01.000Z', level: 'warn' as const, line: '2026-11-13T10:00:01.000Z [WARN] [ds-harness-remote] ice fallback' },
    ]
    const settingsView = (): PluginSettingsView => ({
      config: { logLevel, terminal: { enabled: true }, remoteTools: { enabled: true } },
      deviceName: 'test-host',
      writable: true,
      applies: 'live',
      associations: {},
    })

    const control = vi.fn(async (endpoint: string, payload?: any) => {
      if (endpoint === 'settings.get') return settingsView()
      if (endpoint === 'status') return { mode: 'local', available: false, hostAuthorizationAvailable: true }
      if (endpoint === 'settings.development.set') {
        logLevel = payload.debugLogging ? 'debug' : 'info'
        if (payload.debugLogging) {
          entries = [
            ...entries,
            { seq: 3, timestamp: '2026-11-13T10:00:02.000Z', level: 'debug' as const, line: '2026-11-13T10:00:02.000Z [DEBUG] [ds-harness-remote] verbose enabled' },
          ]
        }
        return settingsView()
      }
      if (endpoint === 'settings.logs.get') {
        const filtered = payload?.filter === 'warn'
          ? entries.filter(item => item.level === 'warn' || item.level === 'error')
          : entries
        const view: PluginLogView = {
          logLevel,
          entries: filtered,
          totalBuffered: entries.length,
          filePath: 'D:\\dsh\\logs\\ds-harness-remote\\desktop.log',
        }
        return view
      }
      if (endpoint === 'settings.logs.clear') {
        entries = []
        const view: PluginLogView = {
          logLevel,
          entries: [],
          totalBuffered: 0,
          filePath: 'D:\\dsh\\logs\\ds-harness-remote\\desktop.log',
        }
        return view
      }
      return {}
    })

    const Component = createRemotePluginOptions(React) as any
    const props = {
      control,
      statusFeed: { subscribe: () => () => {}, getSnapshot: () => undefined },
      t: (key: string, params?: Record<string, string | number>) => params ? `${key}:${JSON.stringify(params)}` : key,
      view: 'page',
      sidebarEntry: { read: () => 'standard', subscribe: () => () => {}, publish: () => {} },
    }
    const render = () => { resetRender(); return Component(props) }
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); return render() }

    render()
    let tree = await settle()

    expect(findElement(tree, n => n.props?.className === 'dshRemoteLogDrawer')).toBeNull()
    expect(control).not.toHaveBeenCalledWith('settings.logs.get', expect.anything())

    const toggleBtn = findElement(tree, n => n.props?.className === 'dshRemoteLogToggleBtn')
    expect(toggleBtn).not.toBeNull()
    toggleBtn.props.onClick()
    tree = await settle()

    const drawer = findElement(tree, n => n.props?.className === 'dshRemoteLogDrawer')
    expect(drawer).not.toBeNull()
    expect(textContent(drawer)).toContain('host ready')
    expect(textContent(drawer)).toContain('desktop.log')

    const warnBtn = findElement(drawer, n => n.type === 'button' && textContent(n) === 'debugLogsFilterWarn')
    warnBtn.props.onClick()
    tree = await settle()
    const drawerWarn = findElement(tree, n => n.props?.className === 'dshRemoteLogDrawer')
    expect(textContent(drawerWarn)).not.toContain('host ready')
    expect(textContent(drawerWarn)).toContain('ice fallback')

    const allBtn = findElement(drawerWarn, n => n.type === 'button' && textContent(n) === 'debugLogsFilterAll')
    allBtn.props.onClick()
    tree = await settle()

    const debugSwitch = findElement(tree, n => n.type === 'input' && n.props?.role === 'switch' && n.props?.['aria-label'] === 'debugLogging')
    debugSwitch.props.onChange({ target: { checked: true } })
    tree = await settle()
    tree = await settle()

    const drawerAfterDebug = findElement(tree, n => n.props?.className === 'dshRemoteLogDrawer')
    expect(textContent(drawerAfterDebug)).toContain('verbose enabled')

    const clearBtn = findElement(drawerAfterDebug, n => n.type === 'button' && textContent(n) === 'debugLogsClear')
    clearBtn.props.onClick()
    tree = await settle()
    const drawerCleared = findElement(tree, n => n.props?.className === 'dshRemoteLogDrawer')
    expect(textContent(drawerCleared)).toContain('debugLogsEmpty')
  })
})