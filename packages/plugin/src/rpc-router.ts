import {
  createRpcError,
  createRpcResponse,
  type RemoteMessage,
  type RpcErrorPayload,
  type RpcRequestPayload,
} from '@dsh-remote/protocol'
import { z } from 'zod'
import type { RemoteFileViewerBridge } from './file-viewer-bridge.js'
import type { HarnessApiBridge } from './harness-api-bridge.js'
import type { HarnessRemoteBridge } from './harness-remote-bridge.js'
import type { SafeLogger } from './logging.js'
import type { CodexPeerBridge } from './codex/peer-bridge.js'
import type { CursorPeerBridge } from './cursor/peer-bridge.js'
import { RpcError, safeErrorCode } from './safe-error.js'

export { RpcError } from './safe-error.js'

const wireRequestSchema = z.object({ method: z.string().min(1), params: z.unknown() }).strict()
const emptyParamsSchema = z.object({}).strict()
const apiMethods = new Set([
  'harness.transport.describe',
  'harness.api.call',
  'harness.api.transfer.open',
  'harness.api.transfer.chunk',
  'harness.api.transfer.commit',
  'harness.api.transfer.read',
  'harness.api.transfer.close',
  'harness.api.respond',
  'harness.api.stream.open',
  'harness.api.stream.close',
  'harness.remote.call',
  'harness.remote.transfer.open',
  'harness.remote.transfer.chunk',
  'harness.remote.transfer.commit',
  'harness.remote.transfer.read',
  'harness.remote.transfer.close',
  'harness.remote.stream.open',
  'harness.remote.stream.close',
  'fileviewer.call',
  'codex.app.call',
  'codex.app.respond',
  'codex.app.stream.open',
  'codex.app.stream.close',
  'codex.app.transfer.open',
  'codex.app.transfer.chunk',
  'codex.app.transfer.commit',
  'codex.app.transfer.read',
  'codex.app.transfer.close',
  'cursor.app.call',
  'cursor.app.respond',
  'cursor.app.stream.open',
  'cursor.app.stream.close',
  'cursor.app.transfer.open',
  'cursor.app.transfer.chunk',
  'cursor.app.transfer.commit',
  'cursor.app.transfer.read',
  'cursor.app.transfer.close',
])

export const HOST_CAPABILITIES = [
  'harness.api.v1',
  'harness.api.transfer.v1',
  'harness.remote.v1',
  'harness.remote.transfer.v1',
  'fileviewer.read.v1',
  'codex.appserver.v1',
  'codex.appserver.transfer.v1',
  'cursor.acp.v1',
  'cursor.acp.transfer.v1',
] as const

export class RpcRouter {
  private active = 0

  constructor(
    private readonly harnessApi: HarnessApiBridge | undefined,
    private readonly maxPending = 128,
    private readonly logger?: SafeLogger,
    private readonly fileViewer?: RemoteFileViewerBridge,
    private readonly harnessRemote?: HarnessRemoteBridge,
    private readonly capabilities: () => readonly string[] = () => HOST_CAPABILITIES,
    private readonly codex?: CodexPeerBridge,
    private readonly cursor?: CursorPeerBridge,
  ) {}

  async closePeerStreams(): Promise<void> {
    await Promise.all([
      this.harnessApi?.closeAll(),
      this.harnessRemote?.closeAll(),
      this.codex?.closeAll(),
      this.cursor?.closeAll(),
    ])
  }

  async handle(message: RemoteMessage): Promise<RemoteMessage> {
    if (message.type !== 'rpc.request') {
      return createRpcError(message.id, 'INVALID_MESSAGE', 'Only RPC requests are accepted on the Host business channel.')
    }
    const parsedPayload = wireRequestSchema.safeParse(message.payload)
    if (!parsedPayload.success) return createRpcError(message.id, 'INVALID_MESSAGE', 'The RPC request payload is invalid.')
    if (!apiMethods.has(parsedPayload.data.method)) {
      return createRpcError(message.id, 'METHOD_NOT_FOUND', 'The requested method does not exist.')
    }
    const request = message as RemoteMessage<RpcRequestPayload>
    if (this.active >= this.maxPending) {
      return createRpcError(request.id, 'RATE_LIMITED', 'Too many Host requests are already pending.', undefined, true)
    }
    this.active += 1
    const startedAt = performance.now()
    try {
      const result = await this.invoke(request.payload.method, request.payload.params)
      this.logger?.debug('host rpc ok', {
        method: request.payload.method,
        durationMs: Math.round(performance.now() - startedAt),
      })
      return createRpcResponse(request.id, result)
    } catch (error: unknown) {
      const response = errorResponse(request.id, error)
      this.logger?.warn('host rpc failed', {
        method: request.payload.method,
        durationMs: Math.round(performance.now() - startedAt),
        code: response.payload.code,
        retryable: response.payload.retryable,
      })
      return response
    } finally {
      this.active -= 1
    }
  }

  private invoke(method: string, params: unknown): Promise<unknown> | unknown {
    switch (method) {
      case 'harness.transport.describe': {
        emptyParamsSchema.parse(params)
        return { capabilities: [...this.capabilities()] }
      }
      case 'harness.api.call': return this.requireApiProxy().call(params)
      case 'harness.api.transfer.open': return this.requireApiProxy().openTransfer(params)
      case 'harness.api.transfer.chunk': return this.requireApiProxy().appendTransfer(params)
      case 'harness.api.transfer.commit': return this.requireApiProxy().commitTransfer(params)
      case 'harness.api.transfer.read': return this.requireApiProxy().readTransfer(params)
      case 'harness.api.transfer.close': return this.requireApiProxy().closeTransfer(params)
      case 'harness.api.respond': return this.requireApiProxy().respond(params)
      case 'harness.api.stream.open': return this.requireApiProxy().openStream(params)
      case 'harness.api.stream.close': return this.requireApiProxy().closeStream(params)
      case 'harness.remote.call': return this.requireRemoteGateway().call(params)
      case 'harness.remote.transfer.open': return this.requireRemoteGateway().openTransfer(params)
      case 'harness.remote.transfer.chunk': return this.requireRemoteGateway().appendTransfer(params)
      case 'harness.remote.transfer.commit': return this.requireRemoteGateway().commitTransfer(params)
      case 'harness.remote.transfer.read': return this.requireRemoteGateway().readTransfer(params)
      case 'harness.remote.transfer.close': return this.requireRemoteGateway().closeTransfer(params)
      case 'harness.remote.stream.open': return this.requireRemoteGateway().openStream(params)
      case 'harness.remote.stream.close': return this.requireRemoteGateway().closeStream(params)
      case 'fileviewer.call': {
        if (this.fileViewer === undefined) {
          throw new RpcError('FILE_VIEWER_UNAVAILABLE', 'The Remote Host does not have DSH File Viewer available.')
        }
        return this.fileViewer.call(params)
      }
      case 'codex.app.call': return this.requireCodex().call(params)
      case 'codex.app.respond': return this.requireCodex().respond(params)
      case 'codex.app.stream.open': return this.requireCodex().openStream(params)
      case 'codex.app.stream.close': return this.requireCodex().closeStream(params)
      case 'codex.app.transfer.open': return this.requireCodex().openTransfer(params)
      case 'codex.app.transfer.chunk': return this.requireCodex().appendTransfer(params)
      case 'codex.app.transfer.commit': return this.requireCodex().commitTransfer(params)
      case 'codex.app.transfer.read': return this.requireCodex().readTransfer(params)
      case 'codex.app.transfer.close': return this.requireCodex().closeTransfer(params)
      case 'cursor.app.call': return this.requireCursor().call(params)
      case 'cursor.app.respond': return this.requireCursor().respond(params)
      case 'cursor.app.stream.open': return this.requireCursor().openStream(params)
      case 'cursor.app.stream.close': return this.requireCursor().closeStream(params)
      case 'cursor.app.transfer.open': return this.requireCursor().openTransfer(params)
      case 'cursor.app.transfer.chunk': return this.requireCursor().appendTransfer(params)
      case 'cursor.app.transfer.commit': return this.requireCursor().commitTransfer(params)
      case 'cursor.app.transfer.read': return this.requireCursor().readTransfer(params)
      case 'cursor.app.transfer.close': return this.requireCursor().closeTransfer(params)
      default: throw new RpcError('METHOD_NOT_FOUND', 'The requested method does not exist.')
    }
  }

  private requireApiProxy(): HarnessApiBridge {
    if (this.harnessApi === undefined) {
      throw new RpcError('FEATURE_NOT_SUPPORTED', 'This Harness version does not provide the legacy ApiProxy transport.')
    }
    return this.harnessApi
  }

  private requireRemoteGateway(): HarnessRemoteBridge {
    if (this.harnessRemote === undefined) {
      throw new RpcError('FEATURE_NOT_SUPPORTED', 'This Harness version does not provide the Remote Gateway transport.')
    }
    return this.harnessRemote
  }

  private requireCodex(): CodexPeerBridge {
    if (this.codex === undefined) {
      throw new RpcError('FEATURE_NOT_SUPPORTED', 'Codex Remote is disabled or unavailable on this Host.')
    }
    return this.codex
  }

  private requireCursor(): CursorPeerBridge {
    if (this.cursor === undefined) {
      throw new RpcError('FEATURE_NOT_SUPPORTED', 'Cursor Remote is disabled or unavailable on this Host.')
    }
    return this.cursor
  }
}

function errorResponse(requestId: string, error: unknown): RemoteMessage<RpcErrorPayload> {
  const code = safeErrorCode(error)
  if (error instanceof RpcError) return createRpcError(requestId, code, error.message, error.details, error.retryable)
  return createRpcError(
    requestId,
    code,
    code === 'INVALID_MESSAGE' ? 'The RPC parameters are invalid.' : 'The Host could not complete the request.',
  )
}
