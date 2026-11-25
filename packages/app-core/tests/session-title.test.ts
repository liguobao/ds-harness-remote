import { describe, expect, it } from 'vitest'
import {
  handoffPreviewTitle,
  parseHandoffPreview,
  sanitizeHandoffDisplayTitle,
} from '../src/lib/handoff-preview'
import { strings } from '../src/locales/i18n'
import {
  resolveSessionDisplayTitle,
  resolveSessionHandoffBadge,
} from '../src/screens/session-title'
import type { ChatItem, RemoteSession } from '../src/types'

describe('session display title', () => {
  const session: RemoteSession = {
    sessionId: 'codex:thread', backend: 'codex', updatedAt: 1, running: false, blank: false,
    projections: { values: { summary: 'Review the latest PR' } },
  }

  it('uses the thread preview until an official title is available', () => {
    expect(resolveSessionDisplayTitle(session)).toBe('Review the latest PR')
    expect(resolveSessionDisplayTitle({ ...session, title: 'PR review' })).toBe('PR review')
    expect(resolveSessionDisplayTitle({ ...session, projections: { values: { summary: 'Preview', title: 'Generated title' } } })).toBe('Generated title')
  })

  it('keeps empty new conversations untitled', () => {
    expect(resolveSessionDisplayTitle({ ...session, projections: { values: { summary: '  ' } } })).toBeUndefined()
  })

  it('parses truncated, legacy-order, and mid-escape handoff headers without leaking raw comments', () => {
    // 60-char / short OpenCode truncation mid-title
    const cutShort = '<!-- dsh-handoff:v1 {"sourceBackend":"harness","targetBackend":"codex","sourceTitle":"修复跨智能体标题'.slice(0, 92)
    expect(handoffPreviewTitle(cutShort)).toBe('修复跨智能体')

    // Mid-escape truncation (`\u00` at the end) and trailing single backslash (`\`)
    const cutEscape = '<!-- dsh-handoff:v1 {"sourceBackend":"harness","targetBackend":"codex","sourceTitle":"Fix \\u002d\\u00'
    expect(handoffPreviewTitle(cutEscape)).toBe('Fix -')
    const cutSingleBackslash = '<!-- dsh-handoff:v1 {"sourceBackend":"harness","targetBackend":"codex","sourceTitle":"Fix \\'
    expect(handoffPreviewTitle(cutSingleBackslash)).toBe('Fix')

    // Raw handoff header present only in projections.values.title / sessionListMetadata.title
    const projectedOnlyRaw = '<!-- dsh-handoff:v1 {"sourceBackend":"claude","targetBackend":"codex","sourceTitle":"修复投影标题"}'
    const projectedOnlySession: RemoteSession = {
      sessionId: 'codex:projected-only',
      backend: 'codex',
      updatedAt: 1,
      running: false,
      blank: false,
      projections: { values: { title: projectedOnlyRaw } },
    }
    expect(resolveSessionDisplayTitle(projectedOnlySession)).toBe('修复投影标题')
    expect(resolveSessionHandoffBadge(projectedOnlySession)).toMatchObject({
      isHandoff: true,
      sourceBackend: 'claude',
      targetBackend: 'codex',
    })
    const metaOnlySession: RemoteSession = {
      sessionId: 'h-meta-only',
      backend: 'harness',
      updatedAt: 1,
      running: false,
      blank: false,
      projections: { values: { sessionListMetadata: { title: projectedOnlyRaw } } },
    }
    expect(resolveSessionDisplayTitle(metaOnlySession)).toBe('修复投影标题')
    expect(resolveSessionHandoffBadge(metaOnlySession)).toMatchObject({
      isHandoff: true,
      sourceBackend: 'claude',
      targetBackend: 'codex',
    })

    // Leading whitespace + legacy key order truncated before sourceTitle
    const legacy40 = '  <!-- dsh-handoff:v1 {"version":1,"sourc'
    expect(resolveSessionDisplayTitle({
      ...session,
      title: legacy40,
      projections: { values: { summary: legacy40 } },
    })).toBe(strings.handoff.title)
    expect(resolveSessionHandoffBadge({
      ...session,
      title: legacy40,
      projections: { values: { summary: legacy40 } },
    })?.isHandoff).toBe(true)

    // Direction fallback when sourceTitle is absent
    const noTitlePreview = '<!-- dsh-handoff:v1 {"sourceBackend":"harness","targetBackend":"codex","sourceSessionId":"s1"}'
    expect(parseHandoffPreview(noTitlePreview)?.sourceBackend).toBe('harness')
    expect(resolveSessionDisplayTitle({
      ...session,
      title: noTitlePreview,
      projections: { values: { summary: noTitlePreview } },
    })).toBe('DeepSeek → Codex')
    expect(resolveSessionHandoffBadge({
      ...session,
      title: noTitlePreview,
      projections: { values: { summary: noTitlePreview } },
    })).toMatchObject({
      isHandoff: true,
      sourceBackend: 'harness',
      targetBackend: 'codex',
    })
  })

  it('falls back to origin instruction when sourceTitle is missing and preserves badge across renames', () => {
    const rawHeader = '<!-- dsh-handoff:v1 {"version":1,"sourceBackend":"harness","targetBackend":"codex","sourceSessionId":"s-orig","preset":"continue","turnsCount":1,"filesCount":0,"omittedTurns":0,"createdAt":1000} -->'
    const firstMsg: ChatItem = {
      kind: 'message',
      id: 'm1',
      sessionId: 'codex:thread',
      role: 'user',
      text: `${rawHeader}\n<handoff_context>\nHandoff from harness to codex\n</handoff_context>\n\n你帮我看下，下一步优化方案`,
      createdAt: 1,
    }
    const untitledHandoff: RemoteSession = {
      ...session,
      title: `${rawHeader.slice(0, 40)}`,
      projections: { values: { summary: rawHeader } },
    }
    expect(resolveSessionDisplayTitle(untitledHandoff, undefined, [firstMsg])).toBe('你帮我看下，下一步优化方案')

    const renamed: RemoteSession = {
      ...session,
      title: '自定义会话名称',
      projections: { values: { summary: '自定义会话名称' } },
    }
    expect(resolveSessionDisplayTitle(renamed, {
      sourceBackend: 'harness',
      targetBackend: 'codex',
      sourceSessionId: 's-orig',
      sourceTitle: '原会话标题',
    })).toBe('自定义会话名称')
    expect(resolveSessionHandoffBadge(renamed, {
      sourceBackend: 'harness',
      targetBackend: 'codex',
      sourceSessionId: 's-orig',
      sourceTitle: '原会话标题',
    })?.sourceBackend).toBe('harness')
  })

  it('sanitizes raw handoff strings for notification and automation surfaces', () => {
    expect(sanitizeHandoffDisplayTitle('<!-- dsh-handoff:v1 {"sourceTitle":"排查构建失败","version":1} -->', 'fallback')).toBe('排查构建失败')
    expect(sanitizeHandoffDisplayTitle('<!-- dsh-handoff:v1 {"version":1}', 'fallback')).toBe('fallback')
    expect(sanitizeHandoffDisplayTitle('Normal Title', 'fallback')).toBe('Normal Title')
  })
})
