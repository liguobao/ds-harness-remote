# v0.6.8

Android versionCode **76** · iOS buildNumber floor **76** · HarmonyOS versionCode **1000227**

## 中文

- **会话接力与代码审查** · 在手机上可把当前会话交给另一个智能体继续处理。Codex 支持从完整会话或指定轮次创建分支。审查工作区 Git diff 时，可选中具体改动让智能体返工。文件卡片支持打开 officeKit 文档预览，PDF 可全屏连续阅读。
- **待处理收件箱** · 集中查看待审批、待回答和已完成未读的会话。Codex 和 ACP 可在短暂断线时保留审批请求。
- **实时任务** · Android 任务通知可显示当前阶段、运行时长和并行任务数，连接通知可显示当前主机和工作区。iOS 锁屏实时活动与灵动岛可显示任务阶段、计时和待处理数量，点按即可打开收件箱。
- **移动端会话** · 从会话顶栏可将会话加入工作区，也可搜索当前对话并跳转到匹配内容。抽屉和会话切换更流畅，超长用户消息支持分页阅读。切换会话时会取消旧的 ACP 历史读取，其他设备占用实时流时仍可打开历史。改善 OpenCode 长会话加载和 Antigravity 交互，并修复语音转写超时过短的问题。
- **Host 与连接** · 通过 npm 安装的 Host 可在缺少可选 Connection 包时加载。适配 DSH 0.2.3 预发布版，修复控制路由不可用时的文件上传回退。连接异常后避免重复执行写操作。重置 Host 身份也会清除旧配对策略，并提示重启 DSH。Android 加速接收消息的解密，iOS 接入原生 CryptoKit 加解密。
- **设备与客户端** · 自部署 Server 支持从账号设备列表撤销设备。移动端可从会员入口查看套餐，DSH Web 页脚可关闭。
- **鸿蒙** · 改进会话顶栏和文档预览。在支持 Git 审查的 Host 上，可查看工作区文件状态和差异。切换服务器时若无法清除旧凭据，客户端会保留原服务器地址。升级会移除旧版保存的明文账号令牌，能确认归属的当前登录会保留，其余情况需重新登录。

## English

- **Agent handoff and code review** · Pass a conversation’s context to another agent from your phone. In Codex, fork the entire conversation or branch from a specific turn. Review workspace Git diffs and select specific changes for the agent to rework. Open officeKit document previews from file cards and scroll through PDFs in full screen.
- **Attention inbox** · Find pending approvals, unanswered questions, and completed sessions with unread updates in one place. Codex and ACP can keep approval requests pending across brief disconnects.
- **Live tasks** · Android task notifications show the current phase, elapsed time, and number of concurrent tasks. Connection notifications can show the current Host and workspace. On iOS, Live Activities show task phases, timers, and pending counts on the Lock Screen and Dynamic Island. Tap to open the inbox.
- **Mobile conversations** · Use the chat header to add a conversation to a workspace or search the conversation and jump to a match. Switching sessions and opening the drawer are smoother. Read long user messages in pages. Switching sessions cancels the previous ACP history request, and history remains accessible when another device owns the live stream. This release also improves long OpenCode sessions and Antigravity interactions and gives speech transcription more time to finish.
- **Host and connections** · The npm-installed Host now loads when the optional Connection package is absent. The Host supports DSH 0.2.3 prereleases and falls back to local file uploads when the control route is unavailable. Connection failures no longer cause the gateway to replay writes. Resetting the Host identity also clears its old pairing policy and prompts you to restart DSH. Android accelerates incoming message decryption, and iOS uses native CryptoKit encryption and decryption.
- **Devices and clients** · Revoke a device from the self-hosted Server’s account device list, open membership plans from mobile, and dismiss the DSH Web footer.
- **HarmonyOS** · Improved chat header controls and document previews. View changed files and diffs on Hosts that support Git review. If the app cannot clear the previous credentials, it keeps the existing server address. Upgrading removes account tokens saved in plaintext by older releases. Your current account stays signed in when the app can verify which server and account own the credentials. Otherwise, sign in again.

## 升级说明 / Upgrade notes

建议将客户端和 Remote Host 一同升级到 0.6.8。Host 升级或降级前，请停止所有 Harness 进程并备份 profile 和凭据。[集成指南](https://github.com/liguobao/ds-harness-remote/blob/v0.6.8/docs/plugin-integration.md)

Upgrade the client and Remote Host together. Before upgrading or downgrading the Host, stop all Harness processes and back up its profiles and credentials.

iOS 通过 Xcode Cloud 签名与分发。若要覆盖安装鸿蒙客户端，请用原安装包的签名证书签署 Release 中的鸿蒙 HAP。

iOS uses Xcode Cloud for signing and distribution. To update an existing HarmonyOS installation, sign the release HAP with the same signing identity used for the installed app. [HarmonyOS guide / 鸿蒙客户端说明](https://github.com/liguobao/ds-harness-remote/blob/v0.6.8/docs/harmony-client.md)

## 贡献者 / Contributors

感谢 / Thanks to [@dreamfarer-space](https://github.com/dreamfarer-space), [@gcnyin](https://github.com/gcnyin), [@vccddd](https://github.com/vccddd), [@abworks-dev](https://github.com/abworks-dev), [@abd1rahmane](https://github.com/abd1rahmane), [@gongfpp](https://github.com/gongfpp), [@xy2404907917-ship-it](https://github.com/xy2404907917-ship-it), [@chenjianli1994](https://github.com/chenjianli1994), [@liguobao](https://github.com/liguobao)。
