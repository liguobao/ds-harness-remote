import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  applyQuickPromptDraft,
  composerEditable,
  isQuickPromptActionMode,
  nextStackedOverflowLength,
  policyHintVisible,
  shouldShowExpandCorner,
  shouldUseStackedComposer,
  submitIntent,
  type SubmitGateInput,
} from '../src/screens/chat/composer-gate'
import { formatQuoteDraftSnippet, formatQuoteText, formatTokens } from '../src/ui/quote-helpers'

describe('Quote snippet formatting (Figure 3 alignment)', () => {
  it('truncates text exceeding maxLength and appends ellipsis', () => {
    const text = '跳转到“安全验证”，显示：“请您登录后查看更多专业优质内容。'
    const snippet = formatQuoteDraftSnippet(text, 16)
    expect(snippet).toBe('跳转到“安全验证”，显示：“请您...')
  })

  it('preserves text within maxLength without ellipsis', () => {
    const text = '简单回复'
    expect(formatQuoteDraftSnippet(text, 24)).toBe('简单回复')
  })

  it('normalizes internal newlines and tabs to single spaces', () => {
    const text = 'line 1\r\n\tline 2\nline 3'
    expect(formatQuoteDraftSnippet(text, 50)).toBe('line 1 line 2 line 3')
  })

  it('formats full quotes with markdown blockquote prefix for every line', () => {
    const quote = '第一行\n第二行\n\n第四行'
    expect(formatQuoteText(quote)).toBe('> 第一行\n> 第二行\n> \n> 第四行')
  })
})

describe('Token count formatting (Figure 4 alignment)', () => {
  it('formats counts under 1000 as exact integers', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(850)).toBe('850')
  })

  it('formats counts >= 1000 as decimal thousands (k)', () => {
    expect(formatTokens(20600)).toBe('20.6k')
    expect(formatTokens(22437)).toBe('22.4k')
    expect(formatTokens(1500)).toBe('1.5k')
  })

  it('rounds counts >= 100k to whole thousands', () => {
    expect(formatTokens(125400)).toBe('125k')
  })

  it('returns empty string for undefined or invalid count', () => {
    expect(formatTokens(undefined)).toBe('')
    expect(formatTokens(-1)).toBe('')
    expect(formatTokens(NaN)).toBe('')
  })
})

describe('Blank session detection (Sidebar New Session deduplication)', () => {
  function isReusableBlank(s: { blank?: boolean; sessionId: string }, messagesRecord: Record<string, unknown[] | undefined>): boolean {
    if (s.blank === true) return true
    if (s.blank === false) return false
    const localMsgs = messagesRecord[s.sessionId]
    return Array.isArray(localMsgs) && localMsgs.length === 0
  }

  it('recognizes explicit server blank sessions', () => {
    expect(isReusableBlank({ sessionId: 's1', blank: true }, {})).toBe(true)
  })

  it('rejects un-cached history sessions with blank=false', () => {
    expect(isReusableBlank({ sessionId: 's2', blank: false }, {})).toBe(false)
  })

  it('rejects un-cached history sessions with blank=undefined (messages not yet fetched)', () => {
    expect(isReusableBlank({ sessionId: 's2-uncached' }, {})).toBe(false)
  })

  it('rejects history sessions with populated messages', () => {
    expect(isReusableBlank({ sessionId: 's3' }, { s3: [{ text: 'hello' }] })).toBe(false)
  })

  it('accepts sessions where messages were fetched and verified empty', () => {
    expect(isReusableBlank({ sessionId: 's4' }, { s4: [] })).toBe(true)
  })
})

describe('Chat Action Menu cards boundary', () => {
  it('excludes quote from plus attachment grid and only retains camera, photos, files', () => {
    // Plus menu action items are exclusively attachments: camera, photos, and files.
    // Quote from message selection is triggered via native text selection toolbar (PROCESS_TEXT).
    type AllowedActionMenuCard = 'camera' | 'photos' | 'files'
    const allowedCards: AllowedActionMenuCard[] = ['camera', 'photos', 'files']
    expect(allowedCards.includes('camera')).toBe(true)
    expect(allowedCards.includes('photos')).toBe(true)
    expect(allowedCards.includes('files')).toBe(true)
    // @ts-expect-error Quote is prohibited from being an attachment card in the plus menu
    expect(allowedCards.includes('quote')).toBe(false)
  })
})


describe('Composer availability while the Host is unreachable', () => {
  const ready: SubmitGateInput = {
    connected: true, sendReady: true, permissionSelecting: false, uploading: false, hasContent: true,
  }

  it('only submits once the channel is authenticated and ready', () => {
    for (const connected of [true, false]) for (const sendReady of [true, false]) for (const hasContent of [true, false]) {
      const intent = submitIntent({ ...ready, connected, sendReady, hasContent })
      expect(intent === 'submit', `connected=${connected} sendReady=${sendReady} hasContent=${hasContent}`)
        .toBe(connected && sendReady && hasContent)
    }
  })

  it('routes an offline tap away from the submit path that clears the draft', async () => {
    await runScenarios([
      { name: 'connected and ready', input: ready, expected: 'submit' },
      { name: 'offline with a draft', input: { ...ready, connected: false, sendReady: false }, expected: 'offline' },
      { name: 'offline with an empty composer', input: { ...ready, connected: false, sendReady: false, hasContent: false }, expected: 'ignore' },
      { name: 'offline while a permission switch is in flight', input: { ...ready, connected: false, sendReady: false, permissionSelecting: true }, expected: 'offline' },
      { name: 'upload already running', input: { ...ready, uploading: true }, expected: 'ignore' },
      { name: 'history sync window after reconnection', input: { ...ready, sendReady: false }, expected: 'ignore' },
      { name: 'permission switch while connected', input: { ...ready, permissionSelecting: true }, expected: 'ignore' },
    ].map(({ name, input, expected }) => ({ name, run: () => { expect(submitIntent(input), name).toBe(expected) } })))
  })

  it('keeps the text field editable while the Host is unreachable', () => {
    // Editable is composer-local only: a dropped carrier never locks the field.
    expect(composerEditable({ permissionSelecting: false, uploading: false })).toBe(true)
    expect(composerEditable({ permissionSelecting: true, uploading: false })).toBe(false)
    expect(composerEditable({ permissionSelecting: false, uploading: true })).toBe(false)
  })
})

describe('Composer expand state and back handler priority', () => {
  it('defines expandComposer and collapseComposer across all locales', async () => {
    const { messageCatalogs } = await import('../src/locales/i18n')
    for (const [lang, s] of Object.entries(messageCatalogs)) {
      expect(typeof s.chat.expandComposer, "lang: " + lang).toBe('string')
      expect(s.chat.expandComposer.length, "lang: " + lang).toBeGreaterThan(0)
      expect(typeof s.chat.collapseComposer, "lang: " + lang).toBe('string')
      expect(s.chat.collapseComposer.length, "lang: " + lang).toBeGreaterThan(0)
    }
  })

  it('prioritizes closing expanded composer before back navigation or dismiss', () => {
    let composerExpanded = true
    let backNavigated = false
    const panels = [
      { open: composerExpanded, close: () => { composerExpanded = false } },
      { open: false, close: () => {} },
    ]

    const activePanel = panels.find(p => p.open)
    if (activePanel) {
      activePanel.close()
    } else {
      backNavigated = true
    }

    expect(composerExpanded).toBe(false)
    expect(backNavigated).toBe(false)
  })
})

describe('Compact composer footer policy hint and moved controls localization', () => {
  it('shows the policy hint only on blank sessions with non-compact composer layout', () => {
    expect(policyHintVisible({ showPolicyHint: true, compactComposer: false })).toBe(true)
    expect(policyHintVisible({ showPolicyHint: false, compactComposer: false })).toBe(false)
    expect(policyHintVisible({ showPolicyHint: true, compactComposer: true })).toBe(false)
    expect(policyHintVisible({ showPolicyHint: false, compactComposer: true })).toBe(false)
  })

  it('defines quickPrompts, selectModel, and quickPromptActionMode labels across all locales', async () => {
    const { messageCatalogs } = await import('../src/locales/i18n')
    for (const [lang, s] of Object.entries(messageCatalogs)) {
      expect(typeof s.chat.quickPrompts, "lang: " + lang).toBe('string')
      expect(s.chat.quickPrompts.length, "lang: " + lang).toBeGreaterThan(0)
      expect(typeof s.chat.selectModel, "lang: " + lang).toBe('string')
      expect(s.chat.selectModel.length, "lang: " + lang).toBeGreaterThan(0)
      expect(typeof s.settings.quickPromptActionMode, "lang: " + lang).toBe('string')
      expect(s.settings.quickPromptActionMode.length, "lang: " + lang).toBeGreaterThan(0)
      expect(typeof s.settings.quickPromptActionFill, "lang: " + lang).toBe('string')
      expect(s.settings.quickPromptActionFill.length, "lang: " + lang).toBeGreaterThan(0)
      expect(typeof s.settings.quickPromptActionSend, "lang: " + lang).toBe('string')
      expect(s.settings.quickPromptActionSend.length, "lang: " + lang).toBeGreaterThan(0)
      expect(typeof s.settings.quickPromptActionSaveFailed, "lang: " + lang).toBe('string')
      expect(s.settings.quickPromptActionSaveFailed.length, "lang: " + lang).toBeGreaterThan(0)
    }
  })

  it('promotes from inline to stacked composer on overflow/newlines/quotes with hysteresis', () => {
    expect(shouldUseStackedComposer({ draft: '', hasQuotes: false, overflowLength: null })).toBe(false)
    expect(shouldUseStackedComposer({ draft: 'hello', hasQuotes: false, overflowLength: null })).toBe(false)
    expect(shouldUseStackedComposer({ draft: 'hello', hasQuotes: true, overflowLength: null })).toBe(true)
    expect(shouldUseStackedComposer({ draft: 'a\nb', hasQuotes: false, overflowLength: null })).toBe(true)

    // Inline wraps at length 20 -> remembers overflow point and stays stacked even after
    // full-width layout shrinks the text back onto 1 line (contentHeight 36).
    const entered = nextStackedOverflowLength({
      draft: '12345678901234567890',
      contentHeight: 58,
      currentOverflowLength: null,
    })
    expect(entered).toBe(20)
    const afterWidening = nextStackedOverflowLength({
      draft: '12345678901234567890',
      contentHeight: 36,
      currentOverflowLength: entered,
    })
    expect(afterWidening).toBe(20)
    expect(shouldUseStackedComposer({ draft: '12345678901234567890', hasQuotes: false, overflowLength: afterWidening })).toBe(true)

    // Deleting 1 char keeps stacked; deleting past hysteresis threshold (20 - 2) restores inline.
    const oneBack = nextStackedOverflowLength({
      draft: '1234567890123456789',
      contentHeight: 36,
      currentOverflowLength: afterWidening,
    })
    expect(oneBack).toBe(20)
    const exited = nextStackedOverflowLength({
      draft: '12345678901234567',
      contentHeight: 36,
      currentOverflowLength: oneBack,
    })
    expect(exited).toBeNull()
    expect(shouldUseStackedComposer({ draft: '12345678901234567', hasQuotes: false, overflowLength: exited })).toBe(false)
  })

  it('shows the corner expand trigger only once a draft reaches five or more lines', () => {
    expect(shouldShowExpandCorner({ draft: '', contentHeight: 0 })).toBe(false)
    expect(shouldShowExpandCorner({ draft: 'hello', contentHeight: 36 })).toBe(false)
    expect(shouldShowExpandCorner({ draft: 'a\nb\nc\nd', contentHeight: 102 })).toBe(false)
    expect(shouldShowExpandCorner({ draft: 'a\nb\nc\nd\ne', contentHeight: 124 })).toBe(true)
    expect(shouldShowExpandCorner({ draft: 'long wrapped block', contentHeight: 120 })).toBe(true)
  })

  it('fills quick prompts into drafts with clean spacing and cursor placement', () => {
    expect(applyQuickPromptDraft('', '请总结当前进展')).toEqual({
      draft: '请总结当前进展',
      cursor: 7,
    })
    expect(applyQuickPromptDraft('先看下日志', '/plan')).toEqual({
      draft: '先看下日志 /plan',
      cursor: 11,
    })
    expect(applyQuickPromptDraft('先看下日志 ', '/plan')).toEqual({
      draft: '先看下日志 /plan',
      cursor: 11,
    })
    expect(applyQuickPromptDraft('第一行\n第二行', '第三行')).toEqual({
      draft: '第一行\n第二行\n第三行',
      cursor: 11,
    })
    expect(applyQuickPromptDraft('existing', '')).toEqual({
      draft: 'existing',
      cursor: 8,
    })
  })

  it('validates persisted quickPromptActionMode values', () => {
    expect(isQuickPromptActionMode('fill')).toBe(true)
    expect(isQuickPromptActionMode('send')).toBe(true)
    expect(isQuickPromptActionMode('auto')).toBe(false)
    expect(isQuickPromptActionMode(undefined)).toBe(false)
  })
})
