import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { expect, it, vi } from 'vitest'
import { RpcError } from '../src/safe-error.js'
import { SessionTransferHost, type TransferPersistence, type TransferServices } from '../src/session-transfer.js'

function createMinimalPayload(turn = 1): { data: Buffer, base64: string, sha256: string } {
  const data = gzipSync(JSON.stringify({
    formatVersion: 1,
    version: 4,
    createdAt: 1,
    inheritedEventCount: 0,
    events: [
      { seq: 0, time: 1, type: 'turn/start', data: { turn } },
      { seq: 1, time: 2, type: 'turn/end', data: { turn } },
    ],
  }))
  return {
    data,
    base64: data.toString('base64'),
    sha256: createHash('sha256').update(data).digest('hex'),
  }
}

async function createTestTransferPeer(target: string) {
  const append = vi.fn<Awaited<ReturnType<TransferPersistence['create']>>['append']>(async () => {})
  const create = vi.fn<TransferPersistence['create']>(async () => ({
    append, flush: async () => {}, close: async () => {},
  }))
  const prepare = vi.fn<NonNullable<TransferServices['sessions']>['prepare']>((id, { meta }) => ({
    header: { id, version: 4, ...meta },
  }))
  const attachSession = vi.fn(async () => {})
  const host = new SessionTransferHost(() => ({
    workspaces: { get: workspaceId => workspaceId === 'target' ? { path: target, sessionIds: [], attachSession } : undefined },
    persistence: { create },
    sessions: { prepare },
  }))
  return { host, peer: host.peer('client'), create, prepare, append, attachSession }
}

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

it('preserves the staged upload when commit requestId collides with a different import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-transfer-'))
  try {
    const target = join(root, 'target')
    await mkdir(target)
    const { peer, create, prepare } = await createTestTransferPeer(target)
    try {
      const first = createMinimalPayload(1)
      const second = createMinimalPayload(2)

      const firstOpen = await peer.call('session.transfer.import.open', {
        workspaceId: 'target', batchId: 'batch', sourceSessionId: 'source-1', formatVersion: 1,
      }) as { handle: string }
      await peer.call('session.transfer.import.chunk', { handle: firstOpen.handle, offset: 0, data: first.base64 })
      await peer.call('session.transfer.import.commit', {
        handle: firstOpen.handle, requestId: 'req-1', totalBytes: first.data.length, sha256: first.sha256,
      })

      const secondOpen = await peer.call('session.transfer.import.open', {
        workspaceId: 'target', batchId: 'batch', sourceSessionId: 'source-2', formatVersion: 1,
      }) as { handle: string }
      await peer.call('session.transfer.import.chunk', { handle: secondOpen.handle, offset: 0, data: second.base64 })

      await expect(peer.call('session.transfer.import.commit', {
        handle: secondOpen.handle, requestId: 'req-1', totalBytes: second.data.length, sha256: second.sha256,
      })).rejects.toMatchObject({ code: 'INVALID_PARAMS' })

      const committed = await peer.call('session.transfer.import.commit', {
        handle: secondOpen.handle, requestId: 'req-2', totalBytes: second.data.length, sha256: second.sha256,
      })
      const secondSessionId = prepare.mock.calls[1]![0]
      expect(committed).toEqual({ sessionId: secondSessionId, workspaceAttached: true })
      expect(create).toHaveBeenCalledTimes(2)

      const replayOpen = await peer.call('session.transfer.import.open', {
        workspaceId: 'target', batchId: 'batch', sourceSessionId: 'source-2', formatVersion: 1,
      }) as { handle: string }
      await peer.call('session.transfer.import.chunk', { handle: replayOpen.handle, offset: 0, data: second.base64 })
      const replayed = await peer.call('session.transfer.import.commit', {
        handle: replayOpen.handle, requestId: 'req-2', totalBytes: second.data.length, sha256: second.sha256,
      })
      expect(replayed).toEqual(committed)
      expect(create).toHaveBeenCalledTimes(2)
      await expect(peer.call('session.transfer.import.abort', { handle: replayOpen.handle }))
        .rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    } finally {
      peer.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('preserves the staged upload when the recent commit cache hits its 1024-entry limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-transfer-'))
  let now = 1_000_000
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const target = join(root, 'target')
    await mkdir(target)
    const { peer, create, prepare } = await createTestTransferPeer(target)
    try {
      const payload = createMinimalPayload(1)
      for (let index = 0; index < 1024; index += 1) {
        const { handle } = await peer.call('session.transfer.import.open', {
          workspaceId: 'target', batchId: 'batch', sourceSessionId: `source-${index}`, formatVersion: 1,
        }) as { handle: string }
        await peer.call('session.transfer.import.chunk', { handle, offset: 0, data: payload.base64 })
        await peer.call('session.transfer.import.commit', {
          handle, requestId: `req-${index}`, totalBytes: payload.data.length, sha256: payload.sha256,
        })
      }

      now = 1_240_000
      const { handle } = await peer.call('session.transfer.import.open', {
        workspaceId: 'target', batchId: 'batch', sourceSessionId: 'source-overflow', formatVersion: 1,
      }) as { handle: string }
      await peer.call('session.transfer.import.chunk', { handle, offset: 0, data: payload.base64 })

      const overflowError = await peer.call('session.transfer.import.commit', {
        handle, requestId: 'req-overflow', totalBytes: payload.data.length, sha256: payload.sha256,
      }).catch((error: unknown) => error)
      expect(overflowError).toBeInstanceOf(RpcError)
      expect((overflowError as RpcError).code).toBe('RATE_LIMITED')
      expect(create).toHaveBeenCalledTimes(1024)

      now = 1_300_000
      const committed = await peer.call('session.transfer.import.commit', {
        handle, requestId: 'req-overflow', totalBytes: payload.data.length, sha256: payload.sha256,
      })
      const overflowSessionId = prepare.mock.calls[1024]![0]
      expect(committed).toEqual({ sessionId: overflowSessionId, workspaceAttached: true })
      expect(create).toHaveBeenCalledTimes(1025)
    } finally {
      peer.close()
    }
  } finally {
    nowSpy.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['append', 'flush', 'close'] as const)('recovers the target ID after a failed %s', async operation => {
  const { host, peer, create, prepare, attachSession } = await createTestTransferPeer(tmpdir())
  const reconnect = host.peer('client')
  const handle = { append: vi.fn(async () => {}), flush: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  handle[operation].mockRejectedValueOnce(new Error('write failed'))
  create.mockResolvedValueOnce(handle)
  try {
    const payload = createMinimalPayload()
    const opened = await peer.call('session.transfer.import.open', {
      workspaceId: 'target', batchId: 'batch', sourceSessionId: 'source', formatVersion: 1,
    }) as { handle: string }
    await peer.call('session.transfer.import.chunk', { handle: opened.handle, offset: 0, data: payload.base64 })
    const commit = peer.call('session.transfer.import.commit', {
      handle: opened.handle, requestId: 'commit', totalBytes: payload.data.length, sha256: payload.sha256,
    })
    await expect(commit).rejects.toMatchObject({ code: 'SESSION_TRANSFER_WRITE_FAILED' })
    const sessionId = prepare.mock.calls[0]![0]
    await expect(reconnect.call('session.transfer.import.status', {
      batchId: 'batch', requestId: 'commit',
    })).rejects.toMatchObject({ code: 'SESSION_TRANSFER_WRITE_FAILED', details: { sessionId } })
    expect(create).toHaveBeenCalledTimes(1)
    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(attachSession).not.toHaveBeenCalled()
  } finally {
    peer.close()
    reconnect.close()
  }
})
