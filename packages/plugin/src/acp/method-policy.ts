import { parseAcpImage } from './image-content.js'
import { z } from 'zod'
import { RpcError } from '../safe-error.js'

const id = z.string().min(1).max(256)
const cwd = z.string().min(1).max(4096)
const mode = z.enum(['agent', 'plan', 'ask'])
const textBlock = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(256 * 1024),
}).strict()

const imageBlock = z.object({ type: z.literal('image'), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), data: z.string().min(4).max(Math.ceil(8 * 1024 * 1024 / 3) * 4) }).strict().refine(value => {
  try { parseAcpImage(value); return true } catch { return false }
})
const promptBlock = z.union([textBlock, imageBlock])

const schemas = {
  'initialize': z.object({
    protocolVersion: z.number().int().positive().optional(),
    backend: z.string().min(1).max(64).optional(),
    clientInfo: z.object({
      name: z.string().min(1).max(128).optional(),
      version: z.string().min(1).max(128).optional(),
    }).strict().optional(),
  }).strict(),
  'session/new': z.object({
    cwd,
    backend: z.string().min(1).max(64).optional(),
    mcpServers: z.array(z.unknown()).max(0).optional(),
    mode: mode.optional(),
  }).strict(),
  'session/load': z.object({
    sessionId: id,
    backend: z.string().min(1).max(64).optional(),
  }).strict(),
  'session/prompt': z.object({
    sessionId: id,
    backend: z.enum(['cursor', 'antigravity']).optional(),
    prompt: z.array(promptBlock).min(1).max(16).refine(parts => parts.filter(part => part.type === 'image').length <= 4),
  }).strict(),
  'session/cancel': z.object({
    sessionId: id,
  }).strict(),
  'dsh/directoryList': z.object({
    path: z.string().min(1).max(4096),
  }).strict(),
  'dsh/workspaceList': z.object({
    backend: z.string().min(1).max(64).optional(),
  }).strict().optional(),
  'dsh/sessionList': z.object({
    path: z.string().min(1).max(4096).or(z.literal('')),
    backend: z.string().min(1).max(64).optional(),
    limit: z.number().int().positive().max(100).optional(),
    prewarm: z.boolean().optional(),
  }).strict(),
  'dsh/sessionHistory': z.object({
    sessionId: id,
    backend: z.string().min(1).max(64).optional(),
  }).strict(),
} as const

export type AllowedAcpMethod = keyof typeof schemas

export const ACP_METHOD_ALLOWLIST = Object.freeze(Object.keys(schemas) as AllowedAcpMethod[])

export function parseAcpCall(method: string, params: unknown): {
  method: AllowedAcpMethod
  params: Record<string, unknown>
} {
  if (!(method in schemas)) {
    throw new RpcError('METHOD_NOT_ALLOWED', 'The ACP method is not allowlisted for Remote.')
  }
  const schema = schemas[method as AllowedAcpMethod]
  const parsed = schema.safeParse(params ?? {})
  if (!parsed.success) {
    throw new RpcError('INVALID_MESSAGE', 'The ACP parameters are invalid.')
  }
  return { method: method as AllowedAcpMethod, params: parsed.data as Record<string, unknown> }
}

export function sessionIdFromParams(method: AllowedAcpMethod, params: Record<string, unknown>): string | undefined {
  if (
    method === 'initialize'
    || method === 'session/new'
    || method === 'dsh/directoryList'
    || method === 'dsh/workspaceList'
    || method === 'dsh/sessionList'
    || method === 'dsh/sessionHistory'
  ) return undefined
  if (typeof params.sessionId === 'string') return params.sessionId
  return undefined
}

export function isSessionMutation(method: AllowedAcpMethod): boolean {
  return method === 'session/prompt' || method === 'session/cancel'
}
