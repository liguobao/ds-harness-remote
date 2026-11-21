# v0.6.7

Android versionCode **75** · iOS buildNumber floor **75**

## 中文

- **DSH Web** · 可从主机详情经局域网打开主机上的 DSH Web，支持经验证的同链路 IPv6。Host 找不到可用的本机监听地址时，支持隧道的客户端可继续通过隧道打开。隧道的 WebSocket 单帧上限提高到 16 MiB。
- **登录与移动端** · 密码登录支持输入二次验证码或恢复码。Android 和 iOS 改善了平板抽屉、弹窗和 Antigravity 的权限选项、历史图片回放及命令菜单。
- **会话与连接** · Codex 会话重连后可恢复消息流并补齐截断的回复，Host 更可靠地清理 Codex 后台进程。Desktop 支持预览消息中的文件附件。自部署 Server 在计划停机时可避免将正常断开报为连接失败。
- **鸿蒙** · 更新登录、主机列表和会话页面，使常用操作与 Android 更一致。

## English

- **DSH Web** · Open the Host’s DSH Web from Host details over the LAN, including verified same-link IPv6. If the Host has no usable local listening address, clients with tunnel support can open it through the tunnel. The tunnel now supports WebSocket frames up to 16 MiB.
- **Sign-in and mobile** · Password sign-in accepts two-factor verification and recovery codes. Android and iOS improve tablet drawers and dialogs, along with Antigravity permission choices, historical image rendering, and command menus.
- **Sessions and connections** · Codex sessions resume streaming and recover truncated replies after reconnecting. The Host cleans up Codex background processes more reliably. Desktop can preview files attached to messages. Self-hosted Servers avoid reporting normal disconnects during planned shutdowns as connection failures.
- **HarmonyOS** · Updated sign-in, Host list, and conversation screens bring common workflows closer to Android.

## 升级说明 / Upgrade notes

建议将客户端和 Remote Host 一同升级到 0.6.7。Host 需要 Node.js >=24.9。升级或降级前，请停止所有 Harness 进程并备份 profile 和凭据。[集成指南](https://github.com/liguobao/ds-harness-remote/blob/main/docs/plugin-integration.md)

Upgrade the client and Remote Host together. The Host requires Node.js >=24.9. Stop all Harness processes and back up profiles and credentials before upgrading or downgrading.

iOS 通过 Xcode Cloud 签名与分发。GitHub Release 提供的鸿蒙 HAP 需要签名后安装到真机。[鸿蒙客户端说明](https://github.com/liguobao/ds-harness-remote/blob/main/docs/harmony-client.md)

## 贡献者 / Contributors

感谢本版贡献者及参与反馈和验证的朋友。Thanks to everyone who contributed changes, reported issues, or helped verify this release.

- 平板布局与 Antigravity 修复 / Tablet layouts and Antigravity fixes · [@gcnyin](https://github.com/gcnyin)
- Codex、移动端与贡献指南 / Codex, mobile fixes, and contributor guides · [@dreamfarer-space](https://github.com/dreamfarer-space)
- WebSocket 帧上限与 DSH Web 测试 / WebSocket frame limits and DSH Web tests · [@vccddd](https://github.com/vccddd)
- 自部署 Server 停机处理 / Self-hosted Server shutdown handling · [@luojiyin1987](https://github.com/luojiyin1987)
- DSH Web、登录与 Desktop 附件 / DSH Web, sign-in, and Desktop attachments · [@liguobao](https://github.com/liguobao)
