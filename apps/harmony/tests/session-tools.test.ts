/**
 * Conformance tests for TransferCodec, RemoteGateway chunked transfer & capabilities,
 * and SessionToolsClient (files, jobs, terminal, feedback, presets, plugins, settings, uploads).
 */
import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const bundlePath = join(here, '.session-tools-bundle.mjs')

const kitStub = `
export const network = {}
export const webSocket = {}
export const cryptoFramework = {
  createRandom: () => ({
    generateRandomSync: (len) => {
      const out = new Uint8Array(len)
      for (let i = 0; i < len; i++) out[i] = (i * 17 + 3) & 0xff
      return { data: out }
    }
  })
}
export const hilog = { info: () => undefined, warn: () => undefined, error: () => undefined }
`

let mod: any

beforeAll(async () => {
  const entry = `
export * from ${JSON.stringify(join(etsRoot, 'net', 'RemoteClientCore.ets'))}
export * from ${JSON.stringify(join(etsRoot, 'net', 'TransferCodec.ets'))}
export * from ${JSON.stringify(join(etsRoot, 'net', 'RemoteGateway.ets'))}
export * from ${JSON.stringify(join(etsRoot, 'net', 'SessionToolsClient.ets'))}
`
  const entryPath = join(here, '.session-tools-entry.ts')
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

function makeFakeCore(responder: (method: string, params: any) => any) {
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

describe('TransferCodec', () => {
  it('round-trips arbitrary byte lengths through RFC 4648 base64 and base64url', () => {
    for (const len of [0, 1, 2, 3, 4, 17, 255, 1025]) {
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) bytes[i] = (i * 31 + 7) & 0xff
      const b64 = mod.bytesToBase64(bytes)
      const decoded = mod.base64ToBytes(b64)
      expect(Array.from(decoded)).toEqual(Array.from(bytes))
    }
    expect(mod.utf8ToBase64Url('"sess-123"')).not.toMatch(/[+/=]/)
  })

  it('transfers multi-chunk requests and reads chunked responses then closes transfer', async () => {
    const bigPayload = new TextEncoder().encode(JSON.stringify({ payload: 'x'.repeat(600_000) }))
    const responseJson = JSON.stringify({ ok: true, value: { greeting: 'y'.repeat(600_000) } })
    const responseBytes = new TextEncoder().encode(responseJson)
    const receivedChunks: Uint8Array[] = []
    const core = makeFakeCore((method, params) => {
      if (method === 'harness.remote.transfer.open') return { ok: true }
      if (method === 'harness.remote.transfer.chunk') {
        receivedChunks.push(mod.base64ToBytes(params.data))
        return { ok: true }
      }
      if (method === 'harness.remote.transfer.commit') {
        return {
          kind: 'chunked',
          transferId: params.transferId,
          totalBytes: responseBytes.byteLength,
          totalChunks: Math.ceil(responseBytes.byteLength / mod.TRANSFER_CHUNK_BYTES)
        }
      }
      if (method === 'harness.remote.transfer.read') {
        const start = params.index * mod.TRANSFER_CHUNK_BYTES
        const end = Math.min(start + mod.TRANSFER_CHUNK_BYTES, responseBytes.byteLength)
        return {
          transferId: params.transferId,
          index: params.index,
          data: mod.bytesToBase64(responseBytes.subarray(start, end))
        }
      }
      if (method === 'harness.remote.transfer.close') return { ok: true }
      throw new Error(`unexpected rpc ${method}`)
    })

    const out = await mod.callChunkedTransfer(core, 'harness.remote.transfer', 'tx-1', bigPayload)
    expect(out).toEqual({ ok: true, value: { greeting: 'y'.repeat(600_000) } })
    expect(receivedChunks.reduce((acc, c) => acc + c.byteLength, 0)).toBe(bigPayload.byteLength)
    expect(core.calls.some(c => c.method === 'harness.remote.transfer.close')).toBe(true)
  })
})

describe('RemoteGateway capabilities and RESPONSE_TOO_LARGE fallback', () => {
  it('parses extended capabilities and workspaceTypes accurately', async () => {
    const core = makeFakeCore((method) => {
      expect(method).toBe('harness.transport.describe')
      return {
        capabilities: [
          'harness.api.v1',
          'harness.remote.v3',
          'harness.remote.transfer.v1',
          'fileviewer.read.v1',
          'plugin.route.v1',
          'harness.remote.compaction.v1',
          'workspace.upload.v1',
          'workspace.upload.binary.v1',
          'codex.appserver.v1'
        ],
        workspaceTypes: [
          { id: 'codex', capability: 'codex.appserver.v1', available: true },
          { id: 'cursor', capability: 'agent.acp.cursor.v1', available: false, reason: 'not installed' }
        ]
      }
    })
    const gw = new mod.RemoteGateway(core)
    const features = await gw.probeHostFeatures()
    expect(features.remoteGateway).toBe(true)
    expect(features.sessionFormat).toBe(3)
    expect(features.remoteTransfer).toBe(true)
    expect(features.fileViewer).toBe(true)
    expect(features.pluginRoute).toBe(true)
    expect(features.binaryUploads).toBe(true)
    expect(features.asyncCompaction).toBe(true)
    expect(features.supportsWorkspaceType('codex', 'codex.appserver.v1')).toBe(true)
    expect(features.supportsWorkspaceType('cursor', 'agent.acp.cursor.v1')).toBe(false)
  })

  it('falls back to chunked transfer when harness.remote.call throws RESPONSE_TOO_LARGE', async () => {
    const core = makeFakeCore((method, params) => {
      if (method === 'harness.remote.call') {
        throw new mod.RemoteClientError('RESPONSE_TOO_LARGE', 'too big')
      }
      if (method === 'harness.remote.transfer.open') return {}
      if (method === 'harness.remote.transfer.chunk') return {}
      if (method === 'harness.remote.transfer.commit') {
        return { kind: 'inline', response: { ok: true, value: { text: 'large-ok' } } }
      }
      if (method === 'harness.remote.transfer.close') return {}
      throw new Error(`unexpected ${method}`)
    })
    const gw = new mod.RemoteGateway(core)
    const smallResult = await gw.call('workspaceFiles/read', { args: { path: 'big.txt' } })
    expect(smallResult).toEqual({ text: 'large-ok' })
    const bigResult = await gw.call('workspaceFiles/read', { args: { data: 'z'.repeat(2 * 1024 * 1024 + 64) } })
    expect(bigResult).toEqual({ text: 'large-ok' })
  })
})

describe('SessionToolsClient', () => {
  it('calls workspaceFiles/*, officeToPdf/*, agentPresets/*, messageFeedback/*, pluginManager/*, settings/*', async () => {
    const core = makeFakeCore((method, params) => {
      if (method === 'harness.remote.call') {
        const ep = params.endpoint
        if (ep === 'workspaceFiles/list') {
          const p = params.payload.args.path
          return {
            ok: true,
            value: p === '.'
              ? { path: '', entries: [{ name: 'src', type: 'directory' }, { name: 'README.md', type: 'file', size: 120 }], truncated: false }
              : { path: 'src', entries: [{ name: 'app.ts', type: 'file', size: 55 }], truncated: false }
          }
        }
        if (ep === 'officeToPdf/render') {
          const pdfBytes = new TextEncoder().encode('%PDF-1.4')
          return {
            ok: true,
            value: { absolutePath: '/ws/doc.docx', version: 'v1', bytes: pdfBytes.byteLength, offset: 0, eof: true, generation: 'g1', missingFonts: [], data: mod.bytesToBase64(pdfBytes) }
          }
        }
        if (ep === 'agentPresets/list') {
          return { ok: true, value: { presets: [{ id: 'architect', name: 'Architect', description: 'Plan mode', isDefault: true }] } }
        }
        if (ep === 'agentPresets/select') {
          return { ok: true, value: 'architect' }
        }
        if (ep === 'messageFeedback/list') {
          return { ok: true, value: { items: [{ messageId: 'm1', rating: 'positive', version: 'ver1' }] } }
        }
        if (ep === 'messageFeedback/put') {
          expect(params.payload.args.request.ifVersion).toBe('ver1')
          return { ok: true, value: { messageId: 'm1', rating: 'negative', version: 'ver2' } }
        }
        if (ep === 'pluginManager/listPlugins') {
          return { ok: true, value: [{ id: 'p1', name: 'Browser', enabled: true, status: 'active' }] }
        }
        if (ep === 'settings/describe') {
          return { ok: true, value: { writable: true, namespaces: [{ ns: 'harness', revision: 4, value: { theme: 'dark' } }] } }
        }
      }
      if (method === 'workspace.upload.open') return { chunkBytes: 4 }
      if (method === 'workspace.upload.chunk') return { ok: true }
      if (method === 'workspace.upload.commit') return { name: 'note.txt', path: './note.txt', bytes: 10 }
      return { ok: true, value: {} }
    })

    const gw = new mod.RemoteGateway(core)
    const tools = new mod.SessionToolsClient(gw)

    const refs = await tools.loadWorkspaceFileRefs('sess-1')
    expect(refs.map((r: any) => `${r.kind}:${r.path}`)).toEqual(['directory:src', 'file:README.md', 'file:src/app.ts'])

    const pdf = await tools.renderOfficePdf('sess-1', 'doc.docx')
    expect(new TextDecoder().decode(pdf.data)).toBe('%PDF-1.4')
    expect(pdf.generation).toBe('g1')

    const presets = await tools.agentPresetList()
    expect(presets[0].id).toBe('architect')
    expect(await tools.agentPresetSelect('sess-1', 'architect')).toBe('architect')

    const fb = await tools.messageFeedbackPut('sess-1', 'm1', 'negative')
    expect(fb.version).toBe('ver2')

    const plugins = await tools.pluginListPlugins()
    expect(plugins[0].name).toBe('Browser')

    const settings = await tools.settingsDescribe()
    expect(settings.writable).toBe(true)
    expect(settings.namespaces[0].revision).toBe(4)

    const upload = await tools.workspaceUploadFile('sess-1', 'note.txt', new Uint8Array(10))
    expect(upload.path).toBe('./note.txt')
    expect(upload.bytes).toBe(10)
  })
})
