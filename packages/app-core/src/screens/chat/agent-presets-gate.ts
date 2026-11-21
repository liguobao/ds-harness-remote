/**
 * Agent-preset (`dsh/agentPresetList` / `dsh/sessionModes`) fetch rules.
 *
 * The chat screen fetches presets lazily instead of gating them in `openSession`.
 * Loading stores a fresh array reference, so an effect that depends on the raw
 * option array re-fires on every successful load and spins an RPC/render loop.
 * ACP sessions also receive modes during `openSession`, so the effect must never
 * race that load or fall back to it after a failed `openSession` (a failed large
 * history load would otherwise trigger a live `session/load`).
 */

import { isAcpManagedBackend } from '../../lib/workspace-key'

export type AgentPresetGateInput = {
  /** Connection phase; presets are Host RPCs. */
  phase: string
  /** Selected session identity; `undefined` means no session is open. */
  sessionId?: string
  backend?: string
  /** The store already holds presets (avoids refetch loops on the new array reference). */
  hasPresets: boolean
  /** An ACP `openSession` is running for this session and already fetches modes. */
  isOpeningAcpSession: boolean
  /** Current store error; a failed ACP `openSession` must not fall back to live modes. */
  storeError?: string
}

export function shouldLoadAgentPresets(input: AgentPresetGateInput): boolean {
  if (input.phase !== 'connected' || input.sessionId === undefined || input.backend === 'codex') return false
  if (input.hasPresets || input.isOpeningAcpSession) return false
  // Optional ACP mode discovery degrades without a banner; never kick a live
  // `session/load` right after an ACP failure (e.g. `ACP_HISTORY_TOO_LARGE`).
  if (isAcpManagedBackend(input.backend) && input.storeError !== undefined) return false
  return true
}
