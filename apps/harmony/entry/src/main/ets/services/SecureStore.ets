import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { DeviceIdentity, TokenPair } from '../model/Types';
import { randomBytes, uuidV7, randomId, toBase64Url, bytesToHex, utf8Encode } from '../crypto/Bytes';
import { sha256 } from '../crypto/Sha256';
import { x25519Public } from '../crypto/X25519';
import { jsonStr, jsonNum, asArray, asRecord } from '../protocol/Types';
import { logWarn, logError } from '../util/Log';

const KEY_CONFIG = 'dshremote.server.v1';
const KEY_IDENTITY = 'dshremote.identity.v1';
const KEY_CREDENTIALS = 'dshremote.credentials.v1';
const KEY_DEVICE_ALIASES = 'dshremote.deviceAliases.v1';
const KEY_THEME_MODE = 'dshremote.themeMode.v1';
const KEY_LANGUAGE_MODE = 'dshremote.languageMode.v1';
const KEY_TEXT_SCALE = 'dshremote.textScale.v1';
const KEY_HOST_PINS = 'dshremote.hostPins.v1';
const LEGACY_PROFILES = 'dshremote.hostPins.v1.profiles';
const LEGACY_PROFILE_OWNERS = 'dshremote.legacyProfileOwners';
/** 会话输入草稿：{ sessionId: 文本 }，切会话/重开 App 都能接着写。 */
const KEY_DRAFTS = 'dshremote.drafts.v1';
/** 本地提示词库（纯本地，不上报任何东西）。 */
const KEY_PROMPTS = 'dshremote.prompts.v1';
/** 会话收藏与最近访问：{ favorites: string[], recents: string[] }。 */
const KEY_SESSION_META = 'dshremote.sessionMeta.v1';
/** 会话抽屉视图偏好：分组方式、排序方式与归档筛选。 */
const KEY_SESSION_VIEW = 'dshremote.sessionView.v1';
/** 上次连着的主机：下次启动自动连它（聊天客户端该有的行为）。 */
const KEY_LAST_HOST = 'dshremote.lastHost.v1';
const KEY_AUTO_CONNECT_LAST_HOST = 'dshremote.autoConnectLastHost.v1';
/** 上次成功拉到的主机信息（deviceId/公钥/版本），重连时省掉一次设备查询往返。 */
const KEY_HOST_INFO = 'dshremote.hostInfo.v1';
/** 上次成功拉到的会话列表（只存侧栏要用的字段），启动/重连时先把列表画出来。 */
const KEY_SESSION_SNAPSHOT = 'dshremote.sessionSnapshot.v1';
/** 精简历史：主机把历史里的工具参数/输出转摘要，省流量。 */
const KEY_COMPACT_HISTORY = 'dshremote.compactHistory.v1';
/** 主题着色（0 默认/1 深海/2 森林/3 暖沙/4 玫紫）。 */
const KEY_THEME_TINT = 'dshremote.themeTint.v1';
/** 桌宠（鲸娘）：干活/等你确认/完成 四态小挂件。 */
const KEY_PET = 'dshremote.pet.v1';
/** 已发送文本里的 Key/Token 默认打码。 */
const KEY_SECRET_MASK = 'dshremote.secretMask.v1';
// Secrets never live in the plaintext KV. They go to the system Asset Store, which is
// guarded by the device lock credential and (with SyncType.NEVER) never leaves this device.
const ASSET_ALIAS_CREDENTIALS = 'dshremote.credentials.v1';
const ASSET_ALIAS_HOST_PINS = 'dshremote.hostPins.v1';

/** Per-identity alias: the private key is bound to one device identity. */
function identitySecretAlias(deviceId: string): string {
  return 'dshremote.identity.' + deviceId;
}

function encodeUtf8(text: string): Uint8Array {
  const encoder: util.TextEncoder = new util.TextEncoder();
  return encoder.encodeInto(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
  return decoder.decodeToString(bytes);
}

/** Persisted server + account config. */
/** UUIDv7 or ULID, the only shapes the Server accepts for a device id. */
function isCanonicalDeviceId(value: string): boolean {
  if (value.length === 36) {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      const dash = i === 8 || i === 13 || i === 18 || i === 23;
      if (dash) {
        if (c !== 45) { return false; }
        continue;
      }
      const isHex = (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
      if (!isHex) { return false; }
    }
    return true;
  }
  if (value.length === 26) {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90);
      if (!ok) { return false; }
    }
    return true;  // ULID (uppercase Crockford alphabet is a superset check here)
  }
  return false;
}

export class StoredServerConfig {
  baseUrl: string = '';
  email: string = '';
}

function credentialScope(config: StoredServerConfig): string {
  return bytesToHex(sha256(utf8Encode(JSON.stringify([config.baseUrl, config.email]))));
}

function tokenFingerprint(record: Record<string, Object>): string {
  const tokens: string[] = [jsonStr(record, 'accessToken', ''), jsonStr(record, 'refreshToken', '')];
  return bytesToHex(sha256(utf8Encode(JSON.stringify(tokens))));
}

// Keep only fingerprints while Asset Store is locked or migration is interrupted.
function legacyProfileOwners(text: string): string {
  try {
    const profiles = asArray(JSON.parse(text) as Object);
    if (profiles === undefined) return 'null';
    const owners: Record<string, string>[] = [];
    for (const item of profiles) {
      const profile = asRecord(item);
      if (profile === undefined) return 'null';
      const config = new StoredServerConfig();
      config.baseUrl = jsonStr(profile, 'baseUrl', '');
      config.email = jsonStr(profile, 'email', '');
      owners.push({ 'scope': credentialScope(config), 'pair': tokenFingerprint(profile) });
    }
    return JSON.stringify(owners);
  } catch (error) {
    // A malformed profile list cannot establish ownership.
  }
  return 'null';
}

function legacyProfileMatches(text: string, scope: string, active: Record<string, Object>): boolean {
  if (!text) return true;
  const owners = asArray(JSON.parse(text) as Object);
  if (owners === undefined) return false;
  if (owners.length === 0) return true;
  const pair = tokenFingerprint(active);
  let matched = false;
  let singleScope = true;
  for (const item of owners) {
    const owner = asRecord(item);
    if (owner === undefined) return false;
    if (owner['scope'] !== scope) singleScope = false;
    if (owner['pair'] === pair) {
      if (owner['scope'] !== scope) return false;
      matched = true;
    }
  }
  // The token may have rotated since the last snapshot. Only a single possible owner is unambiguous.
  return matched || singleScope;
}

/**
 * 系统安全存储（Asset Store）写不进去时抛这个：调用方必须显式提示并保留可恢复状态。
 * 绝不能悄悄把私钥 / token 降级成明文写进 preferences —— 那等于把密钥留在应用沙箱里。
 */
export class SecureStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecureStorageUnavailableError';
  }
}

/** Preferences-backed persistent storage for config, identity and tokens. */
export class SecureStore {
  private prefs: preferences.Preferences | undefined = undefined;
  /** In-memory mirror of the pinned Host keys, so callers keep a synchronous read. */
  private hostPins: Record<string, string> = {};
  /** False once the system asset store refused a write; surfaced in diagnostics only. */
  private assetOk: boolean = true;

  async init(context: common.Context): Promise<void> {
    if (this.prefs === undefined) {
      const options: preferences.Options = { name: 'dshremote.store' };
      this.prefs = await preferences.getPreferences(context, options);
    }
    await this.migratePlaintextSecrets();
    await this.reloadHostPins();
  }

  /** Asset store reachable? Used by the settings screen to warn about a degraded device. */
  isSecretStorageHealthy(): boolean {
    return this.assetOk;
  }

  async loadConfig(): Promise<StoredServerConfig | undefined> {
    const text: string = this.getSync(KEY_CONFIG, '');
    if (text.length === 0) {
      return undefined;
    }
    try {
      const root: Record<string, Object> = JSON.parse(text) as Record<string, Object>;
      const config: StoredServerConfig = new StoredServerConfig();
      config.baseUrl = jsonStr(root, 'baseUrl', '');
      config.email = jsonStr(root, 'email', '');
      if (config.baseUrl.length === 0) {
        return undefined;
      }
      return config;
    } catch (e) {
      return undefined;
    }
  }

  async saveConfig(config: StoredServerConfig): Promise<void> {
    const body: Record<string, Object> = {
      'baseUrl': config.baseUrl,
      'email': config.email
    };
    await this.putSync(KEY_CONFIG, JSON.stringify(body));
  }

  async loadIdentity(): Promise<DeviceIdentity | undefined> {
    const text: string = this.getSync(KEY_IDENTITY, '');
    if (text.length === 0) {
      return undefined;
    }
    let root: Record<string, Object>;
    try {
      root = JSON.parse(text) as Record<string, Object>;
    } catch (e) {
      return undefined;
    }
    const identity: DeviceIdentity = new DeviceIdentity();
    identity.deviceId = jsonStr(root, 'deviceId', '');
    identity.name = jsonStr(root, 'name', '');
    identity.platform = jsonStr(root, 'platform', '');
    identity.publicKey = jsonStr(root, 'publicKey', '');
    if (identity.deviceId.length === 0 || identity.publicKey.length === 0) {
      return undefined;
    }
    let privateKey: string | undefined = await this.readSecret(identitySecretAlias(identity.deviceId));
    if (privateKey === undefined || privateKey.length === 0) {
      // Legacy build stored the key inline; migrate it on the spot.
      privateKey = jsonStr(root, 'privateKey', '');
      if (privateKey.length > 0) {
        // 迁移顺序不能反：先确认安全存储里能读回同一份私钥，才允许把带明文的旧记录
        // 改写成「只有公钥」。写失败就原样保留旧记录 —— 它可能是最后一份私钥。
        if (await this.writeSecretVerified(identitySecretAlias(identity.deviceId), privateKey)) {
          this.putPublicIdentity(identity);
        } else {
          logWarn('identity migration kept legacy record: secure storage write failed');
        }
      }
    }
    if (privateKey === undefined || privateKey.length === 0) {
      return undefined;
    }
    identity.privateKey = privateKey;
    return identity;
  }

  async saveIdentity(identity: DeviceIdentity): Promise<void> {
    const stored: boolean = await this.writeSecretVerified(identitySecretAlias(identity.deviceId),
      identity.privateKey);
    if (!stored) {
      // 不再提供「明文兜底」：私钥落进 preferences 等于绕开系统安全存储。
      // 明确报错并保持旧记录不动，让调用方提示用户（通常是设备锁着）。
      throw new SecureStorageUnavailableError(
        '设备私钥无法写入系统安全存储，已中止保存（未写入明文）。请解锁设备后重试。');
    }
    this.putPublicIdentity(identity);
  }

  /** Public half of the identity: identifiers and the X25519 public key are not secrets. */
  private putPublicIdentity(identity: DeviceIdentity): void {
    const body: Record<string, Object> = {
      'deviceId': identity.deviceId,
      'name': identity.name,
      'platform': identity.platform,
      'publicKey': identity.publicKey
    };
    this.putSync(KEY_IDENTITY, JSON.stringify(body));
  }

  async loadCredentials(config: StoredServerConfig | undefined): Promise<TokenPair | undefined> {
    if (!config || !config.baseUrl || !config.email) return undefined;
    const text = await this.readSecret(ASSET_ALIAS_CREDENTIALS);
    if (!text) return undefined;
    try {
      const root: Record<string, Object> = JSON.parse(text) as Record<string, Object>;
      if (root['scope'] !== credentialScope(config)) return undefined;
      const pair: TokenPair = new TokenPair();
      pair.accessToken = jsonStr(root, 'accessToken', '');
      pair.accessTokenExpiresAt = jsonNum(root, 'accessTokenExpiresAt', 0);
      pair.refreshToken = jsonStr(root, 'refreshToken', '');
      pair.refreshTokenExpiresAt = jsonNum(root, 'refreshTokenExpiresAt', 0);
      if (pair.accessToken.length === 0 || pair.refreshToken.length === 0) {
        return undefined;
      }
      return pair;
    } catch (e) {
      return undefined;
    }
  }

  async saveCredentials(pair: TokenPair, config: StoredServerConfig): Promise<void> {
    if (!config.baseUrl || !config.email) throw new Error('Missing credential scope.');
    const body: Record<string, Object> = {
      'scope': credentialScope(config),
      'accessToken': pair.accessToken,
      'accessTokenExpiresAt': pair.accessTokenExpiresAt,
      'refreshToken': pair.refreshToken,
      'refreshTokenExpiresAt': pair.refreshTokenExpiresAt
    };
    // Await the flush: a rotated refresh token must reach disk before we continue, or a
    // crash right after the Server spent the old one would strand this device offline.
    const json: string = JSON.stringify(body);
    if (!await this.writeSecretVerified(ASSET_ALIAS_CREDENTIALS, json)) {
      // 同上：token 也不许落明文。旧凭据留在原处，调用方可重试。
      throw new SecureStorageUnavailableError(
        '登录凭据无法写入系统安全存储，已中止保存（未写入明文）。请解锁设备后重试。');
    }
    await this.removeCredentialPreferences();
  }

  async clearCredentials(): Promise<void> {
    await this.scrubLegacyProfiles();
    await this.deleteSecret(ASSET_ALIAS_CREDENTIALS);
    await this.removeCredentialPreferences();
  }

  /** Load the persisted device identity or create + persist a fresh one. */
  async loadOrCreateIdentity(): Promise<DeviceIdentity> {
    const stored: DeviceIdentity | undefined = await this.loadIdentity();
    if (stored !== undefined && isCanonicalDeviceId(stored.deviceId)) {
      return stored;
    }
    // 安全存储读不出来 ≠ 没有身份。若本地仍留有身份记录却拿不到私钥，
    // 直接生成新身份会把设备变成「新设备」：服务器侧凭据、Host 固定记录全部失效。
    // 这种情况宁可报错让用户重试，也不静默轮换身份。
    if (stored === undefined && this.getSync(KEY_IDENTITY, '').length > 0) {
      const code: number = this.assetErrorCode();
      // 24000002/24000001 = 安全存储里确实没有这条记录（例如换签名证书后系统不再允许
      // 旧条目、或数据被系统清理）；24000003 = 设备未解锁，属于可重试
      const lost: boolean = code === 24000002 || code === 24000001;
      const reason: string = code === 24000003
        ? '（错误码 24000003：设备未解锁）'
        : (code === 0 ? '' : '（错误码 ' + code + (lost ? '：安全存储条目已丢失' : '') + '）');
      const tail: string = lost
        ? '。私钥已不在安全存储里，无法恢复原身份；如需继续使用，请点「重置设备身份」后重新登录。'
        : '。为避免设备身份被轮换，已中止；请解锁设备后重试。';
      throw new Error('设备身份读取失败（系统安全存储不可用）' + reason + tail);
    }
    if (stored !== undefined) {
      // Older builds generated 32 raw hex characters, which the Server rejects: a device id
      // must be a UUIDv7 or a ULID. Such an identity can never register, so start clean.
      await this.clearCredentials();
    }
    const identity: DeviceIdentity = new DeviceIdentity();
    const privateKeyBytes: Uint8Array = randomBytes(32);
    const publicKeyBytes: Uint8Array = x25519Public(privateKeyBytes);
    identity.deviceId = uuidV7();
    identity.name = 'HarmonyOS · DSH Remote';
    identity.platform = 'harmonyos';
    identity.privateKey = toBase64Url(privateKeyBytes);
    identity.publicKey = toBase64Url(publicKeyBytes);
    await this.saveIdentity(identity);
    return identity;
  }

  /**
   * 彻底重置设备身份：私钥已从安全存储丢失时的唯一出路。
   * 清掉 KV 里的身份/凭据/主机固定，下次 loadOrCreateIdentity 会生成全新身份。
   */
  async resetIdentity(): Promise<void> {
    await this.clearCredentials();
    await this.clearHostPins();
    try {
      const raw: string = this.getSync(KEY_IDENTITY, '');
      if (raw.length > 0) {
        const root: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
        const deviceId: string = jsonStr(root, 'deviceId', '');
        if (deviceId.length > 0) {
          await this.deleteSecret(identitySecretAlias(deviceId));
        }
      }
    } catch (error) {
      logWarn('resetIdentity: 旧 asset 清理失败，继续');
    }
    this.deleteSyncKey(KEY_IDENTITY);
    logWarn('device identity reset by user');
  }

  /** User-defined display names for host devices, keyed by deviceId. */
  loadDeviceAliases(): Record<string, string> {
    const result: Record<string, string> = {};
    const raw: string = this.getSync(KEY_DEVICE_ALIASES, '{}');
    if (raw.length === 0) {
      return result;
    }
    try {
      const parsed: Object = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const rec: Record<string, Object> = parsed as Record<string, Object>;
        for (const key of Object.keys(rec)) {
          const value: Object | undefined = rec[key];
          if (typeof value === 'string' && value.length > 0) {
            result[key] = value;
          }
        }
      }
    } catch (error) {
      // Malformed store: start from an empty alias map.
    }
    return result;
  }

  async saveDeviceAliases(aliases: Record<string, string>): Promise<void> {
    await this.putSync(KEY_DEVICE_ALIASES, JSON.stringify(aliases));
  }

  loadAutoConnectLastHost(): boolean {
    return this.getSync(KEY_AUTO_CONNECT_LAST_HOST, '1') !== '0';
  }

  async saveAutoConnectLastHost(value: boolean): Promise<void> {
    await this.putSync(KEY_AUTO_CONNECT_LAST_HOST, value ? '1' : '0');
  }

  /** Theme preference: 0 = follow system, 1 = light, 2 = dark. */
  loadThemeMode(): number {
    const raw: string = this.getSync(KEY_THEME_MODE, '0');
    const parsed: number = Number.parseInt(raw);
    if (parsed === 1 || parsed === 2) {
      return parsed;
    }
    return 0;
  }

  async saveThemeMode(mode: number): Promise<void> {
    await this.putSync(KEY_THEME_MODE, `${mode}`);
  }

  /** Language preference: 0 = follow system, 1 = Chinese, 2 = English. */
  loadLanguageMode(): number {
    const raw: string = this.getSync(KEY_LANGUAGE_MODE, '0');
    const parsed: number = Number.parseInt(raw);
    if (parsed === 1 || parsed === 2) {
      return parsed;
    }
    return 0;
  }

  async saveLanguageMode(mode: number): Promise<void> {
    await this.putSync(KEY_LANGUAGE_MODE, `${mode}`);
  }

  /** 文字大小档位：0 小(0.9) / 1 标准(1.0) / 2 大(1.15) / 3 特大(1.3)。 */
  loadTextScale(): number {
    const raw: string = this.getSync(KEY_TEXT_SCALE, '1');
    const parsed: number = Number.parseInt(raw);
    if (parsed >= 0 && parsed <= 3) {
      return parsed;
    }
    return 1;
  }

  async saveTextScale(mode: number): Promise<void> {
    await this.putSync(KEY_TEXT_SCALE, `${mode}`);
  }

  /** 会话列表密度：0 自动（分栏才紧凑）/ 1 紧凑 / 2 超紧凑。 */
  loadLayoutDensity(): number {
    const raw: string = this.getSync('layoutDensity', '0');
    const parsed: number = Number.parseInt(raw);
    if (parsed >= 0 && parsed <= 2) {
      return parsed;
    }
    return 0;
  }

  async saveLayoutDensity(value: number): Promise<void> {
    await this.putSync('layoutDensity', `${value}`);
  }

  /** 超宽窗口是否显示右侧「会话详情」栏。 */
  loadShowInspector(): boolean {
    return this.getSync('showInspector', '1') !== '0';
  }

  async saveShowInspector(value: boolean): Promise<void> {
    await this.putSync('showInspector', value ? '1' : '0');
  }

  /** 分栏布局里会话栏的宽度（vp）；0 表示用默认比例。 */
  loadSplitWidth(): number {
    const raw: string = this.getSync('splitWidth', '0');
    const parsed: number = Number.parseInt(raw);
    if (parsed >= 200 && parsed <= 520) {
      return parsed;
    }
    return 0;
  }

  async saveSplitWidth(width: number): Promise<void> {
    await this.putSync('splitWidth', `${Math.round(width)}`);
  }

  /** Locally pinned Host identity keys (protocol §2 / §12.1), keyed by Host deviceId.
   *  A Host whose key no longer matches its pin must never be connected silently. */
  loadHostPins(): Record<string, string> {
    return this.hostPins;
  }

  async saveHostPins(pins: Record<string, string>): Promise<void> {
    this.hostPins = pins;
    const json: string = JSON.stringify(pins);
    if (await this.writeSecret(ASSET_ALIAS_HOST_PINS, json)) {
      this.deleteSyncKey(KEY_HOST_PINS);
      return;
    }
    logWarn('host pins stored in sandbox KV (asset store unavailable)');
    await this.putSync(KEY_HOST_PINS, json);
  }

  /** Forget one pinned Host key: the next connection re-runs trust-on-first-use. */
  async forgetHostPin(hostDeviceId: string): Promise<void> {
    const next: Record<string, string> = {};
    for (const key of Object.keys(this.hostPins)) {
      if (key !== hostDeviceId) {
        next[key] = this.hostPins[key];
      }
    }
    await this.saveHostPins(next);
  }

  /** Remove all pinned Host identities when changing Server/account. */
  async clearHostPins(): Promise<void> {
    await this.deleteSecret(ASSET_ALIAS_HOST_PINS);
    const prefs = this.prefs!;
    prefs.deleteSync(KEY_HOST_PINS);
    await prefs.flush();
    this.hostPins = {};
  }

  private async reloadHostPins(): Promise<void> {
    let raw: string | undefined = await this.readSecret(ASSET_ALIAS_HOST_PINS);
    if (raw === undefined || raw.length === 0) {
      raw = this.getSync(KEY_HOST_PINS, '{}');
      if (raw.length > 2 && await this.writeSecret(ASSET_ALIAS_HOST_PINS, raw)) {
        this.deleteSyncKey(KEY_HOST_PINS);
      }
    }
    const result: Record<string, string> = {};
    try {
      const parsed: Object = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const rec: Record<string, Object> = parsed as Record<string, Object>;
        for (const key of Object.keys(rec)) {
          const value: Object | undefined = rec[key];
          if (typeof value === 'string' && value.length > 0) {
            result[key] = value;
          }
        }
      }
    } catch (error) {
      // Malformed store: start from an empty pin map (trust-on-first-use again).
    }
    this.hostPins = result;
  }

  private async removeCredentialPreferences(): Promise<void> {
    const prefs = this.prefs!;
    prefs.deleteSync(LEGACY_PROFILES);
    prefs.deleteSync(LEGACY_PROFILE_OWNERS);
    prefs.deleteSync(KEY_CREDENTIALS);
    await prefs.flush();
  }

  private async scrubLegacyProfiles(): Promise<string> {
    const profiles = this.getSync(LEGACY_PROFILES, '');
    if (!profiles) return this.getSync(LEGACY_PROFILE_OWNERS, '');
    const owners = legacyProfileOwners(profiles);
    const prefs = this.prefs!;
    prefs.putSync(LEGACY_PROFILE_OWNERS, owners);
    prefs.deleteSync(LEGACY_PROFILES);
    await prefs.flush();
    return owners;
  }

  /** Upgrade the active login before accepting any config changes. */
  private async migrateCredentials(): Promise<void> {
    const owners = await this.scrubLegacyProfiles();
    const plaintext = this.getSync(KEY_CREDENTIALS, '');
    const config = await this.loadConfig();
    if (!config || !config.email) {
      await this.removeCredentialPreferences();
      await this.deleteSecret(ASSET_ALIAS_CREDENTIALS);
      return;
    }

    const stored = await this.readSecret(ASSET_ALIAS_CREDENTIALS, true);
    const text = stored ?? plaintext;
    if (text) {
      let record: Record<string, Object> | undefined = undefined;
      try {
        record = asRecord(JSON.parse(text) as Object);
      } catch (error) {
        // A corrupt token record requires a fresh login.
      }
      if (record === undefined) {
        await this.clearCredentials();
        return;
      }
      const unscoped = record['scope'] === undefined;
      if (unscoped) {
        // v0.6.7 wrote config before tokens. An interrupted switch can leave different owners.
        const scope = credentialScope(config);
        if (!legacyProfileMatches(owners, scope, record)) {
          await this.clearCredentials();
          return;
        }
        record['scope'] = scope;
      }
      if ((unscoped || stored === undefined)
        && !await this.writeSecretVerified(ASSET_ALIAS_CREDENTIALS, JSON.stringify(record))) {
        throw new SecureStorageUnavailableError('登录凭据迁移失败，请解锁设备后重试。');
      }
    }
    if (owners || plaintext) await this.removeCredentialPreferences();
  }

  /** Move any value written by an older build out of the plaintext KV. */
  private async migratePlaintextSecrets(): Promise<void> {
    await this.migrateCredentials();
    const legacyPins: string = this.getSync(KEY_HOST_PINS, '');
    if (legacyPins.length > 2) {
      if (await this.writeSecret(ASSET_ALIAS_HOST_PINS, legacyPins)) {
        this.deleteSyncKey(KEY_HOST_PINS);
      }
    }
    const legacyIdentity: string = this.getSync(KEY_IDENTITY, '');
    if (legacyIdentity.length > 0) {
      try {
        const root: Record<string, Object> = JSON.parse(legacyIdentity) as Record<string, Object>;
        const deviceId: string = jsonStr(root, 'deviceId', '');
        const privateKey: string = jsonStr(root, 'privateKey', '');
        if (deviceId.length > 0 && privateKey.length > 0) {
          if (await this.writeSecretVerified(identitySecretAlias(deviceId), privateKey)) {
            const identity: DeviceIdentity = new DeviceIdentity();
            identity.deviceId = deviceId;
            identity.name = jsonStr(root, 'name', '');
            identity.platform = jsonStr(root, 'platform', '');
            identity.publicKey = jsonStr(root, 'publicKey', '');
            this.putPublicIdentity(identity);
          }
        }
      } catch (error) {
        logError('identity migration skipped');
      }
    }
  }

  // ─── Asset Store Kit primitives ─────────────────────────────────────────────
  // Accessible only while the device is unlocked, and never synced off this device,
  // which is the HarmonyOS equivalent of Android's WHEN_UNLOCKED_THIS_DEVICE_ONLY.

  private async writeSecret(alias: string, secret: string): Promise<boolean> {
    try {
      const attrs: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      attrs.set(asset.Tag.ALIAS, encodeUtf8(alias));
      attrs.set(asset.Tag.SECRET, encodeUtf8(secret));
      attrs.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
      attrs.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
      attrs.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
      await asset.add(attrs);
      this.assetOk = true;
      return true;
    } catch (error) {
      this.assetOk = false;
      logError('asset add failed for');
      return false;
    }
  }

  /**
   * 写入后回读比对，只有读回来的内容完全一致才算成功。
   * 迁移/覆盖信任记录这类「写完就要删旧数据」的场景必须用它。
   */
  private async writeSecretVerified(alias: string, secret: string): Promise<boolean> {
    if (!await this.writeSecret(alias, secret)) {
      return false;
    }
    const readBack: string | undefined = await this.readSecretQuiet(alias);
    if (readBack === secret) {
      return true;
    }
    logError('asset verify failed for ' + alias);
    return false;
  }

  private async readSecretQuiet(alias: string): Promise<string | undefined> {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, encodeUtf8(alias));
      query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      const rows: Array<asset.AssetMap> = await asset.query(query);
      if (rows.length === 0) {
        return undefined;
      }
      const secret: asset.Value | undefined = rows[0].get(asset.Tag.SECRET);
      if (secret instanceof Uint8Array) {
        return decodeUtf8(secret);
      }
      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  /** 最近一次 Asset Store 读取失败的错误码（0 表示没有失败），给上层区分「未解锁」和「没有数据」。 */
  private lastAssetErrorCode: number = 0;

  assetErrorCode(): number {
    return this.lastAssetErrorCode;
  }

  private async readSecret(alias: string, requireAvailable: boolean = false): Promise<string | undefined> {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, encodeUtf8(alias));
      query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      const rows: Array<asset.AssetMap> = await asset.query(query);
      if (rows.length === 0) {
        return undefined;
      }
      const secret: asset.Value | undefined = rows[0].get(asset.Tag.SECRET);
      if (secret instanceof Uint8Array) {
        return decodeUtf8(secret);
      }
      return undefined;
    } catch (error) {
      const code: number = (error as Record<string, Object>)['code'] as number;
      if (typeof code === 'number') {
        this.lastAssetErrorCode = code;
      }
      if (code === 24000002) return undefined;
      this.assetOk = false;
      if (requireAvailable) {
        throw new SecureStorageUnavailableError('无法读取系统安全存储，请解锁设备后重试。');
      }
      logError('asset query failed for');
      return undefined;
    }
  }

  private async deleteSecret(alias: string): Promise<void> {
    try {
      const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      query.set(asset.Tag.ALIAS, encodeUtf8(alias));
      await asset.remove(query);
    } catch (error) {
      // 24000002 = not found, which is the desired end state anyway.
      const code: number = (error as Record<string, Object>)['code'] as number;
      if (code !== 24000002) {
        throw new SecureStorageUnavailableError('无法清理系统安全存储，请解锁设备后重试。');
      }
    }
  }


  /** 会话草稿：按 sessionId 存，纯文本，不含任何凭据。 */
  loadDrafts(): Record<string, string> {
    const raw: string = this.getSync(KEY_DRAFTS, '');
    if (raw.length === 0) {
      return {};
    }
    const out: Record<string, string> = {};
    try {
      const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      for (const key of Object.keys(parsed)) {
        const value: Object = parsed[key];
        if (typeof value === 'string' && value.length > 0) {
          out[key] = value;
        }
      }
    } catch (error) {
      logWarn('drafts parse failed');
    }
    return out;
  }

  saveDrafts(drafts: Record<string, string>): void {
    try {
      this.putSync(KEY_DRAFTS, JSON.stringify(drafts));
    } catch (error) {
      logWarn('drafts save failed');
    }
  }

  /** 提示词库：自定义条目，按顺序保存。 */
  loadPrompts(): string[] {
    const raw: string = this.getSync(KEY_PROMPTS, '');
    if (raw.length === 0) {
      return [];
    }
    const out: string[] = [];
    try {
      const parsed: Object = JSON.parse(raw) as Object;
      if (Array.isArray(parsed)) {
        for (const item of parsed as Object[]) {
          if (typeof item === 'string' && item.trim().length > 0) {
            out.push(item);
          }
        }
      }
    } catch (error) {
      logWarn('prompts parse failed');
    }
    return out;
  }

  savePrompts(prompts: string[]): void {
    try {
      this.putSync(KEY_PROMPTS, JSON.stringify(prompts));
    } catch (error) {
      logWarn('prompts save failed');
    }
  }


  /** 会话收藏 + 最近访问（纯本地偏好，不含会话内容）。 */
  loadSessionMeta(): Record<string, string[]> {
    const raw: string = this.getSync(KEY_SESSION_META, '');
    const out: Record<string, string[]> = { 'favorites': [], 'recents': [] };
    if (raw.length === 0) {
      return out;
    }
    try {
      const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      for (const key of ['favorites', 'recents']) {
        const value: Object | undefined = parsed[key];
        if (Array.isArray(value)) {
          const list: string[] = [];
          for (const item of value as Object[]) {
            if (typeof item === 'string' && item.length > 0) {
              list.push(item);
            }
          }
          out[key] = list;
        }
      }
    } catch (error) {
      logWarn('session meta parse failed');
    }
    return out;
  }

  saveSessionMeta(favorites: string[], recents: string[]): void {
    try {
      this.putSync(KEY_SESSION_META, JSON.stringify({ 'favorites': favorites, 'recents': recents }));
    } catch (error) {
      logWarn('session meta save failed');
    }
  }

  loadSessionView(): Record<string, string> {
    const raw: string = this.getSync(KEY_SESSION_VIEW, '');
    if (raw.length === 0) {
      return {};
    }
    try {
      const root: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      const out: Record<string, string> = {};
      const groupBy: Object | undefined = root['groupBy'];
      const orderBy: Object | undefined = root['orderBy'];
      const filterMode: Object | undefined = root['filterMode'];
      if (typeof groupBy === 'string') out['groupBy'] = groupBy;
      if (typeof orderBy === 'string') out['orderBy'] = orderBy;
      if (typeof filterMode === 'string') out['filterMode'] = filterMode;
      return out;
    } catch (error) {
      return {};
    }
  }

  saveSessionView(groupBy: string, orderBy: string, filterMode: string): void {
    try {
      this.putSync(KEY_SESSION_VIEW, JSON.stringify({ groupBy, orderBy, filterMode }));
    } catch (error) {
      logWarn('session view save failed');
    }
  }

  /** 上次连着的主机 deviceId（空 = 没有，别自动连）。 */
  loadLastHost(): string {
    return this.getSync(KEY_LAST_HOST, '');
  }

  saveLastHost(deviceId: string): void {
    try {
      this.putSync(KEY_LAST_HOST, deviceId);
    } catch (error) {
      logWarn('last host save failed');
    }
  }

  /** 缓存的主机信息（重连用）；没有就是空串。 */
  loadHostInfo(deviceId: string): string {
    const raw: string = this.getSync(KEY_HOST_INFO, '');
    if (raw.length === 0) {
      return '';
    }
    try {
      const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      const id: Object | undefined = parsed['deviceId'];
      if (typeof id !== 'string' || id !== deviceId) {
        return '';
      }
      return raw;
    } catch (error) {
      return '';
    }
  }

  saveHostInfo(json: string): void {
    try {
      this.putSync(KEY_HOST_INFO, json);
    } catch (error) {
      logWarn('host info save failed');
    }
  }

  clearHostInfo(): void {
    try {
      this.putSync(KEY_HOST_INFO, '');
    } catch (error) {
      logWarn('host info clear failed');
    }
  }

  /** 会话列表快照（侧栏兜底/首屏秒开用）；空串表示没有。 */
  loadSessionSnapshot(hostDeviceId: string): string {
    const raw: string = this.getSync(KEY_SESSION_SNAPSHOT, '');
    if (raw.length === 0) {
      return '';
    }
    try {
      const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      const host: Object | undefined = parsed['host'];
      if (typeof host !== 'string' || host !== hostDeviceId) {
        return '';
      }
      return raw;
    } catch (error) {
      return '';
    }
  }

  saveSessionSnapshot(json: string): void {
    try {
      this.putSync(KEY_SESSION_SNAPSHOT, json);
    } catch (error) {
      logWarn('session snapshot save failed');
    }
  }

  loadPet(): boolean {
    return this.getSync(KEY_PET, '1') === '1';
  }

  savePet(enabled: boolean): void {
    try {
      this.putSync(KEY_PET, enabled ? '1' : '0');
    } catch (error) {
      logWarn('pet save failed');
    }
  }

  loadThemeTint(): number {
    const raw: string = this.getSync(KEY_THEME_TINT, '0');
    const value: number = parseInt(raw, 10);
    return Number.isNaN(value) ? 0 : value;
  }

  saveThemeTint(tint: number): void {
    try {
      this.putSync(KEY_THEME_TINT, '' + tint);
    } catch (error) {
      logWarn('theme tint save failed');
    }
  }

  loadCompactHistory(): boolean {
    return this.getSync(KEY_COMPACT_HISTORY, '0') === '1';
  }

  saveCompactHistory(enabled: boolean): void {
    try {
      this.putSync(KEY_COMPACT_HISTORY, enabled ? '1' : '0');
    } catch (error) {
      logWarn('compact history save failed');
    }
  }

  loadSecretMask(): boolean {
    // 默认开：宁可多遮，用户点一下就能看
    return this.getSync(KEY_SECRET_MASK, '1') === '1';
  }

  saveSecretMask(enabled: boolean): void {
    try {
      this.putSync(KEY_SECRET_MASK, enabled ? '1' : '0');
    } catch (error) {
      logWarn('secret mask save failed');
    }
  }

  private deleteSyncKey(key: string): void {
    const prefs: preferences.Preferences | undefined = this.prefs;
    if (prefs === undefined) {
      return;
    }
    prefs.deleteSync(key);
    prefs.flush().catch(() => undefined);
  }

  private getSync(key: string, fallback: string): string {
    const prefs: preferences.Preferences | undefined = this.prefs;
    if (prefs === undefined) {
      return fallback;
    }
    const value: preferences.ValueType = prefs.getSync(key, fallback);
    return typeof value === 'string' ? value : fallback;
  }

  private async putSync(key: string, value: string): Promise<void> {
    const prefs: preferences.Preferences | undefined = this.prefs;
    if (prefs === undefined) {
      return;
    }
    prefs.putSync(key, value);
    await prefs.flush();
  }
}
