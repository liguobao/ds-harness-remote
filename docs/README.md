# DSH Remote 文档

## 当前仓库边界

本仓库只实现以下内容：

- DeepSeek Harness Plugin（常驻 Host + 本地 Remote 工作区入口，无用户可见的 Client 模式）
- Android Client（账号授权 + Adaptive transport + rc.2 ApiProxy / v0.1.2 Typert Remote 双数据面 + 可选 Codex Remote）
- VS Code Client（账号授权 + Host 信任固定 + rc.2 ApiProxy / v0.1.2 Typert Remote 会话/Prompt）
- `protocol`、`crypto`、`webrtc`、`client-core`、`ui` 等共享包
- 用于客户端和插件联调的 Mock Host

本仓库另提供 [最小自部署 Server](../apps/server/README.zh.md)：单账号环境变量鉴权、设备注册与凭据、Control/Relay，以及登录和设备状态页。

完整多账号 Server、Remote Web 会话 UI 和 Admin 仍在独立 Server 项目实现；这里的最小版本复用相同协议子集，保持独立进程，不扩展为完整站点。

## 权威文档

- [Server 设计说明](server.md)：定义外部 Server 的职责、API、安全边界、数据模型和部署要求；完整站点设计；最小自部署子集见上述运行文档。
- [Host Plugin 接入指南](plugin-integration.md)：定义账号登录、Host 授权注册、设备凭证轮换、WebSocket 和本地状态隔离要求。
- [Remote Protocol v1](protocol.md)：定义 Host、Server、Client 的线协议，是本仓库 Plugin、Client 和共享协议包的实现依据。
- [产品与功能设计](design/README.md)：定义 Plugin、Client 和共享基础能力。

## 主题说明

- [插件安装指南](installation.zh.md)（[English](installation.md)）：已有 Harness 插件安装、Desktop 插件管理、profile 选择与插件卸载。
- [dsh-TUI Remote 使用指南](dsh-tui.md)：介绍 dsh-TUI profile 安装、`/remote` 命令、扫码登录、状态查询、ApiProxy/Typert carrier 兼容与排障。
- [Codex Remote 技术说明](codex-remote.md)：说明 Codex 工作区展示、数据边界、配置、安全限制和当前验证状态。
- [ACP Remote / Agent adapters](acp-remote.md)：说明 #65 Agent ACP gateway、Cursor adapter、allowlist 与配置。
- [端到端加密](end-to-end-encryption.md)：解释 Noise IK、设备身份固定、密钥生命周期、Server 可见元数据、重放保护与安全边界。
- [网络与传输](network.md)：解释出站连接、Control/Data plane、LAN/P2P/TURN/Relay 选路、NAT、降级、断线恢复与当前验证状态。
- [版本兼容说明](compatibility.zh.md)（[English](compatibility.md)）：记录 Plugin 与各版本 DeepSeek Harness 的 carrier、Session 和 Desktop 兼容范围。

## 阅读路径

- **在 dsh-TUI 中使用 Remote**：先读[dsh-TUI Remote 使用指南](dsh-tui.md)，再按需查看[插件包说明](../packages/plugin/README.md)。
- **安装或使用其他 Plugin 入口**：先读[根 README](../README.md)，再读[插件包说明](../packages/plugin/README.md)。
- **了解 Codex Remote 的实现边界**：先读[Codex Remote 技术说明](codex-remote.md)，需要实现级字段时再查[协议](protocol.md)。
- **了解安全与网络边界**：先读[端到端加密](end-to-end-encryption.md)和[网络与传输](network.md)，需要实现级字段时再查[协议](protocol.md)。
- **实现或审查 Plugin**：读[功能设计](design/plugin/functional-design.md)和[Host 接入指南](plugin-integration.md)。
- **实现外部 Server**：以[协议](protocol.md)为线协议权威，再参考[Server 设计](server.md)。
- **跟踪尚未完成的工作**：读[开发任务](../TODO.md)。

文档优先级：`protocol.md` 的线协议约束高于示例代码；Server 设计发生变化时必须同步检查协议兼容性和版本号。

2026-09-20 原生侧栏扩展：官方文件树/只读预览、默认开启且可在详细 Remote 设置中关闭的终端，以及受限 loopback HTTP/WebSocket 预览，配置与边界见根 README，线协议见 `protocol.md`。完整 Server 仍只转发密文，不代理预览 HTTP 明文。
