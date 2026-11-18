import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { SessionTransferHost, type TransferPersistence, type TransferServices } from '../src/session-transfer.js'

it('imports history without carrying the source directories or worktree ownership into the target workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-transfer-'))
  try {
    const source = join(root, 'source')
    const sourceSubdirectory = join(source, 'nested')
    const target = join(root, 'target')
    await mkdir(sourceSubdirectory, { recursive: true })
    await mkdir(target)
    const worktree = { path: sourceSubdirectory, repositoryRoot: source, branch: 'source-branch', baseCommit: 'a'.repeat(40) }
    const events = [
      { seq: 0, time: 1, type: 'plugin:client-ui-forge/worktree', ignorable: true, data: { action: 'request', from: null } },
      { seq: 1, time: 2, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 3, type: 'working-directory/change', data: { cwd: source } },
      { seq: 3, time: 4, type: 'working-directory/change', data: { cwd: sourceSubdirectory } },
      { seq: 4, time: 5, type: 'plugin:worktree/created', ignorable: true, data: worktree },
      { seq: 5, time: 6, type: 'plugin:client-ui-forge/worktree', ignorable: true, data: { action: 'created', worktree: { ...worktree, from: null } } },
      { seq: 6, time: 7, type: 'turn/end', data: { turn: 1 } },
    ]
    const data = gzipSync(JSON.stringify({
      formatVersion: 1, version: 4, createdAt: 1, inheritedEventCount: 0, events,
    }))
    const append = vi.fn<Awaited<ReturnType<TransferPersistence['create']>>['append']>(async () => {})
    const create = vi.fn<TransferPersistence['create']>(async () => ({
      append, flush: async () => {}, close: async () => {},
    }))
    const prepare = vi.fn<NonNullable<TransferServices['sessions']>['prepare']>((id, { meta }) => ({
      header: { id, version: 4, ...meta },
    }))
    const attachSession = vi.fn(async () => {})
    const peer = new SessionTransferHost(() => ({
      workspaces: { get: workspaceId => workspaceId === 'target' ? { path: target, sessionIds: [], attachSession } : undefined },
      persistence: { create },
      sessions: { prepare },
    })).peer('client')
    try {
      const { handle } = await peer.call('session.transfer.import.open', {
        workspaceId: 'target', batchId: 'batch', sourceSessionId: 'source', formatVersion: 1,
      }) as { handle: string }
      await peer.call('session.transfer.import.chunk', { handle, offset: 0, data: data.toString('base64') })
      const result = await peer.call('session.transfer.import.commit', {
        handle, requestId: 'commit', totalBytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
      })
      const sessionId = prepare.mock.calls[0]![0]
      const omittedWorktree = { type: 'plugin:ds-harness-remote/omitted-worktree', ignorable: true, data: {} }
      const importedEvents = [
        { seq: 0, time: 1, ...omittedWorktree },
        events[1],
        { ...events[2], data: { cwd: target } },
        { ...events[3], data: { cwd: target } },
        { seq: 4, time: 5, ...omittedWorktree },
        { seq: 5, time: 6, ...omittedWorktree },
        events[6],
      ]
      expect(result).toEqual({ sessionId, workspaceAttached: true })
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: sessionId, cwd: target }), { inheritedEventCount: 0 })
      expect(prepare).toHaveBeenCalledWith(sessionId, expect.objectContaining({ seed: importedEvents }))
      expect(append).toHaveBeenCalledWith(importedEvents)
      expect(attachSession).toHaveBeenCalledWith(sessionId)
    } finally {
      peer.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
