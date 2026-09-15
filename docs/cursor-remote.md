# Agent ACP / Cursor adapter 技术说明

本文记录 Remote 内通用 Agent ACP gateway（#65）与 Cursor backend adapter 的边界。
线协议以 [Remote Protocol v1](protocol.md) 为准。

## 定位

Host Plugin 提供 backend-neutral 的 **Agent ACP gateway**：

```text
ACP Client
  -> 已认证 Remote channel（agent.acp.*）
  -> Host ACP gateway
  -> Cursor `agent acp` adapter（本阶段）
```

- 公共 capability / RPC：`agent.acp.v1`、`agent.acp.*`
- Host 配置键 `cursor.enabled` / `cursor.binary` 只控制 **Cursor adapter**，不是线协议名
- 按 Remote connection 隔离；编译期固定 allowlist；未授权 method fail closed
- 现有 `codex.app.*` 保持不变；**暂不**把 Codex 迁到 ACP adapter

## 公共方法（allowlist）

| 方法 | 用途 |
| --- | --- |
| `initialize` | Gateway 返回能力描述（不转发 Cursor 私有 initialize） |
| `session/new` | 在 Host 上已存在的绝对目录创建会话（强制 `mcpServers: []`） |
| `session/load` | 恢复会话 |
| `session/prompt` | 仅文本 Prompt |
| `session/cancel` | 中断 |
| `dsh/directoryList` | Host 只读单层目录浏览（选 cwd；Remote 扩展） |

线 RPC：`agent.acp.call|respond|stream.*|transfer.*`  
事件：`agent.acp.frame` / `agent.acp.stream.closed`

## 配置

Cursor adapter 默认**关闭**。开启前请在 Host 本机完成 `agent login`，或配置
`CURSOR_API_KEY`。也可在 Desktop 插件设置中切换开关（需重启 DSH）。

```yaml
ds-harness-remote:
  cursor:
    enabled: true
    binary: agent   # 或 ~/.local/bin/agent 的绝对路径
```

## 实现入口

| 路径 | 作用 |
| --- | --- |
| `packages/plugin/src/acp/gateway.ts` | ACP gateway / 会话归属 / 审批 |
| `packages/plugin/src/acp/method-policy.ts` | 公共 allowlist |
| `packages/plugin/src/acp/peer-bridge.ts` | 每连接 stream / transfer |
| `packages/plugin/src/acp/adapter.ts` | backend adapter 契约 |
| `packages/plugin/src/acp/adapters/cursor-process.ts` | Cursor `agent acp` stdio |
| `packages/plugin/src/acp/adapters/cursor.ts` | Cursor adapter 工厂 |
| `packages/plugin/src/acp/virtual-harness.ts` | Desktop Virtual Harness（cwd → Workspace / Session / Composer） |
| `packages/client-core/src/acp-client.ts` | 共享 Client（`AgentAcpClient`） |
| `packages/plugin/src/client-runtime.ts` | 探测 `agent.acp.v1`、打开 Cursor Virtual Harness |
| `packages/plugin/src/client.ts` | Remote 模态框列出 / 添加 Cursor 工作区 |

## Desktop 使用

1. Host：设置中开启 **Cursor ACP adapter**（`cursor.enabled`），完成本机 `agent login`，**重启 DSH**。
2. Client：侧栏 Remote → 选择在线 Host → 在 **Cursor virtual workspace** 分组点 `+`，浏览并确认 Host 上已有绝对目录。
3. 打开后复用原生 Workspace / Session / Composer；会话 id 形如 `cursor:<acpSessionId>`，不写入 DSH SessionStore。

## Android Client

内存投影（不写入 SessionStore）：

1. 探测 Host capability `agent.acp.v1` 后启用 Cursor 工作区分组。
2. 新建 Cursor workspace = 选择 Host 上已有绝对目录；会话经 `AgentAcpClient`（`agent.acp.*`）创建与流式更新。
3. 文本 Prompt / cancel / approval（`allow-once` | `reject-once`）；暂不支持图片。
4. Workspace backend id 仍为 `'cursor'`（仅 UI）；线协议为 `agent.acp.*`。

## 验证状态

- [x] Host gateway、capability、RPC 路由（`agent.acp.v1`）
- [x] Cursor adapter initialize + authenticate（Host 本地）
- [x] Client `initialize` 公共面（gateway 短路）
- [x] 方法策略单测
- [x] Desktop 设置开关 `settings.cursor.set`（adapter）
- [x] Desktop Virtual Harness（cwd workspace + session/prompt/stream/approval）
- [x] Android Client 投影（`AgentAcpClient` / 内存 Cursor workspace）
- [x] Android 真机：文本 Prompt、思考/正文流式帧、`prompt_completed` catch-up、多轮气泡分离
- [ ] Desktop ↔ 异机 Client 完整 E2E（审批 / cancel / 长工具轮次）
- [ ] 断线重连后 stream 重建与会话内 History 恢复
- [x] Android：重连保留 Cursor 会话并自动重建 ACP stream
- [ ] `session/load` 与跨设备会话列表体验

## 近期后续（不含 Codex→ACP）

1. Android / Desktop：transport 抖动后自动 `stream.open` + `claimSession`
2. Host 侧按 session 保留可分页的展示用 History（不写 DSH SessionStore）
3. 审批 / 提问 UI 与 `agent.acp.respond` 真机矩阵
4. 跨机长时间稳定性与 WebRTC/Relay 丢帧回归
