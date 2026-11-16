# Android Guide for Agents

本文件定义 `apps/android` 的移动端专属常青规范；仓库全局边界、协议、测试政策与文档约束见根目录 [`AGENTS.md`](../../AGENTS.md)。

- **Expo SDK 57**：当前使用 `expo ~57.0.x`、`react 19.2.x`、`react-native 0.86.x`，涉及 Expo API 先核对 <https://docs.expo.dev/versions/v57.0.0/>。
- **运行形态**：
  - 因依赖 `react-native-webrtc` 与本地原生模块，**不可使用 Expo Go**，须用 Development Build 或原生 APK。
  - Release APK 内嵌 JS bundle，验收前必先核对包装形态。

## 构建、检查与离线渲染器

- 修改共享包后先在根目录执行 `pnpm --filter './packages/**' -r build`，再跑 `@dsh-remote/android` 的 `check`、`test`、`build` 或 `android`。
- `build:renderers` 生成忽略目录 `src/generated/` 下的 4 类离线 WebView 产物（`terminal`、`pdf`、`mermaid`、`intelligent-ui`）。
- `check` 与 `test` 均会自动串联 `build:renderers` 与 `verify:workspace`；严格只读勘察请在隔离副本运行或直接调用 `vitest run`。
- CI Release APK 通过 `DSH_REQUIRE_INTELLIGENT_UI=true` 校验固定提交的 Intelligent UI 渲染器。
- **离线渲染安全边界**：
  - 数学公式由 `mathjax-full` 本地生成 SVG（[`math-svg.ts`](src/ui/math-svg.ts)）。
  - Mermaid（`mermaid@12.2.0`）经禁网严格 CSP 隐藏 WebView 渲染后，须按白名单正则重建元素与属性再交给 `react-native-svg`（防非法属性闪退 Android 原生）。
  - 含 `foreignObject` 图表仅走 `javaScriptEnabled={false}` 全屏查看。
  - PDF 限单页画布只读预览（禁脚本、外链与明文缓存）；预览上限：图片 8 MiB、PDF 16 MiB、Office 源 50 MiB。

## 原生模块、后台连接与外部导航

- **原生代码位置（改动后必须重建 APK）**：
  - [`with-remote-foreground-service.js`](plugins/with-remote-foreground-service.js) 与 [`remote-foreground-service/`](plugins/remote-foreground-service)：提供前台服务 `RemoteForegroundService`、下载、ProcessText、原生逐帧键盘高度同步 `RemoteKeyboardInsetsModule`（`DshRemoteKeyboardInsets`）及通知多语言资源。
  - [`modules/remote-transport/`](modules/remote-transport)：提供 `RemoteWebSocketBinary`（单帧 ≤65,535 字节），供 `workspace.upload.lan.v1` 二进制直传避免 JS Base64 转码。
- **前台服务与链路恢复**：
  - `RemoteForegroundService` 与 `PARTIAL_WAKE_LOCK` 按连接代次串行隔离，仅在连接及后台最多 3 次自动重连期间持有。
  - 已建链每 25s 及回前台执行加密 `harness.transport.describe`（5s 超时）；旧代次回调禁停新连接，断线禁重放 Prompt、审批或终端输入。
  - 不得把通知存在等同于息屏持续联网（受系统 Doze 与厂商冻结限制）。
- **外部导航与认证入口**：
  - 外部会话打开经独立 `externalOpenRevision` 解锁抽屉、切回 Agent 模式并关闭 Host 切换层；未知 Host/Session 须显式报错横幅，不回退连接其他设备。
  - 扫码登录限点击触发、校验同源 `/api/v1/auth/` 并于 `complete` 后立即停止轮询。
  - 客户端不接入 DSH-Go 配对链接（OAuth 回调限 `dshremote://oauth`）。

## 会话架构、离线草稿、动效与多语言

- **数据面与附件**：
  - 仅接官方 Typert、`codex.app.*`、`agent.acp.*` 与 `plugin.route.call`（已移除早期 ApiProxy）。
  - Harness 图片发送完整 `ImageAttachmentRef`；Markdown 工作区图片仅复用授权 `workspaceFiles` 内存预览（不读手机本地路径，外部 HTTP 图不自动联网）。
  - 活动坞（待办/目标/`job/list|follow`）按当前 `sessionId` 只读订阅并在切换时取消。
- **聊天模块与离线草稿门禁**：
  - [`chat-screen.tsx`](src/screens/chat-screen.tsx) 负责页面编排；输入区与菜单分别位于 [`composer.tsx`](src/screens/chat/composer.tsx) 与 [`action-menu.tsx`](src/screens/chat/action-menu.tsx)。
  - 附件、消息投影、滚动、提及、快捷提示词与返回键分别由 `chat/use-chat-{attachments,transcript,scroll,mentions,prompts,back-handler}.ts` 管理。
  - 输入可编辑性由 [`composer-gate.ts`](src/screens/chat/composer-gate.ts) 的 `composerEditable` 控制（仅权限切换与上传中锁定，与 `connected` 解耦）。
  - 断线发送由 `submitIntent` 判 `'offline'` 保留草稿不清空；store 侧 `sendMessage` 在插 `local:` 乐观行前对非 `connected` 返回 `'rejected'`（禁走禁止回填草稿的 `'kept'`）。
  - `browse-memory` 按 Server/账号/Host identity 隔离保存加密草稿、收藏、阅读位置与最近记录。
  - 不持久化对话正文、审批句柄或待发队列；Bot 模式草稿仅存组件内存。
- **DS-Bot 与 `vendor/ds-bot`**：
  - `BotRemoteClient` 绑定连接代次，打开会话须经同 Host Bot state 与官方 Session catalog 核对（禁建虚拟持久化会话）；`/btw` 失败不退回普通 Prompt。
  - 卡片纯原生声明式渲染（禁执行模型 HTML/JS）；[`vendor/ds-bot/`](src/vendor/ds-bot) 保留上游原样与 Apache-2.0。
  - 取消统一检查 `signal.aborted`（兼容 RN `AbortSignal`）。
- **动效、响应式与 9 语言**：
  - 弹层与切换使用 [`motion.ts`](src/ui/motion.ts) 令牌（含 reduced-motion 降级）与 [`SheetModal`](src/ui/sheet.tsx)（遮罩淡入 + 不透明面板位移 + 退场保末次快照）。
  - [`responsive.ts`](src/ui/responsive.ts) 适配自动旋转与宽屏双栏（≥760 dp 条件启用内联 `HostSessionsDrawer`）。
  - 新增或修改界面文案须同步更新 [`src/locales/`](src/locales) 全部 9 套语言（与 `app.json` 一致），渲染时按 key 读取。
