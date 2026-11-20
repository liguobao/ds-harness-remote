import { isLanUploadAddress } from './lan-upload.js'
import { z } from 'zod'

export const DSH_WEB_CAPABILITY = 'dsh.web.v1'
export const dshWebGrantSchema = z.object({
  url: z.url().refine(value => {
    const url = new URL(value)
    return url.protocol === 'https:' && url.href === url.origin + '/'
  }),
  browserGrant: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().positive(),
}).strict()

export type DshWebGrant = z.infer<typeof dshWebGrantSchema>

export const DSH_WEB_LAN_CAPABILITY = 'dsh.web.lan.direct.v1'
export const DSH_WEB_LAN_IPV6_CAPABILITY = 'dsh.web.lan.ipv6.v1'
const globalIpv6AddressSchema = z.ipv6().refine(address => /^[23][0-9a-f]{3}:/i.test(address))
export const sameLinkIpv6PairSchema = z.object({
  hostAddress: globalIpv6AddressSchema,
  hostPort: z.number().int().min(1).max(65_535),
  peerAddress: globalIpv6AddressSchema,
  peerPort: z.number().int().min(1).max(65_535),
}).strict()
export type SameLinkIpv6Pair = z.infer<typeof sameLinkIpv6PairSchema>

export function isDshWebLanAddress(address: string): boolean {
  return address === '127.0.0.1' || isLanUploadAddress(address)
}

export const dshWebLanOpenSchema = z.object({ sameLinkIpv6Pair: sameLinkIpv6PairSchema.optional() }).strict()
export const dshWebLanSessionSchema = z.object({ sessionId: z.uuid() }).strict()
export const dshWebLanGrantSchema = dshWebGrantSchema.extend({
  sessionId: z.uuid(),
  url: z.url().refine(value => {
    const url = new URL(value)
    const host = url.hostname
    const ipv6 = host.startsWith('[') && host.endsWith(']') && globalIpv6AddressSchema.safeParse(host.slice(1, -1)).success
    return url.protocol === 'http:' && (isDshWebLanAddress(host) || ipv6) && !!url.port && value === url.origin + '/'
  }),
})
