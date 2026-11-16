# 端到端加密

本文解释 DSH Remote 如何在 Client 与 Host 之间建立端到端加密通道、Server 能看到什么，以及这层保护的边界。线协议的规范性定义仍以 [Remote Protocol v1](protocol.md) 为准。

## 结论

DSH Remote 的 Harness 业务消息始终在 Client 上加密、在 Host 上解密。中间的 Remote Server、WebSocket Relay 和 TURN 只参与账号授权、连接协调或密文转发，不能读取 Harness 会话、Prompt、工具输出、Workspace 路径和文件预览内容。

加密不依赖当前网络路径。无论连接最终使用 LAN、互联网 P2P、TURN 还是 WebSocket Relay，业务层都使用 Noise 认证与加密；可选 LAN 上传为独立 Noise 会话，并绑定原连接的身份与上传 scope。

```text
Client
  Harness business message
    -> Noise IK encryption
      -> LAN / P2P / TURN / Relay carries ciphertext
        -> Noise IK decryption
          -> Host allowlisted Harness API
```

## 1. 使用的密码协议

当前协议固定使用：

```text
Noise_IK_25519_ChaChaPoly_SHA256
```

它由以下部分组成：

- Noise IK 握手模式：Client 在发起连接前已经固定 Host 的静态公钥，双方在握手中完成相互身份确认并派生本次连接的传输密钥。
- X25519：设备身份密钥和 Noise 密钥协商使用的椭圆曲线算法。
- ChaCha20-Poly1305：为每条业务消息同时提供机密性与完整性保护。
- SHA-256：Noise transcript 的哈希算法。

项目使用维护中的 Noise 实现，并把 v1 限定为上述固定组合，不自行发明握手状态机，也不根据网络类型切换密码套件。

## 2. 设备身份与信任

每个 Host 和 Client 角色都有独立的 `deviceId` 与 X25519 identity key。私钥只保存在产生它的设备本地；注册到 Server 的是设备描述和公钥。身份状态按 Server origin 与 Host/Client 角色隔离，同一安装中的两个角色也不能复用私钥或设备凭证。

一条连接必须同时通过两层授权：

1. **账号 membership**：Server 只允许同一 owner 下、具有有效 membership 且尚未撤销的 Host 与 Client 建立连接。扫码配对受限设备只获准访问显式绑定的设备对。
2. **本地 identity pinning**：双方把远端设备的 identity key 固定在本地。已知 `deviceId` 如果突然对应另一个公钥，连接会被拒绝，而不是静默接受新身份。

Client 从受 membership 保护的设备详情获取 Host 公钥。Host 收到连接事件后，还会使用自己的设备凭证重新查询 Client descriptor，交叉校验账号授权、角色、公钥与本地 pinned identity。Server membership 与本地信任缺一不可。

普通账号设备首次通过 membership 与服务端身份校验后自动固定公钥；配对受限设备还要求显式关系。通过这些校验的新设备在首次连接时固定公钥，Host 与 Client 均无需额外确认；已知设备公钥变化默认拒绝。服务端是首次授权与公钥分发的信任源，本地 pinning 不构成独立的带外身份核验。

这意味着必须信任所用服务端的账号与设备管理：若服务端被攻破或恶意运行，它可能为同账号伪造新设备描述，使首次连接固定攻击者的公钥；E2EE 与既有设备换钥检测不能阻止这种首次身份替换。

如需关闭某台设备控制其他 Host 的主控权限，可在 [Web 版](https://dsh.r2049.cn/)主机列表中为该设备启用「仅受控」；该设备将无法查看账号下的其他设备，Web 和其他客户端仍可连接它。这与 Host 本地关闭 `terminal.enabled` 的终端开关是不同的控制。

## 3. 一次安全连接如何建立

```text
Client                    Server                         Host
  | -- authenticated connect.request ------------------> |
  |                         | -- connect.incoming ------> |
  |                         |    membership + identity    |
  |                         | <-- connect.accepted ------ |
  | <-- connectionId ------ |                            |
  |                                                      |
  | -- Noise IK message 1 (opaque) --------------------> |
  | <-------------------- Noise IK message 2 (opaque) -- |
  |                                                      |
  | ===== authenticated Noise transport ciphertext ===== |
```

具体过程如下：

1. Client 与 Host 分别使用自己的 device credential 登录 Control WebSocket。
2. Server 校验双方账号归属、membership、设备状态和在线状态，然后创建临时 `connectionId`。
3. Host 再次验证 Client descriptor，并检查本地固定的 Client identity key；Client 使用已固定的 Host identity key。
4. 双方执行两条消息的 Noise IK 握手。握手内容由 Server 转发，但 Server 不解析 Noise payload。
5. 握手 transcript 的 prologue 绑定以下上下文：
   - `DSH-REMOTE` 与协议版本 v1；
   - 本次 `connectionId`；
   - Host `deviceId`；
   - Client `deviceId`。
6. 只有 Noise 握手完成、远端静态公钥与本地信任一致后，业务通道才进入可用状态。

这些绑定可以防止把某次握手移植到另一条连接、另一台 Host 或另一个 Client。握手顺序错误、连接目标错误或 identity mismatch 都会关闭连接。

## 4. 什么内容被加密

Noise transport plaintext 承载 Remote RPC/Event envelope，以及 envelope 内的官方 Harness 数据面：

- 官方 Typert Remote call、stream 与 event carrier，当前兼容范围见[兼容说明](compatibility.zh.md)；Host、随包 Client 和 Android 已移除 rc.2 ApiProxy，独立 VS Code 保留的历史路径不能用于推断当前 Host 支持；
- CodeX / ACP 独立领域 RPC、事件和有界 transfer；
- 独立 `workspace.upload.v1` 的有界文件上传；
- Prompt、回复、问题与 permission 响应；
- Workspace、Session、模型与设置操作的数据；
- 图片 Prompt 的有界分块；
- 可选 `dsh-file-viewer` provider 授权后的只读文件 stat、list 和 range read。

Host 解密后仍会通过固定 allowlist 限制可调用的官方 Harness endpoint。端到端加密回答的是“谁能读取或篡改消息”，allowlist 回答的是“已授权远端能调用什么”；两者不能互相替代。

## 5. Server 能看到什么

Server 是连接协调者，不是不可见的网络参与者。为了完成授权、在线状态、选路和限流，它需要读取一部分控制元数据。

| Server 可以看到 | Server 不能从协议中读取 |
| --- | --- |
| 账号与设备归属、设备 ID、角色、显示名和公开 identity key | Prompt、对话消息和模型输出 |
| Host/Client 在线状态、连接时间与 `connectionId` | Harness 工具输入与输出 |
| 协商的协议版本、capability 和所选网络路径 | Workspace 路径、源码和文件预览内容 |
| WebRTC signaling、ICE/TURN 协调数据 | Noise 传输密钥和设备私钥 |
| Relay frame 大小、方向、时序和流量规模 | Remote RPC/Event 的方法、参数和结果 |

因此，E2EE 隐藏业务内容，但不隐藏“哪些设备在何时通信”、连接持续时间、近似流量大小或网络候选等元数据。Relay frame 中的 ciphertext 禁止写入 Server 日志或数据库。

## 6. 消息完整性、顺序与重放保护

Noise 为两个方向维护独立的认证 nonce/counter。接收端要求消息符合当前连接的下一状态：认证失败、重复密文、旧消息、乱序消息或连接不匹配都会 fail closed。

Relay envelope 还携带一个外层递增 `counter`，便于路由端做基础限速和顺序诊断；它不是加密 nonce 的事实来源，真正的认证顺序由 Noise transport state 决定。

Noise 单条 transport message 有 65,535 bytes 上限。编码后的业务消息超过 48 KiB 时，会先在已认证通道内切成严格有序的 secure fragments，再逐片加密：

- 完整重组上限为 4 MiB；
- 同一连接最多并行重组 8 条消息；
- 重复、乱序、长度不一致或超限分片会关闭安全通道。

图片和大响应还会在 Harness tunnel 层使用有界 transfer 分块；重组完成后仍必须经过原有 endpoint allowlist，分块不能绕过业务授权。

## 7. 密钥生命周期

- **设备 identity private key**：在设备本地产生和保存，不上传到 Server；Host 与 Client 角色相互隔离。
- **远端 static public key**：从受保护的设备 descriptor 获取，并固定在本地 trust store。
- **连接传输密钥**：由每次 Noise IK 握手产生，只属于绑定的 `connectionId` 与设备对。
- **连接关闭**：销毁 Noise session、清理接收/发送状态和未完成分片；重新连接会重新握手。
- **设备撤销**：撤销 device credential 与 membership，在线端观察到撤销后关闭活动 Remote connection；已协商控制租约且控制面中断时，撤销传播可能延迟到租约到期。再次授权被撤销角色时需要新的受信任身份流程。

`fixtures/crypto/v1/noise-ik.json` 提供 Noise IK 跨实现 golden vector。
长期连接 rekey 和独立密码安全审查仍在路线图中。在这些工作完成前，项目不额外宣称协议规范之外的长期密钥安全性质。

## 8. TLS、WebRTC 与 Noise 的关系

- HTTPS/WSS 为设备到 Server 的 REST 与 Control 链路提供传输保护，并验证 Server 身份。
- WebRTC DataChannel 自带 DTLS 加密；TURN 也不会把 Noise plaintext 暴露给中继。
- Noise 提供 Client 到 Host 的统一应用层端到端加密，是业务数据的最终安全边界。

即使 WSS、WebRTC 或 TURN 已经加密，Remote message 仍必须经过 Noise。这使 Relay 与直连使用相同的 peer identity、认证和重放保护，也避免把 Server 或 TURN 提升为业务明文终点。

## 9. 不在 E2EE 保护范围内的风险

端到端加密不能解决所有安全问题：

- 如果 Host 或 Client 操作系统已经被入侵，攻击者可能在加密前或解密后读取内容。
- 已授权 Client 能执行的操作仍取决于 Host 的 Harness API allowlist 和 Harness 原生 permission 控制；E2EE 不会把恶意的已授权端变成可信端。
- Server 仍可以拒绝服务、延迟或丢弃密文，并能观察前述连接元数据。在公钥已正确固定且端点私钥未泄露的连接中，Server 无法伪造通过 Noise 认证的业务消息；首次身份分发仍依赖第 2 节所述的服务端信任。
- 用户看到的设备名称不是身份凭据；真正的设备身份来自固定的 X25519 public key。
- E2EE 不等于匿名网络，也不隐藏 IP、ICE candidate、通信时间和流量特征。

Remote 不提供绕过现有 workspace/provider 边界的通用 exec 或文件写入端点，也不开放远程桌面或通用工具 RPC。远程交互终端通过受支持的 Harness 原生终端或 CodeX / ACP workspace provider 提供 Shell / PTY，受 Host 本地 `terminal.enabled` 控制（默认开启），以 Host 用户身份运行，独立于 Agent 审批；可在 Host 本地关闭。Agent 自己的工具执行仍遵循各后端的 permission / 审批流程，不能把这套审批视为交互终端的授权关卡。

## 10. 实现与验证入口

- 密码实现：`packages/crypto/src/noise.ts`
- Client 安全封装：`packages/plugin/src/client-secure-transport.ts`
- Host 安全通道：`packages/plugin/src/server-connection.ts`
- 分片编解码：`packages/protocol/src/index.ts`
- 核心测试：`packages/crypto/tests/noise.test.ts`、`packages/plugin/tests/server-connection.test.ts`
- 规范性协议：[Remote Protocol v1 §12](protocol.md#12-secure-channel)
