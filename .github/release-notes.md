# v0.6.6（待发布 / Unreleased）

Android versionCode / iOS buildNumber: **74**。此文档为发布准备，不表示已发布。

## 中文

- 适配 DSH Desktop 0.2.2-rc.5，远程会话支持终端列表实时更新，原生 Harness 工作区可按文件名或路径搜索。
- 使用官方托管服务时，可从远程工作台底栏打开会员方案页。
- 修复移动端上传截图的类型错配、ACP 会话的工作区文件引用和 Antigravity 文件上传。
- 修复 Windows 后台运行 Host 时弹出探测终端、Claude ACP 一键安装失效，以及配对 Host 退出授权后仍无法登录的问题。
- Android 在会话忙碌时可选择「排队发送」或「插话发送」，已排队的消息也可手动插入当前对话。
- Antigravity 优先使用原生 `agy acp`，保留旧版适配器作为回退。扩展 ACP 会话的模式、权限和状态显示，并支持注册使用标准 stdio ACP 的自定义后端。
- 新增跨机器复制 Harness 会话历史的 Host API。可复制单个会话或整个工作区的普通会话，导入后使用目标工作区，源 worktree 归属不随历史迁移。此能力需要客户端接入。
- Host 使用 werift 时，可利用合格的公网 IPv6 和识别到的 Tailscale IPv4 地址尝试 P2P 直连。
- 新增 iOS 客户端，与 Android 共享应用代码、会话与消息能力；支持 iPad 和多语言。iOS 签名与 TestFlight 分发由 Xcode Cloud 承担。
- 新增 HarmonyOS 原生客户端，支持登录、主机选择、会话历史与流式消息、模型与权限选择、图片及工作区浏览；支持 WebRTC 与加密中继，鸿蒙功能范围仍与 Android 有差异，HAP 签名与安装要求见客户端说明。
- 恢复移动端直连优先，兼容通过 P2P 通告 LAN 的旧 Server；Desktop 在支持的 Gateway 上并行准备直连与备用 TURN，在有界窗口内优先直连，中继回落后仍可带内升级。
- 鸿蒙修复 P2P/TURN 消息误走中继及断线发送问题，保留未发送输入，避免直连与带内升级争用 WebRTC 桥。
- 精简 Session V3 历史投影，同时保留用户消息、渲染元数据与仅由流提供的 token 用量；隐藏废弃空白会话并从搜索中排除。
- Host 路由对齐 DS-Bot 0.3.8，补齐变更审查、下载、Markdown 图片、群搜索与待办、任务操作、模型保存和密钥存储等远程调用；Host 启用官方思考过程翻译插件后可通过 Remote 使用。
- 修复 ACP 后端工作区删除后刷新或重启重新出现、流槽位泄漏、后端错误归因与禁用状态、OpenCode 归档能力及 Host carrier 隔离问题。
- 修复 Codex 远程观察结束后空闲线程未释放，以及自动回合边界丢失活动目标的问题。
- Codex 的思考内容进入可折叠的思考区。
- Android 改善 Markdown 表格列对齐、活动坞弹层底色、标题居中、输入栏稳定性与快捷提示词模式。
- 上传资源预算改为 Host 级跨连接共享，限制并发与资源占用；改善孤儿上传清理失败和配额窗口切换时的可用性。
- 修复新版 Harness 的 npm 升级资格判断，并让 Session 能力探测避免读取历史。

## English

- Support DSH Desktop 0.2.2-rc.5 with live remote terminal lists and file search by name or path in native Harness workspaces.
- Open membership plans from the Remote workspace footer when connected to the official hosted service.
- Fix image type mismatches when uploading mobile screenshots, workspace file mentions in ACP sessions, and Antigravity file uploads.
- Hide terminal windows opened by background Host probes on Windows, restore one-click Claude ACP installation, and allow Hosts to sign in after logging out of device pairing.
- Android lets you queue a message or steer the active turn while a session is busy. You can also steer with a message that is already queued.
- Prefer native `agy acp` for Antigravity with the legacy adapter as a fallback. Expand ACP mode and permission controls and session status, and support registering custom backends that use standard stdio ACP.
- Add Host APIs for copying one Harness session or the ordinary sessions in a workspace across machines. Imported sessions use the destination workspace and leave source worktree ownership behind. These APIs require client integration.
- Hosts using werift can attempt direct P2P connections over eligible public IPv6 and recognized Tailscale IPv4 addresses.
- Add an iOS client sharing application code, sessions and messaging with Android, with iPad and localization support. Xcode Cloud owns signing and TestFlight distribution.
- Add a native HarmonyOS client with sign-in, Host selection, session history and streaming, model/permission selection, images and workspace browsing over WebRTC or encrypted Relay. Feature coverage differs from Android; see the HarmonyOS guide for signing and installation requirements.
- Restore direct-first mobile connections, including older Servers advertising LAN through P2P. On supported Gateways, Desktop prepares direct and standby TURN connections concurrently and prefers direct within a bounded window. Relay fallback retains in-band upgrades.
- Keep HarmonyOS P2P/TURN messages on the RTC channel, retain unsent input while disconnected, and prevent competing RTC negotiations.
- Reduce Session V3 history projections while preserving user prompts, rendering metadata and stream-only token usage. Hide abandoned blank sessions and exclude them from search.
- Align Host routes with DS-Bot 0.3.8 for remote review, download, Markdown images, group search/to-dos, task actions, model saving and secret storage operations. Restore official chain-of-thought translation when enabled on the Host.
- Fix ACP workspace deletion persistence, stream-slot leaks, backend error attribution and disabled-backend reporting, OpenCode archive capability and Host carrier isolation.
- Release idle Codex threads after remote observers leave and retain active goals across automatic turn boundaries.
- Show Codex reasoning in collapsible reasoning blocks.
- Improve Android Markdown table alignment, activity sheets, centered titles, composer stability and quick-prompt mode.
- Share upload resource budgets across Host connections and improve availability during orphan cleanup failures and quota-window rollover.
- Recognize newer Harness registry-update eligibility and probe Session capabilities without loading history.

## 升级说明 / Upgrade notes

- 正式发布后，建议 App 与 Remote Host 同步升级到 0.6.6。Node.js 要求仍为 >=24.9；升级或降级前停止所有 Harness 进程并备份 profile 与凭据，见[集成指南](https://github.com/liguobao/ds-harness-remote/blob/main/docs/plugin-integration.md)。
- After publication, upgrade App and Remote Host together. Stop all Harness processes before upgrading or downgrading; Node.js >=24.9 remains required.
- iOS 通过 Xcode Cloud 签名与分发；未签名的 HarmonyOS HAP 需签名后才能安装。鸿蒙保留独立版本号与功能边界，见[鸿蒙说明](https://github.com/liguobao/ds-harness-remote/blob/main/docs/harmony-client.md)。

## 贡献者 / Contributors

感谢 / Thanks to [@vccddd](https://github.com/vccddd), [@Mangoman2008](https://github.com/Mangoman2008), [@PYH0809](https://github.com/PYH0809), [@dreamfarer-space](https://github.com/dreamfarer-space), [@AIchanKimi](https://github.com/AIchanKimi), [@luojiyin1987](https://github.com/luojiyin1987), [@gcnyin](https://github.com/gcnyin), [@greatcorrectandglory](https://github.com/greatcorrectandglory), [@liguobao](https://github.com/liguobao)，以及所有提交问题、协助复现和参与验证的朋友。

特别感谢 @vccddd 推进 iOS 与共享应用代码，@Mangoman2008 实现鸿蒙客户端，@PYH0809 改进传输升级与历史投影；也感谢其他贡献者对 ACP、Codex、上传与 Android 体验的持续修复。
