import { constants, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createHuaweiPushJwt, parseHuaweiPushServiceAccount } from '../src/huawei-push-auth.js'

describe('Huawei Push service account authentication', () => {
  it('creates a verifiable PS256 JWT with the documented claims', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const account = parseHuaweiPushServiceAccount(JSON.stringify({
      project_id: 'project', key_id: 'key', sub_account: 'account',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }))
    const [header, payload, signature] = createHuaweiPushJwt(account, 1_700_000_000_000).split('.')
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ kid: 'key', typ: 'JWT', alg: 'PS256' })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      aud: 'https://oauth-login.cloud.huawei.com/oauth2/v3/token', iss: 'account',
      iat: 1_700_000_000, exp: 1_700_003_600,
    })
    expect(verify('sha256', Buffer.from(`${header}.${payload}`), {
      key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32,
    }, Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('rejects invalid configuration without revealing the supplied value', () => {
    for (const input of ['sensitive invalid input', '{}', '[]', '{"private_key":"sensitive"}']) {
      expect(() => parseHuaweiPushServiceAccount(input)).toThrow('Invalid Huawei Push service account configuration')
    }
    expect(() => createHuaweiPushJwt({ project_id: 'p', key_id: 'k', sub_account: 's', private_key: 'sensitive' }))
      .toThrow('Invalid Huawei Push service account private key')
    const weakKey = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
    expect(() => createHuaweiPushJwt({ project_id: 'p', key_id: 'k', sub_account: 's', private_key: weakKey.toString() }))
      .toThrow('Invalid Huawei Push service account private key')
    expect(() => createHuaweiPushJwt({ project_id: 'p', key_id: '', sub_account: 's', private_key: 'x' }))
      .toThrow('Invalid Huawei Push service account configuration')
  })
})

import { sendHuaweiWakeup } from '../src/huawei-push-sender.js'

describe('Huawei Push wake-up transport', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const account = {
    project_id: '123', key_id: 'key', sub_account: 'account',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }

  it('sends only a fixed notification to the documented endpoint', async () => {
    let url = ''
    let request: RequestInit | undefined
    const fetcher: typeof fetch = async (input, init) => {
      url = String(input)
      request = init
      return new Response('{}', { status: 200 })
    }
    expect(await sendHuaweiWakeup(account, 'device-token', fetcher)).toEqual({ httpStatus: 200 })
    expect(url).toBe('https://push-api.cloud.huawei.com/v3/123/messages:send')
    expect(request?.redirect).toBe('error')
    expect(request?.headers).toMatchObject({ 'Content-Type': 'application/json', 'push-type': '0' })
    expect(JSON.parse(String(request?.body))).toEqual({
      payload: { notification: { category: 'WORK', title: '远程会话', body: '请打开应用查看新动态', clickAction: { actionType: 0 } } },
      target: { token: ['device-token'] }, pushOptions: { testMessage: false },
    })
  })

  it('treats transport errors as unknown and does not retry', async () => {
    let attempts = 0
    const fetcher: typeof fetch = async () => { attempts++; throw new Error('sensitive network details') }
    expect(await sendHuaweiWakeup(account, 'device-token', fetcher)).toEqual({ httpStatus: null })
    expect(attempts).toBe(1)
    await expect(sendHuaweiWakeup({ ...account, project_id: '../bad' }, 'token', fetcher)).rejects.toThrow('Invalid Huawei Push destination')
    expect(attempts).toBe(1)
  })
})
