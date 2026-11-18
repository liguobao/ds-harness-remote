import { RemoteClientCore } from '@dsh-remote/client-core'
import type { CodexAppFrameData, CodexAppStreamClosedData } from '@dsh-remote/protocol'
import type { CodexLoopbackStream, ConnectedRemote, HostAuthorizationControl } from './client-runtime-contract.js'
import { ClientModeError, isRecord, record, waitForCodexFrames } from './client-runtime-contract.js'

/** Collaborates with one ClientModeRuntime; never creates a second session or connection state. */
export interface ClientCodexStreamsContext {
  readonly activeRemote: () => ConnectedRemote | undefined
  readonly codexStreams: Map<string, CodexLoopbackStream>
  readonly host: HostAuthorizationControl | undefined
}

export class ClientCodexStreams {
  constructor(private readonly context: ClientCodexStreamsContext) {}

  activeCodexRemote(): ConnectedRemote | undefined {
    const remote = this.context.activeRemote()
    if (remote === undefined) return undefined
    if (!remote.features.codex) {
      return undefined
    }
    return remote
  }

  async openCodexStream(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const remote = this.activeCodexRemote()
    const value = record(payload)
    if (typeof value.streamId !== 'string' || value.streamId.length === 0 || value.streamId.length > 128
      || typeof value.threadId !== 'string' || value.threadId.length === 0) {
      throw new ClientModeError('INVALID_MESSAGE', 'A Codex stream and thread are required.')
    }
    if (this.context.codexStreams.has(value.streamId)) throw new ClientModeError('REQUEST_CONFLICT', 'The Codex stream is already open.')
    let wake = () => undefined
    const stream: CodexLoopbackStream = {
      target: remote === undefined ? { kind: 'local' } : { kind: 'remote', client: remote.client },
      frames: [],
      approvalHandles: new Set(),
      unsubscribe: () => undefined,
      close: async () => {
        if (remote === undefined) {
          await this.context.host?.codexCloseStream?.({ streamId: value.streamId }).catch(() => undefined)
          return
        }
        await remote.client.rpc('codex.app.stream.close', { streamId: value.streamId }).catch(() => undefined)
      },
      wake: () => wake(),
    }
    if (remote === undefined) {
      const host = this.requireLocalCodex()
      this.context.codexStreams.set(value.streamId, stream)
      try {
        const result = await host.codexOpenStream({ streamId: value.streamId, threadId: value.threadId }, this.publishLocalCodexFrame, signal)
        return result
      } catch (error) {
        this.context.codexStreams.delete(value.streamId)
        stream.wake()
        throw error
      }
    }
    stream.unsubscribe = remote.client.onEvent(event => {
      if (event.event === 'codex.app.frame' && isRecord(event.data) && event.data.streamId === value.streamId) {
        this.appendCodexFrame(stream, event.data)
      }
      if (event.event === 'codex.app.stream.closed' && isRecord(event.data) && event.data.streamId === value.streamId) {
        stream.closed = typeof event.data.reason === 'string' ? event.data.reason : 'closed'
        stream.wake()
      }
    })
    try {
      // Subscribe before opening the Host stream so the first App Server
      // notification cannot race past the loopback listener.
      await remote.client.rpc('codex.app.stream.open', { streamId: value.streamId, threadId: value.threadId }, signal)
    } catch (error) {
      stream.unsubscribe()
      throw error
    }
    this.context.codexStreams.set(value.streamId, stream)
    return { opened: true, streamId: value.streamId, threadId: value.threadId }
  }

  readonly publishLocalCodexFrame = async (
    event: 'codex.app.frame' | 'codex.app.stream.closed',
    data: CodexAppFrameData | CodexAppStreamClosedData,
  ): Promise<void> => {
    const streamId = data.streamId
    const stream = this.context.codexStreams.get(streamId)
    if (stream === undefined || stream.target.kind !== 'local') return
    if (event === 'codex.app.frame') {
      this.appendCodexFrame(stream, data)
      return
    }
    const closed = data as CodexAppStreamClosedData
    stream.closed = typeof closed.reason === 'string' ? closed.reason : 'closed'
    stream.wake()
  }

  appendCodexFrame(stream: CodexLoopbackStream, data: unknown): void {
    if (!isRecord(data) || !isRecord(data.frame) || typeof data.frame.method !== 'string') return
    const method = data.frame.method
    if ((method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') && isRecord(data.frame.params)) {
      const handle = data.frame.params.requestHandle
      if (typeof handle === 'string' && handle.length > 0) {
        if (stream.approvalHandles.has(handle)) return
        stream.approvalHandles.add(handle)
      }
    }
    if (stream.frames.length >= 256) {
      stream.closed = 'overflow'
    } else {
      stream.frames.push({ method: data.frame.method, params: data.frame.params })
    }
    stream.wake()
  }

  localCodexAvailable(): boolean {
    return this.context.host?.codexStatus?.().available === true
  }

  requireLocalCodex(): Required<Pick<HostAuthorizationControl,
    'codexCall' | 'codexRespond' | 'codexOpenStream' | 'codexCloseStream'
  >> {
    if (!this.localCodexAvailable()
      || this.context.host?.codexCall === undefined
      || this.context.host.codexRespond === undefined
      || this.context.host.codexOpenStream === undefined
      || this.context.host.codexCloseStream === undefined) {
      throw new ClientModeError('FEATURE_NOT_SUPPORTED', 'Local CodeX is disabled or unavailable on this Host.')
    }
    return {
      codexCall: this.context.host.codexCall.bind(this.context.host),
      codexRespond: this.context.host.codexRespond.bind(this.context.host),
      codexOpenStream: this.context.host.codexOpenStream.bind(this.context.host),
      codexCloseStream: this.context.host.codexCloseStream.bind(this.context.host),
    }
  }

  async nextCodexFrames(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    const value = record(payload)
    if (typeof value.streamId !== 'string') throw new ClientModeError('INVALID_MESSAGE', 'A Codex stream is required.')
    const stream = this.context.codexStreams.get(value.streamId)
    if (stream === undefined) throw new ClientModeError('STREAM_NOT_FOUND', 'The Codex stream is not open.')
    // The first poll means the loopback consumer is ready to receive frames.
    if (stream.claim === undefined && stream.closed === undefined) {
      stream.claim = (async () => {
        try {
          const result = stream.target.kind === 'remote'
            ? await stream.target.client.rpc('codex.app.approvals.claim', { streamId: value.streamId })
            : await this.context.host?.codexClaimApprovals?.({ streamId: value.streamId })
          if (this.context.codexStreams.get(value.streamId as string) !== stream || stream.closed !== undefined) return
          if (isRecord(result) && Array.isArray(result.frames)) {
            for (const frame of result.frames) this.appendCodexFrame(stream, { frame })
          }
        } catch {
          // Older Hosts do not implement claim; live frames remain available.
        }
      })()
    }
    await stream.claim
    if (this.context.codexStreams.get(value.streamId) !== stream) throw new ClientModeError('STREAM_NOT_FOUND', 'The Codex stream is not open.')
    if (stream.frames.length === 0 && stream.closed === undefined) await waitForCodexFrames(stream, signal)
    const frames = stream.frames.splice(0, 100)
    return {
      streamId: value.streamId,
      frames,
      closed: stream.closed !== undefined,
      ...(stream.closed === undefined ? {} : { reason: stream.closed }),
    }
  }

  async closeCodexStream(payload: unknown): Promise<unknown> {
    const value = record(payload)
    if (typeof value.streamId !== 'string') throw new ClientModeError('INVALID_MESSAGE', 'A Codex stream is required.')
    const stream = this.context.codexStreams.get(value.streamId)
    if (stream === undefined) return { closed: false, streamId: value.streamId }
    this.context.codexStreams.delete(value.streamId)
    stream.unsubscribe()
    stream.wake()
    await stream.close()
    return { closed: true, streamId: value.streamId }
  }

  async closeCodexStreams(client?: RemoteClientCore): Promise<void> {
    const targets = [...this.context.codexStreams.entries()].filter(([, stream]) => (
      client === undefined || (stream.target.kind === 'remote' && stream.target.client === client)
    ))
    await Promise.all(targets.map(async ([streamId, stream]) => {
      this.context.codexStreams.delete(streamId)
      stream.unsubscribe()
      stream.closed = 'peer-disconnected'
      stream.wake()
      await stream.close()
    }))
  }
}
