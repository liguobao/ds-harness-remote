# Repository Guide for Agents

本文件面向在当前仓库工作的编码 Agent，记录仓库边界、项目结构、实现状态、验证命令和协作约束。用户产品说明与 Plugin 使用方式见 `README.md`。

## Repository Boundary

当前仓库实现：

- DeepSeek Harness Plugin（Remote Host + 本地 Remote 工作区入口 + dsh-TUI `/remote` 管理命令；无用户可见的 Client 模式）
- Android Client（账号授权 + Adaptive transport + rc.2 ApiProxy / v0.1.2 alpha.1–rc.1 / v0.1.5 rc.1 与 v0.1.6 alpha.1 Session V3 Typert Remote + 可选 CodeX Remote）
- VS Code Client（账号授权 + Host 信任固定 + rc.2 ApiProxy / v0.1.2 alpha.1–rc.1 / v0.1.5 rc.1 与 v0.1.6 alpha.1 Session V3 Typert Remote 会话/Prompt）
- Protocol、Crypto、WebRTC、Client Core 等共享能力
- 开源自部署 Server（`apps/server`）：环境变量单账号、JSON 文件持久化设备凭据、Control/Noise handshake forwarding/opaque Relay、Web 登录与设备状态页，以及 Dockerfile/Compose 部署入口
- 依赖外部 Server 的 Mock Host/Smoke Client
- Server 设计与跨仓库协议契约

当前仓库禁止实现：

- 完整多账号 Server、Remote Web 会话界面、Admin backend/frontend
- 完整 Server 的数据库、migration、queue 及 Kubernetes、Terraform 等部署基础设施
- `apps/server-web`、`apps/web` 等完整 Server 站点源码

本仓库包含可独立部署的开源 Server，允许在 `apps/server` 内维护上述最小版本的 runtime、文件持久化、限流、Web 页面和 Docker 部署。完整多账号 Server、Remote Web 和 Admin 仍由独立 Server 仓库作为同一站点实现。本仓库必须保留 `docs/server.md` 和 `docs/protocol.md`；不得把完整 Server 的设计目标描述成开源自部署版本已实现的能力。

## Project Structure

```text
apps/
  android/             React Native / Expo Android Client（账号授权 + ApiProxy/Typert/CodeX Remote tunnel）
  vscode/              VS Code Extension Client（Host 列表、加密连接与远程会话）
  browser/             Chrome/Edge MV3 入口（Web 授权换取独立凭证 + 在线 Host + 打开 Remote Web）
  server/              开源自部署 Server（单账号 Relay、登录/设备状态页、Docker 部署）
packages/
  plugin/              Host runtime、Remote 工作区入口与原生 API 代理
  protocol/            Remote/Control frame 类型和运行时校验
  crypto/              X25519、HKDF、ChaCha20-Poly1305 与 Noise IK
  webrtc/              Relay、WebRTC、LAN transport 抽象
  client-core/         RPC correlation 与 Remote event 分发
examples/
  mock-host/           外部 Server 互操作工具
docs/
  design/              产品与功能设计
  plugin-integration.md Host 账号登录、授权注册与凭证接入契约
  protocol.md          Host/Server/Client 权威线协议
  server.md            完整 Server 设计与互操作契约、自部署版本范围入口
```

仓库根包同时是 DSH Desktop 的 GitHub 安装边界：根 `package.json` 必须保留
`dsh.bundle.patch`、Host/Client exports、CLI bin 和 `cordis.patch.yml`；GitHub 默认禁用
构建脚本，所以根 `index.js`、`packages/plugin/dist/index.js`、`client.github.js` 与
`packages/plugin/bin/ds-harness-remote.js` 是需要提交的发布入口。

空的 Web/UI 预留目录不应创建。Expo 生成的 `.expo/web` cache、`.webp` 图片格式和 `packages/webrtc` 不属于 Remote Web 项目。

## Current Status

| 模块 | 状态 | 主要剩余工作 |
| --- | --- | --- |
| Plugin Host | 账号密码/主机匹配码接入、dsh-TUI 无 browser connection 时默认开启 Host、GitHub/知乎二维码授权与可点击 URL、原生 `/remote` login/status/logout 与 Tab 补全、同账号 peer 校验、隔离身份/凭证、Relay/Noise IK、并发 Client 与按连接隔离的 rc.2 ApiProxy / v0.1.2 alpha.1–rc.1 Typert Remote allowlist bridge 已实现；v0.1.5 rc.1 Session V3 与 v0.1.6 alpha.1 支持已接入，并已在独立 `dsh-v0.1.6-alpha.1` 实例上验证 Web → Host 主链路；真实 Desktop/dsh-TUI 跨机 E2E 已验证；无自定义 Harness 业务适配层 | v0.1.5/v0.1.6 跨机 E2E、legacy owner 恢复体验、allowlist 覆盖审计、跨平台 picker 边界 |
| Plugin Remote Client | 与 Host runtime 同时启动，无需 Client 模式；Remote 模态框支持 GitHub/知乎扫码与账号密码登录、本机过滤、主机/版本信息、已有 Harness/CodeX Workspace、远端目录浏览与 CodeX Project 注册、ApiProxy/Typert 图片 Prompt/回显，以及配合 dsh-file-viewer 的受限只读文件预览，随后复用原生 Harness UI；加密通道 capability 探测保留 legacy Host 降级并拒绝 ApiProxy/Typert 混连；Web → Host 主链路已在 v0.1.5 rc.1 与 v0.1.6 alpha.1 上验证 | CodeX Project 新建跨设备 E2E、断线重连恢复、页面级导航接口、长期稳定性 |
| Android | 已迁移到 rc.2 ApiProxy / v0.1.2 Typert Remote 双数据面，并直接接入可选 `codex.app.*`：账号登录注册、成员设备列表与 identity key 固定、Adaptive transport + Noise、capability 探测、Harness/CodeX Workspace 与 Session、远端目录选择与 CodeX Project 注册、工作区收藏与首页快捷链接（点击直达该工作区最近会话）、分页 History/live frame、模型/权限、文字/图片 Prompt、interrupt 与审批，以及跟随系统/英文/简体中文界面；启动固定进入设备列表，`resolveAutoConnectDevice` 自动连接逻辑保留但不触发；rc.2/v0.1.2/CodeX 真机跨机 E2E、图片分块、重连和 WebRTC 已验证 | CodeX Project 新建跨设备 E2E、协议 conformance fixtures、长期稳定性与跨设备回归 |
| VS Code | Extension 基础已实现：SecretStorage 身份/凭证、账号/扫码登录、Host 指纹固定、Adaptive transport + Noise、rc.2 ApiProxy / v0.1.2 Typert Remote Host→Workspace→Session 导航、Prompt、permission command 与编辑区会话面板 | Extension Host 跨机 E2E、实时流式更新、question 界面与重连恢复 |
| Browser | Chrome/Edge MV3 轻量入口已实现：临时读取已登录 Web 的授权并换取隔离的 device credential，popup 展示在线 Host，点击后直接打开同源 Remote Web；不承载账号登录、Remote transport、ApiProxy 或会话 UI；unpacked 联调与 Web 授权跳转、独立 Server 合约联调已验证 | 随独立 Server 合约变化同步 |
| Protocol | Control/Relay 与 ApiProxy tunnel 基础已实现 | 完整 Zod schema、limits、golden vectors |
| Crypto | 基础原语与标准 Noise IK 已实现 | 第三方实现审查、rekey、跨端 conformance |
| Relay Transport | Protocol v1 control/relay 已实现 | 心跳、限制协商、断线状态传播 |
| WebRTC | signaling、ICE、TURN、LAN/P2P/Relay 自适应路径基础已实现，Android 真机与 Host werift 互操作已验证 | 网络切换恢复和长期稳定性 |
| Client Core | ApiProxy tunnel RPC/Event 关联基础已实现 | reconnect、pending call/stream 恢复 |
| Codex Remote 领域 | 作为现有 Remote Plugin 内部可选领域：Host stdio App Server、默认开启且可在设置中关闭、固定 allowlist 与连接隔离已实现；Desktop 以 rc.2 ApiProxy / v0.1.2 Typert 内存载体复用 DSH 原生 UI，Android 直接消费同一 `codex.app.*` 并复用移动端 Workspace/Session/Chat；两端可通过受限 `project/create` 将 Host 上已存在的真实目录注册为 Project，并都只保留内存展示投影；既有 Desktop 与 Android 真机 E2E、大 History、断线恢复和多 Client 观察已验证 | Project 新建跨设备 E2E、长期稳定性、跨版本回归和安全审查 |
| Mock Host | 旧 Android Remote RPC 联调工具，当前冻结 | 若恢复 Android 再迁移或替换 |
| Desktop | Host 设置、Remote 工作区模态框、远程 Header、连接链路与加密状态已接入 Harness Web UI，Host status 由 loopback SSE 推送（无固定间隔的 status 轮询），原生窗口跨机 E2E 已验证 | 多窗口、休眠/唤醒和代理网络回归 |
| 开源自部署 Server | `apps/server` 已实现单账号授权、设备凭据持久化与刷新、Control/Noise 握手转发和加密 Relay、Web 登录与设备状态页；提供 Dockerfile/Compose；单进程、Relay-only，不提供 Remote Web 会话界面或 WebRTC/TURN | Docker 实际构建与启动验证、真实 Desktop/Android/VS Code 跨机 E2E、反向代理长期连接回归 |
| 完整 Server/Remote Web/Admin | 独立 Server 仓库已有实现，REST、Control WebSocket、Relay、Signaling 与 conformance fixture 跨仓库联调已完成 | 完整站点 runtime 变更在独立 Server 仓库完成，并同步跨仓库契约 |

完整任务和优先级以 `TODO.md` 为准。不得把 TODO 中的目标能力描述成已经完成。

## Development

环境：Node.js 22、pnpm 9.15.4。Android 原生开发还需要 Android Studio、Android SDK 和 JDK。

```bash
pnpm install
pnpm --filter './packages/**' -r build
pnpm -r check
node scripts/verify-dsh-plugin.mjs
pnpm -r test
NODE_ENV=production pnpm -r build
```

先构建 `packages/**`，确保 workspace package 从 fresh clone 开始也能解析 `dist` 类型。根 `package.json` 刻意不声明 `scripts`，避免 pnpm 将 DSH Desktop 的 GitHub 安装误判为需要执行构建脚本。

常用命令：

```bash
pnpm --filter @dsh-remote/plugin build --watch
pnpm --filter @dsh-remote/android android
pnpm --filter @dsh-remote/android start
DSH_REMOTE_SERVER=ws://127.0.0.1:8080/ws/v1/connect pnpm --filter @dsh-remote/mock-host dev
```

Android 不能使用 Expo Go，因为 `react-native-webrtc` 依赖原生模块。

开源自部署 Server 的独立验证命令：

```bash
pnpm --filter @dsh-remote/protocol build
pnpm --filter @dsh-remote/server check
pnpm --filter @dsh-remote/server test
pnpm --filter @dsh-remote/server build
```

本地启动、环境变量与 Docker 部署见 `apps/server/README.md` 和 `apps/server/README.zh.md`。Server 设备凭据数据和 `.env` 不得提交。

Windows 自动安装脚本将独立 Node.js/pnpm/DSH 放在 `%LOCALAPPDATA%\dsh-remote`（可用
`DSH_INSTALL_DIR` 覆盖），用 WinSW `3.0.0-alpha.11` 交互式账户提示注册当前用户的服务；
安装和卸载需在安装所属账户的管理员 PowerShell 中执行，脚本只检查权限、不自动提权；
首次安装需 Windows 账户密码，禁止把密码写入 XML。服务与 CLI 共用固定 `DSH_HOME`，
卸载保留 profile 和凭证，不清理旧全局 npm 环境。Windows 实机回归尚待完成。

## Validation Baseline

截至 2026-09-16：

- workspace check 与 DSH bundle 校验通过
- Plugin test：28 个测试文件、228 个测试；Android test 通过：14 个测试文件、163 个测试。本机
  Windows 运行 `tests/codex-domain.test.ts` 有 3 个既有的路径分隔符/目录顺序平台假设失败，
  `tests/werift-rtc.test.ts` 的 `lan` 候选断言受本机 VPN/虚拟网卡候选池影响，两者均与
  Remote status 推送改动无关；完整 workspace 数量以当前 CI 输出为准
- workspace build 通过，包括 Android Hermes bundle
- 真实设备验证已覆盖 Web → Host、Desktop/dsh-TUI 跨机、Android Harness/CodeX、WebRTC、CodeX Desktop/Android E2E 与独立 Server 跨仓库联调
- 独立 `dsh-v0.1.6-alpha.1` 实例验证通过：Plugin 树加载、Host identity、Codex 域与 client bundle 下发正常，Web → Host 主链路可用；peer range 与构建/测试基线已升级到 `@deepseek-ai/dsh-*@0.1.6-alpha.1`
- `git diff --check` 通过

已知构建警告：Metro 对 `@noble/hashes/crypto.js` 使用 package exports fallback。该问题记录在 `TODO.md`，不得静默删除说明。

2026-09-20 开源自部署 Server 补充验证：check、11 个核心测试与生产 build 通过；构建产物本地启动后，健康检查、页面及静态资源、账号登录、Cookie 鉴权与未授权拒绝通过。Docker daemon 未运行，未验证镜像构建和容器启动；真实跨机与反向代理长期连接仍待验证。独立 Server 的既有联调结果不等于本版本已完成部署验收。

## Implementation Rules

1. `docs/protocol.md` 是线协议权威来源。代码与文档冲突时，先按协议实现；必要的协议澄清必须同步更新文档和共享类型。
2. Plugin 不监听公网端口，只建立出站连接。
3. Remote business message 只能进入已认证的加密 channel；明文、未知 connection、错误 target、重放和 identity mismatch 必须 fail closed。
4. Server membership 与 Host 本地 trusted peer 必须同时成立。
5. v1 permission decision 只允许 `allow_once | deny`，禁止恢复 `allow_session`。
6. 按用户 2026-09-20 授权，支持官方原生文件树/只读预览、默认关闭的 `terminal.enabled` 交互终端，以及 `loopback.ports` 明确授权的 HTTP/WebSocket 预览。文件通过官方 `workspaceFiles`/`officeToPdf` 或已有 dsh-file-viewer provider 读取，禁止新增直接 filesystem 写入、远程桌面或通用 Harness tool RPC。终端以 Host 用户权限运行，独立于 Agent 审批；按设备固定终端归属与连接输入权，断线不重放输入。loopback Host 只出站连接 `127.0.0.1` 白名单端口；Desktop Client 可监听随机本机端口承载独立预览 origin，禁止监听公网、任意目标、CONNECT 和通用 TCP 转发。
7. Token、私钥、主机匹配码、prompt、源码和工具输出不得写日志。
8. Harness v0.1.1 rc.2 业务层只使用官方 `ApiProxy`，v0.1.2 alpha.1–rc.1 与 v0.1.5 rc.1 / v0.1.6 alpha.1 Session V3 业务层只使用官方 `TypertGateway` Remote carrier；原生侧栏使用官方 `workspaceFiles` / `officeToPdf` / `terminal` 固定 allowlist；保留 dsh-file-viewer provider 通道。除规则 10 规定的 CodeX 内存展示载体外，禁止增加 session/agent/workspace/permission adapter、另一套 Harness wire format 或通用文件系统协议。
9. 不修改用户已有变更，不提交 `node_modules`、Expo cache、Android build 产物或个人 Agent 配置；唯一允许提交的 `dist` 是根 DSH GitHub Bundle 所需的 `packages/plugin/dist/index.js` 与 `client.github.js`，另需保留根 Host 入口 `index.js`。
10. Codex 支持必须保留在现有 Remote Plugin 内，并作为 `packages/plugin/src/codex/` 独立业务领域实现；默认开启且可在设置中关闭，使用独立 capability/RPC/event/state。允许 Client Plugin 以临时 rc.2 ApiProxy / v0.1.2 Typert 载体复用 DSH 原生 UI，也允许 Android 直接消费同一 `codex.app.*` 并只在内存中投影其移动端 Workspace/Session/Chat；两者都禁止写入 DSH SessionStore、Workspace 数据库或 Harness 日志。远端只允许编译期固定 App Server allowlist；Workspace authority 优先来自 CodeX App Server 的 `project/list`，该接口不可用或无可用根目录时才可回退到 App Server 已通过 `thread/list` 返回的绝对 `cwd`。`project/create` 只可注册 Host 上已存在的单个绝对目录，Host 必须执行 `realpath` 并确认目标是目录，且上游返回的新 Project 才能扩展 authority。新 Thread 还可使用这些 authority 根内经过词法路径与 `realpath` 双重校验的真实子目录，禁止推测共同父目录或越界接受 Client 自报路径。

## Test Policy

用户要求非核心功能不写 Test。测试预算只用于：

- Protocol 编解码、版本和 schema
- 身份、加密、篡改和重放
- Account authorization、Host registration code、Control handshake、Relay authorization
- RPC correlation、权限 fail-closed、ApiProxy/Typert Remote endpoint allowlist、事件顺序和恢复
- Transport fallback/reconnect 等核心状态机

纯展示 UI、普通文案、静态说明、非关键脚本和样式调整不单独增加测试。

## Documentation Rules

- `README.md`：面向用户的默认英文入口；写项目介绍、特性、安全边界、Plugin/Client 使用和开源 Server 自部署入口。
- `README.zh.md`：与根 README 对应的中文版本；功能和版本信息必须同步。
- `AGENTS.md`：面向编码 Agent，写仓库结构、进度、命令和实现约束。
- `TODO.md`：未完成任务与优先级。
- `apps/server/README.md`、`apps/server/README.zh.md`：开源自部署 Server 的实际能力、配置、运行方式和验证边界。
- `docs/server.md`：完整 Server 项目的产品/功能设计，并说明本仓库自部署版本的范围。
- `docs/plugin-integration.md`：Host Plugin 对接 Server 的账号认证、设备认证与凭证状态机，以及最小自部署版本支持的子集。
- `docs/protocol.md`：跨仓库协议规范。
- `vibe-coding.md`：原始需求背景，当前边界以 `README.md`、`AGENTS.md` 和 `docs/README.md` 为准。

文档发生范围变化时，应同时检查以上入口，避免 README、TODO、设计文档和实际目录互相冲突。

## Authorization recovery (Issue #70)

Plugin 凭据刷新使用跨进程目录锁，获得锁后重新读取凭据；握手被拒绝后最多刷新恢复一次。
`4003` 映射为 `CONNECTION_REPLACED` 并停止自动抢占，同机并行 Host 应分别设置 `DSH_HOME`。
锁不按时间强行抢占；`SERVER_CREDENTIALS_BUSY` 的异常退出恢复步骤见 README。
核心测试覆盖多进程刷新互斥与鉴权恢复状态机，Windows 双实例实机验证仍待完成。

## Native sidebar and development preview (2026-09-20)

开发依赖升级到 Harness `0.1.7-rc.1`，运行时按能力检测同时支持 ≤`0.1.6` 的 settings 注册表路径与 `0.1.7-rc.1` 的 Volatile entry 路径（`typeof settings.register === 'function'` 分流）。终端与 loopback 设置只能在 Host 本地修改，`settings/update|replace|mutate` 禁止远程修改 `ds-harness-remote` 和 `dsh-remote`。终端默认关闭；loopback 默认无端口。「远程终端」开关切换即保存并立即更新运行时拦截，「保存访问设置」按钮只提交 Loopback 端口（位于端口输入框右侧）；两者都无需重启 Host。预览入口位于 Remote Header「预览服务」，第一版限 Desktop / 连接本机 Harness 的浏览器；不把本机预览 URL 作为远程 Web 或 Android 可用地址。跨机、Windows 和真实网络热更新回归仍需另行验证。

## Android native tools (2026-09-21)

Android Harness 会话已接入 Files/Terminal：官方 workspaceFiles 目录与分页文本只读预览，
terminal 创建/list/follow/retain/write/resize/close；不对 CodeX 投影开放。终端使用本地打包
xterm + react-native-webview，需重新构建 APK。`apps/android/scripts/build-terminal.mjs` 生成
忽略的 `src/generated/terminal-html.ts`，prepare:workspace/check 和 CI APK 工作流负责生成。
权限控件兼容旧版 permissions.options 与新版仅 currentValue 的投影，后者调用官方
permissionPresets/catalog（已加入 Host 固定只读 allowlist）；Host 插件需同步更新。
核心测试覆盖 catalog 合约与终端输入权/事件顺序/断线不重放。跨机和原生 UI 真机验证仍待完成。

2026-09-22 标题栏入口（Issue #72 PR1）：Files/Terminal 入口移到会话标题栏图标，终端面板
标题栏「＋」才新建终端（打开只列出现有终端），文件面板刷新与层级返回同样在标题栏；未改
公共 TopBar 契约。

本次本地验证：Android 类型检查与 16 个测试文件 / 174 个测试通过；Plugin 类型检查、
5 个 Host Remote bridge 核心测试及 DSH bundle 校验通过。Plugin 全量测试首次有 5 个超时，
相关 3 个文件串行重跑 42 个测试通过。Hermes 导出初次通过；最终原生 APK 预构建未完成，
workspace 全量 check 在 Server web 类型检查处停滞，不作为通过记录。最终 APK 由 CI 构建，
原生键盘、TalkBack 和跨设备行为尚未验证。

Android 只读预览（Issue #72）：`workspace-file-preview.ts` 复用官方 stat/readBytes 和
Office generation/render，校验文件版本、分块、大小和取消；图片/PDF 上限 8 MiB，Office
源文件上限 50 MiB。PDF.js 固定版本与 xterm 一起经 `build:renderers` 本地打包；prepare/check、
CI/release APK 均需生成忽略的 renderer 源文件。PDF 仅单页画布预览，无脚本、外链、导出、
明文文件缓存或文本选择；不增加 Host 端点或写权限。Office 单次调用使用更长客户端超时，
Host 限额仍生效。原生真机与真实跨设备文件预览验收尚待完成。

该预览分支的全仓 check/生产 build、Android 197 测试、client-core 38 测试及本地 PDF 浏览器
烟测通过；全仓 test 仍有既有 codex-domain Windows 平台假设的 3 个失败。原生 APK 构建在
Expo CMake/Prefab 的 Windows 超长批处理路径处失败，不能视为已完成 APK 或真机验收。
