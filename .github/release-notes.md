## 中文

**v0.6.4 · Android build 71**

- 新增 DS Bot 0.3.0 多会话、群聊、Agent 标识、设置子页、日程联动和电脑端安装指引。
- 新增离线会话秒开、缓存阅读、工作区快捷创建、主机切换和连接诊断。
- 改进 DSH-Go 配对、二维码、登录布局、服务地址编辑和账号标签。
- 修复超大会话目录、损坏身份恢复、重连与自部署 Server 刷新恢复问题。
- 新增 Windows Codex CLI 发现，统一发布 bundle 路径并补充 Issue 模板与许可证。
- 明确 Remote 自身的 DSH 0.2.2 插件页在线更新入口：npm 安装可检查版本并更新，热更新失败时由 DSH 尝试恢复旧版；GitHub / 本地 link 安装需先切换至 npm。
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
- 优化服务限流提示与连接恢复，更新 Android 和插件图标。
- 自部署 Server 支持行内修改设备名称；修复登录后需手动刷新的问题、前端路由刷新时的 404，并让 HTML 入口重新校验缓存以获取部署更新。

感谢择梦舟（@dreamfarer-space）、@bluesmilery、@ltmroberthk915、@stubborn726、@vccddd、Jerry Yu（@idealistichacker）、Pcject Jiang（@Pcject）和玄安（@Sakura7301）为本版本贡献功能、修复与体验改进，也感谢所有反馈问题和参与测试的用户。

## English

**v0.6.4 · Android build 71**

- Add DS Bot 0.3.0 conversations, groups, agent badges, settings subpages, schedules and desktop installation guidance.
- Add offline session instant-open, cached reading, direct workspace creation, host switching and connection diagnostics.
- Improve DSH-Go pairing, QR sign-in, login layouts, editable server addresses and account labels.
- Fix oversized session catalogues, corrupt identity recovery, reconnect handling and self-hosted refresh recovery.
- Add Windows Codex CLI discovery, normalize release bundle paths, and add issue templates and the repository license.
- Document online updates for Remote itself in DSH 0.2.2 Plugin management: npm installations can check versions and update, with DSH attempting to restore the previous version after a failed hot update; GitHub and local link installations must switch to npm first.
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
- Improve rate-limit messages and connection recovery, and refresh the Android and plugin icons.
- Self-hosted Server: support inline device renaming, redirect immediately after sign-in, fix page refreshes on frontend routes, and revalidate the HTML entry so deployed updates reach existing clients.

Thanks to @dreamfarer-space, @bluesmilery, @ltmroberthk915, @stubborn726, @vccddd, Jerry Yu (@idealistichacker), Pcject Jiang (@Pcject), and @Sakura7301 for the features, fixes, and usability improvements in this release, and to everyone who reported issues and helped test it.
