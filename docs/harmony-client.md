# HarmonyOS 客户端

源码位于 [`apps/harmony/`](../apps/harmony/)，面向 HarmonyOS 7.0（API 26）及以上设备，使用 ArkTS / ArkUI。WebRTC 数据通道由本地 ArkWeb 页面承载；身份、Noise 握手和 RPC 在 ArkTS 层处理。

## 功能与边界

客户端提供账号登录、Host 选择、多会话、历史与流式回复、模型和权限选择、图片与语音输入，以及 LAN/P2P/TURN/Relay 连接。具体可用功能取决于 Host 暴露的能力。

本客户端是独立实现，不代表与 Android、Codex 或 ACP 客户端完全等价。它不在手机上运行 Host，不改写 Host 的会话存储。协议以 [protocol.md](protocol.md)、共享包及 `fixtures/` 为准。

## 工程结构

```text
apps/harmony/
├── AppScope/                     # 应用身份与版本
├── entry/src/main/ets/
│   ├── crypto/                   # Noise IK、X25519、ChaCha20-Poly1305、SHA-256
│   ├── protocol/                 # 帧编解码与安全消息分片
│   ├── net/                      # Server API、传输、RPC 与 Harness gateway
│   ├── services/                 # 凭据、运行时、网络与生命周期
│   └── pages/                    # ArkUI 界面
├── entry/src/main/resources/rawfile/webrtc-bridge.html
├── entry/src/ohosTest/            # 设备侧测试
├── tests/                        # Node 侧一致性与安全存储失败场景
└── scripts/                      # 签名注入、版本检查与真机烟测
```

## 构建与验证

安装包含 API 26 SDK 的 DevEco Studio，并配置其 `hvigorw`、`ohpm` 和 `hdc` 命令。可在 DevEco Studio 中直接打开 `apps/harmony`。命令行构建：

```sh
cd apps/harmony
ohpm install --all
# 未签名编译验证：清除产品的 signingConfig 引用，不需要签名凭据。
node scripts/inject-signing.mjs --unsigned
hvigorw --no-daemon assembleHap -p product=default -p buildMode=release
# 验证后还原签名配置文件。
git restore build-profile.json5
```

产物位于 `entry/build/default/outputs/default/`，未签名包不能安装到真机。`*.hap`、构建目录和本机配置均不入库。

在仓库根运行 Node 侧检查：

```sh
pnpm exec vitest run apps/harmony/tests
node apps/harmony/scripts/check-i18n.mjs
node apps/harmony/scripts/bump-version.mjs --check
```

Node 测试用 shim 替代鸿蒙 Kit，验证共享 Noise 金标向量及安全存储失败路径；它不验证 ArkTS 编译、系统 Kit、ArkWeb 或设备生命周期。原生构建和设备侧测试必须用 SDK 独立执行。

真机烟测要求已签名安装、已登录且曾连接目标 Host：

```sh
apps/harmony/scripts/smoke.sh <hdc-device-id>
```

烟测会构建、覆盖安装当前应用并重新启动，检查本次启动的连接日志及崩溃记录。现场日志、设备地址和验收结果放 PR 附件或本地忽略目录。

## 签名与 CI

签名材料不得提交。复制 `build-profile.json5` 为被忽略的 `build-profile.local.json5`，通过 DevEco Studio 配置本机签名。`scripts/build-local.sh` 会临时使用该文件，结束时还原原配置；设置 `HVIGORW` 可指定构建命令路径。

`.github/workflows/harmony-hap.yml` 提供手动构建（默认未签名）和 `harmony-v*` 标签签名构建，需要安装 SDK、带 `self-hosted` / `harmonyos` 标签的 runner。它不自动执行 fork PR 的代码。手动构建目标分支前须审查代码；签名构建只针对可信代码。

签名任务由以下仓库 Secrets 注入，缺失或不完整时必须失败：

| Secret | 内容 |
| --- | --- |
| `HARMONY_SIGNING_STORE_B64` | base64 编码的 `.p12` |
| `HARMONY_SIGNING_STORE_PASSWORD` | 密钥库口令 |
| `HARMONY_SIGNING_KEY_ALIAS` | 密钥别名 |
| `HARMONY_SIGNING_KEY_PASSWORD` | 密钥口令 |
| `HARMONY_SIGNING_CERT_B64` | base64 编码的 `.cer` |
| `HARMONY_SIGNING_PROFILE_B64` | base64 编码的 `.p7b` |

脚本以受限权限写入签名材料；workflow 在任务结束时还原配置并删除材料。工作流存在不等于已经配置 runner 或完成构建；合并验收应查看目标提交的实际构建结果。

## 安全与维护

- 设备私钥与账号 token 使用系统 Asset Store Kit，配置 `DEVICE_UNLOCKED` 与 `NEVER` 同步。写入失败时拒绝明文降级；旧明文私钥仅在安全写入并回读确认后移除。Host 公钥固定记录在 Asset Store 不可用时允许保存于应用沙箱 KV，其内容是公钥，不是凭据。
- Host 公钥按设备固定，发生变化即拒绝握手。只有用户确认后才可忘记该记录。
- 业务经 Noise IK 加密；安全消息使用 48 KiB 分片、4 MiB 上限。密码学为独立 ArkTS 实现，修改时必须同步运行共享向量、篡改与重放测试。
- 自动日志不记录文件路径、命令、TURN 凭据或上游异常正文。保留连接阶段、耗时、数量等诊断元数据。
- 修改协议、信任边界、刷新或重连时同步共享契约及对应场景测试。UI 文案、排版等使用检查和真机烟测，不添加源码字符串匹配单测。
- 应用版本以 `AppScope/app.json5` 为准；使用 `scripts/bump-version.mjs` 同步设备注册版本回退值，不在文档维护当前构建号。鸿蒙发版独立于 npm / Expo 版本同步。
