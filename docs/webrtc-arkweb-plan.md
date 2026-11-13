# 鸿蒙客户端直连（ArkWeb + WebRTC）实施方案

> 结论先行：原生 ArkTS 没有 WebRTC API（API 26 的 `ohos-sdk-ets` 里 `kits/` 与 `api/` 都没有
> RTC/WebRTC 模块），所以鸿蒙端要拿到 `lan/p2p/turn` 直连，唯一可行路径是**在 App 内嵌一个
> 隐藏的 ArkWeb 页面，用 JS 的 `RTCPeerConnection` 建 DataChannel**，ArkTS 只做协议与帧搬运。

## 1. 现状（为什么只能走中继）

实测日志（手机 v0.03.2）：

```
server negotiated capabilities: transport.lan,transport.p2p,transport.turn,
                                transport.relay,transport.relay.attach
connect.accepted hints=[] relay=wss://us2-east-turn.r2049.cn/ws
relay.ready epoch=… host=us2-east-turn.r2049.cn
```

- 能力声明已按原项目补齐（`capabilities` 含 lan/p2p/turn/relay），服务端也全部回执
- 但 `connect.accepted` **没有下发任何 ICE/WebRTC 素材**（`hints=[]`），且客户端本身不具备
  WebRTC，所以只能落到 relay

对照：同一时段主机日志里 `"mode":"LAN"` 出现过 9 次、`"mode":"Relay"` 35 次——说明**具备
WebRTC 的客户端确实能走 LAN 直连**（`rtcSelectedPath.transport=lan`，RTT 72ms）。

## 2. 协议时序（来自 `docs/protocol.md` §10/§11 与 `packages/webrtc/src/adaptive-transport.ts`）

```
Client                                    Server                        Host
  │ hello(role=client, capabilities=[…lan,p2p,turn,relay,relay.attach])
  │──────────────────────────────────────►│
  │◄──────────── hello.ack(webrtcEnabled, webrtcFallbackTimeoutMs, capabilities) │
  │ connect.request{hostDeviceId, preferredTransports:[lan,p2p,turn,relay]}
  │──────────────────────────────────────►│──connect.incoming──────────►│
  │◄──────────── connect.accepted{connectionId, relayEndpoint/ticket/epoch}│
  │
  │ （ICE 配置：REST `GET /api/v1/turn/credentials`，需要 active connection；
  │   旧实现也可从 connect.accepted 的 iceServers 字段拿，但本服务目前 hints 为空）
  │
  │ signal.offer{connectionId, targetDeviceId, sdp}      ← Initiator = Client
  │──────────────────────────────────────►│────────────────────────────►│
  │◄──────────────────────────────────────│◄─ signal.answer{…, sdp} ────│
  │ signal.ice{connectionId, targetDeviceId, candidate:{candidate,sdpMid,sdpMLineIndex,usernameFragment}}
  │◄──────────────────────────────────────►│◄───────────────────────────►│
  │
  │ DataChannel open
  │ transport.selected{connectionId, targetDeviceId, transport:'lan'|'p2p'|'turn'}
  │──────────────────────────────────────►│────────────────────────────►│
  │ Noise IK 仍走 control 的 secure.handshake；密文帧改走 DataChannel（原始 binary，不 base64）
```

**硬约束（照抄协议，必须遵守）**

1. `transport.selected` 必须在 Noise 握手**之前**发出；Host 在 transport 为 `negotiating` 时必须
   暂存握手帧，不能自行猜测为 relay
2. Noise channel 一旦建立，迟到/冲突的 `transport.selected` **不得**切换数据面
3. 失败必须按 `hello.ack.capabilities` 回退到 relay（现在这条路已经能用）
4. `signal.*` 只能发在 Control WebSocket 上；ticket 不能发到 control，也不能跨 connection 复用
5. 超时按阶段独立计算：`webrtcFallbackTimeoutMs` 缺失时用本地值（参考实现取 12s），取服务端与
   本地较大值

## 3. ArkWeb 桥设计

```
┌──────────────── ArkTS（现有 RelayTransport 改造） ────────────────┐
│  RtcBridge                                                    │
│   · offer()/setAnswer()/addIce()/send(bytes)/onBytes(cb)      │
│   · 状态：idle | negotiating | open | failed                  │
└───────────▲──────────────────────────────┬───────────────────┘
            │ javaScriptProxy(回调)         │ runJavaScript(命令)
┌───────────┴──────────────────────────────▼───────────────────┐
│  隐藏 Web 组件（宽高 0×0，不可见、不拦截手势）                  │
│  rawfile/webrtc-bridge.html + webrtc-bridge.js                │
│   · new RTCPeerConnection({iceServers})                       │
│   · createDataChannel('dsh', {ordered:true})                  │
│   · onicecandidate → 回调 ArkTS → 发 signal.ice                │
│   · datachannel.onmessage → 回调 ArkTS（ArrayBuffer）          │
└──────────────────────────────────────────────────────────────┘
```

要点：

- **隐藏方式**：`Web({src:$rawfile('webrtc-bridge.html'), controller})` 放在页面根部，
  `.width(0).height(0).visibility(Visibility.Hidden)`，不要用 `display:none` 之外的花招；
  页面本身 `opacity:0` 亦可
- **双向通信**：
  - ArkTS → JS：`controller.runJavaScript('window.bridge.applyIceServers(...)')`
  - JS → ArkTS：`javaScriptProxy({ object: this.bridge, name: 'dshHost', methodList: [...],
    controller })`，回调里立刻把事件塞进 ArkTS 队列
- **二进制**：DC 上用 `arraybuffer`，Noise transport frame 直接发 `Uint8Array.buffer`；**不要**
  再走 base64（协议里明确 DataChannel 可发 binary）
- **顺序保证**：DC 必须 `ordered: true`（协议里 relay counter 语义要求顺序）

## 4. 实施任务清单（按提交粒度）

| # | 任务 | 验收 |
|---|---|---|
| 1 | `RtcBridge.ets` 骨架 + 隐藏 Web 组件 + rawfile 里的 JS 桥（只做 ping/pong 打通） | 点按钮能拿到 JS 回调 |
| 2 | `RelayTransport` 增加 `webrtc` 分支：`connect.accepted` 后若 `capabilities` 含 p2p/turn 且未 `forceRelay`，先走 WebRTC | 日志出现 `signal.offer sent` |
| 3 | 接 `signal.answer` / `signal.ice`，DC 打开后发 `transport.selected` | 主机日志出现 `webrtc data channel ready` |
| 4 | Noise 握手密文改走 DC（`SecureTransport` 抽一层 `sendFrame(bytes)` 接口，relay/DC 两种实现） | 主机日志 `authenticated peer channel ready {"transport":"LAN"}` |
| 5 | 失败回退：超时 / ICE failed / DC 未开 → 关 RTC、走现有 relay 路径 | 拔网线场景仍能连 |
| 6 | 记录上次成功传输方式，UI 上显示 `LAN/P2P/TURN/Relay` 徽标 | 设备页/会话页可见 |

## 5. 风险与投入

- **工作量**：任务 1–3 约 1–2 天；任务 4（Noise 抽接口）1 天；任务 5–6 半天。合计 3–4 天
- **主要风险**：
  1. **ArkWeb 默认不允许 `RTCPeerConnection` 访问局域网？** 需实测；HarmonyOS Web 组件走系统
     网络栈，理论上与浏览器一致，但 NAT 行为可能不同
  2. **服务端不给 ICE 素材**：现在 `hints=[]`，必须走 `GET /api/v1/turn/credentials`；该接口要求
     active connection，时序上要在 `connect.accepted` 之后、`signal.offer` 之前请求
  3. **隐藏 Web 组件的生命周期**：页面切后台时 Web 可能被挂起，需在前台恢复时重建 RTC
  4. **二进制帧上限**：DC 单帧建议 < 256 KB，超过要分片（对应协议 `maxRelayFrameBytes`）

## 5a. 可行性已实测（2026-11-04 13:44，本机 MatePad Edge）

隐藏 Web 组件 + JS 自检跑通，ArkWeb 具备完整 WebRTC 能力：

```
[webrtc] bridge loaded
[webrtc] env {"hasRtcPeer":true,"hasWebkitRtc":true,"hasDc":true,
              "ua":"… OpenHarmony 7.0 … Chrome/144.0.0.0 … ArkWeb/7.0.0.111"}
[webrtc] selftest: sdp exchanged      ← offer/answer 都成功
[webrtc] selftest: dc open            ← DataChannel 打开
[webrtc] selftest: got "hello-from-webrtc"   ← 数据通道回环收到数据
```

也就是说**任务 1 已完成**：`RtcBridge.ets` + `resources/rawfile/webrtc-bridge.html` 已落地，
`javaScriptProxy` 回调链路可用（`window.dshBridge.onLog` → hilog）。

网络可达性（同一页面的 `fetch` 探测）：

```
nettest ok   https://dsh.r2049.cn/health     ← HTTPS 出公网正常
nettest fail http://127.0.0.1:3080/          ← 明文 HTTP 被 ArkWeb 拦（Failed to fetch）
```

结论：**ICE 配置必须走 HTTPS**（`GET /api/v1/turn/credentials` 本来就是 HTTPS，没问题）；
如果以后要直连 Host 的明文端口，需要在 `module.json5` 或 Web 组件上放行 cleartext。

下一步（任务 2/3）：把自检换成真实协商——ICE 配置从 `GET /api/v1/turn/credentials` 取，
`signal.offer/answer/ice` 走 Control WS，DC 打开后先发 `transport.selected` 再跑 Noise。

## 6. 本轮（2026-11-04 13:4x）做到哪一步

只完成了**方案与协议核对**，未改代码：时间窗口只到 14:00，且该改动会动到 `SecureTransport`
的帧收发路径，属于高风险重构，不适合在无人看护的短窗口里落代码。

下一轮从这里继续：先做任务 1（隐藏 Web + JS 桥 ping/pong），验证 ArkWeb 能不能建 DC、能否访问
局域网对端，再决定是否继续投任务 2–4。
