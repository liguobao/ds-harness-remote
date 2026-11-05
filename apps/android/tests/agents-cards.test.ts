import { describe, expect, it, vi, beforeEach } from 'vitest'

/** Stateful useState so the inline "append instruction" flow can be driven across re-renders. */
const hookState = vi.hoisted(() => ({
  slots: [] as any[],
  cursor: 0,
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: (v: any) => ({ current: v }),
    useEffect: () => {},
    useState: (init: any) => {
      const index = hookState.cursor++
      if (!hookState.slots[index]) {
        const slot: any = { value: typeof init === 'function' ? init() : init }
        slot.setter = vi.fn((next: any) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next
        })
        hookState.slots[index] = slot
      }
      const slot = hookState.slots[index]
      return [slot.value, slot.setter]
    },
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
  }
})

vi.mock('react-native', () => {
  const React = require('react')
  return {
    Platform: { OS: 'android' },
    StyleSheet: {
      create: (styles: any) => styles,
      hairlineWidth: 1,
    },
    View: (props: any) => React.createElement('View', props, props.children),
    Text: (props: any) => React.createElement('Text', props, props.children),
    Pressable: (props: any) => React.createElement('Pressable', props, props.children),
    ScrollView: (props: any) => React.createElement('ScrollView', props, props.children),
    TextInput: (props: any) => React.createElement('TextInput', props, props.children),
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props, props.children),
    Animated: {
      Value: class {
        interpolate = vi.fn().mockReturnValue('0deg')
      },
      timing: () => ({ start: vi.fn(), stop: vi.fn() }),
      loop: (anim: any) => ({ start: vi.fn(), stop: vi.fn() }),
      View: (props: any) => React.createElement('AnimatedView', props, props.children),
    },
    Easing: { linear: (x: any) => x },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
    Modal: (props: any) => props.visible ? React.createElement('Modal', props, props.children) : null,
  }
})

vi.mock('react-native-svg', () => {
  const React = require('react')
  return {
    default: (props: any) => React.createElement('Svg', props, props.children),
    Svg: (props: any) => React.createElement('Svg', props, props.children),
    Circle: (props: any) => React.createElement('Circle', props, props.children),
    Path: (props: any) => React.createElement('Path', props, props.children),
    Rect: (props: any) => React.createElement('Rect', props, props.children),
    G: (props: any) => React.createElement('G', props, props.children),
  }
})

vi.mock('lucide-react-native', () => {
  const React = require('react')
  return {
    ChevronDown: (props: any) => React.createElement('ChevronDown', props),
    ChevronUp: (props: any) => React.createElement('ChevronUp', props),
    ChevronRight: (props: any) => React.createElement('ChevronRight', props),
    Layers: (props: any) => React.createElement('Layers', props),
    Users: (props: any) => React.createElement('Users', props),
    X: (props: any) => React.createElement('X', props),
    Flag: (props: any) => React.createElement('Flag', props),
    PauseCircle: (props: any) => React.createElement('PauseCircle', props),
    Square: (props: any) => React.createElement('Square', props),
  }
})

vi.mock('../src/state/store', () => ({
  requireSessionTools: () => ({
    watchJobs: vi.fn(),
  }),
}))

const MOCK_THEME_COLORS = {
  card: '#FFFFFF',
  border: '#E5E7EB',
  separator: '#F3F4F6',
  surface: '#FFFFFF',
  surfaceStrong: '#F9FAFB',
  ink: '#111827',
  muted: '#6B7280',
  subtle: '#9CA3AF',
  primary: '#1677FF',
  primarySoft: '#EBEFFF',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  dangerSoft: '#FDECEC',
} as const

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({
    colors: MOCK_THEME_COLORS,
    isDark: false,
  }),
}))

import React from 'react'
import {
  AgentStatusGlyph,
  AgentTeamCard,
  SubagentsCard,
  SubagentPromptInput,
  isContinuableSubagent,
  formatSubagentStats,
  formatTeamStats,
  parseAgentLabel,
} from '../src/screens/chat/agents'
import { strings } from '../src/locales/i18n'
import type { RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../src/types'

const copy = () => strings.sessionActivity

const renderSubagentsCard = (props: any) => { hookState.cursor = 0; return ((SubagentsCard as any).type ?? SubagentsCard)(props) }
const renderAgentTeamCard = (props: any) => { hookState.cursor = 0; return ((AgentTeamCard as any).type ?? AgentTeamCard)(props) }
const renderStatusGlyph = (props: any) => { hookState.cursor = 0; return ((AgentStatusGlyph as any).type ?? AgentStatusGlyph)(props) }
const renderPromptInput = (props: any) => { hookState.cursor = 0; return (SubagentPromptInput as any)(props) }

/** Recursively collect React elements from a directly-invoked component's element tree. */
function walk(node: any, out: any[] = []): any[] {
  if (node == null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  out.push(node)
  const children = node.props?.children
  if (children !== undefined && children !== null) walk(children, out)
  return out
}
const findById = (root: any, id: string) => walk(root).find(el => el?.props?.testID === id)
const pressEvent = () => ({ stopPropagation: vi.fn() })

beforeEach(() => {
  hookState.slots = []
  hookState.cursor = 0
})

describe('Subagents and Agent Team Cards (子任务与智能体团队卡片)', () => {
  describe('parseAgentLabel', () => {
    it('parses Chinese role and task labels', () => {
      const parsed1 = parseAgentLabel('你是代码审查员。任务：检查 TypeScript 类型安全')
      expect(parsed1.role).toBe('代码审查员')
      expect(parsed1.task).toBe('检查 TypeScript 类型安全')

      const parsed2 = parseAgentLabel('你是架构师，你的任务：设计多智能体系统')
      expect(parsed2.role).toBe('架构师')
      expect(parsed2.task).toBe('设计多智能体系统')
    })

    it('parses English role and task labels', () => {
      const parsed1 = parseAgentLabel('You are a tester. Task: run unit test suites')
      expect(parsed1.role).toBe('tester')
      expect(parsed1.task).toBe('run unit test suites')

      const parsed2 = parseAgentLabel('You are the lead. Your task: coordinate team')
      expect(parsed2.role).toBe('lead')
      expect(parsed2.task).toBe('coordinate team')
    })

    it('falls back to whole raw text as task when no role prefix matches', () => {
      const parsed = parseAgentLabel('单次构建与格式化检查任务')
      expect(parsed.role).toBeUndefined()
      expect(parsed.task).toBe('单次构建与格式化检查任务')
    })
  })

  describe('formatSubagentStats', () => {
    it('formats running and total count properly', () => {
      const sessions: RemoteSession[] = [
        { sessionId: 's1', title: '子任务 1', running: true } as any,
        { sessionId: 's2', title: '子任务 2', running: false } as any,
      ]
      const stats = formatSubagentStats(sessions)
      expect(stats.runningCount).toBe(1)
      expect(stats.totalCount).toBe(2)
      expect(stats.statsText).toBe('1/2')
    })

    it('shows only total count when no subagents are running', () => {
      const sessions: RemoteSession[] = [
        { sessionId: 's1', title: '子任务 1', running: false } as any,
        { sessionId: 's2', title: '子任务 2', running: false } as any,
      ]
      const stats = formatSubagentStats(sessions)
      expect(stats.runningCount).toBe(0)
      expect(stats.totalCount).toBe(2)
      expect(stats.statsText).toBe('2')
    })
  })

  describe('formatTeamStats', () => {
    it('counts live running sessions and provisioning members', () => {
      const members: TeamMemberSnapshot[] = [
        { id: 'm1', phase: 'active', name: 'lead' } as any,
        { id: 'm2', phase: 'provisioning', name: 'coder' } as any,
        { id: 'm3', phase: 'active', name: 'reviewer' } as any,
      ]
      const sessions: RemoteSession[] = [
        { sessionId: 'm1', running: true } as any,
        { sessionId: 'm3', running: false } as any,
      ]
      const stats = formatTeamStats(members, sessions)
      expect(stats.activeCount).toBe(2)
      expect(stats.totalCount).toBe(3)
      expect(stats.statsText).toBe('2/3')
    })

    it('shows total count when none are active', () => {
      const members: TeamMemberSnapshot[] = [
        { id: 'm1', phase: 'active', name: 'lead' } as any,
      ]
      const sessions: RemoteSession[] = [
        { sessionId: 'm1', running: false } as any,
      ]
      const stats = formatTeamStats(members, sessions)
      expect(stats.activeCount).toBe(0)
      expect(stats.statsText).toBe('1')
    })
  })

  describe('isContinuableSubagent', () => {
    it('excludes one-shot and external subagents, allows the rest', () => {
      expect(isContinuableSubagent({ mode: 'one-shot' } as any)).toBe(false)
      expect(isContinuableSubagent({ mode: 'external' } as any)).toBe(false)
      expect(isContinuableSubagent({} as any)).toBe(true)
      expect(isContinuableSubagent({ mode: 'continuous' } as any)).toBe(true)
    })
  })

  describe('AgentStatusGlyph', () => {
    it('renders correct glyphs for each status', () => {
      const runningGlyph = renderStatusGlyph({ status: 'running', colors: MOCK_THEME_COLORS })
      expect(runningGlyph.props.testID).toBe('agent-glyph-running')

      const provGlyph = renderStatusGlyph({ status: 'provisioning', colors: MOCK_THEME_COLORS })
      expect(provGlyph.props.testID).toBe('agent-glyph-provisioning')

      const failedGlyph = renderStatusGlyph({ status: 'failed', colors: MOCK_THEME_COLORS })
      expect(failedGlyph.props.testID).toBe('agent-glyph-failed')

      const completedGlyph = renderStatusGlyph({ status: 'completed', colors: MOCK_THEME_COLORS })
      expect(completedGlyph.props.testID).toBe('agent-glyph-completed')

      const idleGlyph = renderStatusGlyph({ status: 'idle', colors: MOCK_THEME_COLORS })
      expect(idleGlyph.props.testID).toBe('agent-glyph-idle')
    })
  })

  describe('SubagentsCard', () => {
    const mockSessions: RemoteSession[] = [
      {
        sessionId: 'sub-1',
        title: '你是测试员。任务：执行验收测试',
        running: true,
      } as any,
      {
        sessionId: 'sub-2',
        title: '你是审查员。任务：验证安全规范',
        running: false,
      } as any,
    ]

    it('returns null when sessions list is empty', () => {
      const el = renderSubagentsCard({ sessions: [] })
      expect(el).toBeNull()
    })

    it('renders collapsed state by default (no expanded content)', () => {
      const el = renderSubagentsCard({ sessions: mockSessions, expanded: false })
      expect(el.props.testID).toBe('subagents-card')
      expect(findById(el, 'subagents-card-content')).toBeFalsy()
    })

    it('renders expanded list with items, role, task, and invokes onOpen', () => {
      const onOpen = vi.fn()
      const el = renderSubagentsCard({
        sessions: mockSessions,
        expanded: true,
        onOpen,
      })
      expect(findById(el, 'subagents-card-content')).toBeTruthy()
      expect(findById(el, 'subagents-card-item-0')).toBeTruthy()
      expect(findById(el, 'subagents-card-item-1')).toBeTruthy()

      const open = findById(el, 'subagents-card-open-0')
      expect(open.props.accessibilityLabel).toContain('测试员')
      expect(open.props.accessibilityLabel).toContain('执行验收测试')

      open.props.onPress()
      expect(onOpen).toHaveBeenCalledWith(mockSessions[0])
    })

    it('triggers onToggle when header is pressed', () => {
      const onToggle = vi.fn()
      const el = renderSubagentsCard({
        sessions: mockSessions,
        expanded: false,
        onToggle,
      })
      findById(el, 'subagents-card-header').props.onPress()
      expect(onToggle).toHaveBeenCalled()
    })

    it('hides all live-control buttons unless canControl is true', () => {
      const off = renderSubagentsCard({ sessions: mockSessions, expanded: true, canControl: false })
      expect(findById(off, 'subagents-card-controls-0')).toBeFalsy()
      expect(findById(off, 'subagents-card-stop-0')).toBeFalsy()
      expect(findById(off, 'subagents-card-prompt-0')).toBeFalsy()

      const missing = renderSubagentsCard({ sessions: mockSessions, expanded: true })
      expect(findById(missing, 'subagents-card-controls-0')).toBeFalsy()
    })

    it('renders a stop + prompt button for a running controllable subagent', () => {
      const el = renderSubagentsCard({ sessions: mockSessions, expanded: true, canControl: true })
      const stop = findById(el, 'subagents-card-stop-0')
      const prompt = findById(el, 'subagents-card-prompt-0')
      expect(stop).toBeTruthy()
      expect(prompt).toBeTruthy()
      expect(stop.props.accessibilityLabel).toBe(copy().stopSubagent)
      expect(prompt.props.accessibilityLabel).toBe(copy().promptSubagent)
      // idle subagent: no stop button, prompt button still present
      expect(findById(el, 'subagents-card-stop-1')).toBeFalsy()
      expect(findById(el, 'subagents-card-prompt-1')).toBeTruthy()
    })

    it('stop button calls onStop, blocks propagation and does NOT open the session', () => {
      const onStop = vi.fn()
      const onOpen = vi.fn()
      const el = renderSubagentsCard({ sessions: mockSessions, expanded: true, canControl: true, onStop, onOpen })
      const e = pressEvent()
      findById(el, 'subagents-card-stop-0').props.onPress(e)
      expect(e.stopPropagation).toHaveBeenCalled()
      expect(onStop).toHaveBeenCalledWith(mockSessions[0])
      expect(onOpen).not.toHaveBeenCalled()
    })

    it('stop button shows a spinner, is disabled and ignores taps while its busyAction is set', () => {
      const onStop = vi.fn()
      const el = renderSubagentsCard({
        sessions: mockSessions,
        expanded: true,
        canControl: true,
        onStop,
        busyAction: 'subagent:stop:sub-1',
      })
      const stop = findById(el, 'subagents-card-stop-0')
      expect(stop.props.disabled).toBe(true)
      expect(stop.props.accessibilityLabel).toBe(copy().stoppingSubagent)
      expect(findById(el, 'subagents-card-stop-spinner-0')).toBeTruthy()
      const e = pressEvent()
      stop.props.onPress(e)
      expect(e.stopPropagation).toHaveBeenCalled()
      expect(onStop).not.toHaveBeenCalled()
    })

    it('excludes one-shot and external subagents from live controls', () => {
      const sessions = [
        { sessionId: 'one', title: 'A', running: true, mode: 'one-shot' } as any,
        { sessionId: 'ext', title: 'B', running: true, mode: 'external' } as any,
        { sessionId: 'live', title: 'C', running: true } as any,
      ]
      const el = renderSubagentsCard({ sessions, expanded: true, canControl: true })
      expect(findById(el, 'subagents-card-controls-0')).toBeFalsy()
      expect(findById(el, 'subagents-card-controls-1')).toBeFalsy()
      expect(findById(el, 'subagents-card-controls-2')).toBeTruthy()
    })

    it('追加指令 opens the inline input and sends the appended text to onPrompt', async () => {
      const onPrompt = vi.fn().mockResolvedValue(true)
      const onOpen = vi.fn()
      const session = mockSessions[0]!
      const props = { sessions: [session], expanded: true, canControl: true, onPrompt, onOpen }

      let el = renderSubagentsCard(props)
      const e1 = pressEvent()
      findById(el, 'subagents-card-prompt-0').props.onPress(e1)
      expect(e1.stopPropagation).toHaveBeenCalled()
      expect(onOpen).not.toHaveBeenCalled()

      // Re-render: the inline quick-input row is now mounted for this child.
      el = renderSubagentsCard(props)
      let input = findById(el, 'subagents-card-prompt-input-0')
      expect(input).toBeTruthy()
      expect(input.props.busy).toBe(false)
      expect(input.props.value).toBe('')
      expect(hookState.slots[1].setter).toHaveBeenCalledWith(session.sessionId)

      // Type text, re-render so the send handler captures the new promptText.
      input.props.onChangeText('请补充测试')
      el = renderSubagentsCard(props)
      input = findById(el, 'subagents-card-prompt-input-0')
      const e2 = pressEvent()
      await input.props.onSend(e2)
      expect(e2.stopPropagation).toHaveBeenCalled()
      expect(onPrompt).toHaveBeenCalledWith(session, '请补充测试')

      // Success clears + collapses the input row.
      expect(hookState.slots[1].setter).toHaveBeenCalledWith(null)
      expect(hookState.slots[2].setter).toHaveBeenCalledWith('')
      el = renderSubagentsCard(props)
      expect(findById(el, 'subagents-card-prompt-input-0')).toBeFalsy()
    })

    it('keeps the inline input open when onPrompt reports failure (false)', async () => {
      const onPrompt = vi.fn().mockResolvedValue(false)
      const props = { sessions: [mockSessions[0]], expanded: true, canControl: true, onPrompt }
      let el = renderSubagentsCard(props)
      findById(el, 'subagents-card-prompt-0').props.onPress(pressEvent())
      el = renderSubagentsCard(props)
      const input = findById(el, 'subagents-card-prompt-input-0')
      input.props.onChangeText('重试一次')
      el = renderSubagentsCard(props)
      await findById(el, 'subagents-card-prompt-input-0').props.onSend(pressEvent())
      el = renderSubagentsCard(props)
      expect(findById(el, 'subagents-card-prompt-input-0')).toBeTruthy()
    })

    it('cancel closes the inline input', () => {
      const props = { sessions: [mockSessions[0]], expanded: true, canControl: true }
      let el = renderSubagentsCard(props)
      findById(el, 'subagents-card-prompt-0').props.onPress(pressEvent())
      el = renderSubagentsCard(props)
      const input = findById(el, 'subagents-card-prompt-input-0')
      const e = pressEvent()
      input.props.onCancel(e)
      expect(e.stopPropagation).toHaveBeenCalled()
      el = renderSubagentsCard(props)
      expect(findById(el, 'subagents-card-prompt-input-0')).toBeFalsy()
    })

    it('marks the inline input busy when its prompt busyAction is set', () => {
      const props = {
        sessions: [mockSessions[0]],
        expanded: true,
        canControl: true,
        busyAction: 'subagent:prompt:sub-1',
      }
      let el = renderSubagentsCard(props)
      findById(el, 'subagents-card-prompt-0').props.onPress(pressEvent())
      el = renderSubagentsCard(props)
      expect(findById(el, 'subagents-card-prompt-input-0').props.busy).toBe(true)
    })
  })

  describe('SubagentPromptInput', () => {
    const base = () => ({
      value: 'hello',
      onChangeText: vi.fn(),
      onSend: vi.fn(),
      onCancel: vi.fn(),
      busy: false,
      testID: 'pi',
    })

    it('renders the localized placeholder, send and cancel controls', () => {
      const el = renderPromptInput(base())
      expect(findById(el, 'pi-field').props.placeholder).toBe(copy().promptSubagentPlaceholder)
      expect(findById(el, 'pi-field').props.value).toBe('hello')
      expect(findById(el, 'pi-send').props.accessibilityLabel).toBe(copy().promptSubagentSend)
      expect(findById(el, 'pi-cancel').props.accessibilityLabel).toBe(copy().promptSubagentCancel)
    })

    it('send calls onSend and blocks propagation; no send when the value is empty', () => {
      const p = base()
      const el = renderPromptInput(p)
      const e = pressEvent()
      findById(el, 'pi-send').props.onPress(e)
      expect(e.stopPropagation).toHaveBeenCalled()
      expect(p.onSend).toHaveBeenCalledWith(e)

      const empty = { ...base(), value: '   ' }
      const el2 = renderPromptInput(empty)
      expect(findById(el2, 'pi-send').props.disabled).toBe(true)
      findById(el2, 'pi-send').props.onPress(pressEvent())
      expect(empty.onSend).not.toHaveBeenCalled()
    })

    it('busy: send/cancel are disabled, spinner shown, and callbacks suppressed', () => {
      const p = { ...base(), busy: true }
      const el = renderPromptInput(p)
      expect(findById(el, 'pi-send').props.disabled).toBe(true)
      expect(findById(el, 'pi-cancel').props.disabled).toBe(true)
      expect(findById(el, 'pi-send-spinner')).toBeTruthy()
      findById(el, 'pi-send').props.onPress(pressEvent())
      findById(el, 'pi-cancel').props.onPress(pressEvent())
      expect(p.onSend).not.toHaveBeenCalled()
      expect(p.onCancel).not.toHaveBeenCalled()
    })

    it('cancel calls onCancel and blocks propagation', () => {
      const p = base()
      const el = renderPromptInput(p)
      const e = pressEvent()
      findById(el, 'pi-cancel').props.onPress(e)
      expect(e.stopPropagation).toHaveBeenCalled()
      expect(p.onCancel).toHaveBeenCalledWith(e)
    })
  })

  describe('AgentTeamCard', () => {
    const mockMembers: TeamMemberSnapshot[] = [
      {
        id: 'member-lead',
        name: 'lead',
        phase: 'active',
        description: '团队负责人',
      } as any,
      {
        id: 'member-coder',
        name: 'coder',
        phase: 'provisioning',
        description: '核心开发',
      } as any,
      {
        id: 'member-tester',
        name: 'tester',
        phase: 'failed',
        description: '测试专家',
        error: '容器环境无法分配',
      } as any,
    ]

    const mockTasks: TeamTaskSnapshot[] = [
      {
        id: 't1',
        ownerId: 'member-lead',
        subject: '规划并拆解模块任务',
        status: 'in_progress',
      } as any,
      {
        id: 't2',
        ownerId: 'member-lead',
        subject: '多会话上下文汇总',
        status: 'pending',
      } as any,
      {
        id: 't3',
        ownerId: 'member-coder',
        subject: '实现底部活动卡片',
        status: 'pending',
      } as any,
    ]

    const mockSessions: RemoteSession[] = [
      { sessionId: 'member-lead', running: true } as any,
      { sessionId: 'member-coder', running: false } as any,
    ]

    it('returns null when members array is empty', () => {
      const el = renderAgentTeamCard({ members: [] })
      expect(el).toBeNull()
    })

    it('renders expanded list with claimed tasks, more tasks badge, error message, and onOpen', () => {
      const onOpen = vi.fn()
      const el = renderAgentTeamCard({
        members: mockMembers,
        tasks: mockTasks,
        sessions: mockSessions,
        expanded: true,
        onOpen,
      })

      expect(findById(el, 'agent-team-card-content')).toBeTruthy()

      const leadItem = findById(el, 'agent-team-card-item-0')
      expect(typeof leadItem.props.onPress).toBe('function')
      leadItem.props.onPress()
      expect(onOpen).toHaveBeenCalledWith(mockSessions[0])

      const testerItem = findById(el, 'agent-team-card-item-2')
      expect(testerItem.props.onPress).toBeUndefined()
      expect(testerItem.props.accessibilityLabel).toContain('测试专家')
      expect(testerItem.props.accessibilityLabel).toMatch(/failed|失败/i)
    })
  })
})
