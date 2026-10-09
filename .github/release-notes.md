## 中文

- **Harness 0.2.1 适配**：更新开发基线，保留 `0.2.0-rc.2`，并接纳后续 `0.2.2` RC；legacy ApiProxy 不再作为兼容维护目标。
- **限时问答与 Mods**：固定官方问答和 Claude Code Mods 入口；Android 支持认领限时问题、显示剩余时间，并从 Host 投影恢复继续中的问题，不重放回答。
- **状态与 Android 稳定性**：保留 Web 反向代理前缀；修复 Cursor / Antigravity 活动分组、消息顺序、完成/中断/失败状态和保存提示词布局。

Plugin 与 Android 均为 **0.5.1**（Android `versionCode 40`）。Cursor / AGY 需在 Host 安装对应 CLI 并登录；终端遵循 Host 本地开关。

## English

- **Harness 0.2.1 support:** updates the development baseline, retains `0.2.0-rc.2`, and admits future `0.2.2` RC versions; legacy ApiProxy is no longer a compatibility maintenance target.
- **Timed questions and Mods:** adds fixed official question and Claude Code Mods endpoints; Android claims timed questions, shows remaining time, and restores continued questions from Host projections without replaying replies.
- **Status and Android stability:** preserves Web reverse-proxy prefixes and fixes Cursor / Antigravity activity grouping, message ordering, completion/interruption/failure states, and saved-prompt layout.

Upgrade both Plugin and Android to **0.5.1** (Android `versionCode 40`). Install and authenticate the Cursor / AGY CLI on the Host; terminals follow its local setting.

### 致谢 / Thanks

- [@zzalancelot](https://github.com/zzalancelot)：Cursor ACP Host 接入、Desktop / Android 会话支持与流式回复。Cursor ACP integration, Desktop / Android sessions, and streaming replies.
- [择梦舟 / @dreamfarer-space](https://github.com/dreamfarer-space)：Android 引用与消息操作、新对话与轨迹入口、快捷提示词管理及输入栏直达（[#89](https://github.com/liguobao/ds-harness-remote/pull/89)、[#91](https://github.com/liguobao/ds-harness-remote/pull/91)、[#94](https://github.com/liguobao/ds-harness-remote/pull/94)）。Android references and message actions, new-conversation and trajectory controls, and saved prompts accessible from the composer.

---

[安装说明](https://github.com/liguobao/ds-harness-remote/blob/main/README.zh.md#安装) · [Installation](https://github.com/liguobao/ds-harness-remote/blob/main/README.md#install) · [完整改动 / Changelog](https://github.com/liguobao/ds-harness-remote/compare/v0.5.0...v0.5.1)
