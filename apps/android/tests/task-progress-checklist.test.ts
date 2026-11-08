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
  }
})

vi.mock('react-native-svg', () => {
  const React = require('react')
  return {
    default: (props: any) => React.createElement('Svg', props, props.children),
    Svg: (props: any) => React.createElement('Svg', props, props.children),
    Circle: (props: any) => React.createElement('Circle', props, props.children),
    Path: (props: any) => React.createElement('Path', props, props.children),
    G: (props: any) => React.createElement('G', props, props.children),
  }
})

vi.mock('lucide-react-native', () => {
  const React = require('react')
  return {
    ChevronDown: (props: any) => React.createElement('ChevronDown', props),
    ChevronUp: (props: any) => React.createElement('ChevronUp', props),
  }
})

import React from 'react'
import {
  TaskProgressChecklist,
  TaskStatusGlyph,
  formatTaskProgress,
  taskStatusGlyphKind,
  taskStatusLabel,
  type TodoItem,
} from '../src/screens/chat/task-progress-checklist'
import { processDetail } from '../src/screens/chat-process'
import { messageCatalogs, strings } from '../src/locales/i18n'
import type { ToolActivity } from '../src/types'

const renderGlyph = (props: any) => ((TaskStatusGlyph as any).type ?? TaskStatusGlyph)(props)
const renderChecklist = (props: any) => ((TaskProgressChecklist as any).type ?? TaskProgressChecklist)(props)

const MOCK_THEME_COLORS = {
  card: '#FFFFFF',
  border: '#E5E7EB',
  separator: '#F3F4F6',
  surfaceStrong: '#F9FAFB',
  ink: '#111827',
  muted: '#6B7280',
  primary: '#1677FF',
  success: '#10B981',
} as const

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({
    colors: MOCK_THEME_COLORS,
    isDark: false,
  }),
}))

const THREE_STEPS_PLAN: TodoItem[] = [
  { content: '分析需求并检查代码结构', status: 'pending' },
  { content: '实现 Task Progress Checklist 组件与样式', status: 'pending' },
  { content: '运行单元测试与端到端实测验证', status: 'pending' },
]

describe('Task Progress Checklist (任务进度清单)', () => {
  describe('Pure derivation helpers', () => {
    it('maps task statuses to glyph kinds', () => {
      expect(taskStatusGlyphKind('pending')).toBe('hollow-circle')
      expect(taskStatusGlyphKind('in_progress')).toBe('blue-circle')
      expect(taskStatusGlyphKind('completed')).toBe('checkmark')
    })

    it('derives 0/n progress when no tasks are completed', () => {
      const result = formatTaskProgress(THREE_STEPS_PLAN)
      expect(result.done).toBe(0)
      expect(result.total).toBe(3)
      expect(result.progressText).toBe('0/3')
      expect(result.activeItem).toBeNull()
    })

    it('derives active item and updated progress text when steps advance', () => {
      const intermediate: TodoItem[] = [
        { content: 'Step 1', status: 'completed' },
        { content: 'Step 2', status: 'in_progress' },
        { content: 'Step 3', status: 'pending' },
      ]
      const result = formatTaskProgress(intermediate)
      expect(result.done).toBe(1)
      expect(result.total).toBe(3)
      expect(result.progressText).toBe('1/3')
      expect(result.activeItem?.content).toBe('Step 2')
    })

    it('formats localized status labels', () => {
      const copy = strings.sessionActivity
      expect(taskStatusLabel('completed', copy)).toBe(copy.complete)
      expect(taskStatusLabel('in_progress', copy)).toBe(copy.active)
      expect(taskStatusLabel('pending', copy)).toBe(copy.pending)
    })
  })
  describe('TaskStatusGlyph 状态指示几何与色彩', () => {
    it('renders hollow circle for pending state (空心圆表示待执行)', () => {
      const element = renderGlyph({ status: 'pending', colors: MOCK_THEME_COLORS as any })
      expect(element.props.testID).toBe('glyph-pending')
      const svg = element.props.children
      expect(svg).toBeTruthy()
      const circle = svg.props.children
      expect(circle).toBeTruthy()
      expect(circle.props.stroke).toBe(MOCK_THEME_COLORS.muted)
      expect(circle.props.fill).toBe('none')
    })

    it('renders blue circle with spinner for in_progress state (蓝色圆圈表示正在执行)', () => {
      const element = renderGlyph({ status: 'in_progress', colors: MOCK_THEME_COLORS as any })
      expect(element.props.testID).toBe('glyph-in-progress')
      const svg = element.props.children
      expect(svg).toBeTruthy()
      const children = Array.isArray(svg.props.children) ? svg.props.children : [svg.props.children]
      const circle1 = children[0]
      const circle2 = children[1]
      expect(circle1.props.stroke).toBe(MOCK_THEME_COLORS.primary)
      expect(circle2.props.stroke).toBe(MOCK_THEME_COLORS.primary)
      expect(circle2.props.strokeDasharray).toBe('10 30')
    })

    it('renders green checkmark badge for completed state (完成后通常显示勾选)', () => {
      const element = renderGlyph({ status: 'completed', colors: MOCK_THEME_COLORS as any })
      expect(element.props.testID).toBe('glyph-completed')
      const svg = element.props.children
      expect(svg).toBeTruthy()
      const children = Array.isArray(svg.props.children) ? svg.props.children : [svg.props.children]
      const circle = children[0]
      const path = children[1]
      expect(circle.props.fill).toBe(MOCK_THEME_COLORS.success)
      expect(path.props.stroke).toBe('#FFFFFF')
    })
  })

  describe('TaskProgressChecklist 组件生命周期与结构', () => {
    it('returns null when todos list is empty', () => {
      const element = renderChecklist({ todos: [] })
      expect(element).toBeNull()
    })

    it('displays 0/n progress statistic when none of the 3 tasks are completed (0/n 表示三个任务中尚未完成任何一个)', () => {
      const element = renderChecklist({
        todos: THREE_STEPS_PLAN,
        defaultExpanded: false,
      })
      expect(element).not.toBeNull()

      // Header contains progress 0/3
      const cardChildren = Array.isArray(element.props.children) ? element.props.children : [element.props.children]
      const header = cardChildren[0]
      expect(header.props.testID).toBe('task-progress-checklist-header')

      const headerChildren = header.props.children
      const progressContainer = headerChildren.find((child: any) => child && child.props && child.props.children?.props?.testID === 'task-progress-checklist-progress')
      const progressText = progressContainer.props.children
      expect(progressText.props.children).toBe('0/3')
    })

    it('displays the 3 AI planned steps when expanded (展示 AI 计划执行的三个步骤)', () => {
      const element = renderChecklist({
        todos: THREE_STEPS_PLAN,
        expanded: true,
      })
      const cardChildren = Array.isArray(element.props.children) ? element.props.children : [element.props.children]
      const contentWrap = cardChildren[1]
      expect(contentWrap).toBeTruthy()
      expect(contentWrap.props.testID).toBe('task-progress-checklist-content')

      const scrollView = contentWrap.props.children[1]
      const items = scrollView.props.children
      expect(items).toHaveLength(3)

      expect(items[0].props.testID).toBe('task-progress-checklist-item-0')
      expect(items[1].props.testID).toBe('task-progress-checklist-item-1')
      expect(items[2].props.testID).toBe('task-progress-checklist-item-2')

      // Content text
      expect(items[0].props.children[1].props.children).toBe('分析需求并检查代码结构')
      expect(items[1].props.children[1].props.children).toBe('实现 Task Progress Checklist 组件与样式')
      expect(items[2].props.children[1].props.children).toBe('运行单元测试与端到端实测验证')

      // Statuses are pending
      expect(items[0].props.children[0].props.children.props.status).toBe('pending')
      expect(items[1].props.children[0].props.children.props.status).toBe('pending')
      expect(items[2].props.children[0].props.children.props.status).toBe('pending')
    })

    it('dynamically reflects real-time status transitions (AI 执行过程中自动更新任务状态)', () => {
      // Step 1: in_progress
      const step1Active: TodoItem[] = [
        { content: '分析需求并检查代码结构', status: 'in_progress' },
        { content: '实现 Task Progress Checklist 组件与样式', status: 'pending' },
        { content: '运行单元测试与端到端实测验证', status: 'pending' },
      ]
      const v1 = renderChecklist({ todos: step1Active, expanded: true })
      const header1 = v1.props.children[0]
      const prog1 = header1.props.children.find((c: any) => c?.props?.children?.props?.testID === 'task-progress-checklist-progress')
      expect(prog1.props.children.props.children).toBe('0/3')

      // Step 2: step 1 completed (1/3), step 2 in_progress
      const step2Active: TodoItem[] = [
        { content: '分析需求并检查代码结构', status: 'completed' },
        { content: '实现 Task Progress Checklist 组件与样式', status: 'in_progress' },
        { content: '运行单元测试与端到端实测验证', status: 'pending' },
      ]
      const v2 = renderChecklist({ todos: step2Active, expanded: true })
      const header2 = v2.props.children[0]
      const prog2 = header2.props.children.find((c: any) => c?.props?.children?.props?.testID === 'task-progress-checklist-progress')
      expect(prog2.props.children.props.children).toBe('1/3')

      const items2 = v2.props.children[1].props.children[1].props.children
      expect(items2[0].props.children[0].props.children.props.status).toBe('completed')
      expect(items2[1].props.children[0].props.children.props.status).toBe('in_progress')
      expect(items2[2].props.children[0].props.children.props.status).toBe('pending')

      // Step 3: all completed (3/3)
      const allDone: TodoItem[] = [
        { content: '分析需求并检查代码结构', status: 'completed' },
        { content: '实现 Task Progress Checklist 组件与样式', status: 'completed' },
        { content: '运行单元测试与端到端实测验证', status: 'completed' },
      ]
      const v3 = renderChecklist({ todos: allDone, expanded: true })
      const header3 = v3.props.children[0]
      const prog3 = header3.props.children.find((c: any) => c?.props?.children?.props?.testID === 'task-progress-checklist-progress')
      expect(prog3.props.children.props.children).toBe('3/3')

      const items3 = v3.props.children[1].props.children[1].props.children
      expect(items3[0].props.children[0].props.children.props.status).toBe('completed')
      expect(items3[1].props.children[0].props.children.props.status).toBe('completed')
      expect(items3[2].props.children[0].props.children.props.status).toBe('completed')
    })

    it('supports folding and unfolding (折叠展开：可以收起或查看详细任务)', () => {
      const onToggle = vi.fn()
      const collapsed = renderChecklist({
        todos: THREE_STEPS_PLAN,
        expanded: false,
        onToggle,
      })
      // When collapsed, detailed content is not mounted
      expect(collapsed.props.children[1]).toBeFalsy()

      const expanded = renderChecklist({
        todos: THREE_STEPS_PLAN,
        expanded: true,
        onToggle,
      })
      expect(expanded.props.children[1]).toBeTruthy()

      // Header on click triggers onToggle
      collapsed.props.children[0].props.onPress()
      expect(onToggle).toHaveBeenCalledTimes(1)
    })
  })

  describe('chatProcess processDetail for todo_write', () => {
    it('summarizes todo_write arguments matching planSummary specification', () => {
      const toolPending: ToolActivity = {
        kind: 'tool',
        id: 't1',
        sessionId: 's1',
        toolName: 'todo_write',
        state: 'running',
        createdAt: 1000,
        arguments: JSON.stringify({
          todos: [
            { content: '搭建骨架', status: 'pending' },
            { content: '编写代码', status: 'pending' },
            { content: '验收测试', status: 'pending' },
          ],
        }),
      }
      expect(processDetail(toolPending)).toBe('0/3')

      const toolActive: ToolActivity = {
        kind: 'tool',
        id: 't2',
        sessionId: 's1',
        toolName: 'todo_write',
        state: 'running',
        createdAt: 2000,
        arguments: JSON.stringify({
          todos: [
            { content: '搭建骨架', status: 'completed' },
            { content: '编写代码', status: 'in_progress' },
            { content: '验收测试', status: 'pending' },
          ],
        }),
      }
      expect(processDetail(toolActive)).toBe('1/3 · 编写代码')
    })
  })

  describe('Locale synchronization', () => {
    it('all 7 language catalogs define taskChecklist in sessionActivity', () => {
      const languages = ['zh-CN', 'en-US', 'zh-TW', 'ja-JP', 'es-ES', 'de-DE', 'fr-FR'] as const
      for (const lang of languages) {
        const catalog = messageCatalogs[lang]
        expect(catalog.sessionActivity.taskChecklist, `Language ${lang} should define taskChecklist`).toBeTruthy()
      }
    })
  })
})
