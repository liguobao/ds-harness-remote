# 升级提示词：ds-harness-remote 升级兼容 deepseek-harness 0.1.7

> 本文件是可直接交给编码 Agent 执行的升级任务提示词，依据 2026-09 对
> `deepseek-harness` 仓库 `dsh-v0.1.6-alpha.2` → `dsh-v0.1.7-alpha.1` 的兼容性评估写成。
> 实施时以源码为准，如与评估结论有出入，记录差异并更新本文件。

## 一、任务目标

把 `F:\workspace\github\ds-harness-remote` 对 DeepSeek Harness 的兼容基线从
**`0.1.6-alpha.2`** 升级到 **`dsh-v0.1.7-alpha.1`**（deepseek-harness 仓库 0.1.7 系列的唯一 tag，
参考仓库 `F:\workspace\github\deepseek-harness` 已 checkout 在该 tag）。

目标不是「只声明支持」，而是：**在 0.1.7-alpha.1 上 Host 能正常激活、Web/Desktop/Android 主链路
可用，同时不破坏既有版本（rc.2 / 0.1.2 / 0.1.5 / 0.1.6）的运行时兼容**。

## 二、开工前提（必须遵守）

1. 先通读仓库 `AGENTS.md`、`README.md`、`README.zh.md`、`TODO.md`、`docs/protocol.md`、
   `docs/plugin-integration.md`，并遵守 AGENTS.md 的「Implementation Rules」「Test Policy」
   「Documentation Rules」（官方 ApiProxy/TypertGateway 为唯一业务面、allowlist 固定、
   fail-closed、禁写日志、不新增自定义 Harness 业务适配层等）。
2. 只读参考 deepseek-harness 源码做对照，常用命令（PowerShell 下 tag 引用必须用
   `${tag}:路径` 防止冒号被当作用域符）：
   ```powershell
   git -C F:\workspace\github\deepseek-harness diff dsh-v0.1.6-alpha.2 dsh-v0.1.7-alpha.1 -- <路径>
   git -C F:\workspace\github\deepseek-harness show "dsh-v0.1.7-alpha.1:<路径>"
   ```
3. 不修改 deepseek-harness 仓库；不修改用户未要求改动的部分；不提交 `node_modules`、构建产物等
   （AGENTS.md 规则 9）。
4. 每个改动点先读现状代码再动手；所有结论以源码为准，下述评估结论如有出入以源码为准并记录差异。

## 三、已知评估结论（实施依据，按优先级）

### P0 阻断项（不改则 0.1.7 上 Host 无法启动或核心链路损坏）

**P0-1 dsh-settings 0.1.7 重写 → Host 激活抛错**
- 0.1.7 移除 `SettingsProvider`/`SettingsScope`/`SettingsRegisterOptions`/`SettingsApplies`/
  `SettingsUpdateSource` 与 `register()`，改为 profile 驱动的 `SettingsForms`（只保留
  `describe/update/replace/mutate`，ns=Loader entry id，`applies` 恒 `'live'`，配置字段需在
  schemastery schema 上标 `.volatile()` 才进表单）。
- 改动点：`packages/plugin/src/index.ts`（`SettingsScope/Provider` 类型导入、
  `settings.register(pluginSettingsNamespace, Config, {base, applies:'restart', validate})`、
  `migrateLegacySettings`）、`packages/plugin/src/control-runtime.ts`
  （`SettingsScope<Config>` 及大量 `settings.get()/replace()`）。
- 要求：仿照现有 `TypertGatewayLike` 模式定义本地结构化设置接缝 + 运行时特性检测
  （`typeof settings.register === 'function'` 走 ≤0.1.6 路径，否则走 0.1.7
  `SettingsForms`/Loader entry fiber 路径）；`/remote` 控制平面的
  `settings.get/configure/server.set/role.set/codex.set/acp.*` 在 0.1.7 上换用新的读写载体；
  评估 plugin 自身配置哪些字段标 `.volatile()`。注意 0.1.7 会自动迁移旧 `settings.yaml`，
  `migrateLegacySettings` 只保留给 ≤0.1.6 路径。

**P0-2 TypertGateway 流打开契约参数位移 → 流式订阅断裂**
- 0.1.7 `wireStream.open(endpoint, payload, uplink, peer, signal)` /
  `openWireStream(endpoint, payload, uplink, peer, signal, control)`：第 3 参数从 `signal`
  位移为 `uplink`。旧 3 参调用会：`$events` 打开抛 `AbortSignal.any([undefined,...])`、
  普通流抛 `control.signal` 错误、或信号被静默丢弃。
- 改动点：`packages/plugin/src/typert-gateway-contract.ts`
  （`TypertGatewayWireStreamLike.open` 3 参契约）、`packages/plugin/src/typert-gateway-switch.ts`
  （bind 与 `install()` 的 monkey-patch 包装器需按新 arity 透传 uplink/peer/control）、
  `packages/plugin/src/harness-remote-bridge.ts:360`（`gateway.open(endpoint, payload, signal)`）。
- 要求：流打开统一走公开面——只读流用 `gateway.stream({namespace, method, args, signal})`
  （签名未变），或 5 参 `wireStream.open(endpoint, payload, <已结束的 uplink 迭代器>, undefined, signal)`；
  绝不把 `AbortSignal` 当第 3 参。`dispatchRpc` 3 参调用仍可用（peer 省略即 operator），保持。

**P0-3 二进制 RPC 结果 attachments → readBytes/officeToPdf 远端拿到 null**
- 0.1.7 `encodeRpcResult` 把二进制字段投影为
  `{ok:true, value:{...data:null}, attachments:[{path:['data'], bytes}]}`；
  `WorkspaceFileBytes.data` 从 base64 string 改为原生 `Uint8Array`。
- 改动点：dispatch 接缝（`harness-remote-bridge.ts` 的 `call`/`commitTransfer` 与
  `LocalTypertGateway` 契约）需收集 `attachments` 并经现有 chunked transfer 带外传输，
  客户端重建字节；zod 校验改为 attachment envelope。
- 影响端点：`workspaceFiles/readBytes`、`officeToPdf/render`（响应二进制化）。

**P0-4 allowlist 与端点签名变更**
- 移除（allowlist 变死条目）：`workspaceFiles/readAll`、`workspaceFiles/readRelated`
  （并入 readBytes：`options:{range?, baseFile?}`，原 `range` 参数改名 `options`）、
  `subagents/list`（目录改由 session projections 承载）、`agentPresets/read`
  （及 copy/deletePreset，agentPresets 拆为 registry，list 响应去掉 `trust`/`authorable`）。
- `workspaceFiles/changes` 流现在**必填 `path`**，语义改为单文件/目录级——订阅 key 与 schema
  需更新。
- 新增（0.1.7 Web UI 会调用，需评估放行）：`session/projections`、
  `session/workspacePathApplications`、`workspace/initializeDefault`、`workspace/pinSession`、
  `workspace/unpinSession`；全新 `job.*`（job-controller）与 `account.*`（account-controller）
  命名空间按客户端是否消费决定是否放行。
- 改动点：`packages/plugin/src/harness-remote-bridge.ts` 的 `HARNESS_REMOTE_ALLOWLIST`
  与各 zod schema。

**P0-5 类型编译断裂**
- `@deepseek-ai/dsh-settings` 的 `SettingsScope`/`SettingsProvider` 移除；
  `@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2` 是已无仓库来源的遗留 npm 包（仅 type-import）。
  要求：要么保留该 devDependency pin，要么把 `ApiProxy`/`RpcResult`/`RpcRequest`/`RpcResponse`
  迁为本地结构化类型并去掉悬空依赖（二选一，给出理由）；`tests/control-runtime.test.ts` 等
  测试的 mock 同步。

### P1 适配项（功能降级/UI 特性缺失）

- `settings/describe` 响应：namespace view 新增必填 `autoGenerate`，`applies` 收窄为 `'live'`，
  ns 集合=带 volatile 字段的活动 profile entry——`harness-remote-bridge.ts:190-195` 的
  describe-membership 写保护逻辑要兼容新形状（对非 entry ns 的写入 0.1.7 会返回
  `settings/rejected`，可依赖该错误）。
- `session/list` 响应：`SessionSummary` 新增必填 `agentAvailable`、`SessionProjectionHints`
  新增必填 `kind: 'cached'|'sequenced'`；`session/control` 流**移除 `jobs` 帧**；
  `workspace/follow` baseline 新增 `pinnedSessionIds`、增量新增 `{type:'pinned'}`、
  `archiveSession` 新增可选 `stopActivity` 与新错误 `workspace/session-active`。
- `permissionPresets/catalog` 响应：新增必填 `defaultOptions` + `defaultPreset`。
- 新错误码映射：`gateway/uplink-overflow`、`gateway/protocol`（`safe-error.ts`/`RpcError` 补齐）。
- `session/fork`：`atSeq` 语义改为精确包含边界（open cut 会收到合成 closers、新 `turn/end`
  原因 `forked`）。
- client-connection 内部：`ConnectionRpcHandler` 4 参 + `ConnectionRpcHandlerResult`、
  浏览器 fetch 改文档相对路径、新增 `@deepseek-ai/dsh-scope` peer——plugin 的 client.ts
  走自己的 control RPC 不直接受影响，但注入的官方 bundle 两端要同步升级（若出现附件响应，
  旧客户端 `response.json()` 会抛错）。

### P2/P3 清理与验证

- devDependencies（根 + `packages/plugin/package.json`）：`@deepseek-ai/dsh-*` 从
  `0.1.6-alpha.2` → `0.1.7-alpha.1`，`@deepseek-ai/cordis` 4.0.2 → 4.0.3，schemastery
  ^3.18.2 → 3.18.3、loader 1.0.4（`dsh-settings` 若需双版本验证可先升后回验）。peer ranges
  已容纳 0.1.7（`>=0.1.5-alpha.1` 匹配），验证通过后可在文档注明支持区间。
- **不需要改动**：`cordis.patch.yml`（loader entry-list 级 patch，对 loader 1.0.4/include
  1.0.8 仍可干净应用，验证即可）、client inject 清单与 slot 契约
  （`shell.overlay`/`sidebar.footer.action`/`plugins.bundle.config` 均未变）、Session V3 门控
  （`harnessSessionGeneration` 对 0.1.7 仍为 v3，V4 仅 on-disk 未发布）、`$events` 协议、
  terminal 端点、commands.execute `submittedAttachments` 参数、typert-protocol 导出
  （全部增量）。
- 文档同步：`README.md`/`README.zh.md`/`AGENTS.md`/`TODO.md`/`CHANGELOG.md`/`docs/**`
  （含 `docs/design/`、`packages/plugin/README.md`、`apps/android/README.md`、
  `apps/vscode/README.md`）的版本矩阵、状态表、能力描述加入 0.1.7-alpha.1；按 AGENTS.md
  要求保持 README/AGENTS/TODO 与实现一致。

## 四、实施顺序建议

1. P0-1 settings 接缝（决定 Host 能否激活）→ 2. P0-2 gateway 流契约 → 3. P0-3 attachments
   → 4. P0-4 allowlist/端点 → 5. P0-5 类型面 → 6. 升 devDeps、过 check/test/build →
   7. 0.1.7 实例 E2E → 8. 文档同步。每完成一步更新 TODO 跟踪（如需）。

## 五、验收标准（按顺序全部通过才算完成）

```powershell
pnpm install
pnpm --filter './packages/**' -r build
pnpm -r check
pnpm -r test            # 允许的既有 Windows 平台假设失败例外见 AGENTS.md
NODE_ENV=production pnpm -r build
node scripts/verify-dsh-plugin.mjs
git diff --check
```

- 独立 `dsh-v0.1.7-alpha.1` 实例：Plugin 树加载、Host identity、client bundle 下发、
  Web → Host 主链路（连接、会话列表、Prompt、审批、文件/终端）可用。
- Desktop/dsh-TUI 跨机回归：Workspace/Session/Prompt/approval、Terminal（含断线不重放）、
  Files（readBytes 分页预览）、断线重连。
- Android 真机回归：文件预览、终端、权限选择器（catalog 新字段）、CodeX replacement/stream、
  WebRTC 重连。
- 旧版本回归：在 `dsh-v0.1.6-alpha.2`（及条件允许时 rc.2）实例上确认主链路未破坏
  （特性检测路径生效）。
- 文档与实现一致；不得把 TODO 中的目标能力描述为已完成。

## 六、交付物

1. 代码改动（含新增/更新的测试，遵循 Test Policy：只为核心状态机/协议/权限面补测试）。
2. 同步后的文档（README 中英文、AGENTS.md、TODO.md、docs 相关页）。
3. 一份升级说明（本次改动摘要、0.1.7 支持范围、遗留风险与后续验证项），写入 CHANGELOG
   或 PR 描述。
