import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useRef: (v: any) => ({ current: v }),
    useEffect: () => {},
    useState: (v: any) => [typeof v === 'function' ? v() : v, vi.fn()],
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
  surfaceStrong: '#F9FAFB',
  ink: '#111827',
  muted: '#6B7280',
  subtle: '#9CA3AF',
  primary: '#1677FF',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
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
  formatSubagentStats,
  formatTeamStats,
  parseAgentLabel,
} from '../src/screens/chat/agents'
import type { RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../src/types'

const renderSubagentsCard = (props: any) => ((SubagentsCard as any).type ?? SubagentsCard)(props)
const renderAgentTeamCard = (props: any) => ((AgentTeamCard as any).type ?? AgentTeamCard)(props)
const renderStatusGlyph = (props: any) => ((AgentStatusGlyph as any).type ?? AgentStatusGlyph)(props)

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

    it('renders collapsed state by default and expands on click', () => {
      const el = renderSubagentsCard({ sessions: mockSessions, expanded: false })
      expect(el.props.testID).toBe('subagents-card')

      const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children]
      const content = children.find((c: any) => c && c.props && c.props.testID === 'subagents-card-content')
      expect(content).toBeFalsy()
    })

    it('renders expanded list with items, role, task, and invokes onOpen', () => {
      const onOpen = vi.fn()
      const el = renderSubagentsCard({
        sessions: mockSessions,
        expanded: true,
        onOpen,
      })
      const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children]
      const content = children.find((c: any) => c && c.props && c.props.testID === 'subagents-card-content')
      expect(content).toBeTruthy()

      const scrollView = content.props.children[1]
      expect(scrollView).toBeTruthy()
      expect(scrollView.props.children).toHaveLength(2)

      const firstItem = scrollView.props.children[0]
      expect(firstItem.props.accessibilityLabel).toContain('测试员')
      expect(firstItem.props.accessibilityLabel).toContain('执行验收测试')

      firstItem.props.onPress()
      expect(onOpen).toHaveBeenCalledWith(mockSessions[0])
    })

    it('triggers onToggle when header is pressed', () => {
      const onToggle = vi.fn()
      const el = renderSubagentsCard({
        sessions: mockSessions,
        expanded: false,
        onToggle,
      })
      const header = el.props.children[0]
      header.props.onPress()
      expect(onToggle).toHaveBeenCalled()
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

      const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children]
      const content = children.find((c: any) => c && c.props && c.props.testID === 'agent-team-card-content')
      expect(content).toBeTruthy()

      const scrollView = content.props.children[1]
      expect(scrollView).toBeTruthy()
      expect(scrollView.props.children).toHaveLength(3)

      const leadItem = scrollView.props.children[0]
      expect(typeof leadItem.props.onPress).toBe('function')
      leadItem.props.onPress()
      expect(onOpen).toHaveBeenCalledWith(mockSessions[0])

      const testerItem = scrollView.props.children[2]
      expect(testerItem.props.onPress).toBeUndefined()
      expect(testerItem.props.accessibilityLabel).toContain('测试专家')
      expect(testerItem.props.accessibilityLabel).toMatch(/failed|失败/i)
    })
  })
})
