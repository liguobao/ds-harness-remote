import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { WorkspaceUploadBudget } from '../src/workspace-upload-budget.js'
import { WorkspaceUploadHost } from '../src/workspace-upload.js'

const scan = vi.hoisted(() => ({ failure: 'none' as 'none' | 'open' | 'iterate', attempts: 0 }))
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    opendir: async (path: string) => {
      scan.attempts++
      if (scan.failure === 'open') throw Object.assign(new Error('directory is not readable'), { code: 'EACCES' })
      if (scan.failure === 'iterate') {
        return { async *[Symbol.asyncIterator]() { throw new Error('directory iteration failed') } }
      }
      return fs.opendir(path)
    },
  }
})

it.each(['open', 'iterate'] as const)('continues uploads and retries after %s scan failure', async failure => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-upload-cleanup-'))
  const budget = new WorkspaceUploadBudget()
  const host = new WorkspaceUploadHost(async () => root, undefined, () => 'Relay', Date.now, budget)
  scan.failure = failure
  scan.attempts = 0
  try {
    const first = { sessionId: 'session-a', uploadId: randomUUID(), name: 'first.txt', totalBytes: 0 }
    await host.call('workspace.upload.open', first)
    await host.call('workspace.upload.commit', { sessionId: first.sessionId, uploadId: first.uploadId })
    expect(scan.attempts).toBe(1)
    expect(budget.scannedRoots.has(root)).toBe(false)

    scan.failure = 'none'
    const second = { sessionId: 'session-a', uploadId: randomUUID(), name: 'second.txt', totalBytes: 0 }
    await host.call('workspace.upload.open', second)
    await host.call('workspace.upload.commit', { sessionId: second.sessionId, uploadId: second.uploadId })
    expect(scan.attempts).toBe(2)
    expect(budget.scannedRoots.has(root)).toBe(true)
  } finally {
    scan.failure = 'none'
    await host.closeAll()
    await rm(root, { recursive: true, force: true })
  }
})
