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
  -> Codex App Server adapter（后续）
```

- 公共 capability / RPC：`agent.acp.v1`、`agent.acp.*`
- Host 配置键 `cursor.enabled` / `cursor.binary` 只控制 **Cursor adapter**，不是线协议名
- 按 Remote connection 隔离；编译期固定 allowlist；未授权 method fail closed
- 现有 `codex.app.*` 保持不变

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
| `packages/client-core/src/acp-client.ts` | 共享 Client |

## 验证状态

- [x] Host gateway、capability、RPC 路由（`agent.acp.v1`）
- [x] Cursor adapter initialize + authenticate（Host 本地）
- [x] Client `initialize` 公共面（gateway 短路）
- [x] 方法策略单测
- [x] Desktop 设置开关 `settings.cursor.set`（adapter）
- [ ] Desktop / Android Client 投影
- [ ] Codex → ACP adapter
- [ ] 真机跨机 E2E
