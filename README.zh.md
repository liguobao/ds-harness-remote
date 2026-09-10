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
  <strong>下载：</strong>
  <a href="https://github.com/liguobao/dsh-desktop/releases/latest">Windows</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/dsh-desktop/releases/latest">macOS</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/dsh-desktop/releases/latest">Linux</a>
  &nbsp;·&nbsp;
  <a href="https://dsh.r2049.cn/app">Web</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/releases/latest">Android</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ds-harness-remote">npm</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote">GitHub</a>
  &nbsp;·&nbsp;
  <a href="https://dshfind.com/zh/plugins/liguobao/ds-harness-remote?ref=badge"><img src="https://dshfind.com/api/badge/liguobao/ds-harness-remote?metric=downloads&amp;lang=zh" alt="dshfind 下载量" width="137" height="20" align="absmiddle"></a>
</p>

## 一次连接，随时可用。

从手机、电脑、浏览器继续使用你的 DeepSeek Harness 实例。

无论使用哪台设备，都可以回到同一个 Harness 会话。Harness 始终运行在工作电脑上，原有的工作区、工具和项目配置保持不变。Remote 只是通往这个工作环境的另一个窗口。

## 主要特性

- 从另一台设备继续活跃会话，查看最新进展
- 发送新指令、调整任务方向，并在 Harness `dsh-v0.1.1-rc.2`、`dsh-v0.1.2-alpha.1`–`rc.1` 或 `dsh-v0.1.5-rc.1` 中使用图片 Prompt
- 在支持实时会话控制的客户端中回答问题、处理权限请求
- 打开同一账号下另一台已授权电脑上的 Workspace
- 复用 Harness 原生界面，不另外维护一套桌面会话 UI
- 两端 Harness 都安装可选 `dsh-file-viewer` 插件时，可以预览远端文件
- 可将纯终端 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile 作为 Host，并通过 GitHub 或知乎终端二维码授权
- Harness 主机无需开放公网监听端口。你可以从任意可上网的地方，通过双向端到端加密链路安全连接

## 安装

### 方式 A：DSH Desktop

在 Windows、macOS 或 Linux 上安装 [DSH Desktop](https://github.com/liguobao/dsh-desktop)。
DSH Desktop 已默认集成并启用 Remote，无需另行安装插件。

### 方式 B：已有 DSH 环境

通过 DSH 插件管理命令，将确切版本加入 `web` profile：

```sh
dsh plugin --profile web add ds-harness-remote@0.4.12
```

安装后请重启 Harness。

不要直接用 npm 安装这个包。只有 `dsh plugin` 会更新指定 profile，并加入插件的 bundle 配置层。

### 方式 C：dsh-TUI Host

Remote 可以在纯终端 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile 中作为 Host
运行，不再依赖 Desktop 浏览器的 `connection` 服务。先把插件安装进 TUI profile：

```sh
dsh plugin --profile dsh-tui add ds-harness-remote@0.4.12
```

启动 dsh-TUI 后，使用原生 Slash Command：

```text
/remote                    # 查看 Host 实时状态
/remote login              # 默认使用知乎二维码登录
/remote login github
/remote status
/remote logout
```

`/remote login` 会打开 TUI 原生的二维码场景，二维码下方显示可点击的授权 URL；省略平台时默认
使用知乎，也支持 GitHub。Host 控制默认开启，`/remote logout` 会撤销 Host 并轮换本地设备身份。
目前不开放 Host 配置，固定使用 `https://dsh.r2049.cn`。子命令和登录平台均支持 Tab 补全。
`/remote` Host 管理入口支持 `dsh-v0.1.1-rc.2`、`dsh-v0.1.2-alpha.1`–`rc.1` 和
`dsh-v0.1.5-rc.1` 的 TUI
profile；只有官方 Harness carrier 可用时，才会公布对应的 Remote Workspace 能力。

完整兼容矩阵、rc.2 ApiProxy 挂载、状态字段和排障方式见
[dsh-TUI Remote 使用指南](docs/dsh-tui.md)。

## 快速开始

1. 从 Harness 侧边栏打开 **Remote** 入口。
2. 使用 GitHub/知乎扫码登录，或使用账号密码登录。新的账号密码用户可从 [Remote Web](https://dsh.r2049.cn/app/register) 注册，当前邀请要求以站点页面为准。
3. 为当前机器启用远端控制。
4. 在另一台设备上打开 DSH Desktop、Remote Web 或 Android 客户端，并登录同一账号。
5. 选择在线 Host，再选择已有 Workspace 或浏览远端目录后打开。

公开服务目前使用托管的 Remote 中继，尚未提供受支持的自建中继方案。

## 界面截图

### 桌面端

在 Remote 设置中启用**允许控制当前设备**，即可将当前电脑作为 Host。

在另一台电脑上选择在线 Host，然后打开它的 Workspace。

<p align="center">
  <img src="docs/images/host-list.png" alt="列出在线 Host 的远端工作区选择界面" width="900">
</p>

Workspace 会在 Harness 原生界面中打开，顶部显示当前 Host 和加密连接状态。

<p align="center">
  <img src="docs/images/remote.png" alt="通过端到端加密远程连接运行的 Harness 会话" width="900">
</p>

### Android

从 [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest) 下载最新 Android APK。

使用已有账号登录 Android 客户端，选择可用电脑并打开 Workspace，然后通过文字或图片 Prompt 继续会话。
会话工具栏也可以切换当前模型，并选择该模型声明的思考程度。

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

## 端到端加密

Harness 业务流量在 Client 加密，只能由选定的 Host 解密，固定使用
`Noise_IK_25519_ChaChaPoly_SHA256`。连接必须同时通过同账号 membership 与本地固定的设备
identity key 校验。服务端可以协调连接并看到必要的网络元数据，但不能读取会话消息、Prompt、
工具输出、Workspace 路径或 File Viewer 内容。握手、密钥生命周期、可见元数据、重放保护和
安全边界详见[端到端加密](docs/end-to-end-encryption.md)。

## 网络与传输

Host 只建立出站连接，不监听公网端口，也不要求路由器端口转发。Remote 按
`LAN -> P2P -> TURN -> Relay` 协商路径；WebRTC 不可用或连接失败时，会降级到加密的
WebSocket Relay。所有路径都承载同一份 Noise 密文，并保持相同的 Host/Client 身份边界。
网络拓扑、控制面与数据面、NAT、降级、重连语义和当前验证状态详见[网络与传输](docs/network.md)。

## 安全边界

- 会话流量经过端到端加密；服务端只中继密文，不保存会话明文或设备私钥。
- Server membership 与 Host 本地固定的 peer identity 必须同时授权连接。
- Remote 不开放直接 Shell、PTY、通用工具 RPC 或远程桌面。Harness 工具仍可以在 Host 上修改文件或运行命令，并继续受 Harness 原有权限控制。
- Workspace 选择器只列出文件夹，并且只返回受限的只读目录元数据。
- 可选 File Viewer 只通过已认证、已加密的分块读取访问文件，并继续执行 provider 根目录与 locator 授权。
- 远端文件预览不能写入、删除、上传、执行文件，也不能调用远端系统的“外部打开”。
- Codex Remote 是可选功能，可以关闭，并遵循与 Remote 其他能力相同的加密 Host 权限边界。
- 移除设备后，其凭证、membership 和已建立的 Remote 连接均会失效。

## 版本兼容

**破坏性更新声明：** Plugin `0.4.1` 已移除早期实验性的 Remote 业务 RPC
（`sessions.*`、`session.*`、`permissions.respond`、`sync.from`）。Harness
会话流量现在只通过官方 rc.2 `ApiProxy` 或 v0.1.2 Typert Remote Gateway 承载；
本插件不提供旧 RPC 的适配层或 wire format 翻译。

Plugin `0.4.12` 同时兼容 DeepSeek Harness `dsh-v0.1.1-rc.2` 与
`dsh-v0.1.2-alpha.1`–`rc.1`：rc.2 继续使用官方 legacy `ApiProxy`，v0.1.2 使用官方
Typert Remote Gateway；另外支持 `dsh-v0.1.5-rc.1` Session V3 官方 Typert Remote
Gateway。运行 rc.2 的 `0.4.12` Client 仍可通过 legacy capability 降级连接旧 rc.2 Host。

两端 Desktop 必须处于同一 Harness carrier 与 Session 代际。`0.4.x` 不翻译 legacy ApiProxy、v0.1.2 Session wire 与 Session V3 的业务模型：
Typert Client 不能打开 ApiProxy Host，ApiProxy Client 也不能打开 Typert Host；混连会在切换原生
UI 或修改 Workspace 前被拒绝。v0.1.2/V3 混连同样会在 mutation 前被拒绝。

## 文档

- [插件说明](packages/plugin/README.md)
- [dsh-TUI Remote 使用指南](docs/dsh-tui.md)
- [Codex Remote 技术说明](docs/codex-remote.md)
- [文档索引](docs/README.md)
- [端到端加密](docs/end-to-end-encryption.md)
- [网络与传输](docs/network.md)
- [远程协议](docs/protocol.md)
- [开发进度与路线图](TODO.md)

## 友情链接

- 友情链接：[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)（已适配 Remote，参见 [dsh-TUI Remote 使用指南](docs/dsh-tui.md)）
- 友情链接：[LINUX DO 社区](https://linux.do/)
- 友情链接：[赛博刘看山](https://kanshan.r2049.cn/)

## 项目声明与商标

本项目是独立的社区项目，不是 DeepSeek 官方产品。DeepSeek 及相关名称和商标归其各自权利人所有。

## License

[MIT](packages/plugin/LICENSE)
