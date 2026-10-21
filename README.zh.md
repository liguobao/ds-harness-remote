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

无论使用哪台设备，都可以回到同一个 Harness 会话。

Harness 始终运行在工作电脑上，原有的工作区、工具和项目配置保持不变。

DS Harness Remote 只是通往这个工作环境的另一个窗口。

已支持 DeepSeek Harness 桌面版，使用最新版本安装即可：

`ds-harness-remote@0.5.14`

## 目录

- [一次连接，随时可用](#一次连接随时可用)
- [主要特性](#主要特性)
- [支持的客户端](#支持的客户端)
- [安装](#安装)
- [快速开始](#快速开始)
- [界面截图](#界面截图)
- [工作方式](#工作方式)
- [实验性 ACP 工作区](#实验性-acp-工作区)
- [端到端加密](#端到端加密)
- [网络与传输](#网络与传输)
- [安全边界](#安全边界)
- [常见问题](#常见问题)
- [文档](#文档)
- [友情链接](#友情链接)
- [Star History](#star-history)
- [项目声明与商标](#项目声明与商标)
- [License](#license)

## 主要特性

- 从另一台设备（Web、PC、移动端）远程到本地Harness实例：DSH 优先，CodeX、Cursor、Antigravity 一样可用。
- DeepSeek Harness 原生界面，不另外维护一套桌面会话 UI。
- 支持新建工作区、模型配置、对话模型切换，远端如本地一样丝滑。
- 已支持 DeepSeek Harness 桌面版，安装即可使用。
- 可将纯终端 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile 作为 Host
- Harness 主机无需开放公网监听端口，无需公网IP，可以从任意可上网的地方，通过双向端到端加密链路安全连接。
- 优先使用P2P网络，全球多TURN节点中转，极端情况下使用Server Relay确保可用。
- 通过 Harness 原生侧栏提供工作区文件、只读预览、远程终端和已授权本机开发服务预览。
- CodeX / ACP 终端使用 Host 默认 shell，在会话目录启动，并在重连时恢复终端屏幕。
- Android 按对话保留草稿与阅读位置，提供后端分类搜索和本机收藏；切换时先显示保留的预览，再刷新最新历史。

## 支持的客户端

| 客户端 | 形态 | 状态 | 说明 |
| --- | --- | --- | --- |
| DSH Desktop 插件 | Harness 桌面版内的 Remote 侧栏 | 已支持 | 装 `ds-harness-remote@0.5.14`；Host 也可以就是这台电脑 |
| Remote Web | 浏览器页面 | 已支持 | 打开 [dsh.r2049.cn/app](https://dsh.r2049.cn/app)，复用 Harness 原生界面 |
| Android | 原生 App | 已支持 | 从 [Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) 下载 APK，见 [Android 说明](apps/android/README.md) |
| iOS | TestFlight 内测 | 内测 | 未公开上架，入口见 [issue #20](https://github.com/liguobao/ds-harness-remote/issues/20) |
| VS Code | IDE 扩展 | 实验性 | 登录、Host 指纹固定、工作区到会话导航与 Prompt；流式更新、自动重连与问答界面仍在开发，跨机端到端验证尚未完成 |
| 浏览器扩展 | Chrome / Edge MV3 扩展 | 仅入口 | 读取已登录 Web 的授权换取独立设备凭据、列出在线 Host、打开同源 Remote Web，不承载会话界面 |
| dsh-TUI | 纯终端 CLI profile | 已支持 | 可作 Host，见 [dsh-TUI Remote 使用指南](docs/dsh-tui.md)；安装脚本不会为它自动创建 Web 服务 |

多个客户端可以同时连接同一个 Host，RPC 与数据流按连接隔离。

## 安装

### 支持 DeepSeek Harness 桌面版

在 DeepSeek Harness Desktop 的 **扩展 / 插件管理** 中，选择从 **npm** 安装，输入包名和版本：

`ds-harness-remote@0.5.14`

安装后重启 Desktop。也可使用它的官方 `dsh` 启动器安装固定版本：
`dsh plugin --profile desktop add -w ds-harness-remote@0.5.14`。

### dsh-TUI Host

将 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 作为终端 Host 的配置，请参阅
[dsh-TUI Remote 使用指南](docs/dsh-tui.md)。

### 命令行安装

通过 DSH 插件管理命令，将确切版本加入 `web` profile：

```sh
dsh plugin --profile web add -w ds-harness-remote@0.5.14
```

安装后请重启 DeepSeek Harness。

命令行安装请使用 `dsh plugin`，它会将 npm 包安装到指定 profile，并加入插件的 bundle 配置层。

### 插件安装脚本

安装入口只保留 `scripts/install.sh`：

- **Linux：**要求 root，复用已有 DSH，缺少时安装私有 Node.js/DSH；支持一次性 Host Token 注册，并启用、启动 systemd 系统服务。Host 和远程工具以 **root** 运行，仅向可信账号开放。
- **macOS：**普通用户运行，复用 Desktop 官方启动器或已有 CLI，不安装 DSH、不创建服务。
- Windows 使用官方插件管理或已有 Harness 命令，不再提供安装脚本。

隐藏输入 Token、更新、服务管理和验证边界见[安装指南](docs/installation.zh.md)。仓库修改不会自动部署到线上安装入口。

### Android 客户端

从 [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest)

下载最新 APK，登录同一账号，选择 Host 和工作区即可继续会话。

### iOS 客户端

- [内测招募](https://github.com/liguobao/ds-harness-remote/issues/20)

## 快速开始

1. 从 Harness 侧边栏打开 **Remote** 入口。
2. 使用服务端提供的 OAuth 扫码登录方式，或使用账号密码登录。提供商列表动态获取，新增服务端集成无需再次发布插件。
3. Host 启动后默认允许控制当前机器，远程终端也默认开启；需要时可在详细 Remote 设置中关闭远程终端。
4. 在另一台设备上打开 DeepSeek Harness 桌面版、Remote Web 或 Android 客户端，并登录同一账号。
5. 选择在线 Host，再选择已有 Workspace 或浏览远端目录后打开。

默认使用本项目提供的[https://dsh.r2049.cn](https://dsh.r2049.cn)托管 Remote Server。

自建托管Server可使用仓库内的[最小 Server](apps/server/README.zh.md)，其 Web 页面仅提供设备状态。

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

支持文字/图片 Prompt、模型切换，以及可用工作区的文件和终端。详细使用见 [Android 说明](apps/android/README.md)。

<p align="center">
  <img src="docs/images/mobile-list.jpg" alt="Android 客户端中的在线和离线设备列表" width="30%">
  <img src="docs/images/image-msg.jpg" alt="从 Android 客户端发送图片 Prompt" width="30%">
  <img src="docs/images/image-result.jpg" alt="在 Android 客户端中查看图片理解结果" width="30%">
</p>

移动端设置提供默认关闭的全局「会话精简模式」，下次打开会话生效。支持该能力的 Host 缩减历史工具详情，保留正文和工具状态；旧 Host 保持原有行为，手机不做本地精简。关闭后重新打开会话可加载完整历史。

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

因此原有 Workspace、工具和权限流程都保留在该电脑上。

Host 当前注册的全部设置分区也可以通过 Harness 官方设置 API 在远端配置。

凭据值仍然只写，Host 本地的文档打开操作不会暴露到远端。

## 实验性 ACP 工作区

Host 启动本机 AI 后端，通过加密 Remote 通道传递 Prompt、流式回复和审批。

Desktop 与 Android 在内存中将工作区和会话映射到现有界面，不写入 Harness 存储。

当前已支持：

- **Cursor**：通过 CLI 的 ACP 接口接入。
- **Antigravity（AGY）**：将 CLI 的 stream-json 接口适配到 ACP gateway。
- **Pi Agent（实验性）**：在 Host 安装 `@earendil-works/pi-coding-agent` 与 `pi-acp`，配置 Pi 本机模型服务后，Remote 默认自动检测并初始化，ACP 初始化成功才开放工作区；可在 Remote 设置中明确关闭，使用独立 ACP 数据面。工具按 Host 用户权限执行，逐工具确认需要 Pi 扩展，默认不会自动启用。

- **OpenCode** — 通过 `opencode acp` 接入，支持工作区发现和历史恢复。Host 启动时检查 CLI 支持的参数，兼容带原生监听器与纯 stdio 的 ACP 构建。Desktop/Android 原生会话归档要求认证 loopback API；不提供该接口的版本会明确报告归档不可用。归档状态由 OpenCode 保存，历史保留；暂不提供恢复归档入口。
- **Claude** — 使用 Host 本机已授权的 `claude-agent-acp`，需在 Remote 设置中开启；Desktop/Android 支持工作区、历史、文字消息及审批，暂不开放图片输入与直接 Files/Terminal 访问。

Desktop/Android 的 Cursor、Claude、Pi、OpenCode、AGY 模型选择使用 Host 实际模型目录，并等待后端确认。思考强度选项以上游实际提供为准。Cursor 每个会话使用独立进程，切换模型不会影响其他会话。

- **Codex**：通过独立的 App Server 接口接入，使用同一工作区入口。

配置与后端适配开发见 [Agent 工作区接入指南](docs/acp-integration.md)。

## 端到端加密

Harness 业务流量在 Client 加密，只能由选定的 Host 解密，固定使用
`Noise_IK_25519_ChaChaPoly_SHA256`。连接必须同时通过同账号 membership 与本地固定的设备
identity key 校验。服务端可以协调连接并看到必要的网络元数据，但不能读取会话消息、Prompt、
工具输出、Workspace 路径或 远端文件内容。握手、密钥生命周期、可见元数据、重放保护和
安全边界详见[端到端加密](docs/end-to-end-encryption.md)。

## 网络与传输

Host 只建立出站连接，不监听公网端口，也不要求路由器端口转发。

Remote 按 `LAN -> P2P -> TURN -> Relay` 协商路径；

WebRTC 不可用或连接失败时，会降级到加密的 WebSocket Relay。

已建立的路径失败时会关闭，并在新的 transport 与 Noise channel 上重建，不会把活动通道原地
切换到另一条路径。

所有路径都承载同一份 Noise 密文，并保持相同的 Host/Client 身份边界。

`CONNECTION_FAILED` 可能由 Server 下发，也可能是 Host 的本地兜底；排查时应同时查看日志中的
`closedBy` 与 `retryable` 字段，不要只凭 code 判断路径。

网络拓扑、控制面与数据面、NAT、降级、重连语义和当前验证状态详见[网络与传输](docs/network.md)。

创建 Harness 工作区可使用 Host 用户权限创建缺失目录，独立于终端开关。路径必须为绝对非根路径；注册失败时保留已创建目录。

OAuth 登录方式由服务端动态提供。使用 `ds-harness-remote login list` 或 `/remote login list` 查看可用扫码方式；新增服务端集成无需再次发布插件。

## 安全边界

- 会话流量经过端到端加密；服务端只中继密文，不保存会话明文或设备私钥。
- Server membership 与 Host 本地固定的 peer identity 必须同时授权连接。
- 交互终端使用 Host 本地的 `terminal.enabled`（默认开启），以 Host 用户身份运行，独立于 Agent 审批；
- 不开放通用工具 RPC 或远程桌面。
- Workspace 选择器只列出文件夹，并且只返回受限的只读目录元数据。
- 远端文件预览不能写入、删除、上传、执行文件，也不能调用远端系统的“外部打开”。
- Codex Remote / Agent ACP是可选功能，可以关闭，并遵循与 Remote 其他能力相同的加密 Host 权限边界。
- 移除设备后，其凭证、membership 和已建立的 Remote 连接均会失效。

## 常见问题

**需要公网 IP 或端口转发吗？**

不需要。Host 只建立出站连接，不监听公网端口。

**服务端能看到我的会话内容吗？**

不能。服务端只中继密文；它能读到的是完成授权、在线状态、选路与限流所需的控制元数据，例如设备归属、在线状态、连接时间与 `connectionId`，读不到 Prompt、对话内容、工具输入输出、Workspace 路径与文件预览内容。

**哪台机器可以当 Host？**

装了 Remote 插件并已登录的 Harness 实例。`web`、`desktop` 与 dsh-TUI profile 均可作 Host，命令行安装默认使用 `web`。安装脚本不会为 `headless`、SDK 与 dsh-TUI 自动创建 Web 服务，dsh-TUI 需自行管理进程。

**可以几台设备同时连同一个 Host？**

可以多设备并发连接，RPC 与数据流按连接隔离。

**支持哪些 Harness 版本？**

当前基线为 `dsh-v0.2.1-rc.1`，兼容 `0.2.0` rc.2 / rc.1，详见[兼容性说明](docs/compatibility.zh.md)。

**Linux 安装为什么要求 root？**

安装脚本要配置 systemd 系统服务；Host、Agent 工具与远程终端因此具备 root 权限，只应对可信账号开放。

**iOS 可以直接装吗？**

目前是 TestFlight 内测，未公开上架，入口见 [issue #20](https://github.com/liguobao/ds-harness-remote/issues/20)。

**和 frp、内网穿透或远程桌面有什么不同？**

本项目不做端口映射，也不是远程桌面：只把 Harness 原生会话界面映射到远端，不开放通用工具 RPC 与桌面控制，权限与审批仍留在 Host 侧。

## 文档

- [插件说明](packages/plugin/README.md)
- [安装指南](docs/installation.zh.md)
- [dsh-TUI Remote 使用指南](docs/dsh-tui.md)
- [Codex Remote 技术说明](docs/codex-remote.md)
- [ACP Remote / Agent adapter 技术说明](docs/acp-remote.md)
- [文档索引](docs/README.md)
- [端到端加密](docs/end-to-end-encryption.md)
- [网络与传输](docs/network.md)
- [远程协议](docs/protocol.md)
- [开发进度与路线图](docs/TODO.md)
- [更新记录](docs/CHANGELOG.md)
- [隐私说明](docs/PRIVACY.md)
- [Android 说明](apps/android/README.md)
- 当前开发适配基线为 `dsh-v0.2.1-rc.1`，验证范围见[兼容性说明](docs/compatibility.zh.md)。

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
