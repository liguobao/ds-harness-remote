## 中文

**v0.6.2 · Android build 70**

### 更新

- 新增 Hermes Agent 远程后端：通过其自带 ACP 服务端（`hermes acp`）接入，默认关闭、可在 Remote 设置中开启；Desktop/Android 支持工作区、历史、流式思考与工具输出、文字消息、审批与模型选择。
- 插件启动时及此后每 24 小时匿名查询 npm 最新版本（npmjs 与 npmmirror 并发竞速）；本地版本落后时，侧栏 Remote 入口、Remote 弹窗与主机列表会显示更新提示，并可直达 GitHub Releases。
- 侧栏 Remote 入口新增「标准 / 简洁」样式设置，可在设置页即时切换。
- Android 重做视觉系统：DeepSeek 黑/蓝/白配色、分组卡片列表、平滑开关与全新设置页，聊天欢迎页突出蓝鲸 Logo 与大标题。
- Android 升级会话排版与富交互组件，1:1 对齐桌面端链接语法与多态图标；接入系统原生选词引用与桌面端对齐的图标、用量面板；AI 回答中的 Markdown 链接与裸 URL 支持点击跳转。

### 修复

- 修复 Server 故障或授权响应结构异常时远程凭据无法恢复、需要重新登录的问题。
- 修复自部署 Server 心跳超时后不再自动重连的问题。
- 修复浮层弹窗被宿主容器裁剪或错位的问题，遮罩改经 body portal 渲染。
- 修复登录表单被全屏设置页覆盖的问题，改为在卡片内就地折叠展开。
- 修复 ACP 多连接同时在线时实时输出串到其他连接、单个后端失败影响其他后端的问题。
- Android 附件改为分块上传到工作区并以路径引用注入 Prompt，避免长内容撑爆输入；上传失败保留草稿，重试不重复上传。
- 升级 Intelligent UI 离线渲染器并完善 schema 兼容：组件在助手消息内联渲染、适配移动端样式与触控目标，问答选项描述正常显示。
- dsh-TUI 的补全树与场景服务改为可选降级，缺少时不再阻塞 Host 启动；重连退避从 4 秒起步。
- 适配并验证 DSH 0.2.1-rc.5。

感谢择梦舟（@dreamfarer-space）、@vccddd、@SternChiri、@bluesmilery、@luojiyin1987 的贡献。

## English

**v0.6.2 · Android build 70**

### Updates

- Add Hermes Agent as a remote backend through its built-in ACP server (`hermes acp`); opt-in via Remote settings. Desktop and Android support workspaces, history, streamed thinking and tool output, text prompts, approvals, and model selection.
- Check npm for the latest plugin version at startup and every 24 hours (npmjs and npmmirror queried concurrently). When a newer version exists, the sidebar Remote entry, the Remote dialog, and the host list show update hints linking straight to GitHub Releases.
- Add a Standard / Compact style setting for the sidebar Remote entry, switchable instantly from the settings page.
- Redesign the Android visual system with the DeepSeek black/blue/white palette, grouped card lists, smooth toggles, and a new settings page; the chat welcome screen now highlights the blue-whale logo and headline.
- Upgrade Android chat typography and rich interactive components to align 1:1 with desktop link syntax and icons; add native text-selection quoting plus desktop-aligned icons and usage panel; Markdown links and bare URLs in AI replies are now tappable.

### Fixes

- Recover remote credentials across server outages and retry unstructured gateway authorization responses instead of forcing a fresh sign-in.
- Reconnect automatically after self-hosted server heartbeat timeouts.
- Render floating dialog backdrops through a body portal so they are no longer clipped or misplaced by host containers.
- Expand the login form inline within its card instead of the full-screen settings page.
- Isolate ACP live output per connection and failures per backend.
- Offload Android attachments to the workspace via chunked upload and inject path references into prompts to prevent overflow; drafts are kept on upload failures and retries do not re-upload.
- Upgrade the Intelligent UI offline renderer for schema compatibility: components render inline within assistant turns, mobile styles and touch targets are adapted, and question option descriptions display correctly.
- Degrade missing dsh-TUI completion and scenario services optionally so Host startup is never blocked; reconnect backoff now starts at four seconds.
- Compatible with and validated against DSH 0.2.1-rc.5.

Thanks to 择梦舟 (@dreamfarer-space), @vccddd, @SternChiri, @bluesmilery, and @luojiyin1987 for their contributions.
