import type { DeviceCredentials, DeviceIdentity } from '../types'
import { RemoteServerApi } from './api'

type TokenPair = Pick<DeviceCredentials, 'accessToken' | 'accessTokenExpiresAt' | 'refreshToken' | 'refreshTokenExpiresAt'>

export interface AuthenticatedServer {
  api: RemoteServerApi
  credentials: DeviceCredentials
}

export interface CredentialPersistence {
  load(serverUrl: string, deviceId: string): Promise<DeviceCredentials | undefined>
  save(credentials: DeviceCredentials): Promise<void>
}

export type ApiFactory = (baseUrl: string, accessToken?: string) => RemoteServerApi

export class ServerSessionManager {
  private readonly inFlight = new Map<string, Promise<AuthenticatedServer>>()

  constructor(
    private readonly persistence: CredentialPersistence,
    private readonly apiFactory: ApiFactory,
  ) {}

  /**
   * Log in with the account password and register (or restore) this Android
   * device under the account. The account token is used only for this HTTPS
   * registration and never persisted; the device token pair is stored instead.
   */
  async authenticateWithAccount(
    baseUrl: string,
    identity: DeviceIdentity,
    email: string,
    password: string,
  ): Promise<AuthenticatedServer> {
    const key = `${baseUrl}\0${identity.deviceId}`
    const pending = this.inFlight.get(key)
    if (pending !== undefined) return pending

    const created = this.authenticateWithAccountOnce(baseUrl, identity, email, password).finally(() => {
      if (this.inFlight.get(key) === created) this.inFlight.delete(key)
    })
    this.inFlight.set(key, created)
    return created
  }

  /**
   * Register this Android device under a short-lived account token. The account
   * token is used only for HTTPS registration and never persisted.
   */
  async registerWithAccountToken(
    baseUrl: string,
    identity: DeviceIdentity,
    accountToken: string,
    account: string,
  ): Promise<AuthenticatedServer> {
    const publicApi = this.apiFactory(baseUrl)
    const tokens = await publicApi.registerDevice(identity, accountToken)
    const credentials: DeviceCredentials = {
      serverUrl: baseUrl,
      deviceId: identity.deviceId,
      authorizationMethod: 'account',
      account,
      ...tokens,
    }
    await this.persistence.save(credentials)
    return {
      api: this.apiFactory(baseUrl, credentials.accessToken),
      credentials,
    }
  }

  /**
   * Register this Android device under an account web session token delivered
   * by Zhihu OAuth (dshremote://oauth?token=...). The web token is used only
   * for the device registration and never persisted.
   */
  async authenticateWithOAuthToken(
    baseUrl: string,
    identity: DeviceIdentity,
    webToken: string,
  ): Promise<AuthenticatedServer> {
    const publicApi = this.apiFactory(baseUrl)
    const profile = await publicApi.accountMe(webToken)
    return this.registerWithAccountToken(baseUrl, identity, webToken, profile.account)
  }

  authenticate(baseUrl: string, identity: DeviceIdentity): Promise<AuthenticatedServer> {
    const key = `${baseUrl}\0${identity.deviceId}`
    const pending = this.inFlight.get(key)
    if (pending !== undefined) return pending

    const created = this.authenticateOnce(baseUrl, identity).finally(() => {
      if (this.inFlight.get(key) === created) this.inFlight.delete(key)
    })
    this.inFlight.set(key, created)
    return created
  }

  private async authenticateWithAccountOnce(
    baseUrl: string,
    identity: DeviceIdentity,
    email: string,
    password: string,
  ): Promise<AuthenticatedServer> {
    const publicApi = this.apiFactory(baseUrl)
    const login = await publicApi.loginAccount(email, password)
    return this.registerWithAccountToken(baseUrl, identity, login.token, login.account)
  }

  private async authenticateOnce(baseUrl: string, identity: DeviceIdentity): Promise<AuthenticatedServer> {
    const now = Date.now()
    let credentials = await this.persistence.load(baseUrl, identity.deviceId)
    if (credentials === undefined || credentials.accessTokenExpiresAt <= now + 30_000) {
      const publicApi = this.apiFactory(baseUrl)
      let tokens: TokenPair
      if (credentials !== undefined && credentials.refreshTokenExpiresAt > now + 30_000) {
        tokens = await publicApi.refreshToken(identity.deviceId, credentials.refreshToken)
      } else {
        // No valid device credential: the user must log in again.
        throw new AccountRequiredError('The phone must be authorized for this server again.')
      }
      credentials = {
        ...credentials,
        ...tokens,
      }
      await this.persistence.save(credentials)
    }
    return {
      api: this.apiFactory(baseUrl, credentials.accessToken),
      credentials,
    }
  }
}

export class AccountRequiredError extends Error {
  constructor(message: string) { super(message) }
}
