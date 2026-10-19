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

Plugin bundle 构建统一 esbuild 的依赖模块路径标签，避免 pnpm isolated / hoisted 安装布局
造成已提交 JS 差异；保留 source map 的真实路径以便本地调试。CI 重建后必须同时检查
`packages/plugin/dist/index.js` 和 `packages/plugin/dist/client.github.js` 与提交版本一致。

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
| Crypto | 基础原语、标准 Noise IK 与确定性 golden vector 已实现 | 第三方实现审查、rekey、跨端执行 golden vector |
| Relay Transport | Protocol v1 control/relay 已实现 | 心跳、限制协商、断线状态传播 |
| WebRTC | signaling、ICE、TURN、LAN/P2P/Relay 自适应路径基础已实现，Android 真机与 Host werift 互操作已验证 | 网络切换恢复和长期稳定性 |
| Client Core | ApiProxy tunnel RPC/Event 关联基础已实现 | reconnect、pending call/stream 恢复 |
| Codex Remote 领域 | 作为现有 Remote Plugin 内部可选领域：Host stdio App Server、默认开启且可在设置中关闭、固定 allowlist 与连接隔离已实现；Desktop 以 rc.2 ApiProxy / v0.1.2 Typert 内存载体复用 DSH 原生 UI，Android 直接消费同一 `codex.app.*` 并复用移动端 Workspace/Session/Chat；两端可通过受限 `project/create` 将 Host 上已存在的真实目录注册为 Project，并都只保留内存展示投影；既有 Desktop 与 Android 真机 E2E、大 History、断线恢复和多 Client 观察已验证 | Project 新建跨设备 E2E、长期稳定性、跨版本回归和安全审查 |
| Mock Host | 旧 Android Remote RPC 联调工具，当前冻结 | 若恢复 Android 再迁移或替换 |
| Desktop | Host 设置、Remote 工作区模态框、远程 Header、连接链路与加密状态已接入 Harness Web UI，Host status 由 loopback SSE 推送（无固定间隔的 status 轮询），原生窗口跨机 E2E 已验证 | 多窗口、休眠/唤醒和代理网络回归 |
| 开源自部署 Server | `apps/server` 已实现单账号授权、设备凭据持久化与刷新、Control/Noise 握手转发和加密 Relay、Web 登录与设备状态页；提供 Dockerfile/Compose；单进程、Relay-only，不提供 Remote Web 会话界面或 WebRTC/TURN | Docker 实际构建与启动验证、真实 Desktop/Android/VS Code 跨机 E2E、反向代理长期连接回归 |
| 完整 Server/Remote Web/Admin | 独立 Server 仓库已有实现，REST、Control WebSocket、Relay、Signaling 与 conformance fixture 跨仓库联调已完成 | 完整站点 runtime 变更在独立 Server 仓库完成，并同步跨仓库契约 |

完整任务和优先级以 `docs/TODO.md` 为准。不得把 TODO 中的目标能力描述成已经完成。

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
pnpm --filter ds-harness-remote build
pnpm --filter ds-harness-remote check
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

安装相关入口仅保留 `scripts/install.sh`（macOS/Linux）。不提供 Windows、独立卸载或 Token 包装脚本；
构建/测试辅助脚本不在此清理范围内。按用户本轮明确授权，Linux 要求 root，缺少 DSH 时允许安装配套
Node.js、DSH 和私有 pnpm，支持一次性 Host 注册 Token，并配置、启用和启动 systemd 系统服务，无需 linger。
系统服务以 root 运行时必须明确提示其 Host/终端具有 root 权限。只操作归属匹配的安装器管理服务，不接管其他
DSH_HOME 或未知旧服务。已有 DSH 复用而不自动升级；不修改系统 Node.js、全局 PATH 或 npm 配置。
macOS 仍使用普通用户，优先复用 Desktop 官方 launcher，否则已有 CLI；两者都没有才报错，不安装 Desktop/DSH/Node.js
或创建后台服务。支持 `DSH_COMMAND`、`DSH_PROFILE`、`REMOTE_VERSION`，保留已有 `DSH_HOME`；独立 CLI 默认 `web`，
Desktop 默认保留的 `desktop` profile，只能由其官方 launcher 管理。一次性 Token 复用官方身份/凭据与既有注册码接口，
不得记录或作为持久设备凭据使用。Windows 用户使用官方插件管理或已有 Harness 的官方命令。
卸载先按安装指南停用 Linux 系统服务，再通过官方插件管理或 `dsh plugin remove` 移除 Remote；不自动删除 runtime、
凭据或迁移旧 service。Desktop npm 包当前版本为 `ds-harness-remote@0.5.13`。

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

已知构建警告：Metro 对 `@noble/hashes/crypto.js` 使用 package exports fallback。该问题记录在 `docs/TODO.md`，不得静默删除说明。

2026-09-20 开源自部署 Server 补充验证：check、11 个核心测试与生产 build 通过；构建产物本地启动后，健康检查、页面及静态资源、账号登录、Cookie 鉴权与未授权拒绝通过。Docker daemon 未运行，未验证镜像构建和容器启动；真实跨机与反向代理长期连接仍待验证。独立 Server 的既有联调结果不等于本版本已完成部署验收。

## Implementation Rules

1. `docs/protocol.md` 是线协议权威来源。代码与文档冲突时，先按协议实现；必要的协议澄清必须同步更新文档和共享类型。
2. Plugin 不监听公网端口，只建立出站连接。
3. Remote business message 只能进入已认证的加密 channel；明文、未知 connection、错误 target、重放和 identity mismatch 必须 fail closed。
4. Server membership 与 Host 本地 trusted peer 必须同时成立。
5. v1 permission decision 只允许 `allow_once | deny`，禁止恢复 `allow_session`。
6. 按用户 2026-09-20 授权，支持官方原生文件树/只读预览、默认开启且可在详细 Remote 设置中关闭的 `terminal.enabled` 交互终端，以及 `loopback.ports` 明确授权的 HTTP/WebSocket 预览。文件通过官方 `workspaceFiles`/`officeToPdf` 或已有 dsh-file-viewer provider 读取，除下述 2026-10-18 workspace upload 授权外，禁止新增直接 filesystem 写入、远程桌面或通用 Harness tool RPC。终端以 Host 用户权限运行，独立于 Agent 审批；按设备固定终端归属与连接输入权，断线不重放输入。loopback Host 只出站连接 `127.0.0.1` 白名单端口；Desktop Client 可监听随机本机端口承载独立预览 origin，禁止监听公网、任意目标、CONNECT 和通用 TCP 转发。
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

新增或保留测试应能说明所保护的核心协议、安全边界或状态转换。同一共享实现的同一输入
只在所属 package 测一次；Client 测试应覆盖其独有的接入与恢复行为，不复制共享包的完整
schema/fixture 用例。跨端 conformance 必须在真实目标 runtime 运行；在 Node 中重复运行
共享协议代码不计为 Android 原生验证。禁止用源码字符串、组件布局、图标、配色、文案或
自定义快捷提示的增删改断言扩充自动化测试；这些改动以类型检查和必要的人工烟测验证。
同一契约、同一状态转换的输入变体优先使用命名场景矩阵，避免每行单独注册测试。
场景之间必须复用原有 setup/teardown，保持 mock、计时器和临时资源隔离；失败需要报告
具体场景，并继续执行同组其他场景。测试数量指注册的契约测试数，不代表边界输入数。
不要为凑数量把互不相关的核心断言塞进一个测试，也不要通过 skip/exclude 隐藏测试。

2026-10-07 两轮测试清理：全仓从 95 文件 / 1082 用例减至 83 文件 / 811 用例；Android 从
29 文件 / 323 用例减至 18 文件 / 138 用例，Plugin 从 42 文件 / 378 用例减至
41 文件 / 342 用例。删除非核心 UI/普通展示与配置挂载测试、未触发的自动连接 helper
测试、mock 自身行为测试和 Android 在 Node 中重复运行的 86 个共享协议 fixtures。
Protocol 从 235 减至 187 用例：完整保留 86 个跨仓库 fixtures，删除已被它们覆盖的手写
断言，以及已有尺寸矩阵和常量精确值断言覆盖的重复测试；额外的安全边界、篡改、重放、
授权、权限隔离与恢复测试保留，RPC 两种超时参数分支也分别保留。清理前后全仓 test 均
通过，清理后全仓 check、共享包 build、DSH bundle
校验与 `git diff --check` 通过。移除已无引用的 React test renderer 开发依赖；未修改业务代码。

2026-10-07 第三轮契约合并：按用户要求，将上述 811 个注册测试合并为 506 个，仍为
83 个文件；Plugin 246、Android 86、Protocol 78、WebRTC 40、client-core 32、Server 9、
VS Code 7、Crypto 7、Browser 1。本轮不删除边界场景：同一 schema 的字段拒绝、同一后端
契约的版本变体、RPC 终止原因、权限确认和历史恢复改为命名场景矩阵；86 个共享协议
fixtures 全部保留，按操作及 Control frame 类型注册为 24 个契约测试。合并案例之间复用
原有 hooks，失败后汇总具体案例名称；原有 fragment magic 的预期失败测试独立保留。
全仓 check、506 个 test、DSH bundle 校验与 `git diff --check` 通过；场景执行器的继续
执行、fixture 重置和失败诊断已烟测，合并前后的场景断言体保持一致。未修改业务代码。

## Documentation Rules

- `README.md`：面向用户的默认英文入口，也是 GitHub 默认 README；写项目介绍、特性、安全边界、Plugin/Client 使用和开源 Server 自部署入口。
- `README.en.md`：保留的英文入口，与默认 `README.md` 保持内容一致。
- `README.zh.md`：保留的中文入口，与默认 `README.md` 保持功能和版本信息一致。
- `AGENTS.md`：面向编码 Agent，写仓库结构、进度、命令和实现约束。
- `docs/TODO.md`：未完成任务与优先级。
- `docs/CHANGELOG.md`：版本更新记录。
- `docs/PRIVACY.md`：隐私说明。
- `docs/design/PRODUCT.md`、`docs/design/DESIGN.md`：产品定位与界面设计系统。
- `apps/server/README.md`、`apps/server/README.zh.md`：开源自部署 Server 的实际能力、配置、运行方式和验证边界。
- `docs/server.md`：完整 Server 项目的产品/功能设计，并说明本仓库自部署版本的范围。
- `docs/plugin-integration.md`：Host Plugin 对接 Server 的账号认证、设备认证与凭证状态机，以及最小自部署版本支持的子集。
- `docs/protocol.md`：跨仓库协议规范。
- `docs/archive/vibe-coding.md`：原始需求背景，当前边界以 `README.md`、`AGENTS.md` 和 `docs/README.md` 为准。

文档发生范围变化时，应同时检查以上入口，避免 README、TODO、设计文档和实际目录互相冲突。

根目录保留中英文 README、AGENTS 和构建、发布所需配置与入口；其他说明文档集中在 `docs/`，产品设计集中在 `docs/design/`，原始需求归档到 `docs/archive/`。移动文档时同步更新相对链接和仓库路径引用。

## Authorization recovery (Issue #70)

Plugin 凭据刷新使用跨进程目录锁，获得锁后重新读取凭据；握手被拒绝后最多刷新恢复一次。
`4003` 映射为 `CONNECTION_REPLACED` 并停止自动抢占，同机并行 Host 应分别设置 `DSH_HOME`。
锁不按时间强行抢占；`SERVER_CREDENTIALS_BUSY` 的异常退出恢复步骤见 README。
核心测试覆盖多进程刷新互斥与鉴权恢复状态机，Windows 双实例实机验证仍待完成。

## Native sidebar and development preview (2026-09-20)

开发依赖升级到 Harness `0.2.0-rc.1`（同时兼容 `0.1.7-rc.1`），运行时按能力检测同时支持 ≤`0.1.6` 的 settings 注册表路径与 `0.1.7-rc.1` 与 `0.2.0-rc.1` 的 Volatile entry 路径（`typeof settings.register === 'function'` 分流）。终端与 loopback 设置只能在 Host 本地修改，`settings/update|replace|mutate` 禁止远程修改 `ds-harness-remote` 和 `dsh-remote`。终端默认开启；loopback 默认无端口。「远程终端」开关切换即保存并立即更新运行时拦截，「保存访问设置」按钮只提交 Loopback 端口（位于端口输入框右侧）；两者都无需重启 Host。预览入口位于 Remote Header「预览服务」，第一版限 Desktop / 连接本机 Harness 的浏览器；不把本机预览 URL 作为远程 Web 或 Android 可用地址。跨机、Windows 和真实网络热更新回归仍需另行验证。

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

## AGY temporary image attachments (2026-10-07)

按用户 2026-10-07 明确授权，AGY 图片 Prompt 可例外写入 Host 用户 tmp 下的专用私有缓存，
不得写入项目目录或扩展为通用文件上传/写入 RPC。仅接受 PNG/JPEG/WebP/GIF，每张 8 MiB、
每次最多 4 张，缓存总量上限 512 MiB。目录和文件仅 Host 用户可读，随机文件名、按会话隔离，
拒绝路径越界及符号链接。图片保留 24 小时，在后续上传时清理；系统清理 tmp 后无法恢复图片。
AGY 1.3.0 stream-json 仅接受 text，图片通过固定缓存目录的 `--add-dir` 和 `view_file` 读取；
Remote 历史只恢复该 AGY 会话 transcript 引用且仍有效的缓存图片，不能读任意 Host 文件。
Cursor 保持文字输入；不得把 AGY 图片缓存路径作为 Remote Workspace 展示。

## ACP startup isolation (2026-10-07)

ACP 使用 `config.acp` 后端注册表；当前 gateway 仅实现 Cursor/Antigravity adapter，各自遵循
启用开关和 command/args/cwd，不按可执行文件名选择 adapter，不对明确选择的不可用后端降级。
ACP 后台启动不得阻塞 Harness Remote 注册或 Client 初始化；能力声明表示启用的协议支持，
`workspaceTypes.available` 表示实际就绪。关闭时清理正在启动的进程，禁止迟到初始化重新注册。

## ACP Web compatibility and API isolation (2026-10-07)

按用户要求，新增 AGY 工作区保持 Web 客户端兼容。ACP 的 RPC、stream、transfer 和事件
统一保留在独立 `agent.acp.*` 数据面；不得把 ACP 方法加入 Harness ApiProxy/Typert allowlist
或改变 Codex API。允许 Web/Desktop 用纯客户端内存投影复用原生 UI，不写入 DSH 持久化。
`acp/virtual-harness.ts` 必须可用于浏览器，禁止依赖 Node filesystem、AGY 数据库或本机
transcript fallback；工作区和历史只从 Host ACP 接口读取。新 AGY 工作区 ID 使用
`antigravity:cwd:`，ID 生成和 catalog 投影必须显式指定 backend，不得默认生成 Cursor ID。
不兼容旧 AGY 的 `cursor:cwd:` ID，也不接受无后端前缀的路径作为工作区 ID；Cursor 和 AGY
分别需独立 capability。按用户说明 ACP 尚未使用，不增加旧 ACP 配置或 ID 迁移。含图片历史走有界 ACP transfer。
独立 Remote Web runtime 仍在独立 Server 仓库，本仓库验证不等于跨站点或跨设备验收。

此前兼容边界验证：Plugin/client-core 类型检查、Plugin build、DSH bundle 校验、浏览器
platform bundle 与无 Node globals 的工作区/历史烟测通过；Plugin 相关 49 测试和 client-core
44 测试通过。Plugin 全量为 360/361，通过外的既有 transcript-loader 测试依赖本机数据库并
硬编码 Linux `/var/lib/dsh/workspace/ds-harness-remote` 路径，在本机 Mac 环境失败；未修改
该 loader 或测试，不将全量 test 记为通过。

0.5.0 审查更新（2026-10-07）：上述本机数据库依赖测试已改为隔离 fixture；全仓 check、
test 和生产 build 通过，Plugin 42 文件 / 378 测试、Android 29 文件 / 323 测试、client-core
4 文件 / 52 测试，全仓共 1082 测试。最后的 Desktop 分组与 Android Prompt 订阅修复后，
Plugin build / DSH bundle 校验、Android check / 全量 test / Hermes export 再次通过。
审查修复能力与就绪状态判断不一致、AGY 项目 URI 归属、transcript 越界与符号链接、
ACP 启动中关闭及迟到会话结果覆盖。浏览器无 Node globals 的 ACP 工作区 / 历史烟测、
npm 发布入口与 0.5.0 版本一致性校验通过；独立 Server 的 6 项 workspace type 契约测试
通过，Server 当前仍将 Cursor / AGY 标记为缺少 Web adapter。未验证本次 Windows、原生
APK / 真机或 AGY 加密跨设备 E2E。Metro 的 noble/hashes exports fallback 警告仍存在。

## Android AGY workspaces (2026-10-07)

Android 从 Host 的 AGY catalog 加载工作区与每目录最近 100 个会话，内存投影不写 DSH
SessionStore/Workspace。History 和图片 Prompt 使用有界 ACP transfer；重连恢复历史/stream，
完成回复后刷新标题。新建会话保持空白，不同 Host 的 ACP 内存状态不得互相复用。批量 catalog
请求使用 `dsh/sessionList.prewarm=false` 避免每个目录启动一个空闲 CLI；选中目录仍可预热。
Android check、286 测试、Hermes export 通过；真实 AGY CLI 的 in-process 恢复测试六项通过，
未验证加密传输、APK 或 Android 真机 UI（本机无设备/Java runtime）。

2026-10-07 Agent 后端设置：CodeX、Cursor、AGY 使用统一后端列表，Kimi 未实现并移除。后端开关保存后热更新对应进程与 capability，不重启 DSH 或关闭 Harness 加密连接；变化后端的流和待审批句柄失效，其他后端进程保留。Android 刷新工作区时重新探测后端就绪状态。

2026-10-07 合并后测试修复：`antigravity-transcript-loader.test.ts` 的本机数据库与 transcript
依赖已替换为隔离临时 fixtures，移除硬编码 Linux 项目路径及数据为空时跳过断言的行为。
Plugin 类型检查、42 个测试文件 / 372 个测试和 `git diff --check` 通过；此前记录的该
环境依赖测试失败已修复。此验证不代表 Windows 或真实 AGY 跨设备验收。

## Design documentation sync (2026-10-08)

`docs/design/` 按当前源码更新，不再使用早期 MVP 草案作为当前边界。CodeX 会话只读文件与终端由 `codex-workspace-bridge.ts` 基于 Host 验证的 Thread cwd 提供；ACP 只读文件与终端使用独立 `dsh/toolCall` / tool stream 和 session/backend scope。两者都遵循固定 allowlist、路径/realpath 校验和终端归属/输入权，不扩大 App Server 或 Harness 通用 RPC。上述源码能力不代表已完成 Windows、APK、真机或加密跨设备验收。旧日期的“不对 CodeX 投影开放”记录仅描述当时范围；当前线协议以 `docs/protocol.md` 为准。

界面设计 `docs/design/DESIGN.md` 引用 Android 当前 theme 和 App 导航；Files/Terminal 从输入栏「＋」的工具访问进入，快捷提示词独立展示，轨迹另有标题栏入口。原始需求归档到 `docs/archive/vibe-coding.md`，不作为当前实现任务。

## Harness 0.2.1 compatibility (2026-10-09)

按用户要求，开发依赖使用 `0.2.1-alpha.1`，保留上一版 `0.2.0-rc.2` / rc.1 的 Typert Session V3；peer range 明确接受 `0.2.1` 与 `0.2.2` 预发布版。未来 `0.2.2` RC 未发布，不能把范围接纳描述为已完成 runtime 验证。legacy ApiProxy 不再作为兼容维护目标，已有代码/历史类型暂保留；后续新增能力仅使用官方 Typert。

限时问答只使用固定 `userQuestions/answer` / `attachWait` 与既有 `$events/result`，根据官方投影恢复 `continued` 问题；断线释放 claim，不重放回答。可选 Mods 只开放官方 `watchBand` / `pressBand`。Web SSE 使用文档相对地址以保留代理前缀。真实跨设备、Android 原生 UI 与真实代理验收仍需另行验证。

本轮验证：全仓 check/test 与生产 build 通过，最终问答状态改动后 client-core 38、Android 88 个测试再次通过；Plugin 250 个测试与 DSH bundle 校验通过。官方 `0.2.0-rc.2` / `0.2.1-alpha.1` Gateway 包的事件流、取消、目标切换和断线 fail-closed 烟测通过。该烟测不等于完整 Desktop / Android 跨设备 E2E。Metro noble/hashes exports fallback 警告仍存在。


## CodeX / ACP terminal controller (2026-10-15)

按用户授权，CodeX / ACP 共用 `remote-terminal-controller.ts`，参考官方 TerminalController 的终端语义，
不创建 Harness Agent 或 SessionStore 记录。`workspace-bridge.ts` 仅负责可信 session/cwd 与只读文件 scope；
终端通过 `remote-terminal-provider.ts` 使用 Host subprocess 的默认 shell 探测、可执行文件验证、PTY、
可用的 shell activity 与进程范围清理。普通 shell 使用 `-i`、PowerShell 使用 `-NoLogo`，选定 shell 必须
来自验证后的候选列表；无 discovery 的旧本地 provider 只验证默认 shell。无 subprocess 的 pipe 兼容路径
不支持 PTY resize/job control，其清理只覆盖直接 shell；完整进程范围清理由 subprocess provider 负责。

Host xterm headless 保存屏幕并序列化重连快照：scrollback 1000 行，快照最多 256 KiB，可缩减历史行；
follower JSON 队列最多 1 MiB，超限显式失败，重连恢复屏幕而不重放输入。每会话 8 个、每领域 256 个
保留/启动中终端；创建对活动 ID 幂等，关闭中取消迟到分配，已提交终端与请求超时/连接生命周期分离。
设备归属和 attachment 输入权保留，终端各 scope 必须一致；新 follower 或断开释放旧输入权。
无 hold/follower 且持续两小时明确 idle 才回收，busy/unknown 或观测间隔过长不累计 idle。
后端重配/Host 关闭等待进程清理，失败时保留关闭中的归属并重试；清理成功释放设备配额，迟到 RPC
不能释放新一代归属。终端输出与屏幕不写日志或持久化。

本轮 Plugin check、46 文件 / 296 个测试、build、DSH bundle 校验与根 GitHub 入口加载通过。
使用发布版 `dsh-subprocess-local@0.2.1-alpha.1` 的 macOS 真 PTY 烟测通过：zsh 交互启动、
创建请求取消后继续运行、resize、断开拒绝旧输入、重连屏幕恢复和等待清理；该本机烟测不等于
Desktop / Android 加密跨设备 E2E、Windows/Linux PTY 或真实两小时闲置验收。

2026-10-15 review 修复：分配提交后的请求取消仍返回创建成功，保留终端与设备 claim；输入/resize
同时校验当前 follower 属于调用连接，断开也撤销尚未完成的 follow。ACP 重配保留未完成清理状态，
终端清理失败仍尝试停止所有变化后端；再次保存相同设置可重试，清理成功前相关后端禁止 RPC/启动，
其余后端保持可用。Plugin check、46 文件 / 299 个测试与 build 通过；新增核心场景覆盖取消提交点、
attachment ID 跨连接复用、pending follow 断开，以及终端/后端清理失败后同配置重试。

## Claude ACP Host 与单次工具审批（Issue #125）

`claude` 默认关闭，使用 `claude-agent-acp`、空参数；不发送 Cursor 专属认证。初始仅实现 Host 接入；2026-10-18 补齐客户端工作区/历史与模型投影，见下文。真实 `@agentclientprotocol/claude-agent-acp@0.91.0` 使用已有兼容端点、私有 credential command 和 `gpt-6-sol` 在隔离临时目录通过初始化、对话及 Gateway Write 工具审批；这不代表 Anthropic Claude 模型或加密跨设备验收。

ACP permission response 仅允许 `allow-once | reject-once | cancel`，禁止 `allow-always` 和任意 permission `result`。必须按请求 `options.kind` 的单次选项映射真实 `optionId`，Claude 拒绝 ID 为 `reject`，不能硬编码 `reject-once`。句柄绑定连接/session/backend/进程实例；无主/未知请求不广播，上游不能覆盖 Host scope，非法响应不消费合法句柄。真实 Gateway 已验证拒绝不写文件、允许一次成功、同会话下一工具重新审批，以及跨连接/持久授权/result 越权/重放拒绝。断线与重配边界另有核心自动化覆盖；跨设备仍待验收。

Claude Host 中断/history 补齐：标准无 ID 的 `session/cancel`，撤销对应 session/backend 审批并拒绝迟到请求，不影响其他会话。目录/会话通过上游 `session/list` + Host realpath authority 发现，显式 backend 的 load 不接受 Client cwd；Claude 活动回复中 load 拒绝，history 使用独立临时 adapter，不读取私有 transcript。最多 30 个 live/loading Session，一个 history reader；8 MiB / 10,000 更新超限显式失败，重复 load 不重放污染 live。真实 Gateway 验证待审批 Write cancel 后无文件/旧句柄失效、Bash 运行中 history 不打断工具而后 cancel 返回 cancelled，以及整个 Gateway/adapter 重启后 history/上下文继续对话。未知时间为 0、稳定投影 ID，不宣称无损恢复上游未提供的元数据。客户端工作区与历史展示、重连 UI、Windows/APK/真机/加密跨设备仍未完成。

## Pi Agent ACP（Issue #97）

Pi 后端 ID 为 `pi`，默认自动检测并初始化，命令 `pi-acp`、参数 `[]`；`pi` 自身 RPC 不是 ACP。
未安装或初始化失败时不可用，不影响其他后端；明确的 `enabled: false` 和 ACP 总开关优先。
使用独立 `agent.acp.pi.v1`、`pi:cwd:` 工作区和 `pi:` 内存会话投影。Host 通过标准
ACP session/list 获取目录 authority，load/history 使用 Host 验证的真实 cwd。每活动会话
独立 wrapper，history 临时 wrapper 不得打断当前回复。最多 30 个保留会话，另有 catalog
和一个 history 槽；历史限 8 MiB / 10,000 更新，超限显式失败。模型/Thinking 来自上游
models/modes/configOptions；仅使用固定 session/set_config_option（model/thought_level）
并以响应/通知确认状态，不乐观伪造。首版仅文本，Pi 工具以 Host 用户权限执行。

本机安装 Pi 1.3.0、pi-acp 0.0.34，使用已有 OpenAI 兼容配置验证 CLI 对话、真实 Gateway
流式工具回复、历史、重启恢复、模型/Thinking、工具执行期间断线继续和中断。全仓 check、
703 tests、生产 build、DSH bundle 校验及 diff check 通过；Plugin 48 文件 / 315 tests、
Android 19 文件 / 101 tests。仍未验证 Windows、Android APK/原生真机、独立 Remote Web
及加密跨设备 E2E。Metro noble/hashes exports fallback 警告保留。

Pi 审批/历史复核：Pi 默认不逐工具审批，Host 扩展的 `tool_call` + `ctx.ui.confirm`
才映射标准 `session/request_permission`。真实 Gateway + Pi + `gpt-6-sol` 工具调用验证拒绝
不执行、单次允许仅执行一次且两种决定均自然结束；跨连接抢答不消费句柄，断线不放行且
旧句柄不能重放。真实 Gateway → ACP Client transfer → Desktop 内存投影验证实时 read/bash
输出及 write diff、进程重启后的文本/工具历史、分页与继续对话。目录/历史错误不得伪装成功的空结果，
同会话并发历史读取合并；工具结果保留输出/错误与 diff，Pi bash 实时预览超限明确提示。
Android 保留 Pi terminal 增量输出、退出失败状态和审批详情，并验证 Host 历史接入恢复，
不代表原生 UI 或跨设备通过。`pi-acp@0.0.34` load 不提供原始 thinking、工具输入、消息
ID/时间；使用稳定投影 ID 与未知时间 `0`，不宣称无损历史恢复。

ACP 恢复审查修复：Pi 初次 load 的文本/思考/tool 回放不得进入 live，只合并匹配会话的
模型/Thinking 配置；load 期间 callback 拒绝，成功提交后才启用 live/审批。Android Pi/AGY
新订阅隔离旧展示缓存，历史返回后保留本次 live 和完成 catch-up；无共同 cursor 时仅用
共享 ID/工具调用锚点做边界去重，不因相同短文本误删独立回复。Claude/Pi catalog 与缓存
cwd 校验捕获后端实例，在异步操作后验证其仍有效，重配/禁用/关闭后的迟到结果明确失败，
不可重建已清理的 authority。核心测试覆盖这些恢复/代际竞态；不新增真机或跨设备验收声明。

## Harness 0.2.1 RC compatibility (2026-10-17)

开发依赖升级到 `0.2.1-rc.1` 与 Cordis `4.0.5`，源码对照同级 Harness 仓库的
`dsh-v0.2.1-rc.1` tag。已认证连接各自创建并释放官方 owner Peer，RPC/stream/事件回复与
Fetch 路由共用该连接的 Peer，不使用共享 browser Peer，固定 allowlist 增加只读
`remoteAccess/follow`。终端保持既有 Remote follow/write/resize 协议，在两端本地对接官方
attach 双向流，按 Host ack 确认，保留有界队列、设备归属与断线不重放。CodeX/ACP 保留独立
数据面；session/projections 返回各自历史/内存的 sequenced 投影，不进入 Harness 持久化。
RC.1 官方 Gateway/Peer 与核心终端回归、全仓 check/test、生产 build/Hermes 和 DSH bundle
校验通过；Plugin 最终 52 文件/349 测试。跨设备、Desktop UI、Android
APK/原生真机与独立 Remote Web 尚未验收，详见 docs/compatibility.zh.md 与 docs/TODO.md。

2026-10-17 启动兼容修复（未发布）：`RemoteTypertGateway` 为旧 Host 返回的 `ui-theme`
视图补齐 RC.1 所需的缺失字体默认值，避免官方 ThemeRuntime 在 `undefined.split` 处初始化
失败并阻塞界面。只处理 describe 和成功写入返回值；不修改 Host schema、revision、用户
配置或拒绝结果。已用安装版官方 RC.1 bundle 复现并验证初始化修复，Plugin check/build、
20 个相关 Gateway 测试与 bundle 校验通过；未增加纯展示测试，真实跨设备恢复仍待验收。


## ACP model selection audit (2026-10-18)

Pi 显示名统一为 `Pi`，后端 ID 保留 `pi`。OpenCode 从真实 ACP session new/load 的
configOptions 或 legacy models 获取模型，按会话保存状态；固定 model/effort config key
或 legacy set_model 切换，禁止写死目录、全局 selectedModel 或吞掉上游失败。首次 load
不把历史回放注入 live，重复 load 不打断回复。Pi/AGY/OpenCode Desktop 投影仅提交 Host
确认的选择；Android 补齐 AGY 模型/思考强度并复用 ACP 模型解析。Cursor 的本地假模型
选项已移除；随后 Cursor/Claude 已接入同一模型契约。OpenCode 1.19.3 隔离 CLI 验证
读取 42 个模型并成功切换（未发送 Prompt）；此验证不等于 APK/真机或加密跨设备验收。

Cursor/Claude 使用共享 session model state 读取现代 configOptions 或 legacy models，
只调用固定 model/effort key，拒绝回复中切换。Cursor 上游模型管理器为进程全局，
因此与 Pi 共用隔离 wrapper，每个会话独立进程（最多 30 个活动会话）。Claude 保持其
每会话状态及重复 load 去重；恢复 Prompt 前加载 catalog 确认的 cwd，准备期间取消与
重试按任务身份隔离。Desktop/Android 增加 Claude 工作区/历史/文字会话及模型入口，
显示名为 Claude，后端 ID 为 claude；不开通图片及 Files/Terminal，不扩展 Harness/Codex RPC。

本轮真实 `claude-agent-acp@0.93.0` 模型烟测读取 5 个选项并确认切换（未发送 Prompt）。
Cursor `2026.10.16-e3cb207` 在本机初始化超时，真实 CLI 模型切换未验收；不将模拟
契约测试等同于 Cursor 实机、APK/真机或加密跨设备验证。

本轮验证：全仓 check、Plugin 52 文件 / 353 测试（串行）、Android 23 文件 / 131 测试、
client-core 与 protocol 测试及 Android Hermes export 通过。Plugin 并发运行曾出现
Control 超时及文件监听时序失败，串行全量通过；Metro noble/hashes exports fallback
警告仍存在。上述检查不等于原生 APK 或跨设备验收。

## OpenCode native archive (2026-10-18)

按用户明确要求，OpenCode 归档直接调用同一个 `opencode acp` 进程自带的认证 loopback
HTTP API，仅允许经 Host catalog/realpath 验证会话的 GET 与 PATCH `time.archived`。
这是限定的原生会话元数据写入，不开放通用 HTTP、数据库写入、删除或文件写入 RPC。
强制 127.0.0.1、临时端口、关闭 mDNS 和每进程随机认证；关闭进程时中止请求。
独立 capability `agent.acp.opencode.archive.v1`、ACP 扩展 `dsh/sessionArchive` 及目录事件
`agent.acp.catalog.changed` 只服务 OpenCode。原生确认后客户端更新投影，状态由 OpenCode
持久保存，不建立 Host 归档索引；其他 ACP 后端不能返回本地伪归档成功。
归档与加载/Prompt/模型写入/审批互斥，历史读取不抢 owner；不提供恢复归档或已归档列表。
真实 v1.19.3 隔离临时目录验证了原生确认、跨连接、幂等、重启隐藏及历史读取；Windows、
APK/真机、跨设备和独立 Remote Web 尚未验收。详细边界见 `docs/design/acp-session-archive.md`。
本次 Plugin check/build、359 个测试、client-core 41 个测试、Protocol 78 个测试、Android
check/132 个测试及 Hermes export、DSH bundle 校验通过；Metro 的 noble/hashes exports
fallback 警告仍存在。

## Android screen rotation (2026-10-18)

Android 不再锁定竖屏：`apps/android/app.json` 的 `orientation` 改为 `default`（Expo 对
Android 生成 `android:screenOrientation="unspecified"`，跟随系统自动旋转；不引入
`expo-screen-orientation` 运行时锁定）。`apps/android/src/ui/responsive.ts` 统一提供
`useResponsiveLayout()`（`landscape`、`compactHeight`、`contentMaxWidth`、
`sheetMaxHeight`）与 `modalSheetMaxHeight()`。

布局适配：聊天消息、输入栏和轨迹页在宽窗口使用居中的 760 dp 可读列；底部弹层最大高度按
当前窗口计算（窗口高度低于 520 dp 时为约 92%，否则 70%），picker/侧栏列表的
`flexShrink` 与最大高度一起保证页脚按钮可见；「+」菜单、工作区新建/重命名/操作对话框、
设备重命名、Home 菜单和目录浏览器改为可滚动 body；横屏/短窗口压缩输入栏、隐藏隐私提示，
IME inset 在窗口尺寸变化后重新读取 `Keyboard.metrics()`，避免沿用旧朝向的键盘坐标。
工具面板（Files/Terminal/PDF）与 xterm/PDF renderer 依赖 WebView 自身 resize 回调，未改协议。

验证：`pnpm --filter @dsh-remote/android check`（renderer 生成 + workspace data-plane 校验 +
`tsc --noEmit`）、23 文件 / 132 测试、`git diff --check` 通过。使用本机 Android 15
（Mi MIX 3，1080×2340）安装 arm64 release APK 后真机烟测：设备列表、工作区、Chat 欢迎页、
「+」菜单、工作区选择器、会话信息、设备详情/重命名、Home 菜单、设置、会话侧栏、轨迹、Files
面板在竖屏与横屏往返切换后均可用；横屏 Gboard 走系统全屏输入编辑界面，未验证普通内联 IME
布局。未验证平板、折叠屏/分屏、大字体、TalkBack、Terminal/PDF 原生交互及 iOS 旋转布局
（该改动同时解除 iOS 方向锁定，需另行验收）。

## Android QR sign-in (2026-10-18)

Android 登录页新增「扫码登录」点击入口：`RemoteServerApi.oauthProviders()` 使用 Server 返回的
`/api/v1/auth/oauth/providers`（404 时回退旧的 per-provider status 接口），只接受同源
`/api/v1/auth/` 入口；只有用户点击入口后才请求 provider 并展示二维码，不在登录页加载时
自动创建会话。`startOAuthQrLogin` 校验 `qrId`、`expiresIn` 与同源 `scanUrl`，
`pollOAuthQrLogin` 只接受 pending/expired/complete+token。手机与大屏都保留知乎/GitHub
浏览器 OAuth 与邮箱密码登录；大屏使用更大的二维码。二维码由 `qrcode-generator` 本地生成并通过
`react-native-svg` 渲染；离开扫码页停止轮询，切换服务地址会使旧会话失效；完成后用一次性 token
注册本机设备并复用现有 LoginFlow。领取到 `complete` 后立即停止轮询；注册与页面跳转不依赖会随
store/父组件渲染变化的 effect 依赖，避免已消费的一次性 token 被再次轮询判为过期后覆盖成功状态。
token 与二维码内容不写日志。

验证：Android check、24 文件 / 136 测试（含 QR provider/start/poll 同源与状态矩阵）、
`tsc --noEmit` 通过；真实 Server `dsh.r2049.cn` 的 providers、QR start 与 poll 合约已用 curl
核对。本轮未完成大屏真机 UI 扫码端到端验收。

## Android tablet split view (2026-10-18)

聊天页在宽度 ≥760 dp 且（高度 ≥520 dp 或宽度 ≥1000 dp）时启用双栏：左侧复用
`HostSessionsDrawer` 的 `inline` 模式常驻会话列表（当前工作/工作区/其他对话分组、刷新与
分页），右侧保留聊天头部、消息列表与输入栏。左栏切换会话只更新右侧内容，不离开聊天；
返回按钮回到工作区。窄屏和横屏手机仍为单栏，`HostSessionsDrawer` 的 Modal 模式不变。
模拟 800×1280 dp 窗口的真机烟测通过：进入会话、左栏切换“新对话”、恢复窄屏后回到单栏；
真实平板/折叠屏、分屏、大字体与 TalkBack 尚未验收。

## OpenCode ACP CLI option compatibility (2026-10-18)

OpenCode 启动先读取同一配置命令的 `--help`，按参数能力分流，不按主版本号猜测。
同时支持 hostname/port/mdns 时保留强制 127.0.0.1、临时端口、关闭 mDNS 和随机认证；
三者均不支持时移除旧网络参数，以纯 stdio ACP 提供目录、历史和对话，原生归档明确返回
`OPENCODE_ARCHIVE_UNAVAILABLE`，不访问未启动的 HTTP listener。部分支持、检测失败或
输出超限时拒绝启动；检测有超时且后端关闭时立即取消，不记录 CLI 输出。

验证：Plugin check、53 文件 / 373 测试（串行）、共享包及 Plugin build、DSH bundle 校验、
`git diff --check` 通过。隔离进程契约覆盖两种 CLI、私有监听/认证、失败/超限与关闭清理；
真实官方 OpenCode 1.19.3 的初始化、新建、目录、原生归档、归档目录与独立历史读取通过，
未发送 Prompt。随后依据官方 `https://opencode.ai/v2/docs` 确认 v2 使用 `@opencode/cli`，
不是 v1 的 `opencode-ai`；补齐 v2 `--help, -h` 格式解析后，Plugin check/build、相关 9 个
核心测试和 bundle 校验再次通过。真实官方 `@opencode/cli-darwin-arm64@2.0.32` 已校验
npm integrity 并在临时目录通过初始化、新建、目录、42 个模型与模型切换、独立历史及重启
列表/加载；归档明确不可用。v2 ACP 内部私有服务不开放网络端口，不接入共享后台服务。
两版均未发送 Prompt，不代表 Windows、APK/真机或加密跨设备验收。修复尚未发布。


## Web workspace upload (2026-10-18)

按用户本轮明确授权，新增独立 `workspace.upload.v1`：只允许将文件上传到当前会话的
Host 验证工作区根目录。四个固定 RPC 为 open/chunk/commit/abort；不接受 Client cwd/path，
不扩展通用文件系统、只读预览或后端业务 allowlist。Harness 通过官方 Session V3 Peer
解析 cwd，CodeX/ACP 使用各自可信 session authority；ACP 要求 peer/backend/owner 匹配。
分块与每连接限额、空闲过期、取消/断线清理、排他临时文件和原子无覆盖发布属于该领域。
聊天仍用普通文本路径引用，不新增消息 attachments。协议见 docs/protocol.md 对应章节。
该例外覆盖本文件此前的通用文件写入禁止；不代表发布、部署或跨设备验收完成。

## Android foreground connection service audit (2026-10-19)

Android 在异步鉴权前启动连接服务；Expo config plugin 显式声明前台服务、通知与 WAKE_LOCK
权限，Android 13+ 在前台连接时请求通知权限（拒绝不禁止服务，但通知栏隐藏通知）。原生服务
绑定现有 ReactHost 的 Headless JS task，并仅在连接生命周期内持有 PARTIAL_WAKE_LOCK；
断开、启动失败、原生销毁和 React instance invalidate 时释放。原生启动通过 Promise 确认，
服务操作串行且按连接代次隔离，旧失败/关闭回调不能停止替换后的服务。任务等待按原生服务
lifetime 隔离；不重启已被杀死的进程或创建无连接的常驻服务。

回前台使用既有加密 `harness.transport.describe` 做最多五秒的健康检查；旧 Host 的
METHOD_NOT_FOUND 回包同样证明链路可用。半开或检查中关闭的链路走既有重连/会话恢复，
明确断开后的迟到检查不能恢复设备。需安装重新构建的 APK；该实现不绕过深度 Doze 或厂商
省电限制。验证结果与真机待验收项见 apps/android/README.md 和 docs/TODO.md。

本次 Android check、25 个测试文件 / 140 个测试、arm64 Release APK（含 Kotlin/Hermes）构建
与 `git diff --check` 通过；Metro noble/hashes exports fallback 警告仍存在。本机无已连接设备，
尚未验证通知授权 UI、后台/息屏心跳、Doze/厂商省电与真实跨设备恢复；未发布新版本。
