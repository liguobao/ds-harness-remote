import { z } from 'zod'
import { RpcError } from '../safe-error.js'

const id = z.string().min(1).max(256)
const cwd = z.string().min(1).max(4096)
const mode = z.enum(['agent', 'plan', 'ask'])
const promptBlock = z.object({
  type: z.literal('text'),
  text: z.string().min(1).max(256 * 1024),
}).strict()

const schemas = {
  'initialize': z.object({
    protocolVersion: z.number().int().positive().optional(),
    clientInfo: z.object({
      name: z.string().min(1).max(128).optional(),
      version: z.string().min(1).max(128).optional(),
    }).strict().optional(),
  }).strict(),
  'session/new': z.object({
    cwd,
    mcpServers: z.array(z.unknown()).max(0).optional(),
    mode: mode.optional(),
  }).strict(),
  'session/load': z.object({
    sessionId: id,
  }).strict(),
  'session/prompt': z.object({
    sessionId: id,
    prompt: z.array(promptBlock).min(1).max(16),
  }).strict(),
  'session/cancel': z.object({
    sessionId: id,
  }).strict(),
  'dsh/directoryList': z.object({
    path: z.string().min(1).max(4096),
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
  if (method === 'initialize' || method === 'session/new' || method === 'dsh/directoryList') return undefined
  if (typeof params.sessionId === 'string') return params.sessionId
  return undefined
}

export function isSessionMutation(method: AllowedAcpMethod): boolean {
  return method === 'session/prompt' || method === 'session/cancel'
}
