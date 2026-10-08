# 网络与传输

本文解释 DSH Remote 的网络拓扑、连接建立、LAN/P2P/TURN/Relay 选路与降级行为。线协议字段和状态机的规范性定义仍以 [Remote Protocol v1](protocol.md) 为准。

## 结论

Host 不监听公网端口，也不要求路由器端口转发。Host 与 Client 都主动连接 Remote Server；数据面优先尝试 WebRTC 直连，不能建立直连时自动使用 TURN 或 WebSocket Relay。

默认路径优先级是：

```text
LAN -> P2P -> TURN -> Relay
```

无论选择哪条路径，Harness 业务消息都先经过 Noise 端到端加密。网络层只搬运密文，不改变身份验证和业务权限边界。详细安全说明见[端到端加密](end-to-end-encryption.md)。

## 1. 网络拓扑

```text
                         HTTPS / WSS
                +----------------------------+
                |                            v
+---------+     |     +----------------------------------+
| Client  |-----+---->| Remote Server                    |
|         |           | account / presence / signaling  |
|         |<--------->| opaque WebSocket Relay           |
+----+----+           +------------------+---------------+
     |                                   ^
     | WebRTC DataChannel                | HTTPS / WSS
     | LAN / P2P / TURN                  |
     +------------------------------+----+
                                    |
                               +----+----+
                               |  Host   |
                               | Plugin  |
                               +---------+
```

Remote Server 负责账号授权、设备在线状态、连接协调、WebRTC signaling、短期 TURN credential 下发和 Relay 路由。本仓库只实现 Plugin、Client 与共享协议；Server runtime 位于独立仓库。

## 2. 三个网络平面

DSH Remote 把网络通信分为三个职责不同的平面。

### 2.1 REST 平面

Client 与 Host 通过 HTTPS 完成：

- 账号登录和设备注册；
- access/refresh token 轮换；
- Host 列表、设备详情与 presence 查询；
- 受 membership 保护的 identity key 查询；
- 按 `connectionId` 获取短期 ICE/TURN 配置。

生产 Server 必须使用 HTTPS；只有 localhost 开发环境允许 HTTP。Token 放在认证 header 或请求体中，不能进入 URL、日志或 WebRTC signaling。

### 2.2 Control 平面

Host 和 Client 各自建立一条出站 WebSocket：

```text
wss://<server>/ws/v1/connect
```

Control channel 使用可读 JSON frame 承载：

- `hello`、协议版本与 capability 协商；
- `connect.request` / `connect.incoming` / `connect.accepted`；
- WebRTC offer、answer 与 ICE candidate；
- `transport.selected`；
- opaque Noise handshake bytes；
- Relay 模式下的 Noise ciphertext；
- ping/pong 与连接级错误。

Control frame 不得包含 Harness 业务明文。Server 需要读取路由信息，但只能把 Noise handshake 与 transport ciphertext 当作不透明字节转发。

### 2.3 数据平面

连接建立时，双方通过 capability 与偏好选择数据路径：

- WebRTC 成功时，Noise ciphertext 直接作为 ordered DataChannel binary message 发送；
- WebRTC 不可用或失败时，Noise ciphertext 经 Control WebSocket 的 `relay` frame 转发。

上层只依赖统一的 `RemoteTransport`，不会因为路径不同而改写 Harness RPC 或降低加密级别。

## 3. 连接建立与选路

一次连接按以下顺序建立：

1. Host 与 Client 向 Server 建立经过 device credential 认证的出站 WSS。
2. 双方在 `hello` / `hello.ack` 中协商协议版本、frame limits 与 `transport.*` capability。
3. Client 请求目标 Host，Server 校验同账号 membership、设备状态和 Host presence。
4. Server 创建 `connectionId`，通知 Host，并保持该连接的 signaling 与 handshake 转发顺序。
5. 如果双方和当前运行环境支持 WebRTC，Client 发起 offer/answer/ICE 协商；否则直接选择 Relay。
6. Initiator 确认 DataChannel 可用后发送 `transport.selected`。Host 在同一 connection 上确认一致的路径。
7. 双方通过 Control channel 交换 Noise IK handshake；完成后才开始业务通信。

`transport.selected` 与 Noise handshake 的顺序是安全状态的一部分。Host 不会仅根据本地异步 RTC 回调猜测路径；乱序到达时会暂存握手，待数据面选择明确后继续。安全通道建立后，迟到或冲突的选路消息不能改写现有连接。

## 4. 四种连接模式

| 模式 | 承载 | 典型场景 | Server 是否转发业务密文 |
| --- | --- | --- | --- |
| `LAN` | WebRTC DataChannel | 两端位于可直达的本地网络 | 否 |
| `P2P` | WebRTC DataChannel | 公网、NAT 穿透或 overlay 网络直连 | 否 |
| `TURN` | WebRTC DataChannel 经 TURN relay | 无法直接打洞，但允许 TURN | TURN 转发 Noise ciphertext |
| `Relay` | WSS Control channel 的 `relay` frame | WebRTC 不可用、协商失败或网络受限 | Remote Server 转发 Noise ciphertext |

### LAN

LAN 不是另一套业务协议，而是 WebRTC 最终选中的 candidate pair 被识别为物理本地路径。RFC 1918、链路本地、回环地址和 mDNS/prflx 组合会参与判断。Tailscale 等 overlay/CGNAT 地址即使表现为 host candidate，也按 P2P 记录，避免把虚拟广域网络误标为物理 LAN。

### P2P

P2P 使用 ICE/STUN 尝试让 Client 与 Host 直接交换 DataChannel 流量。它通常延迟更低，也减少 Server 带宽，但能否成功取决于 NAT 类型、防火墙、IPv4/IPv6、企业网络策略和运行时 WebRTC 支持。

### TURN

当直接 candidate pair 无法连通时，WebRTC 可以使用 Server 下发的短期 TURN credential。TURN 只转发 WebRTC 数据包；其上仍有 DataChannel 的 DTLS 和 DSH Remote 的 Noise E2EE。TURN 服务无法读取 Harness 业务明文。

### Relay

Relay 通过已建立的 WSS 转发 Base64URL 编码的 Noise ciphertext。它不要求 UDP 或端到端可达性，通常对企业代理和严格 NAT 更稳健，但延迟与 Server 带宽开销可能高于直连。Server 禁止解密、解析、持久化或记录 Relay ciphertext。

## 5. 自适应尝试与降级

默认 Client 会按能力和运行环境尝试：

1. LAN/P2P direct path；
2. TURN path；
3. WebSocket Relay。

无法加载 WebRTC runtime、Server 禁用 WebRTC、ICE/TURN 配置获取失败、DataChannel 超时或协商失败时，连接建立流程会清理临时 RTC 状态并回落 Relay。用户选择 Relay-only，或 Host 配置 `forceRelay` 时，双方不尝试 WebRTC。

这套自动降级主要覆盖**连接建立阶段**。已建立连接在 Wi-Fi/移动网络切换、休眠唤醒或 DataChannel 关闭后的无缝迁移仍在完善；当前安全行为是关闭受影响的 Remote connection，再新建 transport 与 Noise channel，而不是在结果未知时把同一个 mutation 静默重发到另一条路径。

## 6. 防火墙、NAT 与代理

### 最低网络要求

如果设备能通过 HTTPS/WSS 访问 Remote Server，Relay 路径即可工作；Host 无需接受任何公网入站连接，也不需要在路由器上配置端口转发。

### 获得更好的直连概率

允许 WebRTC/ICE 使用 UDP，并允许访问 Server 返回的 STUN/TURN 地址，可以提高 LAN、P2P 或 TURN 成功率。具体端口由部署侧 ICE 配置决定，本仓库不写死公网 TURN 地址或端口。

### 严格企业网络

只允许 HTTP 代理、TLS inspection 或限制 UDP 的网络可能使 WebRTC 失败。此时客户端应降级到 WSS Relay；代理、证书和系统休眠/唤醒行为仍需要按各平台做真实环境验证。

## 7. 帧、顺序与大消息

- WebRTC DataChannel 名称为 `dsh`，使用 `ordered: true`。
- Relay frame 携带 `connectionId`、目标设备、递增诊断 counter 与 Noise ciphertext。
- Noise transport 单消息上限为 65,535 bytes；超过 48 KiB 的业务消息先在 secure channel 层分片，完整消息上限为 4 MiB。
- WebRTC 层还会对较大的 Noise ciphertext 做透明 chunking，以适配不同 DataChannel 实现的发送限制；重组发生在 Noise 之下，不改变加密语义。
- 图片 Prompt、attachment response 与 File Viewer range read 还有各自的有界业务分块和并发限制。

任何未知 connection、错误 target、非法顺序、重复分片或超限消息都必须 fail closed，不能因为网络重试而放宽身份或消息校验。

## 8. 断线与恢复

Host 的 Control WebSocket 支持带 jitter 的指数退避重连。单条逻辑 connection 断开时，Host 只清理对应的 Noise/RTC、pending RPC 与 stream，不影响其他已连接 Client。

业务连接断开后：

1. 未完成 tunnel RPC 失败；
2. 原生 mux/host 或 Typert Remote stream 关闭；
3. Desktop Remote 退出活动数据面并回落 Local；
4. 再次连接时重新完成 membership/trust 校验、选路和 Noise 握手；
5. 由官方 Harness UI 重开 stream 并重新读取 history baseline。

当前项目不维护另一套业务 event replay buffer，也不会自动重放结果未知的 Harness mutation。完整的网络切换 UI、心跳/RTT、重连后的 stream 自动重开仍是待完成工作。

## 9. 网络可观察性与隐私

Client 可以把当前模式显示为 `LAN`、`P2P`、`TURN`、`Relay` 或 `Disconnected`，并统计连接期间发送/接收的密文字节。WebRTC 诊断可包含 ICE、candidate pair 与 fallback 原因，用于定位网络问题。

这些诊断不得包含 token、私钥、Noise secret、Prompt、源码、工具输出或解密后的业务 payload。IP、candidate、连接时间和字节数本身仍属于敏感网络元数据，导出或上传日志前应脱敏。

## 10. 当前实现状态

已实现的基础能力：

- Protocol v1 Control/Relay 与 capability 协商；
- WebRTC offer/answer/ICE、STUN/TURN 短期 credential 接入；
- LAN/P2P/TURN 路径识别、DataChannel chunking 与 Relay fallback；
- Desktop Plugin、Android 和 VS Code Client 的 Adaptive transport 接入；
- 所有路径上的 Noise E2EE 与按 connection 隔离。

仍需完成或扩大验证：

- rc.2/alpha.1/alpha.2 真实 Harness 双机与跨网 E2E；
- Android `react-native-webrtc` 与 Host WebRTC runtime 的真机 P2P/TURN 互操作；
- 网络切换、休眠/唤醒、长期稳定性和代理环境；
- control heartbeat、RTT、错误分类和重连后的 stream/history 恢复；
- 与独立 Server 仓库共享 conformance fixtures。

因此，代码已经具备自适应网络基础链路，但不能把尚未完成的真实跨网与长期稳定性验证描述为稳定交付能力。

## 11. 实现与规范入口

- 统一传输接口：`packages/webrtc/src/transport.ts`
- Client 自适应选路：`packages/webrtc/src/adaptive-transport.ts`
- WebRTC DataChannel：`packages/webrtc/src/rtc-data-channel.ts`
- Host signaling 与连接管理：`packages/plugin/src/server-connection.ts`
- Client 连接编排：`packages/plugin/src/client-runtime.ts`
- 规范性协议：[Remote Protocol v1 §10–14](protocol.md#10-control-channel)
- 尚未完成的验证：[TODO](TODO.md)
