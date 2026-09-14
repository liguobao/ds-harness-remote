# Cursor Remote 技术说明

本文记录 Cursor ACP Remote 的实现边界、配置方式和当前进度。线协议以
[Remote Protocol v1](protocol.md) 为准；架构对齐 [Codex Remote](codex-remote.md)。

本分支对应 [#65](https://github.com/liguobao/ds-harness-remote/issues/65) 中的第一外部互操作目标：
Host 侧桥接 Cursor `agent acp`，并复用已有认证 Remote 通道。公共面暂为
`cursor.acp.v1` / `cursor.app.*`（后续再收敛到通用 `agent.acp.v1`）。

## 定位

Cursor Remote 是现有 Remote Plugin 内的**实验性可选领域**，不是独立插件，也不是
Server runtime。它复用 Remote 已有的账号授权、Host 选择、端到端加密连接：

- Host 侧通过 stdio 启动官方 Cursor CLI：`agent acp`
- 线上使用独立 capability / RPC：`cursor.acp.v1`、`cursor.app.*`
- Session / 流式更新 / 权限请求留在 ACP 进程内；Remote 只做展示与受限转发
- 按 Remote connection 隔离；编译期固定 allowlist；未授权 method fail closed

当前仓库已完成 **Host 领域骨架 + 协议接线 + client-core 客户端 + Desktop 设置开关**。
Desktop Virtual Harness 与 Android UI 投影不在本提交范围。

## 用户界面（规划）

目标与 Codex 相同：不新增独立 Cursor 页面。

- Desktop：内存载体复用原生 Workspace / Session / Composer（待实现）
- Android：`backend: 'cursor'` 合并进现有列表（待实现）

## 操作白名单

远端只允许编译期固定 ACP 方法：

| 方法 | 用途 |
| --- | --- |
| `session/new` | 在 Host 上已存在的绝对目录创建会话（强制 `mcpServers: []`） |
| `session/load` | 恢复会话 |
| `session/prompt` | 仅文本 Prompt |
| `session/cancel` | 中断 |
| `dsh/directoryList` | Host 只读单层目录浏览（选 cwd） |

明确拒绝：任意 process/shell、MCP 注入、通用文件附件、反射未知 method。

线 RPC：

- `cursor.app.call` / `cursor.app.respond`
- `cursor.app.stream.open|close`
- `cursor.app.transfer.*`
- 事件：`cursor.app.frame` / `cursor.app.stream.closed`

## 配置

Cursor 默认**关闭**。开启前请在 Host 本机完成 `agent login`，或配置
`CURSOR_API_KEY`。也可在 Desktop 插件设置中切换开关（需重启 DSH）。

```yaml
ds-harness-remote:
  cursor:
    enabled: true
    binary: agent   # 或 ~/.local/bin/agent 的绝对路径
```

`binary` 保持默认 `agent` 时，Host 会优先尝试 `~/.local/bin/agent`，再回退 PATH。
显式路径不会被改写。修改配置后需重启 DSH。

## 实现入口

| 路径 | 作用 |
| --- | --- |
| `packages/plugin/src/cursor/acp-server.ts` | `agent acp` stdio JSON-RPC |
| `packages/plugin/src/cursor/method-policy.ts` | allowlist |
| `packages/plugin/src/cursor/domain.ts` | 领域生命周期 / 审批 / 路径校验 |
| `packages/plugin/src/cursor/peer-bridge.ts` | 每连接 stream / transfer |
| `packages/client-core/src/cursor-client.ts` | 共享 Client |

## 验证状态

- [x] Host 配置、capability、RPC 路由
- [x] ACP client initialize + authenticate
- [x] 方法策略单测
- [x] Desktop 设置开关 `settings.cursor.set`
- [ ] Desktop Virtual Harness
- [ ] Android Workspace/Chat 投影
- [ ] 真机跨机 E2E
- [ ] 通用 `agent.acp.v1` 公共面（#65 后续）
