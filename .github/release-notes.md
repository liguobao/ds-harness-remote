## 中文

**v0.6.5 · Android build 72 · 2026-11-15**

### Android 与 DS-Bot

- 对齐 DS-Bot 0.3.6 的 Host 接口，改善实时卡片、设置子页和输入草稿的同步。
- 修复群聊只显示部分成员回复：保留完整的有界历史投影，成功读取的 Host 结果替换部分缓存；实时对话、历史加载和 App 重启恢复均已真机验证。
- 修复创建 Bot 时键盘遮挡表单；短窗口支持整张表单滚动，并改善大字体、暗色和横竖屏切换。
- 断线期间仍可编辑 Agent 草稿，发送保持禁用；重连后保留草稿，不自动发送。
- 优化页面与 Sheet 连续过渡、会话抽屉、聊天排版与配色、代码高亮和活动组件；修复确认对话框按钮动作被取消、重复创建空对话等问题。
- 补充俄语、乌克兰语和 DS-Bot 设置页翻译。

### 文件、图片与 LAN 上传

- 修复 Harness Desktop 和内嵌 IDE 的远程图片上传，保留官方 Session 附件凭证；普通文件也可通过 HTTP / IDE RPC 上传，独立 VS Code 扩展新增文件和图片选择器。
- Android 恢复拍照入口，支持从相册和文件选择器上传视频及二进制文件。
- 至少 1 MiB 的二进制文件在实际 LAN 路径且原生模块可用时，可使用独立的认证 Noise/TCP WebSocket 加速上传。其他连接路径、小文件、旧 Host 和缺少原生模块的客户端沿用原路径；上传开始后不换通道重放。
- 修复可信工作区入口经过符号链接时，合法的工作区内绝对路径被拒绝的问题；继续拒绝越界路径和工作区内部符号链接。

### 压缩、恢复与诊断

- 新增可追踪的异步压缩：长压缩不再受普通 RPC 的 60 秒期限限制，断线后按原操作 ID 恢复查询，取消等待真实生命周期确认。旧 Host 保持原有行为。
- 串行化跨进程凭据刷新，恢复已确认死亡的刷新占用和中断迁移残留，改善令牌过期、丢失刷新响应、存储修复后的恢复。
- 修复 dsh web 环境中 Host 控制/Relay WebSocket 附带错误 Origin 导致自部署 Server 拒绝连接的问题；浏览器 Origin 校验保持不变。
- 新增 Host 有界日志存储及设置中的调试日志抽屉；改进上传错误、会话目录事件同步和连接诊断。

### 安装与升级

- 建议同时升级 App 和 Remote Host 到 0.6.5；旧 Host 0.6.4 不能提供本轮完整的 DS-Bot 群聊历史和新上传能力。
- Harness 支持时，从 npm 安装的 Remote 可在本机 Desktop 弹窗内升级；GitHub / 本地安装保留发布页入口。远程连接仍不能替换拥有该连接的 Remote 插件。
- 新增独立的 `ds-harness-remote-tui` 同版本组合包，供 Harness 0.2.2-rc.1 TUI profile 安装；同一 profile 只启用一个 Remote Host entry。
- Node.js 要求仍为 >=24.9。**升级或降级前停止所有 Harness 进程，并备份 profile 与凭据目录。** V2 凭据刷新队列的迁移、支持范围和降级步骤见[集成文档](https://github.com/liguobao/ds-harness-remote/blob/v0.6.5/docs/plugin-integration.md)。
- npm 发布失败时，不再由 TUI 发布步骤阻断后续 GitHub Release 与 Android APK 发布；失败的 npm 包需单独重试。

### 验证范围

- MIX 4 + haru（Harness 0.2.2-rc.1、DS-Bot 0.3.6）：Bot 创建、模型选择、单聊、群聊完整回复与重启恢复、终端、文件预览/下载、2 MiB 上传及哈希校验通过。见[真机记录](https://github.com/liguobao/ds-harness-remote/blob/v0.6.5/docs/android-haru-verification.md)。
- 异步长压缩、断线恢复与取消已有跨设备 Relay 验收；LAN 原生上传已有隔离认证上下文的两次 200 MiB 哈希验收。这些测试不能等同于所有账号登录、网络路径和设备组合均已覆盖。
- 真实 dsh-TUI 0.20.1 / Harness 0.2.2-rc.1 已在 haru 与 Android 72 间通过会话、双向消息、文件、终端和 App 重启恢复验收；见 [TUI 验收记录](docs/tui-haru-verification.md)。iOS、电脑控制、真实审批和全部提醒流程尚未完整验收。离线冷启动后恢复网络，部分场景仍需手动刷新主机列表并选择 Host。

## English

**v0.6.5 · Android build 72 · November 15, 2026**

### Android and DS-Bot

- Align Host forwarding with DS-Bot 0.3.6; improve live cards, settings subpages and draft synchronization.
- Restore all group members' replies through bounded history projections and authoritative Host reads instead of partial caches. Live replies, history and restoration after an App restart passed device testing.
- Keep Bot forms above the keyboard, scroll the entire form in short windows, and improve large-text, dark-mode and orientation handling.
- Keep Agent drafts editable offline while blocking sending; retain drafts after reconnect without automatically sending them.
- Refine screen/sheet transitions, the conversation drawer, chat typography, color palettes, syntax highlighting and activity components. Fix confirmation-button cancellation and duplicate blank conversations.
- Add Russian, Ukrainian and DS-Bot settings translations.

### Uploads and workspace files

- Fix remote image uploads from Harness Desktop and embedded IDE clients while retaining official Session attachment receipts. Support ordinary files over HTTP / IDE RPC and add file/image selection to the standalone VS Code extension.
- Restore Android photo capture and support video/binary uploads from gallery and file pickers.
- Accelerate binary files of at least 1 MiB over an authenticated Noise/TCP WebSocket when the selected path is LAN and native support is available. Other paths, small files, older Hosts and clients without the native module retain their existing transport. Started uploads are never replayed on another channel.
- Accept in-workspace absolute file paths through the Host's trusted workspace alias while continuing to reject traversal and internal symlinks.

### Compaction, recovery and diagnostics

- Track asynchronous compaction independently of ordinary RPC deadlines; resume observation of the same operation after reconnect and confirm cancellation through the actual lifecycle. Older Hosts retain their existing behavior.
- Serialize credential refresh across processes and improve recovery from dead refresh owners, interrupted migration, expired access tokens and lost refresh responses.
- Fix dsh web Host control/Relay sockets sending an incorrect Origin to self-hosted Servers without weakening browser Origin checks.
- Add bounded Host log storage and a settings debug-log drawer; improve upload errors, event-driven session catalogues and diagnostics.

### Upgrading and validation

- Upgrade both App and Remote Host to 0.6.5 for the new upload features and complete DS-Bot group history.
- Supported Harness installations can update an npm-installed Remote from its local Desktop dialog. GitHub/local installs retain the release link; a remote peer cannot replace its owning Remote plugin.
- Add the matching standalone `ds-harness-remote-tui` bundle for Harness 0.2.2-rc.1 TUI profiles. Enable only one Remote Host entry per profile.
- Node.js >=24.9 remains required. **Stop every Harness process and back up profile/credential storage before upgrading or downgrading.** See the [integration guide](https://github.com/liguobao/ds-harness-remote/blob/v0.6.5/docs/plugin-integration.md).
- TUI npm publishing failures no longer block subsequent GitHub Release and Android APK publication; retry failed npm publication separately.
- MIX 4 / haru acceptance covered Bot creation, model selection, chat, complete group history after restart, terminal, file preview/download and a hash-verified 2 MiB upload. Separate records cover cross-device Relay compaction and isolated, hash-verified 200 MiB LAN uploads.
- Real dsh-TUI 0.20.1 / Harness 0.2.2-rc.1 on haru passed Android 72 session, bidirectional messaging, file, terminal and App-restart recovery checks; see [TUI acceptance](docs/tui-haru-verification.md). Complete iOS, computer-control, approval and scheduling coverage remains pending. Recovery from an offline cold start may still require refreshing the Host list and selecting a Host.
