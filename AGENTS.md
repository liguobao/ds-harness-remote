# Repository Guide for Agents

定义编码 Agent 在本仓库工作的边界、结构、门禁、架构不变量、测试与文档规范。

- **版本与依赖**：不硬编码版本或构建号，以根及各包 `package.json`、`dsh-plugin.json`、`apps/android/app.json` 与 `pnpm-lock.yaml` 为准。
- **兼容与待办**：兼容基线见 [compatibility.zh.md](docs/compatibility.zh.md)（[EN](docs/compatibility.md)）；待办与限制见 [TODO.md](docs/TODO.md)。
- **协议权威**：线协议以 [protocol.md](docs/protocol.md)、`packages/protocol` 与 `fixtures/` 为准。

## Repository Boundary

### 已实现
- `packages/plugin`：DeepSeek Harness Plugin（Remote Host、本地工作区入口、Remote Agent Tools、`ds-harness-remote` CLI；无可见 Client 模式）。
- `packages/tui` & `packages/tui-plugin`：
  - `packages/tui` 为同版本独立发布的 `ds-harness-remote-tui` Host 组合包（装配官方 API 并调 `applyTuiHost`）。
  - `packages/tui-plugin` 为未发布开发与契约校验包。
- `apps/android`：Expo SDK 57 客户端（官方 Typert、`codex.app.*`、`agent.acp.*`、`plugin.route.call`、9 语言；见 [Android Guide](apps/android/AGENTS.md)）。
- `apps/harmony`：HarmonyOS 原生 Client（ArkTS + ArkWeb WebRTC）；SDK 构建独立于 pnpm workspace，见 [客户端说明](docs/harmony-client.md)。
- `apps/vscode`：VS Code 扩展 Client。
- `apps/browser`：Chrome/Edge MV3 启动器（换独立凭据开同源 Remote Web，无登录/传输/会话 UI）。
- `packages/{protocol,crypto,webrtc,client-core}` & `fixtures/`：共享协议/加密/传输/客户端库与一致性向量。
- `apps/server`：最小自部署 Server（单账号环境变量、JSON 凭据与 refresh 恢复、Noise/Control 盲转发、可选 WebRTC/TURN、密文 Relay、Web 登录/状态页、Docker/Compose）。
- `examples/mock-host`：冻结的旧协议互操作工具，不加新功能。

### 禁止实现
- 多账号 Server、Remote Web 会话 UI、Admin 前后端、数据库/migration/队列、K8s/Terraform，及 `apps/server-web`、`apps/web` 或空 Web/UI 目录。
- 禁把 [server.md](docs/server.md) 完整站点设计写为 `apps/server` 已实现能力（须保留该文档与 `protocol.md`）。

## Project Structure & Packaging Boundaries

```text
apps/        android/  browser/  harmony/  server/  vscode/
packages/    plugin/  tui/  tui-plugin/  protocol/  crypto/  webrtc/  client-core/
examples/    mock-host/
fixtures/    crypto/  pairing/  protocol/
scripts/     install.sh、bundle/WebRTC/场景/基准校验
docs/        README.md、protocol.md、compatibility*.md、TODO.md、CHANGELOG.md、design/
```

- **同名包过滤**：`packages/tui`（无 `scripts`）与 `packages/tui-plugin`（`test` 跑 `packages/tui-plugin/scripts/verify-bundle.mjs` 校验 16 个 `@deepseek-ai/*` 固定版本与 `inject` 契约）同名 `ds-harness-remote-tui`，`pnpm --filter` 须用 `./packages/tui` 或 `./packages/tui-plugin`。
- **根包边界**：
  - 根 `package.json` 与 `dsh-plugin.json` 为 DSH Desktop GitHub 安装边界，须留 `dsh.bundle.patch`、Host/Client `exports`、CLI `bin` 与根 `cordis.patch.yml`。
  - **根 `package.json` 严禁设 `scripts`、`private: true` 或 `repository.directory`**。
- **npm 发布**：仅由 Release 在 `packages/plugin` 执行（校验五处版本及 `versionCode === buildNumber` 一致），禁根目录 `npm publish`。
- **提交产物**：
  - Git 仅允许提交 `packages/plugin/dist/{index,client.github}.js`（另留 `index.js`、`packages/plugin/bin/ds-harness-remote.js`；`client.js` 忽略但 `verify-dsh-plugin.mjs` 会校验）。
  - `locale/README.*.md` 与 `packages/plugin/locale/README.*.md` 须保持字节一致。
- **Host 内联闭包**：
  - 内联全部运行时依赖（`ws`、`qrcode`、`schemastery`、`werift`；`werift` 置 `devDependencies`，ESM banner 用局部 `createRequire` 禁改全局）。
  - 裸 import 仅留 `@deepseek-ai/dsh-client-connection`（及可选 `@roamhq/wrtc`）。
  - esbuild 统一模块路径标签；改插件或共享包后必过 [verify-dsh-plugin.mjs](scripts/verify-dsh-plugin.mjs)、[verify-packed-webrtc.mjs](scripts/verify-packed-webrtc.mjs) 与 `git diff --exit-code`。

## Development & Verification

环境：Node.js `>=24.9`、`pnpm@9.15.4`（Android 原生另需 JDK 17 与 Android SDK）。

```bash
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm -r check
node scripts/verify-dsh-plugin.mjs
pnpm -r test
NODE_ENV=production pnpm --workspace-concurrency=1 -r build
node scripts/verify-packed-webrtc.mjs
git diff --exit-code -- packages/plugin/dist/index.js packages/plugin/dist/client.github.js
```

- Fresh clone 先建 `./packages/**`；全仓生产构建必加 `--workspace-concurrency=1`（防 Android prebuild 与 Plugin 打包并发竞争）。
- `apps/server` 独立验证前先建 `@dsh-remote/protocol`，禁交 `apps/server/data/` 与 `.env`。
- `apps/android` 的 `check`/`test` 会执行 `build:renderers` 写忽略目录 `src/generated/`。
- 安装入口仅维护 [install.sh](scripts/install.sh)（无 Windows 或自动卸载脚本）：
  - macOS 非 root 复用 Desktop launcher 或 CLI，不装服务。
  - Linux 需 root，管 `/opt/ds-harness-remote` 与 `ds-harness-remote-<profile>.service`；遇运行/启用中的旧归属服务拒绝继续，不碰未知服务与系统 Node/PATH，且须明示终端具备 root 权限。

## Architecture & Implementation Rules

### 1. 线协议、加密与信任边界
- 线协议以 [protocol.md](docs/protocol.md) 为权威，变更同步 schema、`fixtures/` 与消费端。
- 业务仅经 `Noise_IK_25519_ChaChaPoly_SHA256` 加密通道（`SecureMessageCodec` 48 KiB 分片 / 4 MiB 上限）传输。
- 明文、未知 `connection`、错 target、重放与 identity 不匹配均 fail-closed；Server membership 与 Host 本地 trusted peer 须同时成立。
- `apps/server` 只盲转发（零解密）：
  - 按配置返回 `transport.{lan,p2p,turn,relay}` 交集，每连接 ≤256 ICE，建链后忽略迟到信令。
  - `DSH_SERVER_TURN_URLS` 与 `DSH_SERVER_TURN_SECRET` 须成对配置并签短期 coturn HMAC 凭据。
  - refresh 丢响应恢复以旧 bearer 作 HMAC 密钥派生后继 pair，磁盘仅存摘要与元数据；再次轮换拒祖先且不撤现凭据，损坏返 `503`。
- `AdaptiveTransport` 仅重试 Server 精确 `4001 / CONNECTION_FAILED` 并重握 Noise。
- Client GET 遇 `401` 至多刷新重试一次，禁重放 mutation、审批或终端输入。
- Token、私钥、配对码、二维码、Prompt、源码、隐私路径与工具/终端输出禁写日志。

### 2. 网络监听、Loopback 控制与本机自升级
- Plugin 不监听公网，仅两处受限监听例外：
  - Desktop Client 监听 `127.0.0.1` 随机端口承载 `loopback.ports` 预览（Host 只出站连 `127.0.0.1` 白名单，禁公网/任意目标/CONNECT/通用 TCP 转发）。
  - Host `workspace.upload.lan.v1` 仅在本机非回环 RFC1918 IPv4 临时监听，凭 10s 一次性票据升级并绑定 connection/device key/session/upload。
  - LAN 上传 Client 锁死 RTC 选中 IPv4（禁 DNS/公网/loopback），父连接关/替即销毁监听器与临时文件。
- Host 控制路由限 loopback `/ds-harness-remote`（Web SSE 用相对路径保代理前缀）。
- `client.authorization.status` 纯只读不刷新不联网；loopback 错误须保留 `details.remoteCode` 与 `code`。
- `settings/update|replace|mutate` 禁远程改 `ds-harness-remote`/`dsh-remote`；启动仅自动禁用自有 `@dsh-remote/plugin`，严禁误禁他人 `dsh-remote`。
- 本机版本检查与升级：
  - 启用且有 `connection` 时每 24h 并发竞速 `npmjs.org` 与 `npmmirror`。
  - `plugin.update` 仅在 `listBundles` 标 `update: 'registry'`（仅缺 `update` 时兼容 `updatable: true`；禁按 npm source 推断，`'git'` 手动）时，以确认的 `latest` 调 `pluginManager.updateBundle`。
  - 断响应靠轮询 `status`（≤60s / 存活 Host 连续 3 次旧版即停）结算；**加密远程通道严禁停用、卸载或更新 Remote 自身及所属 bundle**。
- 外部原生 WebRTC 探测必带 `ELECTRON_RUN_AS_NODE=1`，加载前拒绝 Electron。

### 3. 凭据迁移、V2 刷新锁与 DSH-Go 配对
- 默认凭据根为 `$DSH_HOME/ds-harness-remote`（日志前缀统一 `ds-harness-remote`；自定义 `IdentityStore.directory` 保持原路径）。
- 目录外 `.ds-harness-remote-migration/` 闸门串行迁移与刷新：
  - 迁移前只读全验旧 `remote` 白名单、公私钥、指纹与 scope 哈希。
  - 容忍 `trusted-peers.json.<pid>.<UUIDv7>.tmp` 及普通 `.DS_Store`/`desktop.ini`/`Thumbs.db`，拒 `._*`、软硬链接与未知文件。
  - rename 失败写 `legacy-root.json` 固定原 `dev/inode` 沿用，禁合并覆盖或另建身份。
- 刷新用 V2 硬链接 marker + `.holder-<pid>-<uuidV7>` 队列锁（限 Linux 单机 ext4/XFS，不含 NFS/SMB；升/降级前停全部 Harness，见 [plugin-integration.md](docs/plugin-integration.md)），不按时间抢锁。
- `4003` 映射 `CONNECTION_REPLACED` 并停止抢占。
- DSH-Go 配对（[device-pairing-v1.md](docs/device-pairing-v1.md)）限 Host 本地扫码与单次 AES-GCM 提交，持久化 `pairing-host-only.json`（`inbound-only`），禁建 Client 角色。

### 4. Harness Carrier、路由白名单、受限写入与异步压缩
- Harness 仅用官方 `TypertGateway` carrier（`0.1.1-rc.2` ApiProxy 已删；共享旧类型仅供独立 VS Code，禁在 Host/Android 重开或另建协议）。
- 激活备共享 fallback owner Peer，每条已认证连接独占释放独立 owner Peer。
- `RemoteSnapshotStream` 延后断线错至重连取消点；`RemoteTypertGateway` 为旧 `ui-theme` 补默认字体。
- `harness.transport.describe` 向 `session/list` 发 `{ args: { __remoteCapabilityProbe: true } }`：
  - **仅认 `gateway/arguments-invalid`**（零调用、5s 预算，禁换合法空请求扫库；余错或意外成功均 fail-closed）。
- `session/list` 超 2,048 行时 Host 只留最新根会话并提升 `projections.values.title`，Client 先过滤再截断。
- Harness v1 审批限 `allow_once | deny`（禁 `allow_session`）；问答限 `userQuestions/answer|attachWait`（断线释 claim）。
- `packages/plugin/src/plugin-route-bridge.ts` 仅放行 `api/session/uploadFileBinary` 与 `packages/plugin/tests/fixtures/ds-bot-v0.3.6-endpoints.json` 161 端点 + `btw`/`btw-cancel`/`room-continue`：
  - 保持 30s 预算与不重放 mutation。
  - 管理/凭据/电脑控制/审批 `choice` 交认证后 DS-Bot handler 校验。
- 仅五类受限写入例外（禁通用 fs 写或远程桌面 RPC）：
  1. `workspace.upload(.lan).v1` 写会话验证根（排他 tmp+`fsync`+原子不覆盖；直连 1 GiB / 中继 20 MiB 动态复检 `channel.mode`；LAN 限 `>=1 MiB`，发 `open` 后禁换通道重放）。
  2. 官方 `workspace/create` 递归建非根无 NUL 绝对目录。
  3. AGY 私有 `tmp` 图缓（PNG/JPEG/WebP/GIF，≤4×8 MiB / 总 512 MiB / 24h 清理）。
  4. OpenCode v1 `--help` 确认后经私有 `127.0.0.1` 认证 HTTP 调 `PATCH time.archived`（纯 stdio/v2 返 `OPENCODE_ARCHIVE_UNAVAILABLE`）。
  5. Remote Tools `remote_download_file` 写本机独立 `Downloads/dsh-remote-*`（≤50 MiB），操作仅内存去重，`unknown` 禁重发。
- `remote.history.compact.v1` 按连接配置且不改源记录（`compact-bot-round.ts` 保 `replies` 并标 `truncated: true`，128 Ki 字符预算）。
- `/compact` 走 `packages/plugin/src/remote-compaction-operations.ts`：
  - `(deviceId, sessionId, requestId)` 幂等、同会话单活 `AGENT_BUSY`、全局 ≤32 `RATE_LIMITED`、30m 预算。
  - 取消/超时查 `session/events` 确认，`succeeded` 优先，`unconfirmed` 禁 Client 重提。

### 5. CodeX、ACP 多后端与共享远程终端
- CodeX（`packages/plugin/src/codex/`，`codex.app.*`）与 ACP（`agent.acp.*`：`cursor`/`antigravity`/`pi`/`opencode`/`claude`/`hermes`，见 [acp-remote.md](docs/acp-remote.md)、[codex-remote.md](docs/codex-remote.md)）保持独立数据面。
- UI 仅内存投影（`packages/plugin/src/acp/virtual-harness.ts` 禁 Node/FS 依赖），**禁写 DSH `SessionStore`、Workspace 库或 Harness 日志**。
- CodeX authority 取 `project/list`（回退 `thread/list` 绝对 `cwd`），`project/create` 仅注册已存在目录（`realpath`）。
- ACP 边界：
  - 强制 `<backend>:cwd:` 与 Host `realpath`/catalog 校验，不猜 adapter 不降级。
  - Claude 禁图片；批量 `prewarm=false`。
  - Cursor/Pi 每会话独立进程（≤30 活+1 history，历史 ≤8 MiB/10k 更新）；模型/思考用上游确认值禁回复中切。
  - ACP 审批按 `options.kind` 映单次 `optionId`（允许/拒绝/取消），禁 `allow-always`。
- 共享终端 `packages/plugin/src/remote-terminal-controller.ts` 受 `terminal.enabled` 控制：
  - 仅运行验证候选 shell，维护 1,000 行 / ≤256 KiB xterm 快照与 1 MiB 队列（≤8/会话、≤256/域）。
  - 绑设备归属与当前 follower 输入权，2h 明确 idle 回收，重配等清理完再重开。

## Test Policy

- 预算仅限：
  - 协议编解码与 schema；
  - 身份、加密、篡改与重放；
  - 鉴权、配对、锁与迁移；
  - RPC 关联、fail-closed、allowlist 与异步压缩；
  - 传输切换与重连核心状态机。
- 纯展示 UI、文案、图标、配色、排版、静态说明与源码字符串匹配不写单测（靠 `check` 与烟测）。
- 共享实现仅在所属包测一次；Node 不计 Android 原生验证。
- 多变体合并为隔离命名场景矩阵（如 [test-scenarios.mjs](scripts/test-scenarios.mjs)），失败报具体场景并续跑同组；禁 `skip`/`exclude` 藏测。

## Documentation Rules

- 根目录留 `README.md`（默认英文，不另建独立英文副本）、`README.zh.md`、`README.ja.md`、`AGENTS.md` 与根清单。
- 专题集中于 [docs/](docs/README.md)，设计位于 `docs/design/`（旧归档目录已移除）；自部署 Server 实际能力见 [apps/server/README.zh.md](apps/server/README.zh.md)。
- `docs/TODO.md` 只记待办与已知限制（保留 Metro `@noble/hashes/crypto.js` fallback 待办，未修禁删）。
- `docs/CHANGELOG.md` 与 Release Notes 只写用户可感知变化与贡献者，不写测试数、构建命令或未验收表。
- 临时验收、评审、地址、日志、构建哈希、采样与调试/验收截图录屏**禁新增提交入库或堆入 `AGENTS.md`/`docs/`**：
  - 复现步骤留测试或 [transport-bench](scripts/transport-bench/README.md)；现场结果放 Issue/PR 附件或已忽略 `artifacts/`、`docs/screenshots/`。
  - README 展示图 `docs/images/` 与应用运行资源保留。
