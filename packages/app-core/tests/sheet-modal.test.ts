import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

type EffectSlot = {
  fn: () => void | (() => void)
  deps: readonly unknown[] | undefined
  pending: boolean
  cleanup?: () => void
}

type MemoSlot = {
  value: unknown
  deps: readonly unknown[] | undefined
}

type ComponentInstance = {
  id: string
  render: () => unknown
  tree: unknown
  history: unknown[]
  states: unknown[]
  refs: Array<{ current: unknown }>
  effects: Array<EffectSlot | undefined>
  memos: Array<MemoSlot | undefined>
  mounted: boolean
  dirty: boolean
}

const mockEnv = vi.hoisted(() => {
  const platform: { OS: 'ios' | 'android' } = { OS: 'ios' }
  return { platform }
})

const reactHarness = vi.hoisted(() => {
  const instances: ComponentInstance[] = []
  let activeInstance: ComponentInstance | null = null
  let stateIndex = 0
  let refIndex = 0
  let effectIndex = 0
  let memoIndex = 0
  let nextId = 0
  let batchDepth = 0

  function depsChanged(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
    return prev === undefined
      || next === undefined
      || prev.length !== next.length
      || next.some((dep, i) => !Object.is(dep, prev[i]))
  }

  function requireInstance(hookName: string): ComponentInstance {
    if (activeInstance === null) {
      throw new Error(`${hookName} called outside render`)
    }
    return activeInstance
  }

  function flush() {
    for (let pass = 0; pass < 50; pass += 1) {
      let didWork = false
      for (const inst of [...instances]) {
        if (!inst.mounted || !inst.dirty) continue
        didWork = true
        inst.dirty = false
        activeInstance = inst
        stateIndex = 0
        refIndex = 0
        effectIndex = 0
        memoIndex = 0
        try {
          const nextTree = inst.render()
          inst.tree = nextTree
          inst.history.push(nextTree)
        } finally {
          activeInstance = null
        }
      }

      const pendingEffects: Array<{ inst: ComponentInstance; slot: EffectSlot; prevCleanup?: () => void }> = []
      for (const inst of [...instances]) {
        if (!inst.mounted) continue
        for (const slot of inst.effects) {
          if (slot && slot.pending) {
            didWork = true
            slot.pending = false
            pendingEffects.push({ inst, slot, prevCleanup: slot.cleanup })
          }
        }
      }

      for (const item of pendingEffects) {
        if (!item.inst.mounted) continue
        item.prevCleanup?.()
        item.slot.cleanup = undefined
      }
      for (const item of pendingEffects) {
        if (!item.inst.mounted) continue
        const cleanup = item.slot.fn()
        item.slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }

      if (!didWork && !instances.some(inst => inst.mounted && inst.dirty)) {
        return
      }
    }
    throw new Error('reactHarness.flush exceeded 50 passes')
  }

  function act<T>(fn: () => T): T {
    batchDepth += 1
    try {
      return fn()
    } finally {
      batchDepth -= 1
      if (batchDepth === 0) flush()
    }
  }

  function mount(render: () => unknown): ComponentInstance {
    nextId += 1
    const inst: ComponentInstance = {
      id: `sheet-${nextId}`,
      render,
      tree: undefined,
      history: [],
      states: [],
      refs: [],
      effects: [],
      memos: [],
      mounted: true,
      dirty: true,
    }
    instances.push(inst)
    act(() => {})
    return inst
  }

  function unmount(inst: ComponentInstance) {
    if (!inst.mounted) return
    inst.mounted = false
    inst.dirty = false
    for (const slot of inst.effects) {
      slot?.cleanup?.()
      if (slot) slot.cleanup = undefined
    }
    const idx = instances.indexOf(inst)
    if (idx >= 0) instances.splice(idx, 1)
  }

  function unmountAll() {
    for (const inst of [...instances]) {
      unmount(inst)
    }
    nextId = 0
    batchDepth = 0
    activeInstance = null
  }

  return {
    act,
    mount,
    unmount,
    unmountAll,
    triggerRender(inst: ComponentInstance) {
      if (!inst.mounted) return
      inst.dirty = true
      if (batchDepth === 0) flush()
    },
    useId(): string {
      return requireInstance('useId').id
    },
    useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      const inst = requireInstance('useState')
      const idx = stateIndex++
      if (!(idx in inst.states)) {
        inst.states[idx] = typeof initial === 'function' ? (initial as () => T)() : initial
      }
      const setState = (next: T | ((prev: T) => T)) => {
        if (!inst.mounted) return
        const prev = inst.states[idx] as T
        const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        if (Object.is(value, prev)) return
        inst.states[idx] = value
        inst.dirty = true
        if (batchDepth === 0) flush()
      }
      return [inst.states[idx] as T, setState]
    },
    useRef<T>(initial: T): { current: T } {
      const inst = requireInstance('useRef')
      const idx = refIndex++
      if (!(idx in inst.refs)) {
        inst.refs[idx] = { current: initial }
      }
      return inst.refs[idx] as { current: T }
    },
    useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
      const inst = requireInstance('useEffect')
      const idx = effectIndex++
      const prev = inst.effects[idx]
      const changed = prev === undefined || depsChanged(prev.deps, deps)
      if (prev === undefined) {
        inst.effects[idx] = { fn, deps, pending: true }
      } else {
        prev.fn = fn
        prev.deps = deps
        if (changed) prev.pending = true
      }
    },
    useMemo<T>(fn: () => T, deps?: readonly unknown[]): T {
      const inst = requireInstance('useMemo')
      const idx = memoIndex++
      const prev = inst.memos[idx]
      if (prev === undefined || depsChanged(prev.deps, deps)) {
        const value = fn()
        inst.memos[idx] = { value, deps }
        return value
      }
      return prev.value as T
    },
    useCallback<T extends (...args: never[]) => unknown>(fn: T): T {
      return fn
    },
  }
})

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useCallback: reactHarness.useCallback,
    useEffect: reactHarness.useEffect,
    useId: reactHarness.useId,
    useMemo: reactHarness.useMemo,
    useRef: reactHarness.useRef,
    useState: reactHarness.useState,
  }
})

vi.mock('react-native', () => {
  class MockAnimatedValue {
    value: number
    constructor(initial: number) {
      this.value = initial
    }
    setValue(next: number) {
      this.value = next
    }
    interpolate(config: { inputRange: number[]; outputRange: number[] }) {
      return { value: this, config }
    }
  }

  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(false),
      addEventListener: () => ({ remove: () => undefined }),
    },
    Animated: {
      Value: MockAnimatedValue,
      View: 'Animated.View',
      add: (a: unknown, b: unknown) => ({ add: [a, b] }),
      spring(value: MockAnimatedValue, config: { toValue: number }) {
        return {
          start(cb?: (result: { finished: boolean }) => void) {
            value.setValue(config.toValue)
            cb?.({ finished: true })
          },
          stop() {},
        }
      },
      timing(value: MockAnimatedValue, config: { toValue: number; duration: number }) {
        let timer: ReturnType<typeof setTimeout> | undefined
        let callback: ((result: { finished: boolean }) => void) | undefined
        let settled = false
        return {
          start(cb?: (result: { finished: boolean }) => void) {
            callback = cb
            settled = false
            timer = setTimeout(() => {
              timer = undefined
              if (settled) return
              settled = true
              value.setValue(config.toValue)
              callback?.({ finished: true })
            }, config.duration)
          },
          stop() {
            if (timer !== undefined) {
              clearTimeout(timer)
              timer = undefined
            }
            if (!settled) {
              settled = true
              callback?.({ finished: false })
            }
          },
        }
      },
    },
    Easing: {
      bezier: (...points: number[]) => (t: number) => ({ points, t }),
    },
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Modal: 'Modal',
    PanResponder: {
      create: (config: Record<string, unknown>) => ({ panHandlers: config }),
    },
    Platform: mockEnv.platform,
    Pressable: 'Pressable',
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    },
    View: 'View',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  }
})

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Defs: 'Defs',
  LinearGradient: 'LinearGradient',
  RadialGradient: 'RadialGradient',
  Rect: 'Rect',
  Stop: 'Stop',
}))

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      surface: '#ffffff',
      subtle: '#7C8492',
      modalBackdrop: 'rgba(15, 15, 15, 0.42)',
    },
    scheme: 'light',
    appearance: {
      fontScale: 'md',
      spacingScale: 'balanced',
      letterSpacing: 'wide',
      accent: 'deepseek',
      bubbleStyle: 'soft',
      codeTheme: 'auto',
    },
  }),
}))

import { createModalActionQueue } from '../src/screens/chat/modal-action-queue'
import { motionTokens } from '../src/ui/motion'
import { dismissClosingSheets, SheetModal } from '../src/ui/sheet'

type ElementNode = { type: unknown; props?: Record<string, unknown> }
type SheetProps = Parameters<typeof SheetModal>[0]

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

function containsText(node: unknown, text: string): boolean {
  if (typeof node === 'string') return node.includes(text)
  if (node === null || node === undefined || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(item => containsText(item, text))
  return containsText((node as ElementNode).props?.children, text)
}

function asModal(tree: unknown): ElementNode {
  const modal = findElement(tree, el => el.type === 'Modal')
  if (!modal) throw new Error(`Expected <Modal>, got ${String(tree)}`)
  return modal
}

function mountSheet(initialProps: SheetProps) {
  let currentProps = initialProps
  const inst = reactHarness.mount(() => SheetModal(currentProps))
  return {
    get tree() {
      return inst.tree
    },
    get history() {
      return inst.history
    },
    clearHistory() {
      inst.history.length = 0
    },
    update(patch: Partial<SheetProps>) {
      currentProps = { ...currentProps, ...patch }
      reactHarness.act(() => {
        reactHarness.triggerRender(inst)
      })
    },
    unmount() {
      reactHarness.act(() => {
        reactHarness.unmount(inst)
      })
    },
  }
}

function advanceTimers(ms: number) {
  reactHarness.act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function triggerCallback(fn: unknown) {
  if (typeof fn !== 'function') throw new Error('Expected callback function')
  reactHarness.act(() => {
    ;(fn as () => void)()
  })
}

function createSheetHarness(overrides?: Partial<SheetProps>): {
  sheet: ReturnType<typeof mountSheet>
  onClose: ReturnType<typeof vi.fn<() => void>>
  onRequestClose: ReturnType<typeof vi.fn<() => void>>
  onDismiss: ReturnType<typeof vi.fn<() => void>>
} {
  const onClose = vi.fn<() => void>()
  const onRequestClose = vi.fn<() => void>()
  const onDismiss = vi.fn<() => void>()
  const sheet = mountSheet({
    visible: true,
    onClose,
    onRequestClose,
    onDismiss,
    children: 'Sheet Body' as ReactNode,
    ...overrides,
  })
  return { sheet, onClose, onRequestClose, onDismiss }
}

afterEach(() => {
  reactHarness.unmountAll()
  mockEnv.platform.OS = 'ios'
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SheetModal lifecycle and iOS native Modal dismissal', () => {
  it('covers iOS close/dismissing/reopen/fallback/superseded flows and Android immediate unmount', async () => {
    await runScenarios([
      {
        name: 'iOS normal close + createModalActionQueue(true) coordinates closing, dismissing, onDismiss, and reopen',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
          const queue = createModalActionQueue(true)
          const action1 = vi.fn()
          const actionDup = vi.fn()
          const action2 = vi.fn()
          const onRequestClose = vi.fn()

          const sheet = mountSheet({
            visible: true,
            onClose: () => { sheet.update({ visible: false, children: null }) },
            onRequestClose,
            onDismiss: queue.onDismiss,
            children: 'Menu Content',
          })

          // Opening phase renders an interactive Modal.
          const openingModal = asModal(sheet.tree)
          expect(openingModal.props?.visible).toBe(true)
          expect(openingModal.props?.transparent).toBe(true)
          expect(openingModal.props?.animationType).toBe('none')
          expect(openingModal.props?.statusBarTranslucent).toBe(true)
          expect(findElement(sheet.tree, el => el.type === 'View')?.props?.pointerEvents).toBe('box-none')
          expect(findElement(sheet.tree, el => el.type === 'Pressable')?.props?.disabled).toBe(false)
          expect(containsText(sheet.tree, 'Menu Content')).toBe(true)

          advanceTimers(motionTokens.duration.sheet)
          triggerCallback(asModal(sheet.tree).props?.onRequestClose)
          expect(onRequestClose).toHaveBeenCalledTimes(1)
          onRequestClose.mockClear()

          // Trigger menu item via modal action queue: closes sheet, defers action until native onDismiss.
          queue.run(() => { sheet.update({ visible: false, children: null }) }, action1)
          queue.run(() => { sheet.update({ visible: false, children: null }) }, actionDup)
          expect(action1).not.toHaveBeenCalled()
          expect(actionDup).not.toHaveBeenCalled()

          // During closing animation, Modal remains visible={true} with retained children and blocked interactions.
          advanceTimers(100)
          const closingModal = asModal(sheet.tree)
          expect(closingModal.props?.visible).toBe(true)
          expect(containsText(sheet.tree, 'Menu Content')).toBe(true)
          expect(findElement(sheet.tree, el => el.type === 'View')?.props?.pointerEvents).toBe('none')
          const closingPressable = findElement(sheet.tree, el => el.type === 'Pressable')
          expect(closingPressable?.props?.disabled).toBe(true)
          expect(closingPressable?.props?.pointerEvents).toBe('none')
          triggerCallback(closingModal.props?.onRequestClose)
          expect(onRequestClose).not.toHaveBeenCalled()
          expect(action1).not.toHaveBeenCalled()

          // Exit animation completes -> transitions to dismissing: <Modal visible={false}>{null}</Modal>.
          advanceTimers(motionTokens.duration.sheetExit - 100)
          const dismissingModal = asModal(sheet.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          expect(dismissingModal.props?.transparent).toBe(true)
          expect(dismissingModal.props?.animationType).toBe('none')
          expect(dismissingModal.props?.statusBarTranslucent).toBe(true)
          expect(dismissingModal.props?.children).toBeNull()
          expect(action1).not.toHaveBeenCalled()

          // Native Modal.onDismiss fires -> unmounts SheetModal, runs queued action once, cancels fallback/queue timers.
          triggerCallback(dismissingModal.props?.onDismiss)
          expect(sheet.tree).toBeNull()
          expect(action1).toHaveBeenCalledTimes(1)
          expect(vi.getTimerCount()).toBe(0)

          advanceTimers(1_000)
          expect(action1).toHaveBeenCalledTimes(1)
          expect(warnSpy).not.toHaveBeenCalled()

          // Queue and SheetModal are unlocked for subsequent opens and taps.
          sheet.update({ visible: true, children: 'Menu Content 2' })
          expect(asModal(sheet.tree).props?.visible).toBe(true)
          expect(containsText(sheet.tree, 'Menu Content 2')).toBe(true)
          advanceTimers(motionTokens.duration.sheet)

          queue.run(() => { sheet.update({ visible: false, children: null }) }, action2)
          advanceTimers(motionTokens.duration.sheetExit)
          triggerCallback(asModal(sheet.tree).props?.onDismiss)
          expect(sheet.tree).toBeNull()
          expect(action2).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'iOS settles once via 180ms fallback if Modal.onDismiss never fires and ignores late onDismiss',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const { sheet, onDismiss } = createSheetHarness()

          advanceTimers(motionTokens.duration.sheet)
          sheet.update({ visible: false })
          advanceTimers(motionTokens.duration.sheetExit)

          const dismissingModal = asModal(sheet.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          const capturedOnDismiss = dismissingModal.props?.onDismiss

          advanceTimers(179)
          expect(asModal(sheet.tree).props?.visible).toBe(false)
          expect(onDismiss).not.toHaveBeenCalled()

          advanceTimers(1)
          expect(sheet.tree).toBeNull()
          expect(onDismiss).toHaveBeenCalledTimes(1)

          // A late native onDismiss arriving after the 180ms fallback must not re-fire.
          triggerCallback(capturedOnDismiss)
          expect(onDismiss).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'iOS setting visible=true during dismissing stays Modal visible=false until native onDismiss unmounts then reopens',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const { sheet, onDismiss } = createSheetHarness({ children: 'Initial' })

          advanceTimers(motionTokens.duration.sheet)
          sheet.update({ visible: false })
          advanceTimers(motionTokens.duration.sheetExit)
          expect(asModal(sheet.tree).props?.visible).toBe(false)

          // Re-enabling visible during dismissing must NOT present while native Modal is dismissing.
          sheet.update({ visible: true, children: 'Reopened' })
          const stillDismissing = asModal(sheet.tree)
          expect(stillDismissing.props?.visible).toBe(false)
          expect(stillDismissing.props?.children).toBeNull()
          expect(onDismiss).not.toHaveBeenCalled()

          sheet.clearHistory()
          triggerCallback(stillDismissing.props?.onDismiss)

          expect(onDismiss).toHaveBeenCalledTimes(1)
          expect(sheet.history).toHaveLength(2)
          expect(sheet.history[0]).toBeNull()
          expect(asModal(sheet.history[1]).props?.visible).toBe(true)
          const reopenedModal = asModal(sheet.tree)
          expect(reopenedModal.props?.visible).toBe(true)
          expect(containsText(sheet.tree, 'Reopened')).toBe(true)
        },
      },
      {
        name: 'iOS unmount during dismissing clears 180ms fallback timer and ignores late Modal.onDismiss',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const { sheet, onDismiss } = createSheetHarness()

          advanceTimers(motionTokens.duration.sheet)
          sheet.update({ visible: false })
          advanceTimers(motionTokens.duration.sheetExit)

          const capturedOnDismiss = asModal(sheet.tree).props?.onDismiss
          expect(vi.getTimerCount()).toBe(1)

          sheet.unmount()
          expect(vi.getTimerCount()).toBe(0)

          advanceTimers(500)
          triggerCallback(capturedOnDismiss)
          expect(onDismiss).not.toHaveBeenCalled()
        },
      },
      {
        name: 'iOS dismissClosingSheets() and opening a second SheetModal supersede closing sheet into dismissing',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()

          // 1. dismissClosingSheets() while closing
          const first = createSheetHarness({ children: 'Sheet A' })
          advanceTimers(motionTokens.duration.sheet)
          first.sheet.update({ visible: false })
          advanceTimers(50)
          expect(asModal(first.sheet.tree).props?.visible).toBe(true)

          reactHarness.act(() => {
            dismissClosingSheets()
          })
          const firstDismissing = asModal(first.sheet.tree)
          expect(firstDismissing.props?.visible).toBe(false)
          expect(firstDismissing.props?.children).toBeNull()
          triggerCallback(firstDismissing.props?.onDismiss)
          expect(first.sheet.tree).toBeNull()
          expect(first.onDismiss).toHaveBeenCalledTimes(1)

          // 2. dismissClosingSheets() right before synchronous close skips closing animation straight to dismissing
          const routeClose = createSheetHarness({ children: 'Sheet Route' })
          advanceTimers(motionTokens.duration.sheet)
          reactHarness.act(() => {
            dismissClosingSheets()
          })
          routeClose.sheet.update({ visible: false })
          const routeDismissing = asModal(routeClose.sheet.tree)
          expect(routeDismissing.props?.visible).toBe(false)
          expect(routeDismissing.props?.children).toBeNull()
          triggerCallback(routeDismissing.props?.onDismiss)
          expect(routeClose.sheet.tree).toBeNull()
          expect(routeClose.onDismiss).toHaveBeenCalledTimes(1)

          // 3. Second SheetModal opening supersedes closing first SheetModal
          const prev = createSheetHarness({ children: 'Sheet Old' })
          advanceTimers(motionTokens.duration.sheet)
          prev.sheet.update({ visible: false })
          advanceTimers(50)
          expect(asModal(prev.sheet.tree).props?.visible).toBe(true)

          const next = createSheetHarness({ children: 'Sheet New' })
          expect(asModal(next.sheet.tree).props?.visible).toBe(true)
          const prevDismissing = asModal(prev.sheet.tree)
          expect(prevDismissing.props?.visible).toBe(false)
          expect(prevDismissing.props?.children).toBeNull()

          triggerCallback(prevDismissing.props?.onDismiss)
          expect(prev.sheet.tree).toBeNull()
          expect(prev.onDismiss).toHaveBeenCalledTimes(1)
          expect(asModal(next.sheet.tree).props?.visible).toBe(true)
        },
      },
      {
        name: 'Android close unmounts directly to null without entering dismissing',
        run: () => {
          mockEnv.platform.OS = 'android'
          vi.useFakeTimers()
          const { sheet, onDismiss } = createSheetHarness({ children: 'Android Sheet' })

          advanceTimers(motionTokens.duration.sheet)
          sheet.clearHistory()

          sheet.update({ visible: false })
          advanceTimers(100)
          expect(asModal(sheet.tree).props?.visible).toBe(true)

          advanceTimers(motionTokens.duration.sheetExit - 100)
          expect(sheet.tree).toBeNull()
          expect(
            sheet.history.some(node => findElement(node, el => el.type === 'Modal' && el.props?.visible === false)),
          ).toBe(false)
          expect(onDismiss).not.toHaveBeenCalled()

          // Superseded close on Android also unmounts straight to null without dismissing.
          const sheetA = createSheetHarness({ children: 'Android A' })
          advanceTimers(motionTokens.duration.sheet)
          sheetA.sheet.clearHistory()
          sheetA.sheet.update({ visible: false })
          createSheetHarness({ children: 'Android B' })
          expect(sheetA.sheet.tree).toBeNull()
          expect(
            sheetA.sheet.history.some(node => findElement(node, el => el.type === 'Modal' && el.props?.visible === false)),
          ).toBe(false)
        },
      },
    ], () => {
      reactHarness.unmountAll()
      mockEnv.platform.OS = 'ios'
      vi.useRealTimers()
      vi.restoreAllMocks()
    })
  })
})
