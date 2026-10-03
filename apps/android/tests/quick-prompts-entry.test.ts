import { Pressable, Text, TextInput } from 'react-native'
import { SessionToolsPanel } from '../src/screens/session-tools-panel'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// pnpm's hoisted layout may install the renderer at the workspace root while
// Android keeps its own React version. Use the renderer's React for this test
// so component hooks and the renderer always share one dispatcher.
vi.mock('react', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const rendererRequire = createRequire(require.resolve('react-test-renderer'))
  return import(rendererRequire.resolve('react'))
})

const native = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  storage: new Map<string, string>(),
  back: undefined as (() => boolean) | undefined,
  dismiss: vi.fn(),
  send: vi.fn(async (_text: string) => true),
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Image: 'Image',
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View',
  Modal: ({ visible, children }: { visible: boolean; children: unknown }) => visible ? children : null,
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  Keyboard: { dismiss: native.dismiss, isVisible: () => false, metrics: () => undefined, addListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: (_: string, handler: () => boolean) => {
    native.back = handler
    return { remove() { native.back = undefined } }
  } },
  AccessibilityInfo: { announceForAccessibility: vi.fn() }, Alert: { alert: vi.fn() },
  Animated: {}, useWindowDimensions: () => ({ width: 360, height: 800 }),
}))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }))
vi.mock('expo-image-picker', () => ({}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => Object.fromEntries(
  'ArrowLeft AlertCircle CircleCheck WifiOff ArrowUp Bot Camera Check ChevronDown ChevronLeft ChevronRight CircleStop Code2 Folder Layers ListTree MessageSquare Paperclip Pencil Plus Shield Terminal Trash2 Images RefreshCw ShieldAlert Sparkles User X'.split(' ').map(name => [name, name]),
))
vi.mock('../src/ui/official-menu-icons', () => ({ OfficialMenuIcons: new Proxy({}, { get: (_, key) => String(key) }) }))
vi.mock('../src/state/store', () => ({
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(native.state), { getState: () => native.state }),
  requireSessionTools: vi.fn(),
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device',
  getItemAsync: vi.fn(async (key: string) => native.storage.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { native.storage.set(key, value) }),
  deleteItemAsync: vi.fn(async (key: string) => { native.storage.delete(key) }),
}))
vi.mock('expo-application', () => ({ applicationId: 'test.remote' }))
vi.mock('expo-device', () => ({ modelName: 'test' }))
vi.mock('expo-crypto', () => ({}))
vi.mock('../src/ui/markdown', () => ({ NativeMarkdown: 'NativeMarkdown' }))
vi.mock('../src/screens/session-tools-panel', () => ({ SessionToolsPanel: 'SessionToolsPanel' }))
vi.mock('../src/screens/message-actions', () => ({ MessageActions: 'MessageActions' }))

import { ChatTrajectory } from '../src/screens/chat-trajectory'
import { MentionPopover } from '../src/ui/mention-popover'
import { ChatScreen } from '../src/screens/chat-screen'
import { applyLanguagePreference, strings } from '../src/locales/i18n'
import { getBuiltInPrompts, saveCustomPrompts } from '../src/services/storage'

let screen: ReactTestRenderer
const onBack = vi.fn()
const element = () => createElement(ChatScreen, { onBack })
const button = (label: string) => screen.root.findAll(node => node.type === Pressable && node.props.accessibilityLabel === label)[0]!
const modal = () => screen.root.find(node => typeof node.type === 'function' && node.props.visible === true && node.props.onRequestClose !== undefined)
async function press(node: ReactTestInstance) { await act(async () => { node.props.onPress() }) }
async function mount() { await act(async () => { screen = create(element()) }) }
async function back() { await act(async () => { modal().props.onRequestClose() }) }

beforeEach(() => {
  vi.clearAllMocks()
  native.storage.clear()
  applyLanguagePreference('zh-CN')
  native.state = {
    selectedSession: { sessionId: 's1', updatedAt: 0, running: false, blank: true },
    messages: {}, connection: { phase: 'connected' }, workspaces: [], sessions: [],
    agentPresetOptions: [], sendMessage: native.send,
  }
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})
afterEach(async () => {
  if (screen) await act(async () => screen.unmount())
  vi.unstubAllGlobals()
})

describe('composer quick prompts entry', () => {
  it('dismisses command suggestions when opening the direct picker without losing the draft', async () => {
    native.state.selectedSession = { ...(native.state.selectedSession as object), backend: 'codex' }
    await mount()
    await act(async () => screen.root.findByType(TextInput).props.onChangeText('/'))
    expect(screen.root.findByType(MentionPopover)).toBeDefined()
    await press(button(strings.chat.quickPrompts))
    expect(screen.root.findAllByType(MentionPopover)).toHaveLength(0)
    expect(button(strings.chat.quickCheckChanges)).toBeDefined()
    await back()
    expect(screen.root.findByType(TextInput).findAllByType(Text).some(node => node.children.includes('/'))).toBe(true)
  })
  it.each(['harness', 'codex'])('opens directly and sends once on %s without changing the draft', async backend => {
    native.state.selectedSession = { ...(native.state.selectedSession as object), backend }
    await mount()
    const input = screen.root.findByType(TextInput)
    await act(async () => input.props.onChangeText('unfinished draft'))
    await press(button(strings.chat.quickPrompts))
    expect(native.dismiss).toHaveBeenCalledTimes(1)
    expect(native.send).not.toHaveBeenCalled()
    await press(button(strings.chat.quickCheckChanges))
    expect(native.send).toHaveBeenCalledTimes(1)
    expect(native.send).toHaveBeenCalledWith(strings.chat.quickCheckChangesPrompt)
    expect(screen.root.findAll(node => node.props.visible === true)).toHaveLength(0)
    expect(screen.root.findByType(TextInput).findAllByType(Text).map(node => node.children.join('')).join('')).toContain('unfinished draft')
    expect(onBack).not.toHaveBeenCalled()
  })

  it('returns editor -> manager -> picker -> chat, then lets hardware Back leave chat', async () => {
    await mount()
    await press(button(strings.chat.quickPrompts))
    await press(button(strings.chat.toolPromptEdit))
    await press(button(strings.chat.toolPromptAdd))
    expect(button(strings.chat.toolPromptSave)).toBeDefined()
    await back()
    expect(button(strings.chat.toolPromptAdd)).toBeDefined()
    await back()
    expect(button(strings.chat.quickCheckChanges)).toBeDefined()
    await back()
    expect(screen.root.findAll(node => node.props.visible === true)).toHaveLength(0)
    expect(onBack).not.toHaveBeenCalled()
    await act(async () => { expect(native.back?.()).toBe(true) })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it.each([{ phase: 'offline', permission: false }, { phase: 'connected', permission: true }])('disables entry for $phase / permission=$permission', async ({ phase, permission }) => {
    native.state.connection = { phase }
    native.state.permissionSelecting = permission
    await mount()
    expect(button(strings.chat.quickPrompts).props.disabled).toBe(true)
    expect(button(strings.chat.quickPrompts).props.accessibilityState.disabled).toBe(true)
  })

  it('uses saved overrides and deletions in the localized direct picker', async () => {
    applyLanguagePreference('en-US')
    await saveCustomPrompts([
      { id: 'builtin-commit', title: 'My commit', text: 'My saved instructions.' },
      { id: 'custom', title: 'My prompt', text: 'Custom instructions.' },
    ], ['builtin-view-screenshot'])
    await mount()
    expect(button('Prompts')).toBeDefined()
    await press(button('Prompts'))
    expect(button(getBuiltInPrompts()[0]!.title)).toBeDefined()
    expect(button(strings.chat.quickViewScreenshot)).toBeUndefined()
    await press(button('My commit'))
    expect(native.send).toHaveBeenCalledTimes(1)
    expect(native.send).toHaveBeenCalledWith('My saved instructions.')
  })

  it('keeps files, terminal and trajectory reachable in Tool access without a prompts row', async () => {
    await mount()
    await press(button(strings.chat.moreActions))
    await press(button(strings.chat.toolAccess))
    const pickTool = modal().findAll(node => node.type === Pressable && node.props.onPress !== undefined)
      .filter(node => node.props.accessibilityLabel === undefined)
    expect(pickTool).toHaveLength(3)
    await press(pickTool[0]!)
    expect(screen.root.findByType(SessionToolsPanel).props.mode).toBe('files')
    await act(async () => screen.root.findByType(SessionToolsPanel).props.onClose())
    await press(button(strings.chat.moreActions))
    await press(button(strings.chat.toolAccess))
    const rows = modal().findAll(node => node.type === Pressable && node.props.accessibilityLabel === undefined)
    await press(rows[1]!)
    expect(screen.root.findByType(SessionToolsPanel).props.mode).toBe('terminal')
    await act(async () => screen.root.findByType(SessionToolsPanel).props.onClose())
    await press(button(strings.chat.moreActions))
    await press(button(strings.chat.toolAccess))
    await press(modal().findAll(node => node.type === Pressable && node.props.accessibilityLabel === undefined)[2]!)
    expect(screen.root.findByType(ChatTrajectory)).toBeDefined()
    await act(async () => { expect(native.back?.()).toBe(true) })
    expect(onBack).not.toHaveBeenCalled()
  })
})
