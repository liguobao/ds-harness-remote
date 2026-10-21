import { randomUUID } from 'node:crypto'
import { RpcError } from '../safe-error.js'
type Obj = Record<string, unknown>
const object = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {}
type Detail = {threadId: string; record: unknown; bytes: number; until: number}
const details = new WeakMap<object, Map<string, Detail>>()
const MAX_CACHE = 16 * 1024 * 1024
const size = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8')
/** Ephemeral read-only detail handles are bound to one authenticated peer, never written to disk. */
export async function previewCall(peer: object, input: unknown, invoke: (input: unknown) => Promise<unknown>): Promise<unknown> {
  const call = object(input), params = object(call.params)
  if (call.method === 'dsh/historyDetail') {
    if (Object.keys(call).some(k => !['method', 'params'].includes(k)) || Object.keys(params).some(k => !['threadId', 'detailId'].includes(k))
      || typeof params.threadId !== 'string' || typeof params.detailId !== 'string') throw new RpcError('INVALID_MESSAGE', 'Invalid history detail request.')
    const detail = details.get(peer)?.get(params.detailId)
    if (!detail || detail.threadId !== params.threadId || detail.until < Date.now()) throw new RpcError('HISTORY_DETAIL_EXPIRED', 'Tool details expired. Reopen the conversation and try again.')
    await invoke({method: 'thread/read', params: {threadId: detail.threadId, includeTurns: false}})
    return detail.record
  }
  if (call.previewHistory !== true) return invoke(input)
  if (call.method !== 'dsh/sessionHistory' || Object.keys(call).some(k => !['method', 'params', 'previewHistory'].includes(k)))
    throw new RpcError('INVALID_MESSAGE', 'History preview is read-only.')
  const result = object(await invoke({method: call.method, params: call.params}))
  if (!Array.isArray(result.records) || typeof params.threadId !== 'string') return result
  let cache = details.get(peer)
  if (!cache) details.set(peer, cache = new Map())
  for (const [id, value] of cache) if (value.until < Date.now()) cache.delete(id)
  const records = result.records.map(raw => {
    const record = object(raw), event = object(record.event), data = object(event.data)
    if (event.type !== 'tool/result' || size(record) < 4096) return raw
    const bytes = size(record)
    if (bytes > MAX_CACHE) return raw
    while (cache!.size >= 64 || [...cache!.values()].reduce((n, v) => n + v.bytes, 0) + bytes > MAX_CACHE) cache!.delete(cache!.keys().next().value!)
    const id = randomUUID()
    cache!.set(id, {threadId: params.threadId as string, record: raw, bytes, until: Date.now() + 10 * 60_000})
    const message = object(data.message)
    return {...record, view: undefined, event: {...event, data: {
      id: data.id, callId: data.callId, name: data.name, toolName: data.toolName, turn: data.turn, step: data.step,
      message: {source: message.source, isError: message.isError === true || (Array.isArray(message.content) && message.content.some(v => object(v).isError === true)), content: [{type: 'text', text: 'Expand to load tool output'}]},
      isError: data.isError === true, failed: data.failed, error: data.error ? {message: 'Tool execution failed'} : undefined,
      remoteDetail: {threadId: params.threadId, detailId: id},
    }}}
  })
  const preview = {...result, records}
  if (size(preview) > 2 * 1024 * 1024) throw new RpcError('RESPONSE_TOO_LARGE', 'History requires chunked transfer.')
  return preview
}
