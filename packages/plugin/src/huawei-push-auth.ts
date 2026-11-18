import { constants, createPrivateKey, sign } from 'node:crypto'

// Huawei Push Kit service account JWT: https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/push-jwt-token
const AUDIENCE = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token'

export interface HuaweiPushServiceAccount {
  project_id: string
  key_id: string
  sub_account: string
  private_key: string
}

/** Parse a service account supplied through a secure runtime environment variable. */
export function parseHuaweiPushServiceAccount(value: string): HuaweiPushServiceAccount {
  let data: unknown
  try {
    data = JSON.parse(value)
  } catch {
    throw new Error('Invalid Huawei Push service account configuration')
  }
  return validateHuaweiPushServiceAccount(data)
}

function validateHuaweiPushServiceAccount(data: unknown): HuaweiPushServiceAccount {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Invalid Huawei Push service account configuration')
  }
  const fields = data as Record<string, unknown>
  for (const field of ['project_id', 'key_id', 'sub_account', 'private_key']) {
    if (typeof fields[field] !== 'string' || fields[field].trim().length === 0) {
      throw new Error('Invalid Huawei Push service account configuration')
    }
  }
  return {
    project_id: fields.project_id as string,
    key_id: fields.key_id as string,
    sub_account: fields.sub_account as string,
    private_key: fields.private_key as string,
  }
}

/** Create the short-lived authorization token locally; never log or persist it. */
export function createHuaweiPushJwt(account: HuaweiPushServiceAccount, now = Date.now()): string {
  account = validateHuaweiPushServiceAccount(account)
  const issuedAt = Math.floor(now / 1000)
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || !Number.isSafeInteger(issuedAt + 3600)) throw new Error('Invalid JWT issue time')
  let privateKey: ReturnType<typeof createPrivateKey>
  try {
    privateKey = createPrivateKey(account.private_key)
    if (privateKey.asymmetricKeyType !== 'rsa' || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error()
  } catch {
    throw new Error('Invalid Huawei Push service account private key')
  }
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const input = `${encode({ kid: account.key_id, typ: 'JWT', alg: 'PS256' })}.${encode({ aud: AUDIENCE, iss: account.sub_account, iat: issuedAt, exp: issuedAt + 3600 })}`
  try {
    const signature = sign('sha256', Buffer.from(input), {
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
    return `${input}.${signature.toString('base64url')}`
  } catch {
    throw new Error('Unable to sign Huawei Push authorization token')
  }
}
