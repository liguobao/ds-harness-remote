# HarmonyOS 客户端 V0.03 发布说明（可直接用于 GitHub Releases）

## DS Remote for HarmonyOS V0.03

首个公共预览版本。HarmonyOS 7.0（API 26）及以上，纯 ArkTS 实现，不含原生模块。

### 本次亮点

- **插话与排队**：回复生成到一半也能发消息，选择「插话」立刻打断，选择「排队」等本轮结束。
- **随时中断**：生成中一键停止。
- **斜杠命令**：输入 `/` 直接调起 `/compact`、`/permission`、`/model` 等命令。
- **会话管理**：重命名、归档、全文搜索都在客户端内完成。
- **上下文可见**：聊天页副标题实时显示上下文占用。
- **断线自愈**：指数退避自动重连，切后台或换网后不需要手动重连。

### 安全

- 设备私钥与账号 token 存放在系统 **Asset Store**（设备解锁可读、不同步到其它设备），不再明文落盘；升级后自动迁移旧数据。
- 日志不再输出 token、会话标题等敏感字段。

### 安装

1. 从 Releases 下载 `*.hap`
2. 确认设备为 HarmonyOS 7.0（API 26）及以上
3. 通过 `hdc install` 或系统安装器侧载

> 早期不同签名的测试包无法覆盖安装，请先卸载旧版本。

### 已知限制

- 仅支持 HarmonyOS 7.0（API 26）及以上
- Noise IK 长连接 Rekey 尚未实现
- 界面文案暂为中文

---

# PR 描述更新草稿（覆盖 #242 原描述）

## 变更内容

新增 HarmonyOS 7.0（API 26）DS-Remote 原生客户端，位于 `apps/harmony/`。

**自上一轮审核后的改动：**

1. **凭据加密落盘**（阻断项 1）：`SecureStore` 改用 `@kit.AssetStoreKit`，设备私钥、`accessToken`/`refreshToken`、host pins 全部写入系统资产库，配置 `Accessibility.DEVICE_UNLOCKED` + `SyncType.NEVER`；`preferences` 仅保留服务地址、邮箱、设备别名、主题等非敏感项；升级后首次启动自动迁移历史明文数据。
2. **日志脱敏**（阻断项 2）：控制帧只记录 `type` 与长度；会话列表日志移除会话标题；`RelayTransport` 与 `HarnessClient` 均按 `docs/protocol.md` §25 不变量 12 处理。
3. **包名去模板化**（阻断项 3）：`bundleName` 改为 `cn.r2049.dshremote`，`vendor` 改为 `r2049`，`versionName 0.03` / `versionCode 1000008`；版本号由 `bundleManager` 读取，不再硬编码。
4. **测试与 CI**（阻断项 4）：
   - 新增 `apps/harmony/tests/crypto.test.ts`，用仓库 `fixtures/crypto/v1/noise-ik.json` 校验金标向量（msg1 逐字节、msg2 payload、双向 transport、篡改拒绝），已在本机跑通 6/6。
   - `ohosTest` 模板用例替换为 `Crypto.test.ets` 与 `SecureStore.test.ets`（含 Asset Store 可用性验证）。
   - `ci.yml` 的 changes 检测覆盖 `apps/harmony`，`quality` 任务新增一致性测试步骤。
   - 新增 `.github/workflows/harmony-hap.yml`：自建 `[self-hosted, harmonyos]` runner 构建签名 HAP，签名材料仅通过 Secrets 注入（`apps/harmony/scripts/inject-signing.mjs`），仓库内 `signingConfigs` 保持为空。
5. **文档**（阻断项 5）：新增 `docs/harmony-client.md`（最低系统版本与取舍、架构、构建、签名与发布、安全实现、测试、维护边界）与 `docs/harmony-parity.md`（对 dsh-go 的功能对齐与差距）；`README.md`、`README.en.md`、`README.ja.md`、`README.zh.md` 客户端表格均已同步。
6. **建议项**：Host 公钥固定新增清除入口（`forgetHostPin`）；断线改为指数退避自动重连（1/2/4/8/15/30 秒，最多 6 次）；移除模板 cpp 原生模块与 `libentry.so` 依赖；文件权限统一 644。

**新增功能（功能对齐）**：插话/排队切换、中断当前轮、斜杠命令通道、会话重命名/归档/搜索、上下文占用显示。

## 测试设备

- 华为 MatePad Edge
- 华为 Mate70 RS
- 华为 PC（HarmonyOS 2in1，开发调试）

## 构建方法

```bash
cd apps/harmony
hvigorw --no-daemon assembleHap -p product=default -p buildMode=release
```

签名材料不随仓库分发；CI 通过 Secrets 注入，本地开发使用被 `.gitignore` 忽略的 `build-profile.local.json5`。

> 编译产物（`*.hap`、`release/`）不入库，正式包通过 GitHub Releases Assets 发布。

## 迁移与维护说明

- 客户端本地数据（明文 KV）在升级后自动迁移到 Asset Store，用户无需操作。
- 协议与密码学改动需同步更新 `fixtures/crypto/v1/` 并跑通一致性测试。
- 维护边界：`apps/harmony/ets/`、`tests/`、`scripts/inject-signing.mjs`、`.github/workflows/harmony-hap.yml`。
