import { logInfo } from './Log';

/**
 * 链路打点与抖动计数。
 *
 * 为什么要它：TURN 模式下用户报的是「抖一下就卡住」，但症状背后可能是三种完全不同的原因
 * （授权窗口重发、follow 流打开慢、链路判死后重连）。只靠人眼读日志分不清，
 * 所以这里把两件事量化：
 *
 * 1. **打点**：每次 RPC 记「发出多久 / 重发几次 / 等回多久」，每次 follow 流记
 *    「打开 RPC 多久 + 首帧快照多久」。诊断面板直接显示最近一次，
 *    hilog 里慢请求（≥200ms）或发生过重发的才落日志，避免刷屏。
 * 2. **计数**：抖动发生过几次、其中几次被自动恢复。复现时看这一行就知道
 *    「抖了 5 次、自己好了 4 次」还是「抖了 1 次就再没起来」。
 *
 * 抓取：`hdc shell hilog -x | grep DSHREMOTE | grep trace`
 */
export class TraceSample {
  /** 'session/list' / 'session/follow 首帧' / 'session/prompt' … */
  label: string = '';
  totalMs: number = 0;
  /** '发出 12ms · 重发 0 · 等回 808ms' 这类分段说明。 */
  detail: string = '';
  at: number = 0;
}

/** 抖动与自愈的累计计数（进程生命周期内累加，不随重连清零）。 */
export class JitterCounters {
  /** 发送撞上「relay connection has not been authorized」，同一帧重发的次数。 */
  authRetries: number = 0;
  /** 会话列表因传输类失败，3 秒后自动重拉的次数。 */
  listAutoRetries: number = 0;
  /** 其中自动重拉成功的次数。 */
  listAutoRecovered: number = 0;
  /** 「重新打开会话 / 重连并重新打开」被调用的次数。 */
  streamReopens: number = 0;
  /** 断线后自动重连被触发的次数。 */
  autoReconnects: number = 0;
  /** 系统网络断开/恢复的次数（一次断开算一次）。 */
  netFlaps: number = 0;
  /** 链路被判死（含看门狗判静默）的次数。 */
  linkDeaths: number = 0;
}

const MAX_SAMPLES: number = 24;
/** 超过这个耗时就一定落 hilog（不占日志的常态快请求只留在面板里）。 */
const SLOW_MS: number = 200;

export class NetTrace {
  private static samples: TraceSample[] = [];
  private static counters: JitterCounters = new JitterCounters();

  /**
   * 记一条打点。alwaysLog=true 时无论快慢都进 hilog。
   * label 用 endpoint 名（'session/list'），不要拼 sessionId 之类敏感内容。
   */
  static record(label: string, totalMs: number, detail: string = '', alwaysLog: boolean = false): void {
    const sample: TraceSample = new TraceSample();
    sample.label = label;
    sample.totalMs = totalMs;
    sample.detail = detail;
    sample.at = Date.now();
    const next: TraceSample[] = NetTrace.samples.slice();
    next.push(sample);
    while (next.length > MAX_SAMPLES) {
      next.shift();
    }
    NetTrace.samples = next;
    if (alwaysLog || totalMs >= SLOW_MS) {
      logInfo('trace ' + label + ' ' + totalMs + 'ms' + (detail.length > 0 ? ' (' + detail + ')' : ''));
    }
  }

  /** 最近一条同 label 打点（诊断面板与徽标用）。 */
  static latest(label: string): TraceSample | undefined {
    for (let i = NetTrace.samples.length - 1; i >= 0; i--) {
      const sample: TraceSample = NetTrace.samples[i];
      if (sample.label === label) {
        return sample;
      }
    }
    return undefined;
  }

  /** '820ms' / '1.2s' / ''（没有样本）。 */
  static latestText(label: string): string {
    const sample: TraceSample | undefined = NetTrace.latest(label);
    return sample !== undefined ? NetTrace.msText(sample.totalMs) : '';
  }

  static msText(ms: number): string {
    if (ms < 0) {
      return '—';
    }
    if (ms < 1000) {
      return Math.round(ms) + 'ms';
    }
    return (Math.round(ms / 100) / 10) + 's';
  }

  static stats(): JitterCounters {
    return NetTrace.counters;
  }

  static authRetry(): void {
    NetTrace.counters.authRetries += 1;
  }

  static listAutoRetry(): void {
    NetTrace.counters.listAutoRetries += 1;
  }

  static listAutoRecovered(): void {
    NetTrace.counters.listAutoRecovered += 1;
  }

  static streamReopen(): void {
    NetTrace.counters.streamReopens += 1;
  }

  static autoReconnect(): void {
    NetTrace.counters.autoReconnects += 1;
  }

  static netFlap(): void {
    NetTrace.counters.netFlaps += 1;
  }

  static linkDeath(): void {
    NetTrace.counters.linkDeaths += 1;
  }

  /** 诊断面板的一行：「抖动自愈：…」；一次没抖过就明确说没抖过。 */
  static jitterLine(): string {
    const c: JitterCounters = NetTrace.counters;
    const total: number = c.authRetries + c.listAutoRetries + c.streamReopens
      + c.autoReconnects + c.netFlaps + c.linkDeaths;
    if (total === 0) {
      return '抖动自愈：本次运行没抖过';
    }
    const parts: string[] = [];
    if (c.authRetries > 0) {
      parts.push('授权重发 ' + c.authRetries);
    }
    if (c.listAutoRetries > 0) {
      parts.push('列表自动重拉 ' + c.listAutoRetries + '（成功 ' + c.listAutoRecovered + '）');
    }
    if (c.streamReopens > 0) {
      parts.push('流重开 ' + c.streamReopens);
    }
    if (c.autoReconnects > 0) {
      parts.push('自动重连 ' + c.autoReconnects);
    }
    if (c.netFlaps > 0) {
      parts.push('网络断开 ' + c.netFlaps);
    }
    if (c.linkDeaths > 0) {
      parts.push('链路判死 ' + c.linkDeaths);
    }
    return '抖动自愈：' + parts.join(' · ');
  }

  /** 打点行：'会话列表 820ms · 流打开 1.2s + 首帧 0.3s'，全空时返回 ''。 */
  static summaryLine(): string {
    const list: string = NetTrace.latestText('session/list');
    const open: string = NetTrace.latestText('session/follow');
    const first: string = NetTrace.latestText('session/follow 首帧');
    const parts: string[] = [];
    if (list.length > 0) {
      parts.push('列表 ' + list);
    }
    if (open.length > 0) {
      parts.push('流打开 ' + open);
    }
    if (first.length > 0) {
      parts.push('首帧 ' + first);
    }
    return parts.length > 0 ? '打点：' + parts.join(' · ') : '';
  }

  /** 最近样本里最慢的一条：'最慢：workspace/follow 6.4s'；没样本返回 ''。 */
  static slowestLine(): string {
    let slowest: TraceSample | undefined = undefined;
    for (const sample of NetTrace.samples) {
      if (slowest === undefined || sample.totalMs > slowest.totalMs) {
        slowest = sample;
      }
    }
    if (slowest === undefined) {
      return '';
    }
    return '最慢：' + slowest.label + ' ' + NetTrace.msText(slowest.totalMs);
  }

  /** 清空样本与计数（换服务器/退出登录时用，避免把上一台的数字算进来）。 */
  static reset(): void {
    NetTrace.samples = [];
    NetTrace.counters = new JitterCounters();
  }
}
