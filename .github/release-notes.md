## 中文

**0.5.13** 新增 Android 扫码登录与平板双栏，修复 OpenCode v1/v2 接入和异步标题恢复，并提供 Host 加密工作区文件上传能力。所有自有包与客户端版本均为 **0.5.13**，发布 Tag 为 **v0.5.13**。Android `versionCode` 从 **51** 升至 **57**，跳过 **52–56**；Expo iOS `buildNumber` 同步为 **57**。

- **Android 扫码登录**：点击「扫码登录」后才请求 Server provider 并本地渲染同源二维码，大屏显示更大的二维码；保留知乎/GitHub 浏览器 OAuth 与邮箱密码登录。领取一次性 token 后立即停止轮询，避免成功登录被后续“二维码过期”状态覆盖；离开扫码页或更换 Server 时作废旧会话。
- **平板双栏**：聊天页在宽度 ≥760 dp 且高度 ≥520 dp，或宽度 ≥1000 dp 时，左侧常驻分组会话列表，右侧展示消息与输入栏；切换会话只更新右侧内容。窄屏与较短的手机横屏窗口保持单栏。
- **OpenCode v1/v2 兼容**：启动前检测 CLI 支持的网络参数；支持时保留认证私有监听器，否则使用纯 stdio ACP。v1 保留原生归档；v2 归档明确提示不可用，会话发现、历史与模型选择保持可用。参数检测失败或不完整时拒绝启动。
- **OpenCode 标题恢复**：接收 ACP 标题更新，回复完成后最多二十秒重读列表；原生标题尚未生成时临时使用首条提问。历史恢复该临时标题，旧读取和占位标题不能覆盖新标题或手动改名。
- **Host 工作区上传**：新增独立加密 `workspace.upload.v1`，单文件最大 20 MiB，只能写入当前会话经 Host 验证的工作区根目录。同名文件自动改名、不覆盖已有文件；分块、连接/会话隔离、取消与断线清理均受限。不接受客户端目标路径；独立 Remote Web 的上传界面与部署需单独同步。

### 验证与待验收范围

本地全仓类型检查、**713 个测试**、生产构建（含 Android Hermes export）、DSH bundle 校验与版本一致性核对通过。发布工作流再次执行检查与构建，并生成 Android Release APK。已有本机验证覆盖 Android QR 合约、模拟 800×1280 dp 真机窗口的双栏切换，以及官方 OpenCode `1.19.3`（`opencode-ai`）和 `2.0.32`（`@opencode/cli`）的会话发现/恢复与 v2 模型切换；两版 CLI 未发送 Prompt。真实平板/折叠屏、扫码端到端、文件上传跨设备与独立 Remote Web 部署仍待验收。Metro 的 `@noble/hashes/crypto.js` package exports fallback 已知警告仍存在。

## English

**0.5.13** adds Android QR sign-in and tablet split view, fixes OpenCode v1/v2 startup and asynchronous titles, and adds encrypted workspace file uploads on the Host. All first-party package and client versions are **0.5.13**, matching tag **v0.5.13**. Android `versionCode` advances from **51** to **57**, skipping **52–56**; Expo iOS `buildNumber` is also **57**.

- **Android QR sign-in:** tapping **Sign in with QR code** requests Server providers and locally renders a same-origin QR code, enlarged on large screens. Zhihu/GitHub browser OAuth and email/password remain available. Polling stops when the one-time token is claimed so a later expired state cannot overwrite successful sign-in; leaving the view or changing Servers invalidates the old session.
- **Tablet split view:** at ≥760 dp wide and ≥520 dp high, or ≥1000 dp wide, the grouped session list stays on the left while messages and the composer occupy the right. Selecting a conversation updates the right pane. Narrow screens and shorter phone landscape windows keep one pane.
- **OpenCode v1/v2 compatibility:** startup probes supported CLI network options, keeping the authenticated private listener where supported and using stdio-only ACP otherwise. Native archive remains available on v1 and fails explicitly on v2; session discovery, history and model selection remain available. Failed or partial probes fail closed.
- **OpenCode title recovery:** ACP title updates and bounded catalog retries for up to twenty seconds after completion recover asynchronous native titles. The first user message supplies a temporary title, including after history restoration; stale reads and placeholders cannot overwrite newer or manually renamed titles.
- **Host workspace uploads:** independent encrypted `workspace.upload.v1` accepts files up to 20 MiB only within the current session's Host-verified workspace root. Publication renames conflicts without overwriting; chunks, connection/session ownership, cancellation and disconnect cleanup are bounded. Clients cannot choose destination paths. The independent Remote Web upload UI and deployment require a separate update.

### Validation and acceptance limits

Local workspace type checks, **713 tests**, production builds (including Android Hermes export), DSH bundle validation and version consistency checks pass. The release workflow repeats checks and builds, then generates the Android Release APK. Existing local validation covers Android QR contracts, split-view switching on a real device at a simulated 800×1280 dp window, and session discovery/recovery plus v2 model selection with official OpenCode `1.19.3` (`opencode-ai`) and `2.0.32` (`@opencode/cli`); neither CLI validation sent a Prompt. Real tablets/foldables, end-to-end QR scanning, cross-device uploads and the independent Remote Web deployment still require acceptance. The known Metro `@noble/hashes/crypto.js` package exports fallback warning remains.

---

[安装说明](https://github.com/liguobao/ds-harness-remote/blob/v0.5.13/README.zh.md#安装) · [Installation](https://github.com/liguobao/ds-harness-remote/blob/v0.5.13/README.md#install) · [完整改动 / Full changelog](https://github.com/liguobao/ds-harness-remote/compare/v0.5.12...v0.5.13)
