# HarmonyOS 客户端架构与版本管理指南 (`apps/harmony`)

> **分支定位**：`feat/harmony-android-parity` 基于上游 `upstream/main`（`liguobao/ds-harness-remote`）维护，目标是将 HarmonyOS 原生客户端（`apps/harmony/`）对齐 Android 客户端（`apps/android/`）的全部核心能力，同时保持对上游主干零侵入、可平滑合并、可拆 PR 回馈上游。

---

## 一、目录隔离与模块化设计

1. **零侵入原则**：本次全部修改严格收敛在 `apps/harmony/` 目录内，不修改 `packages/`、`apps/android/` 或根目录构建配置。
2. **新增能力优先独立成模块**，仅在 `AppRuntime.ets`、`Index.ets` 与 `I18n.ets` 做最薄接入点，最大限度降低未来 `merge upstream/main` 时的冲突面：
   - **网络与协议层（`entry/src/main/ets/net/`）**：
     - `TransferCodec.ets`：`DIRECT_REMOTE_CALL_BYTES = 2MB` / `TRANSFER_CHUNK_BYTES = 512KB` 分片传输编解码与 Base64URL 工具
     - `SessionToolsClient.ets`：`workspaceFiles/*`、`officeToPdf/render`、`job/*`、`terminal/*`、`permissionPresets/*`、`skills/*`、`commands/*`、`agentPresets/*`、`messageFeedback/*`、`fileUploads/upload`、`workspace.upload.*`、`schedule/*`、`pluginManager/*`、`settings/*`、`session/updateQueue`
     - `CodexClient.ets`：`codex.*` RPC 与流式事件（history/create/prompt/interrupt/respond/models）
     - `AcpClient.ets`：`agent.acp.*` 流式事件归约与多后端支持（`cursor` / `antigravity` / `claude` / `opencode` / `pi` / `hermes`）
     - `BotClient.ets`：`plugin.route.call`（`route: 'api/bot'`）DS-Bot 团队状态、`/btw` 旁白路由与用量统计
   - **服务与纯逻辑工具层（`services/` & `util/`）**：
     - `BackendsRouter.ets`：统一编排 Harness / Codex / ACP 多后端列表、建模与会话生命周期
     - `TerminalAnsi.ets`：VT100 / ANSI 转义序列轻量屏幕缓冲与扩展快捷键条
     - `SyntaxHighlight.ets`：多语言代码语法高亮分词器（TS/JS/Python/Go/Rust/JSON/Shell）
     - `MentionAndQuote.ets`：`@`/`/` 自动补全、消息引用解析、LaTeX/TeX 数学排版与 Markdown 块解析（代码/Mermaid/表格/公式）
     - `UiArtifacts.ets`：Intelligent UI（`ui_render` / `ui_patch` / `ui_compose` / `ui_render_widget`）版本投影、`UiActionGuard` 节流防重放校验
   - **原生 ArkUI 组件层（`entry/src/main/ets/components/`）**：
     - `RichMessageView.ets`：代码高亮卡片、TeX 数学块、横向滚动 Markdown 表格
     - `WorkspaceFilesSheet.ets`：工作区文件浏览器、多格式文件上传、分页代码预览、图片查看与 PDF/Office Preview
     - `TerminalSheet.ets`：多标签远程交互式终端与特殊按键工具栏
     - `ProductivitySheets.ets`：活动中心（后台任务+日志 / 待办 / 子智能体 / 排队插话）与主机插件/设置中心
     - `IntelligentUiCard.ets`：Intelligent UI 声明式组件树与 DS-Bot `BotInteractiveViewCard` 原生渲染器
     - `BotModeView.ets`：DS-Bot 团队工作台（Bot/群聊切换、`/btw`、Inbox 问答审批视图、`@` 提及、成员/群聊新建、用量统计）

---

## 二、日常同步上游与版本管理工作流

### 1. 拉取并合并上游更新 (`upstream/main`)
```bash
git fetch upstream
git checkout feat/harmony-android-parity
git merge upstream/main
```
**合并冲突处理原则**：
- 若 `Index.ets` / `AppRuntime.ets` 因上游新增功能出现少量冲突：保留新增模块化组件调用行（位于独立 `@Builder` 或独立方法），其余交由组件文件承载。
- 合并后务必依次执行全量校验：
```bash
corepack pnpm exec vitest run apps/harmony/tests
node apps/harmony/scripts/check-i18n.mjs
node apps/harmony/scripts/bump-version.mjs --check
node apps/harmony/scripts/build-local-api21.mjs
```

### 2. 向原项目上游提交 PR（分特性 Cherry-Pick）
本分支按里程碑严格拆分为独立、可审查的原子提交，可直接 `cherry-pick` 单个特性到干净的 PR 分支：
- **M1 协议与工具通道**：`56c0e351`
- **M2 富文本气泡、引用/提及、文件附件与后台通知**：`ffea154e`
- **M3 文件浏览器/Office转PDF、远程终端、活动中心、插件设置、定时任务创建**：`664fd6f1`
- **M4 Codex + ACP 多后端路由与切换栏**：`68b7884c`
- **M5 DS-Bot 模式与 Intelligent UI 原生卡片**：`6d8bc83e`

### 3. 本地 API 21 构建 vs 上游 API 26 构建说明
- **仓库跟踪配置**：`apps/harmony/build-profile.json5` 与 `AppScope/app.json5` 保留上游默认设置（API 26 / `io.github.liguobao.dshremote`），不在 Git 提交中硬改包名或签名。
- **本地真机调试构建**：
  1. `apps/harmony/build-profile.local.json5`（已列入 `.gitignore`）保存本地 API `6.0.1(21)` 与本机调试签名 Profile（不进入仓库）。
  2. 运行 `node apps/harmony/scripts/build-local-api21.mjs` 会临时切换本地清单并调用 DevEco `hvigorw assembleHap`，完成后在 `finally` 块自动恢复所有被跟踪的配置文件，确保工作区零脏改动、零密钥泄露。
- **已知局部兼容性微调**（提交 `4227ee9a`，对 API 26 同样兼容）：
  - `ServerApi.ets` 使用 `'PATCH' as http.RequestMethod` 避免 SDK 枚举缺失报错
  - `Index.ets` 通过 `@kit.CoreFileKit` 将 Base64 PDF 写入沙箱临时文件后交给 `pdfController.loadDocument(path)`
