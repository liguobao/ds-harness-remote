# v0.6.8

Android versionCode **76** · iOS buildNumber floor **76**

## 中文

- **会话接力与代码审查** · 在手机上可把当前会话的上下文交给另一个智能体继续处理，也可查看工作区 Git diff，选中具体改动让智能体返工。文件卡片支持打开 officeKit 文档预览，PDF 可全屏连续阅读。
- **待处理收件箱** · 集中查看待审批、待回答和已完成未读的会话。Codex 和 ACP 可在短暂断线时保留审批请求。iOS 锁屏实时活动与灵动岛可显示主机任务计数，点按即可打开收件箱。
- **移动端会话** · 改善抽屉和会话切换的流畅度，超长用户消息支持分页阅读。切换会话时会取消旧的 ACP 历史读取，其他设备占用实时流时仍可打开历史。改善 OpenCode 长会话加载和 Antigravity 交互，并修复语音转写超时过短的问题。
- **Host 与连接** · 通过 npm 安装的 Host 可在缺少可选 Connection 包时加载。适配 DSH 0.2.3 预发布版，修复控制路由不可用时的文件上传回退。连接异常后避免重复执行写操作。Android 加速接收消息的解密，iOS 接入原生 CryptoKit 加解密。
- **设备与客户端** · 自部署 Server 支持从账号设备列表撤销设备。移动端可从会员入口查看套餐，DSH Web 页脚可关闭。鸿蒙改进服务器切换、会话顶栏、文档预览和工作区审查页面。

## English

- **Agent handoff and code review** · Pass a conversation’s context to another agent from your phone. Review workspace Git diffs and select specific changes for the agent to rework. Open officeKit document previews from file cards and scroll through PDFs in full screen.
- **Attention inbox** · Find pending approvals, unanswered questions, and completed sessions with unread updates in one place. Codex and ACP can keep approval requests pending across brief disconnects. On iOS, Live Activities show Host task counts on the Lock Screen and Dynamic Island. Tap to open the inbox.
- **Mobile conversations** · Switching sessions and opening the drawer are smoother. Read long user messages in pages. Switching sessions cancels the previous ACP history request, and history remains accessible when another device owns the live stream. This release also improves long OpenCode sessions and Antigravity interactions and gives speech transcription more time to finish.
- **Host and connections** · The npm-installed Host now loads when the optional Connection package is absent. Support DSH 0.2.3 prereleases and restore local file upload fallback when the control route is unavailable. Connection failures no longer cause the gateway to replay writes. Android accelerates incoming message decryption, and iOS uses native CryptoKit encryption and decryption.
- **Devices and clients** · Revoke a device from the self-hosted Server’s account device list, open membership plans from mobile, and dismiss the DSH Web footer. HarmonyOS improves server switching, session header controls, document previews, and workspace review.

## 升级说明 / Upgrade notes

建议将客户端和 Remote Host 一同升级到 0.6.8。升级或降级前，请停止所有 Harness 进程并备份 profile 和凭据。[集成指南](https://github.com/liguobao/ds-harness-remote/blob/main/docs/plugin-integration.md)

Upgrade the client and Remote Host together. Stop all Harness processes and back up profiles and credentials before upgrading or downgrading.

iOS 通过 Xcode Cloud 签名与分发。GitHub Release 提供的鸿蒙 HAP 需要签名后安装到真机。[鸿蒙客户端说明](https://github.com/liguobao/ds-harness-remote/blob/main/docs/harmony-client.md)

## 贡献者 / Contributors

感谢 / Thanks to [@dreamfarer-space](https://github.com/dreamfarer-space), [@gcnyin](https://github.com/gcnyin), [@vccddd](https://github.com/vccddd), [@abworks-dev](https://github.com/abworks-dev), [@abd1rahmane](https://github.com/abd1rahmane), [@gongfpp](https://github.com/gongfpp), [@xy2404907917-ship-it](https://github.com/xy2404907917-ship-it), [@liguobao](https://github.com/liguobao)。
