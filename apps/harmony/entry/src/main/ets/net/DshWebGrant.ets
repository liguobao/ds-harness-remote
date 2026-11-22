import { url } from '@kit.ArkTS';
import { asRecord } from '../protocol/Types';

const CLOCK_SKEW_MS: number = 60000;

export class DshWebGrant {
  readonly url: string;
  readonly origin: string;
  readonly browserGrant: string;

  constructor(url: string, origin: string, browserGrant: string) {
    this.url = url;
    this.origin = origin;
    this.browserGrant = browserGrant;
  }
}

/** The same strict grant shape and canonical HTTPS origin as the shared protocol schema. */
export function parseDshWebGrant(value: Object, now: number): DshWebGrant {
  const record = asRecord(value);
  const rawUrl = record?.['url'];
  const token = record?.['browserGrant'];
  const expiresAt = record?.['expiresAt'];
  if (record === undefined || Object.keys(record).length !== 3 || typeof rawUrl !== 'string'
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || typeof expiresAt !== 'number' || !Number.isInteger(expiresAt) || expiresAt <= 0
    || expiresAt + CLOCK_SKEW_MS <= now) {
    throw new Error('INVALID_DSH_WEB_GRANT');
  }
  const parsed = url.URL.parseURL(rawUrl);
  if (parsed.protocol !== 'https:' || parsed.href !== parsed.origin + '/') {
    throw new Error('INVALID_DSH_WEB_GRANT');
  }
  return new DshWebGrant(parsed.href, parsed.origin, token);
}

export function isDshWebLanSessionId(value: string): boolean {
  return /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(value);
}

/** Validate an IPv4 direct grant against the shared LAN grant shape. */
export function parseDshWebLanGrant(value: Object, now: number): DshWebGrant {
  const record = asRecord(value);
  const raw = record?.['url'];
  const token = record?.['browserGrant'];
  const expiry = record?.['expiresAt'];
  const id = record?.['sessionId'];
  if (record === undefined || Object.keys(record).length !== 4 || typeof raw !== 'string'
    || typeof id !== 'string' || !isDshWebLanSessionId(id)
    || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)
    || typeof expiry !== 'number' || !Number.isInteger(expiry) || expiry <= now) {
    throw new Error('INVALID_DSH_WEB_LAN_GRANT');
  }
  const match = /^http:\/\/((?:127\.0\.0\.1|(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)[0-9.]+)):([1-9][0-9]{0,4})\/$/.exec(raw);
  if (match === null || Number(match[2]) === 80 || Number(match[2]) > 65535) {
    throw new Error('INVALID_DSH_WEB_LAN_GRANT');
  }
  const parts = match[1].split('.');
  if (parts.length !== 4 || !parts.every((part: string) =>
    /^[0-9]{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part)) {
    throw new Error('INVALID_DSH_WEB_LAN_GRANT');
  }
  return new DshWebGrant(raw, raw.slice(0, -1), token);
}

export function isDshWebOrigin(target: string, origin: string): boolean {
  try {
    return url.URL.parseURL(target).origin === origin;
  } catch {
    return false;
  }
}

export function isFatalDshWebHttpError(target: string, status: number, grantUrl: string, origin: string): boolean {
  if (target.length === 0) {
    return false;
  }
  if (target === grantUrl || target === grantUrl + '__remote/session') {
    return true;
  }
  return (status === 401 || status === 502 || status === 503 || status === 504) && isDshWebOrigin(target, origin);
}
