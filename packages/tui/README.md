# ds-harness-remote-tui

DeepSeek Harness TUI 的独立 Remote Host 组合包，复用同版本 `ds-harness-remote` 的认证、加密传输和 Host runtime，并装配官方 Remote API。

在 TUI profile 的插件管理中安装 `ds-harness-remote-tui`。使用 `ds-harness-remote` CLI 登录和查看状态；命令用法见 `ds-harness-remote --help`。需要 Node.js >=24.9 和 Harness 0.2.2-rc.1。

同一 profile 仅启用一个 Remote Host entry；不要同时启用 Desktop Remote entry，也不要让多个进程共用同一设备身份。首次启动会检查官方 Remote event source，缺失时拒绝启动。

本包随仓库 `v*` release 与主包保持相同版本并发布 npm。真实 TUI / Android 跨设备验收尚待完成。

## npm 自动发布配置

首次发布需要 npm 包所有者的发布权限。为本包配置 Trusted Publisher：选择本仓库的 GitHub owner/repository，workflow 文件名为 `release.yml`（不填路径）。此配置独立于主包，需要单独设置；没有该配置时 CI 的 OIDC 发布会失败。后续更新版本时，同时更新本包 version 与 `dependencies.ds-harness-remote` 的 workspace 版本。
