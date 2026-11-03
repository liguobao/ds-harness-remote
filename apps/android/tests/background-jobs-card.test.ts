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
    RefreshCw: (props: any) => React.createElement('RefreshCw', props),
    Square: (props: any) => React.createElement('Square', props),
    Terminal: (props: any) => React.createElement('Terminal', props),
  }
})

;(globalThis as any).__DEV__ = true

const mockKillJob = vi.fn(async () => ({ outcome: 'requested' as const }))
const mockFollowJob = vi.fn(async () => (async function* () {
  yield { type: 'opened', from: 0 }
  yield { type: 'output', chunks: [{ text: 'build finished\n' }], next: 15 }
})())

vi.mock('../src/state/store', () => ({
  requireSessionTools: () => ({
    killJob: mockKillJob,
    followJob: mockFollowJob,
  }),
}))

import React from 'react'
import {
  BackgroundJobsCard,
  BackgroundJobItem,
  JobStatusGlyph,
  JobLogPanel,
  formatJobDuration,
  formatJobStats,
  jobStatusLabel,
} from '../src/screens/chat/background-jobs-card'
import type { BackgroundJob } from '../src/services/session-tools'
import { strings } from '../src/locales/i18n'

const MOCK_THEME_COLORS = {
  background: '#F8F8F8',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardOpaque: '#FFFFFF',
  surfaceStrong: '#F3F4F6',
  grouped: '#F9FAFB',
  elevated: '#FFFFFF',
  ink: '#111827',
  muted: '#6B7280',
  subtle: '#9CA3AF',
  primary: '#2563EB',
  primaryPressed: '#1D4ED8',
  primarySoft: '#EFF6FF',
  accent: '#3B82F6',
  accentSoft: '#DBEAFE',
  inverse: '#000000',
  onInverse: '#FFFFFF',
  border: '#E5E7EB',
  separator: '#F3F4F6',
  success: '#10B981',
  successSoft: '#D1FAE5',
  warning: '#F59E0B',
  warningSoft: '#FEF3C7',
  danger: '#EF4444',
  dangerSoft: '#FEE2E2',
}

vi.mock('../src/ui/theme-context', () => ({
  useTheme: () => ({
    colors: MOCK_THEME_COLORS,
    density: 'default',
    isDark: false,
  }),
}))

const renderGlyph = (props: any) => ((JobStatusGlyph as any).type ?? JobStatusGlyph)(props)
const renderItem = (props: any) => ((BackgroundJobItem as any).type ?? BackgroundJobItem)(props)
const renderCard = (props: any) => ((BackgroundJobsCard as any).type ?? BackgroundJobsCard)(props)
const renderLogPanel = (props: any) => ((JobLogPanel as any).type ?? JobLogPanel)(props)

describe('BackgroundJobsCard and utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('pure formatting helpers', () => {
    it('formats duration in seconds to M:SS', () => {
      expect(formatJobDuration(0)).toBe('0:00')
      expect(formatJobDuration(45)).toBe('0:45')
      expect(formatJobDuration(65)).toBe('1:05')
      expect(formatJobDuration(3600)).toBe('60:00')
    })

    it('formats job statistics for active and completed jobs', () => {
      const jobs: BackgroundJob[] = [
        { id: 'job-1', label: 'Compiling project', status: 'running', startedAt: 1000 },
        { id: 'job-2', label: 'Running tests', status: 'completed' },
        { id: 'job-3', label: 'Docker build', status: 'stopping' },
      ]
      const stats = formatJobStats(jobs)
      expect(stats.totalCount).toBe(3)
      expect(stats.runningCount).toBe(2)
      expect(stats.statsText).toBe('2/3')
      expect(stats.activeJob?.id).toBe('job-1')
    })

    it('formats job statistics when no active jobs are running', () => {
      const jobs: BackgroundJob[] = [
        { id: 'job-1', label: 'Task 1', status: 'completed' },
        { id: 'job-2', label: 'Task 2', status: 'killed' },
      ]
      const stats = formatJobStats(jobs)
      expect(stats.totalCount).toBe(2)
      expect(stats.runningCount).toBe(0)
      expect(stats.statsText).toBe('2')
      expect(stats.activeJob).toBeNull()
    })

    it('maps all job lifecycle states to localized labels', () => {
      const copy = strings.sessionActivity
      expect(jobStatusLabel('running', copy)).toBe(copy.active)
      expect(jobStatusLabel('stopping', copy)).toBe(copy.stopping)
      expect(jobStatusLabel('completed', copy)).toBe(copy.complete)
      expect(jobStatusLabel('killed', copy)).toBe(copy.killed)
      expect(jobStatusLabel('failed', copy)).toBe(copy.failed)
    })
  })

  describe('JobStatusGlyph', () => {
    it('renders green checkmark for completed status', () => {
      const glyph = renderGlyph({ status: 'completed', colors: MOCK_THEME_COLORS })
      expect(glyph.props.testID).toBe('job-glyph-completed')
      expect(glyph.props.children.props.children[0].props.fill).toBe(MOCK_THEME_COLORS.success)
    })

    it('renders animated blue spinner for running status', () => {
      const glyph = renderGlyph({ status: 'running', colors: MOCK_THEME_COLORS })
      expect(glyph.props.testID).toBe('job-glyph-running')
      const svg = glyph.props.children
      expect(svg.props.children[0].props.stroke).toBe(MOCK_THEME_COLORS.primary)
    })

    it('renders animated warning spinner for stopping status', () => {
      const glyph = renderGlyph({ status: 'stopping', colors: MOCK_THEME_COLORS })
      expect(glyph.props.testID).toBe('job-glyph-stopping')
      const svg = glyph.props.children
      expect(svg.props.children[0].props.stroke).toBe(MOCK_THEME_COLORS.warning)
    })

    it('renders muted stop glyph for killed status', () => {
      const glyph = renderGlyph({ status: 'killed', colors: MOCK_THEME_COLORS })
      expect(glyph.props.testID).toBe('job-glyph-killed')
      expect(glyph.props.children.props.children[0].props.fill).toBe(MOCK_THEME_COLORS.muted)
    })

    it('renders red badge for failed status', () => {
      const glyph = renderGlyph({ status: 'failed', colors: MOCK_THEME_COLORS })
      expect(glyph.props.testID).toBe('job-glyph-failed')
      expect(glyph.props.children.props.children[0].props.fill).toBe(MOCK_THEME_COLORS.danger)
    })
  })

  describe('BackgroundJobItem', () => {
    it('renders job details and action buttons for a running job', () => {
      const job: BackgroundJob = {
        id: 'job-run-1',
        label: 'Building release bundle',
        status: 'running',
        progress: '45% [2/5 modules]',
        detail: 'Compiling native artifacts',
        startedAt: Date.now() - 30000,
      }
      const onKill = vi.fn(async () => {})
      const item = renderItem({
        job,
        sessionId: 'session-123',
        onKill,
        killing: false,
        testID: 'job-item-0',
      })

      expect(item.props.testID).toBe('job-item-0')
      const mainRow = item.props.children[0]
      expect(mainRow).toBeDefined()

      // Kill button must be present for running job
      const actions = mainRow.props.children[2]
      const killBtn = actions.props.children[0]
      expect(killBtn.props.testID).toBe('job-item-0-kill-btn')
      expect(killBtn.props.disabled).toBe(false)

      // Trigger kill button
      killBtn.props.onPress()
      expect(onKill).toHaveBeenCalledWith('job-run-1')

      // Logs toggle button
      const logsBtn = actions.props.children[1]
      expect(logsBtn.props.testID).toBe('job-item-0-logs-btn')
    })

    it('disables kill button and shows stopping label when killing is in progress', () => {
      const job: BackgroundJob = {
        id: 'job-run-2',
        label: 'Running daemon',
        status: 'running',
      }
      const onKill = vi.fn(async () => {})
      const item = renderItem({
        job,
        sessionId: 'session-123',
        onKill,
        killing: true,
        testID: 'job-item-1',
      })

      const actions = item.props.children[0].props.children[2]
      const killBtn = actions.props.children[0]
      expect(killBtn.props.disabled).toBe(true)
    })

    it('omits kill button for completed jobs', () => {
      const job: BackgroundJob = {
        id: 'job-done-1',
        label: 'Finished benchmark',
        status: 'completed',
      }
      const onKill = vi.fn(async () => {})
      const item = renderItem({
        job,
        sessionId: 'session-123',
        onKill,
        testID: 'job-item-2',
      })

      const actions = item.props.children[0].props.children[2]
      expect(actions.props.children[0]).toBe(false)
      const logsBtn = actions.props.children[1]
      expect(logsBtn.props.testID).toBe('job-item-2-logs-btn')
    })
  })

  describe('JobLogPanel', () => {
    it('renders the log panel with output text container', () => {
      const panel = renderLogPanel({
        sessionId: 'session-123',
        jobId: 'job-456',
        testID: 'log-panel-test',
      })
      expect(panel.props.testID).toBe('log-panel-test')
      expect(panel.props.children[0].props.style).toBeDefined()
    })
  })

  describe('BackgroundJobsCard component', () => {
    it('renders card header with badge, refresh button, and toggles expansion', () => {
      const jobs: BackgroundJob[] = [
        { id: 'j1', label: 'Download dataset', status: 'running', startedAt: Date.now() - 15000 },
        { id: 'j2', label: 'Linting files', status: 'completed' },
      ]
      const onToggle = vi.fn()
      const onRefresh = vi.fn()

      const card = renderCard({
        jobs,
        sessionId: 'session-123',
        expanded: false,
        onToggle,
        onRefresh,
        testID: 'bg-jobs-card',
      })

      expect(card.props.testID).toBe('bg-jobs-card')
      const header = card.props.children[0]
      expect(header.props.testID).toBe('bg-jobs-card-header')

      // Badge check
      const progressContainer = header.props.children[2]
      const progressText = progressContainer.props.children[0]
      expect(progressText.props.children).toBe('1/2')

      // Refresh button
      const trailing = header.props.children[3]
      const refreshBtn = trailing.props.children[0]
      expect(refreshBtn.props.testID).toBe('bg-jobs-card-refresh-btn')
      refreshBtn.props.onPress()
      expect(onRefresh).toHaveBeenCalledTimes(1)

      // Header click
      header.props.onPress()
      expect(onToggle).toHaveBeenCalledTimes(1)

      // When collapsed (expanded: false), content is not rendered
      expect(card.props.children[1]).toBe(false)
    })

    it('renders job items when expanded', () => {
      const jobs: BackgroundJob[] = [
        { id: 'j1', label: 'Download dataset', status: 'running' },
        { id: 'j2', label: 'Linting files', status: 'completed' },
      ]

      const card = renderCard({
        jobs,
        sessionId: 'session-123',
        expanded: true,
        testID: 'bg-jobs-card-expanded',
      })

      const content = card.props.children[1]
      expect(content.props.testID).toBe('bg-jobs-card-expanded-content')

      // ScrollView of jobs
      const scrollView = content.props.children[4]
      expect(scrollView).toBeDefined()
      const jobItems = scrollView.props.children
      expect(jobItems).toHaveLength(2)
      expect(jobItems[0].props.testID).toBe('bg-jobs-card-expanded-item-0')
      expect(jobItems[1].props.testID).toBe('bg-jobs-card-expanded-item-1')
    })

    it('renders empty message when job roster has 0 items and not loading', () => {
      const card = renderCard({
        jobs: [],
        sessionId: 'session-123',
        expanded: true,
        loading: false,
        testID: 'bg-jobs-empty',
      })

      const content = card.props.children[1]
      const emptyNotice = content.props.children[3]
      expect(emptyNotice.props.children).toBe(strings.sessionActivity.noJobs)
    })

    it('renders error retry button when error occurs', () => {
      const onRefresh = vi.fn()
      const card = renderCard({
        jobs: [],
        sessionId: 'session-123',
        expanded: true,
        error: true,
        onRefresh,
        testID: 'bg-jobs-error',
      })

      const content = card.props.children[1]
      const retryBtn = content.props.children[2]
      expect(retryBtn.props.testID).toBe('bg-jobs-error-error-retry')
      retryBtn.props.onPress()
      expect(onRefresh).toHaveBeenCalledTimes(1)
    })
  })
})
