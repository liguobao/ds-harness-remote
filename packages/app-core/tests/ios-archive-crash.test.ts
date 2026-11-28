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
  root: ComponentInstance | null
  render: () => unknown
  renderFn?: (props: Record<string, unknown>) => unknown
  props?: Record<string, unknown>
  tree: unknown
  history: unknown[]
  states: unknown[]
  refs: Array<{ current: unknown }>
  effects: Array<EffectSlot | undefined>
  memos: Array<MemoSlot | undefined>
  children: Map<string, ComponentInstance>
  mounted: boolean
  dirty: boolean
}

type NativeAlertCallButton = {
  text?: string
  style?: 'default' | 'cancel' | 'destructive'
  onPress?: () => void
}

const mockEnv = vi.hoisted(() => {
  const platform: { OS: 'ios' | 'android' } = { OS: 'ios' }
  let reduceMotion = false
  const rnAlertSpy = vi.fn<
    (
      title: string,
      message?: string,
      buttons?: NativeAlertCallButton[],
      options?: { cancelable?: boolean; onDismiss?: () => void },
    ) => void
  >()
  return {
    platform,
    rnAlertSpy,
    get reduceMotion() {
      return reduceMotion
    },
    set reduceMotion(next: boolean) {
      reduceMotion = next
    },
  }
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

  function renderInstance(inst: ComponentInstance): unknown {
    activeInstance = inst
    stateIndex = 0
    refIndex = 0
    effectIndex = 0
    memoIndex = 0
    let rawTree: unknown
    try {
      rawTree = inst.render()
    } finally {
      activeInstance = null
    }
    const visited = new Set<string>()
    const resolved = resolveNode(rawTree, inst, 'root', visited)
    for (const [key, child] of [...inst.children.entries()]) {
      if (!visited.has(key)) {
        unmountChildTree(child)
        inst.children.delete(key)
      }
    }
    return resolved
  }

  function resolveNode(
    node: unknown,
    parent: ComponentInstance,
    path: string,
    visited: Set<string>,
  ): unknown {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) {
      return node.map((item, idx) => resolveNode(item, parent, `${path}.${idx}`, visited))
    }
    const el = node as { type?: unknown; props?: Record<string, unknown> }
    if (typeof el.type === 'function') {
      const fn = el.type as (props: Record<string, unknown>) => unknown
      const key = `${path}:${fn.name || 'Component'}`
      const existing = parent.children.get(key)
      let child: ComponentInstance
      if (existing !== undefined && existing.renderFn === fn) {
        child = existing
      } else {
        if (existing !== undefined) unmountChildTree(existing)
        nextId += 1
        child = {
          id: `ios-archive-${nextId}`,
          root: parent.root ?? parent,
          render: () => fn(child.props ?? {}),
          renderFn: fn,
          tree: undefined,
          history: [],
          states: [],
          refs: [],
          effects: [],
          memos: [],
          children: new Map(),
          mounted: true,
          dirty: false,
        } as ComponentInstance & { props?: Record<string, unknown> }
        parent.children.set(key, child)
      }
      ;(child as ComponentInstance & { props?: Record<string, unknown> }).props = el.props ?? {}
      visited.add(key)
      return renderInstance(child)
    }
    if (el.props !== undefined && 'children' in el.props) {
      return {
        ...el,
        props: {
          ...el.props,
          children: resolveNode(el.props.children, parent, `${path}.c`, visited),
        },
      }
    }
    return node
  }

  function collectPendingEffects(
    inst: ComponentInstance,
    out: Array<{ inst: ComponentInstance; slot: EffectSlot; prevCleanup?: () => void }>,
  ): boolean {
    if (!inst.mounted) return false
    let found = false
    for (const slot of inst.effects) {
      if (slot && slot.pending) {
        found = true
        slot.pending = false
        out.push({ inst, slot, prevCleanup: slot.cleanup })
      }
    }
    for (const child of inst.children.values()) {
      if (collectPendingEffects(child, out)) found = true
    }
    return found
  }

  function unmountChildTree(inst: ComponentInstance) {
    if (!inst.mounted) return
    inst.mounted = false
    inst.dirty = false
    for (const child of inst.children.values()) {
      unmountChildTree(child)
    }
    inst.children.clear()
    for (const slot of inst.effects) {
      slot?.cleanup?.()
      if (slot) slot.cleanup = undefined
    }
  }

  function flush() {
    for (let pass = 0; pass < 50; pass += 1) {
      let didWork = false
      for (const inst of [...instances]) {
        if (!inst.mounted || !inst.dirty) continue
        didWork = true
        inst.dirty = false
        const nextTree = renderInstance(inst)
        inst.tree = nextTree
        inst.history.push(nextTree)
      }

      const pendingEffects: Array<{ inst: ComponentInstance; slot: EffectSlot; prevCleanup?: () => void }> = []
      for (const inst of [...instances]) {
        if (collectPendingEffects(inst, pendingEffects)) didWork = true
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
      id: `ios-archive-${nextId}`,
      root: null,
      render,
      tree: undefined,
      history: [],
      states: [],
      refs: [],
      effects: [],
      memos: [],
      children: new Map(),
      mounted: true,
      dirty: true,
    }
    instances.push(inst)
    act(() => {})
    return inst
  }

  function unmount(inst: ComponentInstance) {
    if (!inst.mounted) return
    unmountChildTree(inst)
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
      const target = inst.root ?? inst
      target.dirty = true
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
        const target = inst.root ?? inst
        target.dirty = true
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
    useSyncExternalStore<T>(
      subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
    ): T {
      const inst = requireInstance('useSyncExternalStore')
      reactHarness.useEffect(
        () =>
          subscribe(() => {
            reactHarness.triggerRender(inst)
          }),
        [subscribe],
      )
      return getSnapshot()
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
    useSyncExternalStore: reactHarness.useSyncExternalStore,
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
    stopAnimation(cb?: (value: number) => void) {
      cb?.(this.value)
    }
    interpolate(config: { inputRange: number[]; outputRange: number[] }) {
      return { value: this, config }
    }
  }

  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(mockEnv.reduceMotion),
      addEventListener: () => ({ remove: () => undefined }),
    },
    Alert: {
      alert: mockEnv.rnAlertSpy,
    },
    Animated: {
      Value: MockAnimatedValue,
      View: 'Animated.View',
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
      cubic: (t: number) => t,
      quad: (t: number) => t,
      in: (fn: (t: number) => number) => fn,
      out: (fn: (t: number) => number) => fn,
      inOut: (fn: (t: number) => number) => fn,
      bezier: (...points: number[]) => (t: number) => ({ points, t }),
    },
    Modal: 'Modal',
    Platform: mockEnv.platform,
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      hairlineWidth: 0.5,
      absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    },
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  }
})

vi.mock('lucide-react-native', () => ({
  Archive: 'Archive',
  ArchiveRestore: 'ArchiveRestore',
  ArrowRightLeft: 'ArrowRightLeft',
  Check: 'Check',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Folder: 'Folder',
  FolderCog: 'FolderCog',
  FolderPlus: 'FolderPlus',
  Info: 'Info',
  ListTree: 'ListTree',
  MessageSquare: 'MessageSquare',
  Pin: 'Pin',
  PinOff: 'PinOff',
  Search: 'Search',
  X: 'X',
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Path: 'Path',
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}))

vi.mock('../src/ui/use-reduce-motion', () => ({
  useReduceMotion: () => mockEnv.reduceMotion,
}))

const MOCK_COLORS = {
  background: '#ffffff',
  surface: '#f5f5f7',
  surfaceStrong: '#e8e8ed',
  surfaceMuted: '#f1f3f7',
  card: '#ffffff',
  cardOpaque: '#ffffff',
  grouped: '#f2f2f7',
  elevated: '#ffffff',
  border: '#d1d1d6',
  separator: '#c6c6c8',
  ink: '#0f0f0f',
  muted: '#6e6e73',
  subtle: '#8e8e93',
  primary: '#007aff',
  primarySoft: 'rgba(0, 122, 255, 0.12)',
  danger: '#ff3b30',
  dangerSoft: 'rgba(255, 59, 48, 0.12)',
  modalBackdrop: 'rgba(15, 15, 15, 0.42)',
  scrim: 'rgba(0, 0, 0, 0.38)',
  shadow: '#000000',
}

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({
    colors: MOCK_COLORS,
    scheme: 'light',
  }),
}))

vi.mock('../src/ui/use-themed-styles', () => ({
  useThemedStyles: <T,>(factory: (colors: typeof MOCK_COLORS) => T) => factory(MOCK_COLORS),
}))

vi.mock('../src/locales/i18n', () => ({
  strings: {
    common: { close: '关闭', back: '返回', cancel: '取消' },
    chat: {
      addToWorkspace: '添加到工作区',
      searchInChat: '在聊天中查找',
      selectWorkspace: '选择工作区',
      workspacePickerEmptyTitle: '暂无工作区',
      workspacePickerEmptyBody: '请在电脑端添加目录',
      manageWorkspaces: '管理工作区',
    },
    sessions: {
      pinSession: '置顶对话',
      unpinSession: '取消置顶',
      renameSession: '重命名',
      forkSession: '分支对话',
      copySessionId: '复制会话 ID',
      archiveSession: '归档对话',
      unarchiveSession: '取消归档',
      archiveTitle: '归档这段对话？',
      archiveBody: '归档后可在电脑端恢复。',
      archive: '归档',
      archiveFailed: '归档会话失败，请稍后重试',
    },
    trajectory: {
      open: '查看轨迹',
      close: '返回对话',
    },
    handoff: {
      action: '接力到其他 Agent',
    },
    sessionInfo: {
      title: '会话信息',
    },
  },
}))

import {
  CHAT_HEADER_POPOVER_DISMISS_FALLBACK_MS,
  ChatHeaderMenuPopover,
  type ChatHeaderMenuPopoverProps,
  type HeaderPopoverView,
} from '../src/screens/chat/header-menu-popover'
import {
  SESSION_CONTEXT_MENU_DISMISS_FALLBACK_MS,
  SessionContextMenuModal,
  type SessionContextMenuModalProps,
} from '../src/screens/session-context-menu-modal'
import { createModalActionQueue } from '../src/screens/chat/modal-action-queue'
import { Alert, AlertHost, resetIosAlertStateForTesting } from '../src/ui/alert'
import type { RemoteSession, WorkspaceView } from '../src/types'

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

const DEMO_SESSION: RemoteSession = {
  sessionId: 'sess-1',
  title: 'Drawer Archive Test',
  updatedAt: 1700000000000,
  running: false,
  blank: false,
  backend: 'harness',
}

function makeMenuProps(overrides?: Partial<SessionContextMenuModalProps>): SessionContextMenuModalProps {
  return {
    session: DEMO_SESSION,
    sessionTitle: 'Drawer Archive Test',
    isPinned: false,
    isArchived: false,
    canHandoff: true,
    onClose: () => undefined,
    runAfterClose: action => action(),
    onTogglePin: () => undefined,
    onRename: () => undefined,
    onFork: () => undefined,
    onHandoff: () => undefined,
    onToggleArchive: () => undefined,
    onCopySessionId: () => undefined,
    ...overrides,
  }
}

function mountContextMenu(initialProps: SessionContextMenuModalProps) {
  let currentProps = initialProps
  const inst = reactHarness.mount(() => SessionContextMenuModal(currentProps))
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
    update(patch: Partial<SessionContextMenuModalProps>) {
      currentProps = { ...currentProps, ...patch }
      reactHarness.act(() => {
        reactHarness.triggerRender(inst)
      })
    },
  }
}

const DEMO_WORKSPACES: WorkspaceView[] = [
  {
    workspaceId: 'ws-1',
    title: 'dsh-remote',
    path: '/repo/dsh-remote',
    sessionIds: ['sess-1'],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  },
]

function makePopoverProps(overrides?: Partial<ChatHeaderMenuPopoverProps>): ChatHeaderMenuPopoverProps {
  return {
    view: 'menu',
    onChangeView: () => undefined,
    runAfterClose: action => action(),
    sessionTitle: 'Fix iOS archive crash',
    sessionId: 'sess-1',
    workspaces: DEMO_WORKSPACES,
    connected: true,
    canSearch: true,
    canPin: true,
    isPinned: false,
    trajectory: false,
    canHandoff: true,
    canArchive: true,
    archived: false,
    onSearchInChat: () => undefined,
    onTogglePin: () => undefined,
    onToggleTrajectory: () => undefined,
    onHandoff: () => undefined,
    onOpenSessionInfo: () => undefined,
    onToggleArchive: () => undefined,
    onPickWorkspace: () => undefined,
    onManageWorkspaces: () => undefined,
    ...overrides,
  }
}

function mountHeaderPopover(initialProps: ChatHeaderMenuPopoverProps) {
  let currentProps = initialProps
  const inst = reactHarness.mount(() => ChatHeaderMenuPopover(currentProps))
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
    update(patch: Partial<ChatHeaderMenuPopoverProps>) {
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

afterEach(() => {
  reactHarness.unmountAll()
  resetIosAlertStateForTesting()
  mockEnv.platform.OS = 'ios'
  mockEnv.reduceMotion = false
  mockEnv.rnAlertSpy.mockReset()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('iOS session archive modal dismissal and native alert unwind regression suite (#249)', () => {
  it('ChatHeaderMenuPopover coordinates iOS 3-phase dismissal, reopen guard, 180ms fallback, and archive confirmation handoff', async () => {
    await runScenarios([
      {
        name: 'iOS tapping Archive dismisses popover Modal before presenting native Alert, then defers archiveSession past UIKit alert unwind',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const queue = createModalActionQueue(true)
          const events: string[] = []

          const popover = mountHeaderPopover(
            makePopoverProps({
              onDismiss: queue.onDismiss,
              onChangeView: (next: HeaderPopoverView | null) => {
                popover.update({ view: next })
              },
              runAfterClose: action => {
                queue.run(() => popover.update({ view: null }), action)
              },
              onToggleArchive: () => {
                events.push('present-archive-confirm')
                Alert.alert('归档这段对话？', '归档后可在电脑端恢复。', [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '归档',
                    style: 'destructive',
                    onPress: () => {
                      events.push('run-archive-rpc-and-clear-session')
                    },
                  },
                ])
              },
            }),
          )

          expect(asModal(popover.tree).props?.visible).toBe(true)
          advanceTimers(150)

          const archiveRow = findElement(
            popover.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '归档对话',
          )
          expect(archiveRow).toBeDefined()
          triggerCallback(archiveRow?.props?.onPress)

          // Popover enters `dismissing` (`<Modal visible={false}>{null}</Modal>`) before presenting UIAlertController.
          const dismissingModal = asModal(popover.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          expect(dismissingModal.props?.children).toBeNull()
          expect(mockEnv.rnAlertSpy).not.toHaveBeenCalled()
          expect(events).toEqual([])

          // Native popover Modal.onDismiss fires -> unmounts popover and presents UIAlertController.
          triggerCallback(dismissingModal.props?.onDismiss)
          expect(popover.tree).toBeNull()
          expect(events).toEqual(['present-archive-confirm'])
          expect(mockEnv.rnAlertSpy).toHaveBeenCalledTimes(1)

          // Simulate UIKit invoking the destructive button handler inside `[RCTAlertController hide]`.
          const alertButtons = mockEnv.rnAlertSpy.mock.calls[0]?.[2]
          const destructiveBtn = alertButtons?.find(b => b.style === 'destructive')
          expect(destructiveBtn).toBeDefined()
          destructiveBtn?.onPress?.()

          // Heavy session teardown (`selectedSession = undefined` / `onBack()`) must NOT run synchronously inside UIKit alert unwind.
          expect(events).toEqual(['present-archive-confirm'])

          advanceTimers(0)
          expect(events).toEqual(['present-archive-confirm', 'run-archive-rpc-and-clear-session'])
          expect(vi.getTimerCount()).toBe(0)
        },
      },
      {
        name: 'iOS setting view back to menu while dismissing waits for native Modal.onDismiss before reopening',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const onDismiss = vi.fn<() => void>()

          const popover = mountHeaderPopover(
            makePopoverProps({
              view: 'workspace-standalone',
              onDismiss,
            }),
          )
          advanceTimers(150)
          expect(containsText(popover.tree, '选择工作区')).toBe(true)

          popover.update({ view: null })
          expect(asModal(popover.tree).props?.visible).toBe(false)

          // Rapidly reopening while UIKit is still dismissing must stay in `dismissing` (`visible={false}`).
          popover.update({ view: 'menu', sessionTitle: 'Reopened Session' })
          const stillDismissing = asModal(popover.tree)
          expect(stillDismissing.props?.visible).toBe(false)
          expect(stillDismissing.props?.children).toBeNull()
          expect(onDismiss).not.toHaveBeenCalled()

          popover.clearHistory()
          triggerCallback(stillDismissing.props?.onDismiss)

          expect(onDismiss).toHaveBeenCalledTimes(1)
          expect(popover.history[0]).toBeNull()
          const reopenedModal = asModal(popover.tree)
          expect(reopenedModal.props?.visible).toBe(true)
          expect(containsText(popover.tree, 'Reopened Session')).toBe(true)
        },
      },
      {
        name: 'iOS settles via 180ms fallback if Modal.onDismiss never fires and ignores late onDismiss',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const onDismiss = vi.fn<() => void>()

          const popover = mountHeaderPopover(makePopoverProps({ onDismiss }))
          advanceTimers(150)

          popover.update({ view: null })
          const dismissingModal = asModal(popover.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          const capturedOnDismiss = dismissingModal.props?.onDismiss

          advanceTimers(CHAT_HEADER_POPOVER_DISMISS_FALLBACK_MS - 1)
          expect(asModal(popover.tree).props?.visible).toBe(false)
          expect(onDismiss).not.toHaveBeenCalled()

          advanceTimers(1)
          expect(popover.tree).toBeNull()
          expect(onDismiss).toHaveBeenCalledTimes(1)

          triggerCallback(capturedOnDismiss)
          expect(onDismiss).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'Android close unmounts straight to null and submenu back navigation stays mounted',
        run: () => {
          mockEnv.platform.OS = 'android'
          vi.useFakeTimers()
          const queue = createModalActionQueue(false)
          const onToggleArchive = vi.fn<() => void>()

          const popover = mountHeaderPopover(
            makePopoverProps({
              onChangeView: next => popover.update({ view: next }),
              runAfterClose: action => queue.run(() => popover.update({ view: null }), action),
              onToggleArchive,
            }),
          )

          // Submenu navigation `menu` -> `workspace-from-menu` -> `onRequestClose` back to `menu`.
          const addWsRow = findElement(
            popover.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '添加到工作区',
          )
          triggerCallback(addWsRow?.props?.onPress)
          expect(asModal(popover.tree).props?.visible).toBe(true)
          expect(containsText(popover.tree, '添加到工作区')).toBe(true)

          triggerCallback(asModal(popover.tree).props?.onRequestClose)
          expect(asModal(popover.tree).props?.visible).toBe(true)
          expect(containsText(popover.tree, '归档对话')).toBe(true)

          // Tapping Archive on Android unmounts immediately without entering `dismissing`.
          popover.clearHistory()
          const archiveRow = findElement(
            popover.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '归档对话',
          )
          triggerCallback(archiveRow?.props?.onPress)
          expect(popover.tree).toBeNull()
          expect(onToggleArchive).toHaveBeenCalledTimes(1)
          expect(
            popover.history.some(node => findElement(node, el => el.type === 'Modal' && el.props?.visible === false)),
          ).toBe(false)
        },
      },
    ], () => {
      reactHarness.unmountAll()
      resetIosAlertStateForTesting()
      mockEnv.platform.OS = 'ios'
      mockEnv.rnAlertSpy.mockReset()
      vi.useRealTimers()
    })
  })

  it('Alert.alert queues re-entrant iOS alerts during button unwind and preserves 2-arg and Android ConfirmDialog behavior', async () => {
    await runScenarios([
      {
        name: 'iOS re-entrant Alert.alert triggered inside button onPress waits for first alert unwind to finish',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()

          Alert.alert('归档这段对话？', '归档后可在电脑端恢复。', [
            { text: '取消', style: 'cancel' },
            {
              text: '归档',
              style: 'destructive',
              onPress: () => {
                // Immediate follow-up alert (e.g. validation or fast error) during button callback.
                Alert.alert('归档对话', '归档会话失败，请稍后重试')
              },
            },
          ])

          expect(mockEnv.rnAlertSpy).toHaveBeenCalledTimes(1)
          const destructive = mockEnv.rnAlertSpy.mock.calls[0]?.[2]?.find(b => b.style === 'destructive')
          destructive?.onPress?.()

          // Second RNAlert must NOT present while the first alert is still unwinding.
          expect(mockEnv.rnAlertSpy).toHaveBeenCalledTimes(1)

          // First tick runs button.onPress() and schedules queued follow-up alert on next clean tick.
          reactHarness.act(() => {
            vi.runOnlyPendingTimers()
          })
          expect(mockEnv.rnAlertSpy).toHaveBeenCalledTimes(1)

          // Second tick flushes the queued follow-up alert.
          reactHarness.act(() => {
            vi.runOnlyPendingTimers()
          })
          expect(mockEnv.rnAlertSpy).toHaveBeenCalledTimes(2)
          expect(mockEnv.rnAlertSpy.mock.calls[1]).toEqual([
            '归档对话',
            '归档会话失败，请稍后重试',
            undefined,
            undefined,
          ])
          expect(vi.getTimerCount()).toBe(0)
        },
      },
      {
        name: 'Android AlertHost still renders ConfirmDialog and runs destructive button immediately on close',
        run: () => {
          mockEnv.platform.OS = 'android'
          vi.useFakeTimers()
          const onArchive = vi.fn<() => void>()

          const host = reactHarness.mount(() => AlertHost())
          Alert.alert('归档这段对话？', '归档后可在电脑端恢复。', [
            { text: '取消', style: 'cancel' },
            { text: '归档', style: 'destructive', onPress: onArchive },
          ])

          expect(mockEnv.rnAlertSpy).not.toHaveBeenCalled()
          expect(asModal(host.tree).props?.visible).toBe(true)

          const confirmBtn = findElement(
            host.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '归档',
          )
          expect(confirmBtn).toBeDefined()
          triggerCallback(confirmBtn?.props?.onPress)
          expect(onArchive).toHaveBeenCalledTimes(1)
        },
      },
    ], () => {
      reactHarness.unmountAll()
      resetIosAlertStateForTesting()
      mockEnv.platform.OS = 'ios'
      mockEnv.rnAlertSpy.mockReset()
      vi.useRealTimers()
    })
  })

  it('SessionContextMenuModal coordinates iOS 3-phase dismissal, action sequencing, reopen guard, 500ms fallback, and Android immediate unmount', async () => {
    await runScenarios([
      {
        name: 'iOS tapping Archive transitions Modal to visible={false} with retained snapshot before unmounting and running archive',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const queue = createModalActionQueue(true)
          const events: string[] = []

          const menu = mountContextMenu(
            makeMenuProps({
              onDismiss: queue.onDismiss,
              onClose: () => menu.update({ session: null }),
              runAfterClose: action => queue.run(() => menu.update({ session: null }), action),
              onToggleArchive: () => {
                events.push('run-archive-from-drawer-menu')
              },
            }),
          )

          expect(asModal(menu.tree).props?.visible).toBe(true)
          const archiveRow = findElement(
            menu.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '归档对话',
          )
          expect(archiveRow).toBeDefined()
          triggerCallback(archiveRow?.props?.onPress)

          // Modal stays mounted with visible={false}, retains snapshot title, and blocks presses during dismissing.
          const dismissingModal = asModal(menu.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          expect(containsText(menu.tree, 'Drawer Archive Test')).toBe(true)
          expect(events).toEqual([])

          // Stale press during `dismissing` must be ignored.
          const staleRenameRow = findElement(
            menu.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '重命名',
          )
          expect(staleRenameRow?.props?.disabled).toBe(true)
          triggerCallback(staleRenameRow?.props?.onPress)
          expect(events).toEqual([])

          triggerCallback(dismissingModal.props?.onDismiss)
          expect(menu.tree).toBeNull()
          expect(events).toEqual(['run-archive-from-drawer-menu'])
          expect(vi.getTimerCount()).toBe(0)
        },
      },
      {
        name: 'iOS tapping Rename or Handoff waits for Modal.onDismiss before invoking follow-up Modal/sheet action',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const queue = createModalActionQueue(true)
          const onRename = vi.fn<(s: RemoteSession) => void>()

          const menu = mountContextMenu(
            makeMenuProps({
              onDismiss: queue.onDismiss,
              onClose: () => menu.update({ session: null }),
              runAfterClose: action => queue.run(() => menu.update({ session: null }), action),
              onRename,
            }),
          )

          const renameRow = findElement(
            menu.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '重命名',
          )
          triggerCallback(renameRow?.props?.onPress)

          const dismissingModal = asModal(menu.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          expect(onRename).not.toHaveBeenCalled()

          triggerCallback(dismissingModal.props?.onDismiss)
          expect(menu.tree).toBeNull()
          expect(onRename).toHaveBeenCalledTimes(1)
          expect(onRename).toHaveBeenCalledWith(DEMO_SESSION)
        },
      },
      {
        name: 'iOS reopening menuSession while dismissing waits for Modal.onDismiss before presenting next session',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const onDismiss = vi.fn<() => void>()

          const menu = mountContextMenu(makeMenuProps({ onDismiss }))
          menu.update({ session: null })
          expect(asModal(menu.tree).props?.visible).toBe(false)

          const nextSession: RemoteSession = {
            sessionId: 'sess-2',
            title: 'Second Session',
            updatedAt: 1700000001000,
            running: false,
            blank: false,
            backend: 'harness',
          }
          menu.update({ session: nextSession, sessionTitle: 'Second Session' })
          const stillDismissing = asModal(menu.tree)
          expect(stillDismissing.props?.visible).toBe(false)
          expect(onDismiss).not.toHaveBeenCalled()

          menu.clearHistory()
          triggerCallback(stillDismissing.props?.onDismiss)

          expect(onDismiss).toHaveBeenCalledTimes(1)
          expect(menu.history[0]).toBeNull()
          const reopenedModal = asModal(menu.tree)
          expect(reopenedModal.props?.visible).toBe(true)
          expect(containsText(menu.tree, 'Second Session')).toBe(true)
        },
      },
      {
        name: 'iOS settles via 500ms fallback if Modal.onDismiss never fires and ignores late onDismiss',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const onDismiss = vi.fn<() => void>()

          const menu = mountContextMenu(makeMenuProps({ onDismiss }))
          menu.update({ session: null })
          const dismissingModal = asModal(menu.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          const capturedOnDismiss = dismissingModal.props?.onDismiss

          advanceTimers(SESSION_CONTEXT_MENU_DISMISS_FALLBACK_MS - 1)
          expect(asModal(menu.tree).props?.visible).toBe(false)
          expect(onDismiss).not.toHaveBeenCalled()

          advanceTimers(1)
          expect(menu.tree).toBeNull()
          expect(onDismiss).toHaveBeenCalledTimes(1)

          triggerCallback(capturedOnDismiss)
          expect(onDismiss).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'Android close unmounts straight to null and runs action immediately without entering dismissing',
        run: () => {
          mockEnv.platform.OS = 'android'
          vi.useFakeTimers()
          const queue = createModalActionQueue(false)
          const onToggleArchive = vi.fn<(s: RemoteSession, wasArchived: boolean) => void>()

          const menu = mountContextMenu(
            makeMenuProps({
              onDismiss: queue.onDismiss,
              onClose: () => menu.update({ session: null }),
              runAfterClose: action => queue.run(() => menu.update({ session: null }), action),
              onToggleArchive,
            }),
          )

          menu.clearHistory()
          const archiveRow = findElement(
            menu.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '归档对话',
          )
          triggerCallback(archiveRow?.props?.onPress)
          expect(menu.tree).toBeNull()
          expect(onToggleArchive).toHaveBeenCalledTimes(1)
          expect(onToggleArchive).toHaveBeenCalledWith(DEMO_SESSION, false)
          expect(
            menu.history.some(node => findElement(node, el => el.type === 'Modal' && el.props?.visible === false)),
          ).toBe(false)
        },
      },
    ], () => {
      reactHarness.unmountAll()
      resetIosAlertStateForTesting()
      mockEnv.platform.OS = 'ios'
      mockEnv.rnAlertSpy.mockReset()
      vi.useRealTimers()
    })
  })
})
