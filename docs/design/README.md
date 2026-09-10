# DSH Remote 设计文档

状态：Draft v0.2
更新时间：2026-08-31
上游需求：[vibe-coding.md](../../vibe-coding.md)

本目录定义当前仓库内以 rc.2 ApiProxy / v0.1.2 alpha.1–rc.1 / v0.1.5 rc.1 Session V3 Typert Remote Gateway 为 Harness 业务面、以可选 File Viewer bridge 为只读预览面的双角色 Desktop Plugin、Android/VS Code Client 和共享基础包的产品与功能。
Android 与 VS Code 已接入同一双 carrier Client Core，但仍需真实设备和 Extension Host E2E 验证。

Server 的设计约束以 [../server.md](../server.md) 为准，Host/Server/Client 的线协议以 [../protocol.md](../protocol.md) 为准，Host 的账号登录与授权注册流程见 [../plugin-integration.md](../plugin-integration.md)。这些文档必须保留，但 Server 由独立项目实现，不得在当前仓库创建 Server 源码或部署目录。

## 项目清单

| 项目 | 交付物 | 产品设计 | 功能设计 |
| --- | --- | --- | --- |
| Harness Remote Plugin | `packages/plugin` | [plugin/product-design.md](plugin/product-design.md) | [plugin/functional-design.md](plugin/functional-design.md) |
| Codex Remote 展示领域 | `packages/plugin/src/codex`、`packages/client-core` | 不迁移数据，只投影展示 | [codex-session-history-projection-prompt.md](codex-session-history-projection-prompt.md) |

跨项目协议、身份、加密、连接降级和错误语义统一定义在 [shared-foundation.md](shared-foundation.md)。`protocol`、`crypto`、`client-core`、`webrtc` 属于当前仓库的共享基础包。

## 不在当前仓库实现

- DSH Remote Server runtime
- Remote Web、Server Admin 后端与托管站点
- Server 数据库、迁移、测试与部署
- TURN/Coturn 部署

这些能力的预期行为仍由 `server.md` 和 `protocol.md` 约束，供独立 Server 项目实现与互操作验收。

## MVP 主路径

1. Plugin Host 用网页生成的一次性设备授权码接入账号，并向 Server 建立出站连接。
2. 本地 Plugin Client 用同一账号注册独立 Client identity，Server 自动建立 membership。
3. 双端通过受 membership 保护的设备详情固定对端 identity key。
4. 用户从本地 Harness 的 Remote 入口选择同账号 Host 和远端工作区；当前 Host 不在列表中。
5. 本地官方 UI 的 rc.2 ApiProxy 或 v0.1.2 Typert Remote carrier 通过 Noise 和自适应传输到达 Host。
6. Host allowlist bridge 调用远端 Harness 对应的官方 ApiProxy 或 TypertGateway。
7. Approval/Question 通过 rc.2 原生 `ClientResponse` 或 alpha `$events/result` 回到 Harness 权限系统。
8. 安装 dsh-file-viewer 时，文件预览通过 provider 授权后的受限分块读取桥完成。
9. 断线时旧流关闭，本地 UI 安全回落 Local。

## 设计约束

- 不修改 DeepSeek Harness 核心源码。
- Plugin 不监听公网 HTTP/WebSocket 端口，只发起出站连接。
- Remote 目录选择器只浏览远端目录元数据；文件内容仅能经 dsh-file-viewer provider 授权的只读分块预览桥访问，不提供目录写入、shell、PTY 或绕过 Harness 的权限入口。
- Server 不存储源码、提示词、会话明文、工具输出或 shell 历史。
- Relay 业务载荷必须端到端加密；TLS 不是唯一安全边界。
- Control/Relay 能力通过 handshake 协商；Harness carrier 通过加密的 capability probe 协商，同一连接不翻译 ApiProxy/Typert 业务模型。
- 非核心功能不单独编写测试；测试预算优先保障协议、加密、账号授权、鉴权、RPC 关联、权限和断线恢复。

## 文档判定规则

- **已确认**：可由当前 DeepSeek Harness / dsh-desktop 源码或 `vibe-coding.md` 直接证明。
- **设计决策**：本项目为完成 MVP 做出的约束性选择。
- **待验证**：实现前必须用真实 Harness 运行环境完成 spike，不允许用猜测 API 代替。
