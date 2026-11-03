import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { mermaidHtml } from '../../generated/mermaid-html'
import type { ThemeColors } from '../theme'

/**
 * One hidden WebView renders every ```mermaid block of the app, one diagram at a time, so a
 * conversation full of diagrams never mounts a WebView per message. Results are cached by
 * source and theme; FlatList recycling a cell reuses the cached SVG instead of rendering again.
 */

const SOURCE = { html: mermaidHtml, baseUrl: 'about:blank' }
export const MAX_MERMAID_SOURCE_CHARS = 20_000
const MAX_SVG_CHARS = 1024 * 1024
const MAX_DIMENSION = 20_000
const READY_TIMEOUT_MS = 30_000
const RENDER_TIMEOUT_MS = 20_000
const CACHE_LIMIT = 48

export interface MermaidTheme {
  dark: boolean
  background: string
  surface: string
  surfaceStrong: string
  primary: string
  primarySoft: string
  ink: string
  muted: string
  border: string
}

export interface MermaidDiagram {
  width: number
  height: number
  /** The renderer's own SVG, styles intact; shown as an image by the full-screen viewer. */
  svg: string
  /** Style-free SVG for react-native-svg; absent when the diagram needs HTML labels. */
  inline?: string
}

export type MermaidRenderState =
  | { status: 'pending' }
  | { status: 'ready'; diagram: MermaidDiagram }
  | { status: 'error' }

interface Entry {
  source: string
  theme: MermaidTheme
  state: MermaidRenderState
}

interface RendererMessage {
  type?: unknown
  id?: unknown
  width?: unknown
  height?: unknown
  svg?: unknown
  inline?: unknown
}

export function mermaidThemeFor(colors: ThemeColors, dark: boolean): MermaidTheme {
  return {
    dark,
    background: colors.background,
    surface: colors.surface,
    surfaceStrong: colors.surfaceStrong,
    primary: colors.primary,
    primarySoft: colors.primarySoft,
    ink: colors.ink,
    muted: colors.muted,
    border: colors.border,
  }
}

const PENDING: MermaidRenderState = { status: 'pending' }

class MermaidRenderQueue {
  private readonly entries = new Map<string, Entry>()
  /** Kept apart from entries: a block subscribes during render, before its request() runs. */
  private readonly listeners = new Map<string, Set<() => void>>()
  private queue: string[] = []
  private active: { key: string; id: number; timer: ReturnType<typeof setTimeout> } | undefined
  private send: ((script: string) => void) | undefined
  private restart: (() => void) | undefined
  private ready = false
  private readyTimer: ReturnType<typeof setTimeout> | undefined
  private nextId = 1
  private wanted = false
  private readonly hostListeners = new Set<() => void>()

  get(key: string): MermaidRenderState | undefined {
    return this.entries.get(key)?.state
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key)
    if (set === undefined) this.listeners.set(key, set = new Set())
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0 && this.listeners.get(key) === set) this.listeners.delete(key)
    }
  }

  request(key: string, source: string, theme: MermaidTheme) {
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      // Re-insert to keep the most recently shown diagrams at the end of the LRU order.
      this.entries.delete(key)
      this.entries.set(key, existing)
      return
    }
    this.entries.set(key, { source, theme, state: PENDING })
    this.queue.push(key)
    this.notify(key)
    this.evict()
    if (!this.wanted) {
      this.wanted = true
      this.hostListeners.forEach(listener => listener())
    }
    this.pump()
  }

  isWanted = () => this.wanted

  subscribeHost = (listener: () => void) => {
    this.hostListeners.add(listener)
    return () => { this.hostListeners.delete(listener) }
  }

  attach(send: (script: string) => void, restart: () => void) {
    this.send = send
    this.restart = restart
    this.ready = false
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
    this.readyTimer = setTimeout(() => this.failAll(), READY_TIMEOUT_MS)
  }

  detach() {
    this.send = undefined
    this.restart = undefined
    this.ready = false
    if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
    this.readyTimer = undefined
    if (this.active !== undefined) {
      clearTimeout(this.active.timer)
      // The job never finished; put it back so the next renderer instance retries it.
      this.queue.unshift(this.active.key)
      this.active = undefined
    }
  }

  onMessage(data: string) {
    let message: RendererMessage
    try { message = JSON.parse(data) as RendererMessage } catch { return }
    if (typeof message !== 'object' || message === null) return
    if (message.type === 'ready') {
      if (this.readyTimer !== undefined) clearTimeout(this.readyTimer)
      this.readyTimer = undefined
      this.ready = true
      this.pump()
      return
    }
    const active = this.active
    if (active === undefined || message.id !== active.id) return
    clearTimeout(active.timer)
    this.active = undefined
    this.settle(active.key, message.type === 'rendered' ? parseDiagram(message) : undefined)
    this.pump()
  }

  /** The renderer process died: the diagram it was drawing fails, the rest wait for a new page. */
  crashed() {
    const active = this.active
    if (active !== undefined) {
      clearTimeout(active.timer)
      this.active = undefined
      this.settle(active.key, undefined)
    }
    this.ready = false
    this.restart?.()
  }

  private pump() {
    if (!this.ready || this.active !== undefined || this.send === undefined) return
    let key = this.queue.shift()
    while (key !== undefined && this.entries.get(key)?.state !== PENDING) key = this.queue.shift()
    if (key === undefined) return
    const entry = this.entries.get(key)!
    const id = this.nextId++
    const timer = setTimeout(() => {
      if (this.active?.id !== id) return
      this.active = undefined
      this.settle(key, undefined)
      // A diagram that hangs the page would block every later one; start from a fresh page.
      this.ready = false
      this.restart?.()
    }, RENDER_TIMEOUT_MS)
    this.active = { key, id, timer }
    this.send(`window.renderMermaid(${id},${JSON.stringify(entry.source)},${JSON.stringify(entry.theme)})`)
  }

  private settle(key: string, diagram: MermaidDiagram | undefined) {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    entry.state = diagram === undefined ? { status: 'error' } : { status: 'ready', diagram }
    this.notify(key)
  }

  private notify(key: string) {
    this.listeners.get(key)?.forEach(listener => listener())
  }

  private failAll() {
    this.readyTimer = undefined
    const keys = this.queue
    this.queue = []
    keys.forEach(key => this.settle(key, undefined))
  }

  private evict() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= CACHE_LIMIT) return
      if (entry.state === PENDING || this.listeners.has(key)) continue
      this.entries.delete(key)
    }
  }
}

function parseDiagram(message: RendererMessage): MermaidDiagram | undefined {
  const { width, height, svg, inline } = message
  if (typeof width !== 'number' || typeof height !== 'number') return undefined
  if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) return undefined
  if (typeof svg !== 'string' || svg.length === 0 || svg.length > MAX_SVG_CHARS) return undefined
  if (inline !== undefined && (typeof inline !== 'string' || inline.length > MAX_SVG_CHARS)) return undefined
  return { width, height, svg, inline }
}

const renderer = new MermaidRenderQueue()

function cacheKey(source: string, theme: MermaidTheme) {
  return `${JSON.stringify(theme)}\n${source}`
}

/** Renders `source` (undefined while it is still streaming) and follows the cached result. */
export function useMermaidDiagram(source: string | undefined, theme: MermaidTheme): MermaidRenderState | undefined {
  const key = source === undefined ? undefined : cacheKey(source, theme)
  const subscribe = useCallback(
    (listener: () => void) => (key === undefined ? () => {} : renderer.subscribe(key, listener)),
    [key],
  )
  const state = useSyncExternalStore(subscribe, () => (key === undefined ? undefined : renderer.get(key)))
  useEffect(() => {
    // theme is part of key, so the request always matches the subscription.
    if (key !== undefined && source !== undefined) renderer.request(key, source, theme)
  }, [key])
  return state
}

/** Mounted once at the app root; creates the hidden renderer only after the first diagram. */
export function MermaidRendererHost() {
  const wanted = useSyncExternalStore(renderer.subscribeHost, renderer.isWanted)
  const [revision, setRevision] = useState(0)
  const web = useRef<WebView>(null)

  useEffect(() => {
    if (!wanted) return
    renderer.attach(script => web.current?.injectJavaScript(`${script};true;`), () => setRevision(value => value + 1))
    return () => renderer.detach()
  }, [wanted, revision])

  if (!wanted) return null
  return <View pointerEvents="none" style={styles.hidden} importantForAccessibility="no-hide-descendants">
    <WebView ref={web} key={revision} source={SOURCE} style={styles.web}
      originWhitelist={['*']} javaScriptEnabled incognito cacheEnabled={false} domStorageEnabled={false}
      thirdPartyCookiesEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" setSupportMultipleWindows
      allowsBackForwardNavigationGestures={false} onOpenWindow={() => undefined}
      onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
      onRenderProcessGone={() => renderer.crashed()} onContentProcessDidTerminate={() => renderer.crashed()}
      onMessage={(event: WebViewMessageEvent) => renderer.onMessage(event.nativeEvent.data)} />
  </View>
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  web: { width: 1, height: 1, backgroundColor: 'transparent' },
})
