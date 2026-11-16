import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  // Stateful mock: components are invoked directly (no renderer), so state lives in
  // a small registry keyed by hook call order. `beginPass` restarts the call order
  // (a re-render) while keeping the stored values (state updates).
  const stores = new Map<string, any>()
  const ctx = { order: 0 }
  ;(globalThis as any).__dshReactMock = {
    beginPass: () => { ctx.order = 0 },
    reset: () => { stores.clear(); ctx.order = 0 },
  }
  return {
    ...actual,
    useRef: (v: any) => ({ current: v }),
    useEffect: () => {},
    useState: (v: any) => {
      const key = `s${ctx.order++}`
      if (!stores.has(key)) stores.set(key, typeof v === 'function' ? v() : v)
      const set = (next: any) => {
        const current = stores.get(key)
        stores.set(key, typeof next === 'function' ? next(current) : next)
      }
      return [stores.get(key), set]
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
    ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props),
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
    RefreshCw: (props: any) => React.createElement('RefreshCw', props),
    Square: (props: any) => React.createElement('Square', props),
    Terminal: (props: any) => React.createElement('Terminal', props),
  }
})

vi.mock('../src/state/store', () => ({
  requireSessionTools: () => ({
    watchJobs: vi.fn(),
  }),
  // The dock falls back to `compact` when the persisted preference is unset.
  useAppStore: (selector: any) => selector({ activityDockMode: undefined }),
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
import { X as XIcon } from 'lucide-react-native'
import {
  AgentStatusGlyph,
  AgentTeamCard,
  SubagentsCard,
  formatSubagentStats,
  formatTeamStats,
  parseAgentLabel,
} from '../src/screens/chat/agents'
import { BackgroundJobsCard, JobStatusGlyph } from '../src/screens/chat/background-jobs-card'
import { SessionActivityDock } from '../src/screens/chat/session-activity'
import { TaskProgressChecklist } from '../src/screens/chat/task-progress-checklist'
import { IconJobOutline } from '../src/ui/dsh-icons'
import { isActivityDockMode } from '../src/ui/theme'
import type { RemoteSession, TeamMemberSnapshot, TeamTaskSnapshot } from '../src/types'

const renderSubagentsCard = (props: any) => ((SubagentsCard as any).type ?? SubagentsCard)(props)
const renderAgentTeamCard = (props: any) => ((AgentTeamCard as any).type ?? AgentTeamCard)(props)
const renderStatusGlyph = (props: any) => ((AgentStatusGlyph as any).type ?? AgentStatusGlyph)(props)

/** Shared hook-state registry exposed by the mocked `react` module. */
const reactMockApi = () => (globalThis as any).__dshReactMock as {
  beginPass: () => void
  reset: () => void
}

/** Invoke a component (no renderer) and collect every element in its output tree. */
const collectElements = (node: any, out: any[] = []): any[] => {
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

const findByTestId = (node: any, testID: string) =>
  collectElements(node).find(element => element.props?.testID === testID)

const findByComponent = (node: any, type: any) =>
  collectElements(node).find(element => element.type === type)

/** Host element created by the lucide mock (`<X />` becomes the mocked `X` component). */
const findByCloseIcon = (node: any) => findByComponent(node, XIcon)

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
      expect(stats.totalCount).toBe(1)
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

describe('isActivityDockMode', () => {
  it('accepts the three supported activity dock modes', () => {
    expect(isActivityDockMode('compact')).toBe(true)
    expect(isActivityDockMode('cards')).toBe(true)
    expect(isActivityDockMode('hidden')).toBe(true)
  })

  it('rejects invalid dock mode values', () => {
    const invalid: unknown[] = [
      'Compact',
      'CARDS',
      'hidden ',
      '',
      'none',
      'grid',
      undefined,
      null,
      0,
      1,
      true,
      {},
      [],
      ['compact'],
    ]
    for (const value of invalid) {
      expect(isActivityDockMode(value)).toBe(false)
    }
  })
})

describe('SessionActivityDock', () => {
  const baseSession = (overrides: any = {}): RemoteSession => ({
    sessionId: 'sess-1',
    title: '主会话',
    running: true,
    updatedAt: 0,
    blank: false,
    projections: { values: {} },
    ...overrides,
  } as any)

  const runningJob = { id: 'job-1', label: 'pnpm test', status: 'running' as const, startedAt: 1 }
  const idleJob = { id: 'job-2', label: 'pnpm build', status: 'completed' as const, startedAt: 1 }
  const childSession: RemoteSession = { sessionId: 'child-1', title: '子任务', running: true } as any
  const idleChildSession: RemoteSession = { sessionId: 'child-2', title: '子任务 2', running: false } as any
  const teamMember: TeamMemberSnapshot = { id: 'member-1', name: 'coder', phase: 'active' } as any
  const teamSessions: RemoteSession[] = [{ sessionId: 'member-1', running: true } as any]

  const renderDock = (props: any) => {
    reactMockApi().beginPass()
    return (SessionActivityDock as any)(props)
  }

  beforeEach(() => {
    reactMockApi().reset()
  })

  describe('compact mode (default)', () => {
    it('renders the pill bar with jobs, subagents and team pills for non-empty data', () => {
      const el = renderDock({
        session: baseSession(),
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
      })

      expect(findByTestId(el, 'activity-pill-bar')).toBeTruthy()
      expect(findByTestId(el, 'activity-pill-jobs')).toBeTruthy()
      expect(findByTestId(el, 'activity-pill-subagents')).toBeTruthy()
      expect(findByTestId(el, 'activity-pill-team')).toBeTruthy()
    })

    it('renders no pills when jobs, subagents and team members are all empty', () => {
      const el = renderDock({
        session: baseSession(),
        initialJobs: [],
        childSessions: [],
        teamState: { members: [], tasks: [] },
        sessions: [],
      })

      expect(findByTestId(el, 'activity-pill-bar')).toBeUndefined()
      expect(findByTestId(el, 'activity-pill-jobs')).toBeUndefined()
      expect(findByTestId(el, 'activity-pill-subagents')).toBeUndefined()
      expect(findByTestId(el, 'activity-pill-team')).toBeUndefined()
    })

    it('renders only the pills backed by available data', () => {
      const el = renderDock({
        session: baseSession(),
        initialJobs: [runningJob],
        childSessions: [],
        teamState: { members: [], tasks: [] },
      })

      expect(findByTestId(el, 'activity-pill-bar')).toBeTruthy()
      expect(findByTestId(el, 'activity-pill-jobs')).toBeTruthy()
      expect(findByTestId(el, 'activity-pill-subagents')).toBeUndefined()
      expect(findByTestId(el, 'activity-pill-team')).toBeUndefined()
    })

    it('highlights active pills with running glyphs', () => {
      const el = renderDock({
        session: baseSession(),
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
      })

      const jobsPill = findByTestId(el, 'activity-pill-jobs')
      const jobGlyph = findByComponent(jobsPill, JobStatusGlyph)
      expect(jobGlyph).toBeTruthy()
      expect(jobGlyph.props.status).toBe('running')
      expect(jobsPill.props.style({ pressed: false })[1]).toBeTruthy()

      const subagentsPill = findByTestId(el, 'activity-pill-subagents')
      const subagentGlyph = findByComponent(subagentsPill, AgentStatusGlyph)
      expect(subagentGlyph).toBeTruthy()
      expect(subagentGlyph.props.status).toBe('running')
      expect(subagentsPill.props.style({ pressed: false })[1]).toBeTruthy()

      const teamPill = findByTestId(el, 'activity-pill-team')
      const teamGlyph = findByComponent(teamPill, AgentStatusGlyph)
      expect(teamGlyph).toBeTruthy()
      expect(teamGlyph.props.status).toBe('running')
      expect(teamPill.props.style({ pressed: false })[1]).toBeTruthy()
    })

    it('does not highlight inactive pills and shows the idle job glyph', () => {
      const el = renderDock({
        session: baseSession(),
        initialJobs: [idleJob],
        childSessions: [idleChildSession],
        teamState: { members: [{ id: 'member-9', name: 'idle', phase: 'active' } as any], tasks: [] },
        sessions: [{ sessionId: 'member-9', running: false } as any],
      })

      const jobsPill = findByTestId(el, 'activity-pill-jobs')
      expect(findByComponent(jobsPill, JobStatusGlyph)).toBeUndefined()
      expect(findByComponent(jobsPill, IconJobOutline)).toBeTruthy()
      expect(jobsPill.props.style({ pressed: false })[1]).toBeFalsy()

      const subagentsPill = findByTestId(el, 'activity-pill-subagents')
      expect(subagentsPill.props.style({ pressed: false })[1]).toBeFalsy()

      const teamPill = findByTestId(el, 'activity-pill-team')
      expect(teamPill.props.style({ pressed: false })[1]).toBeFalsy()
    })

    it('opens the activity card modal when a pill is pressed', () => {
      const props = {
        session: baseSession(),
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
      }

      const initial = renderDock(props)
      expect(findByTestId(initial, 'activity-card-modal')).toBeUndefined()

      findByTestId(initial, 'activity-pill-jobs').props.onPress()

      const opened = renderDock(props)
      expect(findByTestId(opened, 'activity-card-modal')).toBeTruthy()

      const jobsCard = findByComponent(opened, BackgroundJobsCard)
      expect(jobsCard).toBeTruthy()
      expect(jobsCard.props.expanded).toBe(true)
      expect(typeof jobsCard.props.onClose).toBe('function')
    })

    it('renders the expanded card with an X close icon inside the modal', () => {
      const props = {
        session: baseSession(),
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
      }

      renderDock(props)
      const initial = renderDock(props)
      findByTestId(initial, 'activity-pill-subagents').props.onPress()
      const opened = renderDock(props)

      const subagentsCard = findByComponent(opened, SubagentsCard)
      expect(subagentsCard).toBeTruthy()
      expect(subagentsCard.props.expanded).toBe(true)
      expect(typeof subagentsCard.props.onClose).toBe('function')

      // Render the card on its own to observe the close (X) affordance.
      reactMockApi().reset()
      const renderedCard = renderSubagentsCard(subagentsCard.props)
      expect(findByCloseIcon(renderedCard)).toBeTruthy()
    })

    it('closes the modal when the card onClose is triggered', () => {
      const props = {
        session: baseSession(),
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
      }

      const initial = renderDock(props)
      findByTestId(initial, 'activity-pill-subagents').props.onPress()
      const opened = renderDock(props)
      expect(findByTestId(opened, 'activity-card-modal')).toBeTruthy()

      findByComponent(opened, SubagentsCard).props.onClose()

      const closed = renderDock(props)
      expect(findByTestId(closed, 'activity-card-modal')).toBeUndefined()
    })

    it('closes the modal and notifies the host when onOpenSession is triggered', () => {
      const onOpenSession = vi.fn()
      const props = {
        session: baseSession(),
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
        onOpenSession,
      }

      const initial = renderDock(props)
      findByTestId(initial, 'activity-pill-subagents').props.onPress()
      const opened = renderDock(props)
      expect(findByTestId(opened, 'activity-card-modal')).toBeTruthy()

      findByComponent(opened, SubagentsCard).props.onOpen(childSession)

      expect(onOpenSession).toHaveBeenCalledWith(childSession)
      const closed = renderDock(props)
      expect(findByTestId(closed, 'activity-card-modal')).toBeUndefined()
    })
  })

  describe('cards mode', () => {
    it('renders the three activity cards inline instead of the pill bar', () => {
      const el = renderDock({
        session: baseSession(),
        mode: 'cards',
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
      })

      expect(findByTestId(el, 'activity-pill-bar')).toBeUndefined()
      expect(findByComponent(el, BackgroundJobsCard)).toBeTruthy()
      expect(findByComponent(el, SubagentsCard)).toBeTruthy()
      expect(findByComponent(el, AgentTeamCard)).toBeTruthy()
    })
  })

  describe('hidden mode', () => {
    it('hides every activity widget but keeps the task progress checklist', () => {
      const el = renderDock({
        session: baseSession({
          projections: { values: { todos: [{ content: '编写测试', status: 'pending' }] } },
        }),
        mode: 'hidden',
        initialJobs: [runningJob],
        childSessions: [childSession],
        teamState: { members: [teamMember], tasks: [] },
        sessions: teamSessions,
      })

      expect(findByTestId(el, 'activity-pill-bar')).toBeUndefined()
      expect(findByComponent(el, BackgroundJobsCard)).toBeUndefined()
      expect(findByComponent(el, SubagentsCard)).toBeUndefined()
      expect(findByComponent(el, AgentTeamCard)).toBeUndefined()
      expect(findByComponent(el, TaskProgressChecklist)).toBeTruthy()
    })
  })
})
