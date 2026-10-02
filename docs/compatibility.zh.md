## 版本兼容

**破坏性更新声明：** Plugin `0.4.1` 已移除早期实验性的 Remote 业务 RPC
（`sessions.*`、`session.*`、`permissions.respond`、`sync.from`）。Harness
会话流量现在只通过官方 rc.2 `ApiProxy` 或 v0.1.2 Typert Remote Gateway 承载；
本插件不提供旧 RPC 的适配层或 wire format 翻译。

Plugin `0.4.27` 主要用于兼容 DeepSeek Harness `dsh-v0.2.0-rc.2`，同时保留 `dsh-v0.1.7-rc.1`，并保留
`dsh-v0.1.6-alpha.2` 及更早版本的 settings 兼容路径；它也兼容 `dsh-v0.1.1-rc.2` 与
`dsh-v0.1.2-alpha.1`–`rc.1`：rc.2 继续使用官方 legacy `ApiProxy`，v0.1.2 使用官方
Typert Remote Gateway；另外支持 `dsh-v0.1.5-rc.1`、`dsh-v0.1.6-alpha.1` 与 `dsh-v0.2.0-rc.2` 的 Session V3
官方 Typert Remote Gateway——`0.1.6` 上报的 patch 为 `6`，会选中同一个 Session V3
profile，不需要额外的 wire format 适配层。运行 rc.2 的 `0.4.13` Client 仍可通过
legacy capability 降级连接旧 rc.2 Host。`0.4.27` 还会同时从 CLI 入口与 0.2.0 Desktop
外壳的 `@deepseek-ai/dsh-desktop-host` 入口读取 Harness 版本，使当前 Desktop 启动的 Host
继续上报 `harnessVersion`，按版本生效的 Workspace 兼容路径（legacy `workspaceFiles/changes`、
字节范围读取）不会失效。

Remote Web/Desktop 和 Android App 还会把已发布旧会话中仍然上报的已退役 `code`
agent preset 归一为 `ptc`，因此旧会话可以在 `dsh-v0.1.5-rc.1` 或 `dsh-v0.1.6-alpha.1`
上恢复，而无需修改 DeepSeek Harness 本身。

Desktop 两端必须使用兼容的 Harness carrier。`0.4.27` 会在 Host 暴露 rc.2 ApiProxy 时
选择 legacy ApiProxy 路径，Session V3 Desktop Client 也可以通过 Remote 侧的历史与事件归一化
打开 legacy v0.1.2 Typert Remote Host。legacy Typert Client 仍会在切换原生 UI 或修改 Workspace
前拒绝 Session V3 Host。
