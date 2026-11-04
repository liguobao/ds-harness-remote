/**
 * ArkWeb ↔ WebRTC 的最小桥。
 *
 * 原生 ARkTS 没有 WebRTC API（API 26 SDK 无该模块），所以数据面若要直连（lan/p2p/turn），
 * 只能让隐藏的 Web 组件用 JS 的 RTCPeerConnection 建 DataChannel，ArkTS 负责协议与帧搬运。
 *
 * 这一版只做「能力自检」：确认 ArkWeb 里能 new RTCPeerConnection、能建 DataChannel。
 * 真正的信令（signal.offer/answer/ice）与 Noise 改道是下一步。
 */

import { webview } from '@kit.ArkWeb';
import { logInfo, logWarn } from '../util/Log';

/** 注入到页面的回调对象，必须是被 @ts-ignore 之外的普通类实例。 */
class RtcBridgeSink {
  onLog(message: string): void {
    logInfo('[webrtc] ' + message);
  }
}

export class RtcBridge {
  readonly controller: webview.WebviewController = new webview.WebviewController();
  private sink: RtcBridgeSink = new RtcBridgeSink();
  private started: boolean = false;
  /** 自检结果，界面/日志可读。 */
  selfTestPassed: boolean = false;

  /** 给 Web 组件挂 javaScriptProxy 用。 */
  proxyObject(): Object {
    return this.sink;
  }

  /** 页面加载完成后跑一次自检。 */
  startSelfTest(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    try {
      this.controller.runJavaScript('window.__dshSelfTest && window.__dshSelfTest();');
      logInfo('[webrtc] self-test dispatched');
    } catch (error) {
      logWarn('[webrtc] self-test dispatch failed: '
        + (error instanceof Error ? error.message : String(error)));
    }
  }
}
