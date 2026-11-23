import { decryptFrame, fromBase64Url } from '@dsh-remote/crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type {
  ApprovalActivity,
  ChatItem,
  ChatMessage,
  HistoryEntry,
  QuestionActivity,
  RemoteSession,
  ToolActivity,
  WorkspaceView,
} from '../src/types'

const { files, keys, proxy, transport, storage, authenticate, acp, codex } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  keys: new Map<string, string>(),
  proxy: {
    sessionHistory: vi.fn(),
    sessionReadOnlyHistory: vi.fn() as ReturnType<typeof vi.fn> | undefined,
    messageFeedbackList: vi.fn(),
    sessionModels: vi.fn(),
    sessionList: vi.fn(),
    sessionCreate: vi.fn(),
    hostDescribe: vi.fn(),
    workspaceList: vi.fn(),
    workspaceCreate: vi.fn(),
    workspaceArchiveSession: vi.fn(),
    sessionSelectPermission: vi.fn(),
    sessionPrompt: vi.fn(),
    sessionUpdateQueue: vi.fn(),
  },
  transport: {
    connect: vi.fn(),
    close: vi.fn(),
    checkHealth: vi.fn(),
    refreshBackends: vi.fn(),
    hasCodex: vi.fn(),
    hasCursor: vi.fn(),
    hasAntigravity: vi.fn(),
    hasPi: vi.fn(),
    hasOpencode: vi.fn(),
    hasClaude: vi.fn(),
    hasHermes: vi.fn(),
    hasAcpBackend: vi.fn(),
    customAcpBackends: vi.fn(),
    requireClaude: vi.fn(),
    requireHermes: vi.fn(),
  },
  acp: {
    call: vi.fn(),
    transferCall: vi.fn(),
    openStream: vi.fn(),
    prompt: vi.fn(),
    sessionModels: vi.fn(),
    sessionModes: vi.fn(),
    selectModel: vi.fn(),
    selectPermission: vi.fn(),
    archiveSession: vi.fn(),
    createSession: vi.fn(),
    loadSessionDetails: undefined as ((sessionId: string, backend: string, signal?: AbortSignal) => Promise<unknown>) | undefined,
  },
  storage: {
    saveRecentWorkspaces: vi.fn(),
    saveFavoriteWorkspaces: vi.fn(),
    saveLastConnectedDeviceId: vi.fn(),
    loadCodexPermissionPresets: vi.fn(),
    saveCodexPermissionPreset: vi.fn(),
  },
  codex: { request: vi.fn(), subscribe: vi.fn() },
  authenticate: vi.fn(),
}))

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///app/',
  getInfoAsync: async (p: string) => ({ exists: files.has(p) }),
  readAsStringAsync: async (p: string) => files.get(p),
  writeAsStringAsync: async (p: string, value: string) => { files.set(p, value) },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    files.set(to, files.get(from)!)
    files.delete(from)
  },
}))
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => keys.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { keys.set(key, value) },
}))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
}))
vi.mock('expo-haptics', () => ({
  impactAsync: async () => undefined,
  notificationAsync: async () => undefined,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}))
vi.mock('../src/services/network-route', () => ({ resolveAutomaticPreferredTransports: async () => ['relay'] }))
vi.mock('../src/services/connection', () => ({
  AndroidRemoteConnection: class {
    async configureHistory() {}
    requireProxy() { return proxy }
    connect = transport.connect
    close = transport.close
    checkHealth = transport.checkHealth
    refreshBackends = transport.refreshBackends
    hasCodex = transport.hasCodex
    requireCodex() { return codex }
    hasCursor = transport.hasCursor
    hasPi = transport.hasPi
    hasAntigravity = transport.hasAntigravity
    hasOpencode = transport.hasOpencode
    hasClaude = transport.hasClaude
    hasHermes = transport.hasHermes
    hasAcpBackend = transport.hasAcpBackend
    customAcpBackends = transport.customAcpBackends
    requireCursor() { return acp }
    requireAntigravity() { return acp }
    requirePi() { return acp }
    requireOpencode() { return acp }
    requireClaude() { transport.requireClaude(); return acp }
    requireHermes() { transport.requireHermes(); return acp }
    requireAcpBackend() { return acp }
    getNetworkDetails() { return Promise.resolve(undefined) }
    getStats() { return { mode: 'Relay', connected: true } }
  },
}))
vi.mock('../src/services/storage', () => storage)
vi.mock('../src/services/login', () => ({}))
vi.mock('../src/services/server-session', () => ({ serverSession: { authenticate } }))

import {
  buildHandoffPacket,
  extractHandoffEditedFiles,
  formatHandoffPayload,
  parseHandoffMessage,
  type HandoffMeta,
} from '../src/lib/handoff-context'
import {
  availableHandoffTargets,
  findLatestHandoffOrigin,
  matchTargetWorkspace,
  resolveHandoffTargetSessions,
} from '../src/lib/handoff-workspace'
import { strings as zhCN } from '../src/locales/i18n'
import { browseKey, browseScope, saveSessionMessagesSnapshot, useBrowseMemory } from '../src/services/browse-memory'
import { storeAcpPagedMessages } from '../src/state/session-actions'
import { useAppStore } from '../src/state/store'

function msg(
  id: string,
  role: ChatMessage['role'],
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    kind: 'message',
    id,
    sessionId: 's-src',
    role,
    text,
    createdAt: 1000,
    ...extra,
  }
}

function tool(
  id: string,
  toolName: string,
  extra: Partial<ToolActivity> = {},
): ToolActivity {
  return {
    kind: 'tool',
    id,
    sessionId: 's-src',
    toolName,
    state: 'finished',
    createdAt: 1000,
    ...extra,
  }
}

function historyEvent(
  seq: number,
  role: 'user' | 'assistant',
  text: string,
): HistoryEntry {
  return {
    event: {
      type: role === 'user' ? 'user/message' : 'assistant/message',
      seq,
      time: 1000 + seq,
      data: { message: { role, content: [{ type: 'text', text }] } },
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function sampleMeta(overrides: Partial<HandoffMeta> = {}): HandoffMeta {
  return {
    version: 1,
    sourceBackend: 'harness',
    targetBackend: 'codex',
    sourceSessionId: 's-src',
    sourceTitle: 'Auth refactor',
    cwd: '/repo/app',
    preset: 'continue',
    turnsCount: 2,
    filesCount: 1,
    omittedTurns: 0,
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('handoff-context', () => {
  it('extractHandoffEditedFiles extracts deduplicated paths across Harness, Codex, and ACP, excluding str_replace_editor view and capping at 40', () => {
    const items: ChatItem[] = [
      tool('t-read', 'read_file', { arguments: JSON.stringify({ file_path: 'src/ignored-read.ts' }) }),
      tool('t-failed', 'write_file', { state: 'failed', arguments: JSON.stringify({ file_path: 'src/ignored-failed.ts' }) }),
      tool('t-running', 'write_file', { state: 'running', arguments: JSON.stringify({ file_path: 'src/ignored-running.ts' }) }),
      tool('t-view', 'str_replace_editor', { arguments: JSON.stringify({ command: 'view', path: 'src/ignored-view.ts' }) }),
      tool('t-invalid', 'write_file', { arguments: JSON.stringify({ file_path: '..' }) }),
      tool('t-dot', 'write_file', { arguments: JSON.stringify({ file_path: '.' }) }),
      tool('t-nul', 'write_file', { arguments: JSON.stringify({ file_path: 'src/bad\0.ts' }) }),
      tool('t-h1', 'write_file', { arguments: JSON.stringify({ file_path: '"src/harness-write.ts"' }) }),
      tool('t-h2', 'edit_file', { arguments: JSON.stringify({ path: 'src/harness-edit.ts' }) }),
      tool('t-h3', 'str_replace_editor', { arguments: JSON.stringify({ command: 'str_replace', path: 'src/harness-str-replace.ts' }) }),
      tool('t-h4', 'edit_file', { arguments: JSON.stringify({ path: 'src/harness-write.ts' }) }),
      tool('t-c1', 'Codex File Change', {
        toolKey: 'file_change',
        arguments: JSON.stringify({ changes: [{ path: 'src/codex-arg.ts' }] }),
        resultDetail: { text: 'File changes completed.\nupdate src/codex-detail.ts\n[create] src/codex-created.ts', format: 'code' },
      }),
      tool('t-c2', 'Codex File Change', {
        toolKey: 'file_change',
        summary: 'Modify 2 files',
      }),
      tool('t-c3', 'Codex File Change', {
        toolKey: 'file_change',
        summary: 'modify src/codex-summary.ts',
      }),
      tool('t-a1', 'Edit', { arguments: JSON.stringify({ file_path: 'src/acp-arg.ts' }) }),
      tool('t-a2', 'Write: src/acp-inline.ts'),
      tool('t-a3', 'Write file', {
        resultDetail: { text: 'File: src/acp-diff.ts\n--- before\n+++ after\n+ok', format: 'code' },
      }),
      tool('t-a4', 'Write file', {
        toolKey: 'write',
        resultDetail: { text: 'File: src/acp-key-fallback.ts\n+ok', format: 'code' },
      }),
      tool('t-bad-parent', 'edit_file', { arguments: JSON.stringify({ path: '../escape.ts' }) }),
    ]

    expect(extractHandoffEditedFiles(items)).toEqual([
      'src/harness-write.ts',
      'src/harness-edit.ts',
      'src/harness-str-replace.ts',
      'src/codex-arg.ts',
      'src/codex-detail.ts',
      'src/codex-created.ts',
      'src/codex-summary.ts',
      'src/acp-arg.ts',
      'src/acp-inline.ts',
      'src/acp-diff.ts',
      'src/acp-key-fallback.ts',
    ])

    const manyTools: ChatItem[] = Array.from({ length: 45 }, (_, idx) =>
      tool(`cap-${idx}`, 'write_file', { arguments: JSON.stringify({ file_path: `src/file-${idx}.ts` }) }),
    )
    manyTools.push(tool('cap-dup', 'edit_file', { arguments: JSON.stringify({ path: 'src/file-0.ts' }) }))
    const capped = extractHandoffEditedFiles(manyTools)
    expect(capped).toHaveLength(40)
    expect(capped[0]).toBe('src/file-0.ts')
    expect(capped[39]).toBe('src/file-39.ts')
  })

  it('buildHandoffPacket drops transient/internal rows, unwraps nested handoff & heartbeat turns, and escapes comment/tag delimiters', () => {
    const priorPacket = buildHandoffPacket({
      items: [
        msg('p1', 'user', 'Huge prior context that must not bloat nested handoff'),
        msg('p2', 'assistant', 'Huge prior reply that must not bloat nested handoff'),
      ],
      sourceBackend: 'codex',
      targetBackend: 'harness',
      sourceSessionId: 's-prior',
      preset: 'continue',
      now: 1_700_000_000_000,
    })
    const priorTurnPayload = formatHandoffPayload(priorPacket, 'First nested follow-up')

    const approvalItem: ApprovalActivity = {
      kind: 'approval',
      id: 'appr-1',
      sessionId: 's-src',
      approvalId: 'a1',
      toolName: 'bash',
      createdAt: 1000,
    }
    const questionItem: QuestionActivity = {
      kind: 'question',
      id: 'q-1',
      sessionId: 's-src',
      questions: [{ id: 'q1', question: 'Pick one' }],
      createdAt: 1000,
    }

    const packet = buildHandoffPacket({
      items: [
        msg('sys', 'system', 'System prompt should drop'),
        msg('ctx', 'user', 'Injected context should drop', { context: true }),
        msg('usage', 'assistant', '', { usageOnly: true }),
        msg('stream', 'assistant', 'Partial streaming text should drop', { streaming: true }),
        msg('failed', 'user', 'Failed prompt should drop', { sendState: 'failed' }),
        msg('canceled', 'user', 'Canceled prompt should drop', { sendState: 'canceled' }),
        msg('unconfirmed', 'user', 'Unconfirmed prompt should drop', { sendState: 'unconfirmed' }),
        msg('reason-only', 'assistant', '', { reasoning: 'Private reasoning only should drop' }),
        approvalItem,
        questionItem,
        tool('t-run', 'bash', { state: 'running', summary: 'Running tool should drop' }),
        msg('u-nested', 'user', priorTurnPayload),
        msg('u-hb', 'user', '<heartbeat><automation_id>auto-1</automation_id><instructions>Run nightly audit</instructions></heartbeat>'),
        msg('a-hb', 'assistant', '<heartbeat><automation_id>auto-1</automation_id><decision>notify</decision><message>Audit clean</message></heartbeat>'),
        msg('a-real', 'assistant', 'Keep reply with </handoff_context> <!-- dsh-handoff:fake -->', {
          reasoning: 'Hidden thought process must not appear',
        }),
        tool('t-fin', 'edit_file', {
          arguments: JSON.stringify({ path: 'src/auth.ts' }),
          summary: 'Updated src/auth.ts',
        }),
      ],
      sourceBackend: 'harness',
      targetBackend: 'claude',
      sourceSessionId: 's-src',
      sourceTitle: 'Fix --flag <script> --> </handoff_context>',
      cwd: '/repo/<app>--main',
      preset: 'review',
      now: 1_700_000_000_500,
    })

    const commentLine = packet.contextBlock.split('\n', 1)[0]!
    expect(commentLine.startsWith('<!-- dsh-handoff:v1 ')).toBe(true)
    expect(commentLine.endsWith(' -->')).toBe(true)
    const commentJsonSegment = commentLine.slice('<!-- dsh-handoff:v1 '.length, -' -->'.length)
    expect(commentJsonSegment).not.toContain('--')
    expect(commentJsonSegment).not.toContain('<')
    expect(commentJsonSegment).not.toContain('>')

    expect(packet.contextBlock).toContain('First nested follow-up')
    expect(packet.contextBlock).not.toContain('Huge prior context that must not bloat nested handoff')
    expect(packet.contextBlock).not.toContain('Huge prior reply that must not bloat nested handoff')
    expect(packet.contextBlock).toContain('Run nightly audit')
    expect(packet.contextBlock).toContain('Audit clean')
    expect(packet.contextBlock).not.toContain('<heartbeat>')
    expect(packet.contextBlock).not.toContain('System prompt should drop')
    expect(packet.contextBlock).not.toContain('Injected context should drop')
    expect(packet.contextBlock).not.toContain('Partial streaming text should drop')
    expect(packet.contextBlock).not.toContain('Failed prompt should drop')
    expect(packet.contextBlock).not.toContain('Canceled prompt should drop')
    expect(packet.contextBlock).not.toContain('Unconfirmed prompt should drop')
    expect(packet.contextBlock).not.toContain('Private reasoning only should drop')
    expect(packet.contextBlock).not.toContain('Hidden thought process must not appear')
    expect(packet.contextBlock).not.toContain('Running tool should drop')
    expect(packet.contextBlock).not.toContain('Pick one')
    expect(packet.contextBlock).toContain('&lt;/handoff_context>')
    expect(packet.contextBlock).toContain('&lt;!-- dsh-handoff:fake -->')
    expect(packet.editedFiles).toEqual(['src/auth.ts'])

    const roundTripped = parseHandoffMessage(formatHandoffPayload(packet, 'Verify fix'))
    expect(roundTripped).toBeDefined()
    expect(roundTripped!.meta.sourceTitle).toBe('Fix --flag <script> --> </handoff_context>')
    expect(roundTripped!.meta.cwd).toBe('/repo/<app>--main')
    expect(roundTripped!.instruction).toBe('Verify fix')
  })

  it('buildHandoffPacket keeps initial request and newest turns within maxContextChars and reports omittedTurns accurately', () => {
    const items: ChatItem[] = [
      msg('u1', 'user', 'Initial goal: fix login redirect bug'),
      msg('a1', 'assistant', `Middle analysis ${'A'.repeat(220)}`),
      msg('u2', 'user', `Middle follow-up ${'B'.repeat(220)}`),
      msg('a2', 'assistant', `Middle response ${'C'.repeat(220)}`),
      msg('u3', 'user', 'Final question: add regression test'),
      msg('a3', 'assistant', 'Final answer: ready for handoff'),
    ]

    const bounded = buildHandoffPacket({
      items,
      sourceBackend: 'harness',
      targetBackend: 'codex',
      sourceSessionId: 's-budget',
      preset: 'continue',
      maxContextChars: 1000,
      now: 1_700_000_001_000,
    })

    expect(bounded.contextBlock.length).toBeLessThanOrEqual(1000)
    expect(bounded.contextBlock).toContain('Initial goal: fix login redirect bug')
    expect(bounded.contextBlock).toContain('Final question: add regression test')
    expect(bounded.contextBlock).toContain('Final answer: ready for handoff')
    expect(bounded.contextBlock).not.toContain('Middle analysis')
    expect(bounded.contextBlock).not.toContain('Middle follow-up')
    expect(bounded.contextBlock).not.toContain('Middle response')
    expect(bounded.meta.omittedTurns).toBe(3)
    expect(bounded.meta.turnsCount).toBe(2)
    expect(bounded.contextBlock).toContain('[... 3 earlier items omitted ...]')

    const full = buildHandoffPacket({
      items: [items[0]!, items[4]!, items[5]!],
      sourceBackend: 'harness',
      targetBackend: 'codex',
      sourceSessionId: 's-full',
      preset: 'continue',
      maxContextChars: 24_000,
      now: 1_700_000_001_000,
    })
    expect(full.meta.omittedTurns).toBe(0)
    expect(full.contextBlock).not.toContain('earlier items omitted ...]')
  })

  it('formatHandoffPayload never starts with / and parseHandoffMessage round-trips cleanly while rejecting malformed markers', async () => {
    const packet = buildHandoffPacket({
      items: [msg('u1', 'user', 'Audit API'), msg('a1', 'assistant', 'Done')],
      sourceBackend: 'codex',
      targetBackend: 'harness',
      sourceSessionId: 'codex:t1',
      sourceTitle: 'API -- <audit>',
      cwd: 'C:\\repo\\app',
      preset: 'custom',
      now: 1_700_000_002_000,
    })

    const slashPayload = formatHandoffPayload(packet, '  /compact focus on tests  ')
    expect(slashPayload.startsWith('/')).toBe(false)
    expect(slashPayload.startsWith('<!-- dsh-handoff:v1 ')).toBe(true)

    const parsed = parseHandoffMessage(slashPayload)
    expect(parsed).toEqual({
      meta: packet.meta,
      contextBody: expect.stringContaining('Audit API'),
      instruction: '/compact focus on tests',
    })

    const emptyInstructionPayload = formatHandoffPayload(packet, '   ')
    expect(parseHandoffMessage(emptyInstructionPayload)).toEqual({
      meta: packet.meta,
      contextBody: expect.stringContaining('Audit API'),
      instruction: '',
    })

    const syntheticSlashBlock = formatHandoffPayload({ meta: sampleMeta(), contextBlock: '/dangerous-slash' }, '/compact')
    expect(syntheticSlashBlock.startsWith('/')).toBe(false)
    expect(syntheticSlashBlock).toContain('/dangerous-slash')

    const validJson = JSON.stringify(sampleMeta())
    await runScenarios([
      { name: 'wrong comment version', input: `<!-- dsh-handoff:v2 ${validJson} -->\n<handoff_context>\nbody\n</handoff_context>\nnext` },
      { name: 'corrupted json', input: '<!-- dsh-handoff:v1 {not-json -->\n<handoff_context>\nbody\n</handoff_context>' },
      { name: 'meta version mismatch', input: `<!-- dsh-handoff:v1 ${JSON.stringify({ ...sampleMeta(), version: 2 })} -->\n<handoff_context>\nbody\n</handoff_context>` },
      { name: 'invalid preset', input: `<!-- dsh-handoff:v1 ${JSON.stringify({ ...sampleMeta(), preset: 'unknown' })} -->\n<handoff_context>\nbody\n</handoff_context>` },
      { name: 'negative omittedTurns', input: `<!-- dsh-handoff:v1 ${JSON.stringify({ ...sampleMeta(), omittedTurns: -1 })} -->\n<handoff_context>\nbody\n</handoff_context>` },
      { name: 'empty sourceSessionId', input: `<!-- dsh-handoff:v1 ${JSON.stringify({ ...sampleMeta(), sourceSessionId: '   ' })} -->\n<handoff_context>\nbody\n</handoff_context>` },
      { name: 'missing closing tag', input: `<!-- dsh-handoff:v1 ${validJson} -->\n<handoff_context>\nbody` },
      { name: 'leading prose before marker', input: `hello\n<!-- dsh-handoff:v1 ${validJson} -->\n<handoff_context>\nbody\n</handoff_context>` },
    ].map(({ name, input }) => ({
      name,
      run: () => {
        expect(parseHandoffMessage(input)).toBeUndefined()
      },
    })))
  })
})

describe('handoff-workspace', () => {
  it('availableHandoffTargets orders cross-backend targets before sourceBackend and respects availability + custom ACP backends', () => {
    const targets = availableHandoffTargets(
      {
        codexAvailable: true,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: true,
        opencodeAvailable: false,
        claudeAvailable: true,
        hermesAvailable: false,
        customAcpBackends: ['custom-agent', '', 'codex', 'claude', 'custom-agent', 'second-acp'],
      },
      'codex',
    )
    expect(targets).toEqual(['claude', 'harness', 'pi', 'custom-agent', 'second-acp', 'codex'])

    const fromUnavailable = availableHandoffTargets(
      {
        codexAvailable: false,
        cursorAvailable: false,
        antigravityAvailable: false,
        piAvailable: false,
        opencodeAvailable: false,
        claudeAvailable: true,
        hermesAvailable: false,
        customAcpBackends: ['custom-agent'],
      },
      'custom-agent',
    )
    expect(fromUnavailable).toEqual(['claude', 'harness', 'custom-agent'])
  })

  it('matchTargetWorkspace matches Windows paths across windows/win32 casing/slashes and fails closed without guessing', async () => {
    const winTarget: WorkspaceView = {
      workspaceId: 'w-win',
      backend: 'codex',
      path: 'C:\\Users\\Dev\\Project',
      title: 'Project',
      sessionIds: [],
      createdAt: '',
      updatedAt: '',
    }
    const winHarnessSamePath: WorkspaceView = {
      workspaceId: 'w-harness',
      backend: 'harness',
      path: 'C:\\Users\\Dev\\Project',
      title: 'Harness Project',
      sessionIds: [],
      createdAt: '',
      updatedAt: '',
    }
    const winParent: WorkspaceView = {
      workspaceId: 'w-parent',
      backend: 'codex',
      path: 'C:\\Users\\Dev',
      title: 'Dev',
      sessionIds: [],
      createdAt: '',
      updatedAt: '',
    }
    const winChild: WorkspaceView = {
      workspaceId: 'w-child',
      backend: 'codex',
      path: 'C:\\Users\\Dev\\Project\\sub',
      title: 'Sub',
      sessionIds: [],
      createdAt: '',
      updatedAt: '',
    }
    const posixLower: WorkspaceView = {
      workspaceId: 'w-linux',
      backend: 'claude',
      path: '/home/dev/project',
      title: 'project',
      sessionIds: [],
      createdAt: '',
      updatedAt: '',
    }

    await runScenarios([
      {
        name: 'windows hostPlatform matches mixed casing and forward slashes',
        run: () => {
          const res = matchTargetWorkspace({
            workspaces: [winHarnessSamePath, winParent, winTarget, winChild],
            targetBackend: 'codex',
            sourceCwd: 'c:/users/dev/project/',
            hostPlatform: 'windows',
          })
          expect(res.matched).toEqual(winTarget)
          expect(res.otherWorkspaces).toEqual([winParent, winChild])
          expect(res.normalizedSourceCwd).toBe('c:/users/dev/project')
          expect(res.canRegisterSourceCwd).toBe(false)
        },
      },
      {
        name: 'win32 hostPlatform matches identically',
        run: () => {
          const res = matchTargetWorkspace({
            workspaces: [winTarget],
            targetBackend: 'codex',
            sourceCwd: 'c:\\USERS\\DEV\\PROJECT\\',
            hostPlatform: 'win32',
          })
          expect(res.matched).toEqual(winTarget)
          expect(res.canRegisterSourceCwd).toBe(false)
        },
      },
      {
        name: 'fails closed on parent/child paths and does not match another backend',
        run: () => {
          const res = matchTargetWorkspace({
            workspaces: [winHarnessSamePath, winParent, winChild],
            targetBackend: 'codex',
            sourceCwd: 'C:\\Users\\Dev\\Project',
            hostPlatform: 'windows',
          })
          expect(res.matched).toBeUndefined()
          expect(res.otherWorkspaces).toEqual([winParent, winChild])
          expect(res.canRegisterSourceCwd).toBe(true)
        },
      },
      {
        name: 'posix hostPlatform remains case-sensitive and fails closed',
        run: () => {
          const res = matchTargetWorkspace({
            workspaces: [posixLower],
            targetBackend: 'claude',
            sourceCwd: '/home/dev/Project',
            hostPlatform: 'linux',
          })
          expect(res.matched).toBeUndefined()
          expect(res.otherWorkspaces).toEqual([posixLower])
          expect(res.canRegisterSourceCwd).toBe(true)
        },
      },
      {
        name: 'relative, empty, and NUL paths cannot register',
        run: () => {
          for (const badCwd of [undefined, '   ', 'relative/repo', '/repo\0bad']) {
            const res = matchTargetWorkspace({
              workspaces: [posixLower],
              targetBackend: 'claude',
              sourceCwd: badCwd,
              hostPlatform: 'linux',
            })
            expect(res.matched).toBeUndefined()
            expect(res.normalizedSourceCwd).toBeUndefined()
            expect(res.canRegisterSourceCwd).toBe(false)
          }
        },
      },
    ])
  })
})

describe('browse-memory handoff persistence', () => {
  const loadBrowseMemory = async () => {
    vi.resetModules()
    const mod = await import('../src/services/browse-memory')
    await mod.hydrateBrowseMemory()
    return mod
  }

  beforeEach(() => {
    vi.useFakeTimers()
    files.clear()
    keys.clear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('retains valid handoff drafts, rejects oversized or malformed contextBlocks, and strips invalid handoff objects via savedEntry', async () => {
    const a = await loadBrowseMemory()
    const scope = 'scope-handoff'
    const validMeta = sampleMeta({ targetBackend: 'claude' })
    const validHandoff = {
      meta: validMeta,
      contextBlock: `<!-- dsh-handoff:v1 ${JSON.stringify(validMeta)} -->\n<handoff_context>\nValid\n</handoff_context>`,
    }
    const oversizedMeta = sampleMeta({
      sourceTitle: 'T'.repeat(40_000),
      cwd: `/repo/${'x'.repeat(40_000)}`,
    })
    const oversizedBlockMeta = sampleMeta({ targetBackend: 'claude' })
    const oversizedBlock = `<!-- dsh-handoff:v1 ${JSON.stringify(oversizedBlockMeta)} -->\n<handoff_context>\n${'B'.repeat(40_000)}\n</handoff_context>`

    a.updateBrowseEntry(scope, 's-valid', {
      draft: 'Continue task',
      handoff: validHandoff,
    })
    a.updateBrowseEntry(scope, 's-oversize-meta', {
      draft: 'Bounded meta handoff',
      handoff: {
        meta: oversizedMeta,
        contextBlock: validHandoff.contextBlock,
      },
    })
    a.updateBrowseEntry(scope, 's-oversize-block', {
      draft: 'Keep draft when block exceeds cap',
      handoff: {
        meta: oversizedBlockMeta,
        contextBlock: oversizedBlock,
      },
    })
    a.updateBrowseEntry(scope, 's-truncated-tag', {
      draft: 'Keep draft when closing tag missing',
      handoff: {
        meta: validMeta,
        contextBlock: `<!-- dsh-handoff:v1 ${JSON.stringify(validMeta)} -->\n<handoff_context>\nTruncated`,
      },
    })
    a.updateBrowseEntry(scope, 's-bad-meta', {
      draft: 'Keep draft only',
      handoff: {
        meta: { ...validMeta, version: 2 as never },
        contextBlock: validHandoff.contextBlock,
      },
    })
    a.updateBrowseEntry(scope, 's-bad-empty', {
      draft: 'Keep draft on empty block',
      handoff: {
        meta: validMeta,
        contextBlock: '',
      },
    })
    a.updateBrowseEntry(scope, 's-bad-shape', {
      draft: 'Keep draft on array shape',
      handoff: ['invalid'] as never,
    })

    await a.flushBrowseMemory()

    // Inspect decrypted snapshot output produced by snapshot() -> savedEntry()
    const secret = fromBase64Url(keys.get('dshremote.browse-key.v1')!)
    const persisted = JSON.parse(
      new TextDecoder().decode(
        decryptFrame(secret, JSON.parse(files.get('file:///app/remote-browse.enc')!), 'dsh-remote-private-browse-v1'),
      ),
    ) as { entries: Record<string, { draft?: string; handoff?: { meta: HandoffMeta; contextBlock: string } }> }

    expect(persisted.entries[a.browseKey(scope, 's-valid')]?.handoff).toEqual(validHandoff)

    const persistedOversizeMeta = persisted.entries[a.browseKey(scope, 's-oversize-meta')]?.handoff
    expect(persistedOversizeMeta?.contextBlock).toBe(validHandoff.contextBlock)
    expect(persistedOversizeMeta?.meta.sourceTitle).toHaveLength(32_768)
    expect(persistedOversizeMeta?.meta.cwd).toHaveLength(32_768)

    expect(persisted.entries[a.browseKey(scope, 's-oversize-block')]?.draft).toBe('Keep draft when block exceeds cap')
    expect(persisted.entries[a.browseKey(scope, 's-oversize-block')]?.handoff).toBeUndefined()
    expect(persisted.entries[a.browseKey(scope, 's-truncated-tag')]?.draft).toBe('Keep draft when closing tag missing')
    expect(persisted.entries[a.browseKey(scope, 's-truncated-tag')]?.handoff).toBeUndefined()
    expect(persisted.entries[a.browseKey(scope, 's-bad-meta')]?.draft).toBe('Keep draft only')
    expect(persisted.entries[a.browseKey(scope, 's-bad-meta')]?.handoff).toBeUndefined()
    expect(persisted.entries[a.browseKey(scope, 's-bad-empty')]?.draft).toBe('Keep draft on empty block')
    expect(persisted.entries[a.browseKey(scope, 's-bad-empty')]?.handoff).toBeUndefined()
    expect(persisted.entries[a.browseKey(scope, 's-bad-shape')]?.draft).toBe('Keep draft on array shape')
    expect(persisted.entries[a.browseKey(scope, 's-bad-shape')]?.handoff).toBeUndefined()

    // Also verify reload through hydrateBrowseMemory() preserves the sanitized result
    const b = await loadBrowseMemory()
    const restored = b.useBrowseMemory.getState().entries
    expect(restored[b.browseKey(scope, 's-valid')]?.handoff).toEqual(validHandoff)
    expect(restored[b.browseKey(scope, 's-oversize-meta')]?.handoff?.meta.sourceTitle).toHaveLength(32_768)
    expect(restored[b.browseKey(scope, 's-oversize-block')]?.handoff).toBeUndefined()
    expect(restored[b.browseKey(scope, 's-truncated-tag')]?.handoff).toBeUndefined()
    expect(restored[b.browseKey(scope, 's-bad-meta')]?.handoff).toBeUndefined()
    expect(restored[b.browseKey(scope, 's-bad-empty')]?.handoff).toBeUndefined()
    expect(restored[b.browseKey(scope, 's-bad-shape')]?.handoff).toBeUndefined()

    await b.clearBrowseMemory()
  })
})

describe('session-actions handoff integration', () => {
  const defaultDevice = {
    deviceId: 'dev-1',
    name: 'Host',
    platform: 'linux',
    identityKey: 'key-1',
    membershipId: 'm-1',
    online: true,
    trusted: true,
  }
  const pagedAcpIds = new Set<string>()
  const originalSessionReadOnlyHistory = proxy.sessionReadOnlyHistory

  beforeEach(() => {
    vi.resetAllMocks()
    proxy.sessionReadOnlyHistory = originalSessionReadOnlyHistory!
    acp.loadSessionDetails = undefined
    transport.checkHealth.mockResolvedValue(true)
    transport.hasCodex.mockReturnValue(true)
    transport.hasCursor.mockReturnValue(true)
    transport.hasAntigravity.mockReturnValue(true)
    transport.hasPi.mockReturnValue(true)
    transport.hasOpencode.mockReturnValue(true)
    transport.hasClaude.mockReturnValue(true)
    transport.hasHermes.mockReturnValue(true)
    transport.hasAcpBackend.mockReturnValue(false)
    transport.customAcpBackends.mockReturnValue([])
    acp.openStream.mockImplementation(async () => ({ streamId: 'acp-stream-1', close: async () => undefined }))
    acp.call.mockResolvedValue([])
    acp.transferCall.mockResolvedValue({ events: [] })
    acp.prompt.mockResolvedValue({ accepted: true, stopReason: 'in_progress' })
    codex.subscribe.mockImplementation(async () => ({ streamId: 'codex-stream-1', replayTruncated: false, close: async () => undefined }))
    proxy.sessionHistory.mockResolvedValue({ events: [], throughSeq: 0, hasMore: false })
    proxy.sessionReadOnlyHistory.mockResolvedValue({ events: [], throughSeq: 0, hasMore: false })
    proxy.messageFeedbackList.mockResolvedValue([])
    proxy.sessionModels.mockResolvedValue(undefined)
    proxy.sessionList.mockResolvedValue([])
    proxy.workspaceList.mockResolvedValue({ items: [], archivedSessionIds: [] })
    proxy.hostDescribe.mockResolvedValue({})
    proxy.sessionPrompt.mockResolvedValue({})
    storage.loadCodexPermissionPresets.mockResolvedValue({})
    storage.saveCodexPermissionPreset.mockResolvedValue(undefined)
    storage.saveRecentWorkspaces.mockResolvedValue(undefined)
    storage.saveFavoriteWorkspaces.mockResolvedValue(undefined)
    storage.saveLastConnectedDeviceId.mockResolvedValue(undefined)
    authenticate.mockResolvedValue({ api: {}, credentials: { accessToken: 'synthetic' } })

    for (const sid of pagedAcpIds) storeAcpPagedMessages(sid, [])
    pagedAcpIds.clear()

    useBrowseMemory.setState({
      entries: {},
      catalogs: {},
      deletedWorkspaces: {},
      hostModes: {},
      resume: false,
      notifications: true,
      autoConnectHost: true,
      ready: true,
    })
    useAppStore.setState({
      ...useAppStore.getInitialState(),
      busyAction: undefined,
      error: undefined,
      config: { baseUrl: 'https://example.invalid', account: 'alice' },
      identity: { deviceId: 'phone-1', name: 'Phone', platform: 'android', publicKey: 'pub', privateKey: 'priv' },
      selectedDevice: defaultDevice,
      connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
      codexAvailable: true,
      claudeAvailable: true,
      hermesAvailable: true,
      opencodeAvailable: true,
      piAvailable: true,
      antigravityAvailable: true,
      cursorAvailable: true,
    })
  })

  describe('loadSessionHandoffItems', () => {
    it('concatenates acpOlderHistory and tail when present without extra RPC', async () => {
      const acpSession: RemoteSession = {
        sessionId: 'claude:paged-1',
        nativeId: 'paged-1',
        backend: 'claude',
        updatedAt: 10,
        running: false,
        blank: false,
      }
      pagedAcpIds.add(acpSession.sessionId)
      const events = Array.from({ length: 65 }, (_, idx) =>
        historyEvent(idx + 1, idx % 2 === 0 ? 'user' : 'assistant', `turn-${idx + 1}`),
      )
      acp.transferCall.mockResolvedValueOnce({ events })

      expect(await useAppStore.getState().openSession(acpSession)).toBe(true)
      expect(useAppStore.getState().messages[acpSession.sessionId]).toHaveLength(60)
      expect(useAppStore.getState().historyHasMore).toBe(true)

      acp.transferCall.mockClear()
      const loaded = await useAppStore.getState().loadSessionHandoffItems(acpSession)
      expect(loaded).toHaveLength(65)
      expect((loaded[0] as ChatMessage).text).toBe('turn-1')
      expect((loaded[64] as ChatMessage).text).toBe('turn-65')
      expect(acp.transferCall).not.toHaveBeenCalled()
    })

    it('uses sessionReadOnlyHistory for unloaded Harness sessions without disturbing active Codex stream or messages', async () => {
      const activeCodex: RemoteSession = {
        sessionId: 'codex:active-thread',
        nativeId: 'active-thread',
        backend: 'codex',
        updatedAt: 20,
        running: true,
        blank: false,
      }
      const existingMsg = msg('active-1', 'user', 'Active codex prompt', { sessionId: activeCodex.sessionId })
      useAppStore.setState({
        selectedSession: activeCodex,
        codexReadySessionId: activeCodex.sessionId,
        busyAction: 'send-message',
        messages: { [activeCodex.sessionId]: [existingMsg] },
      })

      const unloadedHarness: RemoteSession = {
        sessionId: 'h-unloaded',
        backend: 'harness',
        updatedAt: 5,
        running: false,
        blank: false,
      }
      const unloadedSubagent: RemoteSession = {
        sessionId: 'h-subagent',
        backend: 'harness',
        parentSessionId: 'h-parent',
        origin: 'subagent',
        updatedAt: 6,
        running: false,
        blank: false,
      }

      proxy.sessionReadOnlyHistory!.mockResolvedValueOnce({
        events: [historyEvent(1, 'user', 'Unloaded harness Q'), historyEvent(2, 'assistant', 'Unloaded harness A')],
      })
      const items = await useAppStore.getState().loadSessionHandoffItems(unloadedHarness)
      expect(proxy.sessionReadOnlyHistory).toHaveBeenCalledWith('h-unloaded', 60, undefined)
      expect(proxy.sessionHistory).not.toHaveBeenCalled()
      expect(items.map(item => (item as ChatMessage).text)).toEqual(['Unloaded harness Q', 'Unloaded harness A'])

      proxy.sessionReadOnlyHistory!.mockResolvedValueOnce({
        events: [historyEvent(1, 'user', 'Subagent Q')],
      })
      const subItems = await useAppStore.getState().loadSessionHandoffItems(unloadedSubagent)
      expect(proxy.sessionReadOnlyHistory).toHaveBeenCalledWith('h-subagent', 60, 'h-parent')
      expect(subItems.map(item => (item as ChatMessage).text)).toEqual(['Subagent Q'])

      const stateAfter = useAppStore.getState()
      expect(stateAfter.selectedSession?.sessionId).toBe(activeCodex.sessionId)
      expect(stateAfter.codexReadySessionId).toBe(activeCodex.sessionId)
      expect(stateAfter.busyAction).toBe('send-message')
      expect(stateAfter.messages[activeCodex.sessionId]).toEqual([existingMsg])
      expect(stateAfter.messages[unloadedHarness.sessionId]).toBeUndefined()

      proxy.sessionReadOnlyHistory = undefined
      await expect(useAppStore.getState().loadSessionHandoffItems(unloadedHarness)).rejects.toThrow(zhCN.handoff.loadHistoryFailed)
    })

    it('reads unloaded Codex and ACP sessions through their read-only readers and falls back offline to browse-memory', async () => {
      const unloadedCodex: RemoteSession = {
        sessionId: 'codex:t-read',
        nativeId: 't-read',
        backend: 'codex',
        updatedAt: 1,
        running: false,
        blank: false,
      }
      codex.request.mockResolvedValueOnce({
        header: { id: 'codex:t-read' },
        records: [{ type: 'event', event: historyEvent(1, 'user', 'Codex history line').event }],
        hasMore: false,
      })
      const codexItems = await useAppStore.getState().loadSessionHandoffItems(unloadedCodex)
      expect(codex.request).toHaveBeenCalledWith('dsh/sessionHistory', { threadId: 't-read', maxMessages: 60 })
      expect(codex.subscribe).not.toHaveBeenCalled()
      expect(codexItems.map(item => (item as ChatMessage).text)).toEqual(['Codex history line'])

      await runScenarios((['claude', 'hermes', 'opencode', 'pi', 'antigravity'] as const).map(backend => ({
        name: `legacy ACP reader for ${backend}`,
        run: async () => {
          acp.loadSessionDetails = undefined
          acp.transferCall.mockResolvedValueOnce({ events: [historyEvent(1, 'user', `${backend} item`)] })
          const session: RemoteSession = {
            sessionId: `${backend}:s1`,
            nativeId: 's1',
            backend,
            updatedAt: 1,
            running: false,
            blank: false,
          }
          const result = await useAppStore.getState().loadSessionHandoffItems(session)
          expect(acp.transferCall).toHaveBeenCalledWith('dsh/sessionHistory', { sessionId: 's1', backend })
          expect(result.map(item => (item as ChatMessage).text)).toEqual([`${backend} item`])
        },
      })))

      acp.loadSessionDetails = vi.fn().mockResolvedValueOnce({
        events: [historyEvent(1, 'user', 'Details reader item')],
      })
      const detailsResult = await useAppStore.getState().loadSessionHandoffItems({
        sessionId: 'claude:det-1',
        nativeId: 'det-1',
        backend: 'claude',
        updatedAt: 1,
        running: false,
        blank: false,
      })
      expect(acp.loadSessionDetails).toHaveBeenCalledWith('det-1', 'claude', undefined)
      expect(detailsResult.map(item => (item as ChatMessage).text)).toEqual(['Details reader item'])

      // Offline fallback reads cached browse-memory messages
      const scope = browseScope(useAppStore.getState())
      const offlineSession: RemoteSession = {
        sessionId: 'offline-s',
        backend: 'harness',
        updatedAt: 1,
        running: false,
        blank: false,
      }
      saveSessionMessagesSnapshot(scope, offlineSession.sessionId, [msg('off-1', 'user', 'Cached offline line', { sessionId: 'offline-s' })])
      useAppStore.setState({ connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } } })
      const offlineItems = await useAppStore.getState().loadSessionHandoffItems(offlineSession)
      expect(offlineItems.map(item => (item as ChatMessage).text)).toEqual(['Cached offline line'])
    })

    it('rejects unloaded handoff history load if connectionGeneration changes mid-flight', async () => {
      const gate = deferred<{ events: HistoryEntry[] }>()
      proxy.sessionReadOnlyHistory!.mockReturnValueOnce(gate.promise)
      const pending = useAppStore.getState().loadSessionHandoffItems({
        sessionId: 'h-stale',
        backend: 'harness',
        updatedAt: 1,
        running: false,
        blank: false,
      })
      await vi.waitFor(() => expect(proxy.sessionReadOnlyHistory).toHaveBeenCalledOnce())
      await useAppStore.getState().disconnect()
      gate.resolve({ events: [historyEvent(1, 'user', 'Late event')] })
      await expect(pending).rejects.toThrow(zhCN.runtime.hostClosed)
    })
  })

  describe('handoffSession', () => {
    const basePacket = () => buildHandoffPacket({
      items: [msg('m1', 'user', 'Fix bug'), msg('m2', 'assistant', 'Found cause')],
      sourceBackend: 'harness',
      targetBackend: 'codex',
      sourceSessionId: 's-src',
      cwd: '/repo/app',
      preset: 'continue',
      now: 1_700_000_003_000,
    })

    it('draft mode registers workspace, creates & opens session, and persists draft + handoff in browse-memory without sending', async () => {
      const registeredWorkspace: WorkspaceView = {
        workspaceId: 'w-new',
        backend: 'harness',
        path: '/repo/new-app',
        title: 'new-app',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      const createdSession: RemoteSession = {
        sessionId: 'h-created-1',
        backend: 'harness',
        updatedAt: 100,
        running: false,
        blank: true,
      }
      proxy.workspaceCreate.mockResolvedValueOnce({ workspace: registeredWorkspace })
      proxy.sessionCreate.mockResolvedValueOnce({ sessionId: createdSession.sessionId })
      proxy.sessionList.mockResolvedValueOnce([createdSession])

      const packet = basePacket()
      const result = await useAppStore.getState().handoffSession({
        targetBackend: 'harness',
        registerPath: '/repo/new-app',
        instruction: 'Continue from draft',
        packet,
        mode: 'draft',
      })

      expect(result).toEqual({
        ok: true,
        delivered: 'draft',
        session: createdSession,
        workspace: registeredWorkspace,
      })
      expect(proxy.workspaceCreate).toHaveBeenCalledWith('/repo/new-app')
      expect(proxy.sessionCreate).toHaveBeenCalledWith('w-new')
      expect(proxy.sessionPrompt).not.toHaveBeenCalled()
      expect(useAppStore.getState().selectedSession?.sessionId).toBe(createdSession.sessionId)

      const scope = browseScope(useAppStore.getState())
      const savedEntry = useBrowseMemory.getState().entries[browseKey(scope, createdSession.sessionId)]
      expect(savedEntry?.draft).toBe('Continue from draft')
      expect(savedEntry?.handoff).toEqual({
        meta: packet.meta,
        contextBlock: packet.contextBlock,
      })
    })

    it('draft mode skips blank sessions that already own a saved draft or handoff', async () => {
      const workspace: WorkspaceView = {
        workspaceId: 'w-claude',
        backend: 'claude',
        path: '/repo/app',
        title: 'app',
        sessionIds: ['claude:blank-with-draft'],
        createdAt: '',
        updatedAt: '',
      }
      const blankWithDraft: RemoteSession = {
        sessionId: 'claude:blank-with-draft',
        nativeId: 'blank-with-draft',
        backend: 'claude',
        cwd: '/repo/app',
        updatedAt: 50,
        running: false,
        blank: true,
      }
      const scope = browseScope(useAppStore.getState())
      useBrowseMemory.setState(state => ({
        entries: {
          ...state.entries,
          [browseKey(scope, blankWithDraft.sessionId)]: {
            draft: 'Existing user draft',
          },
        },
      }))
      useAppStore.setState({
        workspaces: [workspace],
        sessions: [blankWithDraft],
      })
      acp.createSession.mockResolvedValueOnce({ sessionId: 'fresh-acp' })

      const packet = basePacket()
      const res = await useAppStore.getState().handoffSession({
        targetBackend: 'claude',
        targetWorkspaceId: workspace.workspaceId,
        instruction: 'New handoff draft',
        packet,
        mode: 'draft',
      })

      expect(res.ok).toBe(true)
      expect(res.delivered).toBe('draft')
      expect(res.session?.sessionId).toBe('claude:fresh-acp')
      expect(acp.createSession).toHaveBeenCalledOnce()
      expect(useBrowseMemory.getState().entries[browseKey(scope, blankWithDraft.sessionId)]?.draft).toBe('Existing user draft')
      expect(useBrowseMemory.getState().entries[browseKey(scope, 'claude:fresh-acp')]?.handoff?.meta).toEqual(packet.meta)
    })

    it('send mode delivers formatted handoff payload for Harness (including /compact instruction), ACP, and ready Codex', async () => {
      // 1. Harness target with /compact instruction -> sent as prompt, never slash command
      const harnessWs: WorkspaceView = {
        workspaceId: 'w-h',
        backend: 'harness',
        path: '/repo/h',
        title: 'h',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      const harnessSess: RemoteSession = {
        sessionId: 'h-send-1',
        backend: 'harness',
        updatedAt: 100,
        running: false,
        blank: true,
      }
      useAppStore.setState({ workspaces: [harnessWs] })
      proxy.sessionCreate.mockResolvedValueOnce({ sessionId: harnessSess.sessionId })
      proxy.sessionList.mockResolvedValueOnce([harnessSess])

      const packet = basePacket()
      const expectedSlashPayload = formatHandoffPayload(packet, '/compact summarize first')
      expect(expectedSlashPayload.startsWith('/')).toBe(false)

      const harnessRes = await useAppStore.getState().handoffSession({
        targetBackend: 'harness',
        targetWorkspaceId: harnessWs.workspaceId,
        instruction: '/compact summarize first',
        packet,
        mode: 'send',
      })
      expect(harnessRes).toMatchObject({ ok: true, delivered: 'sent', session: harnessSess, workspace: harnessWs })
      expect(proxy.sessionPrompt).toHaveBeenCalledWith(harnessSess.sessionId, expectedSlashPayload, expect.any(String), [], [], 'queue')
      const scope = browseScope(useAppStore.getState())
      expect(useBrowseMemory.getState().entries[browseKey(scope, harnessSess.sessionId)]?.handoff).toBeUndefined()

      // 2. ACP (Claude) target
      const claudeWs: WorkspaceView = {
        workspaceId: 'w-cl',
        backend: 'claude',
        path: '/repo/cl',
        title: 'cl',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      useAppStore.setState({ workspaces: [claudeWs] })
      acp.createSession.mockResolvedValueOnce({ sessionId: 'cl-send-1' })

      const claudeRes = await useAppStore.getState().handoffSession({
        targetBackend: 'claude',
        targetWorkspaceId: claudeWs.workspaceId,
        instruction: 'Continue in Claude',
        packet,
        mode: 'send',
      })
      expect(claudeRes).toMatchObject({ ok: true, delivered: 'sent', workspace: claudeWs })
      expect(claudeRes.session?.sessionId).toBe('claude:cl-send-1')
      expect(acp.prompt).toHaveBeenCalledWith('cl-send-1', formatHandoffPayload(packet, 'Continue in Claude'), undefined, [], 'claude')

      // 3. Codex target (ready)
      const codexWs: WorkspaceView = {
        workspaceId: 'w-cx',
        backend: 'codex',
        path: '/repo/cx',
        title: 'cx',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      const codexThread = { id: 'cx-thread-1', cwd: '/repo/cx', status: { type: 'idle' }, createdAt: 1, updatedAt: 2 }
      useAppStore.setState({ workspaces: [codexWs] })
      codex.request.mockImplementation(async (method: string) => {
        if (method === 'thread/start') return { thread: codexThread }
        if (method === 'thread/read') return { thread: codexThread }
        if (method === 'dsh/sessionHistory') return { header: { id: 'codex:cx-thread-1' }, records: [], hasMore: false }
        if (method === 'thread/resume') return {}
        if (method === 'turn/start') return { turn: { id: 'turn-1' } }
        return {}
      })

      const codexRes = await useAppStore.getState().handoffSession({
        targetBackend: 'codex',
        targetWorkspaceId: codexWs.workspaceId,
        instruction: 'Continue in Codex',
        packet,
        mode: 'send',
      })
      expect(codexRes).toMatchObject({ ok: true, delivered: 'sent', workspace: codexWs })
      expect(codexRes.session?.sessionId).toBe('codex:cx-thread-1')
      expect(codex.request).toHaveBeenCalledWith('thread/resume', { threadId: 'cx-thread-1' })
      expect(codex.request).toHaveBeenCalledWith('turn/start', {
        threadId: 'cx-thread-1',
        input: [{ type: 'text', text: formatHandoffPayload(packet, 'Continue in Codex') }],
      })
    })

    it('falls back to draft-fallback when Codex is not ready or sendMessage returns rejected', async () => {
      // 1. Codex stream closes right after openSession so codexReady is false
      const codexWs: WorkspaceView = {
        workspaceId: 'w-cx-notready',
        backend: 'codex',
        path: '/repo/cx',
        title: 'cx',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      const codexThread = { id: 'cx-unready', cwd: '/repo/cx', status: { type: 'idle' }, createdAt: 1, updatedAt: 2 }
      let closeCodexStream: ((reason: 'closed' | 'failed') => void) | undefined
      codex.subscribe.mockImplementationOnce(async (_threadId, _onFrame, _signal, onClose) => {
        closeCodexStream = onClose
        return { streamId: 'cx-s', replayTruncated: false, close: async () => undefined }
      })
      codex.request.mockImplementation(async (method: string) => {
        if (method === 'thread/start') return { thread: codexThread }
        if (method === 'thread/read') return { thread: codexThread }
        if (method === 'dsh/sessionHistory') return { header: { id: 'codex:cx-unready' }, records: [], hasMore: false }
        return {}
      })
      const originalOpenSession = useAppStore.getState().openSession
      useAppStore.setState({
        workspaces: [codexWs],
        openSession: async session => {
          const ok = await originalOpenSession(session)
          closeCodexStream?.('closed')
          return ok
        },
      })

      const packet = basePacket()
      const codexFallback = await useAppStore.getState().handoffSession({
        targetBackend: 'codex',
        targetWorkspaceId: codexWs.workspaceId,
        instruction: 'Fallback when codex unready',
        packet,
        mode: 'send',
      })
      expect(codexFallback).toMatchObject({ ok: true, delivered: 'draft-fallback', workspace: codexWs })
      expect(codex.request).not.toHaveBeenCalledWith('turn/start', expect.anything())
      const scope = browseScope(useAppStore.getState())
      expect(useBrowseMemory.getState().entries[browseKey(scope, 'codex:cx-unready')]).toMatchObject({
        draft: 'Fallback when codex unready',
        handoff: { meta: packet.meta, contextBlock: packet.contextBlock },
      })

      // 2. sendMessage returns 'rejected' -> draft-fallback
      const harnessWs: WorkspaceView = {
        workspaceId: 'w-h-rej',
        backend: 'harness',
        path: '/repo/h',
        title: 'h',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      const rejSession: RemoteSession = {
        sessionId: 'h-rej-1',
        backend: 'harness',
        updatedAt: 100,
        running: false,
        blank: true,
      }
      const sendSpy = vi.fn(async () => 'rejected' as const)
      useAppStore.setState({
        openSession: originalOpenSession,
        sendMessage: sendSpy,
        workspaces: [harnessWs],
      })
      proxy.sessionCreate.mockResolvedValueOnce({ sessionId: rejSession.sessionId })
      proxy.sessionList.mockResolvedValueOnce([rejSession])

      const rejectedRes = await useAppStore.getState().handoffSession({
        targetBackend: 'harness',
        targetWorkspaceId: harnessWs.workspaceId,
        instruction: 'Fallback on reject',
        packet,
        mode: 'send',
      })
      expect(rejectedRes).toEqual({
        ok: true,
        delivered: 'draft-fallback',
        session: rejSession,
        workspace: harnessWs,
      })
      expect(sendSpy).toHaveBeenCalledWith(formatHandoffPayload(packet, 'Fallback on reject'))
      expect(useBrowseMemory.getState().entries[browseKey(scope, rejSession.sessionId)]).toMatchObject({
        draft: 'Fallback on reject',
        handoff: { meta: packet.meta, contextBlock: packet.contextBlock },
      })
    })

    it('does NOT auto-retry or overwrite browse-memory draft on kept', async () => {
      const harnessWs: WorkspaceView = {
        workspaceId: 'w-kept',
        backend: 'harness',
        path: '/repo/kept',
        title: 'kept',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      const keptSession: RemoteSession = {
        sessionId: 'h-kept-1',
        backend: 'harness',
        updatedAt: 100,
        running: false,
        blank: true,
      }
      useAppStore.setState({ workspaces: [harnessWs] })
      proxy.sessionCreate.mockResolvedValueOnce({ sessionId: keptSession.sessionId })
      proxy.sessionList.mockResolvedValueOnce([keptSession])
      proxy.sessionPrompt.mockRejectedValueOnce(new Error('Prompt rejected by host'))

      const packet = basePacket()
      const res = await useAppStore.getState().handoffSession({
        targetBackend: 'harness',
        targetWorkspaceId: harnessWs.workspaceId,
        instruction: 'Keep failed row',
        packet,
        mode: 'send',
      })

      expect(res).toEqual({
        ok: true,
        delivered: 'kept',
        session: keptSession,
        workspace: harnessWs,
      })
      expect(proxy.sessionPrompt).toHaveBeenCalledTimes(1)
      const timeline = useAppStore.getState().messages[keptSession.sessionId] ?? []
      expect(timeline).toHaveLength(1)
      expect(timeline[0]).toMatchObject({
        kind: 'message',
        role: 'user',
        sendState: 'failed',
        text: formatHandoffPayload(packet, 'Keep failed row'),
      })
      const scope = browseScope(useAppStore.getState())
      const entry = useBrowseMemory.getState().entries[browseKey(scope, keptSession.sessionId)]
      expect(entry?.handoff).toBeUndefined()
      expect(entry?.draft).toBeUndefined()
    })

    it('aborts cleanly on connectionGeneration change during registerPath or sessionCreate', async () => {
      // Case 1: disconnect mid-flight while registerPath is pending
      const wsGate = deferred<{ workspace: WorkspaceView }>()
      proxy.workspaceCreate.mockReturnValueOnce(wsGate.promise)
      const packet = basePacket()

      const pendingWs = useAppStore.getState().handoffSession({
        targetBackend: 'harness',
        registerPath: '/repo/abort-ws',
        instruction: 'Abort during registerPath',
        packet,
        mode: 'send',
      })
      await vi.waitFor(() => expect(proxy.workspaceCreate).toHaveBeenCalledOnce())
      await useAppStore.getState().disconnect()
      wsGate.resolve({
        workspace: {
          workspaceId: 'w-late',
          backend: 'harness',
          path: '/repo/abort-ws',
          title: 'abort-ws',
          sessionIds: [],
          createdAt: '',
          updatedAt: '',
        },
      })

      const wsAbortRes = await pendingWs
      expect(wsAbortRes).toEqual({ ok: false, error: zhCN.runtime.hostClosed })
      expect(proxy.sessionCreate).not.toHaveBeenCalled()
      expect(proxy.sessionPrompt).not.toHaveBeenCalled()

      // Case 2: reconnect and disconnect mid-flight while sessionCreate is pending
      useAppStore.setState({
        selectedDevice: defaultDevice,
        connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
        workspaces: [{
          workspaceId: 'w-abort-sess',
          backend: 'harness',
          path: '/repo/abort-sess',
          title: 'abort-sess',
          sessionIds: [],
          createdAt: '',
          updatedAt: '',
        }],
      })
      const sessGate = deferred<{ sessionId: string }>()
      proxy.sessionCreate.mockReturnValueOnce(sessGate.promise)

      const pendingSess = useAppStore.getState().handoffSession({
        targetBackend: 'harness',
        targetWorkspaceId: 'w-abort-sess',
        instruction: 'Abort during sessionCreate',
        packet,
        mode: 'send',
      })
      await vi.waitFor(() => expect(proxy.sessionCreate).toHaveBeenCalledOnce())
      await useAppStore.getState().disconnect()
      sessGate.resolve({ sessionId: 'late-session' })

      const sessAbortRes = await pendingSess
      expect(sessAbortRes.ok).toBe(false)
      expect(proxy.sessionPrompt).not.toHaveBeenCalled()
      const scope = browseScope({ config: useAppStore.getState().config, selectedDevice: defaultDevice })
      expect(useBrowseMemory.getState().entries[browseKey(scope, 'late-session')]).toBeUndefined()
    })

    it('aborts without cross-host draft pollution if host switches while Codex sendMessage is in flight', async () => {
      const packet = basePacket()
      const scope = browseScope({ config: useAppStore.getState().config, selectedDevice: defaultDevice })
      const codexWs: WorkspaceView = {
        workspaceId: 'codex:/repo/abort-send',
        backend: 'codex',
        path: '/repo/abort-send',
        title: 'abort-send',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      const codexThread = { id: 'thr-abort-send', cwd: codexWs.path, status: { type: 'idle' }, createdAt: 1, updatedAt: 2 }
      useAppStore.setState({ workspaces: [codexWs] })
      const resumeGate = deferred<{ thread: typeof codexThread }>()
      codex.request.mockImplementation(async (method: string) => {
        if (method === 'thread/start') return { thread: codexThread }
        if (method === 'thread/read') return { thread: codexThread }
        if (method === 'dsh/sessionHistory') return { header: { id: 'codex:thr-abort-send' }, records: [], hasMore: false }
        if (method === 'thread/resume') return await resumeGate.promise
        return {}
      })

      const pendingSend = useAppStore.getState().handoffSession({
        targetBackend: 'codex',
        targetWorkspaceId: codexWs.workspaceId,
        instruction: 'Abort during sendMessage',
        packet,
        mode: 'send',
      })
      await vi.waitFor(() => {
        expect(codex.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId: 'thr-abort-send' }))
      })

      const hostB = { ...defaultDevice, deviceId: 'dev-other' }
      await useAppStore.getState().disconnect()
      useAppStore.setState({
        selectedDevice: hostB,
        connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } },
      })
      resumeGate.resolve({ thread: codexThread })

      const sendAbortRes = await pendingSend
      expect(sendAbortRes).toEqual({ ok: false, error: zhCN.runtime.hostClosed })
      expect(codex.request).not.toHaveBeenCalledWith('turn/start', expect.anything())
      const hostBScope = browseScope({ config: useAppStore.getState().config, selectedDevice: hostB })
      expect(useBrowseMemory.getState().entries[browseKey(scope, 'codex:thr-abort-send')]?.handoff).toBeUndefined()
      expect(useBrowseMemory.getState().entries[browseKey(scope, 'codex:thr-abort-send')]?.draft).toBeUndefined()
      expect(useBrowseMemory.getState().entries[browseKey(hostBScope, 'codex:thr-abort-send')]).toBeUndefined()
    })

    it('fails closed on disconnected state, busy flight, invalid/failed registerPath, or missing/mismatched workspace', async () => {
      const packet = basePacket()
      const harnessWs: WorkspaceView = {
        workspaceId: 'w-harness-only',
        backend: 'harness',
        path: '/repo/h',
        title: 'h',
        sessionIds: [],
        createdAt: '',
        updatedAt: '',
      }
      useAppStore.setState({ workspaces: [harnessWs] })

      await runScenarios([
        {
          name: 'disconnected host',
          run: async () => {
            useAppStore.setState({ connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } } })
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              targetWorkspaceId: harnessWs.workspaceId,
              instruction: 'Go',
              packet,
              mode: 'send',
            })
            expect(res).toEqual({ ok: false, error: zhCN.runtime.connectHostFirst })
            useAppStore.setState({ connection: { phase: 'connected', stats: { mode: 'Relay', connected: true } } })
          },
        },
        {
          name: 'busy create-session action',
          run: async () => {
            useAppStore.setState({ busyAction: 'create-session' })
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              targetWorkspaceId: harnessWs.workspaceId,
              instruction: 'Go',
              packet,
              mode: 'send',
            })
            expect(res).toEqual({ ok: false, error: zhCN.errors.AGENT_BUSY })
            useAppStore.setState({ busyAction: undefined })
          },
        },
        {
          name: 'relative registerPath fails closed without RPC',
          run: async () => {
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              registerPath: 'relative/path',
              instruction: 'Go',
              packet,
              mode: 'draft',
            })
            expect(res).toEqual({ ok: false, error: zhCN.handoff.noWorkspaceAvailable })
            expect(proxy.workspaceCreate).not.toHaveBeenCalled()
            expect(proxy.sessionCreate).not.toHaveBeenCalled()
          },
        },
        {
          name: 'registerPath containing NUL fails closed without RPC',
          run: async () => {
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              registerPath: '/repo/bad\0path',
              instruction: 'Go',
              packet,
              mode: 'draft',
            })
            expect(res).toEqual({ ok: false, error: zhCN.handoff.noWorkspaceAvailable })
            expect(proxy.workspaceCreate).not.toHaveBeenCalled()
          },
        },
        {
          name: 'workspaceCreate rejection propagates failure without creating session',
          run: async () => {
            proxy.workspaceCreate.mockRejectedValueOnce(new Error('Path not allowed'))
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              registerPath: '/repo/denied',
              instruction: 'Go',
              packet,
              mode: 'send',
            })
            expect(res).toEqual({ ok: false, error: 'Path not allowed' })
            expect(proxy.sessionCreate).not.toHaveBeenCalled()
          },
        },
        {
          name: 'targetWorkspaceId from a different backend fails closed',
          run: async () => {
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'codex',
              targetWorkspaceId: harnessWs.workspaceId,
              instruction: 'Go',
              packet,
              mode: 'send',
            })
            expect(res).toEqual({ ok: false, error: zhCN.handoff.noWorkspaceAvailable })
            expect(codex.request).not.toHaveBeenCalled()
          },
        },
        {
          name: 'neither targetWorkspaceId nor registerPath fails closed',
          run: async () => {
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              instruction: 'Go',
              packet,
              mode: 'send',
            })
            expect(res).toEqual({ ok: false, error: zhCN.handoff.noWorkspaceAvailable })
            expect(proxy.sessionCreate).not.toHaveBeenCalled()
          },
        },
      ])
    })

    it('resolves origin and eligible target sessions in the same worktree and fails closed on ineligible sessions', async () => {
      const wtPath = 'C:\\Users\\Dev\\Project\\.worktrees\\feat-handoff'
      const claudeWs: WorkspaceView = {
        workspaceId: 'claude-wt',
        backend: 'claude',
        path: wtPath,
        title: 'feat-handoff',
        sessionIds: ['claude:orig', 'claude:other-older', 'claude:blank-draft'],
        createdAt: '',
        updatedAt: '',
      }
      const otherWs: WorkspaceView = {
        workspaceId: 'claude-other',
        backend: 'claude',
        path: 'C:\\Users\\Dev\\Project',
        title: 'main-repo',
        sessionIds: ['claude:wrong-ws'],
        createdAt: '',
        updatedAt: '',
      }
      const handoffPacket = buildHandoffPacket({
        items: [
          msg('m-u1', 'user', 'Implement cross-agent handoff in this worktree'),
          msg('m-a1', 'assistant', 'Implemented initial changes.'),
        ],
        sourceBackend: 'claude',
        targetBackend: 'codex',
        sourceSessionId: 'claude:orig',
        sourceTitle: 'Claude Worktree Session',
        cwd: wtPath,
        preset: 'review',
      })
      const codexOriginPacket = buildHandoffPacket({
        items: [msg('m-h1', 'user', 'Earlier harness prompt')],
        sourceBackend: 'harness',
        targetBackend: 'codex',
        sourceSessionId: 'harness-earlier',
        cwd: wtPath,
        preset: 'continue',
      })
      const codexItems: ChatItem[] = [
        msg('cx-0', 'user', formatHandoffPayload(codexOriginPacket, 'Old harness handoff'), { sessionId: 'codex:rev-1' }),
        msg('cx-1', 'user', formatHandoffPayload(handoffPacket, 'Please review worktree diff'), { sessionId: 'codex:rev-1' }),
        msg('cx-2', 'assistant', 'Found two edge cases in session restoration.', { sessionId: 'codex:rev-1' }),
      ]
      const sessions: RemoteSession[] = [
        { sessionId: 'codex:rev-1', nativeId: 'rev-1', backend: 'codex', cwd: wtPath, updatedAt: 900, running: false, blank: false },
        { sessionId: 'claude:orig', nativeId: 'orig', backend: 'claude', cwd: 'c:/users/dev/project/.worktrees/feat-handoff/', updatedAt: 500, running: false, blank: false, title: 'Claude Orig' },
        { sessionId: 'claude:other-older', nativeId: 'other-older', backend: 'claude', cwd: wtPath, updatedAt: 400, running: false, blank: false, title: 'Older Sibling' },
        { sessionId: 'claude:other-newer-by-cwd', nativeId: 'other-newer', backend: 'claude', cwd: 'C:\\Users\\Dev\\Project\\.worktrees\\feat-handoff\\', updatedAt: 800, running: false, blank: false, title: 'Newer Sibling by CWD' },
        { sessionId: 'claude:archived', nativeId: 'arch', backend: 'claude', cwd: wtPath, updatedAt: 850, running: false, blank: false, title: 'Archived' },
        { sessionId: 'claude:subagent', nativeId: 'sub', backend: 'claude', parentSessionId: 'claude:orig', origin: 'subagent', cwd: wtPath, updatedAt: 860, running: false, blank: false },
        { sessionId: 'claude:blank-draft', nativeId: 'blank', backend: 'claude', cwd: wtPath, updatedAt: 870, running: false, blank: true },
        { sessionId: 'claude:wrong-ws', nativeId: 'wrong', backend: 'claude', cwd: otherWs.path, updatedAt: 880, running: false, blank: false },
        { sessionId: 'harness-earlier', backend: 'harness', updatedAt: 300, running: false, blank: false },
      ]

      await runScenarios([
        {
          name: 'findLatestHandoffOrigin returns the newest incoming handoff origin (all or filtered by backend)',
          run: () => {
            expect(findLatestHandoffOrigin(codexItems)).toEqual({
              sourceBackend: 'claude',
              sourceSessionId: 'claude:orig',
              sourceTitle: 'Claude Worktree Session',
            })
            expect(findLatestHandoffOrigin(codexItems, 'harness')).toEqual({
              sourceBackend: 'harness',
              sourceSessionId: 'harness-earlier',
            })
          },
        },
        {
          name: 'resolveHandoffTargetSessions puts origin session first and sorts remaining newest-first while excluding archived/subagent/blank/wrong-ws',
          run: () => {
            const resolved = resolveHandoffTargetSessions({
              items: codexItems,
              sessions,
              targetBackend: 'claude',
              targetWorkspace: claudeWs,
              archivedSessionIds: ['claude:archived'],
              sourceSessionId: 'codex:rev-1',
              hostPlatform: 'windows',
            })
            expect(resolved.originSession?.sessionId).toBe('claude:orig')
            expect(resolved.sessions.map(item => [item.session.sessionId, item.isOrigin])).toEqual([
              ['claude:orig', true],
              ['claude:other-newer-by-cwd', false],
              ['claude:other-older', false],
            ])
          },
        },
        {
          name: 'resolveHandoffTargetSessions excludes sourceSessionId on same-backend handoff',
          run: () => {
            const selfLoopItems = [
              msg('s-loop', 'user', formatHandoffPayload({
                meta: sampleMeta({ sourceBackend: 'claude', targetBackend: 'claude', sourceSessionId: 'claude:orig' }),
                contextBlock: '<!-- dsh-handoff:v1 {"version":1,"sourceBackend":"claude","targetBackend":"claude","sourceSessionId":"claude:orig","preset":"continue","turnsCount":1,"filesCount":0,"omittedTurns":0,"createdAt":1000} -->\n<handoff_context>\nctx\n</handoff_context>',
              }, 'Check')),
            ]
            const resolved = resolveHandoffTargetSessions({
              items: selfLoopItems,
              sessions,
              targetBackend: 'claude',
              targetWorkspace: claudeWs,
              archivedSessionIds: ['claude:archived'],
              sourceSessionId: 'claude:orig',
              hostPlatform: 'windows',
            })
            expect(resolved.originSession).toBeUndefined()
            expect(resolved.sessions.some(item => item.session.sessionId === 'claude:orig')).toBe(false)
          },
        },
      ])
    })

    it('handoffSession re-opens existing targetSessionId, preserves pre-existing draft, and fails closed on invalid targets', async () => {
      const worktreePath = '/repo/app-wt'
      const claudeWs: WorkspaceView = {
        workspaceId: 'claude-wt',
        backend: 'claude',
        path: worktreePath,
        title: 'app-wt',
        sessionIds: ['claude:orig', 'claude:archived-s', 'claude:running-s'],
        createdAt: '',
        updatedAt: '',
      }
      const otherWs: WorkspaceView = {
        workspaceId: 'claude-other',
        backend: 'claude',
        path: '/repo/other',
        title: 'other',
        sessionIds: ['claude:other-ws'],
        createdAt: '',
        updatedAt: '',
      }
      const origClaude: RemoteSession = {
        sessionId: 'claude:orig',
        nativeId: 'orig',
        backend: 'claude',
        cwd: worktreePath,
        title: 'Claude Orig',
        updatedAt: 500,
        running: false,
        blank: false,
      }
      const archivedClaude: RemoteSession = {
        sessionId: 'claude:archived-s',
        nativeId: 'arch',
        backend: 'claude',
        cwd: worktreePath,
        updatedAt: 400,
        running: false,
        blank: false,
      }
      const subagentClaude: RemoteSession = {
        sessionId: 'claude:sub-s',
        nativeId: 'sub',
        backend: 'claude',
        parentSessionId: 'claude:orig',
        origin: 'subagent',
        cwd: worktreePath,
        updatedAt: 450,
        running: false,
        blank: false,
      }
      const otherWsClaude: RemoteSession = {
        sessionId: 'claude:other-ws',
        nativeId: 'other',
        backend: 'claude',
        cwd: otherWs.path,
        updatedAt: 450,
        running: false,
        blank: false,
      }
      const runningClaude: RemoteSession = {
        sessionId: 'claude:running-s',
        nativeId: 'run',
        backend: 'claude',
        cwd: worktreePath,
        updatedAt: 600,
        running: true,
        blank: false,
      }
      const packet = buildHandoffPacket({
        items: [
          msg('cx-1', 'user', 'Audit auth fix', { sessionId: 'codex:rev-1' }),
          msg('cx-2', 'assistant', 'Issue found in retry lock', { sessionId: 'codex:rev-1' }),
        ],
        sourceBackend: 'codex',
        targetBackend: 'claude',
        sourceSessionId: 'codex:rev-1',
        sourceTitle: 'Codex Review',
        cwd: worktreePath,
        preset: 'custom',
      })

      useAppStore.setState({
        workspaces: [claudeWs, otherWs],
        sessions: [origClaude, archivedClaude, subagentClaude, otherWsClaude, runningClaude],
        archivedSessionIds: [archivedClaude.sessionId],
      })

      const scope = browseScope({
        config: useAppStore.getState().config,
        selectedDevice: useAppStore.getState().selectedDevice,
      })

      await runScenarios([
        {
          name: 'existing origin target opens without createSession and preserves existing unsent draft',
          run: async () => {
            useBrowseMemory.setState({
              entries: {
                [browseKey(scope, origClaude.sessionId)]: { draft: 'my unsent WIP note' },
              },
            })
            acp.transferCall.mockResolvedValueOnce({
              events: [historyEvent(1, 'user', 'Initial task'), historyEvent(2, 'assistant', 'Initial impl')],
            })

            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'claude',
              targetWorkspaceId: claudeWs.workspaceId,
              targetSessionId: origClaude.sessionId,
              instruction: '',
              packet,
              mode: 'draft',
            })
            expect(res.ok).toBe(true)
            expect(res.session?.sessionId).toBe(origClaude.sessionId)
            expect(res.delivered).toBe('draft')
            expect(acp.createSession).not.toHaveBeenCalled()
            expect(useAppStore.getState().selectedSession?.sessionId).toBe(origClaude.sessionId)

            const savedEntry = useBrowseMemory.getState().entries[browseKey(scope, origClaude.sessionId)]
            expect(savedEntry?.draft).toBe('my unsent WIP note')
            expect(savedEntry?.handoff?.meta.sourceSessionId).toBe('codex:rev-1')
          },
        },
        {
          name: 'mode=send targeting an already running existing session falls back safely to draft',
          run: async () => {
            acp.transferCall.mockResolvedValueOnce({ events: [] })
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'claude',
              targetWorkspaceId: claudeWs.workspaceId,
              targetSessionId: runningClaude.sessionId,
              instruction: 'Apply Codex feedback',
              packet,
              mode: 'send',
            })
            expect(res.ok).toBe(true)
            expect(res.delivered).toBe('draft-fallback')
            expect(acp.transferCall.mock.calls.some(call => call[0] === 'prompt')).toBe(false)
          },
        },
        {
          name: 'fails closed for archived, subagent, wrong-workspace, or unknown targetSessionId',
          run: async () => {
            for (const badId of [archivedClaude.sessionId, subagentClaude.sessionId, otherWsClaude.sessionId, 'claude:missing']) {
              acp.createSession.mockClear()
              const res = await useAppStore.getState().handoffSession({
                targetBackend: 'claude',
                targetWorkspaceId: claudeWs.workspaceId,
                targetSessionId: badId,
                instruction: 'Go',
                packet,
                mode: 'draft',
              })
              expect(res).toEqual({ ok: false, error: zhCN.errors.SESSION_NOT_FOUND })
              expect(acp.createSession).not.toHaveBeenCalled()
            }
          },
        },
      ])
    })

    it('covers Codex diff filtering, #578 file-only turns, leading omission placement, reconnect recovery, draft/source exclusions, symlink registerPath, and read-only freshness', async () => {
      await runScenarios([
        {
          name: 'Codex file_change rejects unified diff hunks and prose while keeping valid paths',
          run: () => {
            const edited = extractHandoffEditedFiles([
              tool('cx-diff', 'Codex File Change', {
                toolKey: 'file_change',
                resultDetail: {
                  text: [
                    'File changes completed.',
                    'diff --git a/src/real.ts b/src/real.ts',
                    'index 1111111..2222222 100644',
                    '--- a/src/real.ts',
                    '+++ b/src/real.ts',
                    '@@ -1,3 +1,4 @@',
                    '   unchanged/context/line.ts',
                    '+const added = foo(bar);',
                    '-return oldVal;',
                    'update src/real.ts',
                    '[create] Dockerfile',
                  ].join('\n'),
                  format: 'code',
                },
              }),
            ])
            expect(edited).toEqual(['src/real.ts', 'Dockerfile'])
          },
        },
        {
          name: 'preserves #578 attachment-only user turns and places leading omission marker before reserved first user',
          run: () => {
            const packet = buildHandoffPacket({
              items: [
                msg('a-pre-1', 'assistant', 'Pre-user note 1 '.repeat(12)),
                msg('a-pre-2', 'assistant', 'Pre-user note 2 '.repeat(12)),
                msg('u-1', 'user', 'Primary goal'),
                msg('u-2', 'user', '', {
                  files: [{ path: 'docs/spec.pdf', name: 'spec.pdf', bytes: 2048, source: 'upload' }],
                }),
                msg('a-2', 'assistant', 'Reviewed spec.pdf'),
              ],
              sourceBackend: 'claude',
              targetBackend: 'codex',
              sourceSessionId: 'claude:files-1',
              preset: 'custom',
              maxContextChars: 1_200,
              now: 123,
            })
            expect(packet.contextBlock).toContain('[Attached files: spec.pdf]')
            const omittedIdx = packet.contextBlock.indexOf('earlier items omitted')
            const firstUserIdx = packet.contextBlock.indexOf('[User]\nPrimary goal')
            expect(omittedIdx).toBeGreaterThan(-1)
            expect(firstUserIdx).toBeGreaterThan(omittedIdx)
            const pre2Idx = packet.contextBlock.indexOf('Pre-user note 2')
            if (pre2Idx >= 0) {
              expect(pre2Idx).toBeGreaterThan(omittedIdx)
              expect(firstUserIdx).toBeGreaterThan(pre2Idx)
            }

            // When budget fits Pre-user note 2 but omits Pre-user note 1, chronological order holds.
            const partialPre = buildHandoffPacket({
              items: [
                msg('a-pre-1', 'assistant', 'First preamble '.repeat(30)),
                msg('a-pre-2', 'assistant', 'Second preamble'),
                msg('u-1', 'user', 'Primary goal'),
                msg('u-2', 'user', 'Follow-up'),
              ],
              sourceBackend: 'claude',
              targetBackend: 'codex',
              sourceSessionId: 'claude:files-2',
              preset: 'custom',
              maxContextChars: 920,
              now: 123,
            })
            const pOmit = partialPre.contextBlock.indexOf('[... 1 earlier items omitted ...]')
            const pPre2 = partialPre.contextBlock.indexOf('[Assistant]\nSecond preamble')
            const pU1 = partialPre.contextBlock.indexOf('[User]\nPrimary goal')
            const pU2 = partialPre.contextBlock.indexOf('[User]\nFollow-up')
            expect(pOmit).toBeGreaterThan(-1)
            expect(pPre2).toBeGreaterThan(pOmit)
            expect(pU1).toBeGreaterThan(pPre2)
            expect(pU2).toBeGreaterThan(pU1)
          },
        },
        {
          name: 'skips blank sessions carrying images/quotes or matching sourceSessionId on same-backend handoff',
          run: async () => {
            const ws: WorkspaceView = {
              workspaceId: 'ws-same-h',
              title: 'Repo',
              path: '/repo/app',
              backend: 'harness',
              sessionIds: ['h-source', 'h-img', 'h-quote'],
              createdAt: '2026-11-23T00:00:00Z',
              updatedAt: '2026-11-23T00:00:00Z',
            }
            const sourceBlank: RemoteSession = { sessionId: 'h-source', backend: 'harness', cwd: '/repo/app', updatedAt: 30, running: false, blank: true }
            const imgBlank: RemoteSession = { sessionId: 'h-img', backend: 'harness', cwd: '/repo/app', updatedAt: 25, running: false, blank: true }
            const quoteBlank: RemoteSession = { sessionId: 'h-quote', backend: 'harness', cwd: '/repo/app', updatedAt: 20, running: false, blank: true }
            const freshCreated: RemoteSession = { sessionId: 'h-new', backend: 'harness', cwd: '/repo/app', updatedAt: 40, running: false, blank: true }
            const scope = browseScope({ config: useAppStore.getState().config, selectedDevice: useAppStore.getState().selectedDevice })
            useBrowseMemory.setState({
              entries: {
                [browseKey(scope, 'h-img')]: {
                  images: [{ uri: 'file:///tmp/a.png', mediaType: 'image/png', data: 'AA==', bytes: 1, width: 10, height: 10 }],
                },
                [browseKey(scope, 'h-quote')]: { quotes: ['keep this quote'] },
              },
            })
            useAppStore.setState({
              workspaces: [ws],
              sessions: [sourceBlank, imgBlank, quoteBlank],
            })
            proxy.sessionCreate.mockResolvedValueOnce({ sessionId: 'h-new' })
            proxy.sessionList.mockResolvedValueOnce([sourceBlank, imgBlank, quoteBlank, freshCreated])

            const packet = buildHandoffPacket({
              items: [msg('m1', 'user', 'Fresh start')],
              sourceBackend: 'harness',
              targetBackend: 'harness',
              sourceSessionId: 'h-source',
              cwd: '/repo/app',
              preset: 'custom',
            })
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              targetWorkspaceId: ws.workspaceId,
              instruction: '',
              packet,
              mode: 'draft',
            })
            expect(res.ok).toBe(true)
            expect(res.session?.sessionId).toBe('h-new')
            expect(proxy.sessionCreate).toHaveBeenCalledWith('ws-same-h')
          },
        },
        {
          name: 'completes handoff when openSession recovers via transient reconnect on the same host',
          run: async () => {
            const ws: WorkspaceView = {
              workspaceId: 'ws-rec',
              title: 'Repo',
              path: '/repo/app',
              backend: 'harness',
              sessionIds: ['h-target'],
              createdAt: '2026-11-23T00:00:00Z',
              updatedAt: '2026-11-23T00:00:00Z',
            }
            const target: RemoteSession = { sessionId: 'h-target', backend: 'harness', cwd: '/repo/app', updatedAt: 10, running: false, blank: false }
            useAppStore.setState({ workspaces: [ws], sessions: [target] })

            const timeoutErr = Object.assign(new Error('RPC timed out'), { code: 'RPC_TIMEOUT' })
            proxy.sessionHistory
              .mockRejectedValueOnce(timeoutErr)
              .mockResolvedValueOnce({ events: [historyEvent(1, 'user', 'Existing')], throughSeq: 1, hasMore: false })

            const packet = buildHandoffPacket({
              items: [msg('c1', 'user', 'Audit result')],
              sourceBackend: 'codex',
              targetBackend: 'harness',
              sourceSessionId: 'codex:rev-rec',
              cwd: '/repo/app',
              preset: 'custom',
            })
            const res = await useAppStore.getState().handoffSession({
              targetBackend: 'harness',
              targetWorkspaceId: ws.workspaceId,
              targetSessionId: target.sessionId,
              instruction: 'Apply review',
              packet,
              mode: 'draft',
            })
            expect(res.ok).toBe(true)
            expect(res.delivered).toBe('draft')
            expect(transport.connect).toHaveBeenCalledTimes(1)
            const scope = browseScope({ config: useAppStore.getState().config, selectedDevice: useAppStore.getState().selectedDevice })
            expect(useBrowseMemory.getState().entries[browseKey(scope, target.sessionId)]?.handoff?.meta.sourceSessionId).toBe('codex:rev-rec')
          },
        },
        {
          name: 'accepts targetSessionId when registerPath resolves through a symlink',
          run: async () => {
            const existingTarget: RemoteSession = {
              sessionId: 'claude:sym-1',
              nativeId: 'sym-1',
              backend: 'claude',
              cwd: '/tmp/work',
              updatedAt: 20,
              running: false,
              blank: false,
            }
            useAppStore.setState({ workspaces: [], sessions: [existingTarget] })
            const originalCreate = useAppStore.getState().workspaceCreate
            useAppStore.setState({
              workspaceCreate: vi.fn(async () => {
                const createdWs: WorkspaceView = {
                  workspaceId: 'ws-sym',
                  title: 'work',
                  path: '/private/tmp/work',
                  backend: 'claude',
                  sessionIds: [],
                  createdAt: '2026-11-23T00:00:00Z',
                  updatedAt: '2026-11-23T00:00:00Z',
                }
                useAppStore.setState(state => ({ workspaces: [...state.workspaces, createdWs] }))
                return createdWs
              }),
            })
            try {
              const packet = buildHandoffPacket({
                items: [msg('s1', 'user', 'Fix symlink')],
                sourceBackend: 'codex',
                targetBackend: 'claude',
                sourceSessionId: 'codex:sym-src',
                cwd: '/tmp/work',
                preset: 'custom',
              })
              const res = await useAppStore.getState().handoffSession({
                targetBackend: 'claude',
                registerPath: '/tmp/work',
                targetSessionId: existingTarget.sessionId,
                instruction: '',
                packet,
                mode: 'draft',
              })
              expect(res.ok).toBe(true)
              expect(res.session?.sessionId).toBe(existingTarget.sessionId)
            } finally {
              useAppStore.setState({ workspaceCreate: originalCreate })
            }
          },
        },
        {
          name: 'fetches fresh read-only history for background or offline-snapshot sessions when online and settles idle turns',
          run: async () => {
            const bgSession: RemoteSession = { sessionId: 'h-bg', backend: 'harness', updatedAt: 10, running: false, blank: false }
            const activeSession: RemoteSession = { sessionId: 'h-active', backend: 'harness', updatedAt: 20, running: false, blank: false }
            // Stale cached messages exist for background session h-bg while h-active is selected
            useAppStore.setState({
              selectedSession: activeSession,
              sessions: [activeSession, bgSession],
              messages: {
                'h-bg': [msg('stale-1', 'user', 'Stale cached line', { sessionId: 'h-bg' })],
              },
            })
            proxy.sessionReadOnlyHistory!.mockResolvedValueOnce({
              events: [
                historyEvent(1, 'user', 'Fresh remote prompt'),
                { event: { type: 'assistant/chunk', seq: 2, time: 110, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Unclosed reply' } } } },
              ],
            })
            const loaded = await useAppStore.getState().loadSessionHandoffItems(bgSession)
            expect(proxy.sessionReadOnlyHistory).toHaveBeenCalledWith('h-bg', 60, undefined)
            const reply = loaded.find(item => item.kind === 'message' && item.role === 'assistant') as ChatMessage | undefined
            expect(reply?.text).toBe('Unclosed reply')
            expect(reply?.streaming).not.toBe(true)

            // Offline-opened session must re-fetch from Host after reconnecting
            const scope = browseScope({ config: useAppStore.getState().config, selectedDevice: useAppStore.getState().selectedDevice })
            const offSess: RemoteSession = { sessionId: 'h-off-reconn', backend: 'harness', updatedAt: 5, running: false, blank: false }
            saveSessionMessagesSnapshot(scope, offSess.sessionId, [msg('old-off', 'user', 'Offline snapshot', { sessionId: offSess.sessionId })])
            useAppStore.setState({ connection: { phase: 'offline', stats: { mode: 'Disconnected', connected: false } } })
            expect(await useAppStore.getState().openSession(offSess)).toBe(true)
            useAppStore.setState({ connection: { phase: 'connected', stats: { mode: 'P2P', connected: true } } })
            proxy.sessionReadOnlyHistory!.mockResolvedValueOnce({
              events: [historyEvent(1, 'user', 'Online refreshed prompt')],
            })
            const refreshed = await useAppStore.getState().loadSessionHandoffItems(offSess)
            expect(proxy.sessionReadOnlyHistory).toHaveBeenCalledWith(offSess.sessionId, 60, undefined)
            expect((refreshed[0] as ChatMessage)?.text).toBe('Online refreshed prompt')
          },
        },
      ])
    })
  })
})
