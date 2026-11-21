# v0.6.7

Android versionCode **75** · iOS buildNumber floor **75**

## 中文

- 在主机详情打开 DSH Web 时，客户端可通过局域网直连。打开时若 Host 找不到可用的本机监听地址，支持隧道的客户端会通过 Host 提供的隧道继续打开。
- 支持需要二次验证的密码登录，可输入验证码或恢复码。Android 和 iOS 改善了平板抽屉和弹窗的布局。
- Codex 会话重连后可恢复消息流并补齐截断的回复。移动端改善 Antigravity 权限选择、历史图片和命令菜单，Desktop 可预览会话消息中的文件附件。

## English

- Open DSH Web directly over the LAN from the Host details screen. If the Host loses its local listening address during opening, clients can continue through the tunnel advertised by the Host.
- Password sign-in supports verification and recovery codes. Android and iOS improve drawer and dialog sizing on tablets.
- Codex sessions recover streams and fill in truncated replies after reconnecting. Mobile clients improve Antigravity permission selection, historical images, and command menus. Desktop can preview files attached to chat messages.

## 升级说明 / Upgrade notes

建议将客户端和 Remote Host 一同升级到 0.6.7。Host 需要 Node.js >=24.9。升级或降级前，请停止所有 Harness 进程并备份 profile 和凭据。[集成指南](https://github.com/liguobao/ds-harness-remote/blob/main/docs/plugin-integration.md)

Upgrade the client and Remote Host together. The Host requires Node.js >=24.9. Stop all Harness processes and back up profiles and credentials before upgrading or downgrading.

iOS 通过 Xcode Cloud 签名与分发。GitHub Release 提供的鸿蒙 HAP 需要签名后安装到真机。[鸿蒙客户端说明](https://github.com/liguobao/ds-harness-remote/blob/main/docs/harmony-client.md)

## 贡献者 / Contributors

gcnyin、liguobao、luo jiyin、vcd、择梦舟。
