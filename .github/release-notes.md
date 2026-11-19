# v0.6.6

Android versionCode **74** · iOS buildNumber floor **74**

## 中文

- **iOS 与鸿蒙** · iOS 客户端代码已开源，与 Android 共享会话和消息功能，支持 iPad。原生鸿蒙客户端已合入主分支，支持 WebRTC 与加密中继、会话历史、流式消息和工作区浏览。
- **移动端** · Android 和 iOS 可从主机详情试用主机上的原生 DSH Web，需同步升级 Remote Host，且服务器已启用该功能。会话忙碌时可排队发送或插话，也可以将已排队的消息插入当前对话。Android、iOS 和鸿蒙的设置页可查看会员状态，并改善主机列表、新建对话和 PDF 阅读体验。
- **远程连接** · 移动端恢复直连优先，Android 和 iOS 可查看当前中继节点。改善 WebRTC 与中继切换，无 TURN 的自建服务可更快回落到中继。Desktop 可在支持的 Gateway 上并行准备直连和备用 TURN，Host 可尝试通过公网 IPv6 或 Tailscale IPv4 直连。
- **ACP 与 Codex** · 支持接入自定义 stdio ACP 后端，扩展模式和权限选项。Antigravity 优先使用原生 ACP，保留旧适配器作为回退。改善 ACP 长会话历史、工作区文件引用和 Windows 上的后端启动，恢复 Claude ACP 一键安装。Codex 重连后可补齐流式回复，思考过程可折叠查看。
- **Harness 与 Desktop** · 适配 DSH Desktop 0.2.2-rc.5，远程终端列表实时更新，原生工作区可按文件名或路径搜索。新增跨机器复制会话历史的 Host API，供客户端接入。对齐 DS-Bot 0.3.8 远程操作，并支持 Host 启用的官方思考过程翻译插件。
- **稳定性** · 修复移动端会话列表冷启动崩溃、草稿恢复、截图上传、ACP 图片预览和流式回复重复显示。改善长会话历史加载并隐藏废弃空白会话，修复远程压缩取消或超时后阻塞后续请求，以及配对 Host 退出授权后无法登录的问题。

## English

- **iOS and HarmonyOS** · The iOS client is open source, shares session and messaging features with Android, and supports iPad. The native HarmonyOS client is now on the main branch, with WebRTC, encrypted Relay, session history, streaming, and workspace browsing.
- **Mobile** · Android and iOS can try the Host’s native DSH Web from Host details. This requires an updated Remote Host and a Server with DSH Web enabled. Queue messages during a busy session or use a new or queued message to steer the active turn. Android, iOS, and HarmonyOS show membership status in Settings and improve the Host list, new conversation flow, and PDF viewer.
- **Remote connections** · Mobile clients prefer direct connections again. Android and iOS show the active Relay node. Switching between WebRTC and Relay is more reliable, and self-hosted Servers without TURN fall back to Relay sooner. On supported Gateways, Desktop prepares direct and standby TURN connections in parallel. Hosts can attempt direct connections over public IPv6 or Tailscale IPv4.
- **ACP and Codex** · Register custom stdio ACP backends and use expanded mode and permission controls. Antigravity prefers native ACP with the legacy adapter as a fallback. This release improves long ACP session history, workspace file mentions, and backend startup on Windows, and restores one-click Claude ACP installation. Codex fills in missing streamed updates after reconnecting and displays reasoning in collapsible blocks.
- **Harness and Desktop** · Support DSH Desktop 0.2.2-rc.5 with live remote terminal lists and file search by name or path in native workspaces. New Host APIs let clients integrate cross-machine session history copying. Remote operations align with DS-Bot 0.3.8, and Remote supports the official reasoning translation plugin when enabled on the Host.
- **Reliability** · Fix a mobile session-list crash on cold start, draft recovery, screenshot uploads, ACP image previews, and duplicate streamed replies. Improve long-session history loading and hide abandoned blank sessions. Fix remote compaction requests getting stuck after cancellation or timeout, and restore Host sign-in after logging out of device pairing.

## 升级说明 / Upgrade notes

- 建议 App 与 Remote Host 同步升级到 0.6.6。Node.js 要求仍为 >=24.9。升级或降级前先停止所有 Harness 进程并备份 profile 与凭据。 [集成指南](https://github.com/liguobao/ds-harness-remote/blob/main/docs/plugin-integration.md)
- Upgrade the app and Remote Host together. Stop all Harness processes before upgrading or downgrading. Node.js >=24.9 remains required.
- iOS 通过 Xcode Cloud 签名与分发；未签名的 HarmonyOS HAP 需签名后才能安装。鸿蒙保留独立版本号与功能边界，见[鸿蒙说明](https://github.com/liguobao/ds-harness-remote/blob/main/docs/harmony-client.md)。

## 贡献者 / Contributors

感谢 / Thanks to [@vccddd](https://github.com/vccddd), [@Mangoman2008](https://github.com/Mangoman2008), [@PYH0809](https://github.com/PYH0809), [@dreamfarer-space](https://github.com/dreamfarer-space), [@AIchanKimi](https://github.com/AIchanKimi), [@luojiyin1987](https://github.com/luojiyin1987), [@gcnyin](https://github.com/gcnyin), [@greatcorrectandglory](https://github.com/greatcorrectandglory), [@liguobao](https://github.com/liguobao)，以及所有提交问题、协助复现和参与验证的朋友。

特别感谢 @vccddd 推进 iOS 与共享应用代码，@Mangoman2008 实现鸿蒙客户端，@PYH0809 改进传输升级与历史投影；也感谢其他贡献者对 ACP、Codex、上传与 Android 体验的持续修复。
