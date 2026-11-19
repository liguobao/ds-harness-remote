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
