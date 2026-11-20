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
export function isDshWebLanAddress(address: string): boolean {
  return address === '127.0.0.1' || isLanUploadAddress(address)
}

export const dshWebLanOpenSchema = z.object({}).strict()
export const dshWebLanSessionSchema = z.object({ sessionId: z.uuid() }).strict()
export const dshWebLanGrantSchema = dshWebGrantSchema.extend({
  sessionId: z.uuid(),
  url: z.url().refine(value => {
    const url = new URL(value)
    return url.protocol === 'http:' && isDshWebLanAddress(url.hostname) && !!url.port && value === url.origin + '/'
  }),
})
