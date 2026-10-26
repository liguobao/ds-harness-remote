import { describe, expect, it, vi } from 'vitest'
import {
  type StagedFile,
  documentImageReadBudget,
  readDocumentImageBase64,
  formatUploadedFilesPrompt,
  isTextFile,
  isValidUtf8Text,
} from '../src/screens/chat-files'

describe('chat-files utilities', () => {
  describe('isTextFile', () => {
    it('detects common code and text file extensions', () => {
      expect(isTextFile('script.py')).toBe(true)
      expect(isTextFile('main.ts')).toBe(true)
      expect(isTextFile('App.tsx')).toBe(true)
      expect(isTextFile('README.md')).toBe(true)
      expect(isTextFile('data.json')).toBe(true)
      expect(isTextFile('config.yaml')).toBe(true)
      expect(isTextFile('table.csv')).toBe(true)
      expect(isTextFile('Dockerfile')).toBe(true)
      expect(isTextFile('Makefile')).toBe(true)
    })

    it('detects text mime types', () => {
      expect(isTextFile('unknown', 'text/plain')).toBe(true)
      expect(isTextFile('unknown', 'application/json')).toBe(true)
      expect(isTextFile('unknown', 'application/javascript')).toBe(true)
    })

    it('rejects unsupported binary formats', () => {
      expect(isTextFile('archive.zip')).toBe(false)
      expect(isTextFile('program.exe')).toBe(false)
      expect(isTextFile('audio.mp3')).toBe(false)
      expect(isTextFile('video.mp4')).toBe(false)
      expect(isTextFile('file.bin', 'application/octet-stream')).toBe(false)
    })
  })

  describe('isValidUtf8Text', () => {
    it('accepts clean utf-8 text and rejects null bytes or replacement characters', () => {
      expect(isValidUtf8Text('Hello world\nThis is clean.')).toBe(true)
      expect(isValidUtf8Text('中文内容测试：代码与说明')).toBe(true)
      expect(isValidUtf8Text('binary\0content')).toBe(false)
      expect(isValidUtf8Text('corrupted\uFFFDtext')).toBe(false)
    })
  })

  describe('formatUploadedFilesPrompt', () => {
    it('returns raw text unchanged when no files are staged', () => {
      expect(formatUploadedFilesPrompt('hello world', [])).toBe('hello world')
      expect(formatUploadedFilesPrompt('   test draft   ', [])).toBe('   test draft   ')
    })

    it('formats Claude-style uploaded_files block when user text is empty', () => {
      const file: StagedFile = {
        id: 'f1',
        name: 'notes.txt',
        size: 100,
        mimeType: 'text/plain',
        uri: 'file:///cache/notes.txt',
        content: 'line 1\nline 2',
      }
      const prompt = formatUploadedFilesPrompt('', [file])
      expect(prompt).toContain('<uploaded_files>')
      expect(prompt).toContain('name="notes.txt"')
      expect(prompt).toContain('size="100"')
      expect(prompt).toContain('line 1\nline 2')
      expect(prompt).toContain('</uploaded_files>')
    })

    it('combines user question with multiple staged files', () => {
      const textFile: StagedFile = {
        id: 'f1',
        name: 'test.py',
        size: 32,
        mimeType: 'text/x-python',
        uri: 'file:///cache/test.py',
        content: 'print("hello")',
      }
      const jsonFile: StagedFile = {
        id: 'f2',
        name: 'data.json',
        size: 16,
        mimeType: 'application/json',
        uri: 'file:///cache/data.json',
        content: '{"key": "value"}',
      }
      const prompt = formatUploadedFilesPrompt('Please analyze these files', [textFile, jsonFile])
      expect(prompt.startsWith('Please analyze these files')).toBe(true)
      expect(prompt).toContain('<file name="test.py" size="32">')
      expect(prompt).toContain('print("hello")')
      expect(prompt).toContain('<file name="data.json" size="16">')
      expect(prompt).toContain('{"key": "value"}')
      expect(prompt).toContain('</uploaded_files>')
    })

    it('escapes xml-breaking characters in file names and attributes', () => {
      const file: StagedFile = {
        id: 'f3',
        name: '<script>"bad"&name.txt',
        size: 10,
        mimeType: 'text/plain',
        uri: 'file:///cache/bad.txt',
        content: 'safe content',
      }
      const prompt = formatUploadedFilesPrompt('', [file])
      expect(prompt).toContain('&lt;script&gt;&quot;bad&quot;&amp;name.txt')
      expect(prompt).not.toContain('<script>"bad"&name.txt')
    })
  })

  it('rejects oversized disk images before reading, including missing Host limits', async () => {
    const fallback = documentImageReadBudget()
    const smallHost = { maxImageBytes: 10, maxMessageImageBytes: 12 } as import('../src/types').ImageAttachmentLimits
    for (const limits of [undefined, smallHost]) {
      const budget = documentImageReadBudget(limits)
      for (const [size, stagedBytes] of [[budget.maxImageBytes + 1, 0], [2, budget.maxMessageImageBytes - 1], [NaN, 0]]) {
        const base64 = vi.fn(async () => 'YQ==')
        await expect(readDocumentImageBase64({ size: size!, base64 }, stagedBytes!, limits)).rejects.toThrow('document-image-budget-exceeded')
        expect(base64).not.toHaveBeenCalled()
      }
    }
    // A permissive Host cannot raise the local memory ceiling.
    const permissive = { maxImageBytes: fallback.maxImageBytes * 2, maxMessageImageBytes: fallback.maxMessageImageBytes * 2 } as import('../src/types').ImageAttachmentLimits
    const base64 = vi.fn(async () => 'YQ==')
    await expect(readDocumentImageBase64({ size: fallback.maxImageBytes + 1, base64 }, 0, permissive)).rejects.toThrow()
    expect(base64).not.toHaveBeenCalled()
  })

  it('accepts exact byte budgets and rejects content that outgrows its stat', async () => {
    const limits = { maxImageBytes: 3, maxMessageImageBytes: 6 } as import('../src/types').ImageAttachmentLimits
    const base64 = vi.fn(async () => 'YWJj')
    await expect(readDocumentImageBase64({ size: 3, base64 }, 3, limits)).resolves.toBe('YWJj')
    expect(base64).toHaveBeenCalledOnce()
    await expect(readDocumentImageBase64({ size: 1, base64: async () => 'YWJjZA==' }, 0, limits)).rejects.toThrow('document-image-budget-exceeded')
  })
})
