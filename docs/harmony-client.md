# HarmonyOS 客户端（apps/harmony）

HarmonyOS 7.0（API 26）原生客户端，纯 ArkTS 实现，不依赖任何 Native 模块。

## 最低系统版本

**仅支持 HarmonyOS 7.0（API 26）及以上。**

这是有意的产品取舍，不是隐藏的兼容性风险：华为开发者官网 2026-10-27 的存量设备数据显示，API 26 已占 77.01%，6.x 合计 22.73%，HarmonyOS 5 不足 0.3%。以 API 26 为下限换取能力基线，代价是放弃约两成尚未升级的设备。安装前请确认设备系统版本。

## 目录结构

```
apps/harmony/entry/src/main/ets/
├── crypto/        # X25519、ChaCha20-Poly1305、SHA-256、HKDF、Noise IK（纯 ArkTS）
├── net/           # RelayTransport、SecureTransport、ServerApi、HarnessClient、RemoteGateway
├── protocol/      # Protocol、SecureMessageCodec、Types
├── services/      # AppRuntime（运行时/会话管理）、SecureStore（凭据存储）、Theme
├── model/         # 数据模型
├── pages/         # ArkUI 主界面
└── entryability/  # Ability 生命周期
apps/harmony/tests/               # Node 侧一致性测试（见下）
apps/harmony/scripts/             # CI 辅助脚本（签名注入）
```

## 与共享包的对应关系

| 共享实现 | 鸿蒙侧 | 说明 |
|---|---|---|
| `packages/protocol` | `ets/protocol/Protocol.ets`、`SecureMessageCodec.ets` | 帧头（`DSHF` magic、版本 1、17 字节头、48 KiB 分片、4 MiB 上限、8 路上限）与共享实现逐字节一致 |
| `packages/crypto` | `ets/crypto/` | Noise IK 状态机为独立 ArkTS 实现，靠仓库的 `fixtures/crypto/v1/noise-ik.json` 金标向量保证互通 |
| 传输层 | `ets/net/` | Relay（WebSocket）+ Noise IK；`forcesRelay` 可强制走中继 |

**协议约束**：`docs/protocol.md` §12.1 禁止自行实现 Noise state machine。本客户端是过渡期的独立实现，用金标向量守住互通性；Rekey（§12.3）尚未实现，与 `packages/crypto` 的现状一致，由 `docs/TODO.md` 跟踪，不作为本客户端的单独缺陷。

## 构建

要求 DevEco Studio（含 HarmonyOS 7.0 / API 26 SDK）或已安装 HarmonyOS SDK 的命令行环境。

```bash
cd apps/harmony
hvigorw --no-daemon assembleHap -p product=default -p buildMode=release
```

产物在 `entry/build/default/outputs/default/`。也可在 DevEco Studio 中直接打开 `apps/harmony` 目录构建运行。

编译产物（`*.hap`、`/release/`）已在 `.gitignore` 中忽略，不允许提交入库；正式包通过 GitHub Releases 的 Assets 发布。

## 签名与发布流程

**签名凭据永不入库。** 仓库里的 `build-profile.json5` 中 `signingConfigs` 为空数组；本机签名配置放在被忽略的 `build-profile.local.json5`（`.gitignore` 含 `*.local.json5`）。

本机构建（要安装到设备时必须签名）：

```sh
harmony/scripts/build-local.sh      # 临时顶替签名配置 → 构建 → 还原，签名材料不落仓库
```

hvigor **只读** `build-profile.json5`（不自动合并 `.local.json5`），所以脚本做的事是：备份 → 用 local 覆盖 → `devecocli build` → 通过 `trap` 无条件还原；产物在 `entry/build/default/outputs/default/entry-default-signed.hap`。

CI 打包使用 `.github/workflows/harmony-hap.yml`，签名材料只通过仓库 Secrets 注入：

| Secret | 内容 |
|---|---|
| `HARMONY_SIGNING_STORE_B64` | `.p12` 密钥库（base64） |
| `HARMONY_SIGNING_STORE_PASSWORD` | 密钥库口令 |
| `HARMONY_SIGNING_KEY_ALIAS` | 密钥别名 |
| `HARMONY_SIGNING_KEY_PASSWORD` | 密钥口令 |
| `HARMONY_SIGNING_CERT_B64` | `.cer` 证书（base64） |
| `HARMONY_SIGNING_PROFILE_B64` | `.p7b` 授权文件（base64） |

构建前由 `apps/harmony/scripts/inject-signing.mjs` 把材料写入临时目录并注入 `build-profile.json5`；缺少 Secrets 时脚本以退出码 2 跳过，产物为未签名包并给出告警。

> GitHub 托管的 Ubuntu runner 未预置鸿蒙 SDK，因此该工作流使用 `[self-hosted, harmonyos]` 标签的自建 runner，工作流第一步会校验 `hvigorw` 是否存在，缺失即失败并给出原因。

## 安全实现要点

- **凭据不落明文**：设备 X25519 私钥、账号 `accessToken`/`refreshToken`、Host 公钥固定记录（host pins）全部写入系统 **Asset Store Kit**（`@kit.AssetStoreKit`），配置 `Accessibility.DEVICE_UNLOCKED` + `SyncType.NEVER`，等价于 Android 端的 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`。应用沙盒 KV（`preferences`）只保存服务地址、邮箱、设备别名、主题等非敏感项。
- **旧数据自动迁移**：升级后首次启动会把历史明文私钥/token/pin 迁入 Asset Store 并删除明文条目。
- **降级可见**：`SecureStore.isSecretStorageHealthy()` 反映 Asset Store 是否可用；不可用时才回退到沙盒 KV 并写 `WARN` 日志。
- **日志脱敏**：控制帧只记录 `type` 与长度，不打印 payload；会话列表日志不包含会话标题（标题通常来自用户首句 prompt）。遵循 `docs/protocol.md` §25 不变量 12。
- **Host 身份固定（TOFU）**：`AppRuntime.enforceHostPin()` 首次连接写入 pin，公钥变更直接中断握手；`SecureStore.forgetHostPin()` 提供清除入口。

## 测试

| 层级 | 命令 | 覆盖 |
|---|---|---|
| 一致性（Node，CI 可跑） | `pnpm exec vitest run apps/harmony/tests/crypto.test.ts` | 用仓库 `fixtures/crypto/v1/noise-ik.json` 校验 X25519 公钥推导、handshake msg1 逐字节、msg2 payload、双向 transport 帧、篡改拒绝 |
| 设备端（DevEco / ohosTest） | `entry/src/ohosTest/ets/test/` | Crypto（X25519 对称性、AEAD 往返、篡改/换钥拒绝）、SecureStore（Asset Store 可用性、token/身份往返、host pin 清除） |

Node 侧测试通过 esbuild 把 `.ets` 当作 TypeScript 打包，并用确定性桩替换 `@kit.CryptoArchitectureKit`，其余代码与实际出包完全一致。

## 已知差异与后续

- **Rekey** 未实现（与共享 `packages/crypto` 同步待办）。
- **断线重连**：已具备指数退避重连（1/2/4/8/15/30 秒）与失败阈值判定；切后台/切网场景建议再补真机用例。
- **文案国际化**：界面文案仍硬编码中文，待抽到 `resources/*/element/string.json`。
- **功能对齐 dsh-go**：斜杠命令、`@` 引用、附件与图片、审批卡、轨迹、子代理、终端、分享卡等能力尚未在鸿蒙端落地，按版本逐步补齐。

## 维护边界

本目录由 HarmonyOS 客户端维护者负责：`ets/` 下的实现、`tests/`、`scripts/inject-signing.mjs` 与 `.github/workflows/harmony-hap.yml`。共享协议或密码学变更（`packages/protocol`、`packages/crypto`、`fixtures/crypto/`）时，需同步更新本客户端并通过上述一致性测试；金标向量变更必须经过互通性评审。
