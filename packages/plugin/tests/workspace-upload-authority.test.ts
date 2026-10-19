import { describe, expect, it, vi } from 'vitest'
import { workspaceUploadRootResolver } from '../src/workspace-upload-authority.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'

it('uses the official authenticated Harness list and fails closed on unknown sessions, missing cwd and upstream denial', async () => {
  const dispatch = vi.fn(async () => ({ ok: true, value: { items: [
    { sessionId: 'visible', cwd: '/trusted/workspace' }, { sessionId: 'no-cwd' },
  ] } }))
  const gateway = { supportsCarrier: true, dispatch } as unknown as LocalTypertGateway
  const resolve = workspaceUploadRootResolver(gateway, () => true, vi.fn(), vi.fn())
  const signal = new AbortController().signal
  expect(await resolve('visible', signal)).toBe('/trusted/workspace')
  expect(dispatch).toHaveBeenCalledWith('session/list', { args: { _request: {} } }, signal)
  expect(await resolve('hidden', signal)).toBeUndefined()
  expect(await resolve('no-cwd', signal)).toBeUndefined()
  dispatch.mockResolvedValueOnce({ ok: false } as never)
  expect(await resolve('visible', signal)).toBeUndefined()
  await expect(workspaceUploadRootResolver(gateway, () => false, vi.fn(), vi.fn())('visible', signal)).rejects.toThrow()
})

it('keeps CodeX/ACP namespace authority separate and never falls back to Harness for foreign or malformed IDs', async () => {
  const dispatch = vi.fn(), codex = vi.fn(async () => '/codex'), acp = vi.fn(() => '/acp')
  const resolve = workspaceUploadRootResolver({ supportsCarrier: true, dispatch } as unknown as LocalTypertGateway, () => true, codex, acp)
  const controller = new AbortController()
  expect(await resolve('codex:thread-1', controller.signal)).toBe('/codex')
  expect(codex).toHaveBeenCalledWith('thread-1')
  await expect(resolve('codex:../outside', controller.signal)).rejects.toThrow()
  for (const id of ['acp:a', 'cursor:b', 'pi:c', 'opencode:d', 'claude:e']) expect(await resolve(id, controller.signal)).toBe('/acp')
  expect(dispatch).not.toHaveBeenCalled()
  controller.abort()
  await expect(resolve('visible', controller.signal)).rejects.toThrow()
  expect(dispatch).not.toHaveBeenCalled()
})
