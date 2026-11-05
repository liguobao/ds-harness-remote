# 鸿蒙端走 WebRTC 直连：仓库指引盘点与可行性、收益评估

> 更新（2026-11-05）：**第 6 节的「LAN-only 最小闭环」已经做完并跑通**（V0.06.1）——
> Host 侧 `mode=LAN`、`RTT 4ms`，聊天页实时收流正常。剩下的是 TURN、徽标、后台重建。
>
> 结论先行：**指引齐全、Host 与 Server 都已就绪，缺的只有鸿蒙客户端这一侧**。
> 值得做，而且现在比一周前更值得做——中继节点 `turn-mj` 满容量这件事，WebRTC 恰好绕得开。
> 工作量估计 3–5 人日（含联调），主要不确定性是 ArkWeb 在真实局域网的 UDP 可达性。

## 1. 仓库里有哪些 WebRTC 指引

| 位置 | 内容 | 对我们的用处 |
|---|---|---|
| `docs/protocol.md` §14 WebRTC Signaling | `signal.offer` / `signal.answer` / `signal.ice` 的完整 payload；DC 名 `dsh`、`ordered: true`；降级顺序 LAN→P2P→TURN→Relay；候选地址如何判 LAN/P2P（RFC1918、Tailscale `fd7a::/48`、`100.64/10` 必须记 P2P） | 客户端要发的三种帧、判定口径都在这 |
| `docs/network.md` §5–§8 | 何时回落 Relay（RTC runtime 缺失 / Server 禁用 / ICE 配置失败 / DC 超时 / 协商失败）、`forceRelay`、UDP+STUN/TURN 要求、分块与顺序规则、断线语义 | 回落条件与安全边界直接照抄 |
| `packages/webrtc/src`（2461 行） | `rtc-adapter.ts` 环境无关的 peer 接口；`rtc-data-channel.ts` 状态机（negotiation/chunking/stats）；`adaptive-transport.ts` 选路与降级；`rtc-chunking.ts` 分块格式 | 我们要写的 initiator 逻辑就是它的子集，可逐段对照 |
| Host 插件 `ds-harness-remote` dist | `webrtcEnabled` 默认 true、`hello.ack` 可关；`webrtcFallbackTimeoutMs`；收到 `signal.offer` 后建 **responder** `RtcDataChannelTransport`，并自己调 `turnCredentials(connectionId)`；内置 JS WebRTC 栈（SCTP/DTLS） | **对端已经写好了**，我们不需要动 Host |
| `docs/TODO.md` | 「WebRTC offer/answer/ICE、STUN/TURN、短期 credential 与 Relay fallback」已完成；「WebRTC P2P/TURN 路径真机验证（react-native-webrtc 与 Host werift 互操作）」已勾选 | Host 的 werift 侧与原生 WebRTC 客户端联通过，协议真机验证过 |

Android 的参考实现是 `react-native-webrtc`（原生库，`apps/android/index.ts` 只做 `registerGlobals()`）。
鸿蒙没有原生 WebRTC API，那条路走不了——只能走我们自己的 ArkWeb 内嵌页方案（`docs/webrtc-arkweb-plan.md`）。

## 2. 我们这边已经有什么

- `services/RtcBridge.ets` + `resources/rawfile/webrtc-bridge.html`：隐藏 Web 页 + `javaScriptProxy`，
  暴露 `startOffer/applyAnswer/addRemoteIce/send/closeAll`，回调 `onLocalSdp/onIce/onDataOpen/onDataBinary`。
  回环自检已通过（`sdp exchanged → dc open → 收到 hello-from-webrtc`），ArkWeb 7.0 / Chrome 144 具备完整 WebRTC。
- `net/ServerApi.ets` 已有 `GET /api/v1/turn/credentials?connection_id=…`（`AppRuntime.probeIceConfig` 在用）。
- `net/RelayTransport.ets` 已有控制通道（`sendControl`、`handleControlText`）与 `connect.accepted` 里的
  `connectionId/relayEndpoint/relayEpoch`；`SecureTransport` 的数据面只认 `send/onMessage`，换成 DC 不用改 Noise。

## 3. 还缺什么（与 `webrtc-arkweb-plan.md` 的任务 2–6 对齐）

1. `connect.accepted` 之后、attach 之前插入 RTC 分支：取 ICE 配置 → `startOffer` → 发 `signal.offer`
2. 处理 `signal.answer` / `signal.ice`（控制帧新增两个 case），本地 candidate 反过来发 `signal.ice`
3. DC open 后**先发 `transport.selected`**（协议硬约束：Host 在 `negotiating` 时会暂存握手帧），再进 Noise
4. `SecureTransport` 抽 `sendFrame(bytes)`：relay 帧 vs DC 二进制两种实现；DC 侧要做 RTCH 分块
   （magic `RTCH`、8 KiB 负载、单消息上限 4 MiB），否则大 ciphertext 会被 SCTP 慢启动卡住
5. 回落：协商超时（取 `webrtcFallbackTimeoutMs` 与本地 12 s 的较大值）/ ICE failed / DC 未开 →
   关掉 RTC、走现有 relay attach；并把「上次成功的方式」记住用于下次优先

## 4. 收益

1. **绕开中继容量**：这是当下最实在的一条。WebRTC 只需要控制 WS 能连上 Server（现在能连），
   不需要 relay 会话票；`turn-mj` 满容量时，同网段的主机仍然能直连。
   今天两台主机、两台设备全部卡在 `4008 relay capacity reached`，这条路一点都走不通。
2. **延迟**：relay 是 client → turn-mj.r2049.cn → host 的公网往返；局域网直连没有这一跳。
   仓库里记录过 LAN 直连的 `rtcSelectedPath.transport=lan, RTT 72ms`，而 relay 路径的往返取决于中继位置与拥塞。
3. **省中继带宽/配额**：视频、文件、长会话都在中继上跑，LAN 直连把这些搬回本地链路。
4. 为后续「网络切换无缝迁移」打底——虽然现在协议仍要求断了重建，但选路能力已经有了。

## 5. 风险与不确定

- **ArkWeb 的 UDP/局域网可达性只在回环里验证过**（自检是自环），真实 NAT、AP 隔离、企业网穿透都未验；
  这是最大的未知，也是必须先做最小闭环的原因。
- **后台挂起**：页面进后台 ArkWeb 可能被冻结，DC 会断；需要前台恢复时重建，且与现有重连退避配合。
- **分块与背压要自己实现**（`rtc-chunking.ts` 给了格式，但 ArkWeb `bufferedAmount` 语义要实测）。
- **TURN 仍走公网**：非同网段时收益就只剩「绕开 relay 节点」这一层，且会消耗 TURN 配额。
- **互操作**只在 Android（react-native-webrtc）与 Host（werift）之间真机验过；ArkWeb 的 Chromium 与 werift 的组合没验过。
- 维护成本：多一条数据面 + 一套回落逻辑，出问题时要能一眼看出走的是哪条路（日志/徽标要跟上）。

## 6. 建议路线（低风险版）

1. **LAN-only 最小闭环**：只吃 host candidate（不做 TURN），同网段直连；失败一律回落 relay。
   验收标准：手机与主机在同一 Wi-Fi 下，日志出现 `signal.offer sent → dc open → transport.selected(lan)`，
   且会话可用；拔掉 Wi-Fi 自动回落 relay 仍可连。
2. 再补 TURN 与 RTCH 分块、传输方式徽标、`webrtcFallbackTimeoutMs` 取服务端值。
3. 最后才碰「断线迁移」，那属于协议层改动，不是客户端单方面能定的。

前置条件：**有一台能连上的主机**（现在 relay 满容量，relay 路径本身就连不上，
但 LAN 直连不依赖它，所以第 1 步反而可以在当前状态下做）。
