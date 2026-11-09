# HarmonyOS 客户端更新记录

> 完整文件：本记录按版本倒序。历史版本（0.03 及更早）保留在文末，细节见 `docs/harmony-*.md`。

## 0.17.102 — 2026-11-09

对应 `AppScope/app.json5`：`versionName 0.17.102-lan` / `versionCode 1000224`。

- **文件附件不再整条吞掉**：主机只把 PNG/JPEG/WebP/GIF 当图片，HEIC 等格式会落成 `file` part；
  此前「只有文件、没有文字」的消息在鸿蒙端直接消失（气泡都没有）。现在渲染成 `📎 名称 · 大小` 卡片。
- 远端没有读文件字节的接口（只有 `session/attachment` 读图片、`workspaceFiles` 读工作区文件），
  所以文件卡片只展示、不预览；HEIC 想看到图，需要发送端先转成 JPEG。

## 0.17.101 — 2026-11-09

对应 `AppScope/app.json5`：`versionName 0.17.101-lan` / `versionCode 1000223`。

- **历史图片不再空白**：Harness 0.2.2 起 `session/attachment` 要求完整 `ImageAttachmentRef`
  （`mediaType`/`bytes`/`width`/`height` 逐项校验），客户端此前只发 `attachmentId`，被网关判参数
  不合法 → 从电脑网页发的图片在鸿蒙端气泡里是空的（本机刚发的直接显示，所以只坏「历史回显」）。
  现在把历史消息里原生的引用整条保留、读取时原样回传，老 Host 仍走只发 id 的兼容路径。
- 链路日志新增 `history image ok … ref=yes|no` / `failed (ref=…)`，一眼看出走的是哪条路。

## 0.17.87–0.17.96 — 2026-11-09

- **恢复链路**：`4009 server shutdown` 改为自动重连（此前被判「不重连」，要人切前台才恢复）；
  等主机重新上线期间不消耗重连次数（窗口 90 秒）、2 秒快重试；实测停 relay 12 秒后客户端自己回来
- **多语言**：313 个 UI 文案全部补齐英文（新增 `harmony/scripts/check-i18n.mjs` 做静态校验）
- **连接详情**：ArkWeb `getStats` 改为无参调用 + 候选对宽松匹配 + 「ICE 状态/候选数量」兜底
- **工具**：`harmony/scripts/smoke.sh` 一键冒烟（构建→装机→拉起→等连接→崩溃检查）

## 0.17.86 — 2026-11-09

对应 `AppScope/app.json5`：`versionName 0.17.86-lan` / `versionCode 1000208`。

- 版本号统一：`AppScope/app.json5` 与 `ServerApi.CLIENT_VERSION_FALLBACK` 一致（此前兜底值还是模板遗留的 `0.02`）
- 签名材料出库：`build-profile.json5` 的 `signingConfigs` 置空，本机签名放被忽略的 `build-profile.local.json5`，
  构建改用 `harmony/scripts/build-local.sh`（临时顶替 → 构建 → 无条件还原）
- 文档：四语 README 恢复/补齐「鸿蒙移植版」说明与脱敏界面截图；发行说明 `docs/release-0.17.86.md`

## 0.17.84–0.17.85 — 2026-11-08/09

- 对齐 dsh-Go A 组：连接详情（传输/握手分段/回落原因）+ 测延迟、精简历史开关（`remote.history.configure`）、
  敏感内容打码（`sk-*`/`ghp_*`/`Bearer`/长 hex，点气泡看原文）、轮次导航 + 每轮用量（`3/9 · 12 步 · 1m20s`）、
  主题色（深海/森林/暖沙/玫紫）、桌宠（干活/等确认/刚做完/待命）、分享卡（ShareKit，回退剪贴板）、横屏输入坞收敛
- 明确不做：对话回放链接（需服务端存储；改为共享卡 + 整段 Markdown 导出）

## 0.17.79 — 2026-11-08

- 会话列表落盘：启动/重连先用上次列表铺开侧栏（主机 `session/list` 实测 3~9 秒），拉到新列表静默覆盖
- 恢复场景改用缓存的主机信息建连：省掉一次设备查询；缓存公钥仍与本地 pin 比对，不一致自动回退
- 修复回归：恢复路径跳过设备查询时一并跳过了 accessToken 刷新（会报 `4002 invalid access token`），
  改为建连前先判断过期并刷新

## 0.17.69–0.17.78 — 2026-11-08（局域网直连与保活）

- **直连真正生效**：`startRtcAttempt()` 原被写在「服务器下发 relayEndpoint」分支里，而本机服务器从不下发该字段，
  导致直连代码一次都没执行；改为与中继端点无关后实测 `transport=lan`
- **长时任务保活**（`dataTransfer`）：熄屏/后台不再被冻结（实测熄屏 8 分钟零断线；此前有 35 分钟零收帧的记录）
- **静默探测**：空闲 ≥35 秒主动发便宜 RPC 探活，失败即判死重连；直连入站数据也计入「链路活着」
- **快速失败**：WebRTC 桥在 `failed/closed`/DC 关闭时立刻上报；DataChannel 超时 25s→12s；直连连续失败 2 次冷却 10 分钟
- `session/follow` 首帧偶发丢失 → 自动重开一次（600ms）；启动自动连上次主机；会话列表/链路日志诊断增强

## 0.17.63–0.17.68 — 2026-11-08（可观测与恢复链）

- 新增 `services/LinkLog.ets`：链路决策落盘到应用沙箱 `link.log`（256KB 轮转，同时镜像 hilog），
  诊断面板可看最近行、可一键复制
- 修复「断线事件从不上报」：`RelayTransport.onClosed` 此前无任何订阅者 → `SecureConnection` 转发后
  重连/退避/回原会话整条链才真正生效
- `retryNow` 放宽三处把恢复卡死的限制（会话页重连中也能立刻重连、退避耗尽允许再试、计数归零）；
  网络恢复/承载切换触发即时重试；回前台静默 ≥45 秒判死；连接 30 秒看门狗
- 诊断面板：打点（每步耗时）、最慢样本、抖动自愈计数、保活状态、稳定统计（连接/断线/在线时长/恢复耗时）

## 0.17.61–0.17.62 — 2026-11-07/08

- 「重新打开会话」点不动（`openSession` 同会话早退）→ 新增 `reopenCurrentSession()`；
  传输类失败走 `reconnectAndReopen()`，一次点击回到同一会话
- `relay connection has not been authorized` 抖动窗口内自动等 250ms 重发（最多 4 次，requestId 不变）
- 会话流打开预算 45s→20s；会话列表传输类失败先体检链路、3 秒后自动重拉；重连中发送键变灰

## 0.03 — 2026-11-04


对应 `AppScope/app.json5`：`versionName 0.03` / `versionCode 1000008`。

### 新增能力

- **插话与排队**：输入栏可切换「排队 · 本轮之后 / 插话 · 立刻打断」；生成中仍可输入，插话会立刻打断当前轮的下一步行动。
- **中断当前轮**：生成中显示停止键（`session/cancel`）。
- **斜杠命令**：输入 `/` 弹出候选条，选中填入；发送时优先走 `commands/execute`，主机不识别该命令时自动降级为普通消息。
- **会话重命名**：点击聊天页副标题进入编辑态。
- **会话归档**：会话列表行长按归档。
- **会话搜索**：会话面板顶部搜索框（`session/search`）。
- **上下文占用**：副标题右侧百分比胶囊，≥80% 转红（`session/projections`）。
- **断线自动重连**：指数退避 1/2/4/8/15/30 秒，最多 6 次，界面显示重连进度。
- **模型选择**：聊天顶栏模型胶囊 → 底部选择面板（`session/modelCatalog` + `session/selectModel`）。
- **权限预设**：顶栏权限胶囊 → 只读 / 可写 / 完全三种预设（`session/selectPermission`）。
- **从消息分叉**：长按任意聊天气泡 → 确认后从该条消息分叉出新会话（`session/fork`）。
- **忘记主机公钥**：设备卡片上的 🔑 入口，二次确认后清除固定记录，下次连接重新走 TOFU。

### 安全

- 设备 X25519 私钥、账号 `accessToken`/`refreshToken`、Host 公钥固定记录改用 **Asset Store Kit**（`Accessibility.DEVICE_UNLOCKED` + `SyncType.NEVER`），不再以明文写入 `preferences`；升级后首次启动自动迁移历史明文数据并删除明文条目。
- 控制帧日志只记录 `type` 与长度，不打印 payload；会话列表日志不再输出会话标题（`docs/protocol.md` §25 不变量 12）。

### 构建与工程

- `bundleName` 由 IDE 模板值改为 `cn.r2049.dshremote`，`vendor` 改为 `r2049`。
- 移除 DevEco 模板的 `entry/src/main/cpp` 原生模块与 `libentry.so` 依赖，构建不再引入 `libc++_shared.so`。
- 仓库内文件权限统一为 644。
- 新增密码学一致性测试：用仓库 `fixtures/crypto/v1/noise-ik.json` 校验 X25519 公钥推导、handshake msg1 逐字节、msg2 payload、双向 transport 帧与篡改拒绝。
- 设备端测试替换模板用例：`Crypto.test.ets`（X25519 对称性、AEAD 往返、篡改/换钥拒绝）、`SecureStore.test.ets`（Asset Store 可用性、token/身份往返、host pin 清除）。
- CI：`apps/harmony` 纳入变更检测，`quality` 任务新增一致性测试步骤。
- 新增 `.github/workflows/harmony-hap.yml`（自建 runner + Secrets 注入签名）与 `apps/harmony/scripts/inject-signing.mjs`。
- 文档：新增 `docs/harmony-client.md`、`docs/harmony-parity.md`、`apps/harmony/README.md`，并同步 `README.md` / `README.en.md` / `README.ja.md` / `README.zh.md` 的客户端表格。

### 已知限制

- 仅支持 HarmonyOS 7.0（API 26）及以上。
- Noise IK 尚未实现 Rekey（与共享 `packages/crypto` 同步待办）。
- 界面文案仍为中文硬编码，未接入多语言资源。
