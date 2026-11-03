import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { DeviceIdentity, TokenPair } from '../model/Types';
import { randomBytes, uuidV7, randomId, toBase64Url } from '../crypto/Bytes';
import { x25519Public } from '../crypto/X25519';
import { jsonStr, jsonNum } from '../protocol/Types';
import { logWarn, logError } from '../util/Log';

const KEY_CONFIG = 'dshremote.server.v1';
const KEY_IDENTITY = 'dshremote.identity.v1';
const KEY_CREDENTIALS = 'dshremote.credentials.v1';
const KEY_DEVICE_ALIASES = 'dshremote.deviceAliases.v1';
const KEY_THEME_MODE = 'dshremote.themeMode.v1';
const KEY_HOST_PINS = 'dshremote.hostPins.v1';

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
    this.putSync(KEY_CONFIG, JSON.stringify(body));
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
        await this.writeSecret(identitySecretAlias(identity.deviceId), privateKey);
        this.putPublicIdentity(identity);
      }
    }
    if (privateKey === undefined || privateKey.length === 0) {
      return undefined;
    }
    identity.privateKey = privateKey;
    return identity;
  }

  async saveIdentity(identity: DeviceIdentity): Promise<void> {
    const stored: boolean = await this.writeSecret(identitySecretAlias(identity.deviceId),
      identity.privateKey);
    if (!stored) {
      // Last-resort compatibility path for devices without a usable asset store.
      logWarn('identity private key stored in sandbox KV (asset store unavailable)');
      const legacy: Record<string, Object> = {
        'deviceId': identity.deviceId,
        'name': identity.name,
        'platform': identity.platform,
        'privateKey': identity.privateKey,
        'publicKey': identity.publicKey
      };
      await this.putSync(KEY_IDENTITY, JSON.stringify(legacy));
      return;
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

  async loadCredentials(): Promise<TokenPair | undefined> {
    let text: string | undefined = await this.readSecret(ASSET_ALIAS_CREDENTIALS);
    if (text === undefined || text.length === 0) {
      // Legacy plaintext value (or asset store unavailable): read and migrate.
      const legacy: string = this.getSync(KEY_CREDENTIALS, '');
      if (legacy.length === 0) {
        return undefined;
      }
      if (await this.writeSecret(ASSET_ALIAS_CREDENTIALS, legacy)) {
        this.deleteSyncKey(KEY_CREDENTIALS);
      }
      text = legacy;
    }
    try {
      const root: Record<string, Object> = JSON.parse(text) as Record<string, Object>;
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

  async saveCredentials(pair: TokenPair): Promise<void> {
    const body: Record<string, Object> = {
      'accessToken': pair.accessToken,
      'accessTokenExpiresAt': pair.accessTokenExpiresAt,
      'refreshToken': pair.refreshToken,
      'refreshTokenExpiresAt': pair.refreshTokenExpiresAt
    };
    // Await the flush: a rotated refresh token must reach disk before we continue, or a
    // crash right after the Server spent the old one would strand this device offline.
    const json: string = JSON.stringify(body);
    if (await this.writeSecret(ASSET_ALIAS_CREDENTIALS, json)) {
      this.deleteSyncKey(KEY_CREDENTIALS);
      return;
    }
    logWarn('account tokens stored in sandbox KV (asset store unavailable)');
    await this.putSync(KEY_CREDENTIALS, json);
  }

  async clearCredentials(): Promise<void> {
    await this.deleteSecret(ASSET_ALIAS_CREDENTIALS);
    this.deleteSyncKey(KEY_CREDENTIALS);
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
      throw new Error('设备身份读取失败（系统安全存储不可用）。为避免设备身份被轮换，已中止；请解锁设备后重试。');
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

  /** Move any value written by an older build out of the plaintext KV. */
  private async migratePlaintextSecrets(): Promise<void> {
    const legacyCredentials: string = this.getSync(KEY_CREDENTIALS, '');
    if (legacyCredentials.length > 0) {
      if (await this.writeSecret(ASSET_ALIAS_CREDENTIALS, legacyCredentials)) {
        this.deleteSyncKey(KEY_CREDENTIALS);
      }
    }
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
          if (await this.writeSecret(identitySecretAlias(deviceId), privateKey)) {
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
      await this.deleteSecret(alias);
      const attrs: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      attrs.set(asset.Tag.ALIAS, encodeUtf8(alias));
      attrs.set(asset.Tag.SECRET, encodeUtf8(secret));
      attrs.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_UNLOCKED);
      attrs.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER);
      await asset.add(attrs);
      this.assetOk = true;
      return true;
    } catch (error) {
      this.assetOk = false;
      logError('asset add failed for ' + alias + ': ' + JSON.stringify(error));
      return false;
    }
  }

  private async readSecret(alias: string): Promise<string | undefined> {
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
      this.assetOk = false;
      logError('asset query failed for ' + alias + ': ' + JSON.stringify(error));
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
        logWarn('asset remove failed for ' + alias + ': ' + JSON.stringify(error));
      }
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
