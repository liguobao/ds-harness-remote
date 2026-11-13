# V0.03 自审报告

审计对象：`release/v0.03` 分支上的 4 个提交（PR #242 整改 + 功能对齐）。
方法：对照 Host 实际契约逐个核对调用点，并在 ArkTS 编译器 + 金标向量测试下验证。

## 已修复（审计发现）

| # | 严重度 | 问题 | 影响 | 修复 |
|---|---|---|---|---|
| 1 | **高** | `session/projections` 返回的是 `{ asOfSeq, values }`，代码按 `{ context: { percent } }` 解析 | 上下文占用胶囊永远不显示 | 改为扫描 `values`：优先 `percent`，其次 `usedTokens / contextWindow` |
| 2 | **高** | 安全存储读失败时 `loadOrCreateIdentity` 会生成新身份 | 设备被服务器当成新设备，凭据与全部 Host 固定记录失效 | 本地仍有身份记录却读不到私钥时**抛错中止**，不轮换 |
| 3 | 中 | 搜索结果按 `{ sessionId, updatedAt, running, blank }` 严格校验 | 主机字段形状一变就「永远搜不到」，且无日志 | 兼容 Flat 与 `{ session }` 两种形状 + `id` 兜底，跳过数量入日志 |
| 4 | 中 | 命令无文字回执时（如 `/permission`）输入被静默吞掉 | 用户以为消息丢了 | 追加「已执行 /xxx」回执 |
| 5 | 中 | 自动重连只在 `handleDisconnect` 触发；单次连接失败后不再重试 | 网络抖动一小时后不会自愈 | 连接失败时若处于自动重连序列，继续按下一档退避 |
| 6 | 低 | `infoMsg` 声明后从未渲染 | 「已清除固定记录」提示不可见 | 在错误提示上方渲染并随会话切换清空 |
| 7 | 低 | 标题区新增两枚胶囊后窄屏易挤压 | 排版风险 | 标题 220→150，模型胶囊 78→64 |

## 已核实无误

- **Asset Store 契约**：`AssetMap = Map<Tag, Value>`，`add/query/remove` 与 `RETURN_TYPE.ALL` 取 `SECRET` 的用法正确；`DEVICE_UNLOCKED` + `SyncType.NEVER` 对应 Android 的 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`。
- **金标向量**：msg1 逐字节一致（107 B）、msg2 payload `host-ack`、3 条 transport 双向一致、篡改帧被拒，共 6/6。
- **命令通道**：`commands/execute` 的 `{sessionId, line}` 与 Host 侧 `requiredString(args.agentId ?? args.sessionId)`、`args.line` 对齐。
- **模型目录**：`{ default, groups[{ id, name, models[{ id, name, description }] }] }` 与解析实现一致。
- **身份固定**：`forgetHostPin` 重建 pin 表，不会留下空值；`enforceHostPin` 逻辑未被改动。

## 已知但未修复（受上游或环境限制）

| 项 | 原因 | 建议 |
|---|---|---|
| 测试依赖 `esbuild` 未在 `package.json` 声明 | 依赖 pnpm `node-linker=hoisted` 从 `apps/browser` 提升；若未来启用严格隔离会失效 | 后续在根 `devDependencies` 显式声明 `esbuild`（会改动 lockfile，本次未做） |
| Asset Store 不可用时仍回退明文 KV | 硬失败会让无锁屏设备直接无法登录 | 已用 `WARN` 日志 + `isSecretStorageHealthy()` 暴露；后续可改为强制失败并引导用户 |
| `.github/workflows/ci.yml` 的 `changes` 输出了 `harmony` 但没有 job 消费 | 目前鸿蒙测试放在 `quality` 里无条件跑，够用 | 若将来鸿蒙测试变慢，再按 `harmony` 条件跳过 |
| `session/updateQueue`、附件、文件树等 | Host 未暴露对应 endpoint 或需要上传通道 | 见 `docs/harmony-parity.md` 第二、三节 |

## 验证命令

```bash
cd harmony   # 注：工程已从 apps/harmony 上移到仓库根 harmony/
hvigorw --no-daemon assembleHap -p product=default -p buildMode=debug   # 编译通过
pnpm exec vitest run harmony/tests                   # 6/6 通过
```
