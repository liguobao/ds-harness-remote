import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { mkdtemp, mkdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      params: { threadId: 'allowed-thread', permissionPreset: 'workspace-write' },
    })
    expect(app.calls.find(call => call.method === 'thread/fork')?.params).toMatchObject({
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

  constructor(private readonly root: string, private readonly outside = root) {}

  async start(): Promise<void> { this.ready = true }
  isReady(): boolean { return this.ready }

  async call(method: string, params: unknown): Promise<unknown> {
    this.calls.push({ method, params })
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