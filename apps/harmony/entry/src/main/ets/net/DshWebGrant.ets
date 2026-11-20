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
