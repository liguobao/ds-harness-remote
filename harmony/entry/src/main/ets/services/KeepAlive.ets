import { backgroundTaskManager } from '@kit.BackgroundTasksKit';
import { wantAgent, WantAgent, common } from '@kit.AbilityKit';
import { logInfo, logWarn } from '../util/Log';
import { LinkLog } from './LinkLog';

/**
 * 保活：连着主机时申请一个「长时任务（dataTransfer）」。
 *
 * 为什么需要：手机熄屏 / App 退到后台之后，系统会把进程冻结，JS 定时器和网络都没法继续跑。
 * 服务端 25 秒一跳心跳，冻结状态下回不了 pong，服务端 75 秒判死直接断开 ——
 * 这就是「放下手机再拿起来，连接老是断」的主要来源。
 *
 * 申请长时任务期间系统不会冻结本进程，心跳与直连 DataChannel 都能活着。
 * 只在「已连上主机」期间持有，断开后立刻释放（长时任务会显示在通知栏，别滥用）。
 *
 * 失败不影响主流程：没有权限 / 系统拒绝就退化成不保活，只记日志。
 */
export class KeepAlive {
  private static running: boolean = false;
  private static context: common.UIAbilityContext | undefined = undefined;
  private static pending: boolean = false;

  /** EntryAbility 启动时绑定一次 UIAbilityContext。 */
  static bind(context: common.UIAbilityContext): void {
    KeepAlive.context = context;
  }

  static isRunning(): boolean {
    return KeepAlive.running;
  }

  /** 开始保活（幂等）。 */
  static async start(): Promise<void> {
    if (KeepAlive.running || KeepAlive.pending) {
      return;
    }
    const context: common.UIAbilityContext | undefined = KeepAlive.context;
    if (context === undefined) {
      logWarn('keepalive: 还没有 UIAbilityContext，跳过');
      return;
    }
    KeepAlive.pending = true;
    try {
      const info: wantAgent.WantAgentInfo = {
        wants: [{
          bundleName: context.abilityInfo.bundleName,
          abilityName: context.abilityInfo.name
        }],
        actionType: wantAgent.OperationType.START_ABILITY,
        requestCode: 20261108,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      };
      const agent: WantAgent = await wantAgent.getWantAgent(info);
      await backgroundTaskManager.startBackgroundRunning(context,
        backgroundTaskManager.BackgroundMode.DATA_TRANSFER, agent);
      KeepAlive.running = true;
      logInfo('keepalive: 长时任务已启动（dataTransfer）');
      LinkLog.write('life', '保活开始（长时任务 dataTransfer）：熄屏/后台不再冻结');
    } catch (error) {
      const text: string = error instanceof Error ? error.message : String(error);
      logWarn('keepalive start failed: ' + text);
      LinkLog.write('life', '保活申请失败：' + text + '（连接仍可用，但后台可能被冻结）');
    } finally {
      KeepAlive.pending = false;
    }
  }

  /** 结束保活（幂等）。 */
  static async stop(): Promise<void> {
    if (!KeepAlive.running) {
      return;
    }
    const context: common.UIAbilityContext | undefined = KeepAlive.context;
    KeepAlive.running = false;
    LinkLog.write('life', '保活结束');
    if (context === undefined) {
      return;
    }
    try {
      await backgroundTaskManager.stopBackgroundRunning(context);
      logInfo('keepalive: 长时任务已停止');
    } catch (error) {
      const text: string = error instanceof Error ? error.message : String(error);
      logWarn('keepalive stop failed: ' + text);
    }
  }
}
