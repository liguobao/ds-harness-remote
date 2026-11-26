import { realpath } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { OpencodeNativeApi, opencodePrivateArgs } from '../src/acp/adapters/opencode-native-api.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

describe('OpenCode native archive boundary', () => {
  it('archives only the trusted session through the authenticated native metadata endpoint', async () => {
    const cwd = await realpath(process.cwd())
    for (const alreadyArchived of [false, true]) {
      const request = vi.fn(async (_url: unknown, options: RequestInit | undefined) => new Response(JSON.stringify({
        id: 'ses_1', directory: cwd, time: options?.method === 'PATCH' || alreadyArchived ? { archived: 123 } : {},
      })))
      const api = new OpencodeNativeApi('http://127.0.0.1:12345', request as typeof fetch)
      try {
        await api.archive('ses_1', cwd)
        expect(request.mock.calls.map(([, options]) => options?.method)).toEqual(alreadyArchived ? ['GET'] : ['GET', 'PATCH'])
        for (const [url, options] of request.mock.calls) {
          expect(String(url)).toBe(`http://127.0.0.1:12345/session/ses_1?directory=${encodeURIComponent(cwd)}`)
          expect(options?.redirect).toBe('error')
          expect(options?.headers).toMatchObject({ authorization: `Basic ${Buffer.from(`opencode:${api.password}`).toString('base64')}` })
          if (options?.method === 'PATCH') expect(JSON.parse(String(options.body))).toEqual({ time: { archived: expect.any(Number) } })
        }
      } finally { api.close() }
    }
  })

  it('fails closed on upstream scope, response and transport failures without falling back to deletion', async () => {
    const cwd = await realpath(process.cwd()), other = await realpath('..')
    await runScenarios([
      { name: 'wrong session', body: { id: 'other', directory: cwd, time: {} }, calls: 1 },
      { name: 'wrong directory', body: { id: 'ses_1', directory: other, time: {} }, calls: 1 },
      { name: 'missing archive confirmation', body: { id: 'ses_1', directory: cwd, time: {} }, calls: 2 },
      { name: 'HTTP failure', body: {}, status: 500, calls: 1 },
      { name: 'oversized response', body: { text: 'A'.repeat(65_537) }, calls: 1 },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const request = vi.fn(async () => new Response(JSON.stringify(scenario.body), { status: scenario.status ?? 200 }))
      const api = new OpencodeNativeApi('http://127.0.0.1:12345', request as typeof fetch)
      try {
        await expect(api.archive('ses_1', cwd)).rejects.toMatchObject({ code: 'OPENCODE_ARCHIVE_UNAVAILABLE' })
        expect(request).toHaveBeenCalledTimes(scenario.calls)
      } finally { api.close() }
    } })))
    for (const origin of ['http://example.com:1234', 'http://127.0.0.1:99999', 'http://127.0.0.1:1234/redirect', 'http://localhost:1234']) expect(() => new OpencodeNativeApi(origin)).toThrow()
    const request = vi.fn()
    const api = new OpencodeNativeApi('http://127.0.0.1:12345', request)
    await expect(api.archive('../escape', cwd)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    expect(request).not.toHaveBeenCalled()
    const args = opencodePrivateArgs(['acp', '--port', '4096', '--hostname=0.0.0.0', '--mdns', 'true', '--cwd', cwd], 12345)
    expect(args).toEqual(['acp', '--cwd', cwd, '--hostname=127.0.0.1', '--port=12345', '--mdns=false'])
  })

  it('rejects batch archive metadata with a wrong scope or duplicate session', async () => {
    const cwd = await realpath(process.cwd()), other = await realpath('..')
    await runScenarios([
      { name: 'wrong directory', rows: [{ id: 'ses_1', directory: other, time: {} }] },
      { name: 'duplicate session', rows: [{ id: 'ses_1', directory: cwd, time: {} }, { id: 'ses_1', directory: cwd, time: {} }] },
      { name: 'invalid archive time', rows: [{ id: 'ses_1', directory: cwd, time: { archived: 'yes' } }] },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const request = vi.fn(async () => new Response(JSON.stringify(scenario.rows)))
      const api = new OpencodeNativeApi('http://127.0.0.1:12345', request as typeof fetch)
      try {
        await expect(api.listArchived(['ses_1'], cwd)).rejects.toMatchObject({ code: 'OPENCODE_ARCHIVE_UNAVAILABLE' })
        expect(request).toHaveBeenCalledTimes(1)
      } finally { api.close() }
    } })))
  })
})
