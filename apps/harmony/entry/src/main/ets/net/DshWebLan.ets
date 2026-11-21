import { asRecord } from '../protocol/Types';
import { DshWebGrant, isDshWebLanSessionId, parseDshWebLanGrant } from './DshWebGrant';
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
    if (value === undefined || typeof id !== 'string' || !isDshWebLanSessionId(id)) {
      throw new Error('INVALID_DSH_WEB_LAN_GRANT');
    }
    this.sessionId = id;
    try {
      if (!this.isLan()) throw new Error('LAN unavailable');
      return parseDshWebLanGrant(value, Date.now());
    } catch (error) {
      await this.close();
      throw new Error('INVALID_DSH_WEB_LAN_GRANT');
    }
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
