import { connection } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { logInfo, logWarn } from '../util/Log';

/**
 * 网络状态监听（P1）。
 *
 * 客户端原来对系统网络一无所知，只能等 WebSocket 自己断、或者等退避定时器烧完：
 * - 断网时 UI 还一身绿，用户以为在正常连；
 * - 网络恢复了也要干等 30 秒的退避档位。
 *
 * 这里只做「状态变化通知」，不做任何重连决策——策略留在 AppRuntime，
 * 免得网络事件和重连状态机两处都改。
 */

export class NetworkMonitor {
  /** 是否至少拿到过一次有效状态（拿不到时上层不要据此改文案）。 */
  public available: boolean = false;
  public online: boolean = true;
  /** 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown' */
  public type: string = 'unknown';

  private netConnection: connection.NetConnection | undefined = undefined;
  private registered: boolean = false;
  private lastType: string = '';
  /** 是否已经处理过第一个网络事件（第一个只是初始化，不算「恢复」）。 */
  private initialized: boolean = false;

  /** 断网：只报「没了」。 */
  public onLost: (() => void) | undefined = undefined;
  /** 网络回来（或换了网）：上层可以立刻重试，而不是等退避。 */
  public onAvailable: (() => void) | undefined = undefined;
  /** 承载类型变化（Wi-Fi ↔ 移动数据），用于提示与排障。 */
  public onTypeChange: ((type: string) => void) | undefined = undefined;

  start(): void {
    if (this.netConnection !== undefined) {
      return;
    }
    try {
      const netConnection: connection.NetConnection = connection.createNetConnection();
      this.netConnection = netConnection;
      netConnection.on('netAvailable', (handle: connection.NetHandle) => {
        this.markAvailable();
      });
      netConnection.on('netLost', (handle: connection.NetHandle) => {
        this.markLost();
      });
      netConnection.on('netCapabilitiesChange', (info: connection.NetCapabilityInfo) => {
        this.applyCapabilities(info);
      });
      netConnection.register((err: BusinessError) => {
        if (err !== undefined && err !== null) {
          logWarn('network monitor register failed: ' + JSON.stringify(err));
          return;
        }
        this.registered = true;
        logInfo('network monitor registered');
        this.refreshDefaultNet();
      });
    } catch (e) {
      logWarn('network monitor unavailable: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  stop(): void {
    const netConnection = this.netConnection;
    this.netConnection = undefined;
    if (netConnection === undefined) {
      return;
    }
    if (!this.registered) {
      return;
    }
    try {
      netConnection.unregister((err: BusinessError) => {
        if (err !== undefined && err !== null) {
          logWarn('network monitor unregister failed: ' + JSON.stringify(err));
        }
      });
    } catch (e) {
    }
    this.registered = false;
  }

  /** 一次性查当前默认网络，给 UI 一个初始值。 */
  refreshDefaultNet(): void {
    this.loadDefaultNet().catch((error: Error) => {
      logWarn('network default net unavailable: ' + error.message);
    });
  }

  private async loadDefaultNet(): Promise<void> {
    const handle: connection.NetHandle = await connection.getDefaultNet();
    if (handle === undefined || handle === null) {
      this.available = true;
      this.online = false;
      this.type = 'none';
      this.emitTypeIfChanged();
      return;
    }
    const caps: connection.NetCapabilities = await connection.getNetCapabilities(handle);
    this.available = true;
    this.type = bearerFromCapabilities(caps);
    this.online = this.type !== 'none';
    logInfo('network default net type=' + this.type);
    this.emitTypeIfChanged();
  }

  private applyCapabilities(info: connection.NetCapabilityInfo): void {
    this.available = true;
    this.type = bearerFromCapabilities(info.netCap);
    this.online = this.type !== 'none';
    logInfo('network capabilities change type=' + this.type);
    this.emitTypeIfChanged();
  }

  private markAvailable(): void {
    // 进程刚起来时的第一个 netAvailable 只是「初始化」，不是「从断网恢复」：
    // 拿它去触发立刻重连会白打一次连接（实测启动即报「网络已恢复」）。
    const first: boolean = !this.initialized;
    const wasOnline: boolean = this.online && this.initialized;
    this.initialized = true;
    this.available = true;
    this.online = true;
    if (first) {
      // 第一次先问系统要承载类型，别拿 'unknown' 去刷 UI
      this.refreshDefaultNet();
      return;
    }
    this.refreshDefaultNet();
    logInfo('net available type=' + this.type);
    this.emitTypeIfChanged();
    if (!wasOnline) {
      const cb = this.onAvailable;
      if (cb !== undefined) {
        cb();
      }
    }
  }

  private markLost(): void {
    const wasOnline: boolean = this.online && this.initialized;
    this.initialized = true;
    this.available = true;
    this.online = false;
    this.type = 'none';
    if (wasOnline) {
      logWarn('net lost');
      const cb = this.onLost;
      if (cb !== undefined) {
        cb();
      }
    }
    this.emitTypeIfChanged();
  }

  private emitTypeIfChanged(): void {
    if (this.type === this.lastType) {
      return;
    }
    this.lastType = this.type;
    const cb = this.onTypeChange;
    if (cb !== undefined) {
      cb(this.type);
    }
  }
}

/** 把能力集里的 bearerTypes 归一成一个词；多个承载时优先 Wi-Fi。 */
function bearerFromCapabilities(cap: connection.NetCapabilities): string {
  const bearers: number[] = [];
  try {
    const list = cap.bearerTypes;
    if (list !== undefined && list !== null) {
      for (const bearer of list) {
        bearers.push(bearer as number);
      }
    }
  } catch (e) {
  }
  if (bearers.indexOf(connection.NetBearType.BEARER_WIFI) >= 0) {
    return 'wifi';
  }
  if (bearers.indexOf(connection.NetBearType.BEARER_ETHERNET) >= 0) {
    return 'ethernet';
  }
  if (bearers.indexOf(connection.NetBearType.BEARER_CELLULAR) >= 0) {
    return 'cellular';
  }
  return bearers.length > 0 ? 'unknown' : 'none';
}

/** 给 UI 用的中文名。 */
export function networkTypeLabel(type: string): string {
  if (type === 'wifi') {
    return 'Wi-Fi';
  }
  if (type === 'cellular') {
    return '移动数据';
  }
  if (type === 'ethernet') {
    return '有线网络';
  }
  if (type === 'none') {
    return '无网络';
  }
  return '';
}
