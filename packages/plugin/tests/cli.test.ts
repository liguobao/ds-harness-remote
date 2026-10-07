import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli.js'
import { IdentityStore, serverStorageDirectory } from '../src/identity-store.js'
import { HostServerApi } from '../src/server-api.js'
import { ServerCredentialStore } from '../src/server-credentials.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Remote CLI', () => {
  it('authorizes the TUI Host through the selected OAuth QR provider', async () => {
    const dshHome = join(tmpdir(), `dsh-remote-cli-${crypto.randomUUID()}`)
    directories.push(dshHome)
    const output = writer(true)
    const errors = writer()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith('/auth/oauth/qr/start?provider=github')) return json({
        qrId: 'github-qr-session-1234567890',
        scanUrl: 'https://dsh.r2049.cn/api/v1/auth/q/github-qr-session-1234567890',
        expiresIn: 600,
        provider: 'github',
      })
      if (url.endsWith('/auth/oauth/qr/github-qr-session-1234567890')) return json({
        status: 'complete',
        token: 'web-account-token-value',
      })
      if (url.endsWith('/auth/me')) return json({ account: 'host@example.com', isAdmin: false })
      if (url.endsWith('/devices/register')) return json(tokens())
      throw new Error(`unexpected request: ${url}`)
    }) as unknown as typeof fetch

    await expect(runCli(['login', 'github'], {
      env: { DSH_HOME: dshHome },
      stdout: output,
      stderr: errors,
      renderQr: vi.fn(async () => '<terminal-qr>'),
      createHostApi: (serverUrl, store) => new HostServerApi(serverUrl, store, fetchMock),
    })).resolves.toBe(0)

    expect(calls.map(call => call.url)).toEqual([
      'https://dsh.r2049.cn/api/v1/auth/oauth/qr/start?provider=github',
      'https://dsh.r2049.cn/api/v1/auth/oauth/qr/github-qr-session-1234567890',
      'https://dsh.r2049.cn/api/v1/auth/me',
      'https://dsh.r2049.cn/api/v1/devices/register',
    ])
    expect(output.text).toContain('<terminal-qr>')
    expect(output.text).toContain(`Authorization URL: \u001B]8;;https://dsh.r2049.cn/api/v1/auth/q/github-qr-session-1234567890\u0007https://dsh.r2049.cn/api/v1/auth/q/github-qr-session-1234567890\u001B]8;;\u0007`)
    expect(output.text).toContain('Remote Host login complete for host@example.com.')
    expect(output.text).toContain('Restart dsh-tui')
    expect(output.text).not.toContain('web-account-token-value')
    expect(output.text).not.toContain('access-token-value')
    expect(errors.text).toBe('')

    const directory = serverStorageDirectory(join(dshHome, 'remote'), 'https://dsh.r2049.cn', 'host')
    const device = JSON.parse(await readFile(join(directory, 'device.json'), 'utf8')) as { deviceId: string }
    await expect(new ServerCredentialStore(directory).load('https://dsh.r2049.cn', device.deviceId))
      .resolves.toMatchObject({ authorizationMethod: 'account', account: 'host@example.com' })
  })

  it('defaults login to Zhihu and reports an expired QR session', async () => {
    const dshHome = join(tmpdir(), `dsh-remote-cli-expired-${crypto.randomUUID()}`)
    directories.push(dshHome)
    const output = writer()
    const errors = writer()
    const start = vi.fn(async () => ({
      qrId: 'zhihu-qr-session-1234567890',
      scanUrl: 'https://dsh.r2049.cn/api/v1/auth/q/zhihu-qr-session-1234567890',
      expiresIn: 600,
    }))
    const poll = vi.fn(async () => ({ status: 'expired' as const }))

    await expect(runCli(['login'], {
      env: { DSH_HOME: dshHome },
      stdout: output,
      stderr: errors,
      renderQr: async () => '<zhihu-qr>',
      createHostApi: () => ({
        startOAuthQrLogin: start,
        pollOAuthQrLogin: poll,
        bindIdentity: vi.fn(),
        authenticate: vi.fn(),
        revokeCurrentDevice: vi.fn(),
        authorizeHostWithCode: vi.fn(),
      }),
    })).resolves.toBe(1)

    expect(start).toHaveBeenCalledWith('zhihu')
    expect(output.text).toContain('<zhihu-qr>')
    expect(output.text).toContain('GitHub is also supported: ds-harness-remote login github')
    expect(errors.text).toContain('QR login expired')
  })

  it('revokes the Host and rotates its local identity on logout', async () => {
    const dshHome = join(tmpdir(), `dsh-remote-cli-logout-${crypto.randomUUID()}`)
    directories.push(dshHome)
    const env = { DSH_HOME: dshHome }
    const root = new IdentityStore({ env }).directory
    const directory = serverStorageDirectory(root, 'https://dsh.r2049.cn', 'host')
    const identities = new IdentityStore({ directory, env })
    const original = await identities.loadOrCreate('CLI test Host')
    await new ServerCredentialStore(directory).save({
      serverUrl: 'https://dsh.r2049.cn',
      deviceId: original.deviceId,
      authorizationMethod: 'account',
      account: 'host@example.com',
      ...tokens(),
    })
    const output = writer()
    const revoke = vi.fn(async () => undefined)

    await expect(runCli(['logout'], {
      env,
      stdout: output,
      createHostApi: () => ({
        startOAuthQrLogin: vi.fn(),
        pollOAuthQrLogin: vi.fn(),
        bindIdentity: vi.fn(),
        authenticate: vi.fn(),
        revokeCurrentDevice: revoke,
        authorizeHostWithCode: vi.fn(),
      }),
    })).resolves.toBe(0)

    expect(revoke).toHaveBeenCalledOnce()
    const rotated = JSON.parse(await readFile(join(directory, 'device.json'), 'utf8')) as { deviceId: string }
    expect(rotated.deviceId).not.toBe(original.deviceId)
    await expect(new ServerCredentialStore(directory).load('https://dsh.r2049.cn', rotated.deviceId))
      .resolves.toBeUndefined()
    expect(output.text).toContain('local device identity was rotated')
  })

  it('reports Host authorization and credential readiness without exposing tokens', async () => {
    const dshHome = join(tmpdir(), `dsh-remote-cli-status-${crypto.randomUUID()}`)
    directories.push(dshHome)
    const env = { DSH_HOME: dshHome }
    const root = new IdentityStore({ env }).directory
    const directory = serverStorageDirectory(root, 'https://dsh.r2049.cn', 'host')
    const identity = await new IdentityStore({ directory, env }).loadOrCreate('CLI status Host')
    await new ServerCredentialStore(directory).save({
      serverUrl: 'https://dsh.r2049.cn',
      deviceId: identity.deviceId,
      authorizationMethod: 'account',
      account: 'status@example.com',
      ...tokens(),
    })
    const output = writer()
    const fetchMock = vi.fn(async () => { throw new Error('valid local credentials must not need a request') }) as unknown as typeof fetch

    await expect(runCli(['status'], {
      env,
      stdout: output,
      createHostApi: (serverUrl, store) => new HostServerApi(serverUrl, store, fetchMock),
    })).resolves.toBe(0)

    expect(output.text).toContain('Host control: enabled (dsh-TUI default)')
    expect(output.text).toContain('Authorization: logged in (account)')
    expect(output.text).toContain('Account: status@example.com')
    expect(output.text).toContain('Credential: ready')
    expect(output.text).toContain('Presence: published while dsh-tui is running')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(output.text).not.toContain('access-token-value')
    expect(output.text).not.toContain('refresh-token-value')
  })
})

function writer(isTTY = false): { text: string; isTTY: boolean; write(value: string): void } {
  return {
    text: '',
    isTTY,
    write(value) { this.text += value },
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function tokens() {
  return {
    accessToken: 'access-token-value',
    accessTokenExpiresAt: Date.now() + 60_000,
    refreshToken: 'refresh-token-value',
    refreshTokenExpiresAt: Date.now() + 120_000,
  }
}
