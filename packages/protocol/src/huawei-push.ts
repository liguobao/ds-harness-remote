import { z } from 'zod'

export const HUAWEI_PUSH_CAPABILITY = 'push.huawei.v1' as const
export const huaweiPushRegisterSchema = z.object({
  token: z.string().min(1).max(4096).regex(/^[^\u0000-\u001f\u007f]+$/u),
}).strict()
export const huaweiPushUnregisterSchema = z.object({}).strict()
export const huaweiPushRegisterResultSchema = z.object({ registered: z.literal(true) }).strict()
export const huaweiPushUnregisterResultSchema = z.object({ unregistered: z.literal(true) }).strict()
