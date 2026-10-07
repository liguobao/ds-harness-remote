import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it } from 'vitest'
import { remoteWorkspaceTypeAvailable } from '../src/remote-gateway.js'

const capability = 'agent.acp.antigravity.v1'
const type = { id: 'antigravity', name: 'AGY', capability, available: true }

describe('workspace type capability and readiness', () => {
  it('retains capability discovery when the Host omits workspace types', () => {
    expect(remoteWorkspaceTypeAvailable(['codex.appserver.v1'], undefined, 'codex', 'codex.appserver.v1')).toBe(true)
  })

  it('requires matching backend capability and unambiguous readiness', async () => {
    const rows = [
      { types: [type], capabilities: [capability], expected: true },
      { types: [{ ...type, available: false }], capabilities: [capability], expected: false },
      { types: [], capabilities: [capability], expected: false },
      { types: [type, type], capabilities: [capability], expected: false },
      { types: [{ ...type, capability: 'another.domain.v1' }], capabilities: [capability], expected: false },
      { types: [type], capabilities: ['agent.acp.v1'], expected: false },
    ] as const
    await runScenarios(
      rows.map((row, index) => {
        const { types, capabilities, expected } = row
        return {
          name: scenarioName(
            'requires matching negotiated capability and unambiguous readiness ($expected)',
            row,
            index,
          ),
          run: () => {
            expect(remoteWorkspaceTypeAvailable(capabilities, types, 'antigravity', capability)).toBe(expected)
          },
        }
      }),
    )
  })
})
