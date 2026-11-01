import { AgentAcpClient, RemoteTypertGateway, type RemoteGatewayStream } from '@dsh-remote/client-core'
import type { AcpWorkspaceToolCallEndpoint, AcpWorkspaceToolStreamEndpoint, AgentAcpFrameData } from '@dsh-remote/protocol'
import type { PermissionSelect } from '../types'

export interface WorkspaceDirectory {
  path: string
  entries: Array<{ name: string; type: 'file' | 'directory' | 'other'; size?: number }>
  truncated: boolean
}
export interface WorkspaceText {
  absolutePath: string
  version: string
  text: string
  offset: number
  lines: number
  eof: boolean
}
export interface WorkspaceFileStat {
  absolutePath: string
  version: string
  bytes?: number
}
export interface WorkspaceFileBytes extends WorkspaceFileStat {
  offset: number
  data: Uint8Array | string
  eof: boolean
}
export interface WorkspaceOfficeRender extends WorkspaceFileBytes {
  generation: string
  missingFonts: string[]
}
/** One human-invocable skill from the Host/工作区 skill catalog (`skills/list`). */
export interface SkillEntry {
  /** Kebab-case identifier referenced as `/name`. */
  name: string
  /** Short routing description. */
  description: string
  /** Whether the same skill is also advertised to the model. */
  modelInvocable: boolean
}

/** Normalized `commands/execute` outcome. */
export interface CommandExecutionResult {
  kind: 'success' | 'error'
  text?: string
}

export interface TerminalInfo {
  id: string
  title: string
  /** Host shell descriptor; the narrow tab strip shows `shell.name` rather than a working-directory title. */
  shell?: { name?: string }
  /** Terminal working directory; used only to recognise a working-directory label. */
  cwd?: string
  state: 'running' | 'exited' | 'failed'
  controllerId?: string
  cols: number
  rows: number
  exitCode: number | null
}
export type TerminalFrame =
  | { type: 'snapshot'; sequence: number; screen: string; info: TerminalInfo }
  | { type: 'output'; sequence: number; data: string }
  | { type: 'state'; info: TerminalInfo }

/** Foreground Office conversion legitimately outlives the transport-wide RPC deadline. */
export const OFFICE_PREVIEW_TIMEOUT_MS = 120_000
export const OFFICE_PREVIEW_MAX_RESPONSE_BYTES = 12 * 1024 * 1024

/** Official Typert endpoints only; Host owns scope, device ownership and input authorization. */
export interface BackgroundJob {
  startedAt?: number
  id: string
  label: string
  owner?: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  progress?: string
  detail?: string
}

export interface SessionTools {
  watchJobs?(sessionId: string, signal: AbortSignal): Promise<RemoteGatewayStream>
  followJob?(sessionId: string, jobId: string, signal: AbortSignal): Promise<RemoteGatewayStream>
  permissionOptions(signal?: AbortSignal): Promise<PermissionSelect['options']>
  listSkills(sessionId: string, signal?: AbortSignal): Promise<SkillEntry[]>
  executeCommand(sessionId: string, line: string): Promise<CommandExecutionResult>
  listFiles(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceDirectory>
  readFile(sessionId: string, path: string, offset?: number, signal?: AbortSignal): Promise<WorkspaceText>
  statFile(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceFileStat>
  readBytes(sessionId: string, path: string, offset: number, length: number, signal?: AbortSignal): Promise<WorkspaceFileBytes>
  officeGeneration(signal?: AbortSignal): Promise<string>
  renderOfficePdf(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceOfficeRender>
  terminalEnvironment(sessionId: string): Promise<{ maxInputBytes: number; maxCols: number; maxRows: number }>
  listTerminals(sessionId: string): Promise<TerminalInfo[]>
  createTerminal(sessionId: string, id: string, cols: number, rows: number): Promise<TerminalInfo>
  retainTerminal(sessionId: string, id: string, signal: AbortSignal): Promise<RemoteGatewayStream>
  followTerminal(sessionId: string, id: string, attachmentId: string, signal: AbortSignal): Promise<RemoteGatewayStream>
  writeTerminal(sessionId: string, id: string, attachmentId: string, data: string): Promise<void>
  resizeTerminal(sessionId: string, id: string, attachmentId: string, cols: number, rows: number): Promise<void>
  closeTerminal(sessionId: string, id: string): Promise<void>
}

export class HarnessSessionTools implements SessionTools {
  constructor(private readonly gateway: RemoteTypertGateway) {}

  watchJobs(sessionId: string, signal: AbortSignal): Promise<RemoteGatewayStream> {
    return this.gateway.open('job/list', { args: { request: { sessionId } } }, signal)
  }

  followJob(sessionId: string, jobId: string, signal: AbortSignal): Promise<RemoteGatewayStream> {
    return this.gateway.open('job/follow', { args: { request: { sessionId, jobId } } }, signal)
  }

  async permissionOptions(signal?: AbortSignal): Promise<PermissionSelect['options']> {
    const value = await this.gateway.call<{ options: PermissionSelect['options'] }>('permissionPresets/catalog', { args: {} }, signal)
    if (!Array.isArray(value?.options) || value.options.some(option => typeof option?.value !== 'string' || typeof option.name !== 'string')) {
      throw Object.assign(new Error('Invalid permission catalog'), { code: 'INVALID_MESSAGE' })
    }
    return value.options.map(option => ({ value: option.value, name: option.name, ...(typeof option.description === 'string' ? { description: option.description } : {}) }))
  }

  /** Human-invocable skill catalog visible to one Session (Host `skills/list`). */
  async listSkills(sessionId: string, signal?: AbortSignal): Promise<SkillEntry[]> {
    const value = await this.gateway.call<{ skills?: unknown }>('skills/list', { args: { request: { sessionId } } }, signal)
    const rows = Array.isArray(value?.skills) ? value.skills : []
    return rows.flatMap(row => {
      if (typeof row !== 'object' || row === null) return []
      const record = row as Record<string, unknown>
      if (typeof record.name !== 'string' || record.name.length === 0) return []
      return [{
        name: record.name,
        description: typeof record.description === 'string' ? record.description : '',
        modelInvocable: record.modelInvocable === true,
      }]
    })
  }

  /** Run one slash line (e.g. `/export`) through the Host command dispatcher. */
  async executeCommand(sessionId: string, line: string): Promise<CommandExecutionResult> {
    const value = await this.gateway.call<{ result?: unknown }>('commands/execute', {
      args: { agentId: sessionId, line, submittedAttachments: [] },
    })
    const result = typeof value?.result === 'object' && value.result !== null
      ? value.result as Record<string, unknown>
      : undefined
    if (result?.kind === 'success' || result?.kind === 'error') {
      return { kind: result.kind, ...(typeof result.text === 'string' ? { text: result.text } : {}) }
    }
    throw Object.assign(new Error('Invalid command execution result'), { code: 'INVALID_MESSAGE' })
  }

  listFiles(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceDirectory> {
    // The Host resolves `path` against the Session workspace and rejects an empty
    // string with `gateway/bad-request`; the empty UI state means the root, which
    // the wire addresses as `.`. The Host still reports the root back as `''`.
    return this.gateway.call('workspaceFiles/list', { args: { workspaceFileScopeId: sessionId, path: path === '' ? '.' : path } }, signal)
  }

  readFile(sessionId: string, path: string, offset = 1, signal?: AbortSignal): Promise<WorkspaceText> {
    return this.gateway.call('workspaceFiles/read', { args: { workspaceFileScopeId: sessionId, path, range: { offset, limit: 200 } } }, signal)
  }

  statFile(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceFileStat> {
    return this.gateway.call('workspaceFiles/stat', { args: { workspaceFileScopeId: sessionId, path } }, signal)
  }

  readBytes(sessionId: string, path: string, offset: number, length: number, signal?: AbortSignal): Promise<WorkspaceFileBytes> {
    return this.gateway.call(
      'workspaceFiles/readBytes',
      { args: { workspaceFileScopeId: sessionId, path, range: { offset, length } } },
      signal,
      { maxResponseBytes: 4 * Math.ceil(length / 3) + 64 * 1024 },
    )
  }

  officeGeneration(signal?: AbortSignal): Promise<string> {
    return this.gateway.call('officeToPdf/generation', { args: {} }, signal, { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS })
  }

  renderOfficePdf(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceOfficeRender> {
    return this.gateway.call(
      'officeToPdf/render',
      { args: { workspaceFileScopeId: sessionId, path, priority: 'foreground' } },
      signal,
      { timeoutMs: OFFICE_PREVIEW_TIMEOUT_MS, maxResponseBytes: OFFICE_PREVIEW_MAX_RESPONSE_BYTES },
    )
  }

  terminalEnvironment(sessionId: string): Promise<{ maxInputBytes: number; maxCols: number; maxRows: number }> {
    return this.gateway.call('terminal/environment', { args: { agentId: sessionId } })
  }

  listTerminals(sessionId: string): Promise<TerminalInfo[]> {
    return this.gateway.call('terminal/list', { args: { sessionId } })
  }

  createTerminal(sessionId: string, id: string, cols: number, rows: number): Promise<TerminalInfo> {
    return this.gateway.call('terminal/create', { args: { agentId: sessionId, request: { id, cols, rows } } })
  }

  retainTerminal(sessionId: string, id: string, signal: AbortSignal): Promise<RemoteGatewayStream> {
    return this.gateway.open('terminal/retain', { args: { sessionId, id } }, signal)
  }

  followTerminal(sessionId: string, id: string, attachmentId: string, signal: AbortSignal): Promise<RemoteGatewayStream> {
    return this.gateway.open('terminal/follow', { args: { agentId: sessionId, id, attachmentId } }, signal)
  }

  writeTerminal(sessionId: string, id: string, attachmentId: string, data: string): Promise<void> {
    // Never retry: after a timeout, it is unknown whether the shell consumed the input.
    return this.gateway.call('terminal/write', { args: { agentId: sessionId, id, attachmentId, data } })
  }

  resizeTerminal(sessionId: string, id: string, attachmentId: string, cols: number, rows: number): Promise<void> {
    return this.gateway.call('terminal/resize', { args: { agentId: sessionId, id, attachmentId, cols, rows } })
  }

  closeTerminal(sessionId: string, id: string): Promise<void> {
    return this.gateway.call('terminal/close', { args: { agentId: sessionId, id } })
  }
}

/** ACP workspace/terminal carrier. The Host keeps the same path and ownership checks. */
export class AcpSessionTools implements SessionTools {
  constructor(private readonly client: AgentAcpClient, private readonly backend: 'cursor' | 'antigravity' | 'pi' | 'opencode') {}
  private call<T>(sessionId: string, endpoint: AcpWorkspaceToolCallEndpoint, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const nativeId = sessionId.replace(/^\w+:/u, '')
    const scope = `${this.backend === 'antigravity' ? 'acp' : this.backend}:${nativeId}`
    const scopedArgs = endpoint.startsWith('workspaceFiles/')
      ? { workspaceFileScopeId: scope, ...args }
      : endpoint === 'terminal/list' || endpoint === 'terminal/close'
        ? { sessionId: scope, ...args }
        : { agentId: scope, ...args }
    return this.client.workspaceToolCall(nativeId, this.backend, endpoint, scopedArgs, signal) as Promise<T>
  }
  permissionOptions(): Promise<PermissionSelect['options']> { return Promise.reject(Object.assign(new Error('Permission catalog is unavailable for ACP workspaces.'), { code: 'FEATURE_NOT_SUPPORTED' })) }
  listSkills(): Promise<SkillEntry[]> { return Promise.resolve([]) }
  executeCommand(): Promise<CommandExecutionResult> { return Promise.reject(Object.assign(new Error('Commands are unavailable for ACP workspaces.'), { code: 'FEATURE_NOT_SUPPORTED' })) }
  listFiles(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceDirectory> {
    return this.call(sessionId, 'workspaceFiles/list', { path: path || '.' }, signal)
  }
  readFile(sessionId: string, path: string, offset = 1, signal?: AbortSignal): Promise<WorkspaceText> {
    return this.call(sessionId, 'workspaceFiles/read', { path, range: { offset, limit: 200 } }, signal)
  }
  statFile(sessionId: string, path: string, signal?: AbortSignal): Promise<WorkspaceFileStat> { return this.call(sessionId, 'workspaceFiles/stat', { path }, signal) }
  readBytes(sessionId: string, path: string, offset: number, length: number, signal?: AbortSignal): Promise<WorkspaceFileBytes> {
    return this.call(sessionId, 'workspaceFiles/readBytes', { path, range: { offset, length } }, signal)
  }
  officeGeneration(): Promise<string> { return Promise.reject(Object.assign(new Error('Office preview is unavailable for ACP workspaces.'), { code: 'FEATURE_NOT_SUPPORTED' })) }
  renderOfficePdf(): Promise<WorkspaceOfficeRender> { return Promise.reject(Object.assign(new Error('Office preview is unavailable for ACP workspaces.'), { code: 'FEATURE_NOT_SUPPORTED' })) }
  terminalEnvironment(sessionId: string): Promise<{ maxInputBytes: number; maxCols: number; maxRows: number }> { return this.call(sessionId, 'terminal/environment', {}) }
  listTerminals(sessionId: string): Promise<TerminalInfo[]> { return this.call(sessionId, 'terminal/list', {}) }
  createTerminal(sessionId: string, id: string, cols: number, rows: number): Promise<TerminalInfo> { return this.call(sessionId, 'terminal/create', { request: { id, cols, rows } }) }
  retainTerminal(sessionId: string, id: string, signal: AbortSignal): Promise<RemoteGatewayStream> { return this.stream(sessionId, 'terminal/retain', { id }, signal) }
  followTerminal(sessionId: string, id: string, attachmentId: string, signal: AbortSignal): Promise<RemoteGatewayStream> { return this.stream(sessionId, 'terminal/follow', { id, attachmentId }, signal) }
  writeTerminal(sessionId: string, id: string, attachmentId: string, data: string): Promise<void> { return this.call(sessionId, 'terminal/write', { id, attachmentId, data }).then(() => undefined) }
  resizeTerminal(sessionId: string, id: string, attachmentId: string, cols: number, rows: number): Promise<void> { return this.call(sessionId, 'terminal/resize', { id, attachmentId, cols, rows }).then(() => undefined) }
  closeTerminal(sessionId: string, id: string): Promise<void> { return this.call(sessionId, 'terminal/close', { id }).then(() => undefined) }
  private async stream(sessionId: string, endpoint: AcpWorkspaceToolStreamEndpoint, args: Record<string, unknown>, signal: AbortSignal): Promise<RemoteGatewayStream> {
    const values: unknown[] = []; const waiters: Array<(result: IteratorResult<unknown>) => void> = []; let done = false
    const push = (value: unknown) => { const waiter = waiters.shift(); if (waiter) waiter({ done: false, value }); else values.push(value) }
    const close = () => { done = true; for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined }) }
    const nativeId = sessionId.replace(/^\w+:/u, '')
    const scope = `${this.backend === 'antigravity' ? 'acp' : this.backend}:${nativeId}`
    const scopedArgs = endpoint === 'terminal/retain' || endpoint === 'terminal/follow'
      ? { sessionId: scope, ...args }
      : { workspaceFileScopeId: scope, ...args }
    const stream = await this.client.openStream(nativeId, (frame: AgentAcpFrameData) => {
      const params = frame.frame.params
      push(typeof params === 'object' && params !== null && 'value' in params ? (params as { value: unknown }).value : params)
    }, close, signal, { backend: this.backend, endpoint, args: scopedArgs })
    return { [Symbol.asyncIterator]: async function* () { while (!done || values.length) { if (values.length) yield values.shift(); else if (done) return; else yield await new Promise<unknown>(resolve => waiters.push(result => resolve(result.value))) } }, close: async (notify = true) => { close(); if (notify) await stream.close() } }
  }
}
