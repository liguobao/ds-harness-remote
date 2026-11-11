import { describe, expect, it, vi } from 'vitest'
import {
  type StagedFile,
  bytesToBase64,
  documentImageReadBudget,
  readDocumentImageBase64,
  formatUploadedFilesPrompt,
  formatUploadedFilesReferencePrompt,
  isTextFile,
  isValidUtf8Text,
  uploadStagedFileToWorkspace,
  uploadStagedFilesToWorkspace,
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

  describe('formatUploadedFilesReferencePrompt', () => {
    it('returns raw text unchanged when files list is empty', () => {
      expect(formatUploadedFilesReferencePrompt('hello', [])).toBe('hello')
      expect(formatUploadedFilesReferencePrompt('', [])).toBe('')
    })

    it('formats single file as @path with leading dot slash stripped', () => {
      expect(formatUploadedFilesReferencePrompt('Please check this', [{ name: 'test.py', path: './test.py' }]))
        .toBe('Please check this\n\n@test.py')
    })

    it('quotes file paths that contain spaces', () => {
      expect(formatUploadedFilesReferencePrompt('', [{ name: 'my notes.txt', path: './docs/my notes.txt' }]))
        .toBe('@"docs/my notes.txt"')
    })

    it('escapes and quotes file paths that contain double quotes', () => {
      expect(formatUploadedFilesReferencePrompt('', [{ name: 'a" b.txt', path: './a" b.txt' }]))
        .toBe('@"a\\" b.txt"')
    })

    it('joins multiple files with space and falls back to name when path is omitted', () => {
      expect(formatUploadedFilesReferencePrompt('Analyze:', [
        { name: 'main.rs', path: './src/main.rs' },
        { name: 'Cargo.toml' },
      ])).toBe('Analyze:\n\n@src/main.rs @Cargo.toml')
    })
  })

  describe('bytesToBase64', () => {
    it('correctly encodes ascii and empty arrays without Buffer', () => {
      expect(bytesToBase64(new Uint8Array([]))).toBe('')
      expect(bytesToBase64(new TextEncoder().encode('hello world'))).toBe('aGVsbG8gd29ybGQ=')
      expect(bytesToBase64(new TextEncoder().encode('a'))).toBe('YQ==')
      expect(bytesToBase64(new TextEncoder().encode('ab'))).toBe('YWI=')
      expect(bytesToBase64(new TextEncoder().encode('abc'))).toBe('YWJj')
    })
  })

  describe('workspace upload helpers', () => {
    const sessionId = 'session-test-1'

    it('uploads a file in chunks and commits to workspace', async () => {
      const calls: { method: string; params: unknown }[] = []
      const rpc = vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params })
        if (method === 'workspace.upload.open') return { uploadId: 'up-1', chunkBytes: 64 * 1024 }
        if (method === 'workspace.upload.chunk') return { uploadId: 'up-1', receivedBytes: 5 }
        if (method === 'workspace.upload.commit') return { name: 'hello.txt', path: './hello.txt', bytes: 5 }
        return {}
      })

      const file: StagedFile = {
        id: 'f1',
        name: 'hello.txt',
        size: 5,
        uri: 'file:///hello.txt',
        content: 'hello',
      }

      const result = await uploadStagedFileToWorkspace(rpc, sessionId, file)
      expect(result).toEqual({ name: 'hello.txt', path: './hello.txt', bytes: 5 })
      expect(calls.map(c => c.method)).toEqual([
        'workspace.upload.open',
        'workspace.upload.chunk',
        'workspace.upload.commit',
      ])
    })

    it('aborts upload and rethrows on chunk failure', async () => {
      const calls: { method: string; params: unknown }[] = []
      const rpc = vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params })
        if (method === 'workspace.upload.open') return { uploadId: 'up-failed', chunkBytes: 64 * 1024 }
        if (method === 'workspace.upload.chunk') throw new Error('transport-error')
        if (method === 'workspace.upload.abort') return { aborted: true }
        return {}
      })

      const file: StagedFile = {
        id: 'f2',
        name: 'fail.txt',
        size: 10,
        uri: 'file:///fail.txt',
        content: 'some bytes',
      }

      await expect(uploadStagedFileToWorkspace(rpc, sessionId, file)).rejects.toThrow('transport-error')
      expect(calls.some(c => c.method === 'workspace.upload.abort')).toBe(true)
    })

    it('uploads multiple staged files sequentially and updates remotePath', async () => {
      const rpc = vi.fn(async (method: string, params: unknown) => {
        if (method === 'workspace.upload.open') return { uploadId: 'up-batch', chunkBytes: 64 * 1024 }
        if (method === 'workspace.upload.chunk') return { uploadId: 'up-batch', receivedBytes: 4 }
        if (method === 'workspace.upload.commit') {
          const p = params as { uploadId: string }
          return { name: 'f.txt', path: `./uploaded/${p.uploadId}.txt`, bytes: 4 }
        }
        return {}
      })

      const files: StagedFile[] = [
        { id: '1', name: 'a.txt', size: 4, uri: 'file:///a', content: 'test' },
        { id: '2', name: 'b.txt', size: 4, uri: 'file:///b', content: 'test' },
      ]

      const uploaded = await uploadStagedFilesToWorkspace(rpc, sessionId, files)
      expect(uploaded).toHaveLength(2)
      expect(files[0]!.remotePath).toBeDefined()
      expect(files[1]!.remotePath).toBeDefined()
    })

    it('stops mid-transfer, aborts the upload once and never commits', async () => {
      const controller = new AbortController()
      const methods: string[] = []
      const rpc = vi.fn(async (method: string) => {
        methods.push(method)
        if (method === 'workspace.upload.open') return { uploadId: 'up-cancel', chunkBytes: 4 }
        if (method === 'workspace.upload.chunk') { controller.abort(); return { uploadId: 'up-cancel', receivedBytes: 4 } }
        if (method === 'workspace.upload.abort') return { aborted: true }
        return {}
      })
      const file: StagedFile = { id: 'cancel', name: 'a.txt', size: 8, uri: 'file:///a', content: 'abcdefgh' }
      await expect(uploadStagedFileToWorkspace(rpc, sessionId, file, controller.signal))
        .rejects.toMatchObject({ name: 'AbortError' })
      expect(methods.filter(method => method === 'workspace.upload.abort')).toHaveLength(1)
      expect(methods).not.toContain('workspace.upload.commit')
    })

    it('rejects when commit does not return a valid path', async () => {
      const rpc = vi.fn(async (method: string) => {
        if (method === 'workspace.upload.open') return { uploadId: 'up-nopath', chunkBytes: 64 * 1024 }
        if (method === 'workspace.upload.commit') return { name: 'f.txt' } // missing path
        if (method === 'workspace.upload.abort') return { aborted: true }
        return {}
      })

      const file: StagedFile = { id: 'x', name: 'f.txt', size: 0, uri: 'file:///x', content: '' }
      await expect(uploadStagedFileToWorkspace(rpc, sessionId, file)).rejects.toThrow('workspace.upload.commit returned no valid path')
    })

    it('reuses existing remotePath without calling rpc', async () => {
      const rpc = vi.fn()
      const file: StagedFile = { id: 'done', name: 'cached.txt', size: 10, uri: 'file:///cached', remotePath: './cached.txt' }
      const res = await uploadStagedFileToWorkspace(rpc, sessionId, file)
      expect(res).toEqual({ name: 'cached.txt', path: './cached.txt', bytes: 10 })
      expect(rpc).not.toHaveBeenCalled()
    })

    it('throws immediately when signal is already aborted', async () => {
      const rpc = vi.fn()
      const controller = new AbortController()
      controller.abort()
      const file: StagedFile = { id: 'abort', name: 'a.txt', size: 5, uri: 'file:///a', content: 'test' }
      await expect(uploadStagedFileToWorkspace(rpc, sessionId, file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
      expect(rpc).not.toHaveBeenCalled()
    })
  })
})
