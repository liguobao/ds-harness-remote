<p align="center">

当前版本为 `0.5.1`；Android 使用 `versionCode 40`。

当前 Harness 适配基线：`0.2.1-alpha.1`，保留 `0.2.0-rc.2`，版本范围接纳后续 `0.2.2` RC；legacy ApiProxy 不再作为兼容维护目标。详细范围与验证边界见[兼容说明](docs/compatibility.zh.md)。
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

`ds-harness-remote@0.5.1`

## 主要特性

- 从另一台设备（Web、PC、移动端）远程到本地Harness实例：DSH 优先，CodeX、Cursor、Antigravity 一样可用。
- DeepSeek Harness 原生界面，不另外维护一套桌面会话 UI。
- 支持新建工作区、模型配置、对话模型切换，远端如本地一样丝滑。
- 已支持 DeepSeek Harness 桌面版，安装即可使用。
- 可将纯终端 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile 作为 Host
- Harness 主机无需开放公网监听端口，无需公网IP，可以从任意可上网的地方，通过双向端到端加密链路安全连接。
- 优先使用P2P网络，全球多TURN节点中转，极端情况下使用Server Relay确保可用。
- 通过 Harness 原生侧栏提供工作区文件、只读预览、远程终端和已授权本机开发服务预览。

## 安装

### 支持 DeepSeek Harness 桌面版

在 DeepSeek Harness Desktop 的 **扩展 / 插件管理** 中，选择从 **npm** 安装，输入包名和版本：

`ds-harness-remote@0.5.1`

安装后重启 Desktop。也可使用它的官方 `dsh` 启动器安装固定版本：
`dsh plugin --profile desktop add -w ds-harness-remote@0.5.1`。

### dsh-TUI Host

将 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 作为终端 Host 的配置，请参阅
[dsh-TUI Remote 使用指南](docs/dsh-tui.md)。

### 命令行安装

通过 DSH 插件管理命令，将确切版本加入 `web` profile：

```sh
dsh plugin --profile web add -w ds-harness-remote@0.5.1
```

安装后请重启 DeepSeek Harness。

命令行安装请使用 `dsh plugin`，它会将 npm 包安装到指定 profile，并加入插件的 bundle 配置层。

### 插件安装脚本

脚本使用已有 Harness 命令，只安装或更新 Remote。使用普通用户运行，保留用户的 DSH
安装，不创建后台服务。

macOS / Linux：

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

### Android 客户端

从 [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest)

下载最新 APK，登录同一账号，选择 Host 和工作区即可继续会话。

### iOS 客户端

- [内测招募](https://github.com/liguobao/ds-harness-remote/issues/20)

## 快速开始

1. 从 Harness 侧边栏打开 **Remote** 入口。
2. 使用 GitHub/知乎扫码登录，或使用账号密码登录。
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

所有路径都承载同一份 Noise 密文，并保持相同的 Host/Client 身份边界。

网络拓扑、控制面与数据面、NAT、降级、重连语义和当前验证状态详见[网络与传输](docs/network.md)。

## 安全边界

- 会话流量经过端到端加密；服务端只中继密文，不保存会话明文或设备私钥。
- Server membership 与 Host 本地固定的 peer identity 必须同时授权连接。
- 交互终端使用 Host 本地的 `terminal.enabled`（默认开启），以 Host 用户身份运行，独立于 Agent 审批；
- 不开放通用工具 RPC 或远程桌面。
- Workspace 选择器只列出文件夹，并且只返回受限的只读目录元数据。
- 远端文件预览不能写入、删除、上传、执行文件，也不能调用远端系统的“外部打开”。
- Codex Remote / Agent ACP是可选功能，可以关闭，并遵循与 Remote 其他能力相同的加密 Host 权限边界。
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
- [开发进度与路线图](docs/TODO.md)
- [更新记录](docs/CHANGELOG.md)
- [隐私说明](docs/PRIVACY.md)
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
