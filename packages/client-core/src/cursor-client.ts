import type {
  CursorAppFrameData,
  CursorAppStreamClosedData,
  CursorAppTransferCommitResult,
  CursorAppTransferReadResult,
} from '@dsh-remote/protocol'
import {
  CURSOR_APP_TRANSFER_CHUNK_BYTES,
  MAX_CURSOR_APP_TRANSFER_BYTES,
} from '@dsh-remote/protocol'
import type { RemoteClientCore } from './index.js'
import { createRemoteId, RemoteGatewayError } from './remote-gateway.js'

export type CursorAgentBackend = 'cursor'

export interface CursorRemoteSession {
  sessionId: string
  cwd?: string
  mode?: 'agent' | 'plan' | 'ask'
}

export interface CursorStream {
  streamId: string
  close(): Promise<void>
}

/** Shared Web/Android client for the independent Cursor ACP domain in Remote. */
export class CursorRemoteClient {
  constructor(private readonly core: RemoteClientCore) {}

  async call(method: string, params: unknown = {}, signal?: AbortSignal): Promise<unknown> {
    return this.core.rpc('cursor.app.call', { method, params }, signal)
  }

  async respond(
    requestHandle: string,
    decision: 'allow-once' | 'allow-always' | 'reject-once' | 'cancel',
    result?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.core.rpc('cursor.app.respond', {
      requestHandle,
      decision,
      ...(result === undefined ? {} : { result }),
    }, signal)
  }

  async createSession(cwd: string, mode?: 'agent' | 'plan' | 'ask', signal?: AbortSignal): Promise<CursorRemoteSession> {
    const result = await this.call('session/new', {
      cwd,
      mcpServers: [],
      ...(mode === undefined ? {} : { mode }),
    }, signal)
    const sessionId = readString(result, 'sessionId')
    if (sessionId === undefined) throw new RemoteGatewayError('INVALID_RESPONSE', 'Cursor session/new did not return sessionId.')
    return {
      sessionId,
      cwd,
      ...(mode === undefined ? {} : { mode }),
    }
  }

  async prompt(sessionId: string, text: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    }, signal)
  }

  async cancel(sessionId: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('session/cancel', { sessionId }, signal)
  }

  async listDirectory(path: string, signal?: AbortSignal): Promise<unknown> {
    return this.call('dsh/directoryList', { path }, signal)
  }

  async openStream(
    sessionId: string,
    onFrame: (frame: CursorAppFrameData) => void,
    onClosed?: (closed: CursorAppStreamClosedData) => void,
    signal?: AbortSignal,
  ): Promise<CursorStream> {
    const streamId = createRemoteId()
    const unsubscribe = this.core.onEvent(event => {
      if (event.event === 'cursor.app.frame' && isRecord(event.data) && event.data.streamId === streamId) {
        onFrame(event.data as unknown as CursorAppFrameData)
      }
      if (event.event === 'cursor.app.stream.closed' && isRecord(event.data) && event.data.streamId === streamId) {
        onClosed?.(event.data as unknown as CursorAppStreamClosedData)
      }
    })
    try {
      await this.core.rpc('cursor.app.stream.open', { streamId, sessionId }, signal)
    } catch (error) {
      unsubscribe()
      throw error
    }
    return {
      streamId,
      close: async () => {
        unsubscribe()
        await this.core.rpc('cursor.app.stream.close', { streamId }).catch(() => undefined)
      },
    }
  }

  async transferCall(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const requestBytes = new TextEncoder().encode(JSON.stringify({ method, params }))
    if (requestBytes.byteLength > MAX_CURSOR_APP_TRANSFER_BYTES) {
      throw new RemoteGatewayError('REQUEST_TOO_LARGE', 'The Cursor transfer request exceeds the bounded limit.')
    }
    const transferId = createRemoteId()
    const totalChunks = Math.ceil(requestBytes.byteLength / CURSOR_APP_TRANSFER_CHUNK_BYTES)
    await this.core.rpc('cursor.app.transfer.open', {
      transferId,
      totalBytes: requestBytes.byteLength,
      totalChunks,
    }, signal)
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * CURSOR_APP_TRANSFER_CHUNK_BYTES
      const end = Math.min(start + CURSOR_APP_TRANSFER_CHUNK_BYTES, requestBytes.byteLength)
      await this.core.rpc('cursor.app.transfer.chunk', {
        transferId,
        index,
        data: bytesToCanonicalBase64(requestBytes.subarray(start, end)),
      }, signal)
    }
    const commit = await this.core.rpc('cursor.app.transfer.commit', { transferId }, signal) as CursorAppTransferCommitResult
    if (commit.kind === 'inline') return commit.response
    const chunks: Uint8Array[] = []
    for (let index = 0; index < commit.totalChunks; index += 1) {
      const part = await this.core.rpc('cursor.app.transfer.read', { transferId, index }, signal) as CursorAppTransferReadResult
      chunks.push(canonicalBase64ToBytes(part.data))
    }
    await this.core.rpc('cursor.app.transfer.close', { transferId }).catch(() => undefined)
    const bytes = concat(chunks, commit.totalBytes)
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  }
}

function readString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function concat(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function bytesToCanonicalBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary)
}

function canonicalBase64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
