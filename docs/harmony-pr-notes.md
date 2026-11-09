# 鸿蒙客户端 PR 交付说明（迁移 / 安全存储 / 测试 / 打包）

> 对应评审意见：SecureStore 迁移丢私钥、安全存储不可用时的明文降级、`apps/harmony` 旧路径、
> 以及 Server Origin 校验被放宽。本文记录每一条的处理方式与实测结果。

## 1. 工程位置迁移：`apps/harmony` → `harmony/`

工程已经上移到仓库根，但 CI 与文档里还留着旧路径。这次一次性改完：

| 位置 | 改动 |
|---|---|
| `.github/workflows/ci.yml` | 变更检测 `apps/harmony/*` → `harmony/*`；一致性测试 `pnpm exec vitest run apps/harmony/tests/crypto.test.ts` → `pnpm exec vitest run harmony/tests` |
| `.github/workflows/harmony-hap.yml` | `working-directory: harmony`；构建产物收集 `entry/build` 不变，上传路径 `harmony/artifacts/*.hap`；注释与前置说明同步 |
| `harmony/tests/crypto.test.ts` | fixture 路径不再写死层数：从测试文件目录向上最多 6 层找 `fixtures/crypto/v1/noise-ik.json`，找不到就明确报错。工程再挪一次也不会变成 ENOENT |
| `harmony/README.md`、`docs/harmony-client.md`、`docs/harmony-audit-v0.03.md` | 构建/测试命令与目录说明统一到 `harmony/` |

旧路径的 ENOENT 根因就是 fixture 相对路径多退了一层（`apps/harmony/tests` 时代的 `../../..`），
现在改成按 `fixtures/` 目录探测，和层数解耦。

## 2. SecureStore：迁移顺序与「不降级明文」

### 2.1 迁移旧私钥时先把写入确认下来

`loadIdentity()` 与 `migratePlaintextSecrets()` 里，旧记录（含明文私钥）只有在
**安全存储写入并回读一致**之后，才会被改写成「只剩公钥」的版本：

- 新增 `writeSecretVerified()`：`writeSecret()` 成功后再 `readSecretQuiet()` 回读比对，
  字节不一致同样当失败；
- 失败时保留原记录（哪怕它是明文的），日志记 `identity migration kept legacy record`；
- 本次运行仍用内存里的私钥，不打断用户。

顺带修了 `writeSecret()` 自身的隐患：它先 `delete` 再 `add`，`add` 失败时旧值已经被删掉。
现在写之前先静默读一次旧值，失败时用 `restoreSecretQuiet()` 尽力写回。

### 2.2 安全存储不可用时明确报错，不再写明文

`saveIdentity()` / `saveCredentials()` 删掉了「Asset Store 不可用就退回 preferences」的分支，
改为抛 `SecureStorageUnavailableError`（文案提示解锁设备后重试），调用方按普通错误展示。
刷新 token 的 `adoptCredentials()` 是唯一的例外：它把新 token 留在内存并提示用户，
因为此时服务器已经消费掉旧 refresh token，抛出去只会让本次重连直接失败。

Host 公钥固定（`saveHostPins`）保持原样：那是公钥，不是秘密。

### 2.3 失败场景验证

`harmony/tests/secure-store.test.ts`（新增）用 esbuild 把真实的 `SecureStore.ets` 打包，
只替换 `@kit.*` 平台模块，覆盖：

| 场景 | 断言 |
|---|---|
| 迁移时写入失败 | 仍读到私钥，且旧记录里私钥没被抹掉 |
| 迁移成功 | 私钥进安全存储，明文记录只剩公钥 |
| 安全存储不可用时 `saveIdentity` | 抛 `SecureStorageUnavailableError`，preferences 里没有私钥 |
| 安全存储不可用时 `saveCredentials` | 抛错，preferences 里没有 token |
| 覆盖写失败 | 旧凭据被写回，且仍然抛错 |

修复前后的对照（同一套场景、同一份桩代码，直接跑 `SecureStore.ets`）：

```
旧代码 · 迁移失败后还能读到私钥: true      ← 本次运行内存里还有
旧代码 · 旧记录里还留着私钥: false          ← 但磁盘上最后一份已经被删了
旧代码 · saveIdentity 拒绝明文: false
旧代码 · 明文私钥写进了 preferences: true
旧代码 · saveCredentials 报错: false
旧代码 · 明文 token 写进了 preferences: true
```

```
新代码 · 与上面同一套场景：10/10 通过
  ok   迁移失败时仍能读到私钥
  ok   迁移失败时保留旧记录（私钥没被抹掉）
  ok   迁移成功时私钥进安全存储
  ok   迁移成功后明文记录只剩公钥部分
  ok   安全存储不可用时 saveIdentity 明确报错
  ok   saveIdentity 失败时不落明文私钥
  ok   安全存储不可用时 saveCredentials 明确报错
  ok   saveCredentials 失败时不落明文 token
  ok   写新值失败时旧凭据被写回
  ok   写失败仍然显式报错
```

## 3. Server Origin 校验：已从本 PR 移出

`apps/server/src/gateway.ts` 已恢复成上游版本（`git diff upstream/main -- apps/server/src/gateway.ts`
为空），本 PR 不再包含任何 Server 行为改动，`DSH_SERVER_STRICT_ORIGIN` 这个开关也不再存在。

如果以后确实需要放宽，建议单独提案，至少要说清：

- **兼容场景**：自建服务挂在反向代理后面（浏览器 `Origin` 是站点 origin，而 `PUBLIC_URL` 带端口），
  以及不太可能发送 `Origin` 的原生 WebSocket 客户端；
- **安全边界**：`Origin` 是浏览器侧 CSWSH 的主要防线，放宽后需要额外的设备 token + Host 固定校验兜底，
  并且应该是**显式白名单**（`DSH_SERVER_ALLOWED_ORIGINS`）而不是默认放行；
- **回归范围**：现有 `apps/server` 的 Origin 拒绝对应用例必须保持不变。

## 4. 测试与打包结果

### 本机能验证的

| 项 | 结果 |
|---|---|
| `harmony/entry/src/main/ets` 全量编译 | ✅ `harmony/scripts/build-local.sh` BUILD SUCCESSFUL（33 tasks） |
| 签名 HAP 产出 | ✅ `harmony/entry/build/default/outputs/default/entry-default-signed.hap`，2,780,181 B，`0.17.103-lan / 1000225` |
| 装机冒烟 | ✅ 手机（无线调试）与鸿蒙 PC 均安装启动、`已连接 · lan`、无 ArkTS 崩溃（见 `harmony/scripts/smoke.sh`） |
| SecureStore 失败场景 | ✅ 10/10（见 2.3） |
| 新增测试文件类型检查 | ✅ `tsc --noEmit` 通过 |

### 本机跑不了、必须在 CI 跑的

这台机器是 HarmonyOS，用户目录里**原生二进制不可执行**（`dlopen` 直接 Permission denied），
所以 `pnpm`（无 openharmony-arm64 原生包）、`rollup`/`vite`/`esbuild` 的原生模块都起不来，
`vitest` 本地无法执行 —— 这不是测试配置的问题，换台 Ubuntu 机器或 CI 即可。
`pnpm exec vitest run harmony/tests` 的实际执行结果以 CI 日志为准。

### 怎么复现

```bash
# 构建（本机签名材料不入库，用被忽略的 build-profile.local.json5）
harmony/scripts/build-local.sh

# 装机 + 拉起 + 等「已连接」+ 崩溃检查
harmony/scripts/smoke.sh 192.168.3.145:34521    # 手机
harmony/scripts/smoke.sh 127.0.0.1:40601        # 鸿蒙 PC

# 一致性测试（CI 同款命令）
pnpm exec vitest run harmony/tests
```

## 5. 演示材料

设备上没有 `screenrecord`，本机也没有可执行的 ffmpeg，所以演示用「关键界面截图 + 字幕」的方式提供，
文件在仓库外的本地目录（按仓库规矩，验收录屏不进仓库）：

- `~/WorkBuddy/artifacts/harmony-demo/demo.gif`（本地，不在仓库里）：连接/会话列表 → 历史图片显示 → 装机版本核对
- 想现场复现：把手机连上后跑 `harmony/scripts/smoke.sh`，然后进任一含图片的会话看历史回显即可

演示只放已实测过的画面；文件附件卡片（HEIC 这类主机不收的格式）目前只有代码与单测依据，等真机截图补上再放进来。

1. **历史图片**：从电脑端发进会话的图片，鸿蒙端会走 `session/attachment` 补齐渲染
   （0.2.2 起必须带完整 `ImageAttachmentRef`，见 0.17.101）；
2. **文件附件**：主机不收的格式（HEIC 等）会落成 `file` part，客户端显示成 `📎 名称 · 大小` 卡片，
   不再整条吞掉（见 0.17.102）。
