# 交接说明（新会话从这里开始）

> 触发词：用户说「**继续 dshre**」（或「继续 dsh-remote」）时，先读本文件，再按「待办」继续，不需要重新调研。

## 一句话状态

鸿蒙客户端 V0.03 已完成 PR #242 全部审核整改 + 功能对齐 14 项，装在手机上可用；UI 打磨前 3 项已改完并本地提交（`9a80f1d`，因手机掉线尚未装机目视确认），剩主题页/多语言与上游主机缺口。

## 仓库与构建

- 工程：`/storage/Users/currentUser/WorkBuddy/ds-harness-remote-Harmony-7.0/apps/harmony`
- 分支 `release/v0.03`，标签 `V0.03`，**尚未推送**（`git push origin release/v0.03 --tags`）
- 构建：`( umask 000; devecocli build --build-mode debug )`，产物 `entry/build/default/outputs/default/entry-default-signed.hap`
- 装机：`hdc -t 192.168.3.160:33571 install -r <hap>`（手机无线调试，端口每次重开都会变）
- 密码学回归：`node ~/.cache/crypto-check.mjs`（金标向量，6/6）
- 签名：`build-profile.json5` 已由 DevEco 写入本工程签名，**不要覆盖**；仓库 `signingConfigs` 会被 `git checkout` 弄丢时需重新在 DevEco 里点一次签名

## 已完成（不要再重做）

- PR #242 阻断项 5/5：Asset Store 加密落盘（含旧明文迁移）、日志脱敏、bundleName `cn.r2049.dshremote`、测试+CI+签名注入、文档与四语 README
- 建议项：忘记主机公钥（🔑）、断线指数退避重连、删模板 cpp、文件权限 644
- 功能对齐 14 项：插话/排队、中断、斜杠命令、会话改名/归档/搜索、上下文占用、模型选择、推理等级、权限预设、消息分叉、工作区选择、自动重连、忘记主机
- 工作区增删改 + 文件浏览（RPC/运行时/UI 全有）
- UI 精简：标题栏去掉权限胶囊（改长按模型胶囊）、删掉独立排队行（改长按发送键）、Markdown 轻量渲染、工具卡片长命令换行、主机卡整卡可点 + 在线/离线徽标
- 自审报告：`docs/harmony-audit-v0.03.md`（7 个 bug 已修）

## 待办（按顺序）

1. ~~**顶部操作栏合并**~~：已完成（`9a80f1d`）——刷新改圆形图标按钮、退出进溢出菜单，**待装机目视确认**
2. ~~**主机行摘要**~~：已完成（同上）——平台 + 主机版本 + 最近活动时间，**待装机目视确认**
3. ~~**工具调用折叠**~~：已完成（同上）——连续 ≥2 条收成「N 步 · 展开」，**待装机目视确认**
4. ~~**主题选择页**~~：已完成（`1142579`）——设置面板三选项，登录页也有入口，**主题切换已装机验证**
   **多语言**：~~聊天页 / 会话面板文案搬进 `I18n.ets`~~ 已完成（V0.04.7，`60c29e2` 之后一条）——
   新增 68 条英文（连接过程、会话面板、聊天页、审批/提问结果、日期格式按语言换序），
   登录页/设备页补漏若干；`Index.ets` 里只剩主题/语言选项的中文 key（渲染时过 `t()`）和
   `设备身份读取失败` 这个定点判断，都是有意保留的。
   **仍待验证**：英文下的聊天页/会话面板目视（要能连上主机才能看，当前被中继容量挡住）
5. 上游 Host 缺口（需改 `ds-harness-remote` 插件，不是客户端）：`session/updateQueue` 排队投影、附件上传通道、`pinSession`/`unarchiveSession` 透传、`job/list`、`goals/*`、轨迹、子代理

## 会话底栏（2026-11-04 改）

`Index.ets` 的 `ChatScreen()` 现在是 `Stack(alignContent: Bottom)`：消息列表照旧在流内，
输入区被抽成 `ComposerDock()` 浮在最上层，玻璃效果是

```ts
.backgroundEffect({ radius: 28, saturation: 1.35, brightness: 1.04|1.08, color: 半透明内衬 })
.borderRadius(26).border(1px 亮边).shadow(柔和投影)
```

配合顶边折光高光条和列表底部 148vp 留白。**只在平背景上目视过（登录页临时挂载），
真机聊天页（消息在玻璃后面滚过）还没验**——手机回来第一件事看这个。

## 语音输入（2026-11-04 加，`dd92d78`）

链路：麦克风 → `VoiceInput.ets`（AudioCapturer 16k/单声道/16bit，自己拼 44 字节 WAV 头）
→ base64 → 主机 `speech/transcribe` → 文本续写进输入框。

**客户端已整条验过**（QXS-W10 上临时挂到登录页）：权限弹窗文案正确、录音 12.4s / 399KB
PCM、停止后走转写、错误有中文提示（那台没连主机，所以停在「尚未连接主机」）。

**但主机侧还缺插件**：`speech/transcribe` 由 `@deepseek-ai/dsh-experimental-api-speech-to-text`
提供，识别器另有 `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice`（要下 SenseVoice ONNX 模型）。
当前 web profile 的 bundles 里两个都没有，所以即使插件放行了端点，主机也会回「不认识 method」。
要真正能用，得在 profile 里装上这两个包并重启 dsh。

## 验证手段（2026-11-04 补）

- 手机（PLU-AL10）掉线时，可用 `127.0.0.1:40601`（QXS-W10，HarmonyOS PC）装同一份 hap：
  它能到登录页，能验证主题/语言/设置面板，**但登不进去**（没有账号密码），设备页与聊天页验证不了
- `uitest uiInput click` 的坐标在窗口模式下**不可靠**（点 设置 会落到底下的登录按钮），
  先 `uitest dumpLayout -p /data/local/tmp/l.json` 取 bounds 再点，且一次只点一下，别连点

## 已知问题（2026-11-04 补）

- **客户端调了 3 个主机没有的 endpoint**，全部静默失败（hilog 里 `workspace/list unavailable` 就是它）：
  - `workspace/list` → 主机侧应改用 `workspace/follow`（baseline 帧带 items/sessionIds）
  - `host/listDirectory` → 主机侧等价物是 `directoryPicker/list`（参数是裸 `path`，不走 `request` 包装）
  - `session/selectPermission` → 本版 DSH 没有这个端点，权限预设只能在创建会话时给
- 已装插件是 npm `ds-harness-remote@0.6.0`，其 `HARNESS_REMOTE_ALLOWLIST` 只放行标准端点；
  仓库 `packages/plugin` 也没加这三个，所以工作区列表/目录浏览/权限切换目前的实际表现是「点了没反应」
- 装机手机（PLU-AL10）会掉线，无线调试端口每次重开都变（2026-11-05 09:2x 用的是
  `192.168.11.110:37695`，十分钟后就 Connect failed 了）；`hdc kill` 之后必须 `hdc start -r`
  才能再 `tconn`，否则所有连接都报 `[Fail]Connect failed`
- **更正（2026-11-05）**：`127.0.0.1:40601`（QXS-W10）**是已登录状态**，
  设备页能看到 `DESKTOP-R5BVQJJ`（win32 · 主机 0.2.1-rc.5）和 `localhost`（linux · 主机 0.2.0-rc.2）
  两台在线主机，所以设备页 / 连接页 / 阶段进度都能在这台机器上验。窗口 bounds 是 `[430,295][2520,1689]`；
  **别再按整屏坐标点**——桌面上还开着浏览器和「共享便签」，点歪就把别的窗口顶到前面
- **中继容量（2026-11-05 08:57 实测）**：连 `DESKTOP-R5BVQJJ` 全程失败，日志
  `relay data socket closed code=4008 reason=relay capacity reached` →
  随后重试打 `gz-turn` / `turn.r2049.cn` 全部 `4008 invalid relay ticket claims` →
  `connect failed`。**ticket 是绑节点的**，用 `connect.accepted` 里那份候选列表轮换节点必然被判
  invalid claims，等于白烧两次重试还给出误导性错误
- **已修（V0.04.8）**：`handleConnectAccepted` 只打服务端指定的那台中继，候选列表降级为排障日志。
  改后同样场景 8 秒内直接抛出「中继当前没有可用容量（4008 relay capacity reached）」，不再绕 gz-turn
- **容量问题是节点级的**：`DESKTOP-R5BVQJJ` 与 `localhost` 两台主机、连点两次全部同一个 4008，
  说明是 `turn-mj.r2049.cn` 这台中继满了，不是某台主机的问题。客户端无从绕开（票据由服务端签给该节点），
  要么等容量、要么让服务端给别的节点发票。**WebRTC 直连的信令也要先有 active connection，
  所以这个 4008 也挡着 WebRTC 任务 2/3 的联调**

## 关键文件

- `entry/src/main/ets/services/AppRuntime.ets`：状态机、会话、重连、模型/权限/工作区
- `entry/src/main/ets/net/HarnessClient.ets`：全部 RPC（31 个 endpoint 中已用约 20 个）
- `entry/src/main/ets/services/SecureStore.ets`：Asset Store + 明文迁移 + 身份保护
- `entry/src/main/ets/pages/Index.ets`：全部 UI（单文件，改前先 grep 定位）
- `docs/harmony-parity.md`：功能对齐矩阵与主机缺口
- `docs/harmony-client.md`：架构/构建/签名/发布/维护边界

## 坑

- ArkTS 严格：对象字面量必须有显式类型；`throw` 只能抛 Error 子类
- 构建目录若出现 0700 权限问题，用 `umask 000` 重新构建
- `devecocli run` 会因签名材料跨工程失配而失败，统一用 build + `hdc install`
- 手机 hilog：`hdc -t <phone> shell "hilog -T DSHREMOTE"`

## 2026-11-04 下午进度（WebRTC 直连起步，`docs/webrtc-arkweb-plan.md`）

- **已验证**：ArkWeb 7.0 / Chrome 144 支持完整 WebRTC，本机（MatePad Edge）自检
  `sdp exchanged → dc open → 收到回环数据` 全通过
- **已落地**：
  - `services/RtcBridge.ets`：隐藏 Web（1x1 透明）+ `javaScriptProxy`，暴露
    `startOffer/applyAnswer/addRemoteIce/send/closeAll`，钩子 `onLocalSdp/onIce/onDataOpen/onDataBinary`
  - `resources/rawfile/webrtc-bridge.html`：JS 侧 RTCPeerConnection + DataChannel(ordered) + 二进制收发
- **下一步（按顺序）**：
  1. ICE 配置：`GET /api/v1/turn/credentials`（要求 active connection，须在 connect.accepted 后请求）
  2. `signal.offer/answer/ice` 走 Control WS；DC open 先发 `transport.selected` 再跑 Noise（协议硬约束）
  3. `SecureTransport` 抽出 `sendFrame(bytes)`，relay/DC 两种实现
  4. 失败回退 relay（现有路径保留），并把「上次成功传输方式」记住
- **风险**：ArkWeb 的 NAT/局域网可达性未验证（自检是自环）；后台挂起会断 DC；DC 单帧建议 <256KB

## 2026-11-05 上午进度（V0.04.6，连接提速收尾）

- `ae3934a` 已把「进入主机连接」拆成阶段进度（读取主机信息 / 检查在线 / Noise 握手 / 读取能力 / 订阅事件）
- 本次继续补完同一件事：中继建连**预热**与 REST 查询并行，并把两处边角堵上
  - 预热中的 socket 若因「设备不在线」「用户取消」而放弃，交给 `teardownConnection()` 关掉
    （新增字段 `AppRuntime.pendingRelay`，交给 `SecureTransport` 后置空，避免漏 socket）
  - REST 期间凭证轮换过（`accessToken` 变了）就**重建**中继再握手，不再拿旧 token 的半开连接
- 构建：`devecocli` 现在在 `~/.deveco/bin/devecocli`（不在 PATH 里）；`deveco` 是另一个 AI CLI，别混
- 装机自检（`127.0.0.1:40601` QXS-W10）：0.04.6 安装、启动、WebRTC 自检三项全过
  （`sdp exchanged → dc open → hello-from-webrtc`）
- 产物：`incoming/dshremote-v0.04.6-1000024.hap`；**还没在手机 PLU-AL10 上验连接阶段文案**

## 2026-11-05 上午（续）：失败轮提示（V0.04.9）

用户报「上下文超限之后手机端没有提示」。根因（已核到源头）：客户端以前对
`turn/end` 只做 `settleTurn()`，把 `reason` 整个丢掉；DSH 的失败轮正是
`turn/end{reason:{kind:'error',error:{code,message}}}`，上下文超窗的 code 是
`CONTEXT_WINDOW_EXCEEDED`（见 `@deepseek-ai/dsh-llm` 的 `CONTEXT_WINDOW_EXCEEDED_CODE`）。
所以主机明明报了原因，手机上一条都不显示。

- 新增聊天里的 `notice` 行（`ChatItem.kind='notice'` + `noticeKind`/`actionCommand`）：
  - 上下文超窗 → 红框「上下文已超出模型窗口，这一轮没有执行」+ 提示 + 一个「压缩上下文」按钮（发 `/compact`）
  - 其它失败 → 红框「本轮失败」+ `code · message`
  - `max-tokens` → 黄框「本轮输出达到模型上限」
- `appendTurnFailure()` 同时认三种 reason 形态：`{kind:'error',error}`（DSH 原生）、
  `{kind:'error',failure}`（pi 后端，插件里就是这个名字）、裸字符串 `'error'`/`'failed'`
- `stream/closed{reason:'failed'}` 也不再静默：除传输层断开（TRANSPORT_CLOSED/CLIENT_CLOSED/
  CONNECTION_FAILED）外都补一条提示，再走原来的重连
- `friendlyCode` 补 `CONTEXT_WINDOW_EXCEEDED` → 「上下文已超出模型窗口，请先压缩上下文（/compact）再试」
- 顺手：设备卡名字改单行省略（手机上原本把 DESKTOP-R5BVQJJ 拆成 «DESKT / OP-…»，长按仍可看全名）
- 逻辑用 7 条决策表跑过（上下文超窗/pi 失败/裸字符串/正常结束/max-tokens/英文超窗文本/去重），全部符合预期
- **未验证**：真机上看到这条提示——需要一个「真实失败轮」，而当前连不上主机（见下面中继 4008）

## 2026-11-05 上午（再续）：4008 措辞分流（V0.05.0）

用户贴回一行 `relay data attach failed: 中继当前没有可用容量（4008 invalid relay ticket claims）`，
指出措辞不对：4008 是个大桶，`relay capacity reached`（节点满）和 `invalid relay ticket claims`
（票据与连接对不上）都报 4008，以前一律说「没有可用容量」，把排障方向带偏了。

- `describeAttachFailure()` 改成返回 `AttachVerdict{message, retryable}`：
  - reason 含 `capacity` → 「中继节点已满（4008 …），稍后重试；持续这样需要服务端给中继扩容」可重试
  - reason 含 `ticket`/`claim` → 「中继票据校验失败（4008 …）：票据和这条连接对不上，重连一次即可」**不重试**
  - 4001/4003 → 「中继票据已失效」，不重试
- `RelayAttachError{retryable}`：不可重试的失败不再烧掉那两次 fresh-ticket 重试，直接报给用户
- 装机实测（QXS-W10，09:39）：日志已变成「中继节点已满（4008 relay capacity reached），…」
- 手机 PLU-AL10（`192.168.11.110:37695`）已装 0.05.0，进程与 render 进程都在，启动不崩
  （注意：`aa start` 后手机停在多任务界面，截图可能拍到别的 App，不是崩溃）

## 版本历史

| versionName | versionCode | 内容 |
|---|---|---|
| 0.05.0 | 1000028 | 4008 措辞按 reason 分流（节点满 / 票据对不上），票据类不再重试 |
| 0.04.9 | 1000027 | 失败轮提示（上下文超窗/max-tokens/主机拒绝）+ 设备名单行 |
| 0.04.8 | 1000026 | 中继 attach 只打服务端指定节点（票据绑节点，候选轮换必被拒） |
| 0.04.7 | 1000025 | 聊天页/会话面板文案进 I18n，补 68 条英文；日期格式按语言换序 |
| 0.04.6 | 1000024 | 中继预热与 REST 并行；放弃/令牌轮换时正确重建或关闭通道 |
| 0.03.2 | 1000010 | 记住上次连通的中继节点 |
| 0.03.1 | 1000009 | 光感坞、语音、图片、折叠、双语、能力声明补全 |
