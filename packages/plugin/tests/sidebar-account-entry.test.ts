import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  accountRowRetry,
  accountRowSelectors,
  findAccountRow,
  mountAccountEntry,
} from '../src/client/account-entry.js'
import { createRemoteWorkspaceAction } from '../src/client/workspaces.js'
import type { ClientReact } from '../src/client/types.js'

const [nativeSelector, dsBotSelector] = accountRowSelectors

// Minimal DOM stand-in: the anchoring code only needs element creation, child
// list mutation, class names, layout and selector lookup. `querySelectorAll`
// resolves the two registered selector strings, so each scenario declares which
// anchors the page currently exposes.
class FakeElement {
  children: FakeElement[] = []
  parentElement: FakeElement | null = null

  constructor(readonly tagName: string, readonly className = '', public laidOut = true) {}

  get isConnected(): boolean {
    let node: FakeElement | null = this
    while (node !== null) {
      if (node === body) return true
      node = node.parentElement
    }
    return false
  }

  getClientRects(): { length: number } {
    return { length: this.laidOut ? 1 : 0 }
  }

  append(child: FakeElement): void {
    child.parentElement?.remove(child)
    child.parentElement = this
    this.children.push(child)
  }

  remove(child: FakeElement = this): void {
    const parent = child.parentElement
    if (parent === null) return
    const index = parent.children.indexOf(child)
    if (index >= 0) parent.children.splice(index, 1)
    child.parentElement = null
  }
}

let body: FakeElement | undefined

class FakeObserver {
  static instances: FakeObserver[] = []
  disconnected = false

  constructor(private readonly callback: () => void) {
    FakeObserver.instances.push(this)
  }

  observe(): void {}

  disconnect(): void {
    this.disconnected = true
  }

  static reset(): void {
    FakeObserver.instances = []
  }

  static flush(): void {
    for (const observer of FakeObserver.instances) {
      if (!observer.disconnected) observer.callback()
    }
  }
}

function setup(anchors: Record<string, FakeElement[]> = {}) {
  vi.useFakeTimers()
  FakeObserver.reset()
  const root = new FakeElement('body')
  body = root
  const rows = new Map(Object.entries(anchors))
  const document = {
    body: root,
    documentElement: { classList: { toggle: () => undefined, remove: () => undefined } },
    querySelectorAll: (selector: string) => rows.get(selector) ?? [],
    createElement: (tagName: string) => new FakeElement(tagName),
  }
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    setInterval: () => 0,
    clearInterval: () => undefined,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  vi.stubGlobal('MutationObserver', FakeObserver)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  return { root, rows, document, warn }
}

/** Builds `<div class="…settingsArea"><div class="…">…` and returns the row. */
function accountRow(root: FakeElement, className: string, laidOut = true) {
  const area = new FakeElement('div', 'hHd-Xa_settingsArea')
  const row = new FakeElement('div', className, laidOut)
  area.append(row)
  root.append(area)
  return row
}

/** Records every container the mount reports, including `null` hand-backs. */
function collector() {
  const calls: Array<FakeElement | null> = []
  return {
    calls,
    attach: (container: HTMLElement | null) => { calls.push(container as unknown as FakeElement | null) },
    get host(): FakeElement {
      const host = calls.find(call => call !== null)
      if (host === undefined || host === null) throw new Error('no container was attached')
      return host
    },
    get attached(): FakeElement[] {
      return calls.filter((call): call is FakeElement => call !== null)
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeObserver.reset()
  body = undefined
})

describe('compact sidebar account entry anchoring', () => {
  it('attaches to the DS-Bot account row that replaced the host settings shell', async () => {
    await runScenarios([{
      name: 'DS-Bot .bt-settings-row is accepted as the anchor',
      run: () => {
        const { root, rows, document } = setup()
        const row = accountRow(root, 'bt-settings-row')
        rows.set(dsBotSelector, [row])
        const containers = collector()
        mountAccountEntry(containers.attach)
        expect(findAccountRow(document as unknown as ParentNode)).toBe(row)
        expect(containers.attached).toHaveLength(1)
        expect(containers.host.parentElement).toBe(row)
        expect(row.children).toEqual([containers.host])
      },
    }])
  })

  it('keeps the native trigger row first and skips a row that is not laid out', async () => {
    await runScenarios([
      {
        name: 'native triggerRow wins when both anchors exist',
        run: () => {
          const { root, rows, document } = setup()
          const native = accountRow(root, 'VOzbGW_triggerRow')
          const dsBot = accountRow(root, 'bt-settings-row')
          rows.set(nativeSelector, [native])
          rows.set(dsBotSelector, [dsBot])
          expect(findAccountRow(document as unknown as ParentNode)).toBe(native)
          const containers = collector()
          mountAccountEntry(containers.attach)
          expect(containers.host.parentElement).toBe(native)
        },
      },
      {
        name: 'a collapsed native row falls through to DS-Bot',
        run: () => {
          const { root, rows, document } = setup()
          const native = accountRow(root, 'VOzbGW_triggerRow', false)
          const dsBot = accountRow(root, 'bt-settings-row')
          rows.set(nativeSelector, [native])
          rows.set(dsBotSelector, [dsBot])
          expect(findAccountRow(document as unknown as ParentNode)).toBe(dsBot)
          const containers = collector()
          mountAccountEntry(containers.attach)
          expect(containers.host.parentElement).toBe(dsBot)
        },
      },
    ])
  })

  it('re-anchors into a remounted row without duplicating the entry', async () => {
    await runScenarios([{
      name: 'settings shell remount moves the single host node',
      run: () => {
        const { root, rows } = setup()
        const first = accountRow(root, 'bt-settings-row')
        const area = first.parentElement!
        rows.set(dsBotSelector, [first])
        const containers = collector()
        mountAccountEntry(containers.attach)
        expect(containers.host.parentElement).toBe(first)

        const next = new FakeElement('div', 'bt-settings-row')
        area.append(next)
        first.remove()
        rows.set(dsBotSelector, [next])
        FakeObserver.flush()

        expect(containers.attached).toHaveLength(1)
        expect(containers.host.parentElement).toBe(next)
        expect(area.children).toEqual([next])
        expect(next.children).toEqual([containers.host])
      },
    }])
  })

  it('restores exactly one entry after the host clears the row children', async () => {
    await runScenarios([{
      name: 'a dropped node is re-appended once',
      run: () => {
        const { root, rows } = setup()
        const row = accountRow(root, 'bt-settings-row')
        rows.set(dsBotSelector, [row])
        const containers = collector()
        mountAccountEntry(containers.attach)
        const host = containers.host

        host.remove()
        expect(row.children).toHaveLength(0)
        FakeObserver.flush()
        expect(row.children).toEqual([host])

        FakeObserver.flush()
        expect(row.children).toEqual([host])
      },
    }])
  })

  it('hands the slot back while the row is gone and re-attaches when it returns', async () => {
    await runScenarios([{
      name: 'losing the anchor keeps the standard entry usable',
      run: () => {
        const { root, rows } = setup()
        const row = accountRow(root, 'bt-settings-row')
        const area = row.parentElement!
        rows.set(dsBotSelector, [row])
        const containers = collector()
        mountAccountEntry(containers.attach)
        const host = containers.host

        row.remove()
        rows.set(dsBotSelector, [])
        FakeObserver.flush()
        expect(containers.calls).toEqual([host, null])

        const again = new FakeElement('div', 'bt-settings-row')
        area.append(again)
        rows.set(dsBotSelector, [again])
        FakeObserver.flush()
        expect(containers.calls).toEqual([host, null, host])
        expect(again.children).toEqual([host])
      },
    }])
  })

  it('reports one actionable warning and stops retrying when neither anchor exists', async () => {
    await runScenarios([{
      name: 'missing anchors warn once and leave the standard entry usable',
      run: () => {
        const { warn } = setup()
        const containers = collector()
        const dispose = mountAccountEntry(containers.attach)
        vi.advanceTimersByTime(accountRowRetry.intervalMs * (accountRowRetry.attempts + 2))

        expect(containers.calls).toHaveLength(0)
        expect(warn).toHaveBeenCalledTimes(1)
        const message = String(warn.mock.calls[0]![0])
        expect(message).toContain('ds-harness-remote:')
        expect(message).toContain('Standard')
        expect(vi.getTimerCount()).toBe(0)
        dispose()
      },
    }])
  })

  it('removes the entry and stops observing on cleanup', async () => {
    await runScenarios([{
      name: 'unmount leaves no host node behind',
      run: () => {
        const { root, rows } = setup()
        const row = accountRow(root, 'bt-settings-row')
        const area = row.parentElement!
        rows.set(dsBotSelector, [row])
        const containers = collector()
        const dispose = mountAccountEntry(containers.attach)
        const host = containers.host

        dispose()
        expect(host.parentElement).toBeNull()
        expect(row.children).toHaveLength(0)

        const late = new FakeElement('div', 'bt-settings-row')
        area.append(late)
        rows.set(dsBotSelector, [late])
        FakeObserver.flush()
        expect(late.children).toHaveLength(0)
      },
    }])
  })
})

// React shim, same shape as tests/settings-inline-signin.test.ts: the client
// bundle receives the host renderer, so the component is driven directly.
function createReactShim() {
  const state: any[] = []
  const deps: any[][] = []
  const cleanups: Array<(() => void) | void> = []
  let stateIndex = 0
  let effectIndex = 0
  const React: ClientReact = {
    Fragment: Symbol('Fragment'),
    createElement(type: any, props: any, ...children: any[]) {
      return { type, props: props || {}, children }
    },
    useEffect(effect: any, nextDeps?: any[]) {
      const slot = effectIndex++
      const previous = deps[slot]
      if (!previous || !nextDeps || nextDeps.some((value, index) => !Object.is(value, previous[index]))) {
        if (typeof cleanups[slot] === 'function') cleanups[slot]!()
        deps[slot] = nextDeps || []
        cleanups[slot] = effect()
      }
    },
    useCallback: (callback: any) => callback,
    useMemo: (factory: any) => factory(),
    useRef(initial: any) {
      const slot = stateIndex++
      if (state[slot] === undefined) state[slot] = { current: initial }
      return state[slot]
    },
    useState(initial: any) {
      const slot = stateIndex++
      if (state[slot] === undefined) state[slot] = typeof initial === 'function' ? initial() : initial
      return [state[slot], (value: any) => {
        state[slot] = typeof value === 'function' ? value(state[slot]) : value
      }]
    },
    useSyncExternalStore: (_subscribe: any, getSnapshot: any) => getSnapshot(),
  } as ClientReact
  return {
    React,
    // Slot cursors as they stand after one component render: rerunning a nested
    // component from its own slot base keeps its hook state between passes.
    checkpoint: () => ({ state: stateIndex, effects: effectIndex }),
    restore: (mark: { state: number; effects: number }) => {
      stateIndex = mark.state
      effectIndex = mark.effects
    },
    unmount: () => { for (const cleanup of cleanups.splice(0)) if (typeof cleanup === 'function') cleanup() },
  }
}

function findElement(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of Array.isArray(node) ? node : node.children ?? []) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

describe('compact sidebar entry rendering', () => {
  it('portals the compact entry into the DS-Bot row instead of the standard footer entry', async () => {
    await runScenarios([{
      name: 'DS-Bot row receives the compact button and the standard entry disappears',
      run: () => {
        const { root, rows } = setup()
        const row = accountRow(root, 'bt-settings-row')
        rows.set(dsBotSelector, [row])
        const shim = createReactShim()
        const { React, unmount } = shim
        const portal = vi.fn((children: unknown, container: Element) => ({ children, container }))
        const Action = createRemoteWorkspaceAction(React, portal as any) as any
        const props = {
          wide: true,
          control: vi.fn(async (endpoint: string) =>
            endpoint === 'settings.get' ? { config: { sidebar: { entry: 'compact' } } } : {}),
          statusFeed: { subscribe: () => () => undefined, getSnapshot: () => undefined },
          subscribeOpen: () => () => undefined,
          preferredQrProvider: 'github',
          sidebarEntry: { read: () => 'compact', subscribe: () => () => undefined, publish: () => undefined },
          portal: portal as any,
          t: (key: string) => key,
        }

        const tree = Action(props)
        const entry = findElement(tree, node => node?.props?.portal === portal && 'fallback' in node.props)
        expect(entry).toBeTruthy()

        // React hands children over inside props; the shim keeps them beside it.
        const entryProps = { ...entry.props, children: entry.children[0] }
        const mark = shim.checkpoint()
        shim.restore(mark)
        expect(entry.type(entryProps)).toBe(entry.props.fallback)
        shim.restore(mark)
        const rendered = entry.type(entryProps)

        expect(portal).toHaveBeenCalledTimes(1)
        expect(portal.mock.calls[0]![1]).toBe(row.children[0])
        expect(portal.mock.calls[0]![0]).toMatchObject({ props: { className: 'dshRemoteAccountEntry' } })
        expect(rendered).toEqual({ children: portal.mock.calls[0]![0], container: row.children[0] })
        expect(findElement(tree, node => String(node?.props?.className ?? '').includes('dshRemoteSidebarEntry'))).toBeNull()
        unmount()
      },
    }])
  })
})
