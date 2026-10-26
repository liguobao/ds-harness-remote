import { describe, expect, it } from 'vitest'
import {
  type StagedFile,
  formatFileBytes,
  formatUploadedFilesPrompt,
  isTextFile,
  isValidUtf8Text,
  MAX_SINGLE_FILE_BYTES,
  MAX_TOTAL_FILES_BYTES,
} from '../src/screens/chat-files'

describe('chat-files utilities', () => {
  describe('formatFileBytes', () => {
    it('handles zero and negative or invalid values gracefully', () => {
      expect(formatFileBytes(0)).toBe('0 B')
      expect(formatFileBytes(-10)).toBe('0 B')
      expect(formatFileBytes(Number.NaN)).toBe('0 B')
    })

    it('formats small files in bytes', () => {
      expect(formatFileBytes(1)).toBe('1 B')
      expect(formatFileBytes(512)).toBe('512 B')
      expect(formatFileBytes(1023)).toBe('1023 B')
    })

    it('formats kilobytes and megabytes accurately', () => {
      expect(formatFileBytes(1024)).toBe('1 KB')
      expect(formatFileBytes(1536)).toBe('1.5 KB')
      expect(formatFileBytes(1024 * 1024)).toBe('1 MB')
      expect(formatFileBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
    })
  })

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

  describe('limits', () => {
    it('defines realistic budgets for mobile uploads', () => {
      expect(MAX_SINGLE_FILE_BYTES).toBe(512 * 1024)
      expect(MAX_TOTAL_FILES_BYTES).toBe(2 * 1024 * 1024)
    })
  })
})
