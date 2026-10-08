## 版本兼容

## 当前兼容目标（2026-10-09）

当前适配基线为 `dsh-v0.2.1-alpha.1`，保留上一版 `dsh-v0.2.0-rc.2`（以及 rc.1）的官方 Typert / Session V3 接入。peer range 明确接纳 `0.2.1` 与 `0.2.2` 的 alpha/beta/RC 和正式版；后续 `0.2.2` RC 在官方 carrier 契约不变时无需仅为版本号改包。未来版本尚未发布，范围接纳不等于已完成其 runtime 验证。

按用户要求，legacy rc.2 ApiProxy 不再作为兼容维护目标；已有实现和历史类型暂时保留，本次没有升级或扩展其接口。旧版 Typert/settings 分支同样不作为本轮验收目标。

新版问答通过固定 `userQuestions/attachWait` stream 认领前台倒计时，通过 `$events/result` 回传窗口内回答或 `ASK_TIMED_OUT`；超时后仅根据官方 `userQuestions` projection 恢复可补答问题，补答走 `userQuestions/answer`，断线不重放输入。上一版 RC 的无限期问答保持原事件路径。

可选 Claude Code Mods 的展示和按钮仅允许 `claudeCodeMods/watchBand` / `pressBand`，不开放动态端点。带路径前缀的 Web 部署中，Remote 状态 SSE 与官方 RPC 都使用文档相对地址；代理仍需按 Harness 文档剥离前缀并配置可信 authority。

## 历史实现记录（不代表当前维护承诺）

**破坏性更新声明：** Plugin `0.4.1` 已移除早期实验性的 Remote 业务 RPC
（`sessions.*`、`session.*`、`permissions.respond`、`sync.from`）。Harness
会话流量现在只通过官方 rc.2 `ApiProxy` 或 v0.1.2 Typert Remote Gateway 承载；
本插件不提供旧 RPC 的适配层或 wire format 翻译。

Plugin `0.5.0` 主要用于兼容 DeepSeek Harness `dsh-v0.2.0-rc.2`，同时保留 `dsh-v0.1.7-rc.1`，并保留
`dsh-v0.1.6-alpha.2` 及更早版本的 settings 兼容路径；它也兼容 `dsh-v0.1.1-rc.2` 与
`dsh-v0.1.2-alpha.1`–`rc.1`：rc.2 继续使用官方 legacy `ApiProxy`，v0.1.2 使用官方
Typert Remote Gateway；另外支持 `dsh-v0.1.5-rc.1`、`dsh-v0.1.6-alpha.1` 与 `dsh-v0.2.0-rc.2` 的 Session V3
官方 Typert Remote Gateway——`0.1.6` 上报的 patch 为 `6`，会选中同一个 Session V3
profile，不需要额外的 wire format 适配层。运行 rc.2 的 `0.4.13` Client 仍可通过
legacy capability 降级连接旧 rc.2 Host。`0.5.0` 还会同时从 CLI 入口与 0.2.0 Desktop
外壳的 `@deepseek-ai/dsh-desktop-host` 入口读取 Harness 版本，使当前 Desktop 启动的 Host
继续上报 `harnessVersion`，按版本生效的 Workspace 兼容路径（legacy `workspaceFiles/changes`、
字节范围读取）不会失效。

Remote Web/Desktop 和 Android App 还会把已发布旧会话中仍然上报的已退役 `code`
agent preset 归一为 `ptc`，因此旧会话可以在 `dsh-v0.1.5-rc.1` 或 `dsh-v0.1.6-alpha.1`
上恢复，而无需修改 DeepSeek Harness 本身。

Desktop 两端必须使用兼容的 Harness carrier。`0.5.0` 会在 Host 暴露 rc.2 ApiProxy 时
选择 legacy ApiProxy 路径，Session V3 Desktop Client 也可以通过 Remote 侧的历史与事件归一化
打开 legacy v0.1.2 Typert Remote Host。legacy Typert Client 仍会在切换原生 UI 或修改 Workspace
前拒绝 Session V3 Host。

`0.5.0` 的 `workspaceTypes` 仍是加密能力描述中的可选加法字段。未读取该字段的 Harness、CodeX 客户端继续使用既有 capabilities。Host 提供类型列表时，Desktop 与 Android 进入工作区前同时校验对应能力已协商且类型就绪，类型声明不能开启未经协商的 API。ACP 使用独立的 Cursor/AGY capability 和工作区 ID，不迁移未发布使用过的 ACP 配置或工作区标识。
