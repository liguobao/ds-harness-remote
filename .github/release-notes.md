## English

`0.5.0` adds experimental Cursor and Antigravity (AGY) remote workspaces and improves the Android conversation experience.

- **Cursor and AGY workspaces:** discover Host projects, create conversations, stream replies, interrupt generation, and handle approvals through the authenticated `agent.acp.*` channel. Desktop and browser clients connected to a local Harness reuse its native UI with memory-only projections; Android supports both backends. AGY also restores existing conversations and history and accepts image prompts. Cursor currently accepts text prompts.
- **Files and Terminal for ACP:** Cursor and AGY conversations can browse and read workspace files and use remote terminals when the Host advertises these capabilities. File access stays inside the Host-confirmed session directory; terminals respect the Host's local Remote terminal setting and existing device ownership rules.
- **Live AGY model selection:** model and reasoning choices come from the installed `agy models` catalog and apply to the same conversation after Host confirmation. The catalog is cached per running backend, and switching models avoids starting a redundant CLI process.
- **Backend settings take effect immediately:** CodeX, Cursor, and AGY have separate switches. Saving changes updates the affected backend without restarting DSH or interrupting other backends. Unavailable switches stay off, and disabling a backend cancels pending startup.
- **Android composer and conversation actions:** adds `/` commands, `@` references with official blue icons, message actions, a new-conversation button, and a trajectory view. Saved prompts are available directly beside the composer's `+` button; built-in prompt edits, deletions, and custom entries persist locally.
- **More reliable conversation recovery:** improves Android process folding and completion/interruption/error states, restores sessions and streams after reconnect, refreshes AGY titles after replies, and discards late history or subscriptions when switching conversations. AGY project matching handles encoded directory names and keeps transcript reads inside its brain directory.
- **Compatibility and packaging:** preserves Harness/CodeX capability discovery, Harness version detection, Session V3/legacy carriers, and encrypted Relay/WebRTC transports. Structured workspace types distinguish backend support from readiness. Plugin bundles are reproducible across pnpm dependency layouts, and the self-hosted Server now serves `/health` and `/ready` aliases for client health checks.
- **Versions:** Plugin and Android `0.5.0`; Android `versionCode 39`.

Upgrade the Host plugin and Android app together to use the new ACP features. Install the plugin with:

```bash
dsh plugin --profile web add -w ds-harness-remote@0.5.0
```

The main-branch CI passed type checks, tests, production builds, npm packaging, and Android APK packaging. AGY encrypted cross-device E2E, Windows and native-device acceptance, and integration with the independently deployed Remote Web remain pending. Cursor and AGY require their CLI to be installed and authenticated on the Host.

### Thanks

Thanks to [@zzalancelot](https://github.com/zzalancelot) for the foundational Cursor ACP integration, and [择梦舟 (@dreamfarer-space)](https://github.com/dreamfarer-space) for the Android conversation improvements in [#89](https://github.com/liguobao/ds-harness-remote/pull/89), [#91](https://github.com/liguobao/ds-harness-remote/pull/91), and [#94](https://github.com/liguobao/ds-harness-remote/pull/94).

## 中文

`0.5.0` 新增实验性的 Cursor 与 Antigravity（AGY）远程工作区，并改进 Android 对话体验。

- **Cursor 与 AGY 工作区：**通过已认证的 `agent.acp.*` 通道发现 Host 项目、新建会话、接收流式回复、中断生成及处理审批。Desktop 和连接本机 Harness 的浏览器通过内存投影复用原生界面，Android 同时支持两个后端。AGY 还支持恢复已有会话与历史、发送图片 Prompt；Cursor 当前仅支持文字 Prompt。
- **ACP 文件与终端：**当 Host 声明对应能力时，Cursor 与 AGY 会话可以浏览和只读预览工作区文件、使用远程终端。文件访问限定在 Host 确认的会话目录内；终端遵循 Host 本地 Remote 终端开关及既有设备归属规则。
- **AGY 实时模型选择：**模型与推理选项来自本机安装的 `agy models`，经 Host 确认后应用到同一会话。模型目录按运行中的后端缓存，切换模型时避免重复启动 CLI 进程。
- **后端设置立即生效：**CodeX、Cursor、AGY 分别控制，保存后仅更新受影响的后端，无需重启 DSH，也不打断其他后端。不可用的开关保持关闭；关闭后端时取消尚未完成的启动。
- **Android 输入与对话操作：**新增 `/` 命令、带官方蓝色图标的 `@` 引用、消息操作、新建对话按钮及轨迹视图。快捷提示词入口位于输入栏 `+` 按钮旁；内置提示词的编辑、删除和自定义条目均在本地持久保存。
- **更可靠的会话恢复：**改进 Android 过程折叠及完成、中断、错误状态，重连后恢复会话与订阅，AGY 回复后刷新标题，切换会话时丢弃迟到的历史与订阅结果。AGY 项目匹配支持编码目录名，历史读取限定在其 brain 目录内。
- **兼容性与打包：**保留 Harness/CodeX 能力探测、Harness 版本识别、Session V3/legacy 数据面及 Relay/WebRTC 加密传输。结构化工作区类型区分后端支持与实际就绪状态；Plugin bundle 在不同 pnpm 依赖布局下保持一致；自部署 Server 新增 `/health`、`/ready` 别名，兼容客户端健康检查。
- **版本：**Plugin 与 Android 均为 `0.5.0`，Android `versionCode 39`。

使用新增 ACP 功能时，请同步升级 Host 插件与 Android App。插件安装命令：

```bash
dsh plugin --profile web add -w ds-harness-remote@0.5.0
```

主分支 CI 已通过类型检查、测试、生产构建、npm 打包和 Android APK 打包。AGY 加密跨设备 E2E、Windows 与原生真机验收、独立部署的 Remote Web 接入仍待完成。使用 Cursor 和 AGY 前，需在 Host 安装对应 CLI 并完成登录。

### 致谢

感谢 [@zzalancelot](https://github.com/zzalancelot) 贡献 Cursor ACP 基础集成，以及 [择梦舟（@dreamfarer-space）](https://github.com/dreamfarer-space) 在 [#89](https://github.com/liguobao/ds-harness-remote/pull/89)、[#91](https://github.com/liguobao/ds-harness-remote/pull/91)、[#94](https://github.com/liguobao/ds-harness-remote/pull/94) 中贡献 Android 对话体验改进。

[Full changelog / 完整改动](https://github.com/liguobao/ds-harness-remote/compare/v0.4.27...v0.5.0) · [Installation / 安装说明](https://github.com/liguobao/ds-harness-remote/blob/v0.5.0/README.md)
