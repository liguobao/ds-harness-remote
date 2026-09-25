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
  <a href="apps/server/README.zh.md">自部署</a>
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
- 发送新指令、调整任务方向，并在 `dsh-v0.1.1-rc.2` 至 `dsh-v0.1.6-alpha.1` 范围内的受支持 Harness 版本中使用图片 Prompt
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

### 方式 B：自动安装

macOS / Linux：

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell（以管理员身份运行）：

```powershell
irm https://dsh.r2049.cn/app/install.ps1 | iex
```

安装后按[快速开始](#快速开始)登录。目录配置、服务管理和卸载见[安装指南](docs/installation.zh.md)。

### 方式 C：已有 DSH 环境

通过 DSH 插件管理命令，将确切版本加入 `web` profile：

```sh
dsh plugin --profile web add -w ds-harness-remote@0.4.17
```

`-w` 表示加到 profile 自身的 workspace root；pnpm 低于 11 时不加会直接报
`ERR_PNPM_ADDING_TO_ROOT`。

安装后请重启 Harness。

不要直接用 npm 安装这个包。只有 `dsh plugin` 会更新指定 profile，并加入插件的 bundle 配置层。

### 方式 D：dsh-TUI Host

将 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 作为终端 Host 的配置，请参阅
[dsh-TUI Remote 使用指南](docs/dsh-tui.md)。

## 快速开始

1. 从 Harness 侧边栏打开 **Remote** 入口。
2. 使用 GitHub/知乎扫码登录，或使用账号密码登录。新的账号密码用户可从 [Remote Web](https://dsh.r2049.cn/app/register) 注册，当前邀请要求以站点页面为准。
3. 为当前机器启用远端控制。
4. 在另一台设备上打开 DSH Desktop、Remote Web 或 Android 客户端，并登录同一账号。
5. 选择在线 Host，再选择已有 Workspace 或浏览远端目录后打开。

公开服务使用托管的 Remote 中继；单账号自建可使用仓库内的[最小 Server](apps/server/README.zh.md)，其 Web 页面仅提供设备状态。

## 授权恢复与多实例

每个同时运行的 Host 都需要独立设备身份。共享 `DSH_HOME` 的 profile 也共享 Remote
凭据；如果两个实例都需要在线，请分别设置独立的 `DSH_HOME` 并授权。
当另一连接替换当前 Host（`CONNECTION_REPLACED`）时，自动重连会停止，避免两个实例反复互踢。

过期凭据通过跨进程锁串行刷新。Server 拒绝握手时，Host 可刷新凭据后重试一次。
若刷新被拒绝，请执行 `/remote login [github|zhihu]`，或在 Remote 设置中重新授权 Host。
日志以 `phase: credential_refresh` 标记刷新失败，不输出凭据。

`SERVER_CREDENTIALS_BUSY` 表示其他进程持有刷新锁。若此前异常退出，请停止共享该
`DSH_HOME` 的**所有**实例，仅移除 `remote/servers/<serverHash>/<role>/` 下对应凭据旁的
`server-credentials.json.refresh-lock` 目录，然后重新授权并启动。
锁不会按存续时间被强行抢占，以免暂停中的进程恢复后继续使用旧 token。

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

Harness 会话的「文件」（工作区文件夹浏览、UTF-8 文本分页只读预览）和「终端」入口位于会话标题栏，需要 DSH `0.1.6-alpha.2` 或更新版本（含 `0.1.7-rc.1`）的原生接口及更新后的 Remote Host 插件。使用终端前，在 Host 本地 Remote 设置中开启「远程终端」。终端面板只列出现有终端，仅标题栏「＋」才会新建；Android 从 Host 快照恢复本设备归属的终端，断线不重放输入。文件面板的返回在文件内回到所在目录，仅在根目录关闭工具，刷新同样位于标题栏。CodeX 会话不提供这些原生工具。

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
- 交互终端需在 Host 本地开启 `terminal.enabled`（默认关闭），以 Host 用户身份运行，独立于 Agent 审批；不开放通用工具 RPC 或远程桌面。
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

Plugin `0.4.17` 同时兼容 DeepSeek Harness `dsh-v0.1.1-rc.2` 与
`dsh-v0.1.2-alpha.1`–`rc.1`：rc.2 继续使用官方 legacy `ApiProxy`，v0.1.2 使用官方
Typert Remote Gateway；另外支持 `dsh-v0.1.5-rc.1` 与 `dsh-v0.1.6-alpha.1` 的 Session V3
官方 Typert Remote Gateway——`0.1.6` 上报的 patch 为 `6`，会选中同一个 Session V3
profile，不需要额外的 wire format 适配层。运行 rc.2 的 `0.4.13` Client 仍可通过
legacy capability 降级连接旧 rc.2 Host。

Remote Web/Desktop 和 Android App 还会把已发布旧会话中仍然上报的已退役 `code`
agent preset 归一为 `ptc`，因此旧会话可以在 `dsh-v0.1.5-rc.1` 或 `dsh-v0.1.6-alpha.1`
上恢复，而无需修改 DeepSeek Harness 本身。

Desktop 两端必须使用兼容的 Harness carrier。`0.4.17` 会在 Host 暴露 rc.2 ApiProxy 时
选择 legacy ApiProxy 路径，Session V3 Desktop Client 也可以通过 Remote 侧的历史与事件归一化
打开 legacy v0.1.2 Typert Remote Host。legacy Typert Client 仍会在切换原生 UI 或修改 Workspace
前拒绝 Session V3 Host。

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

## 最小自部署 Server

仓库内的 [`apps/server`](apps/server/README.zh.md) 提供可独立运行的单账号 Relay Server。通过 `DSH_SERVER_ACCOUNT`、`DSH_SERVER_PASSWORD` 配置账号密码；Web 提供登录和设备状态。Host 与客户端填写同一 Server 地址并使用该账号登录，设备凭据在重启后保留。

## 原生侧栏与开发服务预览

Harness `0.1.6-alpha.2` 及更新版本的原生工作区文件树与只读预览通过官方 API 接入，旧 dsh-file-viewer 仍可用。Remote Host 同时支持两种宿主代际：≤`0.1.6` 的 settings 注册表路径与 `0.1.7-rc.1` 的 Volatile entry 路径在运行时特性检测，同一份包即可覆盖。
文件读取遵循 Host Session 文件系统权限，可能包含工作区外的已授权文件；目录树仍限于工作区。
原生侧栏功能面向 Harness Session，CodeX 内存投影不自动获得原生文件/终端能力。

在 **Host 本机 → Remote 插件设置** 中开启「远程终端」（切换即保存并立即生效），填写「远程预览端口」后点右侧「保存访问设置」；两项运行时访问控制都无需重启 Host。

终端默认关闭，尝试使用时会提示在 Host 开启；不要用该开关修复账号登录或普通连接错误。
终端以 Host 用户身份执行命令，独立于 Agent 审批；只列出本 Remote 设备创建的终端，断线不重放输入。

在 Desktop / 连接本机 Harness 的浏览器中，Remote 顶栏点击「预览服务」，输入已授权端口，
即可在原生浏览器侧栏访问 Host 的 `127.0.0.1` HTTP 服务。支持 WebSocket 与采用当前 origin 的热更新，
可使用 P2P 或 Relay；相对资源路径保持不变。仅绑定 IPv6 的服务需要另行监听 `127.0.0.1`。
预览使用随机独立本机 origin，退出 Remote 或断线即关闭；不适用于远程 Web 页面、Android 或 VS Code 预览 UI。
Host 未配置端口时默认拒绝。它允许与授权开发服务交互，并非只读 HTTP；不支持任意内网地址、CONNECT、
HTTPS upstream、跨 origin 重定向或代码中硬编码的远端 localhost URL。请求体最多 1 MiB、响应最多 64 MiB。
设置须在 Host 本地修改，不能从 Remote 会话开启自身的访问权限。
