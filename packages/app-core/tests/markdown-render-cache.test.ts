import { describe, expect, it, vi } from 'vitest'

const storeState = vi.hoisted(() => {
  ;(globalThis as { __DEV__?: boolean }).__DEV__ = false
  return {
    busyAction: undefined as string | undefined,
    themePreference: 'light' as const,
    chatAppearance: undefined as unknown,
    selectedSession: undefined as { backend?: string } | undefined,
    sessions: [] as { sessionId: string; backend?: string }[],
    retrySendMessage: vi.fn(async () => undefined),
    updateQueueItem: vi.fn(async () => undefined),
  }
})

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useCallback: <T,>(fn: T) => fn,
    useContext: <T,>(context: { _currentValue?: T }) => context._currentValue as T,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(value: T) => ({ current: value }),
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      vi.fn(),
    ],
  }
})

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: vi.fn(async () => false),
    addEventListener: vi.fn(() => ({ remove: () => undefined })),
  },
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Animated: {
    Value: class {
      constructor(public value: number) {}
      interpolate() {
        return this.value
      }
    },
    View: 'Animated.View',
    Text: 'Animated.Text',
    loop: () => ({ start: () => undefined, stop: () => undefined }),
    sequence: () => ({}),
    timing: () => ({}),
  },
  Image: 'Image',
  Linking: {
    openURL: vi.fn(async () => true),
    canOpenURL: vi.fn(async () => true),
  },
  Modal: 'Modal',
  Platform: {
    OS: 'android',
    select: <T,>(spec: { default?: T; android?: T; ios?: T }) => spec.android ?? spec.default,
  },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1,
  },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Path: 'Path',
  SvgXml: 'SvgXml',
}))

vi.mock('react-native-webview', () => ({
  WebView: 'WebView',
}))

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}))

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(async () => true),
}))

vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n),
}))

vi.mock('expo-file-system', () => ({}))
vi.mock('expo-file-system/legacy', () => ({}))
vi.mock('expo-secure-store', () => ({}))

vi.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: vi.fn(async () => undefined),
}))

vi.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: vi.fn(async () => undefined),
}))

vi.mock('expo-blur', () => ({
  BlurView: 'BlurView',
}))

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'zh-CN', languageCode: 'zh' }],
}))

vi.mock('../src/ui/duotone-icons', () => {
  const iconProxy = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === '__esModule') return true
      if (prop === 'then') return undefined
      return String(prop)
    },
    has: (_target, prop) => prop !== 'then',
  })
  return {
    DuotoneIcons: iconProxy,
    DuotoneIcon: 'DuotoneIcon',
    MotionPressable: 'Pressable',
  }
})

vi.mock('../src/ui/mermaid/mermaid-block', () => ({
  MermaidBlock: 'MermaidBlock',
}))

vi.mock('../src/screens/intelligent-ui-card', () => ({
  IntelligentUiCard: 'IntelligentUiCard',
}))

vi.mock('../src/state/store', () => ({
  readToolHistoryDetail: vi.fn(),
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}))

import {
  DEFAULT_CHAT_APPEARANCE,
  darkColors,
  lightColors,
  resolveThemeColors,
  type ChatAppearance,
  type ThemeColors,
} from '../src/ui/theme'
import { getCachedThemedStyles } from '../src/ui/use-themed-styles'
import {
  MAX_MARKDOWN_CACHE_ENTRIES,
  MAX_MARKDOWN_CACHE_TEXT_LEN,
  createStyles as createMarkdownStyles,
  extractReferencedFiles,
  parseMarkdownBlocks,
  type BlockParseCache,
} from '../src/ui/markdown'
import {
  MAX_HIGHLIGHT_CACHE_CODE_LEN,
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  highlightCodeCached,
} from '../src/ui/code-block'
import {
  ChatItemView,
  ChatProcessGroup,
  getUserBubblePalettes,
} from '../src/screens/chat/messages'
import type { ApprovalActivity, ChatMessage, QuestionActivity } from '../src/types'

type ElementNode = { type: unknown; props?: Record<string, unknown> }

function renderElementTree(node: unknown): unknown {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderElementTree)
  const el = node as ElementNode
  if (typeof el.type === 'function') {
    return renderElementTree((el.type as (props: Record<string, unknown>) => unknown)(el.props ?? {}))
  }
  const memoType = el.type as { type?: unknown } | undefined
  if (memoType !== undefined && typeof memoType === 'object' && typeof memoType.type === 'function') {
    return renderElementTree((memoType.type as (props: Record<string, unknown>) => unknown)(el.props ?? {}))
  }
  if (el.props !== undefined && 'children' in el.props) {
    return { ...el, props: { ...el.props, children: renderElementTree(el.props.children) } }
  }
  return el
}

function collectElements(
  node: unknown,
  predicate: (el: ElementNode) => boolean,
  out: ElementNode[] = [],
): ElementNode[] {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) collectElements(item, predicate, out)
    return out
  }
  const el = node as ElementNode
  if (predicate(el)) out.push(el)
  return collectElements(el.props?.children, predicate, out)
}

describe('getCachedThemedStyles', () => {
  it('reuses identical style references across calls and invalidates on colors or appearance changes', () => {
    let builds = 0
    const factory = (colors: ThemeColors, appearance: ChatAppearance) => {
      builds += 1
      return createMarkdownStyles(colors, appearance)
    }

    const first = getCachedThemedStyles(factory, lightColors, DEFAULT_CHAT_APPEARANCE)
    const second = getCachedThemedStyles(factory, lightColors, DEFAULT_CHAT_APPEARANCE)
    expect(second).toBe(first)
    expect(builds).toBe(1)

    const dark = getCachedThemedStyles(factory, darkColors, DEFAULT_CHAT_APPEARANCE)
    expect(dark).not.toBe(first)
    expect(builds).toBe(2)

    const largeAppearance: ChatAppearance = { ...DEFAULT_CHAT_APPEARANCE, fontScale: 'lg' }
    const largeLight = getCachedThemedStyles(factory, lightColors, largeAppearance)
    expect(largeLight).not.toBe(first)
    expect(largeLight.paragraph.fontSize).toBeGreaterThan(first.paragraph.fontSize as number)
    expect(builds).toBe(3)

    // Returning to a previously computed (colors, appearance) pair hits cache again.
    expect(getCachedThemedStyles(factory, lightColors, DEFAULT_CHAT_APPEARANCE)).toBe(first)
    expect(getCachedThemedStyles(factory, darkColors, DEFAULT_CHAT_APPEARANCE)).toBe(dark)
    expect(builds).toBe(3)

    // A separate factory maintains its own cache slot.
    const otherFactory = (colors: ThemeColors, appearance: ChatAppearance) => createMarkdownStyles(colors, appearance)
    const fromOther = getCachedThemedStyles(otherFactory, lightColors, DEFAULT_CHAT_APPEARANCE)
    expect(fromOther).not.toBe(first)
  })

  it('tolerates omitted appearance objects in lightweight test mocks without throwing', () => {
    let builds = 0
    const factory = (colors: ThemeColors) => {
      builds += 1
      return { color: colors.ink }
    }
    const omittedAppearance = undefined as unknown as ChatAppearance
    const first = getCachedThemedStyles(factory, lightColors, omittedAppearance)
    const second = getCachedThemedStyles(factory, lightColors, omittedAppearance)
    expect(second).toBe(first)
    expect(builds).toBe(1)
  })
})

describe('markdown block LRU and referenced file caches', () => {
  it('reuses parsed AST nodes and referenced files across independent instances', () => {
    const markdown = 'Read [Guide](docs/guide.md) and [API](./src/api.ts#L12).\r\n\r\nSecond paragraph.'
    const first = parseMarkdownBlocks(markdown, { current: undefined })
    const second = parseMarkdownBlocks(markdown, { current: undefined })
    expect(second).toBe(first)

    const filesA = extractReferencedFiles(first)
    const filesB = extractReferencedFiles(second)
    expect(filesB).toBe(filesA)
    expect(filesA).toEqual([
      { path: 'docs/guide.md', name: 'Guide' },
      { path: 'src/api.ts', name: 'API' },
    ])
  })

  it('keeps streaming appends incremental without polluting the module LRU with intermediate fragments', () => {
    const cacheRef: { current: BlockParseCache | undefined } = { current: undefined }
    const prefix = 'Paragraph one for streaming cache test.\n\nParagraph two start'
    const initial = parseMarkdownBlocks(prefix, cacheRef)

    const mid = `${prefix} with streamed chunk`
    const streamedMid = parseMarkdownBlocks(mid, cacheRef)
    expect(streamedMid[0]).toBe(initial[0])

    // Mid-stream fragment must not have been written into the module LRU.
    const freshMid = parseMarkdownBlocks(mid, { current: undefined })
    expect(freshMid).not.toBe(streamedMid)
    expect(freshMid[0]).not.toBe(initial[0])
  })

  it('evicts the least-recently-used entry once capacity is exceeded and keeps refreshed entries', () => {
    const tag = 'md-lru-evict'
    const entry0 = `${tag}:0`
    const entry1 = `${tag}:1`

    const first0 = parseMarkdownBlocks(entry0, { current: undefined })
    const first1 = parseMarkdownBlocks(entry1, { current: undefined })

    for (let index = 2; index < MAX_MARKDOWN_CACHE_ENTRIES; index += 1) {
      parseMarkdownBlocks(`${tag}:${index}`, { current: undefined })
    }

    // Refresh entry0 so entry1 becomes the oldest unaccessed item.
    expect(parseMarkdownBlocks(entry0, { current: undefined })).toBe(first0)

    // Inserting one more unique message must evict entry1 while retaining entry0.
    parseMarkdownBlocks(`${tag}:overflow`, { current: undefined })

    expect(parseMarkdownBlocks(entry0, { current: undefined })).toBe(first0)
    expect(parseMarkdownBlocks(entry1, { current: undefined })).not.toBe(first1)
  })

  it('bypasses the module LRU for oversized markdown payloads without evicting cached entries', () => {
    const survivorText = 'md-oversized-survivor-entry'
    const survivor = parseMarkdownBlocks(survivorText, { current: undefined })

    const oversized = `${'a'.repeat(MAX_MARKDOWN_CACHE_TEXT_LEN)}!`
    const parseA = parseMarkdownBlocks(oversized, { current: undefined })
    const parseB = parseMarkdownBlocks(oversized, { current: undefined })

    expect(parseA).not.toBe(parseB)
    expect(parseMarkdownBlocks(survivorText, { current: undefined })).toBe(survivor)
  })
})

describe('code block highlight LRU cache', () => {
  it('caches highlighted tokens per (language, code), enforces LRU eviction, and skips oversized code', () => {
    const snippet = 'const answer = 42 // cache-hit'
    const tsFirst = highlightCodeCached(snippet, 'ts')
    const tsSecond = highlightCodeCached(snippet, 'ts')
    expect(tsSecond).toBe(tsFirst)

    // Same source under another language gets its own cache slot.
    const pyTokens = highlightCodeCached(snippet, 'py')
    expect(pyTokens).not.toBe(tsFirst)

    const prefix = 'hl-lru'
    const code0 = `const v0 = "${prefix}:0"`
    const code1 = `const v1 = "${prefix}:1"`
    const hit0 = highlightCodeCached(code0, 'ts')
    const hit1 = highlightCodeCached(code1, 'ts')

    for (let index = 2; index < MAX_HIGHLIGHT_CACHE_ENTRIES; index += 1) {
      highlightCodeCached(`const v = "${prefix}:${index}"`, 'ts')
    }

    // Refresh code0 so code1 is evicted on overflow.
    expect(highlightCodeCached(code0, 'ts')).toBe(hit0)
    highlightCodeCached(`const overflow = "${prefix}:overflow"`, 'ts')

    expect(highlightCodeCached(code0, 'ts')).toBe(hit0)
    expect(highlightCodeCached(code1, 'ts')).not.toBe(hit1)

    // Oversized code bypasses cache completely.
    const huge = `${'x'.repeat(MAX_HIGHLIGHT_CACHE_CODE_LEN)}y`
    const hugeA = highlightCodeCached(huge, 'ts')
    const hugeB = highlightCodeCached(huge, 'ts')
    expect(hugeA).not.toBe(hugeB)
    expect(highlightCodeCached(code0, 'ts')).toBe(hit0)
  })
})

describe('chat message palette cache and targeted busyAction handling', () => {
  it('returns stable user bubble palettes per ThemeColors reference and isolates theme switches', () => {
    const lightA = getUserBubblePalettes(lightColors)
    const lightB = getUserBubblePalettes(lightColors)
    expect(lightB).toBe(lightA)
    expect(lightB.bubble).toBe(lightA.bubble)
    expect(lightB.solid).toBe(lightA.solid)
    expect(lightB.soft).toBe(lightA.soft)

    const dark = getUserBubblePalettes(darkColors)
    expect(dark).not.toBe(lightA)
    expect(dark.bubble.ink).toBe(darkColors.onInverse)
    expect(dark.soft.surfaceStrong).toBe(darkColors.border)

    const emeraldLight = resolveThemeColors('light', 'emerald')
    const emerald = getUserBubblePalettes(emeraldLight)
    expect(emerald).not.toBe(lightA)
    expect(emerald.solid.ink).toBe(emeraldLight.onPrimary)
  })

  it('keeps ChatProcessGroup memo intact on unrelated busyAction updates unless a pending interactive card exists', () => {
    const compare = (ChatProcessGroup as unknown as {
      compare: (prev: Record<string, unknown>, next: Record<string, unknown>) => boolean
    }).compare

    const assistantMsg: ChatMessage = {
      kind: 'message',
      id: 'm1',
      sessionId: 's1',
      createdAt: 1,
      role: 'assistant',
      text: 'done',
    }
    const pendingApproval: ApprovalActivity = {
      kind: 'approval',
      id: 'ap-1',
      approvalId: 'ap-1',
      sessionId: 's1',
      createdAt: 2,
      toolName: 'bash',
    }
    const onApproval = vi.fn(async () => undefined)
    const onQuestion = vi.fn(async () => undefined)
    const shared = {
      artifacts: [],
      updatedArtifacts: [],
      availableUiIds: new Set<string>(),
      isTurnRunning: false,
      onApproval,
      onQuestion,
    }

    expect(compare(
      { ...shared, items: [assistantMsg], busyAction: undefined },
      { ...shared, items: [assistantMsg], busyAction: 'send-message' },
    )).toBe(true)

    expect(compare(
      { ...shared, items: [pendingApproval], busyAction: undefined },
      { ...shared, items: [pendingApproval], busyAction: 'approval:ap-1' },
    )).toBe(false)
  })

  it('subscribes ApprovalCard and QuestionCard to targeted store busyAction when busyAction prop is omitted and preserves explicit overrides', () => {
    const approval: ApprovalActivity = {
      kind: 'approval',
      id: 'ap-42',
      approvalId: 'ap-42',
      sessionId: 's1',
      createdAt: 1,
      toolName: 'write_file',
    }
    const question: QuestionActivity = {
      kind: 'question',
      id: 'q-7',
      sessionId: 's1',
      createdAt: 2,
      questions: [{ id: 'q1', question: 'Continue?' }],
    }
    const onApproval = vi.fn(async () => undefined)
    const onQuestion = vi.fn(async () => undefined)

    const renderButtons = (element: unknown) => {
      const tree = renderElementTree(element)
      return collectElements(tree, el => el.props?.accessibilityRole === 'button')
    }

    // Store-driven when busyAction prop is omitted.
    storeState.busyAction = 'approval:ap-42'
    const approvalBusyTree = renderElementTree(
      (ChatItemView as unknown as { type: (p: unknown) => unknown }).type({
        item: approval,
        compact: false,
        onApproval,
        onQuestion,
      }),
    )
    const approvalBusyIndicators = collectElements(approvalBusyTree, el => el.type === 'ActivityIndicator')
    expect(approvalBusyIndicators.length).toBe(1)

    // Unrelated busyAction must not mark this approval busy.
    storeState.busyAction = 'approval:other'
    const approvalIdleTree = renderElementTree(
      (ChatItemView as unknown as { type: (p: unknown) => unknown }).type({
        item: approval,
        compact: false,
        onApproval,
        onQuestion,
      }),
    )
    expect(collectElements(approvalIdleTree, el => el.type === 'ActivityIndicator').length).toBe(0)

    // Explicit busyAction prop override still works even when store is idle.
    storeState.busyAction = undefined
    const explicitBusyTree = renderElementTree(
      (ChatItemView as unknown as { type: (p: unknown) => unknown }).type({
        item: approval,
        busyAction: 'approval:ap-42',
        compact: false,
        onApproval,
        onQuestion,
      }),
    )
    expect(collectElements(explicitBusyTree, el => el.type === 'ActivityIndicator').length).toBe(1)

    // QuestionCard also reacts to targeted store busyAction when omitted.
    storeState.busyAction = 'question:q-7'
    const questionBusyButtons = renderButtons(
      (ChatItemView as unknown as { type: (p: unknown) => unknown }).type({
        item: question,
        compact: false,
        onApproval,
        onQuestion,
      }),
    )
    expect(questionBusyButtons.some(el => (el.props?.accessibilityState as { busy?: boolean } | undefined)?.busy === true)).toBe(true)

    storeState.busyAction = undefined
  })
})
