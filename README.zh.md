<p align="center">
  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="600">
</p>

<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <strong>中文</strong>
  &nbsp;·&nbsp;
  <a href="docs/README.md">文档</a>
  &nbsp;·&nbsp;
  <a href="https://dsh.r2049.cn/app">Web</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/releases/latest">Android</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/issues/20">iOS</a>
</p>

<p align="center">
  <a href="apps/server/README.zh.md">自部署</a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/ds-harness-remote">npm</a>
  &nbsp;·&nbsp;
  <a href="https://dshfind.com/zh/plugins/liguobao/ds-harness-remote?ref=badge"><img src="https://dshfind.com/api/badge/liguobao/ds-harness-remote?metric=downloads&amp;lang=zh" alt="dshfind 下载量" width="137" height="20" align="absmiddle"></a>
</p>

## 一次连接，随时可用。

从手机、电脑、浏览器继续使用你的 DeepSeek Harness 实例。

无论使用哪台设备，都可以回到同一个 Harness 会话。Harness 始终运行在工作电脑上，原有的工作区、工具和项目配置保持不变。Remote 只是通往这个工作环境的另一个窗口。

Remote 已支持 DeepSeek Harness 桌面版。手动安装时，通过 DSH 插件管理器使用这个固定版本：

`ds-harness-remote@0.5.0`

## 主要特性

- 从另一台设备继续活跃会话，查看最新进展
- 发送新指令、调整任务方向，并在 `dsh-v0.1.1-rc.2` 至 `dsh-v0.2.0-rc.2` 范围内的受支持 Harness 版本中使用图片 Prompt
- 在支持实时会话控制的客户端中回答问题、处理权限请求
- 支持 DeepSeek Harness 桌面版，并可使用固定版本的 Remote 插件
- 打开同一账号下另一台已授权电脑上的 Workspace
- 复用 Harness 原生界面，不另外维护一套桌面会话 UI
- 可将纯终端 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile 作为 Host，并通过 GitHub 或知乎终端二维码授权
- Harness 主机无需开放公网监听端口。你可以从任意可上网的地方，通过双向端到端加密链路安全连接
- 通过 Harness 原生侧栏提供工作区文件、只读预览、终端和已授权本机开发服务预览

## 安装

### 支持 DeepSeek Harness 桌面版

Remote 已支持 DeepSeek Harness 桌面版。通过下面的命令行安装方式使用这个固定版本：

`ds-harness-remote@0.5.0`

### dsh-TUI Host

将 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 作为终端 Host 的配置，请参阅
[dsh-TUI Remote 使用指南](docs/dsh-tui.md)。

### 命令行安装

通过 DSH 插件管理命令，将确切版本加入 `web` profile：

```sh
dsh plugin --profile web add -w ds-harness-remote@0.5.0
```

`-w` 表示加到 profile 自身的 workspace root；pnpm 低于 11 时不加会直接报
`ERR_PNPM_ADDING_TO_ROOT`。

安装后请重启 Harness。

不要直接用 npm 安装这个包。只有 `dsh plugin` 会更新指定 profile，并加入插件的 bundle 配置层。

### Android 客户端

从 [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) 下载最新 Android APK。

使用已有账号登录 Android 客户端，选择可用电脑并打开 Workspace，然后通过文字或图片 Prompt 继续会话。会话工具栏也可以切换当前模型，并选择该模型声明的思考程度。

点击输入栏 `+` 旁的「快捷提示词」打开已保存的提示词列表，点击条目即可发送，并可在同一面板编辑提示词。文件、终端和轨迹仍位于 `+` →「工具访问」。

### 自动安装（后台服务）

将 Remote Host 安装为后台服务。服务管理、登录、目录配置和卸载方式见[安装指南](docs/installation.zh.md)。

macOS / Linux：

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell（以管理员身份运行）：

```powershell
$installer = "$env:TEMP\install.ps1"
Invoke-WebRequest -UseBasicParsing https://dsh.r2049.cn/app/install.ps1 -OutFile $installer
& $installer
```

## 快速开始

1. 从 Harness 侧边栏打开 **Remote** 入口。
2. 使用 GitHub/知乎扫码登录，或使用账号密码登录。新的账号密码用户可从 [Remote Web](https://dsh.r2049.cn/app/register) 注册，当前邀请要求以站点页面为准。
3. Host 启动后默认允许控制当前机器，远程终端也默认开启；需要时可在详细 Remote 设置中关闭远程终端。
4. 在另一台设备上打开 DeepSeek Harness 桌面版、Remote Web 或 Android 客户端，并登录同一账号。
5. 选择在线 Host，再选择已有 Workspace 或浏览远端目录后打开。

公开服务使用托管的 Remote 中继；单账号自建可使用仓库内的[最小 Server](apps/server/README.zh.md)，其 Web 页面仅提供设备状态。

## 最小自部署 Server

仓库内的 [`apps/server`](apps/server/README.zh.md) 提供可独立运行的单账号 Relay Server。通过 `DSH_SERVER_ACCOUNT`、`DSH_SERVER_PASSWORD` 配置账号密码；Web 提供登录和设备状态。Host 与客户端填写同一 Server 地址并使用该账号登录，设备凭据在重启后保留。

## 界面截图

### 桌面端

Host 启动后默认允许控制当前设备，当前电脑即可作为 Host。远程终端默认开启，也可在详细 Remote 设置中关闭。

在另一台电脑上选择在线 Host，然后打开它的 Workspace。

<p align="center">
  <img src="docs/images/host-list.png" alt="列出在线 Host 的远端工作区选择界面" width="900">
</p>

Workspace 会在 Harness 原生界面中打开，顶部显示当前 Host 和加密连接状态。

<p align="center">
  <img src="docs/images/remote.png" alt="通过端到端加密远程连接运行的 Harness 会话" width="900">
</p>

### Android

使用已有账号登录 Android 客户端，选择可用电脑并打开 Workspace，然后通过文字或图片 Prompt 继续会话。
会话工具栏也可以切换当前模型，并选择该模型声明的思考程度。

Harness 会话的「文件」（工作区文件夹浏览、UTF-8 文本分页只读预览）和「终端」入口位于会话标题栏，需要 DSH `0.1.6-alpha.2` 或更新版本（含 `0.1.7-rc.1` 与 `0.2.0-rc.2`）的原生接口及更新后的 Remote Host 插件。远程终端默认开启，可在 Host 的详细 Remote 设置中关闭。终端面板只列出现有终端，仅标题栏「＋」才会新建；Android 从 Host 快照恢复本设备归属的终端，断线不重放输入。文件面板的返回在文件内回到所在目录，仅在根目录关闭工具，刷新同样位于标题栏。CodeX 会话不提供这些原生工具。

权限选择器兼容旧版会话内选项与新版 DSH 0.1.6 的独立 `permissionPresets/catalog`。Host Remote 插件也需要更新；不支持的 Host 会显示更新提示，不会凭空补出权限选项。

Android 文件预览还支持 PNG/JPEG/GIF/WebP 图片和 PDF；Host 提供 `officeToPdf` 时可查看 DOC/DOCX/XLS/XLSX/PPT/PPTX。二进制预览上限为 8 MiB（Office 源文件为 50 MiB）。PDF 使用本地打包的渲染器，不依赖 CDN、外部查看器或文件导出；未知二进制类型不会当作文本打开。文件访问仍只读，并由官方 Session 文件系统授权；原生真机与跨设备预览验收尚待完成。

<p align="center">
  <img src="docs/images/mobile-list.jpg" alt="Android 客户端中的在线和离线设备列表" width="30%">
  <img src="docs/images/image-msg.jpg" alt="从 Android 客户端发送图片 Prompt" width="30%">
  <img src="docs/images/image-result.jpg" alt="在 Android 客户端中查看图片理解结果" width="30%">
</p>

## 工作方式

```text
DSH Desktop / Remote Web / Android
  ↔ 已认证的端到端加密通道
Host 上的 Remote 插件
  ↔ 支持的 Harness 能力或可选 Codex 工作区支持
Harness 会话/Workspace 或 Codex 项目
```

Harness 主机无需开放公网监听端口。只要能够访问互联网，就可以从任意地方连接，
Remote 通过双向端到端加密链路通信。它将客户端切换到所选 Host 的 Harness 原生 API，
因此原有 Workspace、工具和权限流程都保留在该电脑上。Host 当前注册的全部设置分区也可以
通过 Harness 官方设置 API 在远端配置。凭据值仍然只写，Host 本地的文档打开操作不会暴露到远端。

## 实验性 Codex 工作区

Remote 也可以显示已授权 Host 上的 Codex 项目。你从原来的 Workspace 选择器进入，继续在现有
Harness 或 Android 界面里使用 Codex，不需要学习另一个 Codex 页面。Desktop 选择器和 Android
工作区页面也可以把 Host 上的目录新增到 Codex 项目目录，不会导入 Harness 存储。

Codex Remote 是面向自有设备的便捷入口。它支持文本 Prompt、可用客户端上的图片 Prompt、模型与
权限控制、停止和审批。它仍以实验功能发布；长期运行恢复和兼容性工作会继续按 TODO 跟进。

Web 和 Desktop 的审批控件显示所选 Codex 会话经 Host 确认的模式；尚未获知时标明沿用 Host
设置。切换须等 Host 确认成功，发送消息沿用会话当前策略。

Codex 默认开启，也可以在 DeepSeek Remote 设置卡片关闭。高级配置和实现细节见
[Codex Remote 技术说明](docs/codex-remote.md)。

## 实验性 Agent ACP / Cursor 工作区

Remote 也可通过后端无关的 Agent ACP gateway（`agent.acp.*`）打开 Host 本机的 Cursor Agent 会话。
Desktop 复用原生 Workspace / Session / Composer；Android 使用内存中的 Cursor 工作区投影。支持文本
Prompt、思考/正文流式更新、中断与一次性审批。Cursor 暂不支持图片 Prompt；AGY 工作区支持
PNG/JPEG/WebP/GIF（每张 8 MiB、每次最多 4 张），图片保存到 Host 私有临时缓存，由 AGY 图片工具读取。
历史中的图片可在 24 小时内恢复；系统提前清理 tmp 时图片将不可用。

AGY 通过独立的 `agent.acp.*` 接口和事件保持 Web 客户端兼容，工作区发现和历史均通过 ACP
从 Host 获取，客户端不读取本机 AGY 文件。原生 UI 投影只保留在内存中，Cursor/AGY 工作区 ID
独立，不兼容使用 Cursor 前缀的旧 AGY ID；Harness 和 Codex 接口保持原有契约。独立 Remote Web 接入及 AGY
跨设备回归仍待验证。

ACP 后端在后台初始化，AGY/Cursor 启动不会阻塞 Harness Remote 注册或 Client 初始化。
`acp.enabled` 控制整个域，`acp.backends` 中各已支持后端独立使用自己的 `enabled`、`command`、
`args` 和可选 `cwd`。当前 gateway 实现 `cursor` 和 `antigravity`，其他注册项不会启动或声明 adapter。
明确选中的后端关闭或不可用时直接返回错误，不会转发到另一个后端。配置修改后需要重启 DSH。

Cursor adapter **默认关闭**。在 DeepSeek Remote 设置中开启 `cursor.enabled`，在 Host 完成本机
`agent login`（或配置 `CURSOR_API_KEY`）后重启 DSH。细节见
[ACP Remote / Agent adapter 技术说明](docs/acp-remote.md)。

## 端到端加密

Harness 业务流量在 Client 加密，只能由选定的 Host 解密，固定使用
`Noise_IK_25519_ChaChaPoly_SHA256`。连接必须同时通过同账号 membership 与本地固定的设备
identity key 校验。服务端可以协调连接并看到必要的网络元数据，但不能读取会话消息、Prompt、
工具输出、Workspace 路径或 远端文件内容。握手、密钥生命周期、可见元数据、重放保护和
安全边界详见[端到端加密](docs/end-to-end-encryption.md)。

## 网络与传输

Host 只建立出站连接，不监听公网端口，也不要求路由器端口转发。Remote 按
`LAN -> P2P -> TURN -> Relay` 协商路径；WebRTC 不可用或连接失败时，会降级到加密的
WebSocket Relay。所有路径都承载同一份 Noise 密文，并保持相同的 Host/Client 身份边界。
网络拓扑、控制面与数据面、NAT、降级、重连语义和当前验证状态详见[网络与传输](docs/network.md)。

## 安全边界

- 会话流量经过端到端加密；服务端只中继密文，不保存会话明文或设备私钥。
- Server membership 与 Host 本地固定的 peer identity 必须同时授权连接。
- 交互终端使用 Host 本地的 `terminal.enabled`（默认开启），以 Host 用户身份运行，独立于 Agent 审批；不开放通用工具 RPC 或远程桌面。
- Workspace 选择器只列出文件夹，并且只返回受限的只读目录元数据。
- 远端文件预览不能写入、删除、上传、执行文件，也不能调用远端系统的“外部打开”。
- Codex Remote 是可选功能，可以关闭，并遵循与 Remote 其他能力相同的加密 Host 权限边界。
- Agent ACP / Cursor 是可选功能且默认关闭；遵循同一加密 Host 权限边界与固定方法白名单。
- 移除设备后，其凭证、membership 和已建立的 Remote 连接均会失效。

## 文档

- [插件说明](packages/plugin/README.md)
- [dsh-TUI Remote 使用指南](docs/dsh-tui.md)
- [Codex Remote 技术说明](docs/codex-remote.md)
- [ACP Remote / Agent adapter 技术说明](docs/acp-remote.md)
- [文档索引](docs/README.md)
- [端到端加密](docs/end-to-end-encryption.md)
- [网络与传输](docs/network.md)
- [远程协议](docs/protocol.md)
- [开发进度与路线图](TODO.md)
- 版本兼容详情见[兼容性说明](docs/compatibility.zh.md)。

## 友情链接

- 友情链接：[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)（已适配 Remote，参见 [dsh-TUI Remote 使用指南](docs/dsh-tui.md)）
- 友情链接：[LINUX DO 社区](https://linux.do/)
- 友情链接：[赛博刘看山](https://kanshan.r2049.cn/)

## Star History

<a href="https://www.star-history.com/?repos=liguobao%2Fds-harness-remote&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
 </picture>
</a>

## 项目声明与商标

本项目是独立的社区项目，不是 DeepSeek 官方产品。DeepSeek 及相关名称和商标归其各自权利人所有。

## License

[MIT](packages/plugin/LICENSE)

Android 也支持独立启用的 AGY 工作区：Host 目录与会话发现、新建对话、历史恢复、流式回复、
标题刷新、重连及文字/图片 Prompt。PNG/JPEG/WebP/GIF 图片每张上限 8 MiB、每次最多四张，
使用 Host 私有临时缓存。验证范围见 [Android 说明](apps/android/README.md#agy-workspaces)。

Agent 后端设置统一为每个后端一个开关：CodeX 复用现有 App Server Remote 域，Cursor 和 AGY 使用 ACP adapter。CodeX 由 `acp.backends[id=codex].enabled` 和 `.command` 控制；旧 `codex` 配置仅在后端字段缺失时读取。Kimi 尚未实现，已移除。工作区入口仅在 Host 报告后端就绪时显示。后端开关保存后立即生效，无需重启 DSH。
