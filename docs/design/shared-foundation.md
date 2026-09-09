# 共享基础功能设计

状态：Draft v0.2

## 1. 目的

统一 Desktop 双角色 Plugin 与外部 Server 的身份、加密、连接和传输边界。Harness 业务层以
rc.2 官方 `ApiProxy`、v0.1.2 alpha.1–rc.1 或 v0.1.5 alpha.1 Session V3 官方 Typert Remote Gateway 为唯一事实来源；可选文件预览以 `dsh-file-viewer` provider 为唯一授权来源，
不再维护平行的 Remote Session/Event 或文件系统协议。
Android 与 VS Code Client 复用同一 capability 探测，在 rc.2 ApiProxy 和 v0.1.2 Typert Remote carrier 之间选择数据面。

## 2. 包边界

| 包 | 职责 | 不负责 |
| --- | --- | --- |
| `@dsh-remote/protocol` | Control/Relay envelope 与 ApiProxy/Typert Remote 隧道 envelope | Harness 业务模型、UI |
| `@dsh-remote/crypto` | 设备密钥、Noise IK、AEAD counter | 设备授权、传输选择 |
| `@dsh-remote/webrtc` | Relay、LAN、WebRTC/TURN transport 抽象 | ApiProxy、会话状态 |
| `@dsh-remote/client-core` | 隧道 RPC 关联和事件分发 | Harness 业务 reducer、UI |
| `@dsh-remote/plugin` | 账号设备接入、peer pinning、secure channel、ApiProxy/Typert Remote allowlist、File Viewer 只读桥和 Local/Remote switch | Server runtime、Harness 业务重建、通用文件系统访问 |

## 3. 端到端边界

```text
Harness Web UI
  -> ApiProxySwitch (rc.2) / TypertGatewaySwitch (alpha)
  -> RemoteHarnessApiProxy / RemoteTypertGateway
  -> Noise secure channel
  -> opaque Server relay
  -> Host Plugin HarnessApiBridge / HarnessRemoteBridge
  -> official Host ApiProxy / TypertGateway
```

Server 可以读取路由和连接元数据，但不能解密 Harness business payload。

## 4. 身份与账号授权

每个 Host/Client 具有独立 deviceId、显示名、平台和 X25519 identity key。私钥只保存
在设备本地。身份、device credential 和 trusted peer 按规范化 Server origin 与角色隔离。

Host 和 Client 都必须归属站点账号；Server 为同账号异角色设备自动建立 membership。
Host 可使用账号密码，或使用网页生成的 8 位、10 分钟 TTL、单次消费主机匹配码接入。
该码只授权 Host 加入账号，不是 Host/Client pairing。建立业务通道前，Client 从受
membership 保护的详情固定 Host key；Host 对 `connect.incoming.authorization=account`
再次查询 Client descriptor 后写入本地 pinned trust。Server membership 与本地 trust
必须同时成立，既有 deviceId 的 key 变化必须 fail closed。

## 5. 受控业务协议

Secure channel 中只接受：

- `harness.api.call`
- `harness.api.respond`
- `harness.api.stream.open`
- `harness.api.stream.close`
- `harness.remote.call`
- `harness.remote.stream.open`
- `harness.remote.stream.close`
- `harness.transport.describe`
- `fileviewer.call`（Host 宣告 `fileviewer.read.v1` 时，仅 stat/readRange/list）
- 对应 response/error 与 `harness.api.*`、`harness.remote.*` stream events

Session、Message、Tool、Approval、Question、Workspace 和 Goal 的结构全部沿用对应版本
的官方 ApiProxy 或 Typert Remote contract。Plugin 不复制其 schema，也不提供旧 `sessions.*`、
`session.send`、`permissions.respond` 或 `sync.from`。

`fileviewer.call` 不承载 Harness 业务对象，只把 File Viewer provider 已授权的只读内容以
不超过 512 KiB 的分块传输；禁止 openExternal、文件修改与任意 endpoint。

Client 与 Host Plugin 推荐安装同一发布物。对已经发布的 Host，新增业务 endpoint 必须
保留加法兼容：Client 先在 Noise channel 内调用 `harness.transport.describe`；旧 Host 返回
`METHOD_NOT_FOUND` 时才使用 `clientVersion` 作为 rc.2 降级。rc.2 与 alpha carrier 不一致
时在 mutation 前明确拒绝。官方 carrier 本身的破坏性 schema 变化仍需要提升协议版本，
不能只依赖 Plugin 版本字符串。

## 6. 传输与恢复

当前已实现 WebRTC offer/answer/ICE、STUN/TURN 与 Relay fallback 基础链路，选路优先级为
`LAN -> P2P -> TURN -> Relay`。上层只依赖 `RemoteTransport`。真实跨网互操作、网络切换恢复
与长期稳定性仍需验证，不能据此描述为已经稳定交付。

断线时：

1. pending tunnel RPC 失败；
2. 原生 mux/host stream 结束；
3. Desktop `ApiProxySwitch` 或 `TypertGatewaySwitch` 立即回落 Local；
4. 再次选择 Remote 时重新建 Noise channel，并由官方 UI 重新打开 stream、读取 history baseline。

Plugin 不维护第二套 seq replay buffer 或 full-resync 机制。

## 7. 安全边界

- Plugin 只建立出站连接，不监听公网端口。
- 业务 payload 只能进入完成 Noise IK 和 membership/trust 校验的 channel。
- Host 以固定 allowlist 代理 ApiProxy 或 Typert Remote endpoint；已认证 Remote peer 可通过官方 seam 管理 Host 实时注册的 settings 命名空间和全局 credential 引用，credential 值只写且 payload 有界。File Viewer 使用独立的 stat/readRange/list allowlist。禁止 `settings.openDocument`、任意目录访问、native open、attachment upload、下载和文件写入。
- 未知 method、错误 target、重放、counter gap、identity mismatch 全部 fail closed。
- token、私钥、主机匹配码、prompt、源码、工具输出和 ciphertext 不写日志。

## 8. 核心测试

- Control/Relay 编解码、版本和 frame limits。
- Noise transcript、identity binding、篡改和重放拒绝。
- 主机匹配码单次消费、同账号 membership 与 local pinned trust 双重授权。
- ApiProxy/Typert Remote allowlist、RPC 关联、stream open/close、断线清理。
- transport fallback/reconnect 状态机。
