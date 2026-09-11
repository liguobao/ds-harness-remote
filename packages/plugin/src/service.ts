import { randomUUID } from 'node:crypto'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { createEvent } from '@dsh-remote/protocol'
import { ConnectionController } from './connection-controller.js'
import type { ResolvedConfig } from './config.js'
import type { HostIdentity, IdentityStore } from './identity-store.js'
import {
  harnessSessionGeneration,
  normalizeHarnessVersion,
  readHarnessDistributionVersion,
  selectHarnessVersion,
} from './harness-version.js'
import type { SafeLogger } from './logging.js'
import { RpcRouter } from './rpc-router.js'
import { RemoteFileViewerBridge, type FileViewerHostServiceLike } from './file-viewer-bridge.js'
import {
  HostServerApi,
  ServerApiError,
  type DeviceAuthorization,
  type OAuthProvider,
  type OAuthQrPollResult,
  type OAuthQrSession,
} from './server-api.js'
import { HostServerConnection } from './server-connection.js'
import { ServerCredentialStore } from './server-credentials.js'
import { HarnessApiBridge, type TypertGatewayLike } from './harness-api-bridge.js'
import { HarnessRemoteBridge } from './harness-remote-bridge.js'
import type { LocalTypertGateway } from './typert-gateway-contract.js'
import { loadNodeRtcFactory } from './werift-rtc.js'
import type { AuthenticatedPeerChannel } from './types.js'
import { CodexRemoteDomain } from './codex/domain.js'
import type { CodexPeerBridge, PublishCodexFrame } from './codex/peer-bridge.js'
import { RpcError } from './safe-error.js'

export interface HostRemoteStatus {
  deviceId?: string
  configured: boolean
  online: boolean
  reconnecting: boolean
  lastActiveAt?: number
  error?: string
  account?: string
  authorized: boolean
  accountRequired: boolean
}

export class HostPluginRuntime {
  readonly connections: ConnectionController
  private identity?: HostIdentity
  private readonly serverApi?: HostServerApi
  private serverConnection?: HostServerConnection
  private harnessVersion?: string
  private closed = false
  private readonly codex: CodexRemoteDomain
  private localCodexPeer?: CodexPeerBridge
  private localCodexPublish: PublishCodexFrame = async () => undefined

  constructor(
    private readonly config: ResolvedConfig,
    private readonly identities: IdentityStore,
    private readonly apiProxy: ApiProxy | undefined,
    private readonly logger: SafeLogger,
    private readonly localGateway?: LocalTypertGateway,
    private readonly fileViewerHost?: () => FileViewerHostServiceLike | undefined,
  ) {
    this.codex = new CodexRemoteDomain(config.codex, logger)
    this.connections = new ConnectionController(this.identities, (context, send) => {
      const harnessApi = this.apiProxy === undefined
        ? undefined
        : new HarnessApiBridge(
            this.apiProxy,
            (event, data) => send(createEvent(event, data)),
            undefined,
            this.logger,
            this.localGateway as TypertGatewayLike | undefined,
            this.harnessVersion,
          )
      const harnessRemote = this.localGateway?.supportsCarrier === true
        ? new HarnessRemoteBridge(
            this.localGateway,
            (event, data) => send(createEvent(event, data)),
            this.logger,
            this.harnessVersion,
          )
        : undefined
      const fileViewer = new RemoteFileViewerBridge(
        () => this.fileViewerHost?.(),
        this.logger,
      )
      const codex = this.codex.createPeer(
        context,
        (event, data) => send(createEvent(event, data)),
      )
      return new RpcRouter(
        harnessApi,
        undefined,
        this.logger,
        fileViewer,
        harnessRemote,
        () => this.hostCapabilities(),
        codex,
      )
    }, this.logger)
    if (config.serverUrl !== undefined) {
      this.serverApi = new HostServerApi(config.serverUrl, new ServerCredentialStore(identities.directory))
    }
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error('remote runtime is closed')
    this.identity = await this.identities.loadOrCreate(this.config.deviceName)
    this.logger.info('host identity ready', {
      deviceId: shortId(this.identity.deviceId),
      fingerprint: this.identity.fingerprint,
      server: this.config.serverUrl ?? 'not configured',
    })
    await this.codex.start()
    if (this.serverApi !== undefined) {
      this.harnessVersion = await this.readHarnessVersion()
      this.serverApi.setHarnessVersion(this.harnessVersion)
      this.serverApi.bindIdentity(this.identity)
      this.serverConnection = this.createServerConnection(this.identity)
      this.serverConnection.start()
    }
  }

  currentIdentity(): HostIdentity {
    if (this.identity === undefined) throw new Error('remote runtime has not started')
    return this.identity
  }

  acceptAuthenticatedPeer(channel: AuthenticatedPeerChannel): Promise<void> {
    this.currentIdentity()
    return this.connections.accept(channel)
  }

  hostStatus(): HostRemoteStatus {
    const error = this.serverConnection?.lastError()
    const authorization = this.serverApi?.currentAuthorization()
    return {
      ...(this.identity === undefined ? {} : { deviceId: this.identity.deviceId }),
      configured: this.serverApi !== undefined,
      online: this.serverConnection?.isOnline() ?? false,
      reconnecting: this.serverConnection?.isReconnecting() ?? false,
      ...(this.serverConnection?.lastActivity() === undefined
        ? {}
        : { lastActiveAt: this.serverConnection.lastActivity() }),
      ...(error === undefined ? {} : { error }),
      ...(authorization?.account === undefined ? {} : { account: authorization.account }),
      authorized: authorization !== undefined,
      accountRequired: error === 'ACCOUNT_AUTH_REQUIRED' || error === 'AUTH_INVALID' || error === 'TOKEN_EXPIRED',
    }
  }

  localHarnessVersion(): string | undefined {
    return this.harnessVersion
  }

  reconnectHost(): void {
    if (this.closed) throw new Error('remote runtime is closed')
    if (this.serverConnection === undefined) {
      throw new ServerApiError('SERVER_NOT_CONFIGURED', 'Configure serverUrl before reconnecting.', false)
    }
    this.serverConnection.reconnect()
  }

  async startHostOAuthQrLogin(provider: OAuthProvider): Promise<OAuthQrSession> {
    if (this.serverApi === undefined) {
      throw new ServerApiError('SERVER_NOT_CONFIGURED', 'Remote Host Server is unavailable.', false)
    }
    return this.serverApi.startOAuthQrLogin(provider)
  }

  async pollHostOAuthQrLogin(qrId: string): Promise<OAuthQrPollResult> {
    if (this.serverApi === undefined) {
      throw new ServerApiError('SERVER_NOT_CONFIGURED', 'Remote Host Server is unavailable.', false)
    }
    const result = await this.serverApi.pollOAuthQrLogin(this.currentIdentity(), qrId, async () => {
      await this.serverConnection?.stop()
      this.identity = await this.identities.reset(this.config.deviceName)
      this.serverApi!.bindIdentity(this.identity)
      this.serverConnection = this.createServerConnection(this.identity)
      return this.identity
    })
    if (result.status === 'complete') {
      this.serverConnection?.reconnect()
      this.logger.info('Host account authorized through OAuth QR login')
    }
    return result
  }

  async clearHostAuthorization(): Promise<void> {
    await this.serverConnection?.stop()
    let revokeFailure: unknown
    try {
      await this.serverApi?.revokeCurrentDevice()
    } catch (error) {
      revokeFailure = error
    }
    this.identity = await this.identities.reset(this.config.deviceName)
    this.serverApi?.bindIdentity(this.identity)
    if (this.serverApi !== undefined) this.serverConnection = this.createServerConnection(this.identity)
    this.logger.info('Host authorization cleared')
    if (revokeFailure !== undefined) throw revokeFailure
  }

  async authorizeHostAsOwned(accessToken: string, account?: string): Promise<DeviceAuthorization> {
    if (this.serverApi === undefined) {
      throw new ServerApiError('SERVER_NOT_CONFIGURED', 'Configure serverUrl before enabling Host access.', false)
    }
    let result
    try {
      result = await this.serverApi.authorizeOwnedRole(this.currentIdentity(), accessToken, account)
    } catch (error) {
      if (!(error instanceof ServerApiError) || error.code !== 'DEVICE_REVOKED') throw error
      await this.serverConnection?.stop()
      this.identity = await this.identities.reset(this.config.deviceName)
      this.serverApi.bindIdentity(this.identity)
      this.serverConnection = this.createServerConnection(this.identity)
      result = await this.serverApi.authorizeOwnedRole(this.identity, accessToken, account)
      this.logger.info('Rotated revoked Host identity before owned-device authorization')
    }
    this.serverConnection?.resume()
    this.logger.info('Host authorized as an owned device')
    return result
  }

  async authorizeHostWithAccount(email: string, password: string): Promise<DeviceAuthorization> {
    if (this.serverApi === undefined) {
      throw new ServerApiError('SERVER_NOT_CONFIGURED', 'Configure serverUrl before signing in.', false)
    }
    const result = await this.serverApi.authorizeWithAccount(this.currentIdentity(), email, password)
    this.serverConnection?.resume()
    this.logger.info('Host account authorized')
    return result
  }

  async authorizeHostWithCode(code: string): Promise<DeviceAuthorization> {
    if (this.serverApi === undefined) {
      throw new ServerApiError('SERVER_NOT_CONFIGURED', 'Configure serverUrl before entering a Host registration code.', false)
    }
    const result = await this.serverApi.authorizeHostWithCode(this.currentIdentity(), code)
    this.serverConnection?.resume()
    this.logger.info('Host registration code authorized')
    return result
  }

  async revokePeer(deviceId: string): Promise<boolean> {
    const revoked = await this.identities.revokePeer(deviceId)
    if (revoked) await this.connections.revoke(deviceId)
    return revoked
  }

  codexStatus(): ReturnType<CodexRemoteDomain['status']> {
    return this.codex.status()
  }

  codexCall(input: unknown): Promise<unknown> {
    return this.requireLocalCodexPeer().call(input)
  }

  codexRespond(input: unknown): Promise<{ resolved: true }> {
    return this.requireLocalCodexPeer().respond(input)
  }

  codexOpenStream(input: unknown, publish: PublishCodexFrame): Promise<unknown> {
    this.localCodexPublish = publish
    return this.requireLocalCodexPeer().openStream(input)
  }

  async codexCloseStream(input: unknown): Promise<unknown> {
    const peer = this.localCodexPeer
    if (peer !== undefined) return peer.closeStream(input)
    const streamId = isPlainRecord(input) && typeof input.streamId === 'string' ? input.streamId : undefined
    if (streamId === undefined) throw new RpcError('INVALID_MESSAGE', 'A Codex stream is required.')
    return { closed: false, streamId }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.serverConnection?.stop()
    await this.connections.close()
    await this.localCodexPeer?.closeAll()
    this.localCodexPeer = undefined
    await this.codex.close()
    this.logger.info('host runtime stopped')
  }

  diagnostics() {
    return {
      loaded: this.identity !== undefined,
      deviceId: this.identity === undefined ? undefined : shortId(this.identity.deviceId),
      identityValid: this.identity !== undefined,
      serverConfigured: this.config.serverUrl !== undefined,
      serverOnline: this.serverConnection?.isOnline() ?? false,
      serverError: this.serverConnection?.lastError(),
      online: this.connections.isOnline(),
      activeConnections: this.connections.connectionCount(),
      peerDeviceId: this.connections.peerDeviceId() === undefined ? undefined : shortId(this.connections.peerDeviceId()!),
      peerDeviceIds: this.connections.peerDeviceIds().map(shortId),
      trustedPeers: this.identities.listTrustedPeers().length,
      capabilities: this.hostCapabilities(),
      codex: this.codex.status(),
    }
  }

  private createServerConnection(identity: HostIdentity): HostServerConnection {
    return new HostServerConnection(
      this.config,
      identity,
      this.identities,
      this.serverApi!,
      this.connections,
      this.logger,
      undefined,
      this.config.forceRelay
        ? undefined
        : () => loadNodeRtcFactory({ routeTargets: this.config.serverUrl === undefined ? [] : [this.config.serverUrl] }),
      () => this.hostCapabilities(),
      this.harnessVersion,
    )
  }

  private async readHarnessVersion(): Promise<string | undefined> {
    let reportedVersion: string | undefined
    let errorCode: string | undefined
    try {
      const response = await this.apiProxy?.host.describe({ rpcId: randomUUID() as never, payload: {} })
      if (response === undefined) throw new Error('ApiProxy is unavailable')
      if (!response.result.ok) {
        errorCode = response.result.error.code
      } else {
        reportedVersion = normalizeHarnessVersion(response.result.value.version)
      }
    } catch {
      // Older Harness builds may not expose host.describe.
    }
    const distributionVersion = reportedVersion === undefined || reportedVersion === '0.0.1'
      ? await readHarnessDistributionVersion()
      : undefined
    const version = selectHarnessVersion(reportedVersion, distributionVersion)
    if (version !== undefined) return version
    this.logger.warn('Harness version is unavailable', errorCode === undefined ? undefined : { code: errorCode })
    return undefined
  }

  private hostCapabilities(): string[] {
    const capabilities: string[] = []
    if (this.localGateway?.supportsCarrier === true) {
      capabilities.push(
        harnessSessionGeneration(this.harnessVersion) === 'v3' ? 'harness.remote.v3' : 'harness.remote.v1',
        'harness.remote.transfer.v1',
      )
    }
    if (this.apiProxy !== undefined) {
      capabilities.push('harness.api.v1', 'harness.api.transfer.v1')
    }
    if (this.fileViewerHost?.() !== undefined) capabilities.push('fileviewer.read.v1')
    if (this.codex.isAvailable()) capabilities.push('codex.appserver.v1', 'codex.appserver.transfer.v1')
    return capabilities
  }

  private requireLocalCodexPeer(): CodexPeerBridge {
    if (!this.codex.isAvailable()) {
      throw new RpcError('CODEX_UNAVAILABLE', 'Local CodeX is disabled or unavailable on this Host.')
    }
    if (this.localCodexPeer !== undefined) return this.localCodexPeer
    const identity = this.currentIdentity()
    const peer = this.codex.createPeer({
      connectionId: `loopback:${identity.deviceId}`,
      peerDeviceId: identity.deviceId,
    }, (event, data) => this.localCodexPublish(event, data))
    if (peer === undefined) {
      throw new RpcError('CODEX_UNAVAILABLE', 'Local CodeX is disabled or unavailable on this Host.')
    }
    this.localCodexPeer = peer
    return peer
  }
}

function shortId(value: string): string { return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}` }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
