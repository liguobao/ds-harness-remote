import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODEX_APP_TRANSFER_CHUNK_BYTES,
  createEvent,
  createRpcResponse,
  encodeMessage,
  MAX_SECURE_MESSAGE_BYTES,
  SecureMessageCodec,
} from '@dsh-remote/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CodexAppServerInbound,
  CodexAppServerInboundHandler,
  CodexAppServerLike,
  CodexAppServerUnavailableHandler,
} from '../src/codex/app-server.js'
import {
  CODEX_THREAD_UNMATERIALIZED,
  CODEX_UNMATERIALIZED_THREAD_MESSAGE,
  CodexAppServerError,
} from '../src/codex/app-server.js'
import { CodexRemoteDomain, codexBinaryCandidates } from '../src/codex/domain.js'
import type { SafeLogger } from '../src/logging.js'
import { RpcError } from '../src/safe-error.js'

const cleanup: string[] = []

const cleanupScenario1 = async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
}
afterEach(cleanupScenario1)

describe('CodexRemoteDomain', () => {
  it('enables and disables CodeX live without replacing authenticated peers', async () => {
    const app = new FakeAppServer('/unused')
    const domain = new CodexRemoteDomain({ enabled: false, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peer = domain.createPeer({ connectionId: 'live-peer', peerDeviceId: 'device' } as never, async () => undefined)!
    expect(peer).toBeDefined()
    await domain.reconfigure({ enabled: true, binary: 'codex' })
    expect(domain.isAvailable()).toBe(true)
    await expect(peer.call({ method: 'project/list', params: {} })).resolves.toBeDefined()
    await domain.reconfigure({ enabled: false, binary: 'codex' })
    expect(domain.isAvailable()).toBe(false)
    await expect(peer.call({ method: 'project/list', params: {} })).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE' })
    await domain.reconfigure({ enabled: true, binary: 'codex' })
    await expect(peer.call({ method: 'project/list', params: {} })).resolves.toBeDefined()
    await domain.close()
  })

  it('stays unavailable when the optional domain is disabled', async () => {
    const create = vi.fn(() => new FakeAppServer('/unused'))
    const domain = new CodexRemoteDomain({ enabled: false, binary: 'codex' }, logger(), create)

    await domain.start()

    expect(create).not.toHaveBeenCalled()
    expect(domain.status()).toEqual({
      enabled: false,
      available: false,
      state: 'disabled',
      restartAttempt: 0,
    })
    await domain.close()
  })

  it('deduplicates concurrent workspace authority reads without retaining stale roots', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()

    await Promise.all([
      domain.call('connection-1', { method: 'thread/read', params: { threadId: 'allowed-thread' } }),
      domain.call('connection-2', { method: 'thread/read', params: { threadId: 'allowed-thread' } }),
    ])
    expect(app.calls.filter(call => call.method === 'project/list')).toHaveLength(1)
    // One authorization read is shared; each caller still receives its own
    // official thread/read response.
    expect(app.calls.filter(call => call.method === 'thread/read')).toHaveLength(3)

    await domain.call('connection-1', { method: 'thread/read', params: { threadId: 'allowed-thread' } })
    expect(app.calls.filter(call => call.method === 'project/list')).toHaveLength(2)
    await domain.close()
  })

  it('enforces CodeX workspace authority for thread and project operations', async () => {
    await runScenarios(
      [
        {
          name: 'sanitizes CodeX listings using CodeX as the workspace source of truth',
          run: async () => {
            const { root, outside } = await directories()
            const app = new FakeAppServer(root, outside)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            const result = await domain.call('connection-1', { method: 'thread/list', params: {} })
            expect(result).toMatchObject({
              data: [
                { id: 'allowed-thread', cwd: root, projectId: 'allowed-project' },
                { id: 'outside-thread', cwd: outside, projectId: 'outside-project' },
                { id: 'project-only-thread', projectId: 'allowed-project' },
              ],
            })
            expect(JSON.stringify(result)).not.toContain('unprojected-thread')
            expect(JSON.stringify(result)).not.toContain('missing-cwd')
            const projects = await domain.call('connection-1', { method: 'project/list', params: {} })
            expect(projects).toMatchObject({
              data: [
                {
                  id: 'allowed-project',
                  name: 'Allowed Project',
                  roots: [{ path: root }],
                },
                {
                  id: 'outside-project',
                  name: 'Outside Project',
                  roots: [{ path: outside }],
                },
              ],
            })
            expect(JSON.stringify(projects)).not.toContain('private metadata')
            expect(JSON.stringify(result)).not.toContain('private rollout path')
            await expect(
              domain.call('connection-1', {
                method: 'thread/shellCommand',
                params: { threadId: 'allowed-thread', command: 'whoami' },
              }),
            ).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
            await expect(
              domain.call('connection-1', {
                method: 'thread/read',
                params: { threadId: 'outside-thread', includeTurns: true },
              }),
            ).resolves.toMatchObject({ thread: { id: 'outside-thread', cwd: outside } })
            await expect(
              domain.call('connection-1', {
                method: 'thread/read',
                params: { threadId: 'unprojected-thread', includeTurns: true },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_THREAD_NOT_ALLOWED' })
            await domain.close()
          },
        },
        {
          name: 'starts new threads only from CodeX advertised workspace paths',
          run: async () => {
            const { base, root, outside } = await directories()
            const child = join(root, 'new-workspace')
            await mkdir(child)
            const link = join(root, 'outside-link')
            await symlink(outside, link, 'dir')
            const app = new FakeAppServer(root, outside)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            await expect(
              domain.call('connection-1', {
                method: 'thread/start',
                params: { cwd: join(base, 'missing') },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_PATH_NOT_ALLOWED' })
            await expect(
              domain.call('connection-1', {
                method: 'thread/start',
                params: { cwd: link },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_PATH_NOT_ALLOWED' })
            await expect(
              domain.call('connection-1', {
                method: 'thread/start',
                params: { cwd: root },
              }),
            ).resolves.toMatchObject({ thread: { id: 'new-thread' } })
            expect(app.calls.find((call) => call.method === 'thread/start')?.params).toMatchObject({
              cwd: root,
              approvalPolicy: 'on-request',
              sandbox: 'workspace-write',
              serviceName: 'deepseek_harness_remote',
            })
            await expect(
              domain.call('connection-1', {
                method: 'thread/start',
                params: { cwd: child },
              }),
            ).resolves.toMatchObject({ thread: { id: 'new-thread', cwd: child } })
            expect(app.calls.filter((call) => call.method === 'thread/start').at(-1)?.params).toMatchObject({
              cwd: child,
            })
            await expect(
              domain.call('connection-1', {
                method: 'thread/start',
                params: { cwd: outside },
              }),
            ).resolves.toMatchObject({ thread: { id: 'new-thread' } })
            expect(base).toContain(tmpdir())
            await domain.close()
          },
        },
        {
          name: 'creates a sanitized CodeX project only for an existing absolute directory',
          run: async () => {
            const { base, root } = await directories()
            const canonicalRoot = await realpath(root)
            const link = join(base, 'selected-project-link')
            await symlink(root, link, 'dir')
            const app = new FakeAppServer(root)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            await expect(
              domain.call('connection-1', {
                method: 'project/create',
                params: {
                  name: '  New Project  ',
                  roots: [{ path: link }],
                  idempotencyKey: '018f47f6-5f5a-7b5a-8d74-2e797b4d749c',
                },
              }),
            ).resolves.toEqual({
              project: {
                id: 'created-project',
                name: 'New Project',
                roots: [{ path: canonicalRoot }],
                position: 2,
                createdAt: 3,
                updatedAt: 3,
              },
            })
            expect(app.calls.find((call) => call.method === 'project/create')).toEqual({
              method: 'project/create',
              params: {
                name: 'New Project',
                roots: [{ path: canonicalRoot }],
                idempotencyKey: '018f47f6-5f5a-7b5a-8d74-2e797b4d749c',
              },
            })
            await expect(
              domain.call('connection-1', {
                method: 'project/create',
                params: {
                  name: 'Missing',
                  roots: [{ path: join(base, 'missing') }],
                  idempotencyKey: '018f47f6-5f5a-7b5a-8d74-2e797b4d749d',
                },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_PATH_NOT_ALLOWED' })
            await domain.close()
          },
        },
        {
          name: 'lists only directories inside the CodeX workspace authority',
          run: async () => {
            const { base, root, outside } = await directories()
            const child = join(root, 'child')
            const hidden = join(root, '.hidden')
            const outsideLink = join(root, 'outside-link')
            await mkdir(child)
            await mkdir(hidden)
            await symlink(outside, outsideLink, 'dir')
            const app = new FakeAppServer(root, outside)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            const result = await domain.call('connection-1', {
              method: 'dsh/directoryList',
              params: { path: root },
            })

            expect(result).toMatchObject({
              path: root,
              home: root,
              crumbs: [{ name: 'allowed', path: root, hidden: false }],
              entries: expect.arrayContaining([
                { name: 'child', path: child, hidden: false },
                { name: '.hidden', path: hidden, hidden: true },
              ]),
              truncated: false,
            })
            expect(JSON.stringify(result)).not.toContain('outside-link')
            await expect(
              domain.call('connection-1', {
                method: 'dsh/directoryList',
                params: { path: outsideLink },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_PATH_NOT_ALLOWED' })
            await expect(
              domain.call('connection-1', {
                method: 'dsh/directoryList',
                params: { path: join(base, 'never-advertised') },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_PATH_NOT_ALLOWED' })
            await domain.close()
          },
        },
      ],
      async () => {
        await cleanupScenario1()
      },
    )
  }, 20000)

  it('uses exact thread cwd authority for unavailable and empty project listings', async () => {
    const rows = ['empty', 'unsupported'] as const
    await runScenarios(
      rows.map((row, index) => {
        const projectListMode = row
        return {
          name: scenarioName('uses exact thread cwd authority when project/list is %s', row, index),
          run: async () => {
            const { base, root, outside } = await directories()
            const app = new FakeAppServer(root, outside)
            app.projectListMode = projectListMode
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            const result = await domain.call('connection-1', { method: 'thread/list', params: {} })
            expect(result).toMatchObject({
              data: [
                { id: 'allowed-thread', cwd: root },
                { id: 'outside-thread', cwd: outside },
                { id: 'unprojected-thread', cwd: `${root}-unprojected` },
              ],
            })
            expect(JSON.stringify(result)).not.toContain('project-only-thread')
            expect(JSON.stringify(result)).not.toContain('missing-cwd')
            expect(app.calls.filter((call) => call.method === 'thread/list')).toHaveLength(1)
            await expect(
              domain.call('connection-1', {
                method: 'thread/read',
                params: { threadId: 'unprojected-thread' },
              }),
            ).resolves.toMatchObject({ thread: { id: 'unprojected-thread', cwd: `${root}-unprojected` } })
            await expect(
              domain.call('connection-1', {
                method: 'thread/start',
                params: { cwd: root },
              }),
            ).resolves.toMatchObject({ thread: { id: 'new-thread', cwd: root } })
            await expect(
              domain.call('connection-1', {
                method: 'thread/start',
                params: { cwd: join(base, 'never-advertised') },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_PATH_NOT_ALLOWED' })
            await domain.close()
          },
        }
      }),
      async () => {
        await cleanupScenario1()
      },
    )
  })

  it('uses explicit presets and authoritative App Server permission defaults', async () => {
    await runScenarios(
      [
        {
          name: 'maps the explicit Full access preset to fixed App Server policies',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            await domain.call('connection-1', {
              method: 'thread/resume',
              params: { threadId: 'allowed-thread', permissionPreset: 'danger-full-access' },
            })
            await domain.call('connection-1', {
              method: 'turn/start',
              params: {
                threadId: 'allowed-thread',
                input: [{ type: 'text', text: 'Run without approval prompts' }],
                permissionPreset: 'danger-full-access',
              },
            })

            expect(app.calls.find((call) => call.method === 'thread/settings/update')?.params).toMatchObject({
              approvalPolicy: 'never',
              sandboxPolicy: { type: 'dangerFullAccess' },
            })
            expect(app.calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
              approvalPolicy: 'never',
              sandboxPolicy: { type: 'dangerFullAccess' },
            })
            expect(JSON.stringify(app.calls)).not.toContain('permissionPreset')
            await domain.close()
          },
        },
        {
          name: 'inherits App Server permission defaults when no preset is provided',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            await domain.call('connection-1', {
              method: 'thread/resume',
              params: { threadId: 'allowed-thread' },
            })
            await domain.call('connection-1', {
              method: 'turn/start',
              params: {
                threadId: 'allowed-thread',
                input: [{ type: 'text', text: 'Use the thread defaults' }],
              },
            })

            const resume = app.calls.find((call) => call.method === 'thread/resume')?.params as Record<
              string,
              unknown
            >
            const turn = app.calls.find((call) => call.method === 'turn/start')?.params as Record<
              string,
              unknown
            >
            expect(resume.approvalPolicy).toBeUndefined()
            expect(resume.sandbox).toBeUndefined()
            expect(turn.approvalPolicy).toBeUndefined()
            expect(turn.sandboxPolicy).toBeUndefined()
            await domain.close()
          },
        },
      ],
      async () => {
        await cleanupScenario1()
      },
    )
  }, 10000)

  it('confirms permission changes and fails closed on rejected updates', async () => {
    await runScenarios(
      [
        {
          name: 'confirms loaded-thread permission changes and exposes them in read-only history',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()
            const history = () =>
              domain.call('observer', { method: 'dsh/sessionHistory', params: { threadId: 'allowed-thread' } })
            await expect(history()).resolves.toMatchObject({ permissionPreset: null })
            expect(app.calls.some((call) => call.method === 'thread/resume')).toBe(false)

            await expect(
              domain.call('writer', {
                method: 'thread/resume',
                params: { threadId: 'allowed-thread', permissionPreset: 'danger-full-access' },
              }),
            ).resolves.toMatchObject({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } })
            expect(app.calls.find((call) => call.method === 'thread/settings/update')?.params).toEqual({
              threadId: 'allowed-thread',
              approvalPolicy: 'never',
              sandboxPolicy: { type: 'dangerFullAccess' },
            })
            await expect(history()).resolves.toMatchObject({ permissionPreset: 'danger-full-access' })
            app.emit({
              kind: 'notification',
              method: 'thread/settings/updated',
              params: {
                threadId: 'allowed-thread',
                threadSettings: { approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } },
              },
            })
            await expect(history()).resolves.toMatchObject({ permissionPreset: null })
            await expect(
              domain.call('observer', {
                method: 'dsh/sessionHistory',
                params: { threadId: 'unprojected-thread' },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_THREAD_NOT_ALLOWED' })
            await domain.close()
          },
        },
        {
          name: 'does not confirm a rejected setting or let an observer change an active writer policy',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()
            app.rejectSettings = true
            const change = () =>
              domain.call('observer', {
                method: 'thread/resume',
                params: { threadId: 'allowed-thread', permissionPreset: 'danger-full-access' },
              })
            await expect(change()).rejects.toMatchObject({ code: 'CODEX_UPSTREAM_ERROR' })
            await expect(
              domain.call('observer', {
                method: 'dsh/sessionHistory',
                params: { threadId: 'allowed-thread' },
              }),
            ).resolves.toMatchObject({ permissionPreset: null })
            await domain.call('writer', {
              method: 'turn/start',
              params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Run' }] },
            })
            const resumes = app.calls.filter((call) => call.method === 'thread/resume').length
            await expect(change()).rejects.toMatchObject({ code: 'CODEX_THREAD_BUSY' })
            expect(app.calls.filter((call) => call.method === 'thread/resume')).toHaveLength(resumes)
            await domain.close()
          },
        },
        {
          name: 'supports older App Servers only when resume confirms the requested policy',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            app.rejectSettings = true
            const upstream = app.call.bind(app)
            vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
              const result = await upstream(method, params)
              return method === 'thread/resume'
                ? {
                    ...(isRecord(result) ? result : {}),
                    approvalPolicy: 'never',
                    sandbox: { type: 'dangerFullAccess' },
                  }
                : result
            })
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()
            await expect(
              domain.call('writer', {
                method: 'thread/resume',
                params: { threadId: 'allowed-thread', permissionPreset: 'danger-full-access' },
              }),
            ).resolves.toMatchObject({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } })
            expect(app.calls.filter((call) => call.method === 'thread/settings/update')).toHaveLength(1)
            await domain.close()
          },
        },
        {
          name: 'does not hide rejection when both permission update paths fail',
          run: async () => {
            const { root, outside } = await directories()
            const app = new FakeAppServer(root, outside)
            app.rejectResume = true
            app.rejectSettings = true
            const domain = new CodexRemoteDomain(
              { enabled: true, binary: '/custom/codex' },
              logger(),
              () => app,
            )
            await domain.start()

            await expect(
              domain.call('connection-1', {
                method: 'thread/resume',
                params: { threadId: 'allowed-thread', permissionPreset: 'danger-full-access' },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_UPSTREAM_ERROR' })
            await domain.close()
          },
        },
        {
          name: 'keeps new-session permission changes working before the App Server persists the thread',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            app.rejectSettings = true
            app.resumeRolloutMissing = true
            const domain = new CodexRemoteDomain(
              { enabled: true, binary: '/custom/codex' },
              logger(),
              () => app,
            )
            await domain.start()

            // Regression: ChatGPT.app codex 0.162 rejects thread/resume with
            // "no rollout found" for threads created in this process, which
            // surfaced as "Codex App Server rejected the request." on the
            // Remote client during new-session permission changes.
            await expect(
              domain.call('connection-1', {
                method: 'thread/resume',
                params: { threadId: 'allowed-thread', permissionPreset: 'danger-full-access' },
              }),
            ).resolves.toMatchObject({
              thread: { id: 'allowed-thread', cwd: root },
              approvalPolicy: 'never',
              sandbox: { type: 'dangerFullAccess' },
            })
            expect(app.calls.some((call) => call.method === 'thread/settings/updated')).toBe(false)
            await domain.close()
          },
        },
        {
          name: 'keeps generic permission-update rejections failing closed',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            app.rejectSettings = true
            app.rejectResume = true
            const domain = new CodexRemoteDomain(
              { enabled: true, binary: '/custom/codex' },
              logger(),
              () => app,
            )
            await domain.start()

            await expect(
              domain.call('connection-1', {
                method: 'thread/resume',
                params: { threadId: 'allowed-thread', permissionPreset: 'danger-full-access' },
              }),
            ).rejects.toMatchObject({ code: 'CODEX_UPSTREAM_ERROR' })
            await domain.close()
          },
        },
      ],
      async () => {
        await cleanupScenario1()
      },
    )
  }, 20000)

  it('maps bounded remote image input to an App Server data URL', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()

    await domain.call('connection-1', {
      method: 'turn/start',
      params: {
        threadId: 'allowed-thread',
        input: [
          { type: 'text', text: 'Describe the image' },
          { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' },
        ],
      },
    })

    expect(app.calls.find(call => call.method === 'turn/start')?.params).toMatchObject({
      input: [
        { type: 'text', text: 'Describe the image' },
        { type: 'image', url: 'data:image/png;base64,aW1hZ2U=' },
      ],
    })
    await expect(domain.call('connection-1', {
      method: 'turn/start',
      params: {
        threadId: 'allowed-thread',
        input: [{ type: 'image', mediaType: 'image/png', data: 'not-base64' }],
      },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    await domain.close()
  })

  it('pages CodeX history with a bounded legacy fallback', async () => {
    await runScenarios(
      [
        {
          name: 'projects and paginates CodeX History on the Host before returning it to the Client',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            const tail = await domain.call('connection-1', {
              method: 'dsh/sessionHistory',
              params: { threadId: 'allowed-thread', maxMessages: 1 },
            })
            expect(tail).toMatchObject({ cursor: 5, hasMore: true })
            expect(
              (tail as { records: Array<{ event: { seq: number } }> }).records.map((entry) => entry.event.seq),
            ).toEqual([3, 4, 5])
            expect(app.calls.at(-1)).toEqual({
              method: 'thread/turns/list',
              params: { threadId: 'allowed-thread', limit: 25, sortDirection: 'asc', itemsView: 'full' },
            })

            const older = await domain.call('connection-1', {
              method: 'dsh/sessionHistory',
              params: { threadId: 'allowed-thread', beforeSeq: 3, throughSeq: 5, maxMessages: 1 },
            })
            expect(
              (older as { records: Array<{ event: { seq: number } }> }).records.map((entry) => entry.event.seq),
            ).toEqual([2])
            await domain.close()
          },
        },
        {
          name: 'keeps genuine successful empty history distinct from failed reads',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            const original = app.call.bind(app)
            vi.spyOn(app, 'call').mockImplementation((method, params) => method === 'thread/turns/list'
              ? Promise.resolve({ data: [], nextCursor: null }) : original(method, params))
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            try {
              await domain.start()
              await expect(domain.call('connection-1', {
                method: 'dsh/sessionHistory', params: { threadId: 'allowed-thread' },
              })).resolves.toMatchObject({ cursor: -1, records: [], hasMore: false })
            } finally {
              await domain.close()
            }
          },
        },
        {
          name: 'falls back to legacy full Thread reads when paginated history is unavailable',
          run: async () => {
            const { root } = await directories()
            const app = new FakeAppServer(root)
            app.rejectTurnPagination = true
            const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
            await domain.start()

            const history = await domain.call('connection-1', {
              method: 'dsh/sessionHistory',
              params: { threadId: 'allowed-thread', maxMessages: 1 },
            })

            expect(history).toMatchObject({ cursor: 5, hasMore: true })
            expect(app.calls.map((call) => call.method)).toContain('thread/turns/list')
            expect(app.calls.at(-1)).toEqual({
              method: 'thread/read',
              params: { threadId: 'allowed-thread', includeTurns: true },
            })
            await domain.close()
          },
        },
      ],
      async () => {
        await cleanupScenario1()
      },
    )
  }, 10000)

  it('reads summary history item pages in parallel while retaining turn order', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const original = app.call.bind(app)
    let activeItemReads = 0
    let maxActiveItemReads = 0
    vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
      if (method === 'thread/turns/list') {
        if (isRecord(params) && params.itemsView === 'full') {
          throw new CodexAppServerError('METHOD_NOT_FOUND', 'method not found')
        }
        return {
          data: [1, 2, 3].map(index => ({
            id: `turn-${index}`,
            status: 'completed',
            itemsView: 'summary',
          })),
          nextCursor: null,
        }
      }
      if (method === 'thread/items/list') {
        const turnId = isRecord(params) && typeof params.turnId === 'string' ? params.turnId : 'unknown'
        activeItemReads += 1
        maxActiveItemReads = Math.max(maxActiveItemReads, activeItemReads)
        await new Promise(resolve => setTimeout(resolve, 10))
        activeItemReads -= 1
        return {
          data: [{ item: { id: `item-${turnId}`, type: 'userMessage', text: turnId } }],
          nextCursor: null,
        }
      }
      return original(method, params)
    })
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    try {
      await domain.start()
      const history = await domain.call('connection-1', {
        method: 'dsh/sessionHistory',
        params: { threadId: 'allowed-thread' },
      }) as { records: Array<{ event: { data: unknown } }> }
      expect(maxActiveItemReads).toBe(3)
      const text = history.records
        .map(record => JSON.stringify(record.event.data))
        .filter(value => value.includes('turn-'))
      expect(text.join('\n')).toMatch(/turn-1[\s\S]*turn-2[\s\S]*turn-3/)
    } finally {
      await domain.close()
    }
  }, 10000)

  it('projects a new unmaterialized Thread as empty history so it can be followed', async () => {
    await runScenarios([
      {
        name: 'empty first turn page from an unmaterialized Thread',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          app.unmaterializedThread = true
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          try {
            await domain.start()
            const history = await domain.call('connection-1', {
              method: 'dsh/sessionHistory',
              params: { threadId: 'allowed-thread', maxMessages: 1 },
            })
            expect(history).toMatchObject({ cursor: -1, records: [], hasMore: false })
            expect(app.calls.filter(call => call.method === 'thread/turns/list')).toHaveLength(1)
            expect(app.calls.some(call => call.method === 'thread/read'
              && isRecord(call.params) && call.params.includeTurns === true)).toBe(false)
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'legacy full Thread read on an unmaterialized Thread',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          app.legacyUnmaterializedThread = true
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          try {
            await domain.start()
            const history = await domain.call('connection-1', {
              method: 'dsh/sessionHistory',
              params: { threadId: 'allowed-thread', maxMessages: 1 },
            })
            expect(history).toMatchObject({ cursor: -1, records: [], hasMore: false })
            expect(app.calls.some(call => call.method === 'thread/read'
              && isRecord(call.params) && call.params.includeTurns === true)).toBe(true)
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'a later page failure never replaces already-read history with a blank',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          app.unmaterializedAfterFirstPage = true
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          try {
            await domain.start()
            await expect(domain.call('connection-1', {
              method: 'dsh/sessionHistory',
              params: { threadId: 'allowed-thread' },
            })).rejects.toMatchObject({ code: CODEX_THREAD_UNMATERIALIZED })
            expect(app.calls.some(call => isRecord(call.params) && call.params.cursor === 'page-2')).toBe(true)
          } finally {
            await domain.close()
          }
        },
      },
    ])
  }, 10000)

  it('does not replace a populated reconnect baseline with empty history on read failures', async () => {
    const scenarios = [
      { name: 'busy turn read', stage: 'turns', error: new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Thread has an active writer.'), code: 'CODEX_THREAD_BUSY' },
      { name: 'timed out turn read', stage: 'turns', error: new CodexAppServerError('CODEX_REQUEST_TIMEOUT', 'Request timed out.'), code: 'CODEX_REQUEST_TIMEOUT' },
      { name: 'timed out item read', stage: 'items', error: new CodexAppServerError('CODEX_REQUEST_TIMEOUT', 'Request timed out.'), code: 'CODEX_REQUEST_TIMEOUT' },
      { name: 'all history APIs unavailable', stage: 'all', error: new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'History unavailable.'), code: 'CODEX_UPSTREAM_ERROR' },
      { name: 'malformed turn page', stage: 'invalid-turns', code: 'CODEX_INVALID_RESPONSE' },
      { name: 'malformed item page', stage: 'invalid-items', code: 'CODEX_INVALID_RESPONSE' },
      { name: 'malformed turn entry', stage: 'invalid-turn', code: 'CODEX_INVALID_RESPONSE' },
      { name: 'full turn missing items', stage: 'invalid-full', code: 'CODEX_INVALID_RESPONSE' },
      { name: 'malformed pagination cursor', stage: 'invalid-cursor', code: 'CODEX_INVALID_RESPONSE' },
      { name: 'malformed legacy full history', stage: 'invalid-legacy', error: new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Pagination unavailable.'), code: 'CODEX_INVALID_RESPONSE' },
      { name: 'nonempty summary cannot replace a failed second item page', stage: 'items-late', error: new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'History unavailable.'), code: 'CODEX_UPSTREAM_ERROR' },
      { name: 'turn pagination budget does not return the oldest prefix', stage: 'turn-limit', code: 'PAYLOAD_TOO_LARGE' },
      { name: 'item pagination budget does not return a partial turn', stage: 'item-limit', code: 'PAYLOAD_TOO_LARGE' },
    ]
    await runScenarios(scenarios.map(scenario => ({
      name: scenario.name,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const original = app.call.bind(app)
        let failing = false
        vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
          const result = await original(method, params)
          if (!failing) return result
          if (method === 'thread/turns/list') {
            if (scenario.stage === 'invalid-turns') return {}
            if (scenario.stage === 'invalid-turn') return { data: [null], nextCursor: null }
            if (scenario.stage === 'invalid-full') return { data: [{ id: 'turn-1', itemsView: 'full' }], nextCursor: null }
            if (scenario.stage === 'turn-limit') return { data: [], nextCursor: 'more' }
            if (scenario.stage === 'invalid-cursor') return { data: [], nextCursor: 1 }
            if (['turns', 'all', 'invalid-legacy'].includes(scenario.stage)) throw scenario.error
            // Summary turns need a separate items read; even a nonempty
            // summary cannot replace failed full content on a later page.
            return { data: [{ id: 'turn-1', status: 'completed', itemsView: 'summary', items: [
              { id: 'summary-user', type: 'userMessage', text: 'Summary only' },
            ] }], nextCursor: null }
          }
          if (method === 'thread/items/list') {
            if (scenario.stage === 'invalid-items') return { data: [{}], nextCursor: null }
            if (scenario.stage === 'item-limit') return { data: [], nextCursor: 'more' }
            if (scenario.stage === 'items-late' && isRecord(params) && params.cursor === undefined) {
              return { data: [{ item: { id: 'full-user', type: 'userMessage', text: 'Full first page' } }], nextCursor: 'page-2' }
            }
            throw scenario.error
          }
          if (method === 'thread/read' && isRecord(params) && params.includeTurns === true) {
            if (scenario.stage === 'invalid-legacy') return { thread: { id: 'allowed-thread', cwd: root, turns: [{}] } }
            if (['all', 'items-late'].includes(scenario.stage)) throw scenario.error
          }
          return result
        })
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        try {
          await domain.start()
          const read = (connectionId: string) => domain.call(connectionId, {
            method: 'dsh/sessionHistory', params: { threadId: 'allowed-thread', maxMessages: 1 },
          })
          const baseline = await read('connection-1')
          failing = true
          app.calls.length = 0
          await expect(read('replacement-connection')).rejects.toMatchObject({ code: scenario.code })
          if (scenario.code === 'CODEX_THREAD_BUSY' || scenario.code === 'CODEX_REQUEST_TIMEOUT') {
            expect(app.calls.filter(call => call.method === 'thread/turns/list')).toHaveLength(1)
            expect(app.calls.some(call => call.method === 'thread/read' && isRecord(call.params) && call.params.includeTurns === true)).toBe(false)
          }
          failing = false
          await expect(read('replacement-connection')).resolves.toEqual(baseline)
          expect(app.calls.some(call => call.method === 'thread/resume' || call.method === 'turn/start')).toBe(false)
        } finally {
          await domain.close()
        }
      },
    })), cleanupScenario1)
  }, 10000)

  it('treats resume as idempotent when App Server already has the allowed thread loaded', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    app.rejectResume = true
    const domain = new CodexRemoteDomain({ enabled: true, binary: '/custom/codex' }, logger(), () => app)
    await domain.start()

    await expect(domain.call('connection-1', {
      method: 'thread/resume', params: { threadId: 'allowed-thread' },
    })).resolves.toMatchObject({ thread: { id: 'allowed-thread', cwd: root } })
    expect(app.calls.filter(call => call.method === 'thread/read')).toHaveLength(1)
    expect(app.calls.filter(call => call.method === 'thread/resume')).toHaveLength(1)
    await domain.close()
  })

  it('fails silent turns after the watchdog timeout and releases the writer lease', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain(
      { enabled: true, binary: 'codex' },
      logger(),
      () => app,
      [1_000],
      50,
    )
    await domain.start()
    const frames: Array<{ event: string; data: unknown }> = []
    const owner = domain.createPeer(
      { connectionId: 'connection-1', peerDeviceId: 'peer-1' },
      async (event, data) => { frames.push({ event, data }) },
    )!
    const waiter = domain.createPeer(
      { connectionId: 'connection-2', peerDeviceId: 'peer-2' },
      async () => undefined,
    )!
    await owner.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
    await owner.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Hello' }] },
    })
    await expect(waiter.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Compete' }] },
    })).rejects.toMatchObject({ code: 'CODEX_TURN_OWNED' })

    await vi.waitFor(() => {
      const completed = frames.find(frame => frame.event === 'codex.app.frame'
        && isRecord(frame.data)
        && isRecord(frame.data.frame)
        && frame.data.frame.method === 'turn/completed')
      expect(completed).toBeDefined()
      const turn = isRecord(completed?.data)
        && isRecord(completed.data.frame)
        && isRecord(completed.data.frame.params)
        ? completed.data.frame.params.turn
        : undefined
      expect(turn).toMatchObject({
        status: 'failed',
        error: {
          message: expect.stringContaining('timed out waiting for the App Server'),
          codex_error_info: 'remote_turn_silence',
        },
      })
    })

    await expect(waiter.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Retry after silence' }] },
    })).resolves.toMatchObject({ turn: { id: 'turn-1' } })
    await domain.close()
  })

  it('isolates streams and approval handles to the active turn owner', async () => {
    const { root, outside } = await directories()
    const app = new FakeAppServer(root, outside)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peerOneFrames: Array<{ event: string; data: unknown }> = []
    const peerTwoFrames: Array<{ event: string; data: unknown }> = []
    const peerOne = domain.createPeer(
      { connectionId: 'connection-1', peerDeviceId: 'peer-1' },
      async (event, data) => { peerOneFrames.push({ event, data }) },
    )!
    const peerTwo = domain.createPeer(
      { connectionId: 'connection-2', peerDeviceId: 'peer-2' },
      async (event, data) => { peerTwoFrames.push({ event, data }) },
    )!
    await peerOne.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
    await peerTwo.openStream({ streamId: 'stream-2', threadId: 'allowed-thread' })
    await peerOne.call({
      method: 'thread/fork',
      params: { threadId: 'allowed-thread', lastTurnId: 'turn-2', permissionPreset: 'workspace-write' },
    })
    expect(app.calls.find(call => call.method === 'thread/fork')?.params).toMatchObject({
      lastTurnId: 'turn-2',
      excludeTurns: true,
      cwd: root,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
    })
    await peerOne.call({
      method: 'turn/start',
      params: {
        threadId: 'allowed-thread',
        input: [{ type: 'text', text: 'Run tests' }],
        permissionPreset: 'workspace-write',
      },
    })
    const enforcedTurn = app.calls.find(call => call.method === 'turn/start')?.params
    expect(enforcedTurn).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'workspaceWrite',
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    })
    expect(isRecord(enforcedTurn) && typeof enforcedTurn.cwd === 'string' && enforcedTurn.cwd.endsWith('/allowed')).toBe(true)
    expect(isRecord(enforcedTurn) && isRecord(enforcedTurn.sandboxPolicy)
      ? enforcedTurn.sandboxPolicy.writableRoots
      : undefined).toEqual(isRecord(enforcedTurn) ? [enforcedTurn.cwd] : undefined)
    await expect(peerTwo.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Compete' }] },
    })).rejects.toMatchObject({ code: 'CODEX_TURN_OWNED' })

    // A terminal Thread status is sufficient to release the writer lease;
    // not every App Server failure path emits turn/completed afterwards.
    app.emit({
      kind: 'notification',
      method: 'thread/status/changed',
      params: { threadId: 'allowed-thread', status: { type: 'systemError' } },
    })
    await flush()
    await expect(peerTwo.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Retry after failure' }] },
    })).resolves.toMatchObject({ turn: { id: 'turn-1' } })
    app.emit({
      kind: 'notification',
      method: 'turn/completed',
      params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
    })
    await peerOne.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Continue' }] },
    })

    app.emit({
      kind: 'request',
      id: 91,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'allowed-thread',
        turnId: 'turn-1',
        itemId: 'item-1',
        command: 'pnpm test',
        proposedExecpolicyAmendment: ['never expose'],
        availableDecisions: ['accept', 'acceptForSession', 'decline'],
      },
    })
    await flush()

    const approvalFrame = peerOneFrames.find(frame => JSON.stringify(frame.data).includes('requestHandle'))
    expect(approvalFrame).toBeDefined()
    expect(JSON.stringify(approvalFrame)).not.toContain('acceptForSession')
    expect(JSON.stringify(approvalFrame)).not.toContain('proposedExecpolicyAmendment')
    expect(peerTwoFrames.some(frame => JSON.stringify(frame.data).includes('requestHandle'))).toBe(false)
    const requestHandle = extractRequestHandle(approvalFrame!.data)
    await expect(peerTwo.respond({ requestHandle, decision: 'accept' })).rejects.toMatchObject({
      code: 'CODEX_APPROVAL_NOT_FOUND',
    })
    await peerOne.respond({ requestHandle, decision: 'accept' })
    expect(app.responses).toContainEqual({ id: 91, result: { decision: 'accept' } })

    await peerOne.closeAll()
    await expect(peerTwo.call({
      method: 'turn/interrupt',
      params: { threadId: 'allowed-thread', turnId: 'turn-1' },
    })).resolves.toEqual({})
    await peerTwo.closeAll()
    await domain.close()
  })

  it('releases only the last idle subscription across streams, peers, and explicit unsubscribe', async () => {
    await runScenarios(['stream', 'disconnect', 'unsubscribe'].map(action => ({
      name: action,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        const first = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
        const second = domain.createPeer({ connectionId: 'second', peerDeviceId: 'two' }, async () => undefined)!
        const releases = () => app.calls.filter(call => call.method === 'thread/unsubscribe')
        try {
          await first.openStream({ streamId: 'one', threadId: 'allowed-thread' })
          await first.openStream({ streamId: 'two', threadId: 'allowed-thread' })
          await second.openStream({ streamId: 'three', threadId: 'allowed-thread' })
          await first.closeStream({ streamId: 'one' })
          await first.closeAll()
          expect(releases()).toHaveLength(0)
          if (action === 'stream') await second.closeStream({ streamId: 'three' })
          else if (action === 'disconnect') await second.closeAll()
          else await second.call({ method: 'thread/unsubscribe', params: { threadId: 'allowed-thread' } })
          expect(releases()).toHaveLength(1)
          await second.closeStream({ streamId: 'three' })
          await second.closeAll()
          expect(releases()).toHaveLength(1)
        } finally { await domain.close() }
      },
    })), cleanupScenario1)
  })

  it('keeps disconnected or timed-out turns loaded until an authoritative terminal event', async () => {
    await runScenarios(['stream', 'disconnect', 'silence', 'late-result', 'rpc-timeout'].map(action => ({
      name: action,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app, undefined, action === 'silence' ? 10 : 600000)
        await domain.start()
        const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
        let finish!: () => void
        let entered!: () => void
        const gate = new Promise<void>(resolve => { finish = resolve })
        const waiting = new Promise<void>(resolve => { entered = resolve })
        const original = app.call.bind(app)
        if (action === 'late-result' || action === 'rpc-timeout') vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
          if (method === 'turn/start') {
            entered()
            await gate
            if (action === 'rpc-timeout') throw new CodexAppServerError('CODEX_REQUEST_TIMEOUT', 'Timed out')
          }
          return original(method, params)
        })
        const releases = () => app.calls.filter(call => call.method === 'thread/unsubscribe')
        let turn: Promise<unknown> | undefined
        try {
          await peer.openStream({ streamId: 'one', threadId: 'allowed-thread' })
          turn = peer.call({ method: 'turn/start', params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'hello' }] } }).catch(() => undefined)
          if (action === 'late-result' || action === 'rpc-timeout') await waiting
          else await turn
          if (action === 'stream' || action === 'silence' || action === 'rpc-timeout') await peer.closeStream({ streamId: 'one' })
          else await peer.closeAll()
          finish()
          await turn
          if (action === 'silence') await new Promise(resolve => setTimeout(resolve, 25))
          expect(releases()).toHaveLength(0)
          app.emit({ kind: 'notification', method: 'turn/completed', params: { threadId: 'allowed-thread', turn: { id: 'turn-1' } } })
          await flush()
          expect(releases()).toHaveLength(1)
        } finally {
          finish()
          await turn
          await domain.close()
          vi.restoreAllMocks()
        }
      },
    })), cleanupScenario1)
  })

  it('retains active goals across idle turn boundaries and releases after the final turn', async () => {
    await runScenarios(['complete', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'cleared'].map(status => ({
      name: status,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
        try {
          app.goal = { threadId: 'allowed-thread', status: 'active' }
          await peer.openStream({ streamId: 'one', threadId: 'allowed-thread' })
          await peer.call({ method: 'turn/start', params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'finish the goal' }] } })
          await peer.closeAll()
          app.emit({ kind: 'notification', method: 'thread/status/changed', params: { threadId: 'allowed-thread', status: { type: 'idle' } } })
          app.emit({ kind: 'notification', method: 'turn/completed', params: { threadId: 'allowed-thread', turn: { id: 'turn-1' } } })
          await flush()
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(0)
          app.emit({ kind: 'notification', method: 'turn/started', params: { threadId: 'allowed-thread', turn: { id: 'turn-2' } } })
          app.goal = status === 'cleared' ? null : { threadId: 'allowed-thread', status }
          app.emit({ kind: 'notification', method: status === 'cleared' ? 'thread/goal/cleared' : 'thread/goal/updated', params: { threadId: 'allowed-thread', goal: app.goal } })
          await flush()
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(0)
          app.emit({ kind: 'notification', method: 'turn/completed', params: { threadId: 'allowed-thread', turn: { id: 'turn-2' } } })
          await flush()
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
        } finally { await domain.close() }
      },
    })), cleanupScenario1)
  })

  it('keeps a goal created after disconnect through its automatic continuation', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
    try {
      await peer.openStream({ streamId: 'one', threadId: 'allowed-thread' })
      await peer.call({ method: 'turn/start', params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'create a goal' }] } })
      await peer.closeAll()
      app.goal = { threadId: 'allowed-thread', status: 'active' }
      app.emit({ kind: 'notification', method: 'thread/goal/updated', params: { threadId: 'allowed-thread', goal: app.goal } })
      app.emit({ kind: 'notification', method: 'turn/completed', params: { threadId: 'allowed-thread', turn: { id: 'turn-1' } } })
      await flush()
      expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(0)
      app.emit({ kind: 'notification', method: 'thread/goal/cleared', params: { threadId: 'allowed-thread' } })
      await flush()
      expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
    } finally { await domain.close() }
  })

  it('prefers goal notifications over an older in-flight goal snapshot', async () => {
    await runScenarios(['activated', 'cleared'].map(action => ({
      name: action,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
        let finish!: (result: unknown) => void
        let entered!: () => void
        const waiting = new Promise<void>(resolve => { entered = resolve })
        const snapshot = new Promise(resolve => { finish = resolve })
        const original = app.call.bind(app)
        vi.spyOn(app, 'call').mockImplementation((method, params) => {
          if (method === 'thread/goal/get') { entered(); return snapshot }
          return original(method, params)
        })
        let closing: Promise<void> | undefined
        try {
          await peer.openStream({ streamId: 'one', threadId: 'allowed-thread' })
          closing = peer.closeAll()
          await waiting
          const goal = { threadId: 'allowed-thread', status: 'active' }
          app.emit({ kind: 'notification', method: action === 'activated' ? 'thread/goal/updated' : 'thread/goal/cleared', params: { threadId: 'allowed-thread', goal } })
          finish({ goal: action === 'activated' ? null : goal })
          await closing
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(action === 'activated' ? 0 : 1)
          if (action === 'activated') {
            app.emit({ kind: 'notification', method: 'thread/goal/cleared', params: { threadId: 'allowed-thread' } })
            await flush()
            expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
          }
        } finally { finish({ goal: null }); await closing; vi.restoreAllMocks(); await domain.close() }
      },
    })), cleanupScenario1)
  })

  it('retains threads when goal state is unknown and permits confirmed unsupported goals', async () => {
    await runScenarios(['timeout', 'invalid', 'unknown-status', 'wrong-thread', 'unsupported'].map(action => ({
      name: action,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
        const original = app.call.bind(app)
        const spy = vi.spyOn(app, 'call').mockImplementation((method, params) => {
          if (method !== 'thread/goal/get') return original(method, params)
          if (action === 'unsupported' || action === 'timeout') return Promise.reject(new CodexAppServerError(action === 'unsupported' ? 'CODEX_GOALS_UNAVAILABLE' : 'CODEX_REQUEST_TIMEOUT', 'Unavailable'))
          if (action === 'invalid') return Promise.resolve({})
          return Promise.resolve({ goal: { threadId: action === 'wrong-thread' ? 'other-thread' : 'allowed-thread', status: action === 'unknown-status' ? 'new-status' : 'complete' } })
        })
        try {
          await peer.openStream({ streamId: 'one', threadId: 'allowed-thread' })
          await peer.closeAll()
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(action === 'unsupported' ? 1 : 0)
          if (action !== 'unsupported') {
            spy.mockRestore()
            await domain.releaseThread('allowed-thread')
            expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
          }
        } finally { vi.restoreAllMocks(); await domain.close() }
      },
    })), cleanupScenario1)
  })

  it('defers release through approval resolution, expiry, and disconnect', async () => {
    await runScenarios(['respond', 'resolved', 'expire', 'disconnect'].map(action => ({
      name: action,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain(
          { enabled: true, binary: 'codex' },
          logger(),
          () => app,
          undefined,
          undefined,
          undefined,
          action === 'disconnect' ? 0 : undefined,
        )
        await domain.start()
        const frames: unknown[] = []
        const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async (_, data) => { frames.push(data) })!
        try {
          await peer.openStream({ streamId: 'one', threadId: 'allowed-thread' })
          await peer.call({ method: 'turn/start', params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'hello' }] } })
          app.emit({ kind: 'request', id: 42, method: 'item/commandExecution/requestApproval', params: { threadId: 'allowed-thread', turnId: 'turn-1' } })
          await flush()
          const handle = extractRequestHandle(frames.at(-1))
          await peer.closeStream({ streamId: 'one' })
          app.emit({ kind: 'notification', method: 'turn/completed', params: { threadId: 'allowed-thread' } })
          await flush()
          expect(app.calls.some(call => call.method === 'thread/unsubscribe')).toBe(false)
          if (action === 'respond') await peer.respond({ requestHandle: handle, decision: 'decline' })
          else if (action === 'resolved') app.emit({ kind: 'notification', method: 'serverRequest/resolved', params: { requestId: 42 } })
          else if (action === 'disconnect') await peer.closeAll()
          else {
            const now = Date.now()
            vi.spyOn(Date, 'now').mockReturnValue(now + 300001)
            await expect(peer.respond({ requestHandle: handle, decision: 'decline' })).rejects.toMatchObject({ code: 'CODEX_APPROVAL_NOT_FOUND' })
          }
          await flush()
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
        } finally {
          vi.restoreAllMocks()
          await domain.close()
        }
      },
    })), cleanupScenario1)
  })

  it('waits for upstream thread/closed before reopening and coalesces duplicate closes', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
    const original = app.call.bind(app)
    vi.spyOn(app, 'call').mockImplementation((method, params) => {
      if (method !== 'thread/unsubscribe' || app.calls.some(call => call.method === 'thread/unsubscribe')) {
        return original(method, params)
      }
      app.calls.push({ method, params })
      return Promise.resolve({ status: 'unsubscribed' })
    })
    try {
      await peer.openStream({ streamId: 'one', threadId: 'allowed-thread' })
      const closing = peer.closeStream({ streamId: 'one' })
      await vi.waitFor(() => expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1))
      let opened = false
      const opening = peer.openStream({ streamId: 'two', threadId: 'allowed-thread' }).then(() => { opened = true })
      await peer.closeStream({ streamId: 'one' })
      await flush()
      expect(opened).toBe(false)
      expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
      app.emit({ kind: 'notification', method: 'thread/closed', params: { threadId: 'allowed-thread' } })
      await Promise.all([closing, opening])
      expect(opened).toBe(true)
      expect(peer.hasThreadSubscription('allowed-thread')).toBe(true)

      await peer.closeStream({ streamId: 'two' })
      expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(2)

      const readsBeforeReopen = app.calls.filter(call => call.method === 'thread/read').length
      await expect(peer.openStream({ streamId: 'three', threadId: 'allowed-thread' })).resolves.toMatchObject({ opened: true })
      expect(app.calls.filter(call => call.method === 'thread/read').length).toBeGreaterThan(readsBeforeReopen)
      expect(peer.hasThreadSubscription('allowed-thread')).toBe(true)
      await expect(peer.call({ method: 'thread/resume', params: { threadId: 'allowed-thread' } }))
        .resolves.toMatchObject({ thread: { id: 'allowed-thread' } })
      await expect(peer.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Continue after release' }] },
      })).resolves.toMatchObject({ turn: { id: 'turn-1' } })
    } finally { await domain.close() }
  })

  it('cleans up threads acquired before any stream, including a late create after disconnect', async () => {
    await runScenarios(['thread/start', 'thread/resume', 'late-create'].map(action => ({
      name: action,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        const peer = domain.createPeer({ connectionId: 'first', peerDeviceId: 'one' }, async () => undefined)!
        let finish!: () => void
        let entered!: () => void
        const gate = new Promise<void>(resolve => { finish = resolve })
        const waiting = new Promise<void>(resolve => { entered = resolve })
        const original = app.call.bind(app)
        if (action === 'late-create') vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
          if (method === 'thread/start') { entered(); await gate }
          return original(method, params)
        })
        let request: Promise<unknown> | undefined
        try {
          request = peer.call(action === 'thread/resume'
            ? { method: action, params: { threadId: 'allowed-thread' } }
            : { method: 'thread/start', params: { cwd: root } }).catch(() => undefined)
          if (action === 'late-create') await waiting
          else await request
          await peer.closeAll()
          finish()
          await request
          await flush()
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
        } finally { finish(); await request; await domain.close(); vi.restoreAllMocks() }
      },
    })), cleanupScenario1)
  })

  it('lets a replacement connection from the same peer stop its recovered active turn', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peerOne = domain.createPeer(
      { connectionId: 'connection-1', peerDeviceId: 'phone-1' },
      async () => undefined,
    )!
    const peerReplacement = domain.createPeer(
      { connectionId: 'connection-2', peerDeviceId: 'phone-1' },
      async () => undefined,
    )!

    await peerOne.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Run tests' }] },
    })
    await expect(peerOne.call({
      method: 'dsh/sessionHistory',
      params: { threadId: 'allowed-thread', maxMessages: 1 },
    })).resolves.toMatchObject({ activeTurnId: 'turn-1' })
    await expect(peerReplacement.call({
      method: 'turn/interrupt',
      params: { threadId: 'allowed-thread', turnId: 'turn-1' },
    })).resolves.toEqual({})

    await peerOne.closeAll()
    await peerReplacement.closeAll()
    await domain.close()
  })

  it('completes peer teardown even when a remembered thread is stuck closing', async () => {
    vi.useFakeTimers()
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const original = app.call.bind(app)
    vi.spyOn(app, 'call').mockImplementation((method, params) => {
      if (method === 'thread/unsubscribe') return Promise.resolve({ status: 'unsubscribed' })
      return original(method, params)
    })
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peerOne = domain.createPeer({ connectionId: 'conn-1', peerDeviceId: 'phone-1' }, async () => undefined)!
    const peerTwo = domain.createPeer({ connectionId: 'conn-2', peerDeviceId: 'phone-2' }, async () => undefined)!
    try {
      await peerOne.call({ method: 'thread/read', params: { threadId: 'allowed-thread' } })
      await peerTwo.openStream({ streamId: 's-2', threadId: 'allowed-thread' })
      const closingTwo = peerTwo.closeAll()
      await vi.advanceTimersByTimeAsync(5_000)
      await closingTwo

      await expect(peerOne.closeAll()).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
      await domain.close()
    }
  })

  it('absorbs rejected releaseThread errors when closing a stream after an oversized frame', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peer = domain.createPeer({ connectionId: 'conn-oversized', peerDeviceId: 'phone-1' }, async () => undefined)!
    const originalRelease = domain.releaseThread.bind(domain)
    let releasedThread: string | undefined
    // Use a plain async override instead of vi.spyOn/vi.fn because Vitest's spy attaches `.then` to record `settledResults`, masking unhandled rejections.
    domain.releaseThread = async (threadId: string) => {
      releasedThread = threadId
      throw new RpcError('CODEX_THREAD_CLOSING', 'The CodeX thread is still closing.')
    }
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      await peer.openStream({ streamId: 's-oversized', threadId: 'allowed-thread' })
      const oversizedDelta = 'x'.repeat(MAX_SECURE_MESSAGE_BYTES)
      app.emit({
        kind: 'notification',
        method: 'item/agentMessage/delta',
        params: { threadId: 'allowed-thread', itemId: 'msg-big', delta: oversizedDelta },
      })
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(releasedThread).toBe('allowed-thread')
      expect(unhandled).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
      domain.releaseThread = originalRelease
      await peer.closeAll()
      await domain.close()
    }
  })

  it('maps active writer rejections to a CodeX busy error', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    app.rejectTurnStartBusy = true
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()

    await expect(domain.call('connection-1', {
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Run tests' }] },
    })).rejects.toMatchObject({
      code: 'CODEX_THREAD_BUSY',
      message: 'The selected CodeX thread is already active in another CodeX client.',
    })
    await domain.close()
  })

  it('invalidates pending workspace authority when its connection or App Server changes', async () => {
    await runScenarios(['disconnect', 'replace', 'close'].flatMap(action =>
      ['thread/start', 'turn/start', 'permission', 'workspace'].map(operation => ({
        name: `${operation}: ${action}`,
        run: async () => {
          const { root } = await directories()
          const first = new FakeAppServer(root)
          const second = new FakeAppServer(root)
          const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), create)
          await domain.start()
          const peer = domain.createPeer({ connectionId: 'old', peerDeviceId: 'device' }, async () => undefined)!
          let release!: () => void
          let entered!: () => void
          const blocked = new Promise<void>(resolve => { release = resolve })
          const waiting = new Promise<void>(resolve => { entered = resolve })
          const original = first.call.bind(first)
          vi.spyOn(first, 'call').mockImplementation(async (method, params) => {
            const result = await original(method, params)
            if (method === 'project/list') { entered(); await blocked }
            return result
          })
          const pending = operation === 'workspace'
            ? domain.resolveThreadWorkspace('old', 'allowed-thread')
            : peer.call(operation === 'thread/start'
              ? { method: operation, params: { cwd: root } }
              : operation === 'permission'
                ? { method: 'thread/resume', params: { threadId: 'allowed-thread', permissionPreset: 'workspace-write' } }
                : { method: operation, params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'hello' }] } })
          const outcome = pending.then(value => ({ value }), error => ({ error }))
          try {
            await Promise.race([waiting, outcome.then(result => { throw new Error(`Request settled before authority check: ${JSON.stringify(result)}`) })])
            if (action === 'disconnect') await peer.closeAll()
            else if (action === 'replace') await domain.reconfigure({ enabled: true, binary: 'replacement' })
            else await domain.close()
            release()
            expect(await outcome).toHaveProperty('error')
            expect([...first.calls, ...second.calls].some(call =>
              ['thread/start', 'turn/start', 'thread/resume', 'thread/settings/update'].includes(call.method))).toBe(false)
          } finally {
            release()
            await outcome
            await domain.close()
          }
        },
      }))), cleanupScenario1)
  })

  it('keeps a replacement writer lease when an old turn settles late', async () => {
    await runScenarios(['success', 'failure'].map(result => ({
      name: `late ${result}`,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        let finishClose!: () => void
        const closeGate = new Promise<void>(resolve => { finishClose = resolve })
        const old = domain.createPeer({ connectionId: 'old', peerDeviceId: 'old-device' }, async event => {
          if (event === 'codex.app.stream.closed') await closeGate
        })!
        await old.openStream({ streamId: 'existing', threadId: 'allowed-thread' })
        const next = domain.createPeer({ connectionId: 'next', peerDeviceId: 'next-device' }, async () => undefined)!
        const observer = domain.createPeer({ connectionId: 'observer', peerDeviceId: 'observer-device' }, async () => undefined)!
        let release!: () => void
        let entered!: () => void
        const blocked = new Promise<void>(resolve => { release = resolve })
        const waiting = new Promise<void>(resolve => { entered = resolve })
        const original = app.call.bind(app)
        let first = true
        vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
          if (method === 'turn/start' && first) {
            first = false
            entered()
            await blocked
            if (result === 'failure') throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Rejected')
          }
          return original(method, params)
        })
        const request = { method: 'turn/start', params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'hello' }] } }
        const outcome = old.call(request).then(value => ({ value }), error => ({ error }))
        let closing: Promise<void> | undefined
        try {
          await waiting
          closing = old.closeAll()
          await next.call(request)
          release()
          expect(await outcome).toHaveProperty('error')
          await expect(observer.call(request)).rejects.toMatchObject({ code: 'CODEX_TURN_OWNED' })
          await expect(next.call({ method: 'turn/interrupt', params: { threadId: 'allowed-thread', turnId: 'turn-1' } })).resolves.toEqual({})
        } finally {
          release()
          finishClose()
          await closing
          await outcome
          await domain.close()
        }
      },
    })), cleanupScenario1)
  })

  it('closes live streams and restarts after an App Server crash without replaying mutations', async () => {
    const { root } = await directories()
    const first = new FakeAppServer(root)
    const second = new FakeAppServer(root)
    const create = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), create, [0])
    await domain.start()
    const frames: Array<{ event: string; data: unknown }> = []
    const peer = domain.createPeer(
      { connectionId: 'connection-1', peerDeviceId: 'peer-1' },
      async (event, data) => { frames.push({ event, data }) },
    )!
    await peer.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
    await peer.call({
      method: 'turn/start',
      params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Do not replay me' }] },
    })

    first.crash('CODEX_APP_SERVER_EXITED')
    await flush()
    await flush()

    expect(create).toHaveBeenCalledTimes(2)
    expect(domain.status()).toMatchObject({ available: true, state: 'ready', restartAttempt: 0 })
    expect(frames).toContainEqual({
      event: 'codex.app.stream.closed',
      data: { streamId: 'stream-1', reason: 'failed' },
    })
    expect(second.calls.some(call => call.method === 'turn/start')).toBe(false)
    expect(second.calls.map(call => call.method)).toContain('account/read')

    await peer.closeAll()
    await domain.close()
  })

  it('buffers missed Codex real-time frames across disconnects and enforces bounds and hygiene', async () => {
    await runScenarios([
      {
        name: 'replays missed deltas and turn/completed in order after disconnect and drains buffer',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            const first = domain.createPeer(
              { connectionId: 'conn-1', peerDeviceId: 'phone-1' },
              async () => undefined,
            )!
            await first.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
            await first.call({
              method: 'turn/start',
              params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Run' }] },
            })
            await first.closeAll()

            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'Hello ' },
            })
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'world' },
            })
            app.emit({
              kind: 'notification',
              method: 'turn/completed',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
            })
            await flush()
            expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)

            const replayed: Array<{ event: string; data: unknown }> = []
            const second = domain.createPeer(
              { connectionId: 'conn-2', peerDeviceId: 'phone-1' },
              async (event, data) => { replayed.push({ event, data }) },
            )!
            const opened = await second.openStream({ streamId: 'stream-2', threadId: 'allowed-thread' })
            expect(opened).toEqual({ opened: true, streamId: 'stream-2', threadId: 'allowed-thread' })
            expect(replayed).toEqual([
              {
                event: 'codex.app.frame',
                data: {
                  streamId: 'stream-2',
                  frame: {
                    method: 'item/agentMessage/delta',
                    params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'Hello ' },
                  },
                },
              },
              {
                event: 'codex.app.frame',
                data: {
                  streamId: 'stream-2',
                  frame: {
                    method: 'item/agentMessage/delta',
                    params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'world' },
                  },
                },
              },
              {
                event: 'codex.app.frame',
                data: {
                  streamId: 'stream-2',
                  frame: {
                    method: 'turn/completed',
                    params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
                  },
                },
              },
            ])

            replayed.length = 0
            await second.openStream({ streamId: 'stream-3', threadId: 'allowed-thread' })
            expect(replayed).toHaveLength(0)
            await second.closeAll()
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'buffers frames when live publish fails due to transport disconnect and replays on reconnect',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            const broken = domain.createPeer(
              { connectionId: 'conn-broken', peerDeviceId: 'phone-1' },
              async () => { throw new Error('transport closed') },
            )!
            await broken.openStream({ streamId: 'stream-broken', threadId: 'allowed-thread' })
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: 'in-flight' },
            })
            app.emit({
              kind: 'notification',
              method: 'turn/completed',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
            })
            await flush()
            await broken.closeAll()

            const frames: Array<{ event: string; data: unknown }> = []
            const next = domain.createPeer(
              { connectionId: 'conn-next', peerDeviceId: 'phone-1' },
              async (event, data) => { frames.push({ event, data }) },
            )!
            await next.openStream({ streamId: 'stream-next', threadId: 'allowed-thread' })
            expect(frames.map(entry => isRecord(entry.data) && isRecord(entry.data.frame) ? entry.data.frame.method : undefined))
              .toEqual(['item/agentMessage/delta', 'turn/completed'])
            await next.closeAll()
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'truncates overflowed thread buffers to the latest 200 frames and marks replayTruncated',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            for (let index = 0; index < 210; index += 1) {
              app.emit({
                kind: 'notification',
                method: 'item/agentMessage/delta',
                params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: `chunk-${index}` },
              })
            }
            app.emit({
              kind: 'notification',
              method: 'turn/completed',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
            })
            await flush()

            const frames: Array<{ method: string; delta?: string }> = []
            const peer = domain.createPeer(
              { connectionId: 'conn-trunc', peerDeviceId: 'phone-1' },
              async (_event, data) => {
                if (isRecord(data) && isRecord(data.frame) && typeof data.frame.method === 'string') {
                  const delta = isRecord(data.frame.params) && typeof data.frame.params.delta === 'string'
                    ? data.frame.params.delta
                    : undefined
                  frames.push({ method: data.frame.method, ...(delta === undefined ? {} : { delta }) })
                }
              },
            )!
            const opened = await peer.openStream({ streamId: 'stream-trunc', threadId: 'allowed-thread' })
            expect(opened).toEqual({
              opened: true,
              streamId: 'stream-trunc',
              threadId: 'allowed-thread',
              replayTruncated: true,
            })
            expect(frames).toHaveLength(200)
            expect(frames[0]).toEqual({ method: 'item/agentMessage/delta', delta: 'chunk-11' })
            expect(frames.at(-1)).toEqual({ method: 'turn/completed' })
            await peer.closeAll()
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'prunes expired frames by TTL, clears on unsolicited thread/closed, and never buffers approvals',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            const baseNow = Date.now()
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow)
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: 'stale' },
            })
            await flush()

            nowSpy.mockReturnValue(baseNow + 5 * 60_000 + 1)
            const frames: unknown[] = []
            const peer = domain.createPeer(
              { connectionId: 'conn-ttl', peerDeviceId: 'phone-1' },
              async (_event, data) => { frames.push(data) },
            )!
            await peer.openStream({ streamId: 'stream-ttl', threadId: 'allowed-thread' })
            expect(frames).toHaveLength(0)
            await peer.closeStream({ streamId: 'stream-ttl' })
            nowSpy.mockRestore()

            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-2', delta: 'before-close' },
            })
            await flush()
            app.emit({
              kind: 'notification',
              method: 'thread/closed',
              params: { threadId: 'allowed-thread' },
            })
            await flush()

            app.emit({
              kind: 'request',
              id: 77,
              method: 'item/commandExecution/requestApproval',
              params: { threadId: 'allowed-thread', turnId: 'turn-1', command: 'rm -rf /' },
            })
            app.emit({
              kind: 'notification',
              method: 'item/commandExecution/requestApproval',
              params: { threadId: 'allowed-thread', turnId: 'turn-1', command: 'echo hi' },
            })
            await flush()
            expect(app.responses).toContainEqual({ id: 77, result: { decision: 'decline' } })

            await peer.openStream({ streamId: 'stream-after-close', threadId: 'allowed-thread' })
            expect(frames).toHaveLength(0)
            await peer.closeAll()
          } finally {
            vi.restoreAllMocks()
            await domain.close()
          }
        },
      },
      {
        name: 'does not pollute replay buffer with oversized frames or RESPONSE_TOO_LARGE publish errors',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            const huge = 'x'.repeat(MAX_SECURE_MESSAGE_BYTES)
            const peerOneEvents: Array<{ event: string; data: unknown }> = []
            const peerOne = domain.createPeer(
              { connectionId: 'conn-oversized-1', peerDeviceId: 'phone-1' },
              async (event, data) => {
                peerOneEvents.push({ event, data })
                if (event === 'codex.app.frame') {
                  throw new RpcError('RESPONSE_TOO_LARGE', 'Frame exceeds secure channel limit.')
                }
              },
            )!
            await peerOne.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: 'rejected-too-large' },
            })
            await flush()
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-2', delta: huge },
            })
            await flush()
            expect(peerOneEvents).toContainEqual({
              event: 'codex.app.stream.closed',
              data: { streamId: 'stream-1', reason: 'failed' },
            })
            await peerOne.closeAll()

            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-3', delta: huge },
            })
            app.emit({
              kind: 'notification',
              method: 'turn/completed',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
            })
            await flush()

            const peerTwoFrames: Array<{ event: string; data: unknown }> = []
            const peerTwo = domain.createPeer(
              { connectionId: 'conn-oversized-2', peerDeviceId: 'phone-1' },
              async (event, data) => { peerTwoFrames.push({ event, data }) },
            )!
            await peerTwo.openStream({ streamId: 'stream-2', threadId: 'allowed-thread' })
            expect(peerTwoFrames).toEqual([
              {
                event: 'codex.app.frame',
                data: {
                  streamId: 'stream-2',
                  frame: {
                    method: 'turn/completed',
                    params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
                  },
                },
              },
            ])
            await peerTwo.closeAll()
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'evicts oldest buffered threads beyond the 64-thread cap',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-old', delta: 'evicted' },
            })
            for (let index = 0; index < 64; index += 1) {
              app.emit({
                kind: 'notification',
                method: 'item/agentMessage/delta',
                params: { threadId: `thread-${index}`, itemId: `msg-${index}`, delta: `d-${index}` },
              })
            }
            await flush()
            const frames: unknown[] = []
            const peer = domain.createPeer(
              { connectionId: 'conn-lru', peerDeviceId: 'phone-1' },
              async (_event, data) => { frames.push(data) },
            )!
            await peer.openStream({ streamId: 'stream-lru', threadId: 'allowed-thread' })
            expect(frames).toHaveLength(0)
            await peer.closeAll()
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'prunes persisted turns and items after dsh/sessionHistory and thread/read while keeping unpersisted deltas and concurrent frames',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const original = app.call.bind(app)
          let historyMode: 'completed' | 'active' = 'completed'
          let emitDuringHistory: (() => void) | undefined
          vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
            if (method === 'thread/turns/list') {
              emitDuringHistory?.()
              emitDuringHistory = undefined
              if (historyMode === 'completed') {
                return {
                  data: [{
                    id: 'turn-1',
                    status: 'completed',
                    itemsView: 'full',
                    items: [
                      { id: 'user-1', type: 'userMessage', text: 'Hi' },
                      { id: 'msg-1', type: 'agentMessage', text: 'Done' },
                    ],
                  }],
                  nextCursor: null,
                  backwardsCursor: null,
                }
              }
              return {
                data: [
                  {
                    id: 'turn-1',
                    status: 'completed',
                    itemsView: 'full',
                    items: [{ id: 'user-1', type: 'userMessage', text: 'Old' }],
                  },
                  {
                    id: 'turn-2',
                    status: 'inProgress',
                    itemsView: 'full',
                    items: [{ id: 'user-2', type: 'userMessage', text: 'Now' }],
                  },
                ],
                nextCursor: null,
                backwardsCursor: null,
              }
            }
            return original(method, params)
          })
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            // Case A: completed turn persisted; frames < watermark cleared, concurrent frame >= watermark kept.
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'Done' },
            })
            app.emit({
              kind: 'notification',
              method: 'turn/completed',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
            })
            await flush()

            const peer = domain.createPeer(
              { connectionId: 'conn-dedup', peerDeviceId: 'phone-1' },
              async (event, data) => { received.push({ event, data }) },
            )!
            const received: Array<{ event: string; data: unknown }> = []

            emitDuringHistory = () => {
              app.emit({
                kind: 'notification',
                method: 'item/agentMessage/delta',
                params: { threadId: 'allowed-thread', turnId: 'turn-2', itemId: 'msg-2', delta: 'concurrent' },
              })
            }
            await peer.call({ method: 'dsh/sessionHistory', params: { threadId: 'allowed-thread' } })
            await peer.openStream({ streamId: 'stream-dedup-1', threadId: 'allowed-thread' })
            expect(received).toEqual([
              {
                event: 'codex.app.frame',
                data: {
                  streamId: 'stream-dedup-1',
                  frame: {
                    method: 'item/agentMessage/delta',
                    params: { threadId: 'allowed-thread', turnId: 'turn-2', itemId: 'msg-2', delta: 'concurrent' },
                  },
                },
              },
            ])
            await peer.closeStream({ streamId: 'stream-dedup-1' })
            received.length = 0

            // Case B: active turn keeps unpersisted streaming deltas while dropping completed turn, metadata, turn/started, and persisted items.
            historyMode = 'active'
            app.emit({
              kind: 'notification',
              method: 'thread/name/updated',
              params: { threadId: 'allowed-thread', threadName: 'Renamed' },
            })
            app.emit({
              kind: 'notification',
              method: 'turn/completed',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
            })
            app.emit({
              kind: 'notification',
              method: 'turn/started',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-2', status: 'inProgress', items: [] } },
            })
            app.emit({
              kind: 'notification',
              method: 'item/completed',
              params: { threadId: 'allowed-thread', turnId: 'turn-2', item: { id: 'user-2', type: 'userMessage', text: 'Now' } },
            })
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', turnId: 'turn-2', itemId: 'msg-live', delta: 'unpersisted' },
            })
            await flush()

            await peer.call({ method: 'dsh/sessionHistory', params: { threadId: 'allowed-thread' } })
            await peer.openStream({ streamId: 'stream-dedup-2', threadId: 'allowed-thread' })
            expect(received).toEqual([
              {
                event: 'codex.app.frame',
                data: {
                  streamId: 'stream-dedup-2',
                  frame: {
                    method: 'item/agentMessage/delta',
                    params: { threadId: 'allowed-thread', turnId: 'turn-2', itemId: 'msg-live', delta: 'unpersisted' },
                  },
                },
              },
            ])
            await peer.closeStream({ streamId: 'stream-dedup-2' })
            received.length = 0

            // Case C: thread/read(includeTurns:true) also prunes completed persisted frames.
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'assistant-1', delta: 'Second' },
            })
            await flush()
            await peer.call({ method: 'thread/read', params: { threadId: 'allowed-thread', includeTurns: true } })
            await peer.openStream({ streamId: 'stream-dedup-3', threadId: 'allowed-thread' })
            expect(received).toHaveLength(0)
            await peer.closeAll()
          } finally {
            vi.restoreAllMocks()
            await domain.close()
          }
        },
      },
      {
        name: 'preserves order without drops across high-frequency concurrent frames during replay and across multiple subscribers',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            for (let index = 0; index < 5; index += 1) {
              app.emit({
                kind: 'notification',
                method: 'item/agentMessage/delta',
                params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: `buf-${index}` },
              })
            }
            await flush()

            const singleDeltas: string[] = []
            let emittedLive = 0
            const peerOne = domain.createPeer(
              { connectionId: 'conn-burst-1', peerDeviceId: 'phone-1' },
              async (_event, data) => {
                if (isRecord(data) && isRecord(data.frame) && isRecord(data.frame.params)
                  && typeof data.frame.params.delta === 'string') {
                  singleDeltas.push(data.frame.params.delta)
                }
                if (emittedLive < 10) {
                  const nextLive = emittedLive++
                  app.emit({
                    kind: 'notification',
                    method: 'item/agentMessage/delta',
                    params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: `live-${nextLive}` },
                  })
                }
                await new Promise(resolve => setTimeout(resolve, 0))
              },
            )!
            await peerOne.openStream({ streamId: 'stream-burst-1', threadId: 'allowed-thread' })
            expect(singleDeltas).toEqual([
              'buf-0', 'buf-1', 'buf-2', 'buf-3', 'buf-4',
              'live-0', 'live-1', 'live-2', 'live-3', 'live-4',
              'live-5', 'live-6', 'live-7', 'live-8', 'live-9',
            ])

            // Multi-subscriber: peerOne is live while peerTwo opens with async replay;
            // live frames emitted mid-open must reach BOTH peers in order without loss.
            const peerOneMulti: string[] = []
            const peerTwoMulti: string[] = []
            await peerOne.closeAll()
            const subOne = domain.createPeer(
              { connectionId: 'conn-multi-1', peerDeviceId: 'phone-1' },
              async (_event, data) => {
                if (isRecord(data) && isRecord(data.frame) && isRecord(data.frame.params)
                  && typeof data.frame.params.delta === 'string') {
                  peerOneMulti.push(data.frame.params.delta)
                }
              },
            )!
            await subOne.openStream({ streamId: 'stream-multi-1', threadId: 'allowed-thread' })
            let releaseReplay!: () => void
            const replayGate = new Promise<void>(resolve => { releaseReplay = resolve })
            let replayStarted!: () => void
            const replayReady = new Promise<void>(resolve => { replayStarted = resolve })
            const originalReplay = domain.replayBufferedFrames.bind(domain)
            vi.spyOn(domain, 'replayBufferedFrames').mockImplementation(async (connectionId, streamId, threadId) => {
              replayStarted()
              await replayGate
              return originalReplay(connectionId, streamId, threadId)
            })
            const subTwo = domain.createPeer(
              { connectionId: 'conn-multi-2', peerDeviceId: 'phone-2' },
              async (_event, data) => {
                if (isRecord(data) && isRecord(data.frame) && isRecord(data.frame.params)
                  && typeof data.frame.params.delta === 'string') {
                  peerTwoMulti.push(data.frame.params.delta)
                }
              },
            )!
            const openingTwo = subTwo.openStream({ streamId: 'stream-multi-2', threadId: 'allowed-thread' })
            await replayReady
            for (let index = 0; index < 4; index += 1) {
              app.emit({
                kind: 'notification',
                method: 'item/agentMessage/delta',
                params: { threadId: 'allowed-thread', itemId: 'msg-m', delta: `multi-${index}` },
              })
            }
            await flush()
            releaseReplay()
            await openingTwo
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-m', delta: 'multi-after' },
            })
            await flush()
            expect(peerOneMulti).toEqual(['multi-0', 'multi-1', 'multi-2', 'multi-3', 'multi-after'])
            expect(peerTwoMulti).toEqual(['multi-0', 'multi-1', 'multi-2', 'multi-3', 'multi-after'])
            await subOne.closeAll()
            await subTwo.closeAll()
          } finally {
            vi.restoreAllMocks()
            await domain.close()
          }
        },
      },
      {
        name: 'blocks boundary-sized Codex frames that exceed MAX_SECURE_MESSAGE_BYTES once wrapped in RemoteMessage',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            const streamId = 'stream-boundary'
            const baseFrame = {
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-b', delta: '' },
            }
            const bareBaseBytes = Buffer.byteLength(JSON.stringify({ streamId, frame: baseFrame }))
            const boundaryDelta = 'x'.repeat(MAX_SECURE_MESSAGE_BYTES - bareBaseBytes - 60)
            const boundaryFrame = {
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-b', delta: boundaryDelta },
            }
            expect(Buffer.byteLength(JSON.stringify({ streamId, frame: boundaryFrame }))).toBeLessThanOrEqual(MAX_SECURE_MESSAGE_BYTES)
            expect(encodeMessage(createEvent('codex.app.frame', { streamId, frame: boundaryFrame })).byteLength).toBeGreaterThan(MAX_SECURE_MESSAGE_BYTES)

            const liveEvents: Array<{ event: string; data: unknown }> = []
            const peerOne = domain.createPeer(
              { connectionId: 'conn-boundary-1', peerDeviceId: 'phone-1' },
              async (event, data) => { liveEvents.push({ event, data }) },
            )!
            await peerOne.openStream({ streamId, threadId: 'allowed-thread' })
            app.emit({ kind: 'notification', ...boundaryFrame })
            await flush()
            expect(liveEvents).toEqual([
              { event: 'codex.app.stream.closed', data: { streamId, reason: 'failed' } },
            ])
            await peerOne.closeAll()

            app.emit({ kind: 'notification', ...boundaryFrame })
            app.emit({
              kind: 'notification',
              method: 'turn/completed',
              params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
            })
            await flush()

            const replayed: Array<{ event: string; data: unknown }> = []
            const peerTwo = domain.createPeer(
              { connectionId: 'conn-boundary-2', peerDeviceId: 'phone-1' },
              async (event, data) => { replayed.push({ event, data }) },
            )!
            await peerTwo.openStream({ streamId: 'stream-boundary-2', threadId: 'allowed-thread' })
            expect(replayed).toHaveLength(1)
            expect(replayed[0]).toMatchObject({
              event: 'codex.app.frame',
              data: { streamId: 'stream-boundary-2', frame: { method: 'turn/completed' } },
            })
            await peerTwo.closeAll()
          } finally {
            await domain.close()
          }
        },
      },
      {
        name: 'marks replayTruncated when older buffered frames expire by TTL while newer frames remain',
        run: async () => {
          const { root } = await directories()
          const app = new FakeAppServer(root)
          const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
          await domain.start()
          try {
            const baseNow = Date.now()
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow)
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: 'expired' },
            })
            nowSpy.mockReturnValue(baseNow + 4 * 60_000)
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', itemId: 'msg-1', delta: 'fresh' },
            })
            await flush()

            nowSpy.mockReturnValue(baseNow + 5 * 60_000 + 1)
            const frames: unknown[] = []
            const peer = domain.createPeer(
              { connectionId: 'conn-partial-ttl', peerDeviceId: 'phone-1' },
              async (_event, data) => { frames.push(data) },
            )!
            const opened = await peer.openStream({ streamId: 'stream-partial-ttl', threadId: 'allowed-thread' })
            expect(opened).toEqual({
              opened: true,
              streamId: 'stream-partial-ttl',
              threadId: 'allowed-thread',
              replayTruncated: true,
            })
            expect(frames).toHaveLength(1)
            await peer.closeAll()
          } finally {
            vi.restoreAllMocks()
            await domain.close()
          }
        },
      },
    ], cleanupScenario1)
  }, 20000)

  it('cleans up outgoingTransfers after reading the final chunk across sequential large Codex responses', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const largeText = 'a'.repeat(2_200_000)
    const original = app.call.bind(app)
    vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
      if (method === 'thread/read' && isRecord(params) && params.includeTurns === true) {
        return {
          thread: {
            id: 'allowed-thread',
            cwd: root,
            turns: [{ id: 'turn-big', status: 'completed', items: [{ id: 'a1', type: 'agentMessage', text: largeText }] }],
          },
        }
      }
      return original(method, params)
    })
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    const peer = domain.createPeer(
      { connectionId: 'conn-transfer', peerDeviceId: 'phone-1' },
      async () => undefined,
    )!
    try {
      const requestBytes = new TextEncoder().encode(JSON.stringify({
        method: 'thread/read',
        params: { threadId: 'allowed-thread', includeTurns: true },
      }))
      const totalRequestChunks = Math.ceil(requestBytes.byteLength / CODEX_APP_TRANSFER_CHUNK_BYTES)
      for (let round = 0; round < 4; round += 1) {
        const transferId = randomUUID()
        peer.openTransfer({ transferId, totalBytes: requestBytes.byteLength, totalChunks: totalRequestChunks })
        for (let index = 0; index < totalRequestChunks; index += 1) {
          const start = index * CODEX_APP_TRANSFER_CHUNK_BYTES
          const end = Math.min(start + CODEX_APP_TRANSFER_CHUNK_BYTES, requestBytes.byteLength)
          peer.appendTransfer({
            transferId,
            index,
            data: Buffer.from(requestBytes.subarray(start, end)).toString('base64'),
          })
        }
        const committed = await peer.commitTransfer({ transferId })
        expect(committed.kind).toBe('chunked')
        if (committed.kind !== 'chunked') throw new Error('expected chunked response')
        const parts: Uint8Array[] = []
        for (let index = 0; index < committed.totalChunks; index += 1) {
          const chunk = peer.readTransfer({ transferId, index })
          parts.push(Buffer.from(chunk.data, 'base64'))
        }
        const decoded = JSON.parse(Buffer.concat(parts).toString('utf8')) as {
          thread: { turns: Array<{ items: Array<{ text: string }> }> }
        }
        expect(decoded.thread.turns[0]!.items[0]!.text.length).toBe(largeText.length)
        if (round === 3) {
          expect(peer.closeTransfer({ transferId })).toEqual({ closed: false, transferId })
        }
      }
    } finally {
      vi.restoreAllMocks()
      await peer.closeAll()
      await domain.close()
    }
  }, 15000)

  it('bounds >4 MiB dsh/sessionHistory responses below MAX_SECURE_MESSAGE_BYTES and fails closed with non-retryable RESPONSE_TOO_LARGE on un-compactable envelopes', async () => {
    const { root } = await directories()
    const hugeText = 'r'.repeat(4 * 1024 * 1024 + 64 * 1024)
    const app = new FakeAppServer(root)
    const originalCall = app.call.bind(app)
    let oversizeEnvelope = false
    vi.spyOn(app, 'call').mockImplementation(async (method, params) => {
      if (method === 'thread/turns/list') {
        throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'turn pagination unsupported')
      }
      if (method === 'thread/read' && isRecord(params) && params.includeTurns === true) {
        return {
          thread: {
            id: 'allowed-thread',
            projectId: 'allowed-project',
            cwd: root,
            ...(oversizeEnvelope ? { model: 'M'.repeat(MAX_SECURE_MESSAGE_BYTES) } : {}),
            createdAt: 1,
            updatedAt: 2,
            turns: [
              {
                id: 'turn-1',
                status: 'completed',
                createdAt: 1,
                items: [
                  { id: 'u-1', type: 'userMessage', content: [{ type: 'text', text: 'First prompt' }] },
                  { id: 'a-1', type: 'agentMessage', text: 'First reply', status: 'completed' },
                ],
              },
              {
                id: 'turn-2',
                status: 'inProgress',
                createdAt: 2,
                items: [
                  { id: 'u-2', type: 'userMessage', content: [{ type: 'text', text: 'Giant prompt' }] },
                  { id: 'a-2', type: 'agentMessage', text: hugeText, status: 'inProgress' },
                ],
              },
            ],
          },
        }
      }
      return originalCall(method, params)
    })

    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    try {
      const first = await domain.call('connection-1', {
        method: 'dsh/sessionHistory',
        params: { threadId: 'allowed-thread', maxMessages: 50 },
      }) as {
        records: Array<{ event: { seq: number; data: Record<string, unknown> } }>
        hasMore: boolean
        cursor: number
      }
      expect(first.records).toHaveLength(1)
      expect(first.hasMore).toBe(true)
      expect(first.records[0]!.event.data.truncated).toBe(true)

      const rpcBytes = encodeMessage(createRpcResponse('req-domain-4m', first))
      expect(rpcBytes.byteLength).toBeLessThanOrEqual(MAX_SECURE_MESSAGE_BYTES)
      expect(() => new SecureMessageCodec().encode(rpcBytes)).not.toThrow()

      const older = await domain.call('connection-1', {
        method: 'dsh/sessionHistory',
        params: { threadId: 'allowed-thread', beforeSeq: first.records[0]!.event.seq, maxMessages: 50 },
      }) as {
        records: Array<{ event: { seq: number } }>
        hasMore: boolean
      }
      expect(older.hasMore).toBe(false)
      expect(older.records.length).toBeGreaterThan(0)
      expect(older.records.every(entry => entry.event.seq < first.records[0]!.event.seq)).toBe(true)

      oversizeEnvelope = true
      await expect(domain.call('connection-1', {
        method: 'dsh/sessionHistory',
        params: { threadId: 'allowed-thread', maxMessages: 50 },
      })).rejects.toMatchObject({
        code: 'RESPONSE_TOO_LARGE',
        retryable: false,
      })
    } finally {
      await domain.close()
    }
  })

  it('serializes inbound frames per thread without blocking other threads', async () => {
    const { root, outside } = await directories()
    const app = new FakeAppServer(root, outside)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    let markThreadAEntered!: () => void
    const threadAEntered = new Promise<void>(resolve => { markThreadAEntered = resolve })
    let releaseThreadA!: () => void
    const threadAGate = new Promise<void>(resolve => { releaseThreadA = resolve })
    const framesA: string[] = []
    const framesB: string[] = []
    const peer = domain.createPeer(
      { connectionId: 'conn-1', peerDeviceId: 'peer-1' },
      async (event, data) => {
        if (event !== 'codex.app.frame' || !isRecord(data) || !isRecord(data.frame) || typeof data.frame.method !== 'string') return
        if (data.streamId === 'stream-a') {
          framesA.push(data.frame.method)
          if (data.frame.method === 'turn/started') {
            markThreadAEntered()
            await threadAGate
          }
        }
        if (data.streamId === 'stream-b') {
          framesB.push(data.frame.method)
        }
      },
    )!
    const rival = domain.createPeer(
      { connectionId: 'conn-2', peerDeviceId: 'peer-2' },
      async () => undefined,
    )!
    try {
      await peer.openStream({ streamId: 'stream-a', threadId: 'allowed-thread' })
      await peer.openStream({ streamId: 'stream-b', threadId: 'outside-thread' })
      await peer.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Thread A' }] },
      })

      app.emit({
        kind: 'notification',
        method: 'turn/started',
        params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'inProgress', items: [] } },
      })
      app.emit({
        kind: 'notification',
        method: 'item/agentMessage/delta',
        params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'part' },
      })
      app.emit({
        kind: 'notification',
        method: 'turn/completed',
        params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
      })

      await threadAEntered
      await flush()
      // Thread A must stay ordered at turn/started while publish is blocked:
      // turn/completed cannot overtake item/agentMessage/delta or release the writer lease early.
      expect(framesA).toEqual(['turn/started'])
      await expect(rival.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Compete' }] },
      })).rejects.toMatchObject({ code: 'CODEX_TURN_OWNED' })

      app.emit({
        kind: 'notification',
        method: 'turn/started',
        params: { threadId: 'outside-thread', turn: { id: 'turn-b', status: 'inProgress', items: [] } },
      })
      app.emit({
        kind: 'notification',
        method: 'item/agentMessage/delta',
        params: { threadId: 'outside-thread', turnId: 'turn-b', itemId: 'msg-b', delta: 'fast' },
      })
      await vi.waitFor(() => {
        expect(framesB).toEqual(['turn/started', 'item/agentMessage/delta'])
      })
      expect(framesA).toEqual(['turn/started'])

      releaseThreadA()
      await vi.waitFor(() => {
        expect(framesA).toEqual(['turn/started', 'item/agentMessage/delta', 'turn/completed'])
      })
      await expect(rival.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'After A' }] },
      })).resolves.toMatchObject({ turn: { id: 'turn-1' } })
    } finally {
      releaseThreadA?.()
      await domain.close()
    }
  })

  it('publishes permission updates from turn/start inside threadLifecycle.use without deadlocking a busy inbound queue', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    let markDeltaBlocked!: () => void
    const deltaBlocked = new Promise<void>(resolve => { markDeltaBlocked = resolve })
    let releaseDelta!: () => void
    const deltaGate = new Promise<void>(resolve => { releaseDelta = resolve })
    const frames: Array<{ method: string; params: unknown }> = []
    const peer = domain.createPeer(
      { connectionId: 'conn-1', peerDeviceId: 'peer-1' },
      async (event, data) => {
        if (event !== 'codex.app.frame' || !isRecord(data) || !isRecord(data.frame) || typeof data.frame.method !== 'string') return
        frames.push({ method: data.frame.method, params: data.frame.params })
        if (data.frame.method === 'item/agentMessage/delta') {
          markDeltaBlocked()
          await deltaGate
        }
      },
    )!
    try {
      await peer.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
      app.emit({
        kind: 'notification',
        method: 'item/agentMessage/delta',
        params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'in-flight' },
      })
      await deltaBlocked

      await expect(peer.call({
        method: 'turn/start',
        params: {
          threadId: 'allowed-thread',
          input: [{ type: 'text', text: 'Apply preset' }],
          permissionPreset: 'danger-full-access',
        },
      })).resolves.toMatchObject({ turn: { id: 'turn-1' } })

      expect(frames).toContainEqual({
        method: 'thread/settings/updated',
        params: {
          threadId: 'allowed-thread',
          threadSettings: {
            approvalPolicy: 'never',
            sandboxPolicy: { type: 'dangerFullAccess' },
          },
        },
      })
      await expect(peer.call({
        method: 'dsh/sessionHistory',
        params: { threadId: 'allowed-thread' },
      })).resolves.toMatchObject({ permissionPreset: 'danger-full-access' })
    } finally {
      releaseDelta?.()
      await domain.close()
    }
  })

  it('preserves recentFrames on thread/unsubscribe while another peer stays subscribed and clears on last subscriber', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
    await domain.start()
    let failPeer1 = true
    let failPeer2 = false
    const peer1 = domain.createPeer(
      { connectionId: 'conn-1', peerDeviceId: 'peer-1' },
      async event => { if (failPeer1 && event === 'codex.app.frame') throw new Error('peer1 transient error') },
    )!
    const peer2 = domain.createPeer(
      { connectionId: 'conn-2', peerDeviceId: 'peer-2' },
      async event => { if (failPeer2 && event === 'codex.app.frame') throw new Error('peer2 transient error') },
    )!
    const replayed: Array<{ streamId: unknown; method: unknown; delta: unknown }> = []
    const peer3 = domain.createPeer(
      { connectionId: 'conn-3', peerDeviceId: 'peer-3' },
      async (event, data) => {
        if (event === 'codex.app.frame' && isRecord(data) && isRecord(data.frame)) {
          replayed.push({
            streamId: data.streamId,
            method: data.frame.method,
            delta: isRecord(data.frame.params) ? data.frame.params.delta : undefined,
          })
        }
      },
    )!
    try {
      await peer1.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
      await peer2.openStream({ streamId: 'stream-2', threadId: 'allowed-thread' })

      app.emit({
        kind: 'notification',
        method: 'item/agentMessage/delta',
        params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'keep-while-peer2-subscribed' },
      })
      await flush()

      await peer1.call({ method: 'thread/unsubscribe', params: { threadId: 'allowed-thread' } })
      expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(0)

      await peer3.openStream({ streamId: 'stream-3', threadId: 'allowed-thread' })
      expect(replayed).toContainEqual({
        streamId: 'stream-3',
        method: 'item/agentMessage/delta',
        delta: 'keep-while-peer2-subscribed',
      })

      await peer3.closeStream({ streamId: 'stream-3' })
      replayed.length = 0
      failPeer1 = false
      failPeer2 = true
      app.emit({
        kind: 'notification',
        method: 'item/agentMessage/delta',
        params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'drop-on-last-unsub' },
      })
      await flush()

      await peer2.call({ method: 'thread/unsubscribe', params: { threadId: 'allowed-thread' } })
      expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)

      await peer3.openStream({ streamId: 'stream-4', threadId: 'allowed-thread' })
      expect(replayed).toHaveLength(0)
    } finally {
      await domain.close()
    }
  })

  it('pauses the turn silence watchdog while an approval is pending and resumes it after settlement', async () => {
    const { root } = await directories()
    const app = new FakeAppServer(root)
    const domain = new CodexRemoteDomain(
      { enabled: true, binary: 'codex' },
      logger(),
      () => app,
      [1_000],
      100,
    )
    vi.useFakeTimers()
    try {
      await domain.start()
      const frames: Array<{ event: string; data: unknown }> = []
      const owner = domain.createPeer(
        { connectionId: 'conn-1', peerDeviceId: 'peer-1' },
        async (event, data) => { frames.push({ event, data }) },
      )!
      const rival = domain.createPeer(
        { connectionId: 'conn-2', peerDeviceId: 'peer-2' },
        async () => undefined,
      )!
      await owner.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
      await owner.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Run command' }] },
      })

      await vi.advanceTimersByTimeAsync(60)
      app.emit({
        kind: 'request',
        id: 55,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: 'allowed-thread',
          turnId: 'turn-1',
          itemId: 'item-1',
          command: 'pnpm test',
        },
      })
      await vi.advanceTimersByTimeAsync(0)
      const approvalEntry = frames.find(entry => entry.event === 'codex.app.frame'
        && isRecord(entry.data)
        && isRecord(entry.data.frame)
        && entry.data.frame.method === 'item/commandExecution/requestApproval')
      expect(approvalEntry).toBeDefined()

      // Watchdog stays paused for the entire approval wait (well past the 100ms silence timeout).
      await vi.advanceTimersByTimeAsync(250)
      expect(frames.some(entry => entry.event === 'codex.app.frame'
        && isRecord(entry.data)
        && isRecord(entry.data.frame)
        && entry.data.frame.method === 'turn/completed')).toBe(false)
      expect(app.responses).toEqual([])
      await expect(rival.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Compete' }] },
      })).rejects.toMatchObject({ code: 'CODEX_TURN_OWNED' })

      // Once the approval settles, the silence watchdog resumes and fires after 100ms of silence.
      const requestHandle = extractRequestHandle(approvalEntry!.data)
      await owner.respond({ requestHandle, decision: 'accept' })
      expect(app.responses).toContainEqual({ id: 55, result: { decision: 'accept' } })

      await vi.advanceTimersByTimeAsync(110)
      const completed = frames.find(entry => entry.event === 'codex.app.frame'
        && isRecord(entry.data)
        && isRecord(entry.data.frame)
        && entry.data.frame.method === 'turn/completed')
      expect(completed?.data).toMatchObject({
        frame: {
          method: 'turn/completed',
          params: {
            turn: {
              status: 'failed',
              error: { codex_error_info: 'remote_turn_silence' },
            },
          },
        },
      })
      await expect(rival.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Retry' }] },
      })).resolves.toMatchObject({ turn: { id: 'turn-1' } })
    } finally {
      await domain.close()
      vi.useRealTimers()
    }
  })

  it('deletes pending approvals and forwards serverRequest/resolved with requestHandle even when threadId is omitted', async () => {
    await runScenarios(['queued-behind-request', 'after-request-settled'].map(mode => ({
      name: mode,
      run: async () => {
        const { root } = await directories()
        const app = new FakeAppServer(root)
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        const frames: Array<{ streamId: unknown; method: unknown; params: unknown }> = []
        const owner = domain.createPeer(
          { connectionId: 'conn-1', peerDeviceId: 'peer-1' },
          async (event, data) => {
            if (event === 'codex.app.frame' && isRecord(data) && isRecord(data.frame)) {
              frames.push({ streamId: data.streamId, method: data.frame.method, params: data.frame.params })
            }
          },
        )!
        try {
          await owner.openStream({ streamId: 'stream-1', threadId: 'allowed-thread' })
          await owner.call({
            method: 'turn/start',
            params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'Approve externally' }] },
          })
          app.emit({
            kind: 'request',
            id: 77,
            method: 'item/commandExecution/requestApproval',
            params: {
              threadId: 'allowed-thread',
              turnId: 'turn-1',
              itemId: 'item-1',
              command: 'pnpm test',
            },
          })
          if (mode === 'after-request-settled') await flush()
          app.emit({
            kind: 'notification',
            method: 'serverRequest/resolved',
            params: { requestId: 77 },
          })
          await flush()

          const approval = frames.find(frame => frame.method === 'item/commandExecution/requestApproval')
          expect(approval).toBeDefined()
          const requestHandle = extractRequestHandle({ frame: approval })
          const resolved = frames.find(frame => frame.method === 'serverRequest/resolved')
          expect(resolved).toEqual({
            streamId: 'stream-1',
            method: 'serverRequest/resolved',
            params: {
              requestId: 77,
              threadId: 'allowed-thread',
              requestHandle,
            },
          })
          await expect(owner.respond({ requestHandle, decision: 'accept' })).rejects.toMatchObject({
            code: 'CODEX_APPROVAL_NOT_FOUND',
          })
          expect(app.responses).toEqual([])

          app.emit({
            kind: 'notification',
            method: 'turn/completed',
            params: { threadId: 'allowed-thread', turn: { id: 'turn-1', status: 'completed', items: [] } },
          })
          await flush()
          await owner.closeStream({ streamId: 'stream-1' })
          expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
        } finally {
          await domain.close()
        }
      },
    })), cleanupScenario1)
  })

  it('applies cold-start failure retry policy and enforces tryRecoverOnDemand cooldown', async () => {
    await runScenarios([
      {
        name: 'transient startup error schedules background restart and recovers',
        run: async () => {
          const { root } = await directories()
          const failing = new FakeAppServer(root)
          failing.start = vi.fn(async () => { throw new CodexAppServerError('CODEX_START_FAILED', 'temporary') })
          const healthy = new FakeAppServer(root)
          const create = vi.fn()
            .mockReturnValueOnce(failing)
            .mockReturnValueOnce(healthy)
          const domain = new CodexRemoteDomain({ enabled: true, binary: '/test/codex' }, logger(), create, [50], undefined, 5_000)
          vi.useFakeTimers()
          try {
            await domain.start()
            expect(domain.status()).toEqual({
              enabled: true,
              available: false,
              state: 'restarting',
              restartAttempt: 1,
              error: 'CODEX_START_FAILED',
            })
            domain.tryRecoverOnDemand()
            expect(create).toHaveBeenCalledTimes(1)

            await vi.advanceTimersByTimeAsync(49)
            expect(create).toHaveBeenCalledTimes(1)
            expect(domain.status().state).toBe('restarting')

            await vi.advanceTimersByTimeAsync(1)
            expect(create).toHaveBeenCalledTimes(2)
            expect(domain.status()).toEqual({
              enabled: true,
              available: true,
              state: 'ready',
              restartAttempt: 0,
            })
          } finally {
            await domain.close()
            vi.useRealTimers()
          }
        },
      },
      {
        name: 'CODEX_BINARY_UNAVAILABLE fails straight to unavailable without scheduling restart',
        run: async () => {
          const { root } = await directories()
          const missing = new FakeAppServer(root)
          missing.start = vi.fn(async () => { throw new CodexAppServerError('CODEX_BINARY_UNAVAILABLE', 'missing binary') })
          const create = vi.fn(() => missing)
          const domain = new CodexRemoteDomain({ enabled: true, binary: '/test/codex' }, logger(), create, [50], undefined, 5_000)
          vi.useFakeTimers()
          try {
            await domain.start()
            expect(domain.status()).toEqual({
              enabled: true,
              available: false,
              state: 'unavailable',
              restartAttempt: 0,
              error: 'CODEX_BINARY_UNAVAILABLE',
            })
            await vi.advanceTimersByTimeAsync(1_000)
            expect(create).toHaveBeenCalledTimes(1)
          } finally {
            await domain.close()
            vi.useRealTimers()
          }
        },
      },
      {
        name: 'CODEX_AUTH_REQUIRED fails straight to unavailable without scheduling restart',
        run: async () => {
          const { root } = await directories()
          const signedOut = new FakeAppServer(root)
          const originalCall = signedOut.call.bind(signedOut)
          signedOut.call = async (method, params) => method === 'account/read'
            ? { account: null, requiresOpenaiAuth: true }
            : originalCall(method, params)
          const create = vi.fn(() => signedOut)
          const domain = new CodexRemoteDomain({ enabled: true, binary: '/test/codex' }, logger(), create, [50], undefined, 5_000)
          vi.useFakeTimers()
          try {
            await domain.start()
            expect(domain.status()).toEqual({
              enabled: true,
              available: false,
              state: 'unavailable',
              restartAttempt: 0,
              error: 'CODEX_AUTH_REQUIRED',
            })
            await vi.advanceTimersByTimeAsync(1_000)
            expect(create).toHaveBeenCalledTimes(1)
          } finally {
            await domain.close()
            vi.useRealTimers()
          }
        },
      },
      {
        name: 'tryRecoverOnDemand is ignored during cooldown and recovers once cooldown elapses',
        run: async () => {
          const { root } = await directories()
          const fail1 = new FakeAppServer(root)
          fail1.start = vi.fn(async () => { throw new CodexAppServerError('CODEX_START_FAILED', 'fail-1') })
          const fail2 = new FakeAppServer(root)
          fail2.start = vi.fn(async () => { throw new CodexAppServerError('CODEX_START_FAILED', 'fail-2') })
          const healthy = new FakeAppServer(root)
          const create = vi.fn()
            .mockReturnValueOnce(fail1)
            .mockReturnValueOnce(fail2)
            .mockReturnValueOnce(healthy)
          const domain = new CodexRemoteDomain({ enabled: true, binary: '/test/codex' }, logger(), create, [50], undefined, 5_000)
          vi.useFakeTimers()
          try {
            await domain.start()
            await vi.advanceTimersByTimeAsync(50)
            expect(create).toHaveBeenCalledTimes(2)
            expect(domain.status()).toEqual({
              enabled: true,
              available: false,
              state: 'unavailable',
              restartAttempt: 1,
              error: 'CODEX_START_FAILED',
            })

            domain.tryRecoverOnDemand()
            await vi.advanceTimersByTimeAsync(0)
            expect(create).toHaveBeenCalledTimes(2)

            await vi.advanceTimersByTimeAsync(4_999)
            domain.tryRecoverOnDemand()
            await vi.advanceTimersByTimeAsync(0)
            expect(create).toHaveBeenCalledTimes(2)

            await vi.advanceTimersByTimeAsync(1)
            domain.tryRecoverOnDemand()
            await vi.advanceTimersByTimeAsync(0)
            expect(create).toHaveBeenCalledTimes(3)
            expect(domain.isAvailable()).toBe(true)
            expect(domain.status()).toEqual({
              enabled: true,
              available: true,
              state: 'ready',
              restartAttempt: 0,
            })
          } finally {
            await domain.close()
            vi.useRealTimers()
          }
        },
      },
    ], cleanupScenario1)
  })

  it('cancels in-flight openStream cleanly on closeStream and closeAll without leaking subscriptions or transfers', async () => {
    await runScenarios(['closeStream', 'closeStream-reuse', 'removeThreadSubscriptions', 'closeAll'].map(scenario => ({
      name: scenario,
      run: async () => {
        const { root, outside } = await directories()
        const app = new FakeAppServer(root, outside)
        const originalCall = app.call.bind(app)
        let holdThreadReadAt = 0
        let threadReadCount = 0
        let markReadInFlight!: () => void
        let readInFlight = new Promise<void>(resolve => { markReadInFlight = resolve })
        let releaseRead: (() => void) | undefined
        app.call = async (method, params) => {
          if (method === 'thread/read') {
            threadReadCount += 1
            if (holdThreadReadAt > 0 && threadReadCount === holdThreadReadAt) {
              holdThreadReadAt = 0
              const gate = new Promise<void>(resolve => { releaseRead = resolve })
              markReadInFlight()
              await gate
            }
          }
          return originalCall(method, params)
        }
        const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, logger(), () => app)
        await domain.start()
        const published: Array<{ event: string; data: unknown }> = []
        const peer = domain.createPeer(
          { connectionId: 'conn-1', peerDeviceId: 'peer-1' },
          async (event, data) => { published.push({ event, data }) },
        )!
        try {
          if (scenario === 'closeAll') {
            await peer.openStream({ streamId: 'stream-live', threadId: 'outside-thread' })
          }
          const transferId = randomUUID()
          if (scenario === 'closeAll') {
            peer.openTransfer({ transferId, totalBytes: 4, totalChunks: 1 })
          }

          threadReadCount = 0
          holdThreadReadAt = scenario === 'removeThreadSubscriptions' ? 2 : 1
          const firstOpen = peer.openStream({ streamId: 'stream-race', threadId: 'allowed-thread' })
          await readInFlight
          await expect(peer.openStream({ streamId: 'stream-race', threadId: 'allowed-thread' })).rejects.toMatchObject({
            code: 'REQUEST_CONFLICT',
          })

          if (scenario === 'closeStream' || scenario === 'removeThreadSubscriptions') {
            const unsubscribe = scenario === 'removeThreadSubscriptions'
              ? peer.call({ method: 'thread/unsubscribe', params: { threadId: 'allowed-thread' } })
              : undefined
            if (scenario === 'closeStream') {
              await peer.closeStream({ streamId: 'stream-race' })
            } else {
              await flush()
            }
            releaseRead?.()
            await expect(firstOpen).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CLOSED' })
            if (unsubscribe !== undefined) await unsubscribe
            expect(peer.hasThreadSubscription('allowed-thread')).toBe(false)
            app.emit({
              kind: 'notification',
              method: 'item/agentMessage/delta',
              params: { threadId: 'allowed-thread', turnId: 'turn-1', itemId: 'msg-1', delta: 'no-subscriber' },
            })
            await flush()
            expect(published).toEqual([])
          } else if (scenario === 'closeStream-reuse') {
            await peer.closeStream({ streamId: 'stream-race' })
            const secondOpen = peer.openStream({ streamId: 'stream-race', threadId: 'allowed-thread' })
            await peer.closeStream({ streamId: 'stream-race' })
            releaseRead?.()
            await expect(firstOpen).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CLOSED' })
            await expect(secondOpen).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CLOSED' })
            expect(peer.hasThreadSubscription('allowed-thread')).toBe(false)

            // Reusing the same streamId afterwards succeeds cleanly.
            const reopened = await peer.openStream({ streamId: 'stream-race', threadId: 'allowed-thread' })
            expect(reopened).toEqual({ opened: true, streamId: 'stream-race', threadId: 'allowed-thread' })
            await peer.closeStream({ streamId: 'stream-race' })
            expect(peer.hasThreadSubscription('allowed-thread')).toBe(false)
          } else {
            await peer.closeAll()
            releaseRead?.()
            await expect(firstOpen).rejects.toMatchObject({ code: 'CODEX_CONNECTION_CLOSED' })
            await flush()
            expect(peer.hasThreadSubscription('allowed-thread')).toBe(false)
            expect(peer.hasThreadSubscription('outside-thread')).toBe(false)
            expect(published).toEqual([{
              event: 'codex.app.stream.closed',
              data: { streamId: 'stream-live', reason: 'peer-disconnected' },
            }])
            expect(peer.closeTransfer({ transferId })).toEqual({ closed: false, transferId })
            await expect(peer.openStream({ streamId: 'stream-after', threadId: 'allowed-thread' })).rejects.toMatchObject({
              code: 'CODEX_CONNECTION_CLOSED',
            })
            expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(1)
          }
        } finally {
          releaseRead?.()
          await domain.close()
        }
      },
    })), cleanupScenario1)
  })

  it('isolates reconfigure from in-flight cold-start retries, stale restartAfterFailure attempts, and on-demand recovery', async () => {
    await runScenarios([
      'cold-start-failure-during-reconfigure',
      'restartAfterFailure-in-flight-during-reconfigure',
      'tryRecoverOnDemand-during-reconfigure-cleanup',
    ].map(scenario => ({
      name: scenario,
      run: async () => {
        const { root, outside } = await directories()
        const created: Array<{
          app: CodexAppServerLike
          emitUnavailable?: (code: string) => void
          closeSpy: ReturnType<typeof vi.fn>
          failNextStart?: (error: Error) => void
        }> = []
        let holdStart = scenario === 'cold-start-failure-during-reconfigure'
        let releaseStreamClose: (() => void) | undefined
        const domain = new CodexRemoteDomain(
          { enabled: true, binary: 'codex' },
          logger(),
          () => {
            const index = created.length
            const delegate = new FakeAppServer(root, outside)
            let ready = false
            let rejectStart: ((error: Error) => void) | undefined
            let unsubUnavailable: CodexAppServerUnavailableHandler | undefined
            const closeSpy = vi.fn(async () => {
              ready = false
              if (scenario !== 'cold-start-failure-during-reconfigure') {
                rejectStart?.(new CodexAppServerError('CODEX_CLOSED', 'closed'))
                rejectStart = undefined
              }
              await delegate.close()
            })
            const wrapped: CodexAppServerLike = {
              start: async () => {
                if (holdStart || (scenario === 'restartAfterFailure-in-flight-during-reconfigure' && index === 1)) {
                  await new Promise<void>((_resolve, reject) => { rejectStart = reject })
                }
                await delegate.start()
                ready = true
              },
              isReady: () => ready,
              call: (method, params) => delegate.call(method, params),
              respond: (id, result) => delegate.respond(id, result),
              respondError: (id, code, message) => delegate.respondError(id, code, message),
              onInbound: handler => delegate.onInbound(handler),
              onUnavailable: handler => {
                unsubUnavailable = handler
                return () => { if (unsubUnavailable === handler) unsubUnavailable = undefined }
              },
              close: closeSpy,
            }
            created.push({
              app: wrapped,
              closeSpy,
              emitUnavailable: code => unsubUnavailable?.(code),
              failNextStart: error => {
                rejectStart?.(error)
                rejectStart = undefined
              },
            })
            return wrapped
          },
          [20, 40],
          0,
          0,
        )
        try {
          if (scenario === 'cold-start-failure-during-reconfigure') {
            const firstStart = domain.start()
            await flush()
            expect(created).toHaveLength(1)
            holdStart = false
            const reconfig = domain.reconfigure({ enabled: true, binary: 'codex-v2' })
            // Wait for old appServer to close (or reject with transient error) as reconfigure takes over
            created[0]!.failNextStart?.(new CodexAppServerError('CODEX_START_FAILED', 'transient'))
            await Promise.all([firstStart, reconfig])
            await new Promise(resolve => setTimeout(resolve, 60))
            expect(created).toHaveLength(2)
            expect(domain.isAvailable()).toBe(true)
            expect(domain.status().state).toBe('ready')
            expect(created[1]!.closeSpy).not.toHaveBeenCalled()
          } else if (scenario === 'restartAfterFailure-in-flight-during-reconfigure') {
            await domain.start()
            expect(created).toHaveLength(1)
            created[0]!.emitUnavailable?.('CODEX_EXITED')
            await flush()
            await new Promise(resolve => setTimeout(resolve, 35))
            // Second attempt (restartAfterFailure) is now paused in app2.start()
            expect(created).toHaveLength(2)
            await domain.reconfigure({ enabled: true, binary: 'codex-v2' })
            expect(created).toHaveLength(3)
            expect(domain.isAvailable()).toBe(true)
            // Even if app2 rejects after reconfigure (e.g. close race), app3 must stay ready
            created[1]!.failNextStart?.(new CodexAppServerError('CODEX_CLOSED', 'closed late'))
            await new Promise(resolve => setTimeout(resolve, 60))
            expect(created).toHaveLength(3)
            expect(domain.isAvailable()).toBe(true)
            expect(domain.status().state).toBe('ready')
            expect(created[2]!.closeSpy).not.toHaveBeenCalled()
          } else {
            await domain.start()
            let markStreamClosePaused!: () => void
            const streamClosePaused = new Promise<void>(resolve => { markStreamClosePaused = resolve })
            const peer = domain.createPeer(
              { connectionId: 'conn-reconfig', peerDeviceId: 'peer-reconfig' },
              async (event) => {
                if (event === 'codex.app.stream.closed') {
                  markStreamClosePaused()
                  await new Promise<void>(resolve => { releaseStreamClose = resolve })
                }
              },
            )!
            await peer.openStream({ streamId: 's-reconfig', threadId: 'allowed-thread' })
            const reconfig = domain.reconfigure({ enabled: true, binary: 'codex-v2' })
            await streamClosePaused
            expect(domain.status().state).toBe('starting')
            domain.tryRecoverOnDemand()
            await flush()
            expect(created).toHaveLength(1)
            releaseStreamClose?.()
            await reconfig
            expect(created).toHaveLength(2)
            expect(domain.isAvailable()).toBe(true)
            expect(domain.status().state).toBe('ready')
            expect(created[1]!.closeSpy).not.toHaveBeenCalled()
          }
        } finally {
          releaseStreamClose?.()
          for (const entry of created) entry.failNextStart?.(new CodexAppServerError('CODEX_CLOSED', 'cleanup'))
          await domain.close()
        }
      },
    })), cleanupScenario1)
  })

  it('expires stale approvals inside inbound requests without deadlocking thread/closed on the same thread', async () => {
    const { root, outside } = await directories()
    const app = new FakeAppServer(root, outside)
    const log = logger()
    const domain = new CodexRemoteDomain({ enabled: true, binary: 'codex' }, log, () => app)
    await domain.start()
    const peer = domain.createPeer(
      { connectionId: 'conn-1', peerDeviceId: 'peer-1' },
      async () => undefined,
    )!
    let nowSpy: ReturnType<typeof vi.spyOn> | undefined
    try {
      const baseNow = Date.now()
      nowSpy = vi.spyOn(Date, 'now').mockReturnValue(baseNow)
      await peer.openStream({ streamId: 's-1', threadId: 'allowed-thread' })
      await peer.call({
        method: 'turn/start',
        params: { threadId: 'allowed-thread', input: [{ type: 'text', text: 'run command' }] },
      })
      app.emit({ kind: 'notification', method: 'turn/started', params: { threadId: 'allowed-thread', turn: { id: 'turn-1' } } })
      app.emit({
        kind: 'request',
        id: 91,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'allowed-thread', itemId: 'cmd-1', command: 'echo 1' },
      })
      await flush()

      // Finish turn and unsubscribe stream while expired approval #91 keeps thread retained.
      app.emit({ kind: 'notification', method: 'turn/completed', params: { threadId: 'allowed-thread', turn: { id: 'turn-1' } } })
      await flush()
      await peer.closeStream({ streamId: 's-1' })
      expect(app.calls.filter(call => call.method === 'thread/unsubscribe')).toHaveLength(0)

      // Advance clock past TTL without letting the background timer trigger first,
      // then deliver a new inbound request on the same thread.
      nowSpy.mockReturnValue(baseNow + 5 * 60_000 + 1)
      app.emit({
        kind: 'request',
        id: 92,
        method: 'item/commandExecution/requestApproval',
        params: { threadId: 'allowed-thread', itemId: 'cmd-2', command: 'echo 2' },
      })
      await vi.waitFor(() => {
        expect(app.responses.some(res => res.id === 91)).toBe(true)
        expect(app.responses.some(res => res.id === 92)).toBe(true)
        expect(app.calls.some(call => call.method === 'thread/unsubscribe')).toBe(true)
      }, { timeout: 1_500 })
      await flush()
      expect(log.warn).not.toHaveBeenCalled()
    } finally {
      nowSpy?.mockRestore()
      await domain.close()
    }
  })
})

class FakeAppServer implements CodexAppServerLike {
  private handler?: CodexAppServerInboundHandler
  private unavailableHandler?: CodexAppServerUnavailableHandler
  private ready = false
  readonly responses: Array<{ id: string | number; result?: unknown; error?: unknown }> = []
  readonly calls: Array<{ method: string; params: unknown }> = []
  rejectResume = false
  resumeRolloutMissing = false
  rejectTurnPagination = false
  unmaterializedThread = false
  unmaterializedAfterFirstPage = false
  legacyUnmaterializedThread = false
  rejectTurnStartBusy = false
  rejectSettings = false
  projectListMode: 'normal' | 'empty' | 'unsupported' = 'normal'
  goal: Record<string, unknown> | null = null

  constructor(private readonly root: string, private readonly outside = root) {}

  async start(): Promise<void> { this.ready = true }
  isReady(): boolean { return this.ready }

  async call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
    if (method === 'thread/goal/get') return { goal: this.goal }
    if (method === 'thread/unsubscribe') {
      queueMicrotask(() => this.emit({ kind: 'notification', method: 'thread/closed', params }))
      return { status: 'unsubscribed' }
    }
    if (method === 'account/read') return { account: { type: 'chatgpt', email: 'private@example.com' }, requiresOpenaiAuth: true }
    if (method === 'thread/list') return {
      data: [
        { id: 'allowed-thread', projectId: 'allowed-project', cwd: this.root, createdAt: 1, updatedAt: 2, path: 'private rollout path' },
        { id: 'outside-thread', projectId: 'outside-project', cwd: this.outside, createdAt: 1, updatedAt: 2, path: 'private rollout path' },
        { id: 'project-only-thread', projectId: 'allowed-project', createdAt: 1, updatedAt: 2, path: 'private rollout path' },
        { id: 'unprojected-thread', cwd: `${this.root}-unprojected`, createdAt: 1, updatedAt: 2, path: 'private rollout path' },
        { id: 'missing-cwd', createdAt: 1, updatedAt: 2 },
      ],
      nextCursor: null,
    }
    if (method === 'project/list') {
      if (this.projectListMode === 'unsupported') {
        throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Codex App Server rejected the request.')
      }
      if (this.projectListMode === 'empty') return { data: [], nextCursor: null }
      return {
        data: [
          {
            id: 'allowed-project',
            name: 'Allowed Project',
            roots: [{ path: this.root }],
            metadata: { secret: 'private metadata' },
            position: 0,
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: 'outside-project',
            name: 'Outside Project',
            roots: [{ path: this.outside }],
            position: 1,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        nextCursor: null,
      }
    }
    if (method === 'project/create') {
      const source = isRecord(params) ? params : {}
      return {
        project: {
          id: 'created-project',
          name: source.name,
          roots: source.roots,
          metadata: { secret: 'private metadata' },
          position: 2,
          createdAt: 3,
          updatedAt: 3,
        },
      }
    }
    if (method === 'thread/read') {
      const threadId = isRecord(params) ? params.threadId : undefined
      const includeTurns = isRecord(params) && params.includeTurns === true
      if (includeTurns && (this.unmaterializedThread || this.legacyUnmaterializedThread)) {
        throw new CodexAppServerError(CODEX_THREAD_UNMATERIALIZED, CODEX_UNMATERIALIZED_THREAD_MESSAGE)
      }
      const cwd = threadId === 'outside-thread'
        ? this.outside
        : threadId === 'unprojected-thread'
          ? `${this.root}-unprojected`
          : this.root
      return { thread: {
        id: threadId,
        ...(threadId === 'project-only-thread' ? { projectId: 'allowed-project' } : { cwd }),
        turns: includeTurns ? [{
          id: 'turn-1',
          status: 'completed',
          items: [
            { id: 'user-1', type: 'userMessage', text: 'First' },
            { id: 'assistant-1', type: 'agentMessage', text: 'Second' },
          ],
        }] : [],
      } }
    }
    if (method === 'thread/turns/list') {
      if (this.unmaterializedThread) {
        throw new CodexAppServerError(CODEX_THREAD_UNMATERIALIZED, CODEX_UNMATERIALIZED_THREAD_MESSAGE)
      }
      if (this.legacyUnmaterializedThread) {
        throw new CodexAppServerError('METHOD_NOT_FOUND', 'method not found')
      }
      if (this.unmaterializedAfterFirstPage) {
        if (isRecord(params) && params.cursor !== undefined) {
          throw new CodexAppServerError(CODEX_THREAD_UNMATERIALIZED, CODEX_UNMATERIALIZED_THREAD_MESSAGE)
        }
        return {
          data: [{
            id: 'turn-1',
            status: 'completed',
            itemsView: 'full',
            items: [{ id: 'user-1', type: 'userMessage', text: 'First' }],
          }],
          nextCursor: 'page-2',
          backwardsCursor: null,
        }
      }
      if (this.rejectTurnPagination) {
        throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Codex App Server rejected the request.')
      }
      return {
        data: [{
          id: 'turn-1',
          status: 'completed',
          startedAt: 1,
          completedAt: 2,
          itemsView: 'full',
          items: [
            { id: 'user-1', type: 'userMessage', text: 'First' },
            { id: 'assistant-1', type: 'agentMessage', text: 'Second' },
          ],
        }],
        nextCursor: null,
        backwardsCursor: null,
      }
    }
    if (method === 'thread/items/list') return { data: [], nextCursor: null, backwardsCursor: null }
    if (method === 'thread/start') return { thread: { id: 'new-thread', cwd: isRecord(params) ? params.cwd : undefined } }
    if (method === 'thread/resume' && this.resumeRolloutMissing) {
      throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Codex thread state is not persisted yet.')
    }
    if (method === 'thread/resume' && this.rejectResume) {
      throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Codex App Server rejected the request.')
    }
    if (method === 'thread/resume' || method === 'thread/fork' || method === 'thread/unarchive') {
      return { thread: { id: 'allowed-thread', cwd: this.root } }
    }
    if (method === 'thread/settings/update' && this.rejectSettings) {
      throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Codex App Server rejected the setting.')
    }
    if (method === 'turn/start') {
      if (this.rejectTurnStartBusy) {
        throw new CodexAppServerError('CODEX_UPSTREAM_ERROR', 'Codex thread already has an active writer.')
      }
      return { turn: { id: 'turn-1', status: 'inProgress', items: [] } }
    }
    return {}
  }

  async respond(id: string | number, result: unknown): Promise<void> { this.responses.push({ id, result }) }
  async respondError(id: string | number, code: number, message: string): Promise<void> {
    this.responses.push({ id, error: { code, message } })
  }
  onInbound(handler: CodexAppServerInboundHandler): () => void {
    this.handler = handler
    return () => { this.handler = undefined }
  }
  onUnavailable(handler: CodexAppServerUnavailableHandler): () => void {
    this.unavailableHandler = handler
    return () => { this.unavailableHandler = undefined }
  }
  emit(message: CodexAppServerInbound): void { this.handler?.(message) }
  crash(code: string): void {
    this.ready = false
    this.unavailableHandler?.(code)
  }
  async close(): Promise<void> { this.ready = false }
}

async function directories(): Promise<{ base: string; root: string; outside: string }> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-codex-domain-'))
  cleanup.push(base)
  const root = join(base, 'allowed')
  const outside = join(base, 'allowed-sibling')
  await mkdir(root)
  await mkdir(outside)
  return { base, root, outside }
}

function extractRequestHandle(data: unknown): string {
  if (!isRecord(data) || !isRecord(data.frame) || !isRecord(data.frame.params)
    || typeof data.frame.params.requestHandle !== 'string') throw new Error('missing request handle')
  return data.frame.params.requestHandle
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function flush(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('codexBinaryCandidates', () => {
  it('discovers the Windows Codex desktop build and falls back to the configured CLI', async () => {
    const localAppData = await mkdtemp(join(tmpdir(), 'dsh-codex-bin-'))
    cleanup.push(localAppData)
    const binRoot = join(localAppData, 'OpenAI', 'Codex', 'bin')
    const olderBuild = join(binRoot, 'aaaa1111')
    const newerBuild = join(binRoot, 'bbbb2222')
    await mkdir(olderBuild, { recursive: true })
    await mkdir(newerBuild, { recursive: true })
    const older = join(olderBuild, 'codex.exe')
    const newer = join(newerBuild, 'codex.exe')
    await writeFile(older, '')
    await writeFile(newer, '')
    const oldTime = new Date(Date.now() - 60_000)
    await utimes(older, oldTime, oldTime)

    const previous = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = localAppData
    try {
      // Newest build first, then the configured `codex` fallback.
      expect(codexBinaryCandidates('codex', 'win32', join(localAppData, 'home'))).toEqual([newer, older, 'codex'])
      // An explicitly configured binary is never replaced.
      expect(codexBinaryCandidates('C:\\tools\\codex.exe', 'win32', '/unused')).toEqual(['C:\\tools\\codex.exe'])
      // Non-Windows platforms keep the plain configured value when no desktop app matches.
      expect(codexBinaryCandidates('codex', 'linux', '/unused')).toEqual(['codex'])
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA
      else process.env.LOCALAPPDATA = previous
    }
  })
})
