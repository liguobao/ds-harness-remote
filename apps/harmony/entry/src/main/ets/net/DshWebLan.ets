import { asRecord } from '../protocol/Types';
import { DshWebGrant } from './DshWebGrant';
import { RemoteClientCore } from './RemoteClientCore';

export class DshWebLan {
  private readonly core: RemoteClientCore;
  private readonly isLan: () => boolean;
  private sessionId: string = '';

  constructor(core: RemoteClientCore, isLan: () => boolean) { this.core = core; this.isLan = isLan; }

  async open(): Promise<DshWebGrant> {
    if (!this.isLan()) throw new Error('LAN unavailable');
    const value = asRecord(await this.core.rpc('dsh.web.lan.direct.open', {}));
    const id = value?.['sessionId'];
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid session');
    this.sessionId = id;
    const raw = value?.['url'];
    const token = value?.['browserGrant'];
    const expiry = value?.['expiresAt'];
    if (this.isLan() && typeof raw === 'string' && typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
      && typeof expiry === 'number' && expiry > Date.now()) {
      const m = /^http:\/\/((?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)[0-9.]+):([1-9][0-9]{0,4})\/$/.exec(raw);
      if (m && Number(m[2]) <= 65535) {
        const parts = m[1].split('.');
        if (parts.length === 4 && parts.every((p: string) => Number(p) <= 255 && String(Number(p)) === p))
          return new DshWebGrant(raw, raw.slice(0, -1), token);
      }
    }
    await this.close();
    throw new Error('Invalid LAN Web grant');
  }

  async close(): Promise<void> {
    const id = this.sessionId;
    this.sessionId = '';
    if (id.length > 0) {
      const args: Record<string, Object> = { 'sessionId': id };
      await this.core.rpc('dsh.web.lan.direct.close', args, 4000).catch(() => undefined);
    }
  }
}
