## English

- Adds Cursor and AGY workspaces with independent backend identifiers and the authenticated `agent.acp.*` API. Desktop/Web use memory-only UI projections; Android supports AGY conversation discovery, history, and image prompts.
- Adds structured workspace type declarations while preserving existing Harness and CodeX capabilities and transports. New clients check both negotiated capabilities and workspace readiness.
- Applies backend switches immediately, turns unavailable switches off, and cancels initialization when a backend is disabled.
- Fixes AGY project scoping for encoded directory names and similarly named projects, confines transcript reads to the AGY brain directory, and rejects stale history or streams after navigation.
- Retains existing Harness version detection, Session V3/legacy transport selection, encrypted Relay/WebRTC channels, and Android recovery behavior.
- Updates the Plugin and Android app to `0.5.0`; Android `versionCode` is `39`.
- Cross-device AGY, native APK/Windows, and independent Remote Web deployment acceptance remain separate from local validation.

## 中文

- 新增 Cursor 与 AGY 工作区，使用独立后端标识和已认证的 `agent.acp.*` API。Desktop/Web 使用内存 UI 投影；Android 支持 AGY 会话发现、历史和图片 Prompt。
- 新增结构化工作区类型声明，保留既有 Harness 与 CodeX 能力和传输协议。新客户端同时校验已协商能力与工作区就绪状态。
- 后端开关立即生效，不可用开关显示关闭；关闭后端时取消正在进行的初始化。
- 修复编码目录名和相似项目路径的 AGY 会话归属，限制 transcript 读取范围，并防止切换会话后的迟到历史或订阅覆盖当前会话。
- 保留既有 Harness 版本探测、Session V3/legacy 数据面选择、Relay/WebRTC 加密通道及 Android 会话恢复行为。
- Plugin 与 Android App 升级至 `0.5.0`，Android `versionCode` 为 `39`。
- AGY 跨设备、原生 APK/Windows 以及独立 Remote Web 部署验收仍需另行完成。

[Full changelog / 完整改动](https://github.com/liguobao/ds-harness-remote/compare/v0.4.27...v0.5.0) · [Installation / 安装说明](https://github.com/liguobao/ds-harness-remote/blob/v0.5.0/README.md)
