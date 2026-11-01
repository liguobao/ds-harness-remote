<p align="center">

  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="600">
</p>

<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <strong>中文</strong>
  &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a>
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

从手机、电脑、浏览器继续使用你的 DeepSeek Harness 实例。无论使用哪台设备，都可以回到同一个 Harness 会话。

Harness 始终运行在工作电脑上，原有的工作区、工具和项目配置保持不变。DS Harness Remote 只是通往这个工作环境的另一个窗口。

已支持 DeepSeek Harness 桌面版，使用最新版本安装即可：

`ds-harness-remote@0.6.0`

## 主要特性

- 从另一台设备（Web、PC、移动端）远程到本地Harness实例：DSH 优先，CodeX、Cursor、Antigravity 一样可用。
- 已支持 DeepSeek Harness 桌面版，安装即可使用。原生界面，不另外维护一套桌面会话 UI。
- 支持新建工作区、模型配置、对话模型切换，远端如本地一样丝滑。
- Harness 主机无需开放公网监听端口，无需公网IP，可以从任意可上网的地方，通过双向端到端加密链路安全连接。
- 优先使用P2P网络，全球多TURN节点中转，极端情况下使用多Server Relay兜底，一切畅通无阻。
- 通过 Harness 原生侧栏提供工作区文件、只读预览、远程终端和已授权本机开发服务预览。
- Remote Tool 上下文注入，支持 发现主机与工作区、创建和管理 Harness 会话、读取历史、等待执行、请求中断及传输获准文件。[详情](packages/plugin/README.md#remote-agent-tools)
- 除了支持DeepSeek Harness，同时通过ACP协议支持 Codex、Cursor、Google Antigravity、Pi、OpenCode、Claude Code、Harness Agent等工具的原生工作区，远程文件浏览、终端均可使用。
- Android、iOS、Web、原生DSH 都有对应客户端，全平台可用。
- 多个客户端可以同时连接同一个 Harness Host，RPC 与数据流按连接隔离。

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

## 支持的客户端

| 客户端 | 形态 | 状态 | 说明 |
| --- | --- | --- | --- |
| DSH&nbsp;Desktop&nbsp;插件 | Remote 侧栏 | 已支持 | 装 `ds-harness-remote@0.6.0`；Host 也可以就是这台电脑 |
| Web | 浏览器页面 | 已支持 | 打开 [https://dsh.r2049.cn](https://dsh.r2049.cn)，复用 Harness 原生界面 |
| Android | 原生 App | 已支持 | 从 [Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) 下载 APK，见 [Android 说明](apps/android/README.md) |
| DSH Go | C佬精品 | 已支持 | 详情见：[ccch1mneyyy/dsh-go: DeepSeek Harness 的 Android 客户端。手机上直接跑，也能遥控你电脑上的 DSH。](https://github.com/ccch1mneyyy/dsh-go)
| iOS | TestFlight 内测 | 内测 | 未公开上架，入口见 [issue #20](https://github.com/liguobao/ds-harness-remote/issues/20) |
| 浏览器扩展 | Chrome | 仅入口 | 读取已登录 Web 的授权换取独立设备凭据、列出在线 Host、打开同源 Remote Web，不承载会话界面 |
| dsh-TUI | 纯终端 CLI  | 已支持 | 可作 Host，见 [dsh-TUI Remote 使用指南](docs/dsh-tui.md)；安装脚本不会为它自动创建 Web 服务 |
| Linux  | 云服务器  | 已支持 | [官网](https://dsh.r2049.cn/)登录后可一条命令全程无操作安装，无需任何配置。

多个客户端可以同时连接同一个 Host，RPC 与数据流按连接隔离。

## 安装

### 支持 DeepSeek Harness 桌面版

在 DeepSeek Harness Desktop 的 **扩展 / 插件管理** 中，选择从 **npm** 安装，输入包名和版本：

`ds-harness-remote@0.6.0`

安装后重启 Desktop。也可使用它的官方 `dsh` 启动器安装固定版本：
`dsh plugin --profile desktop add -w ds-harness-remote@0.6.0`。

### Linux 一键安装

见官网首页[https://dsh.r2049.cn](https://dsh.r2049.cn/)，登陆后获取一键安装授权码安装即可。

### dsh-TUI Host

将 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 作为终端 Host 的配置，请参阅
[dsh-TUI Remote 使用指南](docs/dsh-tui.md)。

### 原生Android 客户端

支持同时使用多工作区连接对话，同时创造性加入了 「Bot 模式」（ Power by [Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)）

从 [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) 下载最新 APK，登录同一账号即可看到主机。

## DSH Go - DeepSeek Harness 装进口袋：手机本机运行，也能遥控你的电脑。

[ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go)：已内置 ds-harness-remote 协议，既可以在手机本机运行 DeepSeek Harness，也可以远程连接电脑。

在手机端DSH Go安装 ds-harness-remote 插件后，电脑端、Web端一样可以远程到手机上的DSH，丝滑使用Mobile Use.

### iOS 客户端

- [内测招募](https://github.com/liguobao/ds-harness-remote/issues/20)

## 快速开始

1. 从 DeepSeek Harness 侧边栏打开 **Remote** 入口。
2. 按需选择登录方式：「知乎」、「Github」、[Google ] 授权登录均已支持，账号密码登录（使用邀请码注册，可邮件本仓库作者申请）
3. 在另一台设备上使用 DeepSeek Harness安装同样插件，根据1、2完成同样方式的登录。也可以按需使用Remote Web、iOS、Android、DSH Go等客户端，即开即用，无需安装任何插件。
4. 选择在线 Host，再选择已有 Workspace 或浏览远端目录后打开。

默认使用本项目提供的[https://dsh.r2049.cn](https://dsh.r2049.cn)托管 Remote Server。

自建托管Server可使用仓库内的[最小 Server](apps/server/README.zh.md)，当前版本已包含P2P协调、Relay Server 等功能，暂不支持托管Remote Web的完整功能。

## 界面截图

### 桌面端

在另一台电脑上选择在线 Host，然后打开它的 Workspace。Workspace 会在 Harness 原生界面中打开，顶部显示当前 Host 和加密连接状态。


<p align="center">
  <img src="docs/images/host-list.png" alt="列出在线 Host 的远端工作区选择界面" width="40%">
  <img src="docs/images/remote.png" alt="通过端到端加密远程连接运行的 Harness 会话" width="40%">
</p>

注意：如果想关闭当前电脑远控其他主机功能，可在[https://dsh.r2049.cn/](https://dsh.r2049.cn/) 「主机列表」中，打开「仅被控」开关，开启「仅被控」后当前设备无法看到账号下其他设备，Web端、其他客户端依旧可以远程当前设备。

### Android

支持文字/图片 Prompt、模型切换，以及可用工作区的文件和终端。

界面默认跟随系统，支持英文、简体中文、日语、繁体中文、西语、德语、法语；语言设置点击「More ...」可展开全部语言。详细使用见 [Android 说明](apps/android/README.md)。

<p align="center">
  <img src="docs/images/mobile-list.jpg" alt="Android 客户端中的在线和离线设备列表" width="30%">
  <img src="docs/images/image-msg.jpg" alt="从 Android 客户端发送图片 Prompt" width="30%">
  <img src="docs/images/image-result.jpg" alt="在 Android 客户端中查看图片理解结果" width="30%">
</p>

移动端设置提供默认关闭的全局「会话精简模式」，下次打开会话生效。

支持该能力的 Host 缩减历史工具详情，保留正文和工具状态，关闭此设置后重新打开会话可加载完整历史。

## 工作方式

```text
DSH Desktop / Remote Web / Android
  ↔ 已认证的端到端加密通道
Host 上的 Remote 插件
  ↔ 支持的 Harness 能力或可选 Codex 工作区支持
Harness 会话/Workspace 或 Codex 项目
```

Harness 主机无需开放公网监听端口。只要能够访问互联网，就可以从任意地方连接，ds-harness-remote 通过双向端到端加密链路通信。

它将客户端切换到所选 Host 的 Harness 原生 API，因此原有 Workspace、工具和权限流程都保留在该电脑上。

Host 当前注册的全部设置分区也可以通过 Harness 官方设置 API 在远端配置，大部分插件配置均已得到完整支持。

## 实验性 ACP 工作区

Host 启动本机支持ACP 的Agent，通过ds-harness-remote 通道传递 Prompt、流式回复和审批。所有Agent都使用自身工作区和会话，只做DSH 会话翻译转换，不写入 Harness 存储。

当前已支持：

- **Codex**：通过独立的 App Server 接口接入，使用同一工作区入口。
- **Cursor**：通过 CLI 的 ACP 接口接入。
- **Antigravity（AGY）**：将 CLI 的 stream-json 接口适配到 ACP gateway。
- **Pi Agent（实验性）**：在 Host 安装 `@earendil-works/pi-coding-agent` 与 `pi-acp`，配置 Pi 本机模型服务后，Remote 默认自动检测并初始化，ACP 初始化成功才开放工作区；可在 Remote 设置中明确关闭，使用独立 ACP 数据面。工具按 Host 用户权限执行，逐工具确认需要 Pi 扩展，默认不会自动启用。
- **OpenCode** — 通过 `opencode acp` 接入，支持工作区发现和历史恢复。Host 启动时检查 CLI 支持的参数，兼容带原生监听器与纯 stdio 的 ACP 构建。Desktop/Android 原生会话归档要求认证 loopback API；不提供该接口的版本会明确报告归档不可用。归档状态由 OpenCode 保存，历史保留；暂不提供恢复归档入口。
- **Claude** — 使用 Host 本机已授权的 `claude-agent-acp`，需在 Remote 设置中开启；Desktop/Android 支持工作区、历史、文字消息及审批，暂不开放图片输入与直接 Files/Terminal 访问。
- **Hermes** — 通过 Hermes Agent 自带的 ACP 服务端（`hermes acp`）接入，需在 Remote 设置中开启；Desktop/Android 支持工作区、历史、流式思考与工具输出、文字消息、审批及模型选择，暂不开放图片输入与直接 Files/Terminal 访问。

配置与后端适配开发见 [Agent 工作区接入指南](docs/acp-integration.md)。

Desktop/Android 的 Cursor、Claude、Hermes、Pi、OpenCode、AGY 模型选择使用 Host 实际模型目录，由Agent ACP决定

思考强度选项以上游实际提供为准。Cursor 每个会话使用独立进程，切换模型不会影响其他会话。

## 端到端加密

Harness 业务流量在 Client 加密，只能由选定的 Host 解密，固定使用 `Noise_IK_25519_ChaChaPoly_SHA256`。

连接必须同时通过同账号 membership 与本地固定的设备 identity key 校验。

服务端可以协调连接并看到必要的网络元数据，但不能读取会话消息、Prompt、工具输出、Workspace 路径或 远端文件内容。

握手、密钥生命周期、可见元数据、重放保护和安全边界详见[端到端加密](docs/end-to-end-encryption.md)。

## 网络与传输

Host 只建立出站连接，不监听公网端口，也不要求路由器端口转发。

Remote 按 `LAN -> P2P -> TURN -> Relay` 协商路径；

WebRTC 不可用或连接失败时，会降级到加密的 WebSocket Relay。

所有路径都承载同一份 Noise 密文，并保持相同的 Host/Client 身份边界。

网络拓扑、控制面与数据面、NAT、降级、重连语义和当前验证状态详见[网络与传输](docs/network.md)。

## 安全边界

- LAN 、P2P网络下，除了网络协调相关指令，所有的数据不经过服务器；TURN服务使用开源coturn服务器部署，Relay 模式使用WebSocket转发。
- 所有的会话流量经过端到端加密；服务端只中继密文，不保存会话明文或设备私钥。
- Server membership 与 Host 本地固定的 peer identity 必须同时授权连接。
- [Remote Tools 注入说明](docs/remote-tools.md)：可选的 `remote_*` 会话工具，默认开启，可在详细 Remote 设置中开启。
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

装了 Remote 插件并已登录的 Harness 实例，无论是Windows还是MacOS、Linux，甚至于DSH-Go 都可以作为Harness Remote Host实例。

**可以几台设备同时连同一个 Host？**

暂无限制，当前可以同时使用多设备并发连接，RPC 与数据流按连接隔离。

**支持哪些 Harness 版本？**

当前基线为 `dsh-v0.2.1-rc.5`，兼容 `0.2.0` rc.2 / rc.1，详见[兼容性说明](docs/compatibility.zh.md)。

Host 插件、随包 Remote 客户端和 Android 已移除 Harness `0.1.1-rc.2` ApiProxy 兼容。请使用提供官方 Typert Remote carrier 的 Host；

仅提供 ApiProxy 或不支持能力发现的旧 Host 会被拒绝，不再降级。

CodeX/ACP 保留独立数据面，Desktop 内存投影统一使用 Typert。

**Linux 安装为什么要求 root？**

安装脚本要配置 systemd 系统服务；Host、Agent 工具与远程终端因此具备 root 权限，只应对可信账号开放。

**iOS 可以直接装吗？**

目前是 TestFlight 内测，未公开上架，入口见 [issue #20](https://github.com/liguobao/ds-harness-remote/issues/20)。

**和 frp、内网穿透或远程桌面有什么不同？**

通用端口映射使用Server TCP转发流量，流量需要从Server经过一道，受限于Server端的带宽瓶颈。

本项目使用4层网络模式依次探测，在复杂网络环境下依旧能保持良好的P2P直连。

远程桌面为了满足用户使用需求，需要把整个电脑屏幕获取下来，然后再用户侧重放，整体对上下行带宽和电脑性能都有要求。

本项目只把 Harness 原生会话界面需要的消息加密后传输到远端，不开放通用工具 RPC 与桌面控制，权限与审批仍留在 Host 侧。

Tailscale 、 CF Turn 、UU远程都是非常优秀的解决方案，大家按需使用即可。

## 推荐搭配插件

### Intelligent UI

[Intelligent UI](https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui) 让模型用卡片、表格、图表和表单作答。
Android 客户端可原生渲染这些内容，并在 **插件 → Remote 适配** 中列出该插件，可直接开关和修改实时设置。

### [Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)

DS Bot 是一个基于 DeepSeek Harness（简称 dsh）的 bot 插件，插件将 dsh 改造为 bot 形式。你可以与自己创建的 bot 交流、工作。

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
- 当前开发适配基线为 `dsh-v0.2.1-rc.5`，验证范围见[兼容性说明](docs/compatibility.zh.md)。

## 友情链接

- 友情链接：[DSH Go](https://github.com/ccch1mneyyy/dsh-go) — 把 DeepSeek Harness 装进口袋：手机本机运行，也能遥控你的电脑。「已适配 Remote。」
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
