## 版本兼容

## 当前兼容目标（2026-10-31）

当前适配基线为 `dsh-v0.2.1-rc.5`，保留上一版 `dsh-v0.2.0-rc.2`（以及 rc.1）的官方 Typert / Session V3 接入。peer range 明确接纳 `0.2.1` 与 `0.2.2` 的 alpha/beta/RC 和正式版；后续 `0.2.2` RC 在官方 carrier 契约不变时无需仅为版本号改包。未来版本尚未发布，范围接纳不等于已完成其 runtime 验证。 本轮已按官方 `0.2.1-rc.5` 发布内容完成 Plugin check/build、DSH bundle 校验，以及思考内容流转烟测：Android reasoning reducer/自动滚动 18 个测试通过，Plugin ACP/Codex reasoning 投影 30 个测试通过。未做真实 Desktop/Android APK 或跨设备 UI 人工验收。

Remote Plugin 与 dsh-TUI 的适配基线是分开的。当前公开 dsh-TUI `0.17.0` 的主适配线是 `dsh-v0.2.1-rc.3`，因此本仓库不把 `dsh-TUI 0.17.0 + dsh-v0.2.1-rc.5` 宣称为已完成 runtime 验收的组合。

Host 插件、随包 Remote 客户端和 Android 已移除 Harness `0.1.1-rc.2` ApiProxy 兼容。请使用提供官方 Typert Remote carrier 的 Host；仅提供 ApiProxy 或不支持能力发现的旧 Host 会被拒绝，不再降级。CodeX/ACP 保留独立数据面，Desktop 内存投影统一使用 Typert。本轮不改独立 VS Code Client 或独立 Remote Web 仓库。

新版问答通过固定 `userQuestions/attachWait` stream 认领前台倒计时，通过 `$events/result` 回传窗口内回答或 `ASK_TIMED_OUT`；超时后仅根据官方 `userQuestions` projection 恢复可补答问题，补答走 `userQuestions/answer`，断线不重放输入。上一版 RC 的无限期问答保持原事件路径。

可选 Claude Code Mods 的展示和按钮仅允许 `claudeCodeMods/watchBand` / `pressBand`，不开放动态端点。带路径前缀的 Web 部署中，Remote 状态 SSE 与官方 RPC 都使用文档相对地址；代理仍需按 Harness 文档剥离前缀并配置可信 authority。

RC.1 Gateway 的每条已认证 Remote 连接使用独立的官方 owner Peer；RPC、事件回复、流和插件 Fetch 路由绑定同一 Peer，断线释放，不能借用另一连接的事件流回答审批。现有固定 allowlist 仍先于 Gateway 生效，新增只读 `remoteAccess/follow`。

RC.1 原生终端的 `terminal/attach` 双向流在本地转换为既有 Remote `follow/write/resize` 子集，Host 再对接官方 attach；Android 和旧客户端继续使用既有协议。输入有界排队，收到 Host ack 后才确认，保留设备归属、连接输入权和断线不重放。旧 Host 与 CodeX/ACP 终端为 RC.1 客户端补充输入缓冲上限。`session/projections` 支持新版结果类型标记；CodeX/ACP 的投影仅从各自的内存/历史读取。

验证覆盖 RC.1 npm 实现的真实 Gateway/Peer 隔离、核心终端状态转换、全仓类型检查、自动化测试、生产构建（含 Android Hermes 导出）与 DSH bundle 校验。Desktop UI、Android APK/原生真机、独立 Remote Web 和加密跨设备 E2E 尚待验收。

2026-10-17 启动兼容补充：RC.1 主题模块会直接读取新增字体字段，旧 `0.2.0-rc.2` Host 的合法 `ui-theme` 配置缺少这些字段时，会在主题初始化抛出 `undefined.split` 并阻塞依赖模块。Remote 在设置读取及成功写入的返回视图中补齐缺失显示默认值，不修改 Host schema、revision、持久化配置或写入授权。旧 Host 不支持的新字体设置仍可能被其拒绝。已用本机安装的官方 RC.1 主题 bundle 复现异常并验证修复后的初始化、旧 schema 校验与返回结果保真；Plugin check/build、相关 20 个 Gateway 测试和 bundle 校验通过，真实跨设备启动恢复尚未验收。

## 历史实现记录（不代表当前维护承诺）

**破坏性更新声明：** Plugin `0.4.1` 已移除早期实验性的 Remote 业务 RPC
（`sessions.*`、`session.*`、`permissions.respond`、`sync.from`）。Harness
该版本的会话流量通过官方 rc.2 `ApiProxy` 或 v0.1.2 Typert Remote Gateway 承载；
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
