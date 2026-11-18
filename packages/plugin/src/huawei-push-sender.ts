import { createHuaweiPushJwt, type HuaweiPushServiceAccount } from './huawei-push-auth.js'

export interface HuaweiPushNoticeOptions {
  title?: string
  body?: string
  sessionId?: string
  eventType?: 'done' | 'approval' | 'question' | 'error'
}

// https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/push-scenes-send
// HTTP success is not proof of provider acceptance or delivery; the caller must not infer either.
export async function sendHuaweiWakeup(
  account: HuaweiPushServiceAccount,
  deviceToken: string,
  optionsOrFetcher: HuaweiPushNoticeOptions | typeof fetch = fetch,
  maybeFetcher: typeof fetch = fetch,
): Promise<{ httpStatus: number } | { httpStatus: null }> {
  const options: HuaweiPushNoticeOptions = typeof optionsOrFetcher === 'function' ? {} : optionsOrFetcher
  const fetcher: typeof fetch = typeof optionsOrFetcher === 'function' ? optionsOrFetcher : maybeFetcher
  if (!/^[0-9]+$/.test(account.project_id) || !deviceToken || deviceToken.length > 4096) {
    throw new Error('Invalid Huawei Push destination')
  }
  const jwt = createHuaweiPushJwt(account)
  const clickAction = options.sessionId
    ? {
        actionType: 1,
        action: 'action.dshremote.open_session',
        data: { sessionId: options.sessionId, ...(options.eventType ? { eventType: options.eventType } : {}) },
      }
    : { actionType: 0 }
  try {
    const response = await fetcher(`https://push-api.cloud.huawei.com/v3/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, 'push-type': '0' },
      body: JSON.stringify({
        payload: {
          notification: {
            category: 'WORK',
            title: options.title || '远程会话',
            body: options.body || '请打开应用查看新动态',
            clickAction,
          },
        },
        target: { token: [deviceToken] },
        pushOptions: { testMessage: false },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    await response.body?.cancel().catch(() => undefined)
    return { httpStatus: response.status }
  } catch {
    // A transport error can occur after the provider received the request.
    return { httpStatus: null }
  }
}
