import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  const stores = new Map<string, any>()
  const memoSlots = new Map<number, { deps?: unknown[]; value: any }>()
  const effects: Array<() => void | (() => void)> = []
  const effectSlots = new Map<number, { deps?: unknown[]; cleanup?: () => void }>()
  const ctx = { order: 0, effOrder: 0, memoOrder: 0 }
  ;(globalThis as any).__dshDuotoneReactMock = {
    beginPass: () => {
      ctx.order = 0
      ctx.effOrder = 0
      ctx.memoOrder = 0
      effects.length = 0
    },
    flushEffects: () => {
      const pending = effects.splice(0, effects.length)
      for (const fn of pending) fn()
    },
    reset: () => {
      for (const slot of effectSlots.values()) {
        slot.cleanup?.()
      }
      effectSlots.clear()
      memoSlots.clear()
      stores.clear()
      effects.length = 0
      ctx.order = 0
      ctx.effOrder = 0
      ctx.memoOrder = 0
    },
  }
  const depsChanged = (prevDeps?: unknown[], nextDeps?: unknown[]) =>
    !prevDeps ||
    !nextDeps ||
    prevDeps.length !== nextDeps.length ||
    nextDeps.some((d, i) => !Object.is(d, prevDeps[i]))
  return {
    ...actual,
    memo: (component: any) => component,
    useId: () => ':line-test:',
    useContext: (context: any) => (globalThis as any).__dshDuotoneCtx?.get(context) ?? context?._currentValue,
    useRef: (v: any) => {
      const key = `r${ctx.order++}`
      if (!stores.has(key)) stores.set(key, { current: v })
      return stores.get(key)
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const idx = ctx.effOrder++
      const prev = effectSlots.get(idx)
      if (prev && !depsChanged(prev.deps, deps)) return
      effects.push(() => {
        prev?.cleanup?.()
        const ret = fn()
        effectSlots.set(idx, { deps, cleanup: typeof ret === 'function' ? ret : undefined })
      })
    },
    useState: (v: any) => {
      const key = `s${ctx.order++}`
      if (!stores.has(key)) stores.set(key, typeof v === 'function' ? v() : v)
      const set = (next: any) => {
        const current = stores.get(key)
        stores.set(key, typeof next === 'function' ? next(current) : next)
      }
      return [stores.get(key), set]
    },
    useMemo: (fn: any, deps?: unknown[]) => {
      const idx = ctx.memoOrder++
      const prev = memoSlots.get(idx)
      if (prev && !depsChanged(prev.deps, deps)) return prev.value
      const value = fn()
      memoSlots.set(idx, { deps, value })
      return value
    },
    useCallback: (fn: any, deps?: unknown[]) => {
      const idx = ctx.memoOrder++
      const prev = memoSlots.get(idx)
      if (prev && !depsChanged(prev.deps, deps)) return prev.value
      memoSlots.set(idx, { deps, value: fn })
      return fn
    },
  }
})

vi.mock('react-native', () => {
  const React = require('react')
  class MockAnimatedValue {
    value: number
    constructor(v: number) { this.value = v }
    setValue(v: number) { this.value = v }
    interpolate(config: { inputRange: number[]; outputRange: number[] }) {
      return config.outputRange[0]
    }
  }
  const Pressable = Object.assign(
    (props: any) => React.createElement('Pressable', props, props.children),
    { displayName: 'Pressable' },
  )
  const AnimatedView = Object.assign(
    (props: any) => React.createElement('AnimatedView', props, props.children),
    { displayName: 'AnimatedView' },
  )
  return {
    Animated: {
      Value: MockAnimatedValue,
      View: AnimatedView,
      timing: (_val: any, _cfg: any) => ({ start: (cb?: () => void) => cb?.() }),
      spring: (_val: any, _cfg: any) => ({ start: (cb?: () => void) => cb?.() }),
      sequence: (_anims: any[]) => ({ start: (cb?: () => void) => cb?.() }),
    },
    Easing: { out: (fn: any) => fn, cubic: (t: number) => t },
    Platform: { OS: 'android' },
    Pressable,
    RefreshControl: 'RefreshControl',
    ScrollView: 'ScrollView',
    StyleSheet: {
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
      create: (s: any) => s,
      flatten: (s: any) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s),
      hairlineWidth: 1,
    },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
  }
})

vi.mock('react-native-svg', () => {
  const React = require('react')
  const tag = (name: string) =>
    Object.assign((props: any) => React.createElement(name, props, props.children), { displayName: name })
  return {
    default: tag('Svg'),
    ClipPath: tag('ClipPath'),
    Defs: tag('Defs'),
    G: tag('G'),
    Mask: tag('Mask'),
    Path: tag('Path'),
    Rect: tag('Rect'),
  }
})

vi.mock('../src/ui/haptics', () => ({
  triggerLightHaptic: vi.fn(),
}))

vi.mock('expo-blur', () => ({
  BlurTargetView: 'BlurTargetView',
  BlurView: 'BlurView',
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

vi.mock('../src/ui/platform-style', () => ({
  androidRipple: () => undefined,
  continuousRadius: (r: number) => ({ borderRadius: r }),
  elevationStyle: () => ({}),
  monoFontFamily: 'monospace',
}))

vi.mock('../src/ui/use-themed-styles', () => ({
  useThemedStyles: () => new Proxy({}, { get: () => ({}) }),
}))

vi.mock('../src/locales/i18n', () => ({
  strings: { common: { back: 'Back', refresh: 'Refresh', retry: 'Retry', close: 'Close', ok: 'OK' } },
}))

const mockTheme = {
  scheme: 'light' as 'light' | 'dark',
  colors: {
    ink: '#0F0F0F',
    onInverse: '#FFFFFF',
    inverse: '#0F0F0F',
    background: '#FFFFFF',
    elevated: '#FFFFFF',
    surface: '#F6F6F6',
    surfaceStrong: '#EFEFEF',
    muted: '#666666',
    subtle: '#999999',
    danger: '#DC2626',
    dangerSoft: '#FEE2E2',
    success: '#16A34A',
    successSoft: '#DCFCE7',
    primary: '#0F0F0F',
    border: '#E5E5E5',
  },
}

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => mockTheme,
}))

const mockReduceMotion = { value: true }
vi.mock('../src/ui/use-reduce-motion', () => ({
  useReduceMotion: () => mockReduceMotion.value,
}))

import React from 'react'
import { DUOTONE_ICON_ALIASES, DUOTONE_ICON_DEFS, type LineGroupNode, type LineIconDef, type LineSvgNode } from '../src/ui/duotone-icon-data'
import { IconButton, RefreshAction } from '../src/ui/components'
import { DuotoneIcon, IconTriggerContext, MotionPressable, splitOuterAndInnerStyle } from '../src/ui/duotone-icons'

const reactMock = () => (globalThis as any).__dshDuotoneReactMock as {
  beginPass: () => void
  flushEffects: () => void
  reset: () => void
}

function collectElements(node: any, out: any[] = []): any[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, out)
    return out
  }
  if (typeof node === 'object' && node.props) {
    out.push(node)
    collectElements(node.props.children, out)
  }
  return out
}

function collectLayerLabels(nodes: readonly LineSvgNode[], out = new Set<string>(['all'])): Set<string> {
  for (const node of nodes) {
    if (node.k === 'g') {
      const g = node as LineGroupNode
      if (g.l) out.add(g.l)
      collectLayerLabels(g.ch, out)
    }
  }
  return out
}

const isTag = (el: any, name: string) => el?.type === name || el?.type?.displayName === name
const renderDuotoneIcon = (props: any) => ((DuotoneIcon as any).type ?? DuotoneIcon)(props)
const renderMotionPressable = (props: any) => ((MotionPressable as any).type ?? MotionPressable)(props)

describe('Line-duotone icon catalog integrity', () => {
  it('resolves every alias to an existing 24x24 icon definition', () => {
    for (const [alias, target] of Object.entries(DUOTONE_ICON_ALIASES)) {
      expect(DUOTONE_ICON_DEFS[target], `alias ${alias} -> ${target}`).toBeDefined()
    }
  })

  it('ensures all masks and fx target valid layer names across all icons', () => {
    for (const [name, rawDef] of Object.entries(DUOTONE_ICON_DEFS)) {
      const def = rawDef as LineIconDef
      const labels = collectLayerLabels(def.body)
      const maskIds = new Set((def.masks ?? []).map((m) => m.id))
      const checkMasks = (nodes: readonly LineSvgNode[]) => {
        for (const node of nodes) {
          if (node.k === 'g') {
            if (node.mask) expect(maskIds.has(node.mask), `${name}.mask.${node.mask}`).toBe(true)
            checkMasks(node.ch)
          }
        }
      }
      checkMasks(def.body)

      const specs = !def.fx ? [] : Array.isArray(def.fx) ? def.fx : [def.fx]
      for (const spec of specs) {
        expect(spec.oBadge, `${name}.fx.oBadge should be resolved to explicit pivot o`).toBeUndefined()
        const onList: string[] = !spec.on
          ? []
          : spec.on === 'all'
            ? ['all']
            : typeof spec.on === 'string'
              ? [spec.on]
              : (spec.on as readonly (string | readonly string[])[]).flatMap((x) => (Array.isArray(x) ? [...x] : [x]))
        for (const target of onList) {
          expect(labels.has(target), `${name}.fx target ${target}`).toBe(true)
        }
      }
    }
  })
})

describe('DuotoneIcon and MotionPressable (24px line-duotone)', () => {
  beforeEach(() => {
    reactMock().reset()
    mockTheme.scheme = 'light'
    mockReduceMotion.value = true
  })

  it('renders open 24x24 strokes and mask cutouts cleanly', () => {
    reactMock().beginPass()
    const pinOffTree = renderDuotoneIcon({ name: 'PinOff', size: 20 })
    const pinElements = collectElements(pinOffTree)
    expect(pinElements.find((el) => isTag(el, 'Svg'))?.props.viewBox).toBe('0 0 24 24')
    expect(pinElements.filter((el) => isTag(el, 'Mask')).length).toBeGreaterThan(0)

    reactMock().reset()
    reactMock().beginPass()
    const arrowTree = renderDuotoneIcon({ name: 'ArrowLeft', size: 20 })
    const arrowPaths = collectElements(arrowTree).filter((el) => isTag(el, 'Path'))
    expect(arrowPaths.length).toBe(1)
    expect(arrowPaths[0]!.props.fill).toBe('none')
    expect(arrowPaths[0]!.props.stroke).toBe('#0F0F0F')
  })

  it('keeps dark-mode hierarchical stroke contrast distinct on translucent rgba surfaces', () => {
    mockTheme.scheme = 'dark'
    reactMock().beginPass()
    const tree = renderDuotoneIcon({
      name: 'Bot',
      surfaceColor: 'rgba(255, 255, 255, 0.05)',
      color: '#F2F4F7',
    })
    const elements = collectElements(tree)
    const strokes = new Set(
      elements
        .filter((el: any) => isTag(el, 'Path'))
        .map((p: any) => p.props.stroke)
        .filter((s: unknown): s is string => typeof s === 'string'),
    )
    expect(strokes).toContain('#F2F4F7')
    expect(strokes).toContain('#77787A')
  })

  it('splits outer flex keys without injecting vertical inner.flex=1 on non-absolute items', () => {
    const splitRow = splitOuterAndInnerStyle({ flex: 1, minWidth: 0, maxWidth: '45%', minHeight: 40, padding: 8 })
    expect(splitRow.outer).toEqual({ flex: 1, minWidth: 0, maxWidth: '45%' })
    expect(splitRow.inner).toEqual({ minHeight: 40, padding: 8 })
    expect(splitRow.inner?.flex).toBeUndefined()

    const splitAbs = splitOuterAndInnerStyle({ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: 32, height: 32 })
    expect(splitAbs.outer?.position).toBe('absolute')
    expect(splitAbs.inner?.flex).toBe(1)
  })

  it('forwards pressIn IconTriggerContext active state to child DuotoneIcon and respects active=false', () => {
    const ctxMap = ((globalThis as any).__dshDuotoneCtx ??= new Map())
    reactMock().reset()
    reactMock().beginPass()
    const initial = renderMotionPressable({
      children: React.createElement(DuotoneIcon, { name: 'Settings', size: 20 }),
    })
    const pressable = collectElements(initial).find((el: any) => isTag(el, 'Pressable'))!
    pressable.props.onPressIn({})

    reactMock().beginPass()
    const pressedTree = renderMotionPressable({
      children: React.createElement(DuotoneIcon, { name: 'Settings', size: 20 }),
    })
    const provider = collectElements(pressedTree).find((el: any) => el.props?.value !== undefined && 'active' in el.props.value)!
    expect(provider.props.value.active).toBe(true)

    ctxMap.set(IconTriggerContext, provider.props.value)
    mockReduceMotion.value = false
    const origRaf = globalThis.requestAnimationFrame
    const origCaf = globalThis.cancelAnimationFrame
    const callbacks = new Map<number, (t: number) => void>()
    let nextId = 1
    const rafSpy = vi.fn((cb: (t: number) => void) => {
      const id = nextId++
      callbacks.set(id, cb)
      return id
    })
    const cafSpy = vi.fn((id?: number | null) => {
      if (typeof id === 'number') callbacks.delete(id)
    })
    globalThis.requestAnimationFrame = rafSpy
    globalThis.cancelAnimationFrame = cafSpy
    try {
      // 1) One-shot tap starts via IconTriggerContext and finishes even after active turns false.
      ctxMap.set(IconTriggerContext, provider.props.value)
      reactMock().reset()
      reactMock().beginPass()
      renderDuotoneIcon({ name: 'Settings', size: 20 })
      reactMock().flushEffects()
      expect(rafSpy).toHaveBeenCalledTimes(1)

      ctxMap.set(IconTriggerContext, { active: false, pulseSeq: provider.props.value.pulseSeq })
      reactMock().beginPass()
      renderDuotoneIcon({ name: 'Settings', size: 20 })
      reactMock().flushEffects()
      expect(cafSpy).not.toHaveBeenCalled()
      expect(callbacks.size).toBe(1)

      const flushLatestRaf = (ts: number) => {
        const entries = [...callbacks.entries()]
        expect(entries.length).toBeGreaterThan(0)
        const [id, cb] = entries[entries.length - 1]!
        callbacks.delete(id)
        cb(ts)
      }

      // Advancing rAF past span settles back cleanly to rest.
      const now0 = performance.now()
      flushLatestRaf(now0 + 200)
      flushLatestRaf(now0 + 2000)
      expect(callbacks.size).toBe(0)

      // 2) Controlled RefreshCw loop stops and resets cleanly when active switches from true to undefined.
      callbacks.clear()
      rafSpy.mockClear()
      cafSpy.mockClear()
      ctxMap.clear()
      reactMock().reset()
      reactMock().beginPass()
      renderDuotoneIcon({ name: 'RefreshCw', active: true, size: 20 })
      reactMock().flushEffects()
      expect(rafSpy).toHaveBeenCalledTimes(1)
      flushLatestRaf(performance.now() + 250)

      reactMock().beginPass()
      renderDuotoneIcon({ name: 'RefreshCw', size: 20 })
      reactMock().flushEffects()
      expect(cafSpy).toHaveBeenCalledTimes(1)
      reactMock().beginPass()
      const settledTree = renderDuotoneIcon({ name: 'RefreshCw', size: 20 })
      const groups = collectElements(settledTree).filter((el) => isTag(el, 'G') && el.props.transform !== undefined)
      expect(groups.length).toBe(0)

      // 3) Explicit active={false} overrides context while pressed.
      callbacks.clear()
      rafSpy.mockClear()
      ctxMap.set(IconTriggerContext, provider.props.value)
      reactMock().reset()
      reactMock().beginPass()
      renderDuotoneIcon({ name: 'Settings', active: false, size: 20 })
      reactMock().flushEffects()
      expect(rafSpy).not.toHaveBeenCalled()
    } finally {
      ctxMap.clear()
      globalThis.requestAnimationFrame = origRaf
      globalThis.cancelAnimationFrame = origCaf
      mockReduceMotion.value = true
    }
  })

  it('keeps IconButton active undefined unless explicitly controlled', () => {
    const SpyIcon = (props: any) => React.createElement('SpyIcon', props)
    reactMock().reset()
    reactMock().beginPass()
    const btnTree = IconButton({ label: 'Back', icon: SpyIcon, onPress: vi.fn() })
    const iconEl = collectElements(btnTree).find((el) => el.type === SpyIcon)!
    expect(iconEl.props.active).toBeUndefined()

    reactMock().reset()
    reactMock().beginPass()
    const idleBtn = RefreshAction({ refreshing: false, onPress: vi.fn() })
    expect(idleBtn.props.active).toBeUndefined()

    reactMock().reset()
    reactMock().beginPass()
    const activeBtn = RefreshAction({ refreshing: true, onPress: vi.fn() })
    expect(activeBtn.props.active).toBe(true)
  })
})
