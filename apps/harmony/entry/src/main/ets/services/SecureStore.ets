import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { DeviceIdentity, TokenPair } from '../model/Types';
import { randomBytes, uuidV7, randomId, toBase64Url } from '../crypto/Bytes';
import { x25519Public } from '../crypto/X25519';
import { jsonStr, jsonNum } from '../protocol/Types';

const KEY_CONFIG = 'dshremote.server.v1';
const KEY_IDENTITY = 'dshremote.identity.v1';
const KEY_CREDENTIALS = 'dshremote.credentials.v1';
const KEY_DEVICE_ALIASES = 'dshremote.deviceAliases.v1';
const KEY_THEME_MODE = 'dshremote.themeMode.v1';
const KEY_HOST_PINS = 'dshremote.hostPins.v1';

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

  async init(context: common.Context): Promise<void> {
    if (this.prefs === undefined) {
      const options: preferences.Options = { name: 'dshremote.store' };
      this.prefs = await preferences.getPreferences(context, options);
    }
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
    try {
      const root: Record<string, Object> = JSON.parse(text) as Record<string, Object>;
      const identity: DeviceIdentity = new DeviceIdentity();
      identity.deviceId = jsonStr(root, 'deviceId', '');
      identity.name = jsonStr(root, 'name', '');
      identity.platform = jsonStr(root, 'platform', '');
      identity.privateKey = jsonStr(root, 'privateKey', '');
      identity.publicKey = jsonStr(root, 'publicKey', '');
      if (identity.deviceId.length === 0 || identity.privateKey.length === 0
        || identity.publicKey.length === 0) {
        return undefined;
      }
      return identity;
    } catch (e) {
      return undefined;
    }
  }

  async saveIdentity(identity: DeviceIdentity): Promise<void> {
    const body: Record<string, Object> = {
      'deviceId': identity.deviceId,
      'name': identity.name,
      'platform': identity.platform,
      'privateKey': identity.privateKey,
      'publicKey': identity.publicKey
    };
    this.putSync(KEY_IDENTITY, JSON.stringify(body));
  }

  async loadCredentials(): Promise<TokenPair | undefined> {
    const text: string = this.getSync(KEY_CREDENTIALS, '');
    if (text.length === 0) {
      return undefined;
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
    await this.putSync(KEY_CREDENTIALS, JSON.stringify(body));
  }

  async clearCredentials(): Promise<void> {
    const prefs: preferences.Preferences | undefined = this.prefs;
    if (prefs === undefined) {
      return;
    }
    prefs.deleteSync(KEY_CREDENTIALS);
    await prefs.flush();
  }

  /** Load the persisted device identity or create + persist a fresh one. */
  async loadOrCreateIdentity(): Promise<DeviceIdentity> {
    const stored: DeviceIdentity | undefined = await this.loadIdentity();
    if (stored !== undefined && isCanonicalDeviceId(stored.deviceId)) {
      return stored;
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
    const result: Record<string, string> = {};
    const raw: string = this.getSync(KEY_HOST_PINS, '{}');
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
      // Malformed store: start from an empty pin map (trust-on-first-use again).
    }
    return result;
  }

  async saveHostPins(pins: Record<string, string>): Promise<void> {
    await this.putSync(KEY_HOST_PINS, JSON.stringify(pins));
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
