## 中文

**v0.6.4 · Android build 71**

### Android 与 DS Bot

- 对齐 DS Bot 0.3.0，支持多会话分段、本地 Agent 标识、队列过滤和关闭状态留存。
- 新增 DS Bot 详情页、浏览器页、13 项全局设置、设置子页与日程联动。
- 新增 Bot 会话、群聊、成员管理和引用对话，未安装 DS Bot 时显示电脑端安装指引。
- 支持离线会话秒开、主机离线时读取缓存历史、会话抽屉直接创建工作区和远程主机切换。
- 改进 Codex 会话标题、空会话重连提示、聊天活动展示、侧栏导航和工作区层级。
- 新增设备发现诊断日志、连接日志导出、错误横幅和设置诊断页。
- 支持按偏好选择 LAN、P2P、TURN 和 Relay 传输，并补齐传输说明与图标。

### 配对与登录

- 新增 DSH-Go Host 单次配对流程，并将配对入口整合到登录页签。
- 新增紧凑配对二维码、倒计时和取消操作，优化扫码指引与按钮布局。
- 支持编辑服务地址，改进账号标签、密码提示和非 DeepSeek 账号说明。
- 完成 Host-only 登录流程，移除不必要的 provider 重试。

### 稳定性与恢复

- 超大会话目录先按 workspace 和 subagent 过滤并限制行数，避免 Remote 列表整体失败。
- 修复损坏身份、旧凭据目录迁移、重置恢复和并发创建身份时的边界问题。
- 修复控制连接重连、已销毁链路延迟包限流和 WebSocket hello 超时处理。
- 自部署 Server 在刷新成功响应丢失时恢复后继凭据，不撤销仍有效的账号授权。
- 修复会话图片跨版本加载、空会话图标和文件预览授权边界。

### 工具与兼容性

- 新增 Windows Codex Desktop CLI 发现。
- 继续兼容 Harness 0.2.2-rc.1 与 0.2.1-rc.5，补齐 Remote 会话、附件和事件帧兼容处理。
- 修复 Harness 0.2.2 owner Peer 缺失导致的事件流重连循环。
- 升级 werift 至 0.26.0，改进 WebRTC、TURN 和 Relay 回退行为。

### Server 与发布工程

- 自部署 Server 支持可选 LAN/P2P/TURN 信令协调、短期 coturn 凭据、反向代理 IP 限流和握手诊断。
- 支持行内修改设备名称、登录后跳转、前端路由刷新和 HTML 入口缓存重新校验。
- Host bundle 内联运行时依赖，改善本地 link、手工复制和生成式安装。
- 统一发布 bundle 路径，新增中英文 Issue 表单与仓库许可证。

感谢 @dreamfarer-space、@bluesmilery、@ltmroberthk915、@jinnian0703、@joeatgp，以及所有参与评审、测试、反馈问题和改进文档的贡献者。

## English

**v0.6.4 · Android build 71**

### Android and DS Bot

- Align with DS Bot 0.3.0 with segmented multi-session views, local Agent badges, queue filtering and retained closed states.
- Add DS Bot profile and browser pages, 13 global settings, settings subpages and schedule integration.
- Add Bot conversations, group chats, member management and referenced conversations, with desktop installation guidance when DS Bot is unavailable.
- Add offline session instant-open, cached history while a Host is offline, direct workspace creation from the session drawer and remote Host switching.
- Refine Codex titles, empty-session reconnect prompts, chat activity, sidebar navigation and workspace hierarchy.
- Add device discovery diagnostics, connection-log export, error banners and a diagnostics settings page.
- Support LAN, P2P, TURN and Relay transport preferences with clearer copy and icons.

### Pairing and sign-in

- Add the single-attempt DSH-Go Host pairing flow and integrate pairing into sign-in tabs.
- Add compact pairing QR, countdown and cancel actions, with improved scan guidance and controls.
- Allow editing the service address and improve account labels, password hints and non-DeepSeek account guidance.
- Complete the Host-only sign-in flow and remove unnecessary provider retries.

### Stability and recovery

- Filter oversized session catalogues by workspace and subagent before applying row limits, preventing complete Remote list failures.
- Fix corrupt identity handling, legacy credential migration, reset recovery and concurrent identity creation.
- Fix control reconnects, rate limiting of delayed packets on destroyed links and WebSocket hello timeout handling.
- Recover successor credentials when a self-hosted Server loses a successful refresh response without revoking still-valid account authorization.
- Fix cross-version session image loading, empty-session icons and file-preview authorization boundaries.

### Tools and compatibility

- Discover the Windows Codex Desktop CLI.
- Maintain Harness 0.2.2-rc.1 and 0.2.1-rc.5 compatibility, including Remote session, attachment and event-frame handling.
- Fix the Harness 0.2.2 reconnect loop caused by a missing owner Peer on forwarded event streams.
- Upgrade werift to 0.26.0 and improve WebRTC, TURN and Relay fallback behavior.

### Server and release engineering

- Add optional LAN/P2P/TURN signaling, short-lived coturn credentials, reverse-proxy client-IP rate limits and handshake diagnostics to the self-hosted Server.
- Add inline device renaming, post-login redirects, frontend route refresh support and HTML entry cache revalidation.
- Inline Host bundle runtime dependencies for local links, manual copies and generated installations.
- Normalize release bundle paths and add bilingual issue forms and the repository license.

Thanks to @dreamfarer-space, @bluesmilery, @ltmroberthk915, @jinnian0703, @joeatgp, and everyone who contributed through reviews, testing, issue reports and documentation improvements.
