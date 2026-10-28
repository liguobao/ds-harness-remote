import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { createRpcRequest, decodeMessage, parseWireJson } from '../src/index.js'

describe('wire JSON authorization boundaries', () => {
  it('rejects duplicate decoded keys within each object', async () => {
    const rows = [
      ['duplicate role', '{"role":"host","role":"client"}', false],
      ['escaped role', '{"role":"host","r\\u006fle":"client"}', false],
      ['nested credential', '{"device":{"key":1,"key":2}}', false],
      ['array object', '[{"id":1,"id":2}]', false],
      ['prototype key', '{"__proto__":1,"__proto__":2}', false],
      ['different objects', '{"left":{"id":1},"right":{"id":2}}', true],
      ['array siblings', '[{"id":1},{"id":2}]', true],
      ['quoted syntax', '{"text":"\\\"id\\\":1,\\\"id\\\":2","id":3}', true],
      ['escaped slash', '{"\\\\":1,"other":2}', true],
      ['invalid JSON', '{"secret":"do-not-return-this",}', false],
    ] as const
    await runScenarios(rows.map(([name, input, accepted]) => ({ name, run: () => {
      if (accepted) expect(parseWireJson(input)).toEqual(JSON.parse(input))
      else expect(() => parseWireJson(input)).toThrow('Invalid wire JSON.')
    } })))
  })

  it('rejects invalid UTF-8 and ambiguous authenticated messages', async () => {
    const request = JSON.stringify(createRpcRequest('harness.transport.describe', {}))
    const invalidUtf8 = Uint8Array.from([0x22, 0xc0, 0xaf, 0x22])
    await runScenarios([
      { name: 'REST bytes', run: () => expect(() => parseWireJson(invalidUtf8)).toThrow('Invalid wire JSON.') },
      { name: 'Remote bytes', run: () => expect(() => decodeMessage(invalidUtf8)).toThrow('Invalid wire JSON.') },
      { name: 'Remote method', run: () => expect(() => decodeMessage(request.replace('"method":', '"method":"loopback.call","method":'))).toThrow('Invalid wire JSON.') },
      { name: 'valid Remote request', run: () => expect(decodeMessage(request).type).toBe('rpc.request') },
    ])
  })
})
