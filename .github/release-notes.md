## 中文

**v0.6.3 · Android build 71**

- 适配 DeepSeek Harness `0.2.2-rc.1`：远程会话图片按新的附件引用契约重新可用，CodeX/ACP 会话的实时状态更新适配新的投影帧，新增的轨迹原始结果、自动化任务编辑与第三方插件更新界面可通过 Remote 使用。同时保留并已验证 Harness `0.2.1-rc.5` 兼容。
- 要求 Node.js `>=24.9`（与 Harness 0.2.2 一致）；Linux 安装器改为安装 Node.js 24.9.0。
- 修复 Harness 0.2.2 上转发事件流因缺少调用 owner Peer 而触发 Desktop 客户端重连循环的问题。
- Host bundle 内联运行时依赖；本地路径 link、手工复制或生成式安装等不携带包依赖的场景不再因 `Cannot find package 'ws'` 而加载失败。
- 本版本仅发布浏览器/Desktop Host；移除 dsh-TUI 集成并在后续版本单独提供，因此不再注册终端 `/remote` 命令和终端专用 Host entry。
- Remote 启动时不再自动禁用同名的第三方 `dsh-remote` 插件；只自动迁移自有的 `@dsh-remote/plugin` 旧名。若旧的本地安装使用裸名，请确认其来源后再手动禁用。
- Harness 插件页新增 Remote 设置快捷入口；ACP 后端支持一键安装与自动扫描配置，Hermes 支持图片消息，并修复 OpenCode 取消通知。
- Android 支持离线 Mermaid 图表、Bot 模式 Intelligent UI、后台任务日志与终止操作，并将子任务和智能体团队整合为可折叠活动停靠区。
- Android 新增自动化任务管理与表单创建、锁屏实时任务通知与会话深链、工作区分组和会话手动排序、消息全屏编辑；优化选词引用、任务卡片与会话抽屉导航。
- 修复重连后原生工作区与会话订阅无法恢复的问题；Client 授权失效时提示重新登录，完善断线状态与连接租约倒计时。
- 改善 WebRTC 回退与移动端重连，控制连接中断时保留已建立的数据连接；升级 werift 至 0.26.0，原生 WebRTC 优先使用 Harness 随附的 Node runtime。
- 修复文件预览越权读取工作区外文件的问题；串行创建身份，避免并发启动导致公私钥不匹配。
- 自部署 Server 新增可选 LAN/P2P/TURN 信令协调与 coturn 短期凭据签发。按需配置 `DSH_SERVER_STUN_URLS`、`DSH_SERVER_TURN_URLS` 与 `DSH_SERVER_TURN_SECRET`；未配置 ICE 时保持 Relay-only 行为。
- 自部署 Server 支持受信任反向代理后的客户端 IP 限流、可配置握手超时与结构化连接诊断。
- 将 HTTP 429 识别为可重试的限流错误，保留设备凭据；Host 控制通道以 `4007` 关闭时保留已建立的数据连接。
- 自部署 Server 支持行内修改设备名称；修复登录后需手动刷新的问题、前端路由刷新时的 404，并让 HTML 入口重新校验缓存以获取部署更新。

感谢择梦舟（@dreamfarer-space）、@bluesmilery、@ltmroberthk915、@stubborn726、@vccddd、Jerry Yu（@idealistichacker）、Pcject Jiang（@Pcject）和玄安（@Sakura7301）为本版本贡献功能、修复与体验改进，也感谢所有反馈问题和参与测试的用户。

## English

**v0.6.3 · Android build 71**

- Support DeepSeek Harness `0.2.2-rc.1`: remote session images load again with the new attachment reference contract, CodeX/ACP sessions keep live state updates with the new projection frames, and the newly added Trajectory raw results, automation editing and third-party plugin update surfaces work over Remote. Harness `0.2.1-rc.5` remains supported and validated.
- Require Node.js `>=24.9`, matching Harness 0.2.2. The Linux installer now provisions Node.js 24.9.0.
- Fix a Harness 0.2.2 reconnect loop caused by opening the forwarded Remote event stream without a calling owner Peer.
- Inline the Host bundle's runtime dependencies, so installations that do not carry the package's runtime dependencies (local-path links, manual copies and generated installs) no longer fail to load with `Cannot find package 'ws'`.
- Ship the browser/Desktop Host surface only: dsh-TUI integration is removed from this release and returns in a later version, so the plugin no longer registers a terminal `/remote` command or a terminal-only Host entry.
- Preserve other plugins named `dsh-remote` when Remote starts. Only the owned `@dsh-remote/plugin` legacy name is disabled automatically; if an older local installation used the bare name, check its origin before disabling it manually.
- Add a shortcut to Remote settings on the Harness Plugins page, plus one-click installation and configuration scanning for ACP backends; support image prompts for Hermes and fix OpenCode cancellation notifications.
- Android: render Mermaid diagrams offline, support Intelligent UI in Bot mode, add Background Jobs logs and termination, and group subtasks and agent teams in a collapsible activity dock.
- Android: add automation management and form-based creation, lock-screen live task notifications with session deep links, workspace grouping and manual session ordering, and fullscreen message editing. Refine text selection, task cards and session drawer navigation.
- Restore native workspace/session subscriptions after reconnect; surface expired Client authorization with a sign-in prompt and improve outage status and lease countdowns.
- Improve WebRTC fallback and mobile reconnection, preserve established data connections during control-channel outages, upgrade werift to 0.26.0, and prefer the Harness-bundled Node runtime for native WebRTC.
- Fix file preview access outside the authorized workspace and serialize identity creation to prevent mismatched key pairs during concurrent startup.
- Self-hosted Server: add optional LAN/P2P/TURN signaling coordination and short-lived coturn credentials. Configure `DSH_SERVER_STUN_URLS`, `DSH_SERVER_TURN_URLS` and `DSH_SERVER_TURN_SECRET` as needed; deployments without ICE configuration retain Relay-only behavior.
- Self-hosted Server: support client-IP rate limits behind a trusted reverse proxy, configurable handshake timeouts and structured connection diagnostics.
- Treat HTTP 429 as a retryable rate limit without clearing device credentials; keep established Host data connections when the control channel closes with code `4007`.
- Self-hosted Server: support inline device renaming, redirect immediately after sign-in, fix page refreshes on frontend routes, and revalidate the HTML entry so deployed updates reach existing clients.

Thanks to @dreamfarer-space, @bluesmilery, @ltmroberthk915, @stubborn726, @vccddd, Jerry Yu (@idealistichacker), Pcject Jiang (@Pcject), and @Sakura7301 for the features, fixes, and usability improvements in this release, and to everyone who reported issues and helped test it.
