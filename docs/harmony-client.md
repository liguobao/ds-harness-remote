# HarmonyOS 客户端

源码位于 [`apps/harmony/`](../apps/harmony/)，面向 HarmonyOS 7.0（API 26）及以上设备，使用 ArkTS / ArkUI。WebRTC 数据通道由本地 ArkWeb 页面承载；身份、Noise 握手和 RPC 在 ArkTS 层处理。

## 功能与边界

客户端提供账号登录、Host 选择、多会话、历史与流式回复、模型和权限选择、图片与语音输入，以及 LAN/P2P/TURN/Relay 连接。具体可用功能取决于 Host 暴露的能力。

连接默认优先尝试 WebRTC（LAN/P2P/TURN），失败后回落中继并完成 Noise 认证；Host 通告 `remote.transport.upgrade.v1` 时，尚在中继上的客户端再经已认证 RPC 在带内升级到 TURN/P2P/LAN 直连（见 [协议 §带内传输升级](protocol.md)）。升级失败保持中继数据面，不阻断会话；切换不重建 Noise 密钥、不重置流订阅。初始目录/历史读取与升级协商有界并行：Wi-Fi/有线最多等待 450 ms、蜂窝最多 250 ms 后回落中继。

本客户端是独立实现，不代表与 Android、Codex 或 ACP 客户端完全等价。它不在手机上运行 Host，不改写 Host 的会话存储。协议以 [protocol.md](protocol.md)、共享包及 `fixtures/` 为准。

## 工程结构

```text
apps/harmony/
├── AppScope/                     # 应用身份与版本
├── entry/src/main/ets/
│   ├── crypto/                   # Noise IK、X25519、ChaCha20-Poly1305、SHA-256
│   ├── protocol/                 # 帧编解码、安全消息分片与升级序号帧/重排
│   ├── net/                      # Server API、中继/直连传输、RPC、传输升级与 Harness gateway
│   ├── services/                 # 凭据、运行时、网络与生命周期
│   └── pages/                    # ArkUI 界面
├── entry/src/main/resources/rawfile/webrtc-bridge.html
├── entry/src/ohosTest/            # 设备侧测试
├── tests/                        # Node 侧一致性、升级状态机与安全存储失败场景
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

普通 `v*` 标签触发 Release 工作流，创建 GitHub Release 后调用 `.github/workflows/harmony-hap.yml`，生成未签名 HAP 并附加到同一 Release，文件名为 `dsh-remote-harmony-<tag>-unsigned.hap`。未签名包不能直接安装到真机；自动发布暂不依赖签名 Secrets。

鸿蒙工作流也支持手动构建（默认未签名，可显式选择签名），需要安装 SDK、带 `self-hosted` / `harmonyos` 标签的 runner。它仅允许上游仓库运行，不自动执行 fork PR 的代码。手动构建目标分支前须审查代码；签名构建只针对可信代码。

runner 可通过 `~/.config/harmony-env.sh` 导出 `HARMONY_CLT`、`DEVECO_SDK_HOME`、`JAVA_HOME` 与工具 PATH；workflow 会加载该文件并为后续步骤保留 SDK、JDK 环境。该文件由构建机维护，不包含签名口令。

鸿蒙包名为 `dsh.r2049.huawei`，须与华为后台 APP ID、签名 Profile 一致。包名变更会被系统视为另一个应用，不会继承旧包名的本机数据。

签名任务支持以下仓库 Secrets；配置了其中任何一项时，必须完整配置全部六项，缺失时失败：

| Secret | 内容 |
| --- | --- |
| `HARMONY_SIGNING_STORE_B64` | base64 编码的 `.p12` |
| `HARMONY_SIGNING_STORE_PASSWORD` | 密钥库口令 |
| `HARMONY_SIGNING_KEY_ALIAS` | 密钥别名 |
| `HARMONY_SIGNING_KEY_PASSWORD` | 密钥口令 |
| `HARMONY_SIGNING_CERT_B64` | base64 编码的 `.cer` |
| `HARMONY_SIGNING_PROFILE_B64` | base64 编码的 `.p7b` |

当六项 Secrets 全部未配置时，workflow 从 runner 用户的 `~/.config/dsh-remote/harmony-signing/` 读取 `dsh-remote-release.p12`、`dsh-remote-release.cer`、`dsh-remote-release.p7b`、`store-password.txt`、`key-password.txt` 和 `key-alias.txt`。目录权限须为 `700`、文件权限为 `600`；缺少任何文件即失败。独立调用注入脚本时通过绝对路径 `HARMONY_SIGNING_SOURCE_DIR` 指定该目录。本机原始材料放在 checkout 目录外，不随任务清理或上传。

脚本以受限权限写入签名材料，并为 SDK 生成临时 AES-GCM 口令包装和配套 `material/`，不在构建配置中写入明文口令；workflow 在任务结束时还原配置并删除材料。工作流存在不等于已经配置 runner 或完成构建；合并验收应查看目标提交的实际构建结果。

## 安全与维护

- 设备私钥与账号 token 使用系统 Asset Store Kit，配置 `DEVICE_UNLOCKED` 与 `NEVER` 同步。写入失败时拒绝明文降级；旧明文私钥仅在安全写入并回读确认后移除。Host 公钥固定记录在 Asset Store 不可用时允许保存于应用沙箱 KV，其内容是公钥，不是凭据。
- Host 公钥按设备固定，发生变化即拒绝握手。只有用户确认后才可忘记该记录。
- 业务经 Noise IK 加密；安全消息使用 48 KiB 分片、4 MiB 上限。密码学为独立 ArkTS 实现，修改时必须同步运行共享向量、篡改与重放测试。
- 带内传输升级遵循 [protocol.md](protocol.md) 的同名章节：升级帧在 RTCH 分块前加 `DSHU` + 8 字节大端序号头，序号空间与 Noise 计数器一致；乱序帧进有界重排缓冲（256 帧 / 4 MiB / 5 s 空洞超时），旧腿按 Host 下发水位与 3 s 兜底 drain。传输级别只信 Host 自己验证的 ICE 候选对（`LAN > P2P > TURN > Relay`），客户端提示不能抬高级别；激活后 DataChannel 丢失即关闭隧道交由正常重连恢复。
- 自动日志不记录文件路径、命令、TURN 凭据或上游异常正文。保留连接阶段、耗时、数量等诊断元数据；传输升级只记录 outcome、耗时、字节计数与级别名称，不记录 SDP、候选地址或密文。
- 修改协议、信任边界、刷新或重连时同步共享契约及对应场景测试。UI 文案、排版等使用检查和真机烟测，不添加源码字符串匹配单测。
- 应用版本以 `AppScope/app.json5` 为准；使用 `scripts/bump-version.mjs` 同步设备注册版本回退值，不在文档维护当前构建号。鸿蒙发版独立于 npm / Expo 版本同步。
