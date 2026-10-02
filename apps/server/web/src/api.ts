export interface Account { account: string }
export interface Device {
  deviceId: string; name: string; role: 'host' | 'client'; platform: string;
  clientVersion: string; harnessVersion?: string; online: boolean; lastSeenAt?: number;
}
export interface DeviceList { items: Device[]; serverUrl: string; transport: string }
export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    })
  } catch { throw new RequestError('连接失败，请重试。', 0) }
  const data = await response.json()
  if (!response.ok) {
    const messages: Record<string, string> = { AUTH_INVALID: '账号或密码错误，请重试。', ACCOUNT_AUTH_REQUIRED: '登录已过期，请重新登录。', RATE_LIMITED: '请求频繁，请稍后重试。' }
    throw new RequestError(messages[data.error?.code] ?? '请求失败，请稍后重试。', response.status)
  }
  return data as T
}
