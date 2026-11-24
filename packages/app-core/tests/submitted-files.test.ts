import { describe, expect, it } from 'vitest'
import {
  extractUserSubmittedFiles,
  formatSubmittedFileMeta,
  formatUploadedChatFiles,
  parseMessageFileAttachmentBlock,
  parseTrailingSubmittedFileTokens,
} from '../src/screens/chat/submitted-files'
import { formatUploadedFilesReferencePrompt } from '../src/screens/chat-files'
import { foldHistory } from '../src/state/event-reducer'
import { mergeHistoryAndLive } from '../src/state/message-helpers'
import { mergeCodexLive } from '../src/services/codex'
import { mergeAcpHistoryAndLive } from '../src/services/cursor'
import type { ChatItem, HistoryEntry } from '../src/types'

const VALID_SHA = `sha256:${'a'.repeat(64)}`

describe('submitted-files extraction and metadata', () => {
  it('validates Host type:file attachment blocks using plugin boundaries', () => {
    expect(parseMessageFileAttachmentBlock({
      type: 'file',
      attachment: { attachmentId: VALID_SHA, name: '2027肖八.pdf', bytes: 1_500_000 },
    })).toEqual({
      path: `.dsh-remote-message-file/${VALID_SHA}/2027肖八.pdf`,
      name: '2027肖八.pdf',
      bytes: 1_500_000,
      attachmentId: VALID_SHA,
      source: 'attachment',
    })

    expect(parseMessageFileAttachmentBlock({
      type: 'file',
      attachment: { attachmentId: 'sha256:bad', name: 'doc.pdf', bytes: 10 },
    })).toBeUndefined()
    expect(parseMessageFileAttachmentBlock({
      type: 'file',
      attachment: { attachmentId: VALID_SHA, name: '../evil.pdf', bytes: 10 },
    })).toBeUndefined()
    expect(parseMessageFileAttachmentBlock({
      type: 'file',
      attachment: { attachmentId: VALID_SHA, name: 'doc.pdf', bytes: -1 },
    })).toBeUndefined()
  })

  it('extracts pure uploaded file messages cleanly without leaving raw @path text', () => {
    const uploaded = formatUploadedChatFiles([
      { name: '2027肖八选择题与背诵手册原文左右对照.pdf', path: './2027肖八选择题与背诵手册原文左右对照.pdf', bytes: 1_499_463 },
    ])
    const prompt = formatUploadedFilesReferencePrompt('', uploaded)
    const extracted = extractUserSubmittedFiles(prompt, uploaded)

    expect(extracted.displayText).toBe('')
    expect(extracted.files).toEqual([
      {
        path: '2027肖八选择题与背诵手册原文左右对照.pdf',
        name: '2027肖八选择题与背诵手册原文左右对照.pdf',
        bytes: 1_499_463,
        source: 'upload',
      },
    ])
    expect(formatSubmittedFileMeta(extracted.files[0]!.path, extracted.files[0]!.bytes)).toEqual({
      typeLabel: 'PDF',
      sizeLabel: '1.43MB',
      fullLabel: 'PDF 1.43MB',
    })
  })

  it('extracts text + multi-file trailing references with spaces and quotes', () => {
    const uploaded = formatUploadedChatFiles([
      { name: 'my report 1.pdf', path: './my report 1.pdf', bytes: 2048 },
      { name: 'Dockerfile', path: './Dockerfile', bytes: 512 },
    ])
    const prompt = formatUploadedFilesReferencePrompt('请帮我总结这两个文件', uploaded)
    const fromHistory = extractUserSubmittedFiles(prompt)

    expect(fromHistory.displayText).toBe('请帮我总结这两个文件')
    expect(fromHistory.files.map(f => f.path)).toEqual(['my report 1.pdf', 'Dockerfile'])
  })

  it('rejects emails, user @mentions, path traversals, and inline prose mentions', () => {
    expect(parseTrailingSubmittedFileTokens('foo@example.com')).toBeUndefined()
    expect(parseTrailingSubmittedFileTokens('@alice please check')).toBeUndefined()
    expect(parseTrailingSubmittedFileTokens('@../secret.pdf')).toBeUndefined()
    expect(parseTrailingSubmittedFileTokens('@/etc/passwd')).toBeUndefined()
    expect(parseTrailingSubmittedFileTokens('@C:\\secret.pdf')).toBeUndefined()
    expect(parseTrailingSubmittedFileTokens('@file:secret.pdf')).toBeUndefined()
    expect(parseTrailingSubmittedFileTokens('@//host/share.pdf')).toBeUndefined()

    const inline = extractUserSubmittedFiles('Please inspect @report.pdf and tell me what you think')
    expect(inline.files).toEqual([])
    expect(inline.displayText).toBe('Please inspect @report.pdf and tell me what you think')
  })

  it('preserves literal %, #, and %20 in uploaded and referenced filenames without URI decoding', () => {
    const uploaded = formatUploadedChatFiles([
      { name: '2026年增长50%.pdf', path: './2026年增长50%.pdf', bytes: 1024 },
      { name: 'Q1#Report.pdf', path: './Q1#Report.pdf', bytes: 2048 },
      { name: 'report%20v2.pdf', path: './report%20v2.pdf', bytes: 4096 },
    ])
    expect(uploaded.map(f => f.path)).toEqual([
      '2026年增长50%.pdf',
      'Q1#Report.pdf',
      'report%20v2.pdf',
    ])

    const prompt = formatUploadedFilesReferencePrompt('请核对这三份材料', uploaded)
    const fromHistory = extractUserSubmittedFiles(prompt)
    expect(fromHistory.displayText).toBe('请核对这三份材料')
    expect(fromHistory.files.map(f => f.path)).toEqual([
      '2026年增长50%.pdf',
      'Q1#Report.pdf',
      'report%20v2.pdf',
    ])
  })

  it('keeps explicit upload text intact when trailing block has mixed prose', () => {
    const uploaded = formatUploadedChatFiles([
      { name: 'a.pdf', path: './a.pdf', bytes: 1024 },
    ])
    const extracted = extractUserSubmittedFiles('check this @a.pdf today', uploaded)
    expect(extracted.files).toHaveLength(1)
    expect(extracted.displayText).toBe('check this @a.pdf today')
  })

  it('formats unknown bytes without rendering 0 B', () => {
    expect(formatSubmittedFileMeta('notes.docx')).toEqual({
      typeLabel: 'DOCX',
      fullLabel: 'DOCX',
    })
    expect(formatSubmittedFileMeta('notes.docx', 0)).toEqual({
      typeLabel: 'DOCX',
      fullLabel: 'DOCX',
    })
  })
})

describe('message file metadata preservation across reducers and reconcilers', () => {
  it('folds pure Host file attachment user messages and retains optimistic files on echo', () => {
    const entries: HistoryEntry[] = [{
      event: {
        type: 'user/message',
        seq: 1,
        time: 1000,
        data: {
          message: {
            id: 'msg-1',
            requestRpcId: 'rpc-1',
            source: { kind: 'user' },
            content: [
              { type: 'file', attachment: { attachmentId: VALID_SHA, name: 'paper.pdf', bytes: 1_048_576 } },
            ],
          },
        },
      },
    }]
    const folded = foldHistory(entries, 's1')
    expect(folded).toHaveLength(1)
    expect(folded[0]).toMatchObject({
      kind: 'message',
      id: 'msg-1',
      role: 'user',
      text: '',
      files: [{
        path: `.dsh-remote-message-file/${VALID_SHA}/paper.pdf`,
        name: 'paper.pdf',
        bytes: 1_048_576,
        attachmentId: VALID_SHA,
        source: 'attachment',
      }],
    })

    const optimistic: ChatItem[] = [{
      kind: 'message',
      id: 'local:rpc-2',
      sessionId: 's1',
      role: 'user',
      text: '@report.pdf',
      files: [{ path: 'report.pdf', name: 'report.pdf', bytes: 50_000, source: 'upload' }],
      createdAt: 100,
      requestRpcId: 'rpc-2',
    }]
    const echoed = foldHistory([{
      event: {
        type: 'user/message',
        seq: 2,
        time: 2000,
        data: {
          message: {
            id: 'msg-2',
            source: { kind: 'user', rpcId: 'rpc-2' },
            content: [{ type: 'text', text: '@report.pdf' }],
          },
        },
      },
    }], 's1')

    const merged = mergeHistoryAndLive(echoed, optimistic)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: 'msg-2',
      files: [{ path: 'report.pdf', name: 'report.pdf', bytes: 50_000, source: 'upload' }],
    })
  })

  it('preserves uploaded file bytes across Codex and ACP live reconcilers', () => {
    const file = { path: 'deck.pdf', name: 'deck.pdf', bytes: 88_888, source: 'upload' as const }
    const codexLocal: ChatItem[] = [{
      kind: 'message',
      id: 'local:c1',
      sessionId: 'codex:1',
      role: 'user',
      text: '@deck.pdf',
      files: [file],
      createdAt: 10,
      requestRpcId: 'c1',
    }]
    const codexEcho: ChatItem[] = [{
      kind: 'message',
      id: 'codex-u1',
      sessionId: 'codex:1',
      role: 'user',
      text: '@deck.pdf',
      createdAt: 20,
    }]
    expect(mergeCodexLive(codexLocal, codexEcho)[0]).toMatchObject({ id: 'codex-u1', files: [file] })
    const codexReprojected: ChatItem[] = [{
      kind: 'message',
      id: 'codex-u1',
      sessionId: 'codex:1',
      role: 'user',
      text: '@deck.pdf',
      createdAt: 25,
    }]
    expect(mergeCodexLive(mergeCodexLive(codexLocal, codexEcho), codexReprojected)[0]).toMatchObject({
      id: 'codex-u1',
      files: [file],
    })

    const acpHistory: ChatItem[] = [{
      kind: 'message',
      id: 'acp-u1',
      sessionId: 'claude:1',
      role: 'user',
      text: '@deck.pdf',
      createdAt: 20,
    }]
    const acpLive: ChatItem[] = [{
      kind: 'message',
      id: 'local:a1',
      sessionId: 'claude:1',
      role: 'user',
      text: '@deck.pdf',
      files: [file],
      createdAt: 10,
      requestRpcId: 'a1',
    }]
    expect(mergeAcpHistoryAndLive(acpHistory, acpLive)[0]).toMatchObject({ files: [file] })
  })
})
