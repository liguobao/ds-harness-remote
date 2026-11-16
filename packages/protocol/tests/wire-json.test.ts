import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  MAX_RELAY_FRAME_BYTES,
  createControlFrame,
  createRelayDataFrame,
  createRpcRequest,
  decodeControlFrame,
  decodeMessage,
  decodeRelayDataFrame,
  encodeRelayDataFrame,
} from '../src/index.js'

describe('wire JSON decoding', () => {
  it('rejects duplicate decoded keys in Control and Remote messages', async () => {
    const control = JSON.stringify(createControlFrame('ping', { nonce: 'nonce' }))
    const remote = JSON.stringify(createRpcRequest('harness.transport.describe', {}))
    await runScenarios([
      { name: 'Control envelope', run: () => expect(() => decodeControlFrame(control.replace('"id":', '"id":"other","id":'))).toThrow('Invalid wire JSON.') },
      { name: 'Control payload', run: () => expect(() => decodeControlFrame(control.replace('"nonce":', '"nonce":"other","nonce":'))).toThrow('Invalid wire JSON.') },
      { name: 'escaped Control key', run: () => expect(() => decodeControlFrame(control.replace('"nonce":', '"n\\u006fnce":"other","nonce":'))).toThrow('Invalid wire JSON.') },
      { name: 'Remote method', run: () => expect(() => decodeMessage(remote.replace('"method":', '"method":"other","method":'))).toThrow('Invalid wire JSON.') },
      { name: 'nested Remote key', run: () => expect(() => decodeMessage(remote.replace('"params":{}', '"params":{"outer":{"id":1,"id":2}}'))).toThrow('Invalid wire JSON.') },
      { name: 'valid Control', run: () => expect(decodeControlFrame(control).type).toBe('ping') },
      { name: 'valid Remote', run: () => expect(decodeMessage(remote).type).toBe('rpc.request') },
      { name: 'separate objects', run: () => expect(decodeMessage(JSON.stringify(createRpcRequest('harness.transport.describe', { left: { id: 1 }, right: { id: 2 } }))).type).toBe('rpc.request') },
    ])
  })

  it('rejects invalid UTF-8 without exposing input', async () => {
    const invalid = Uint8Array.from([0x22, 0xc0, 0xaf, 0x22])
    await runScenarios([
      { name: 'Control bytes', run: () => expect(() => decodeControlFrame(invalid)).toThrow('Invalid wire JSON.') },
      { name: 'Remote bytes', run: () => expect(() => decodeMessage(invalid)).toThrow('Invalid wire JSON.') },
    ])
  })

  it('bounds and strictly parses independent Relay data envelopes', async () => {
    const relay = encodeRelayDataFrame(createRelayDataFrame('relay', {
      connectionId: 'connection-1',
      targetDeviceId: 'host-1',
      counter: 0,
      ciphertext: 'AQ',
    }))
    const duplicateEnvelopeId = relay.replace('"id":', '"id":"other","id":')
    const duplicatePayload = relay.replace('"counter":0', '"counter":1,"counter":0')
    const unknownEnvelopeField = relay.replace('"payload":', '"extra":true,"payload":')
    const oversized = `{"v":1,"id":"x","type":"relay","timestamp":1,"payload":${' '.repeat(MAX_RELAY_FRAME_BYTES)}}`
    await runScenarios([
      { name: 'valid Relay data', run: () => expect(decodeRelayDataFrame(relay).type).toBe('relay') },
      { name: 'duplicate envelope field', run: () => expect(() => decodeRelayDataFrame(duplicateEnvelopeId)).toThrow('Invalid Relay data frame.') },
      { name: 'duplicate payload field', run: () => expect(() => decodeRelayDataFrame(duplicatePayload)).toThrow('Invalid Relay data frame.') },
      { name: 'negative relay counter', run: () => expect(() => decodeRelayDataFrame(relay.replace('"counter":0', '"counter":-1'))).toThrow('Invalid Relay data frame.') },
      { name: 'noncanonical relay ciphertext', run: () => expect(() => decodeRelayDataFrame(relay.replace('"ciphertext":"AQ"', '"ciphertext":"AR"'))).toThrow('Invalid Relay data frame.') },
      { name: 'unknown envelope field', run: () => expect(() => decodeRelayDataFrame(unknownEnvelopeField)).toThrow('Invalid Relay data frame.') },
      { name: 'oversized before JSON parse', run: () => expect(() => decodeRelayDataFrame(oversized)).toThrow('Relay frame exceeds its limit.') },
      { name: 'negotiated limit', run: () => expect(() => decodeRelayDataFrame(relay, { maxRelayFrameBytes: relay.length - 1 })).toThrow('Relay frame exceeds its limit.') },
    ])
  })
})
