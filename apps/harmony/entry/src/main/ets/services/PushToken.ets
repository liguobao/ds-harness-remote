import { UIAbility } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';
import { pushService } from '@kit.PushKit';

export type PushTokenEvent = 'changed' | 'disabled';

/** In-memory PushKit token lifecycle. This component never sends or persists tokens. */
export class PushToken {
  private enabled: boolean = false;
  private listening: boolean = false;
  private generation: number = 0;
  private revision: number = 0;
  private token: string = '';
  private deletionPending: boolean = false;
  private deletion: Promise<boolean> | undefined = undefined;
  private readonly ability: UIAbility;
  private readonly notify: ((event: PushTokenEvent) => void) | undefined;
  private readonly onTokenUpdate: (token: string) => void;

  constructor(ability: UIAbility, notify?: (event: PushTokenEvent) => void) {
    this.ability = ability;
    this.notify = notify;
    this.onTokenUpdate = (token: string): void => {
      void this.acceptUpdate(token);
    };
  }

  /** Call only after an explicit user opt-in. Does not prompt for permission. */
  async enable(): Promise<boolean> {
    // Never obtain a replacement token while a previous revocation is unresolved.
    if (this.deletionPending || this.deletion !== undefined) return false;
    if (this.enabled) {
      return this.refresh();
    }
    const generation = ++this.generation;
    try {
      if (!await notificationManager.isNotificationEnabled() || generation !== this.generation) {
        return false;
      }
      this.enabled = true;
      pushService.on('tokenUpdate', this.ability, this.onTokenUpdate);
      this.listening = true;
      return await this.refresh();
    } catch (_) {
      if (generation === this.generation) {
        this.disable();
      }
      return false;
    }
  }

  /** Call on foreground/reconnect to recover missed updates and permission changes. */
  async refresh(): Promise<boolean> {
    if (!this.enabled) return false;
    const generation = this.generation;
    const revision = ++this.revision;
    try {
      if (!await notificationManager.isNotificationEnabled()) {
        if (generation === this.generation) this.disable();
        return false;
      }
      if (!this.enabled || generation !== this.generation) return false;
      const token = await pushService.getToken();
      if (!this.enabled || generation !== this.generation || revision !== this.revision) return false;
      if (!await notificationManager.isNotificationEnabled()) {
        if (generation === this.generation) this.disable();
        return false;
      }
      if (!this.enabled || generation !== this.generation || revision !== this.revision) return false;
      this.updateToken(token);
      return token.length > 0;
    } catch (_) {
      return false;
    }
  }

  /** Retrieve only for a separately authorized registration flow. Never log the result. */
  async current(): Promise<string> {
    const generation = this.generation;
    try {
      if (!this.enabled) return '';
      if (!await notificationManager.isNotificationEnabled()) {
        if (generation === this.generation) this.disable();
        return '';
      }
      return this.enabled && generation === this.generation ? this.token : '';
    } catch (_) {
      return '';
    }
  }

  /** Disable local access immediately and ask PushKit to delete its token.
   * A failure is retryable; success does not guarantee immediate delivery cessation.
   */
  async revoke(): Promise<boolean> {
    this.disable();
    this.deletionPending = true;
    if (this.deletion !== undefined) return this.deletion;
    const request: Promise<boolean> = this.deleteToken();
    this.deletion = request;
    const success: boolean = await request;
    this.deletion = undefined;
    return success;
  }

  private async deleteToken(): Promise<boolean> {
    try {
      await pushService.deleteToken();
      this.deletionPending = false;
      return true;
    } catch (_) {
      return false;
    }
  }

  disable(): void {
    const wasEnabled = this.enabled;
    this.enabled = false;
    this.generation++;
    this.revision++;
    this.token = '';
    if (this.listening) {
      this.listening = false;
      try { pushService.off('tokenUpdate', this.onTokenUpdate); } catch (_) {}
    }
    if (wasEnabled) this.emit('disabled');
  }

  private updateToken(token: string): void {
    if (token.length === 0) {
      this.disable();
      return;
    }
    if (token === this.token) return;
    this.token = token;
    this.emit('changed');
  }

  private emit(event: PushTokenEvent): void {
    try { this.notify?.(event); } catch (_) {}
  }

  private async acceptUpdate(token: string): Promise<void> {
    if (!this.enabled) return;
    const generation = this.generation;
    const revision = ++this.revision;
    try {
      if (!await notificationManager.isNotificationEnabled()) {
        if (generation === this.generation) this.disable();
        return;
      }
      if (this.enabled && generation === this.generation && revision === this.revision) {
        this.updateToken(token);
      }
    } catch (_) {}
  }
}
