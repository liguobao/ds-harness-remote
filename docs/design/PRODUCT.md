# DSH Remote 产品定位

产品能力与版本范围分别由根 README 和兼容性文档维护。

## 用户与目标

面向在工作电脑或服务器运行 Harness / CodeX / Cursor / Antigravity / Pi / OpenCode / Claude / Hermes，并希望从另一台电脑、手机或浏览器继续工作的人。
Host 保留工作目录、Agent 运行环境与会话数据，Client 提供安全入口和操作界面；会话不迁移到 Client。

Remote Plugin 同时提供常驻 Host 和本地 Remote 工作区入口。用户选择同账号 Host、后端和工作区后继续会话，无需切换 Client 模式。
Desktop 复用 Harness 原生 UI；Android 提供适合移动端的工作区、会话、聊天和工具界面。

## 产品能力

- 同账号设备发现、身份固定与端到端加密连接。
- Harness 官方会话、文字/图片 Prompt、历史、模型、权限与审批。
- 可选 CodeX App Server 和 Cursor / AGY / Pi / OpenCode / Claude / Hermes ACP 后端，通过独立数据面展示其会话。
- 后端支持范围内的只读工作区文件与交互终端；明确授权的本机开发服务预览。
- Android 工作区收藏、最近会话快捷入口、跟随系统及英、简中、繁中、日、西、德、法、俄、乌克兰语与浅色/深色主题。
- 终端授权通过独立 CLI 提供；dsh-TUI Host 使用同版本独立 `ds-harness-remote-tui` 组合包，见[安装说明](../../packages/tui/README.md)。
- 后端设置保存后热更新，工作区可用性由实际就绪状态决定。

CodeX 默认开启、Cursor 默认关闭；其他 ACP 后端以 Host 配置和实际就绪状态为准。
原生终端默认开启，loopback 端口默认未授权。以上默认值不能代替账号、identity 或 capability 校验。

## 仓库边界

本仓库实现 Plugin、Android、VS Code、Browser Launcher、共享包、最小自部署 Server 和互操作工具。
最小 Server 是单账号、文件持久化实现，可配置 WebRTC LAN/P2P/TURN 与加密 Relay，不提供 Remote Web 会话界面、独立 Relay attach/resume 或多账号。
完整多账号 Server、Remote Web、Admin 与其基础设施在独立仓库维护。

CodeX 和 ACP 只在 Client 内存中投影 Workspace / Session / Chat，不写 DSH SessionStore、Workspace 数据库或 Harness 日志。
文件树和预览只读；终端以 Host 用户权限运行，独立于 Agent 审批。AGY 图片仅写专用私有 tmp 缓存。独立 `workspace.upload.v1` 可向 Host 验证的当前会话工作区根上传文件；官方 `workspace/create` 可创建缺失的 Harness 工作区目录。两者不扩展为通用文件系统 RPC，CodeX Project 仍只注册已有目录。

## 设计原则

1. 会话优先，Host、工作区和连接状态始终可辨认。
2. 复用官方业务契约与用户熟悉的界面；每个后端保持自己的数据所有权。
3. 显示真实连接、能力与就绪状态；不可用后端不能静默降级到其他后端。
4. 审批采用单次允许或拒绝，清楚区分 Agent 审批、终端输入权和 Host 本地访问设置。
5. 文件路径、会话归属和连接身份在 Host 校验，Client 展示状态不能授予权限。
6. 错误给出可执行的恢复步骤，避免将内部异常作为主要文案。

## 视觉与可访问性

界面采用清晰的文字层级、蓝色主要操作、克制的状态颜色和浅色/深色主题，具体 token 见[设计系统](DESIGN.md)。
连接和权限状态同时使用文字、图标或选中标记，不仅靠颜色。提供按钮名称、焦点反馈、系统字体缩放和键盘适配；
TalkBack、IME、大字体和原生设备效果仍需实际验证，不能将设计目标写成已达成的可访问性认证。

## 当前状态依据

功能和使用见[README](../../README.md)，安全边界见[协议](../protocol.md)，验收缺口见[TODO](../TODO.md)。
实验性后端和已实现的工具入口仍需各自的跨设备与长期稳定性验收。


### Android Bot 模式（2026-10-22）

主机工作区标题栏「＋」左侧为 Bot 入口，Bot 模式右上角三点菜单左侧为工作区切换图标，首页三点按钮复用首页操作菜单（设备、设置、关于、检查更新），新建 Bot / 群聊通过对应分区旁的「＋」进入。Bot 模式使用独立的原生
团队页和对话页：主 Bot 卡片、团队与群聊列表，以及 Bot/群聊创建和管理。对话保留官方
Harness 历史、流式内容与审批，DS Bot 问答/交互卡片用原生控件展示，通过固定 Bot 接口提交。
模式切换仅影响本机导航，按服务器、账号、主机及固定身份记住 Agent/Bot 选择，再次进入主机或重启 App 后恢复；主机未启用 ds-bot 或 Remote 缺少能力时展示错误，不显示本地或
其他主机数据。DS-Bot 管理与电脑操作通过固定路由进入认证后的上游 handler 校验；不开放任意 endpoint。

## 用户路径

1. 在 Desktop 插件管理或指定 profile 安装 Remote；TUI 使用独立组合包。
2. Host 授权加入账号，Client 使用独立身份登录并选择在线 Host；授权方式取决于 Server 支持。
3. 固定 Host 身份并建立加密通道，选择 capability 与就绪状态同时满足的后端和工作区。
4. 打开或新建会话，使用该后端支持的消息、模型、审批、文件和终端。
5. 断线保留所选 Host authority，离线操作失败；恢复重新读取状态，不重放 mutation。退出 Remote 才回到 Local。

后端设置只热更新变化的进程与能力；其他后端及 Harness 连接保留。Remote 连接不得修改拥有自身的插件访问设置或替换其组合包。
