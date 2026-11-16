import { lstat, readFile } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { RemoteTypertGatewayTarget } from './typert-gateway-contract.js'

const MAX_MENTION_BYTES = 192 * 1024 * 1024
const LOCAL_MENTION = /(^|\s)@(?:"([^"\r\n]+)"|([^\s]+))/gu

/** Stage client-local absolute @file mentions before the prompt crosses to a different Host. */
export async function uploadLocalMentions(
  payload: unknown,
  remote: RemoteTypertGatewayTarget,
  signal: AbortSignal,
  platform = process.platform,
  fileIO: Pick<typeof import('node:fs/promises'), 'lstat' | 'readFile'> = { lstat, readFile },
): Promise<unknown> {
  if (!isMentionRecord(payload) || !isMentionRecord(payload.args) || !isMentionRecord(payload.args.request)) return payload
  const request = payload.args.request
  if (typeof request.sessionId !== 'string' || !Array.isArray(request.content)) return payload
  const content: unknown[] = []
  let uploaded = 0
  let seen = 0
  let staged = 0
  for (const block of request.content) {
    if (!isMentionRecord(block) || block.type !== 'text' || typeof block.text !== 'string') { content.push(block); continue }
    const matches = [...block.text.matchAll(LOCAL_MENTION)].filter(match =>
      (platform === 'win32' ? win32 : posix).isAbsolute(match[2] ?? match[3]!))
    if (matches.length === 0) { content.push(block); continue }
    let cursor = 0
    for (const match of matches) {
      signal.throwIfAborted()
      const start = match.index! + (match[1]?.length ?? 0)
      if (start > cursor) content.push({ ...block, text: block.text.slice(cursor, start) })
      const path = match[2] ?? match[3]!
      // A path may exist on both machines. The selected remote workspace owns
      // its file-reference candidates, so its exact match takes precedence.
      const candidates = await remote.dispatch('fileReferences/list', { args: {
        agentId: request.sessionId, query: path,
      } }, signal)
      if (candidates.ok && Array.isArray(candidates.value) && candidates.value.some(candidate =>
        isMentionRecord(candidate) && candidate.kind === 'file' && candidate.path === path)) continue
      if (++seen > 4) throw new Error('Remote supports at most four absolute local file mentions per message.')
      let file: Awaited<ReturnType<typeof fileIO.lstat>>
      try { file = await fileIO.lstat(path) }
      catch (error) {
        if (isMissingFile(error)) continue
        throw error
      }
      if (!file.isFile() || file.isSymbolicLink() || uploaded + file.size > MAX_MENTION_BYTES) {
        throw new Error('The selected local file is unavailable or exceeds the Remote transfer limit.')
      }
      uploaded += file.size
      const data = (await fileIO.readFile(path, { signal })).toString('base64')
      const result = await remote.dispatch('fileUploads/upload', { args: {
        agentId: request.sessionId, request: { data, name: (platform === 'win32' ? win32 : posix).basename(path) },
      } }, signal)
      if (!result.ok) throw new Error(result.error.message)
      const value = result.value as { receiptId?: unknown } | undefined
      if (typeof value?.receiptId !== 'string' || value.receiptId.length === 0) throw new Error('The Remote Host did not return a file receipt.')
      content.push({ type: 'file', receiptId: value.receiptId })
      staged++
      cursor = match.index! + match[0].length
    }
    if (cursor < block.text.length) content.push({ ...block, text: block.text.slice(cursor) })
  }
  return staged === 0 ? payload : { ...payload, args: { ...payload.args, request: { ...request, content } } }
}

function isMentionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
  return isMentionRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}
