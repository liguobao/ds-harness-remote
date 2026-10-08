## 中文

- **新增 Cursor / AGY 工作区**：支持远程对话、流式回复与中断；AGY 支持历史恢复和图片 Prompt。
- **文件、终端与模型**：Cursor / AGY 接入只读文件和远程终端；AGY 支持实时切换模型与推理选项，减少重复启动。
- **Android 体验升级**：新增 `/` 命令、`@` 引用、消息操作、新对话与轨迹视图；快捷提示词可直接打开、发送和编辑。
- **稳定性改进**：后端开关立即生效，优化会话恢复与断线重连，修复历史串入、项目路径匹配及打包兼容问题。

Plugin 与 Android 均为 **0.5.0**（Android `versionCode 39`），建议同步升级。Cursor / AGY 需在 Host 安装对应 CLI 并登录；终端遵循 Host 本地开关。

CI 与发布构建已通过。AGY 加密跨设备、Windows / 真机及独立 Remote Web 接入仍待验收。

## English

- **Cursor / AGY workspaces:** remote conversations, streamed replies, and interruption; AGY also supports restored history and image prompts.
- **Files, terminals, and models:** read-only files and remote terminals for Cursor / AGY; live AGY model and reasoning selection with less redundant startup.
- **Android improvements:** `/` commands, `@` references, message actions, new conversations, trajectory view, and direct access to saved prompts.
- **Reliability:** live backend switches, better session and reconnect recovery, and fixes for stale history, project matching, and package compatibility.

Upgrade both Plugin and Android to **0.5.0** (Android `versionCode 39`). Install and authenticate the Cursor / AGY CLI on the Host; terminals follow its local setting.

CI and release builds passed. AGY encrypted cross-device E2E, Windows / native-device acceptance, and independent Remote Web integration remain pending.

### 致谢 / Thanks

[@zzalancelot](https://github.com/zzalancelot) · [择梦舟 / @dreamfarer-space](https://github.com/dreamfarer-space)

---

[安装说明](https://github.com/liguobao/ds-harness-remote/blob/main/README.zh.md#安装) · [Installation](https://github.com/liguobao/ds-harness-remote/blob/main/README.md#install) · [完整改动 / Changelog](https://github.com/liguobao/ds-harness-remote/compare/v0.4.27...v0.5.0)
