# 共享基础功能设计

更新时间：2026-10-08。

## 包与应用边界

| 包/应用 | 职责 |
| --- | --- |
| `protocol` | Control / Relay、业务 tunnel 和领域 capability 的类型与运行时 schema |
| `crypto` | X25519、HKDF、ChaCha20-Poly1305、Noise IK 与确定性 vector |
| `webrtc` | Relay / LAN / P2P / TURN 和自适应传输状态 |
| `client-core` | RPC 关联、流/事件分发、Harness / CodeX / ACP Client |
| `plugin` | Host/本地 Remote、账号设备接入、信任、各领域 allowlist 与内存 UI carrier |
| Android / VS Code | 各自 Client 生命周期、凭据与平台 UI |
| Browser | 独立凭据授权与在线 Host Launcher，不建立 Remote transport |
| 最小 Server | 单账号、设备凭据文件持久化、Control/握手转发和 opaque Relay |

[协议](../protocol.md)定义 wire contract；完整 Server 与 Remote Web 由独立仓库实现。
各领域共用身份和加密传输，但不共享业务 authority、RPC 命名空间或会话持久化。

## 身份与授权

Host / Client 使用独立 deviceId 与 X25519 identity。Plugin 身份、credential 和 trusted peer 按规范化 Server origin 与角色隔离，私钥保留设备本地。
Client 凭据与 Host 凭据、浏览器扩展凭据分别隔离。

账号密码、GitHub/知乎授权及主机匹配码由 Server 支持范围决定。匹配码用于 Host 加入账号，不是 Client/Host 配对码。
业务建立前 Client 固定受 membership 保护的 Host descriptor key；Host 同时验证 Server account authorization 和本地 pinned trust。
既有 deviceId 的 key 改变必须拒绝；不能由 presence、名称或 UI 选中状态授予信任。

Plugin 刷新凭据使用跨进程目录锁和锁内重读，不按时间强行抢锁；握手拒绝后最多恢复一次。
连接被替换时停止自动抢占。异常锁恢复见根 README，并行 Host 使用不同 DSH_HOME。

## 加密与传输

Noise IK 绑定双方 identity、Host/Client、connectionId；业务只进入认证后的加密 channel。
AEAD counter、target、连接状态和消息限额共同执行 fail-closed 校验。
Server 可见路由与设备/连接元数据，不读取 Relay 业务明文。最小 Server Relay-only，不提供 WebRTC/TURN。

完整 transport 选路使用 LAN / P2P / TURN / Relay；STUN/TURN、ICE、signaling 和 werift/Android 原生互操作已有验证。
网络切换、代理、休眠唤醒、rekey 与长期稳定性仍有独立待办，不能由基础互操作推断全部环境可用。

## 独立业务域

- Harness：`harness.api.*` / `harness.remote.*`，保持官方 ApiProxy / Typert 的请求、事件与权限语义。
- CodeX：`codex.app.*`，App Server 固定 allowlist 和 Project / Thread authority。
- ACP：`agent.acp.*`，Cursor / AGY 独立 capability；Host 会话/backend 归属，浏览器只消费 Host 接口。
- File Viewer：`fileviewer.call`，provider 内受限 stat/readRange/list。
- Loopback：`loopback.call`，Host 本地白名单端口和 HTTP/WebSocket 限制。

工具通过既有领域的固定 endpoint 接入。CodeX / ACP 使用 Host 验证的独立会话 scope，不能由 Client 自报 cwd 或通用 RPC 绕过 authority。
终端归属/输入权独立于 Agent 审批；Remote 不得改插件自身访问设置。
图片和超限业务 envelope 使用有界 transfer，限制类型、总量、并发、顺序、空闲期限与连接归属；不扩展为任意文件上传。

## Capability 与兼容

`harness.transport.describe` 在加密通道中探测 carrier、领域与工具支持，老 Host 保留 legacy 降级。
当前 Host 可提供 `workspaceTypes`，Client 同时检查已协商 capability 与 `available`，启用开关不等于实际就绪。
后端初始化不阻塞 Harness，配置热更新只影响对应后端；不可用后端不能替换成另一个后端。
兼容 profile 以[版本说明](../compatibility.zh.md)及源码为准，不复制或翻译任意 Harness wire format。

## 断线与恢复

断线关闭连接所属 pending RPC、stream、transfer 和审批句柄；Desktop Harness 回落 Local。
CodeX / ACP 虚拟载体只存在 Client 内存，不进入 DSH SessionStore、Workspace 数据库或 Harness 日志。
恢复重新认证、打开流、获取历史 baseline，丢弃迟到结果，不自动重放 mutation 或终端输入。
Android 已有后端专属恢复行为；共享 pending call/stream 的完整恢复与长期稳定性仍按 TODO 跟踪。

## 安全与测试

Plugin 不监听公网，预览 Client 只监听本机；日志不得包含 token、私钥、匹配码、Prompt、源码与工具输出。
AGY 私有图片 tmp 是有界、按会话隔离的例外，不允许项目写入、任意路径或符号链接逃逸。
未知 method、错误 connection/target、越权会话、identity mismatch、篡改、重放和无效权限回答均拒绝。

核心测试保护 protocol schema、身份加密、账号授权、allowlist、RPC/stream、隔离、恢复与 transport 状态机。
共享 fixture 由所属包验证，跨端验证在真实 runtime 执行；不以 Node 重跑共享代码冒充 Android 原生验收。
待验证项见[TODO](../TODO.md)，协议对齐过程见[Schema 对齐](protocol-schema-alignment.md)。
