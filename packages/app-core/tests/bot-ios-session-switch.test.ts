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
  let reduceMotion = false
  let interruptNextTiming = false
  return {
    platform,
    get reduceMotion() {
      return reduceMotion
    },
    set reduceMotion(next: boolean) {
      reduceMotion = next
    },
    get interruptNextTiming() {
      return interruptNextTiming
    },
    set interruptNextTiming(next: boolean) {
      interruptNextTiming = next
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
      id: `bot-ios-${nextId}`,
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
    stopAnimation(cb?: (value: number) => void) {
      cb?.(this.value)
    }
    interpolate(config: { inputRange: number[]; outputRange: number[]; extrapolate?: string }) {
      const self = this
      return {
        value: self,
        config,
        resolve: (): number => {
          const [in0 = 0, in1 = 1] = config.inputRange
          const [out0 = 0, out1 = 1] = config.outputRange
          const span = in1 - in0
          const raw = span === 0 ? 0 : (self.value - in0) / span
          const t = config.extrapolate === 'clamp' ? Math.max(0, Math.min(1, raw)) : raw
          return out0 + (out1 - out0) * t
        },
      }
    }
  }

  return {
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(mockEnv.reduceMotion),
      addEventListener: () => ({ remove: () => undefined }),
    },
    ActivityIndicator: 'ActivityIndicator',
    Animated: {
      Value: MockAnimatedValue,
      View: 'Animated.View',
      timing(value: MockAnimatedValue, config: { toValue: number; duration: number }) {
        let timer: ReturnType<typeof setTimeout> | undefined
        let callback: ((result: { finished: boolean }) => void) | undefined
        let settled = false
        const shouldInterrupt = mockEnv.interruptNextTiming
        if (shouldInterrupt) {
          mockEnv.interruptNextTiming = false
        }
        return {
          start(cb?: (result: { finished: boolean }) => void) {
            callback = cb
            settled = false
            timer = setTimeout(() => {
              timer = undefined
              if (settled) return
              settled = true
              if (shouldInterrupt) {
                value.setValue((value.value + config.toValue) / 2)
                callback?.({ finished: false })
                return
              }
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
    AppState: {
      currentState: 'active',
      addEventListener: () => ({ remove: () => undefined }),
    },
    BackHandler: {
      addEventListener: () => ({ remove: () => undefined }),
    },
    Dimensions: {
      get: () => ({ width: 390, height: 844 }),
    },
    Easing: {
      cubic: (t: number) => t,
      in: (fn: (t: number) => number) => fn,
      out: (fn: (t: number) => number) => fn,
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
  ArrowLeftRight: 'ArrowLeftRight',
  Bot: 'Bot',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  Copy: 'Copy',
  CopyPlus: 'CopyPlus',
  FileText: 'FileText',
  FolderOpen: 'FolderOpen',
  Globe: 'Globe',
  Info: 'Info',
  Menu: 'Menu',
  MoreHorizontal: 'MoreHorizontal',
  MoreVertical: 'MoreVertical',
  Pause: 'Pause',
  Pencil: 'Pencil',
  Play: 'Play',
  Plus: 'Plus',
  Settings: 'Settings',
  Square: 'Square',
  Trash2: 'Trash2',
  Users: 'Users',
  X: 'X',
}))

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn<() => Promise<void>>(() => Promise.resolve()),
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }),
}))

vi.mock('../src/ui/use-reduce-motion', () => ({
  useReduceMotion: () => mockEnv.reduceMotion,
}))

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({
    colors: {
      background: '#ffffff',
      surface: '#f5f5f7',
      surfaceStrong: '#e8e8ed',
      card: '#ffffff',
      cardOpaque: '#ffffff',
      grouped: '#f2f2f7',
      border: '#d1d1d6',
      separator: '#c6c6c8',
      ink: '#111111',
      muted: '#6e6e73',
      subtle: '#8e8e93',
      primary: '#007aff',
      primarySoft: 'rgba(0, 122, 255, 0.12)',
      danger: '#ff3b30',
      modalBackdrop: 'rgba(15, 15, 15, 0.42)',
      scrim: 'rgba(0, 0, 0, 0.38)',
    },
    scheme: 'light',
  }),
}))

vi.mock('../src/ui/use-themed-styles', () => ({
  useThemedStyles: <T,>(factory: (colors: Record<string, string>) => T) =>
    factory({
      background: '#ffffff',
      surface: '#f5f5f7',
      surfaceStrong: '#e8e8ed',
      card: '#ffffff',
      cardOpaque: '#ffffff',
      grouped: '#f2f2f7',
      border: '#d1d1d6',
      separator: '#c6c6c8',
      ink: '#111111',
      muted: '#6e6e73',
      subtle: '#8e8e93',
      primary: '#007aff',
      primarySoft: 'rgba(0, 122, 255, 0.12)',
      danger: '#ff3b30',
      modalBackdrop: 'rgba(15, 15, 15, 0.42)',
      scrim: 'rgba(0, 0, 0, 0.38)',
    }),
}))

vi.mock('../src/locales/i18n', () => ({
  strings: {
    common: { close: '关闭', back: '返回' },
    automation: { pauseTask: '暂停', resumeTask: '恢复' },
    sessionActivity: { goal: '目标' },
    sessions: { moreActions: '更多操作' },
    settings: { more: '更多' },
    chat: { openHostSessions: '打开会话列表' },
    status: { offline: '离线' },
    workspaces: { offlineBody: '离线' },
    bots: {
      title: 'DS-Bot',
      details: '详情',
      browser: '浏览器',
      sessions: '会话',
      sessionsCount: (n: number) => `${n} 个会话`,
      calls: '调用',
      inputTokens: '输入',
      outputTokens: '输出',
      newSession: '新建会话',
      edit: '编辑',
      botSettings: 'Bot 设置',
      removeMain: '取消主理',
      replaceMain: '设为主理',
      duplicate: '复制',
      copyId: '复制 ID',
      delete: '删除',
      deleteHint: '确认删除？',
      cancel: '取消',
      stop: '停止',
      model: '模型',
      defaultModel: '默认模型',
      modelUnavailable: '不可用',
      effort: '思考强度',
      permissions: '权限',
      permReadOnly: '仅可查看',
      permWorkspace: '工作区内修改',
      permFullAccess: '完全权限',
      workingFolder: '工作文件夹',
      teamWorkspace: '总工作区',
      addInstructionsHint: '在 Bot 设置里添加说明',
      memory: '记忆',
      memoryEmpty: '暂无记忆',
      memoryCount: (n: number) => `${n} 条`,
      memoryManage: '管理',
      usage: '用量',
      usageSummary: (tokens: string, hit: number) => `${tokens} tok · 缓存命中 ${hit}%`,
      scheduledTasks: '定时任务',
      schedulesEnabled: (n: number) => `已启用 ${n} 个`,
      schedulesNoneAdd: '暂无定时任务，点击添加',
      pinChat: '置顶会话',
      members: '成员',
      currentSession: '当前会话',
      openEarlierSession: '切换到此历史会话',
      sessionNumber: (n: number) => `会话 #${n}`,
      unavailable: '不可用',
      retry: '重试',
      back: '返回',
      empty: '暂无 Bot',
      emptyHint: '请先创建',
      newBot: '新建 Bot',
      sessionUnavailable: '会话不可用',
    },
  },
}))

vi.mock('../src/services/browse-memory', () => ({
  browseScope: () => 'host-1',
}))

vi.mock('../src/services/bot-catalog', () => ({
  canDeleteBot: () => true,
  object: (v: unknown) => (v && typeof v === 'object' ? v : {}),
  objects: (v: unknown) => (Array.isArray(v) ? v : []),
  resolveBotTargetSessionId: () => undefined,
  text: (v: unknown) => (typeof v === 'string' ? v : ''),
}))

vi.mock('../src/state/store', () => ({
  useAppStore: <T,>(selector: (state: { sessions: Array<{ sessionId: string; title?: string }> }) => T) =>
    selector({
      sessions: [
        { sessionId: 'part-current', title: '当前对话' },
        { sessionId: 'part-older', title: '历史对话' },
      ],
    }),
  getConnectionGeneration: () => 1,
  requireBotClient: () => undefined,
}))

vi.mock('../src/state/bot-store', () => ({
  useBotTeamStore: Object.assign(
    <T,>(selector: (state: Record<string, unknown>) => T) =>
      selector({
        editor: undefined,
        detailsOpen: false,
        report: undefined,
        contextMenu: undefined,
      }),
    { getState: () => ({ refresh: () => Promise.resolve() }) },
  ),
}))

vi.mock('../src/ui/alert', () => ({
  Alert: { alert: vi.fn() },
}))

vi.mock('../src/ui/components', () => ({
  BlurHeaderFrame: 'BlurHeaderFrame',
  Button: 'Button',
  EmptyState: 'EmptyState',
  IconButton: 'IconButton',
  TopBar: 'TopBar',
}))

vi.mock('../src/ui/keyboard-inset', () => ({
  KeyboardInset: 'KeyboardInset',
}))

vi.mock('../src/ui/toggle', () => ({
  Toggle: 'Toggle',
}))

vi.mock('../src/screens/chat/modal', () => ({
  ModalSurface: 'ModalSurface',
}))

vi.mock('../src/screens/chat/expanded-composer', () => ({
  ExpandedComposer: 'ExpandedComposer',
}))

vi.mock('../src/screens/bot/agent-badge', () => ({
  BotAgentBadge: 'BotAgentBadge',
  engineOfModel: () => 'deepseek',
}))

vi.mock('../src/screens/bot/avatar', () => ({
  BotAvatar: 'BotAvatar',
  BotAvatarWithBadge: 'BotAvatarWithBadge',
  RoomAvatar: 'RoomAvatar',
}))

vi.mock('../src/screens/bot/conversation', () => ({
  BotConversation: 'BotConversation',
}))

vi.mock('../src/screens/bot/styles', () => ({
  createBotStyles: () => ({}),
}))

vi.mock('../src/screens/bot/shared-panels', () => ({
  BotBrowserPane: 'BotBrowserPane',
  BotFolderPickerModal: 'BotFolderPickerModal',
  BotMemoryPanel: 'BotMemoryPanel',
  BotSchedulesPanel: 'BotSchedulesPanel',
  folderBasename: (p: string) => p.split('/').pop() ?? p,
  formatCompactTokens: (n: number) => String(n),
  formatScheduleSummary: () => '',
}))

vi.mock('../src/screens/bot-sidebar-section', () => ({
  BotModalsHost: 'BotModalsHost',
  BotSidebarSection: 'BotSidebarSection',
  DsBotInstallCard: 'DsBotInstallCard',
  useBotTeamLoad: () => undefined,
}))

import {
  BOT_MODALS_LINGER_MS,
  BotFloatingPopover,
  isDrawerHostHidden,
  shouldRenderBotModalsHost,
} from '../src/screens/bot/popover-menu'
import { BotProfilePage } from '../src/screens/bot/profile-page'
import { runBotConversationEnterMotion } from '../src/screens/bot-mode-screen'
import type { BotEntry, BotState } from '../src/services/bot-catalog'

type ElementNode = { type: unknown; props?: Record<string, unknown> }
type PopoverProps = Parameters<typeof BotFloatingPopover>[0]
type ProfileProps = Parameters<typeof BotProfilePage>[0]

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

function findAllElements(node: unknown, predicate: (el: ElementNode) => boolean, acc: ElementNode[] = []): ElementNode[] {
  if (node === null || node === undefined || typeof node !== 'object') return acc
  if (Array.isArray(node)) {
    for (const item of node) findAllElements(item, predicate, acc)
    return acc
  }
  const el = node as ElementNode
  if (predicate(el)) acc.push(el)
  findAllElements(el.props?.children, predicate, acc)
  return acc
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

function mountPopover(initialProps: PopoverProps) {
  let currentProps = initialProps
  const inst = reactHarness.mount(() => BotFloatingPopover(currentProps))
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
    update(patch: Partial<PopoverProps>) {
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

const DEMO_BOT: BotEntry = {
  id: 'bot-1',
  sessionId: 'part-current',
  parts: ['part-older', 'part-current'],
  name: 'Helper Bot',
  role: 'Assistant',
  instructions: 'Help with tasks',
  model: 'deepseek/deepseek-chat',
  appliedModel: 'deepseek/deepseek-chat',
  effort: '',
  workDir: '/workspace/demo',
  permission: 'workspace-write',
  private: false,
  avatar: { shape: 'star' },
  main: true,
  pinned: false,
}

const DEMO_BOT_STATE: BotState = {
  mainBotId: 'bot-1',
  bots: [DEMO_BOT],
  rooms: [],
  agents: [],
  exchangeTurns: {},
  btwCards: {},
  btwSupported: true,
  sideChats: {},
  activity: {},
  work: {
    bots: {},
    rooms: {},
    waiting: {},
    turns: {},
    steered: {},
  },
  questions: {},
  views: {},
  closedCards: {},
  imVia: {},
  connectorRequests: {},
  mailRequests: {},
  memory: false,
  approvals: [],
  models: [],
  defaultModel: 'deepseek/deepseek-chat',
}

function mountProfile(initialProps: ProfileProps) {
  let currentProps = initialProps
  const inst = reactHarness.mount(() => BotProfilePage(currentProps))
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
    update(patch: Partial<ProfileProps>) {
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
  mockEnv.platform.OS = 'ios'
  mockEnv.reduceMotion = false
  mockEnv.interruptNextTiming = false
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('iOS DS-Bot session switching modal, scrim, and opacity regression suite (#643)', () => {
  it('BotFloatingPopover coordinates iOS dismissing Modal, action queue, 180ms fallback, reopen guard, and Android immediate unmount', async () => {
    await runScenarios([
      {
        name: 'iOS menu tap transitions through Modal(visible=false) before running session-switch action and unmounting',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const onDismiss = vi.fn<() => void>()
          const switchSessionAction = vi.fn<() => void>()

          const popover = mountPopover({
            visible: true,
            actions: [{ key: 'new-session', label: '新建会话', onPress: switchSessionAction }],
            onClose: () => {
              popover.update({ visible: false })
            },
            onDismiss,
          })

          expect(asModal(popover.tree).props?.visible).toBe(true)
          advanceTimers(160)

          const item = findElement(
            popover.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityRole === 'menuitem',
          )
          expect(item).toBeDefined()
          triggerCallback(item?.props?.onPress)

          // Action must wait until iOS native Modal finishes dismissing.
          const dismissingModal = asModal(popover.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          expect(dismissingModal.props?.children).toBeNull()
          expect(switchSessionAction).not.toHaveBeenCalled()

          triggerCallback(dismissingModal.props?.onDismiss)
          expect(popover.tree).toBeNull()
          expect(switchSessionAction).toHaveBeenCalledTimes(1)
          expect(onDismiss).toHaveBeenCalledTimes(1)
          expect(vi.getTimerCount()).toBe(0)
        },
      },
      {
        name: 'iOS clearing actions=[] during dismissal or missing onDismiss still settles via 180ms fallback without stranding Modal',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const onDismiss = vi.fn<() => void>()

          const popover = mountPopover({
            visible: true,
            actions: [{ key: 'details', label: '详情', onPress: () => {} }],
            onClose: () => {},
            onDismiss,
          })
          advanceTimers(160)

          // Simulate session/bot clearing actions simultaneously with hide.
          popover.update({ visible: false, actions: [] })
          const dismissingModal = asModal(popover.tree)
          expect(dismissingModal.props?.visible).toBe(false)

          advanceTimers(179)
          expect(asModal(popover.tree).props?.visible).toBe(false)
          expect(onDismiss).not.toHaveBeenCalled()

          advanceTimers(1)
          expect(popover.tree).toBeNull()
          expect(onDismiss).toHaveBeenCalledTimes(1)
        },
      },
      {
        name: 'iOS setting visible=true during dismissing waits for native onDismiss before reopening',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const popover = mountPopover({
            visible: true,
            actions: [{ key: 'a', label: 'A', onPress: () => {} }],
            onClose: () => {},
          })
          advanceTimers(160)

          popover.update({ visible: false })
          expect(asModal(popover.tree).props?.visible).toBe(false)

          popover.update({ visible: true })
          const stillDismissing = asModal(popover.tree)
          expect(stillDismissing.props?.visible).toBe(false)

          triggerCallback(stillDismissing.props?.onDismiss)
          expect(asModal(popover.tree).props?.visible).toBe(true)
        },
      },
      {
        name: 'Android close unmounts straight to null and runs action immediately',
        run: () => {
          mockEnv.platform.OS = 'android'
          vi.useFakeTimers()
          const action = vi.fn<() => void>()
          const popover = mountPopover({
            visible: true,
            actions: [{ key: 'new-session', label: '新建会话', onPress: action }],
            onClose: () => {
              popover.update({ visible: false })
            },
          })
          advanceTimers(160)

          const item = findElement(
            popover.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityRole === 'menuitem',
          )
          triggerCallback(item?.props?.onPress)
          expect(popover.tree).toBeNull()
          expect(action).toHaveBeenCalledTimes(1)
        },
      },
    ], () => {
      reactHarness.unmountAll()
      mockEnv.platform.OS = 'ios'
      vi.useRealTimers()
    })
  })

  it('BotProfilePage fades backdrop scrim to 0, defers session switch until iOS Modal dismisses, and recovers from interrupted close', async () => {
    await runScenarios([
      {
        name: 'iOS switching to an earlier session from BotProfilePage fades backdrop to 0, dismisses native Modal, then runs bot-open-part',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const perform = vi.fn<ProfileProps['perform']>(() => Promise.resolve({ ok: true }))
          const onDismiss = vi.fn<() => void>()

          const profile = mountProfile({
            visible: true,
            bot: DEMO_BOT,
            state: DEMO_BOT_STATE,
            busy: false,
            onClose: () => {
              profile.update({ visible: false })
            },
            onDismiss,
            onEdit: () => {},
            perform,
          })

          // Finish 250ms open slide-in -> backdrop opacity reaches 1.
          advanceTimers(250)
          const animatedViews = findAllElements(profile.tree, el => el.type === 'Animated.View')
          const backdropStyle = (animatedViews[0]?.props?.style as Array<Record<string, unknown>>) ?? []
          const opacityEntry = backdropStyle.find(entry => entry && typeof entry === 'object' && 'opacity' in entry) as
            | { opacity: { resolve: () => number } }
            | undefined
          expect(opacityEntry?.opacity.resolve()).toBe(1)

          const allPressables = findAllElements(profile.tree, el => el.type === 'Pressable')
          const sessionsEntry = allPressables.find(el => {
            const texts = findAllElements(el, child => child.type === 'Text')
            return texts.some(t => String(t.props?.children ?? '').includes('会话'))
          })
          expect(sessionsEntry).toBeDefined()
          triggerCallback(sessionsEntry?.props?.onPress)
          advanceTimers(240)

          const olderRow = findElement(
            profile.tree,
            el => el.type === 'Pressable' && el.props?.accessibilityLabel === '历史对话',
          )
          expect(olderRow).toBeDefined()
          triggerCallback(olderRow?.props?.onPress)

          // During 210ms slide-out, Modal stays visible while page & backdrop animate out; RPC waits for native dismiss.
          expect(perform).not.toHaveBeenCalled()
          expect(asModal(profile.tree).props?.visible).toBe(true)

          advanceTimers(210)
          const dismissingModal = asModal(profile.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          expect(dismissingModal.props?.children).toBeNull()
          expect(perform).not.toHaveBeenCalled()

          triggerCallback(dismissingModal.props?.onDismiss)
          expect(profile.tree).toBeNull()
          expect(perform).toHaveBeenCalledTimes(1)
          expect(perform).toHaveBeenCalledWith('bot-open-part', {
            botId: 'bot-1',
            sessionId: 'part-older',
          })
          expect(onDismiss).toHaveBeenCalledTimes(1)
          expect(vi.getTimerCount()).toBe(0)
        },
      },
      {
        name: 'iOS interrupted close animation or cleared bot prop still advances to dismissing and unmounts without leaving 0.14 dark scrim',
        run: () => {
          mockEnv.platform.OS = 'ios'
          vi.useFakeTimers()
          const onDismiss = vi.fn<() => void>()

          const profile = mountProfile({
            visible: true,
            bot: DEMO_BOT,
            state: DEMO_BOT_STATE,
            busy: false,
            onClose: () => {},
            onDismiss,
            onEdit: () => {},
            perform: () => Promise.resolve({ ok: true }),
          })
          advanceTimers(250)

          // Simulate UIKit interrupting native slide-out AND bot prop clearing simultaneously.
          mockEnv.interruptNextTiming = true
          profile.update({ visible: false, bot: undefined })

          advanceTimers(210)
          // Must NOT stay stuck with <Modal visible={true}> and off-screen page!
          const dismissingModal = asModal(profile.tree)
          expect(dismissingModal.props?.visible).toBe(false)
          expect(dismissingModal.props?.children).toBeNull()

          advanceTimers(180)
          expect(profile.tree).toBeNull()
          expect(onDismiss).toHaveBeenCalledTimes(1)
        },
      },
    ], () => {
      reactHarness.unmountAll()
      mockEnv.platform.OS = 'ios'
      mockEnv.interruptNextTiming = false
      vi.useRealTimers()
    })
  })

  it('runBotConversationEnterMotion never stalls fadeOpacity at 0.65 across interruption, rapid switch, reduceMotion, and cleanup', () => {
    let currentValue = 1
    let stopCalls = 0
    const enterAnim = {
      setValue(next: number) {
        currentValue = next
      },
      stopAnimation() {
        stopCalls += 1
      },
    }

    // 1. Interrupted native animation (`finished: false`) snaps back to 1 instead of stalling at 0.65.
    let savedCallback: ((res: { finished: boolean }) => void) | undefined
    let animStopCalls = 0
    const cleanup1 = runBotConversationEnterMotion(
      enterAnim,
      onDone => {
        savedCallback = onDone
        return {
          stop() {
            animStopCalls += 1
          },
        }
      },
      'bot-1',
      false,
    )
    expect(currentValue).toBe(0)
    expect(stopCalls).toBe(1)

    // Simulate iOS native driver cancelling timing mid-transition (e.g. at 0.2).
    currentValue = 0.2
    savedCallback?.({ finished: false })
    expect(currentValue).toBe(1)

    // 2. Rapid switch cleanup stops in-flight timing and resets to 1 without double-triggering.
    const cleanup2 = runBotConversationEnterMotion(
      enterAnim,
      onDone => {
        savedCallback = onDone
        return {
          stop() {
            animStopCalls += 1
            onDone({ finished: false })
          },
        }
      },
      'bot-2',
      false,
    )
    expect(currentValue).toBe(0)
    cleanup2?.()
    expect(animStopCalls).toBe(1)
    expect(currentValue).toBe(1)
    cleanup1?.()

    // 3. reduceMotion = true or undefined selectedId snaps immediately to 1 with no animation started.
    currentValue = 0
    expect(
      runBotConversationEnterMotion(
        enterAnim,
        () => {
          throw new Error('should not start animation when reduceMotion is true')
        },
        'bot-3',
        true,
      ),
    ).toBeUndefined()
    expect(currentValue).toBe(1)

    currentValue = 0
    expect(
      runBotConversationEnterMotion(
        enterAnim,
        () => {
          throw new Error('should not start animation when selectedId is undefined')
        },
        undefined,
        false,
      ),
    ).toBeUndefined()
    expect(currentValue).toBe(1)
  })

  it('shouldRenderBotModalsHost and isDrawerHostHidden prevent persistent drawer scrim leakage and mid-dismiss Modal teardown', () => {
    expect(BOT_MODALS_LINGER_MS).toBe(500)

    // Persistent overlay drawer host hides (`opacity: 0`) only when closed and not mid-smoothClose.
    expect(isDrawerHostHidden(false, false, false)).toBe(true)
    expect(isDrawerHostHidden(false, true, false)).toBe(false)
    expect(isDrawerHostHidden(false, true, true)).toBe(false)
    expect(isDrawerHostHidden(false, false, true)).toBe(false)
    expect(isDrawerHostHidden(true, false, false)).toBe(false)

    // Idle visible or hidden -> unmounted.
    expect(
      shouldRenderBotModalsHost({
        visible: true,
        hasStoreModal: false,
        deleteConfirmActive: false,
        lingerMounted: false,
      }),
    ).toBe(false)
    expect(
      shouldRenderBotModalsHost({
        visible: false,
        hasStoreModal: false,
        deleteConfirmActive: false,
        lingerMounted: false,
      }),
    ).toBe(false)

    // Modal just closed (`!hasStoreModal && !deleteConfirmActive`) right before drawer/screen hid -> stays mounted during linger!
    expect(
      shouldRenderBotModalsHost({
        visible: false,
        hasStoreModal: false,
        deleteConfirmActive: false,
        lingerMounted: true,
      }),
    ).toBe(true)

    // Store modal still open when host hides -> yields immediately to the newly visible host without duplicate presentation.
    expect(
      shouldRenderBotModalsHost({
        visible: false,
        hasStoreModal: true,
        deleteConfirmActive: false,
        lingerMounted: true,
      }),
    ).toBe(false)
  })
})
