import { z } from 'zod'

export const LAN_UPLOAD_CAPABILITY = 'workspace.upload.lan.v1' as const
export const LAN_UPLOAD_MIN_BYTES = 1024 * 1024
export const LAN_UPLOAD_TICKET_MS = 10_000
export const LAN_UPLOAD_CONNECT_MS = 3_000
export const lanUploadScopeSchema = z.object({
  sessionId: z.string().min(1).max(512),
  uploadId: z.string().uuid(),
}).strict()
export const lanUploadRequestSchema = lanUploadScopeSchema.extend({ address: z.string().max(64) }).strict()
export const lanUploadOfferSchema = lanUploadScopeSchema.extend({
  connectionId: z.string().min(1).max(512),
  url: z.string().max(512),
  expiresInMs: z.number().int().positive().max(LAN_UPLOAD_TICKET_MS),
}).strict()
export type LanUploadOffer = z.infer<typeof lanUploadOfferSchema>

/** Literal RFC1918 IPv4 only. IPv6 and other address families use the normal carrier. */
export function isLanUploadAddress(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255 || String(Number(p)) !== p)) return false
  const [a, b] = parts.map(Number)
  return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168)
}

export function validateLanUploadOffer(input: unknown, scope: {connectionId: string; sessionId: string; uploadId: string; address: string}): LanUploadOffer {
  const offer = lanUploadOfferSchema.parse(input)
  const url = new URL(offer.url)
  if (!isLanUploadAddress(scope.address) || url.protocol !== 'ws:' || url.hostname !== scope.address
    || !url.port || Number(url.port) < 1 || Number(url.port) > 65535 || url.username || url.password || url.search || url.hash
    || !/^\/ds-harness-remote\/upload\/[A-Za-z0-9_-]{43}$/.test(url.pathname)
    || offer.connectionId !== scope.connectionId || offer.sessionId !== scope.sessionId || offer.uploadId !== scope.uploadId) {
    throw new Error('Invalid LAN upload offer')
  }
  return offer
}

/** Domain-separated from the main carrier; binds the new Noise transcript to its owner and ticket. */
export function createLanUploadPrologue(offer: LanUploadOffer): Uint8Array {
  const ticket = new URL(offer.url).pathname.split('/').at(-1)!
  return new TextEncoder().encode(JSON.stringify(['ds-harness-remote/lan-upload/v1', offer.connectionId, offer.sessionId, offer.uploadId, ticket]))
}
