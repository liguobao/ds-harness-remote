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

/** 页面回调。凡是 ArkTS 侧要处理的信令事件，都从这里进来。 */
class RtcBridgeSink {
  onLog(message: string): void {
    logInfo('[webrtc] ' + message);
  }

  onLocalSdp(description: string): void {
    logInfo('[webrtc] local sdp ready len=' + description.length);
    const handler: ((value: string) => void) | undefined = RtcBridge.active!.onLocalSdp;
    if (handler !== undefined) {
      handler(description);
    }
  }

  onIce(candidate: string): void {
    const handler: ((value: string) => void) | undefined = RtcBridge.active!.onIce;
    if (handler !== undefined) {
      handler(candidate);
    }
  }

  onState(state: string): void {
    logInfo('[webrtc] connection state=' + state);
  }

  onIceState(state: string): void {
    logInfo('[webrtc] ice state=' + state);
  }

  onDataOpen(flag: string): void {
    logInfo('[webrtc] data channel open');
    const handler: (() => void) | undefined = RtcBridge.active!.onDataOpen;
    if (handler !== undefined) {
      handler();
    }
  }

  onDataClosed(flag: string): void {
    logWarn('[webrtc] data channel closed');
    const handler: (() => void) | undefined = RtcBridge.active!.onDataClosed;
    if (handler !== undefined) {
      handler();
    }
  }

  onDataBinary(base64: string): void {
    const handler: ((value: string) => void) | undefined = RtcBridge.active!.onDataBinary;
    if (handler !== undefined) {
      handler(base64);
    }
  }

  onError(message: string): void {
    logWarn('[webrtc] error: ' + message);
    const handler: ((value: string) => void) | undefined = RtcBridge.active!.onError;
    if (handler !== undefined) {
      handler(message);
    }
  }
}

export class RtcBridge {
  /** 当前实例，供页面回调转接（Web 与 ArkTS 是 1:1，够用）。 */
  static active: RtcBridge | undefined = undefined;

  readonly controller: webview.WebviewController = new webview.WebviewController();
  private sink: RtcBridgeSink = new RtcBridgeSink();
  private started: boolean = false;
  /** 自检结果，界面/日志可读。 */
  selfTestPassed: boolean = false;
  /** 页面加载完成、window.dshRtc 可用。 */
  private pageReady: boolean = false;

  /** 信令回调：由连接层挂上去。 */
  onLocalSdp: ((description: string) => void) | undefined = undefined;
  onIce: ((candidate: string) => void) | undefined = undefined;
  onDataOpen: (() => void) | undefined = undefined;
  onDataBinary: ((base64: string) => void) | undefined = undefined;
  onDataClosed: (() => void) | undefined = undefined;
  onError: ((message: string) => void) | undefined = undefined;

  constructor() {
    RtcBridge.active = this;
  }

  /** 页面 onPageEnd 时调用：之后才允许发起协商。 */
  markReady(): void {
    this.pageReady = true;
    this.started = false;
    logInfo('[webrtc] bridge page ready');
  }

  isReady(): boolean {
    return this.pageReady;
  }

  /**
   * 作为 Initiator 开 offer（LAN-only：ICE 配置传空数组，只吃本地候选）。
   * 返回 false 表示桥还没就绪，调用方应直接走中继，别白等超时。
   */
  beginOffer(iceServersJson: string): boolean {
    if (!this.pageReady) {
      return false;
    }
    this.run('window.dshRtc && window.dshRtc.startOffer(' + JSON.stringify(iceServersJson) + ');');
    return true;
  }

  /** 兼容旧调用点：无条件开 offer。 */
  startOffer(iceServersJson: string): void {
    this.run('window.dshRtc && window.dshRtc.startOffer(' + JSON.stringify(iceServersJson) + ');');
  }

  /** 收到 Host 的 answer。 */
  applyAnswer(sdpJson: string): void {
    this.run('window.dshRtc && window.dshRtc.applyAnswer(' + JSON.stringify(sdpJson) + ');');
  }

  /** 收到远端 ICE。 */
  addRemoteIce(candidateJson: string): void {
    this.run('window.dshRtc && window.dshRtc.addRemoteIce(' + JSON.stringify(candidateJson) + ');');
  }

  /** 往 DataChannel 发一帧（base64 传输，页面里转 ArrayBuffer）。 */
  send(base64: string): void {
    this.run('window.dshRtc && window.dshRtc.send(' + JSON.stringify(base64) + ');');
  }

  closeAll(): void {
    this.run('window.dshRtc && window.dshRtc.close();');
  }

  private run(script: string): void {
    try {
      this.controller.runJavaScript(script);
    } catch (error) {
      logWarn('[webrtc] runJavaScript failed: '
        + (error instanceof Error ? error.message : String(error)));
    }
  }

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
      this.controller.runJavaScript('window.__dshSelfTest && window.__dshSelfTest();'
        + 'window.__dshNetTest && window.__dshNetTest();');
      logInfo('[webrtc] self-test dispatched');
    } catch (error) {
      logWarn('[webrtc] self-test dispatch failed: '
        + (error instanceof Error ? error.message : String(error)));
    }
  }
}
