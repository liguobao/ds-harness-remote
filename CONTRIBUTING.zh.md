# 参与 ds-harness-remote 贡献

[English](CONTRIBUTING.md)

感谢你关注并参与 `ds-harness-remote`！无论你是反馈 Bug、完善文档与多语言、在不同设备上实测，还是提交 Pull Request，本文档都会介绍本仓库的结构、本地验证方式以及协作边界。

如需深入了解架构不变量与编码 Agent 规范，请参阅 [`AGENTS.md`](AGENTS.md)（移动端细节另见 [`apps/android/AGENTS.md`](apps/android/AGENTS.md)）。全部文档入口与待办路线分别见 [`docs/README.md`](docs/README.md) 与 [`docs/TODO.md`](docs/TODO.md)。

## 参与方式与仓库范围

- **反馈问题与功能建议**：仓库已关闭空白 Issue（`blank_issues_enabled: false`），请使用 [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) 下的中英文表单模板提交。
- **完善文档与多语言**：补充使用说明、同步翻译或完善排查指引。
- **跨平台实测反馈**：在真实的 Desktop、Web、Android、iOS、HarmonyOS、TUI、VS Code 或自部署 Server 环境中验证体验与边界场景。
- **提交代码与测试**：修复缺陷、增强协议与状态机测试覆盖，或在仓库边界内实现新功能。

### 本仓库包含的内容

| 目录 | 说明 |
| --- | --- |
| `packages/plugin` | DeepSeek Harness Remote Host 插件、本地工作区入口、Remote Agent Tools 与 `ds-harness-remote` CLI |
| `packages/tui` 与 `packages/tui-plugin` | 独立发布的 `ds-harness-remote-tui` Host 组合包（`packages/tui`）及未发布的开发与契约校验包（`packages/tui-plugin`） |
| `packages/{protocol,crypto,webrtc,client-core}` 与 `fixtures/` | 共享线协议 schema、Noise 加密、WebRTC 传输、客户端核心与一致性测试向量 |
| `packages/app-core`、`apps/android`、`apps/ios` | Android 与 iOS 共用的 React Native / Expo 应用核心（`packages/app-core`）及双端原生壳工程 |
| `apps/harmony` | HarmonyOS 原生客户端（ArkTS + ArkWeb WebRTC），独立于 pnpm workspace 构建 |
| `apps/server` | 单账号最小自部署 Server（Noise/Control 盲转发、可选 WebRTC/TURN、密文 Relay 与 Docker/Compose） |
| `apps/browser` 与 `apps/vscode` | Chrome/Edge MV3 启动器扩展与 VS Code 扩展客户端 |

### 明确不在本仓库范围内

- `examples/mock-host` 是冻结的旧协议互操作工具，不再新增功能。
- 本仓库**不包含**多账号 Server、Remote Web 会话 UI、Admin 前后端、数据库/迁移/队列以及 Kubernetes/Terraform 配置。[`docs/server.md`](docs/server.md) 仅用于记录完整站点的协议与接口设计，不代表 `apps/server` 已实现其中全部能力。

## 环境要求与快速开始

### 基础工具链

- **Node.js `^24.22.3 || >=26.13.1`**（CI 使用 `24.22.3`）
- **`pnpm@9.15.4`**（已在根 `package.json` 的 `packageManager` 字段声明，可运行 `corepack enable` 自动匹配）
- `.npmrc` 配置了 `node-linker=hoisted`，以兼容 Windows 路径长度限制。

克隆后先按锁文件安装依赖并构建共享包：

```bash
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
```

根目录 `package.json` 作为 DSH Desktop 的 GitHub 安装边界，**刻意不设置 `scripts`**；日常构建、检查和测试均通过 `pnpm -r` 或 `pnpm --filter` 执行。

### 各端与子包补充说明

- **Host 插件（`packages/plugin`）**：可执行 `pnpm --filter ./packages/plugin build`、`check`、`test`（按路径过滤可避免匹配到同名为 `ds-harness-remote` 的根 `package.json`）。详见 [`packages/plugin/README.md`](packages/plugin/README.md) 与 [`docs/plugin-integration.md`](docs/plugin-integration.md)。
- **TUI 包（`packages/tui` 与 `packages/tui-plugin`）**：两者包名同为 `ds-harness-remote-tui`，使用 `pnpm --filter` 时**必须按路径过滤**（如 `pnpm --filter ./packages/tui-plugin check` / `test`）；`./packages/tui` 不含 `scripts`。详见 [`packages/tui/README.md`](packages/tui/README.md)。
- **自部署最小 Server（`apps/server`）**：独立验证前请先构建 `@dsh-remote/protocol`；切勿提交 `apps/server/data/` 或 `.env`。详见 [`apps/server/README.zh.md`](apps/server/README.zh.md)（[English](apps/server/README.md)）。
- **移动端（`packages/app-core`、`apps/android`、`apps/ios`）**：共享源码、离线渲染器脚本与单测均位于 `packages/app-core`；修改共享包后请先重编 `./packages/**`。
  - **Android**：原生构建需 JDK 17 与 Android SDK。因依赖 `react-native-webrtc` 与原生模块，**不支持 Expo Go**，须使用 Development Build 或原生 APK。详见 [`apps/android/README.md`](apps/android/README.md) 与 [`apps/android/AGENTS.md`](apps/android/AGENTS.md)。
  - **iOS**：原生构建需 macOS 与 Xcode。`apps/ios/ios/` 原生工程**已提交入库**供 Xcode Cloud 构建，重生成必须运行 `pnpm --dir apps/ios run generate:ios`（内置 `--no-clean`），切勿直接运行裸 `expo prebuild --platform ios`（会删除 `ci_scripts/` 并重置团队与版本配置）。详见 [`docs/ios-build-and-release.md`](docs/ios-build-and-release.md)。
- **HarmonyOS（`apps/harmony`）**：独立于 pnpm workspace，需安装包含 API 26 SDK 的 DevEco Studio（`ohpm`、`hvigorw`）。打开工程前请先在仓库根目录生成共享终端资源：
  ```bash
  node packages/app-core/scripts/build-terminal.mjs apps/harmony/entry/src/main/resources/rawfile/terminal.html
  ```
  未签名/签名构建与真机烟测流程见 [`docs/harmony-client.md`](docs/harmony-client.md)。

## 构建、验证与受跟踪产物

与 CI `quality` 任务对齐的完整本地验证命令如下：

```bash
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm -r check
pnpm exec oxlint --type-aware --quiet packages apps scripts
node scripts/verify-dsh-plugin.mjs
pnpm -r test
NODE_ENV=production pnpm --workspace-concurrency=1 -r build
node scripts/verify-packed-webrtc.mjs
git diff --exit-code -- packages/plugin/dist/index.js packages/plugin/dist/client.github.js
```

- 全仓生产构建必须附加 `--workspace-concurrency=1`，避免移动端构建步骤与插件打包并发竞争。
- 如修改了受跟踪的 Shell 脚本（`*.sh`，不含 `apps/ios/ios/ci_scripts/ci_post_clone.sh` 等 `zsh` 脚本）且本机安装了 `shellcheck`，请运行 `shellcheck -S warning <script.sh>`（CI 会对全部受跟踪的非 `zsh` `*.sh` 脚本执行该检查）。
- `node scripts/verify-packed-webrtc.mjs` 会在临时目录对根包与 `packages/plugin` 执行 `npm pack` 并生产安装，需在已构建 `./packages/**` 且可执行 `npm install` 的环境下运行。

### 受跟踪生成产物与忽略文件

- **必须随源码同步重编并提交**：只要修改了 `packages/plugin` 或其内联的共享包（`packages/{protocol,crypto,webrtc,client-core}`），就必须先运行 `pnpm --filter './packages/**' -r build`（插件打包脚本直接消费共享包编译后的 `dist/` 产物），再通过 `node scripts/verify-dsh-plugin.mjs` 校验，并将更新后的 `packages/plugin/dist/index.js` 与 `packages/plugin/dist/client.github.js` 一并提交。推送前请确认全仓生产构建后 `git diff --exit-code -- packages/plugin/dist/index.js packages/plugin/dist/client.github.js` 无残留差异。
- **不要提交的忽略文件**：`packages/plugin/dist/client.js`（构建产物且会被 `verify-dsh-plugin.mjs` 校验，但已被 `.gitignore` 忽略）、`packages/app-core/src/generated/`、`apps/android/src/generated/`、`apps/server/data/`、`.env`、`apps/harmony/build-profile.local.json5`、`*.hap`、`*.tgz`、`artifacts/` 与 `docs/screenshots/`。
- **根清单边界**：根 `package.json` 严禁添加 `scripts`、`private: true` 或 `repository.directory`。根与 `packages/plugin` 的 `package.json`、`dsh-plugin.json` 及 `packages/plugin/src/version.ts` 等元数据约束请以 [`scripts/verify-dsh-plugin.mjs`](scripts/verify-dsh-plugin.mjs) 与 [`AGENTS.md`](AGENTS.md) 为准。

## 测试规范与可选检查

- **测试框架与发现机制**：pnpm workspace 内的 TypeScript/JavaScript 包统一使用 **Vitest** 默认发现机制（不设独立 `vitest.config.*`）；`packages/tui-plugin` 的 `test` 脚本执行 `node scripts/verify-bundle.mjs` 校验依赖与注入契约。
- **按包局部验证**：开发时可执行 `pnpm --filter <包名或路径> check` 与 `pnpm --filter <包名或路径> test`。注意：`packages/app-core` 的 `check`/`test` 会自动串联 `build:renderers` 与 `verify:workspace`；`packages/plugin` 的 `build`/`check`/`test` 均前置执行 `verify-version-sync.mjs`。
- **移动端测试位置**：`apps/android` 与 `apps/ios` 的 `package.json` 不含 `test` 脚本，移动端共享单测位于 `packages/app-core`。Android 通知多语言单测（`apps/android/tests/live-task-notification-locales.test.ts`）未接入 `pnpm -r test`，如需单独运行可执行 `pnpm exec vitest run apps/android/tests/live-task-notification-locales.test.ts`。
- **HarmonyOS Node 侧契约检查**（不在 `pnpm -r test` 范围内，但在 CI `quality` 中执行）：
  ```bash
  pnpm exec vitest run apps/harmony/tests
  node apps/harmony/scripts/check-i18n.mjs
  node apps/harmony/scripts/bump-version.mjs --check
  ```
- **平台专项与可选检查**：
  - CI 的 `xfs-refresh` 任务会在 Linux loopback XFS 文件系统上运行 `pnpm --dir packages/plugin exec vitest run tests/server-credentials.test.ts tests/identity-store.test.ts`，用于验证 V2 硬链接刷新锁。
  - Node 侧单测不替代 Android、iOS 或 HarmonyOS 的原生编译与真机验证；提交 PR 时请如实注明已验与未验平台。

### 测试编写原则

测试预算应聚焦真实行为不变量（详见 [`AGENTS.md`](AGENTS.md#test-policy)）：

- 线协议编解码与 schema 校验
- 身份认证、端到端加密、篡改与重放防护
- 鉴权、配对、凭据刷新锁与目录迁移
- RPC 关联、fail-closed 边界、路由白名单与异步压缩状态机
- 传输切换与重连核心状态机

不要为纯展示文案、图标、配色、排版或源码字符串匹配编写脆弱单测。多变体用例请优先通过 [`scripts/test-scenarios.mjs`](scripts/test-scenarios.mjs) 组织为隔离的场景矩阵，禁止用 `skip` 或 `exclude` 隐藏失败测试。

## 代码风格与仓内约定

本仓库采用轻量级编辑器基线与静态检查，不额外引入格式化工具或 Git hooks：

- **编辑器与换行约定**：[`.editorconfig`](.editorconfig) 统一 UTF-8、LF 换行、2 空格缩进、末尾换行与尾随空白清理，并对 `*.md`、`*.patch`、`packages/plugin/dist/*.js` 和 `Makefile` 设有专项覆盖。[`.gitattributes`](.gitattributes) 强制 `*.sh` 脚本保持 LF，并保留受跟踪插件产物与 `*.patch` 的空白豁免。
- **TypeScript 与 React 静态检查**：[`.oxlintrc.json`](.oxlintrc.json) 配置了类型感知 **Oxlint**（`oxlint` + `oxlint-tsgolint`），通过 `pnpm exec oxlint --type-aware --quiet packages apps scripts` 运行。`error` 级规则阻断 `react/rules-of-hooks`、`typescript/no-floating-promises`、`typescript/no-misused-promises`（`checksVoidReturn.attributes: false`）与一组精选核心正确性规则（如 `no-debugger`、`no-unreachable`、`no-dupe-keys`）；`react/exhaustive-deps` 与 `eslint/no-unused-vars`（忽略 `_` 前缀）为 `warn`。检查会自动忽略生成产物、第三方与原生工程目录（如 `dist/`、`generated/`、`vendor/`、`apps/harmony/`、`examples/mock-host/`、`fixtures/` 等），并在 `**/tests/**`、`*.test.ts(x)` 与 `scripts/transport-bench/**` 中放宽 `react/rules-of-hooks` 与 `typescript/no-misused-promises`（完整配置见 [`.oxlintrc.json`](.oxlintrc.json)）。
- **未配置的工具**：本仓库依然**未配置** ESLint、Prettier、Biome、`commitlint` 或 Husky Git hooks。静态检查由严格 TypeScript（`tsconfig.base.json` 启用 `strict: true`，`packages/app-core` 另启用 `noUncheckedIndexedAccess: true`）、Oxlint、ShellCheck（针对受跟踪的非 `zsh` `*.sh` 脚本）与仓库自定义校验脚本共同承担。

修改代码时请保持与所在子树现有风格一致，避免顺带格式化无关文件：

- **Node / ESM TypeScript**（`packages/{plugin,protocol,crypto,webrtc,client-core}`、`apps/{server,browser,vscode}`）：2 空格缩进、单引号、无行尾分号、尾随逗号、相对导入显式写 `.js` 扩展名（`NodeNext`）。
- **移动端 TypeScript**（`packages/app-core`、`apps/{android,ios}`）：2 空格缩进、无行尾分号、省略相对导入扩展名（Expo TypeScript 解析规则）。
- **HarmonyOS ArkTS**（`apps/harmony/entry/src/**/*.ets` 及配套 `.mjs` 脚本）：2 空格缩进、单引号、保留行尾分号、显式类型注解。
- **编码与空白**：遵循 [`.editorconfig`](.editorconfig) 与 [`.gitattributes`](.gitattributes)（文本文件统一保存为无 BOM UTF-8），提交前可执行 `git diff --check` 检查行尾空白与冲突标记。

涉及线协议变更时，请同步更新 [`docs/protocol.md`](docs/protocol.md)、`packages/protocol`、`fixtures/` 与相关消费端，不要另建平行契约。

## 文档与多语言同步

### 文档规范

- 根目录文档文件保留 `README.md`、`README.zh.md`、`README.ja.md`、`CONTRIBUTING.md`、`CONTRIBUTING.zh.md` 与 `AGENTS.md`（外加 `LICENSE` 与根清单/配置文件）；专题文档放 [`docs/`](docs/README.md)，设计文档放 [`docs/design/`](docs/design/README.md)。
- 禁止将临时验收记录、本机地址、构建哈希、性能采样、调试日志或验收截图提交入库；需要附截图时请直接上传到 GitHub PR 描述框作为附件。
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) 仅记录用户可感知变化与贡献者信息，普通贡献 PR 无需提前编写发版条目。

### 多语言文件位置与校验方式

| 模块 | 路径 | 语言数与校验方式 |
| --- | --- | --- |
| 移动端共享 UI（Android / iOS） | `packages/app-core/src/locales/` | 9 种语言；`Messages` 类型由 `zh-CN.ts` 派生，其余 8 份通过 `satisfies Messages` 或 `i18n.ts` 中的类型化 `messageCatalogs` 在 `tsc --noEmit` 编译期强制键与参数对齐。如修改 Android 前台服务通知文案，请同步检查 `apps/android/plugins/with-remote-foreground-service.js`。 |
| Host 插件注入 UI | `packages/plugin/src/client-locale.ts` | 4 种语言（`en`、`zh`、`ru`、`uk`），由 TypeScript 编译期校验键完整性。 |
| 插件市场元数据 | `locale/` 与 `packages/plugin/locale/` | 5 种语言（`en`、`ja`、`ru`、`uk`、`zh`），含 `*.json` 与 `README.*.md`。**当前无自动同步校验脚本**，改动时请务必保证两处目录内容字节完全一致。 |
| HarmonyOS 客户端 | `apps/harmony/entry/src/main/ets/services/I18n.ets` | 2 种语言（中/英），由 `node apps/harmony/scripts/check-i18n.mjs` 强制校验。 |
| VS Code 与浏览器扩展 | `apps/vscode/package.nls*.json`、`apps/browser/_locales/*/messages.json` | 2 种语言（中/英），人工保持同步。 |

## 提交、PR 与 CI 流程

1. **基于最新 `main` 切分分支**：建议 Fork 仓库（或在独立分支/worktree）基于最新上游 `main` 开发，确保单个 PR 聚焦单一目标。跨多包或协议级大改动建议先提 Issue 讨论，或拆分为可独立合入的小 PR。
2. **提交信息**：仓库没有强制 commitlint 校验，历史提交普遍采用 Conventional Commits 风格（如 `feat(plugin): ...`、`fix(app-core): ...`、`docs: ...`、`refactor(server): ...`），中英文皆可，清晰说明意图即可。
3. **PR 描述**：写明背景或根因、核心改动点、关联 Issue（`Closes #...` / `Refs #...`），并如实列出实际运行过的本地检查命令与未验证范围。切勿在代码、注释、日志或截图中暴露 Token、私钥、配对二维码、对话 Prompt 或个人本机路径。

### GitHub Actions CI 说明

以下说明仓库 workflow 实际运行的任务（最终合入以维护者审查与检查结果为准）：

- **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)** 在 `push` 与 `pull_request` 时触发，并配置了 **`paths-ignore: ["**.md", "docs/**"]`**——纯 Markdown 或 `docs/**` 文档 PR 不会自动触发该工作流。
  - 代码或配置变更会运行：`changes`（变更路径检测）、`quality`（构建、dist 差异校验、类型检查、Oxlint 类型感知检查、非 `zsh` `*.sh` 脚本 ShellCheck、`verify-dsh-plugin.mjs`、workspace 测试、HarmonyOS Node 契约/多语言/版本检查、生产构建及 `verify-packed-webrtc.mjs`）、`xfs-refresh`（Linux XFS 凭据刷新锁测试）以及 `plugin-package`（`.tgz` 与浏览器扩展打包）。
  - 路径触发任务：`android-apk`（PR 仅编译 `arm64-v8a`）与 `ios-build`（macOS 无签名编译，不依赖 Apple 签名凭据，fork PR 也可运行）。
- **[`.github/workflows/harmony-hap.yml`](.github/workflows/harmony-hap.yml)** 仅在上游仓库的自托管 `harmonyos` runner 上通过手动触发或发布调用执行，不会自动在 fork PR 上运行。

## 安全与隐私边界

- **端到端加密与可见元数据**：业务会话载荷、Prompt、模型输出、工具输入输出、审批、工作区源码及文件传输均通过 `Noise_IK_25519_ChaChaPoly_SHA256` 端到端加密，前提是服务端在首次接入时如实分发设备身份公钥（信任模型见 [`docs/end-to-end-encryption.md`](docs/end-to-end-encryption.md)），在此前提下信令/中继服务端无法解密内容。即使如此，服务端仍可见账号与设备归属、`deviceId`、角色、显示名、公开身份密钥、在线状态、连接时间、`connectionId`、协商能力与网络路径、IP 地址、WebRTC 信令与 ICE candidate，以及中继帧的大小、方向与时序等元数据。请勿将端到端加密表述为“服务端看不到任何信息”。浏览器启动器的隐私边界见 [`docs/PRIVACY.md`](docs/PRIVACY.md)。
- **诊断信息脱敏**：Token、私钥、配对码、二维码、Prompt、源码与本机个人路径均禁止写入日志或公开发布到 Issue / PR。
- **安全漏洞上报**：**请勿在公开 Issue 或 Pull Request 中披露安全漏洞详情或可利用 PoC。** 请先查看仓库的 [Security 页面](https://github.com/liguobao/ds-harness-remote/security)，如已启用私密漏洞报告入口请优先通过该入口提交；若页面尚未提供私密提报入口，请勿公开贴出利用细节，可先在 Issue 中仅简短联系维护者约定私密沟通渠道后再提供完整复现信息。

## 版本发布与许可证

- **维护者发布**：正式版本号升级、npm 发布、GitHub Release、Docker 镜像、Android APK 与 HarmonyOS 未签名 HAP 均由维护者在上游仓库通过 `v*` tag 和 [`.github/workflows/release.yml`](.github/workflows/release.yml) 统一执行（iOS 签名与 TestFlight 分发由 Xcode Cloud 负责，见 [`docs/ios-xcode-cloud.md`](docs/ios-xcode-cloud.md)）。普通功能或修复 PR 请勿擅自修改各包版本号或在根目录执行 `npm publish`。
- **开源协议**：本仓库采用 [MIT License](LICENSE)（`Copyright (c) 2026 DSH Remote contributors`）。部分引入的上游组件保留原有协议（例如 [`packages/app-core/src/vendor/ds-bot/`](packages/app-core/src/vendor/ds-bot/README.md) 遵循 Apache-2.0）。
