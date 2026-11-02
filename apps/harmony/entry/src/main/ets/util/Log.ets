import { hilog } from '@kit.PerformanceAnalysisKit';

/**
 * 统一诊断日志。抓取方式：
 *   hdc shell hilog -T DSHREMOTE
 */
const DOMAIN: number = 0x0D00;
const TAG: string = 'DSHREMOTE';

export function logInfo(message: string): void {
  hilog.info(DOMAIN, TAG, '%{public}s', message);
}

export function logWarn(message: string): void {
  hilog.warn(DOMAIN, TAG, '%{public}s', message);
}

export function logError(message: string): void {
  hilog.error(DOMAIN, TAG, '%{public}s', message);
}
