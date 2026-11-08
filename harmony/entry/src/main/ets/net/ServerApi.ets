import { http } from '@kit.NetworkKit';
import { bundleManager } from '@kit.AbilityKit';
import { jsonStr, jsonNum, jsonBool, jsonArr, asArray, asRecord } from '../protocol/Types';
import { AccountLoginResult, TokenPair, RemoteHostDevice, AuthorizedPeerDevice, DeviceIdentity } from '../model/Types';

/** Fallback when the bundle info cannot be read; must match AppScope/app.json5. */
const CLIENT_VERSION_FALLBACK: string = '0.17.100-lan';

let clientVersionValue: string = CLIENT_VERSION_FALLBACK;

/**
 * Load the client version from the app bundle so `clientVersion` always matches the
 * installed build. The Server routes protocol compatibility by this value, so it must
 * never drift from AppScope/app.json5 `versionName`.
 */
export async function initClientVersion(): Promise<void> {
  try {
    const info: bundleManager.BundleInfo =
      await bundleManager.getBundleInfoForSelf(bundleManager.BundleFlag.GET_BUNDLE_INFO_WITH_APPLICATION);
    const name: string = info.versionName;
    if (name.length > 0) {
      clientVersionValue = name;
    }
  } catch (e) {
    // Keep the compiled-in fallback when the bundle info is unavailable.
  }
}

/** Current client version, resolved from the bundle at bootstrap. */
export function clientVersion(): string {
  return clientVersionValue;
}

export class RemoteApiError extends Error {
  code: string;
  status: number;
  /** Message the Server itself supplied, when it sent an {error:{code,message}} envelope.
   *  It explains *why* (wrong password, revoked device, ...) and wins over canned UI text. */
  serverMessage: string = '';

  constructor(code: string, message: string, status: number, serverMessage?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.serverMessage = serverMessage === undefined ? '' : serverMessage;
  }
}

export class HostPresence {
  online: boolean = false;
  lastSeenAt: number = 0;
}

export class OAuthProvider {
  id: string = '';
  displayName: string = '';
}

export class QrLoginSession {
  qrId: string = '';
  scanUrl: string = '';
  expiresIn: number = 0;
}

export class QrLoginPoll {
  status: string = '';
  token: string = '';
}

function isPrivateHostname(hostPort: string): boolean {
  let host = hostPort;
  const firstColon = hostPort.indexOf(':');
  const lastColon = hostPort.lastIndexOf(':');
  if (firstColon !== -1 && firstColon === lastColon) {
    host = hostPort.substring(0, lastColon);
  }
  if (host === '127.0.0.1' || host === 'localhost' || host === '10.0.2.2') {
    return true;
  }
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const nums: number[] = [];
  for (const part of parts) {
    if (part.length === 0 || part.length > 3) {
      return false;
    }
    let n = 0;
    for (let i = 0; i < part.length; i++) {
      const c = part.charCodeAt(i);
      if (c < 48 || c > 57) {
        return false;
      }
      n = n * 10 + (c - 48);
    }
    if (n > 255) {
      return false;
    }
    nums.push(n);
  }
  const a = nums[0];
  const b = nums[1];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

function hasValidScheme(value: string): boolean {
  const idx = value.indexOf('://');
  if (idx <= 0) {
    return false;
  }
  const scheme = value.substring(0, idx);
  const c0 = scheme.charCodeAt(0);
  if (!((c0 >= 97 && c0 <= 122) || (c0 >= 65 && c0 <= 90))) {
    return false;
  }
  for (let i = 1; i < scheme.length; i++) {
    const c = scheme.charCodeAt(i);
    const okChar = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57)
      || c === 43 || c === 45 || c === 46;
    if (!okChar) {
      return false;
    }
  }
  return true;
}

export function normalizeServerUrl(input: string): string {
  let value = input.trim();
  while (value.length > 0 && value.charAt(value.length - 1) === '/') {
    value = value.substring(0, value.length - 1);
  }
  if (value.length === 0) {
    throw new Error('服务器地址不能为空');
  }
  let scheme: string;
  let rest: string;
  if (hasValidScheme(value)) {
    const idx = value.indexOf('://');
    scheme = value.substring(0, idx).toLowerCase();
    rest = value.substring(idx + 3);
  } else {
    scheme = 'https';
    rest = value;
  }
  if (scheme !== 'https' && scheme !== 'http') {
    throw new Error('服务器地址必须使用 https');
  }
  const slash = rest.indexOf('/');
  const hostPort = slash === -1 ? rest : rest.substring(0, slash);
  const pathPart = slash === -1 ? '' : rest.substring(slash);
  if (hostPort.length === 0 || hostPort.includes('@') || rest.includes('?') || rest.includes('#')) {
    throw new Error('服务器地址格式无效');
  }
  if (scheme === 'http' && !isPrivateHostname(hostPort)) {
    throw new Error('服务器地址必须使用 https');
  }
  return `${scheme}://${hostPort}${pathPart}`;
}

export function websocketUrl(baseUrl: string): string {
  const normalized = normalizeServerUrl(baseUrl);
  if (normalized.startsWith('https://')) {
    return `wss://${normalized.substring(8)}/ws/v1/connect`;
  }
  return `ws://${normalized.substring(7)}/ws/v1/connect`;
}

function netErrorCodeHint(code: number): string {
  if (code === 2300006) {
    return '域名解析失败（DNS），请检查网络或服务器地址';
  }
  if (code === 2300007) {
    return '无法建立连接，服务器不可达或拒绝连接';
  }
  if (code === 2300028) {
    return '连接超时，网络不稳定或服务器无响应';
  }
  if (code === 2301050) {
    return 'TLS 证书校验失败，请检查系统时间或证书';
  }
  return '';
}

function describeNetError(e: Object): string {
  let message: string = '';
  let code: number = -1;
  if (e instanceof Error) {
    message = e.message.trim();
  }
  try {
    const rec: Record<string, Object> = JSON.parse(JSON.stringify(e)) as Record<string, Object>;
    const rawCode: Object | undefined = rec['code'];
    if (typeof rawCode === 'number') {
      code = rawCode;
    }
    const rawMessage: Object | undefined = rec['message'];
    if (typeof rawMessage === 'string' && message.length === 0) {
      message = rawMessage.trim();
    }
  } catch (ignored) {
  }
  const hint: string = netErrorCodeHint(code);
  if (hint.length > 0) {
    return hint;
  }
  if (message.length > 0) {
    return code > 0 ? `${message}（错误码 ${code}）` : message;
  }
  return code > 0 ? `错误码 ${code}` : '未知网络错误';
}

export class RemoteServerApi {
  /** 设备列表分页：每页条数（协议允许 1–100）与最多翻几页（防服务端 cursor 异常死循环）。 */
  private static readonly DEVICE_PAGE_SIZE: number = 50;
  private static readonly MAX_DEVICE_PAGES: number = 20;
  private baseUrl: string;
  private accessToken: string | undefined;
  /** REST 请求预算：服务端高峰期实测 TTFB 能到 12–22 秒，10 秒会让登录直接失败。 */
  private timeoutMs: number = 30000;

  constructor(baseUrl: string, accessToken?: string) {
    this.baseUrl = normalizeServerUrl(baseUrl);
    this.accessToken = accessToken;
  }

  async health(): Promise<void> {
    const text = await this.requestText('/health', 'GET', undefined, undefined);
    let status: string = '';
    try {
      const body = JSON.parse(text) as Record<string, Object>;
      status = jsonStr(body, 'status', '');
    } catch (e) {
      status = '';
    }
    if (status !== 'ok') {
      throw new RemoteApiError('CONNECTION_FAILED', '服务器健康检查失败（/health 返回了意外的响应，可能被网络门户劫持）', 0);
    }
  }

  /** Providers are served by the Server, so a newly integrated provider shows up without a rebuild. */
  async oauthProviders(): Promise<OAuthProvider[]> {
    const text = await this.requestText('/api/v1/auth/oauth/providers', 'GET', undefined, undefined);
    const root = JSON.parse(text) as Record<string, Object>;
    const items = jsonArr(root, 'items');
    const out: OAuthProvider[] = [];
    for (const item of items) {
      const d = item as Record<string, Object>;
      const provider = new OAuthProvider();
      provider.id = jsonStr(d, 'id', '');
      provider.displayName = jsonStr(d, 'displayName', provider.id);
      if (provider.id.length > 0) {
        out.push(provider);
      }
    }
    return out;
  }

  /** QR (device-code style) login: start a session, then poll it until the phone approves. */
  async startQrLogin(provider: string): Promise<QrLoginSession> {
    const text = await this.requestText(`/api/v1/auth/oauth/qr/start?provider=${provider}`, 'POST', '{}', undefined);
    const root = JSON.parse(text) as Record<string, Object>;
    const session = new QrLoginSession();
    session.qrId = jsonStr(root, 'qrId', '');
    session.scanUrl = jsonStr(root, 'scanUrl', '');
    session.expiresIn = jsonNum(root, 'expiresIn', 0);
    if (session.qrId.length < 10 || session.scanUrl.length === 0) {
      throw new RemoteApiError('INVALID_MESSAGE', 'The server returned an invalid QR login session.', 0);
    }
    if (session.expiresIn <= 0) {
      session.expiresIn = 600;
    }
    return session;
  }

  async pollQrLogin(qrId: string): Promise<QrLoginPoll> {
    const text = await this.requestText(`/api/v1/auth/oauth/qr/${qrId}`, 'GET', undefined, undefined);
    const root = JSON.parse(text) as Record<string, Object>;
    const poll = new QrLoginPoll();
    poll.status = jsonStr(root, 'status', '');
    poll.token = jsonStr(root, 'token', '');
    return poll;
  }

  /** The account that owns a session token, used right after a QR login completes. */
  async accountProfile(token: string): Promise<string> {
    const text = await this.requestText('/api/v1/auth/me', 'GET', undefined, token);
    const root = JSON.parse(text) as Record<string, Object>;
    const account = jsonStr(root, 'account', '');
    if (account.length === 0) {
      throw new RemoteApiError('INVALID_MESSAGE', 'The server returned an invalid account profile.', 0);
    }
    return account;
  }

  async loginAccount(email: string, password: string): Promise<AccountLoginResult> {
    const body: Record<string, Object> = {
      'email': email.trim(),
      'password': password
    };
    const text = await this.requestText('/api/v1/auth/login', 'POST', JSON.stringify(body), undefined);
    const root = JSON.parse(text) as Record<string, Object>;
    const result = new AccountLoginResult();
    result.token = jsonStr(root, 'token', '');
    result.expiresAt = jsonNum(root, 'expiresAt', 0);
    result.account = jsonStr(root, 'account', '');
    result.isAdmin = jsonBool(root, 'isAdmin', false);
    if (result.token.length < 16 || result.account.length === 0) {
      throw new RemoteApiError('INVALID_MESSAGE', 'The server returned invalid account login data.', 0);
    }
    return result;
  }

  private deviceRecord(identity: DeviceIdentity): Record<string, Object> {
    const device: Record<string, Object> = {
      'deviceId': identity.deviceId,
      'name': identity.name,
      'role': 'client',
      'platform': identity.platform,
      'identityKey': identity.publicKey,
      'clientVersion': clientVersion()
    };
    return device;
  }

  async registerDevice(identity: DeviceIdentity, accountToken: string): Promise<TokenPair> {
    const body: Record<string, Object> = {
      'v': 1,
      'device': this.deviceRecord(identity)
    };
    const text = await this.requestText('/api/v1/devices/register', 'POST', JSON.stringify(body), accountToken);
    return parseTokenPair(text);
  }

  /**
   * Re-register this device without an account session, used when the stored refresh
   * token was already rotated or has expired. The Server keeps the device bound by its
   * identity key, so an already-owned device recovers fresh tokens instead of forcing a
   * new login. It answers 401/403 when the device is unknown or was revoked.
   */
  async recoverDevice(identity: DeviceIdentity): Promise<TokenPair> {
    const body: Record<string, Object> = {
      'v': 1,
      'device': this.deviceRecord(identity)
    };
    const text = await this.requestText('/api/v1/devices/register', 'POST', JSON.stringify(body), undefined);
    return parseTokenPair(text);
  }

  async refreshToken(deviceId: string, refreshToken: string): Promise<TokenPair> {
    const body: Record<string, Object> = {
      'deviceId': deviceId,
      'refreshToken': refreshToken
    };
    const text = await this.requestText('/api/v1/auth/refresh', 'POST', JSON.stringify(body), undefined);
    return parseTokenPair(text);
  }

  /**
   * 设备列表。
   * 新服务端支持 `?limit=` + 不透明 `cursor` 分页（协议 §设备分页）：必须读完所有页，
   * 不能把第一页当完整列表；老服务端忽略 limit 直接返回全量，此时没有 nextCursor 就停。
   */
  async listDevices(): Promise<RemoteHostDevice[]> {
    const token = this.requireToken();
    const out: RemoteHostDevice[] = [];
    let cursor: string = '';
    for (let page = 0; page < RemoteServerApi.MAX_DEVICE_PAGES; page++) {
      const query: string = cursor.length > 0
        ? '/api/v1/devices?limit=' + RemoteServerApi.DEVICE_PAGE_SIZE + '&cursor=' + encodeURIComponent(cursor)
        : '/api/v1/devices?limit=' + RemoteServerApi.DEVICE_PAGE_SIZE;
      const text = await this.requestText(query, 'GET', undefined, token);
      const root = JSON.parse(text) as Record<string, Object>;
      const items = jsonArr(root, 'items');
      RemoteServerApi.appendHosts(items, out);
      const next: Object | undefined = root['nextCursor'];
      cursor = typeof next === 'string' ? next : '';
      if (cursor.length === 0) {
        break;
      }
    }
    return out;
  }

  /** 把一页设备记录里的 Host 行追加进列表（分页与单页共用）。 */
  private static appendHosts(items: Object[], out: RemoteHostDevice[]): void {
    for (const item of items) {
      const d = item as Record<string, Object>;
      if (jsonStr(d, 'role', '') !== 'host') {
        continue;
      }
      const host = new RemoteHostDevice();
      host.deviceId = jsonStr(d, 'deviceId', '');
      host.name = jsonStr(d, 'name', '');
      host.platform = jsonStr(d, 'platform', '');
      host.membershipId = jsonStr(d, 'membershipId', '');
      host.identityKey = '';
      host.presenceKnown = hasBoolean(d, 'online');
      host.online = jsonBool(d, 'online', false);
      host.clientVersion = jsonStr(d, 'clientVersion', '');
      host.harnessVersion = jsonStr(d, 'harnessVersion', '');
      host.lastSeenAt = jsonNum(d, 'lastSeenAt', 0);
      if (host.deviceId.length === 0 || host.membershipId.length === 0) {
        continue;
      }
      out.push(host);
    }
  }

  async deviceFor(deviceId: string): Promise<AuthorizedPeerDevice> {
    const token = this.requireToken();
    const text = await this.requestText(`/api/v1/devices/${deviceId}`, 'GET', undefined, token);
    const root = JSON.parse(text) as Record<string, Object>;
    const peer = new AuthorizedPeerDevice();
    peer.deviceId = jsonStr(root, 'deviceId', '');
    peer.name = jsonStr(root, 'name', '');
    peer.role = jsonStr(root, 'role', '');
    peer.platform = jsonStr(root, 'platform', '');
    peer.identityKey = jsonStr(root, 'identityKey', '');
    peer.membershipId = jsonStr(root, 'membershipId', '');
    peer.presenceKnown = hasBoolean(root, 'online');
    peer.online = jsonBool(root, 'online', false);
    peer.lastSeenAt = jsonNum(root, 'lastSeenAt', 0);
    peer.clientVersion = jsonStr(root, 'clientVersion', '');
    peer.harnessVersion = jsonStr(root, 'harnessVersion', '');
    if (peer.deviceId.length === 0 || peer.identityKey.length === 0) {
      throw new RemoteApiError('INVALID_MESSAGE', 'The server returned invalid authorized peer data.', 0);
    }
    return peer;
  }

  /**
   * 拉取本连接的短期 ICE 配置（STUN/TURN）。
   * 直连（lan/p2p/turn）的前提就是这个接口能返回 iceServers；返回空数组说明服务端没配 TURN。
   */
  async iceServersJson(connectionId: string): Promise<string> {
    const token = this.requireToken();
    const text: string = await this.requestText(
      `/api/v1/turn/credentials?connection_id=${encodeURIComponent(connectionId)}`,
      'GET', undefined, token);
    const root: Object = JSON.parse(text) as Object;
    const record: Record<string, Object> | undefined = asRecord(root);
    const servers: Object[] | undefined = record !== undefined ? asArray(record['iceServers']) : undefined;
    if (servers === undefined || servers.length === 0) {
      return '';
    }
    return JSON.stringify({ iceServers: servers });
  }

  /** Presence lives behind its own endpoint; the device list does not always carry it. */
  async presenceFor(deviceId: string): Promise<HostPresence> {
    const token = this.requireToken();
    const text = await this.requestText(`/api/v1/devices/${deviceId}/presence`, 'GET', undefined, token);
    const root = JSON.parse(text) as Record<string, Object>;
    const presence = new HostPresence();
    presence.online = jsonBool(root, 'online', false);
    presence.lastSeenAt = jsonNum(root, 'lastSeenAt', 0);
    return presence;
  }

  private requireToken(): string {
    const token = this.accessToken;
    if (token === undefined) {
      throw new RemoteApiError('AUTH_REQUIRED', 'This device is not registered with the server.', 0);
    }
    return token;
  }

  private async requestText(path: string, method: string, body: string | undefined,
    bearer: string | undefined): Promise<string> {
    const client = http.createHttp();
    try {
      const header: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      if (bearer !== undefined) {
        header['Authorization'] = `Bearer ${bearer}`;
      }
      let verb: http.RequestMethod = http.RequestMethod.GET;
      if (method === 'POST') {
        verb = http.RequestMethod.POST;
      } else if (method === 'DELETE') {
        verb = http.RequestMethod.DELETE;
      } else if (method === 'PATCH') {
        verb = http.RequestMethod.PATCH;
      }
      const options: http.HttpRequestOptions = {
        method: verb,
        header: header,
        extraData: body,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: this.timeoutMs,
        readTimeout: this.timeoutMs
      };
      const resp = await client.request(`${this.baseUrl}${path}`, options);
      const text = typeof resp.result === 'string' ? resp.result : '';
      const status = resp.responseCode;
      if (status < 200 || status >= 300) {
        throw this.mapError(text, status);
      }
      return text;
    } catch (e) {
      if (e instanceof RemoteApiError) {
        throw e;
      }
      throw new RemoteApiError('CONNECTION_FAILED', `无法连接服务器：${describeNetError(e)}`, 0);
    } finally {
      client.destroy();
    }
  }

  private mapError(text: string, status: number): RemoteApiError {
    let detail = 'The server rejected the request.';
    let serverCode = '';
    let serverMessage = '';
    if (text.length > 0) {
      try {
        const root = JSON.parse(text) as Record<string, Object>;
        const errObj = root['error'];
        if (typeof errObj === 'object' && errObj !== null) {
          const e = errObj as Record<string, Object>;
          detail = jsonStr(e, 'message', detail);
          serverMessage = detail;
          serverCode = jsonStr(e, 'code', '');
        }
        if (detail === 'The server rejected the request.') {
          detail = jsonStr(root, 'detail', detail);
        }
        if (serverCode.length === 0) {
          serverCode = jsonStr(root, 'code', '');
        }
      } catch (e) {
      }
    }
    let code: string = serverCode;
    if (code.length === 0) {
      if (status === 401) {
        code = 'AUTH_INVALID';
      } else if (status === 403) {
        code = 'AUTH_REQUIRED';
      } else if (status === 404) {
        code = 'DEVICE_NOT_FOUND';
      } else if (status === 409) {
        code = 'DEVICE_OWNERSHIP_REQUIRED';
      } else if (status === 429) {
        code = 'RATE_LIMITED';
      } else if (status >= 500) {
        code = 'CONNECTION_FAILED';
        if (detail === 'The server rejected the request.') {
          detail = `服务器内部错误（HTTP ${status}）`;
        }
      } else {
        code = 'INVALID_MESSAGE';
      }
    }
    return new RemoteApiError(code, detail, status, serverMessage);
  }
}

function hasBoolean(record: Record<string, Object>, key: string): boolean {
  const value: Object | undefined = record[key];
  return typeof value === 'boolean';
}

function parseTokenPair(text: string): TokenPair {
  const root = JSON.parse(text) as Record<string, Object>;
  const pair = new TokenPair();
  pair.accessToken = jsonStr(root, 'accessToken', '');
  pair.accessTokenExpiresAt = jsonNum(root, 'accessTokenExpiresAt', 0);
  pair.refreshToken = jsonStr(root, 'refreshToken', '');
  pair.refreshTokenExpiresAt = jsonNum(root, 'refreshTokenExpiresAt', 0);
  if (pair.accessToken.length < 16 || pair.refreshToken.length < 16) {
    throw new RemoteApiError('INVALID_MESSAGE', 'The server returned invalid device credentials.', 0);
  }
  return pair;
}
