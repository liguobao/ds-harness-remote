import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { logInfo, logWarn } from '../util/Log';

/**
 * 链路日志（**落盘**，跨进程重启保留）。
 *
 * 为什么单独搞一份：hilog 只在连着电脑、且进程还活着的时候能抓；
 * 而「飞行模式之后连不回来」这类问题的现场通常已经重启过 App、
 * 甚至手机不在身边。所以链路相关的每一件决策都写进应用沙箱里的 link.log：
 *
 *   data/app/el2/100/base/<bundle>/haps/entry/files/link.log
 *
 * 抓取：`hdc -t <serial> file recv <上面那个路径> ./link.log`
 * 也可以在「连接诊断」面板里看最近 12 行、或点「复制」带出最近 40 行。
 *
 * 设计取舍：
 * - 同步追加写：链路事件一秒钟最多几条，同步写省掉队列和丢失问题；
 * - 256KB 轮转一份（link.log → link.log.1），手机上不会无限长大；
 * - 同时镜像一行到 hilog（前缀 `LINK`），保留原来的抓日志习惯。
 */
const FILE_NAME: string = 'link.log';
const MAX_BYTES: number = 256 * 1024;
const MEMORY_LINES: number = 240;

export class LinkLog {
  private static dir: string = '';
  private static filePath: string = '';
  private static lines: string[] = [];
  private static writeFailed: boolean = false;

  /** 应用启动时调用一次（需要 context.filesDir）。 */
  static init(context: common.Context): void {
    try {
      LinkLog.dir = context.filesDir;
      LinkLog.filePath = LinkLog.dir + '/' + FILE_NAME;
      logInfo('link log -> ' + LinkLog.filePath);
    } catch (error) {
      logWarn('link log init failed: ' + (error instanceof Error ? error.message : String(error)));
      return;
    }
    LinkLog.write('boot', '链路日志开始（App 启动）');
  }

  static pathText(): string {
    return LinkLog.filePath;
  }

  /** 写一行：`18:02:31.123 [net] 网络已断开`。 */
  static write(tag: string, text: string): void {
    const line: string = LinkLog.stamp() + ' [' + tag + '] ' + text;
    const next: string[] = LinkLog.lines.slice();
    next.push(line);
    while (next.length > MEMORY_LINES) {
      next.shift();
    }
    LinkLog.lines = next;
    // hilog 镜像：老习惯（hilog -x | grep LINK）继续可用
    logInfo('LINK ' + line);
    if (LinkLog.filePath.length === 0) {
      return;
    }
    try {
      LinkLog.rotateIfNeeded(line.length + 2);
      const file = fileIo.openSync(LinkLog.filePath,
        fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.APPEND);
      try {
        fileIo.writeSync(file.fd, line + '\n');
      } finally {
        fileIo.closeSync(file);
      }
      LinkLog.writeFailed = false;
    } catch (error) {
      if (!LinkLog.writeFailed) {
        LinkLog.writeFailed = true;
        logWarn('link log write failed: ' + (error instanceof Error ? error.message : String(error)));
      }
    }
  }

  /** 内存里的最近若干行（诊断面板用）。 */
  static tail(count: number): string[] {
    if (count <= 0 || LinkLog.lines.length === 0) {
      return [];
    }
    const from: number = Math.max(0, LinkLog.lines.length - count);
    return LinkLog.lines.slice(from);
  }

  /** 导出用全文（内存镜像，够诊断一屏）。 */
  static exportText(): string {
    return LinkLog.lines.join('\n');
  }

  static clear(): void {
    LinkLog.lines = [];
  }

  private static rotateIfNeeded(incoming: number): void {
    let size: number = 0;
    try {
      const stat = fileIo.statSync(LinkLog.filePath);
      size = stat.size;
    } catch (error) {
      // 还不存在：第一次写
      return;
    }
    if (size + incoming < MAX_BYTES) {
      return;
    }
    const older: string = LinkLog.filePath + '.1';
    try {
      fileIo.unlinkSync(older);
    } catch (error) {
      // 没有旧文件，忽略
    }
    try {
      fileIo.renameSync(LinkLog.filePath, older);
    } catch (error) {
      logWarn('link log rotate failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private static stamp(): string {
    const now: Date = new Date();
    const pad2 = (value: number): string => (value < 10 ? '0' + value : '' + value);
    const pad3 = (value: number): string => (value < 10 ? '00' + value : (value < 100 ? '0' + value : '' + value));
    return pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds())
      + '.' + pad3(now.getMilliseconds());
  }
}
