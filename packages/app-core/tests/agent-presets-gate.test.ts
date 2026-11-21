import { describe, expect, it } from 'vitest'
import { shouldLoadAgentPresets } from '../src/screens/chat/agent-presets-gate'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

const connectedHarness = {
  phase: 'connected',
  sessionId: 'harness:1',
  backend: undefined,
  hasPresets: false,
  isOpeningAcpSession: false,
}

describe('agent preset fetch gate', () => {
  it('keeps Harness sessions from refetching once presets are present', () => {
    // Regression: the chat effect stored a fresh array reference on every load,
    // so depending on the raw options looped `agentPresetList` forever.
    expect(shouldLoadAgentPresets(connectedHarness)).toBe(true)
    expect(shouldLoadAgentPresets({ ...connectedHarness, hasPresets: true })).toBe(false)
    expect(shouldLoadAgentPresets({ ...connectedHarness, hasPresets: true, storeError: 'boom' })).toBe(false)
  })

  it('matches the expected fetch matrix across backends and states', async () => {
    await runScenarios([
      { name: 'Harness without presets fetches', input: connectedHarness, expected: true },
      { name: 'Harness with presets stays idle', input: { ...connectedHarness, hasPresets: true }, expected: false },
      { name: 'ACP session opening skips the extra modes RPC', input: { phase: 'connected', sessionId: 'antigravity:1', backend: 'antigravity', hasPresets: false, isOpeningAcpSession: true }, expected: false },
      { name: 'ACP without modes fetches', input: { phase: 'connected', sessionId: 'antigravity:1', backend: 'antigravity', hasPresets: false, isOpeningAcpSession: false }, expected: true },
      { name: 'ACP store error never falls back to a live session/load', input: { phase: 'connected', sessionId: 'antigravity:1', backend: 'antigravity', hasPresets: false, isOpeningAcpSession: false, storeError: 'ACP_HISTORY_TOO_LARGE' }, expected: false },
      { name: 'CodeX owns its own model list', input: { phase: 'connected', sessionId: 'codex:1', backend: 'codex', hasPresets: false, isOpeningAcpSession: false }, expected: false },
      { name: 'offline never fetches', input: { ...connectedHarness, phase: 'offline' }, expected: false },
      { name: 'no session never fetches', input: { ...connectedHarness, sessionId: undefined }, expected: false },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => expect(shouldLoadAgentPresets(scenario.input)).toBe(scenario.expected),
    })))
  })
})
