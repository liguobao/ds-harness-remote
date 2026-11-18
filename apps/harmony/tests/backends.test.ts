import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const bundlePath = join(here, '.backends-bundle.mjs')

const kitStub = `
export const network = {}
export const webSocket = {}
export const cryptoFramework = {
  createRandom: () => ({ generateRandomSync: (len) => ({ data: new Uint8Array(len) }) })
}
export const hilog = { info: () => undefined, warn: () => undefined, error: () => undefined }
`

let mod: any

beforeAll(async () => {
  const entry = `
export * from ${JSON.stringify(join(etsRoot, 'net', 'RemoteGateway.ets'))}
export * from ${JSON.stringify(join(etsRoot, 'net', 'CodexClient.ets'))}
export * from ${JSON.stringify(join(etsRoot, 'net', 'AcpClient.ets'))}
`
  const entryPath = join(here, '.backends-entry.ts')
  writeFileSync(entryPath, entry, 'utf8')
  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'neutral',
      loader: { '.ets': 'ts' },
      resolveExtensions: ['.ets', '.ts', '.js'],
      plugins: [
        {
          name: 'kit-stub',
          setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /^@kit\./ }, () => ({ path: 'kit', namespace: 'kit-stub' }))
            pluginBuild.onLoad({ filter: /.*/, namespace: 'kit-stub' }, () => ({
              contents: kitStub,
              loader: 'ts'
            }))
          }
        }
      ]
    })
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  } finally {
    rmSync(entryPath, { force: true })
  }
  mod = await import(`file://${bundlePath}`)
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

function makeCore(responder: (method: string, params: any) => any) {
  const calls: Array<{ method: string; params: any }> = []
  return {
    calls,
    async rpc(method: string, params: any) {
      calls.push({ method, params })
      return responder(method, params)
    },
    onEvent() { return () => undefined },
    onClose() { return () => undefined },
  }
}

describe('CodexRemoteClient', () => {
  it('projects codex threads, workspaces, and transferred thread/read history', async () => {
    const core = makeCore((method, params) => {
      if (method === 'codex.app.call' && params.method === 'thread/list') {
        return {
          data: [
            { id: 'thr-1', cwd: '/proj/app', name: 'Fix tests', updatedAt: 1700000000, status: { type: 'active' } }
          ]
        }
      }
      if (method === 'codex.app.transfer.open' || method === 'codex.app.transfer.chunk' || method === 'codex.app.transfer.close') {
        return { ok: true }
      }
      if (method === 'codex.app.transfer.commit') {
        return {
          kind: 'inline',
          response: {
            thread: {
              id: 'thr-1',
              cwd: '/proj/app',
              turns: [{
                id: 'turn-1',
                status: 'inProgress',
                items: [
                  { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'Run tests' }] },
                  { id: 'a1', type: 'agentMessage', content: [{ type: 'text', text: 'Running…' }], status: 'inProgress' }
                ]
              }]
            }
          }
        }
      }
      return {}
    })

    const codex = new mod.CodexRemoteClient(core)
    const threads = await codex.threads()
    expect(threads).toHaveLength(1)
    expect(threads[0].sessionId).toBe('codex:thr-1')
    expect(threads[0].running).toBe(true)

    const workspaces = mod.buildCodexWorkspaces(threads)
    expect(workspaces[0].workspaceId).toBe('codex:cwd:%2Fproj%2Fapp')

    const hist = await codex.history('thr-1')
    expect(hist.activeTurnId).toBe('turn-1')
    expect(hist.items).toHaveLength(2)
    expect(hist.items[1].text).toBe('Running…')
  })
})

describe('AgentAcpClient & reduceAcpFrame', () => {
  it('detects supported ACP backends and lists workspaces/sessions', async () => {
    const features = new mod.RemoteHostFeatures()
    features.capabilities = ['agent.acp.cursor.v1', 'agent.acp.claude.v1']
    features.hasWorkspaceTypesField = true
    const wt1 = new mod.RemoteWorkspaceTypeDesc()
    wt1.id = 'cursor'; wt1.capability = 'agent.acp.cursor.v1'; wt1.available = true
    const wt2 = new mod.RemoteWorkspaceTypeDesc()
    wt2.id = 'claude'; wt2.capability = 'agent.acp.claude.v1'; wt2.available = false
    features.workspaceTypes = [wt1, wt2]
    expect(mod.detectSupportedAcpBackends(features)).toEqual(['cursor'])

    const core = makeCore((method, params) => {
      if (method === 'agent.acp.call' && params.method === 'dsh/workspaceList') {
        return [{ path: '/repo/demo', title: 'demo' }]
      }
      if (method === 'agent.acp.call' && params.method === 'dsh/sessionList') {
        return { items: [{ conversationId: 'c-1', title: 'Refactor', updatedAt: 1700000000 }] }
      }
      return {}
    })
    const acp = new mod.AgentAcpClient(core, features.capabilities)
    const ws = await acp.listWorkspaces('cursor')
    expect(ws[0].workspaceId).toBe('cursor:cwd:%2Frepo%2Fdemo')
    const sessions = await acp.listSessions('/repo/demo', 'cursor')
    expect(sessions[0].sessionId).toBe('cursor:c-1')
  })

  it('reduces ACP streaming chunks, tool updates, approvals, and completion', () => {
    let items: any[] = []
    items = mod.reduceAcpFrame(items, 'session/update', {
      update: { sessionUpdate: 'agent_message_chunk', content: { text: 'Hello ' } }
    })
    items = mod.reduceAcpFrame(items, 'session/update', {
      update: { sessionUpdate: 'agent_message_chunk', content: { text: 'world' } }
    })
    items = mod.reduceAcpFrame(items, 'session/update', {
      update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'bash', status: 'inProgress' }
    })
    items = mod.reduceAcpFrame(items, 'session/update', {
      update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', output: 'ok' }
    })
    items = mod.reduceAcpFrame(items, 'session/request_permission', {
      requestHandle: 'req-1', toolName: 'write_file', reason: 'Modify config'
    })
    items = mod.reduceAcpFrame(items, 'session/update', {
      update: { sessionUpdate: 'prompt_completed', stopReason: 'end_turn' }
    })

    expect(items.length).toBe(3)
    expect(items[0].text).toBe('Hello world')
    expect(items[0].streaming).toBe(false)
    expect(items[1].toolState).toBe('finished')
    expect(items[2].kind).toBe('approval')
    expect(items[2].approvalId).toBe('req-1')
  })
})
