import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

type EffectEntry = { deps: readonly unknown[] | undefined; cleanup?: () => void }

const reactHarness = vi.hoisted(() => {
  const states: unknown[] = []
  const refs: Array<{ current: unknown }> = []
  const effects: Array<EffectEntry | undefined> = []
  let stateIndex = 0
  let refIndex = 0
  let effectIndex = 0

  return {
    beginRender() {
      stateIndex = 0
      refIndex = 0
      effectIndex = 0
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const idx = stateIndex++
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial
      }
      const setState = (next: T | ((prev: T) => T)) => {
        states[idx] = typeof next === 'function' ? (next as (prev: T) => T)(states[idx] as T) : next
      }
      return [states[idx] as T, setState]
    },
    useRef<T>(initial: T): { current: T } {
      const idx = refIndex++
      if (!(idx in refs)) {
        refs[idx] = { current: initial }
      }
      return refs[idx] as { current: T }
    },
    useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
      const idx = effectIndex++
      const prev = effects[idx]
      const changed = prev === undefined
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps?.[i]))
      if (changed) {
        prev?.cleanup?.()
        const cleanup = fn()
        effects[idx] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
      }
    },
    useMemo<T>(fn: () => T): T {
      return fn()
    },
    unmount() {
      for (const entry of effects) entry?.cleanup?.()
      states.length = 0
      refs.length = 0
      effects.length = 0
      stateIndex = 0
      refIndex = 0
      effectIndex = 0
    },
  }
})

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: reactHarness.useState,
    useRef: reactHarness.useRef,
    useEffect: reactHarness.useEffect,
    useMemo: reactHarness.useMemo,
  }
})

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
}))

vi.mock('react-native-webview', () => ({
  default: 'WebView',
}))

vi.mock('../src/state/store', () => ({
  useAppStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'en-US' }),
}))

vi.mock('../src/ui/components', () => ({
  ErrorBanner: 'ErrorBanner',
  TopBar: 'TopBar',
}))

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({ colors: { background: '#fff', primary: '#00f' } }),
}))

import {
  DSH_WEB_GRANT_CLOCK_SKEW_MS,
  DshWebScreen,
  isDshWebGrantUsable,
  isFatalDshWebHttpError,
} from '../src/screens/dsh-web-screen'

type ElementNode = { type: unknown; props?: Record<string, unknown> }

function findElement(node: unknown, predicate: (el: ElementNode) => boolean): ElementNode | undefined {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findElement(item, predicate)
      if (found) return found
    }
    return undefined
  }
  const el = node as ElementNode
  if (predicate(el)) return el
  return findElement(el.props?.children, predicate)
}

function renderScreen(rpc: (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>) {
  reactHarness.beginRender()
  return DshWebScreen({ rpc, hostName: 'Test Host', onClose: () => undefined })
}

async function flushMicrotasks() {
  for (let i = 0; i < 16; i++) await Promise.resolve()
}

function validGrant(overrides?: Partial<{ url: string; browserGrant: string; expiresAt: number }>) {
  return {
    url: 'https://p2a3b4c5d6e7.tunnel.example.com/',
    browserGrant: 'A'.repeat(43),
    expiresAt: Date.now() + 25_000,
    ...overrides,
  }
}

afterEach(() => {
  reactHarness.unmount()
  vi.restoreAllMocks()
})

describe('DshWebScreen helpers and lifecycle', () => {
  it('classifies clock-skew grant validity, and fatal HTTP errors', async () => {
    const grantUrl = 'https://p2a3b4c5d6e7.tunnel.example.com/'
    const sessionUri = 'https://p2a3b4c5d6e7.tunnel.example.com/__remote/session'
    const now = 1_700_000_000_000

    await runScenarios([
      {
        name: 'grant clock skew tolerance',
        run: () => {
          const base = validGrant()
          expect(isDshWebGrantUsable({ ...base, expiresAt: now + 10_000 }, now)).toBe(true)
          expect(isDshWebGrantUsable({ ...base, expiresAt: now - 30_000 }, now)).toBe(true)
          expect(isDshWebGrantUsable({ ...base, expiresAt: now - DSH_WEB_GRANT_CLOCK_SKEW_MS }, now)).toBe(false)
        },
      },
      {
        name: 'HTTP error matching',
        run: () => {
          expect(isFatalDshWebHttpError({ url: sessionUri, statusCode: 410 }, grantUrl, sessionUri)).toBe(true)
          expect(isFatalDshWebHttpError({ url: grantUrl, statusCode: 500 }, grantUrl, sessionUri)).toBe(true)
          for (const statusCode of [401, 502, 503, 504]) {
            expect(
              isFatalDshWebHttpError({ url: `${grantUrl}api/sessions`, statusCode }, grantUrl, sessionUri),
            ).toBe(true)
          }
          expect(
            isFatalDshWebHttpError({ url: `${grantUrl}favicon.ico`, statusCode: 404 }, grantUrl, sessionUri),
          ).toBe(false)
          expect(
            isFatalDshWebHttpError({ url: 'https://other.example.com/api', statusCode: 502 }, grantUrl, sessionUri),
          ).toBe(false)
          expect(isFatalDshWebHttpError({ url: 'not-a-url', statusCode: 503 }, grantUrl, sessionUri)).toBe(false)
        },
      },
    ])
  })

  it('skips dsh.web.close when open rejects, and offers retry after a rejected open', async () => {
    await runScenarios([
      {
        name: 'authorization errors offer retry and skip close on unmount',
        run: async () => {
          for (const code of ['WEB_ENTITLEMENT_REQUIRED', 'MEMBERSHIP_REQUIRED']) {
            const rpc = vi.fn(async (method: string) => {
              if (method === 'dsh.web.open') throw Object.assign(new Error(code), { code })
              return {}
            })
            renderScreen(rpc)
            await flushMicrotasks()
            const tree = renderScreen(rpc)
            const banner = findElement(tree, el => el.type === 'ErrorBanner')
            expect(banner).toBeDefined()
            expect(typeof banner?.props?.onRetry).toBe('function')
            reactHarness.unmount()
            expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open'])
          }
        },
      },
      {
        name: 'transient open failure offers retry without spurious close and submits a same-origin form on iOS once recovered',
        run: async () => {
          let calls = 0
          const rpc = vi.fn(async (method: string) => {
            if (method === 'dsh.web.open') {
              calls += 1
              if (calls === 1) throw Object.assign(new Error('unavailable'), { code: 'TUNNEL_UNAVAILABLE' })
              return validGrant()
            }
            return {}
          })
          renderScreen(rpc)
          await flushMicrotasks()
          const failedTree = renderScreen(rpc)
          const banner = findElement(failedTree, el => el.type === 'ErrorBanner')
          expect(typeof banner?.props?.onRetry).toBe('function')

          ;(banner!.props!.onRetry as () => void)()
          renderScreen(rpc)
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.open'])

          await flushMicrotasks()
          const readyTree = renderScreen(rpc)
          const webView = findElement(readyTree, el => el.type === 'WebView')
          expect(webView?.props?.source).toEqual({
            baseUrl: new URL('/__remote/session-bootstrap', validGrant().url).href,
            html: expect.stringContaining('<form method="post" action="/__remote/session">'),
          })
          const source = webView?.props?.source as { html: string }
          expect(source.html).toContain('name="referrer" content="same-origin"')
          expect(source.html).toContain(`name="browserGrant" value="${validGrant().browserGrant}"`)

          reactHarness.unmount()
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.open', 'dsh.web.close'])
        },
      },
      {
        name: 'in-flight open abort sends dsh.web.close on unmount',
        run: async () => {
          let openSignal: AbortSignal | undefined
          const rpc = vi.fn((method: string, _params: unknown, signal?: AbortSignal) => {
            if (method === 'dsh.web.open') {
              openSignal = signal
              return new Promise(() => undefined)
            }
            return Promise.resolve({})
          })
          renderScreen(rpc)
          reactHarness.unmount()
          expect(openSignal?.aborted).toBe(true)
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.close'])
        },
      },
      {
        name: 'same-origin fatal HTTP errors enter retryable error state while subresource 404 is ignored',
        run: async () => {
          const grant = validGrant()
          const rpc = vi.fn(async (method: string) => (method === 'dsh.web.open' ? grant : {}))
          renderScreen(rpc)
          await flushMicrotasks()
          const readyTree = renderScreen(rpc)
          const webView = findElement(readyTree, el => el.type === 'WebView')
          const onHttpError = webView!.props!.onHttpError as (e: { nativeEvent: { url: string; statusCode: number } }) => void

          onHttpError({ nativeEvent: { url: `${grant.url}assets/missing.png`, statusCode: 404 } })
          expect(findElement(renderScreen(rpc), el => el.type === 'WebView')).toBeDefined()

          onHttpError({ nativeEvent: { url: `${grant.url}api/stream`, statusCode: 503 } })
          const errorTree = renderScreen(rpc)
          const banner = findElement(errorTree, el => el.type === 'ErrorBanner')
          expect(banner).toBeDefined()
          expect(typeof banner?.props?.onRetry).toBe('function')

          ;(banner!.props!.onRetry as () => void)()
          renderScreen(rpc)
          await flushMicrotasks()
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.close', 'dsh.web.open'])
        },
      },
      {
        name: 'serializes retry open after pending close settles and avoids duplicate close if unmounted while waiting',
        run: async () => {
          const grant = validGrant()
          let resolveClose!: () => void
          const rpc = vi.fn((method: string) => {
            if (method === 'dsh.web.open') return Promise.resolve(grant)
            return new Promise<void>(resolve => { resolveClose = resolve })
          })
          renderScreen(rpc)
          await flushMicrotasks()
          const readyTree = renderScreen(rpc)
          const webView = findElement(readyTree, el => el.type === 'WebView')
          const onHttpError = webView!.props!.onHttpError as (e: { nativeEvent: { url: string; statusCode: number } }) => void

          onHttpError({ nativeEvent: { url: `${grant.url}api/stream`, statusCode: 503 } })
          const errorBanner = findElement(renderScreen(rpc), el => el.type === 'ErrorBanner')
          ;(errorBanner!.props!.onRetry as () => void)()
          renderScreen(rpc)
          await flushMicrotasks()
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.close'])

          resolveClose()
          await flushMicrotasks()
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.close', 'dsh.web.open'])

          const secondReadyTree = renderScreen(rpc)
          const secondWebView = findElement(secondReadyTree, el => el.type === 'WebView')
          const secondOnHttpError = secondWebView!.props!.onHttpError as (e: { nativeEvent: { url: string; statusCode: number } }) => void
          secondOnHttpError({ nativeEvent: { url: `${grant.url}api/stream`, statusCode: 502 } })
          const secondBanner = findElement(renderScreen(rpc), el => el.type === 'ErrorBanner')
          ;(secondBanner!.props!.onRetry as () => void)()
          renderScreen(rpc)
          await flushMicrotasks()
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.close', 'dsh.web.open', 'dsh.web.close'])

          reactHarness.unmount()
          resolveClose()
          await flushMicrotasks()
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.close', 'dsh.web.open', 'dsh.web.close'])
        },
      },
      {
        name: 'switching rpc prop resets prior error state and opens on the replacement rpc',
        run: async () => {
          const failedRpc = vi.fn(async (method: string) => {
            if (method === 'dsh.web.open') throw Object.assign(new Error('denied'), { code: 'MEMBERSHIP_REQUIRED' })
            return {}
          })
          let resolveReplacement!: (value: unknown) => void
          const replacementRpc = vi.fn((method: string) => {
            if (method === 'dsh.web.open') return new Promise(resolve => { resolveReplacement = resolve })
            return Promise.resolve({})
          })

          renderScreen(failedRpc)
          await flushMicrotasks()
          expect(findElement(renderScreen(failedRpc), el => el.type === 'ErrorBanner')).toBeDefined()

          renderScreen(replacementRpc)
          const loadingTree = renderScreen(replacementRpc)
          expect(findElement(loadingTree, el => el.type === 'ErrorBanner')).toBeUndefined()
          expect(findElement(loadingTree, el => el.type === 'ActivityIndicator')).toBeDefined()
          expect(failedRpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open'])
          expect(replacementRpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open'])

          resolveReplacement(validGrant())
          await flushMicrotasks()
          expect(findElement(renderScreen(replacementRpc), el => el.type === 'WebView')).toBeDefined()
        },
      },
      {
        name: 'unusable grant returned by Host still closes active Host lease on unmount',
        run: async () => {
          const expiredGrant = validGrant({ expiresAt: Date.now() - DSH_WEB_GRANT_CLOCK_SKEW_MS - 5_000 })
          const rpc = vi.fn(async (method: string) => (method === 'dsh.web.open' ? expiredGrant : {}))
          renderScreen(rpc)
          await flushMicrotasks()
          const tree = renderScreen(rpc)
          expect(findElement(tree, el => el.type === 'ErrorBanner')).toBeDefined()
          reactHarness.unmount()
          expect(rpc.mock.calls.map(([method]) => method)).toEqual(['dsh.web.open', 'dsh.web.close'])
        },
      },
      {
        name: 'dsh.web.close uses AbortController 4s deadline without AbortSignal.timeout and clears timer on settle',
        run: async () => {
          vi.useFakeTimers()
          const originalTimeout = AbortSignal.timeout
          Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true })
          try {
            let hangingCloseSignal: AbortSignal | undefined
            const hangingRpc = vi.fn((method: string, _params: unknown, signal?: AbortSignal) => {
              if (method === 'dsh.web.open') return Promise.resolve(validGrant())
              hangingCloseSignal = signal
              return new Promise(() => undefined)
            })
            renderScreen(hangingRpc)
            await flushMicrotasks()
            reactHarness.unmount()
            expect(hangingCloseSignal).toBeDefined()
            expect(hangingCloseSignal?.aborted).toBe(false)
            vi.advanceTimersByTime(3_999)
            expect(hangingCloseSignal?.aborted).toBe(false)
            vi.advanceTimersByTime(1)
            expect(hangingCloseSignal?.aborted).toBe(true)

            let settledCloseSignal: AbortSignal | undefined
            const settledRpc = vi.fn((method: string, _params: unknown, signal?: AbortSignal) => {
              if (method === 'dsh.web.open') return Promise.resolve(validGrant())
              settledCloseSignal = signal
              return Promise.resolve({})
            })
            renderScreen(settledRpc)
            await flushMicrotasks()
            reactHarness.unmount()
            await flushMicrotasks()
            vi.advanceTimersByTime(5_000)
            expect(settledCloseSignal?.aborted).toBe(false)
          } finally {
            Object.defineProperty(AbortSignal, 'timeout', { value: originalTimeout, configurable: true, writable: true })
            vi.useRealTimers()
          }
        },
      },
    ], () => {
      reactHarness.unmount()
    })
  })
})
