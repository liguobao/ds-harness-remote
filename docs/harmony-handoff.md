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

## 2026-11-05 上午（再再续）：设备卡版本号可见（V0.05.1）

用户报「选择远程主机界面的版本号看不见了」。原因不是数据丢了，是那一行被挤没了：
`hostSubtitle()` 拼的是 `平台 · 主机 版本`，但手机上一个卡片被右侧 改名/🔑/连接 三个按钮压得很窄，
`maxLines(1)` + 省略号把版本整段吃掉（只留 `win32 · …`）。

- 副标题改成 `maxLines(2)`，版本折到第二行；三个按钮 padding 收窄（改名 10→8、🔑 8→6、连接 20→14）
- 装机实测（PLU-AL10）：卡片显示 `linux · 主机` + `0.2.0-rc.2` 两行，版本回来了
- 代价：主机名本身还是单行省略（`Matepa…`），长按可弹全名；要彻底好看得把按钮挪到第二排，
  但 Index.ets 现在没有宽度断点状态，属于下一轮的事

WebRTC 可行性/收益评估另见 `docs/harmony-webrtc-assessment.md`。

## 2026-11-05 上午（LAN-only 直连落地，V0.06.1）

用户要求先做 LAN-only，已经把「鸿蒙客户端 initiator」这一侧接通，**真机/真主机跑通**：

```
webrtc: 开始 LAN 直连协商 conn=01a1a987…
[webrtc] local candidate host … 192.168.11.123 46924 typ host
webrtc: signal.offer sent len=458
ctl frame type=signal.ice ×7 / type=signal.answer   ← Host 回答案
[webrtc] answer applied → ice state=connected（80ms）→ connection state=connected
[webrtc] dc open label=dsh → transport.selected sent transport=lan
noise: handshake complete → host features → connected to host
```

Host 侧日志同一连接：`webrtc data channel ready {"transport":"LAN"}`、
`rtcSelectedPath.transport=lan, localCandidateType=host, remoteCandidateType=host,
currentRoundTripTimeMs=4`、`authenticated peer channel ready {"transport":"LAN"}`。
连接后聊天页正常实时收流（截图见 `incoming/shots`），说明数据面真的走 DC。

实现要点（改动文件）：

- `resources/rawfile/webrtc-bridge.html`：真信令（offer/answer/ice）+ **RTCH 分块**（magic `RTCH`、
  8 KiB 负载、4 MiB 上限，与 `packages/webrtc/src/rtc-chunking.ts` 一致）+ base64url 跨端编码
- `services/RtcBridge.ets`：`markReady()`/`beginOffer()`（桥没就绪就直接走中继，别白等超时）、
  `onDataClosed`/`onError` 回调
- `net/RelayTransport.ets`：`connect.accepted` 后先试 RTC；`signal.answer`/`signal.ice` 只在
  **Control WS**（协议 §14，别放到数据面 socket 上，我第一次就放错了，白排查一轮）；
  `transport.selected` 先发再进 Noise；两段超时（等 answer 12s / 等 DC 25s）；
  `send()` 在 `dataMode==='lan'` 时走 DC；失败 → `fallBackToRelay()` 重新要票走中继
- `services/AppRuntime.ets` + `pages/Index.ets`：页面 `onPageEnd` 把桥交给运行时（`attachRtcBridge`）

坑与注意：

- 信号帧只在 Control WS 上；数据面 socket 永远收不到 `signal.*`
- 同一个 `transport.selected` 只发一次（`rtcOpened` 与 `finishConnect` 都发过一次，已合并）
- Host 的 `webrtcFallbackTimeoutMs` 是 12s，我们的等 answer 预算要 ≤ 它，否则 Host 先放弃了
- Noise 握手仍走 `secure.handshake` 控制帧，只有密文改走 DC——这一点没动，也不需要动

还没做（下一轮）：TURN 候选（当前只吃 host candidate，跨网段仍会回落 relay）、
传输方式徽标（`transportLabel` 字段已备好但未显示）、后台挂起后 DC 重建、背压/分块实测。

## 2026-11-05 中午（TURN + 传输徽标 + 图片插入，V0.07.0）

一次做完三件事，都是真机/真主机验过的（QXS-W10 ↔ 本机主机，LAN）：

**TURN 候选**：`connect.accepted` 之后先按 `connectionId` 取
`GET /api/v1/turn/credentials`（2.5s 上限，取不到就 LAN-only），把 `{iceServers:[...]}`
塞给 ArkWeb 的 `RTCPeerConnection`。实测拿到了 STUN+TURN，本地也真的产出了
`typ relay 114.132.152.243:52094` 候选。跨网段时这才有戏（之前只有 host candidate）。

**传输方式徽标**：DC 打开后用 `getStats()` 找 nominated candidate-pair，按协议 §14 的口径
判定 `lan`/`p2p`/`turn`（relay → turn；任一端私网/链路本地 → lan；其余 p2p），
`transport.selected` 按真实路径发，顶栏在会话标题右边显示一个小徽标。实测显示 `LAN`。

**图片插入**：新 `services/ImagePicker.ets`（系统相册 picker → 长边缩到 1600 → JPEG q80 →
标准 base64），输入坞左侧新增图片按钮，选完在输入框上方出缩略图条（可 ✕ 移除），
发送时作为 `{type:'image', mediaType, data, name}` 拼进 `session/prompt.request.content`
（协议 `PromptContentPart` 原生支持；`HarnessClient.sessionPrompt` 增加 images 参数）。
实测：3072×4096 拍成 `1200×1600 / 196 KB`，主机 `session/prompt ok`，Agent 直接在主机上
`read_image` 读图分析，本地气泡也回显了缩略图。

**历史图片回显（V0.07.2 补上）**：`user/message` 的 image block 只带
`attachment.attachmentId`，客户端解析出 id 后调 `session/attachment` 拉 base64
（`HarnessClient.sessionAttachment`），结果缓存到 `attachmentCache`，失败也记一笔免得反复问主机。
踩的坑：历史是 `foldHistory()` 折出来的，不会触发 `session/event` 那条路，
所以补水排程必须放在 `openSessionInternal` 折完历史之后；只挂在 `openSession` 上会漏掉
「连上后自动打开的会话」。实测 `history image ok … base64=303520`（227 KB 原图）。

## 2026-11-05 中午后（齿轮面板 + 修模型切换，V0.08.0）

**模型切换修好了**：根因是 `session/modelCatalog` 在主机侧是**无参数**方法
（descriptor `parameters: []`），客户端却包了 `{request:{}}`，被 typert gateway 判
`unexpected "request"`，目录永远拉不到 → 面板里永远是「未选择」。改成裸 `{}` 参数后
目录正常（7 个模型），`session/selectModel` 也通：
`session/selectModel ok -> deepseek-official/deepseek-v4-pro` + `model selected ... @high`。

**顶栏 ⋯ → 齿轮**：新增 `ic_settings.svg`，点开 `SessionPanelOverlay()`（自定义底部面板）
替代原来的 ActionSheet，把模型/推理等级/权限/上下文/连接收在一处，每行带当前值：

- 模型行：`provider/model @effort` + 「更换」→ 原 ModelPickerOverlay
- 推理等级行：只在该模型有 efforts 时显示，当前档高亮，点了直接 `selectModel`
- 权限：三个 chip，当前档高亮（绿），点一下切
- 上下文：百分比（≥80 红）+「压缩上下文」（发 `/compact`）
- 连接：`主机 · LAN/TURN/中继` + 「断开连接」

`AppRuntime` 现在记录完整选择（`currentModelProvider/currentModelEffort`），面板和徽标共用。

**注意（重要）**：切换模型作用于「当前打开的会话」。刚才在 QXS-W10 上验机时，App 的当前会话
正好是「继续 dsnre 会话」（也就是本会话），所以把这个会话的模型切成了 `deepseek-v4-pro`——
它不支持图片输入。要切回 `deepseek-flash`：齿轮 → 更换 → 选 DeepSeek-V41-Flash。

## 2026-11-05 13:00（修 WebRTC 与中继的抢跑，V0.08.1）

现象：App 重连后顶栏徽标显示「中继」而不是 LAN。日志抓到的竞态：

```
12:46:32.447 webrtc: 回落中继（没等到 signal.answer（12000ms））
12:46:32.813 ctl frame type=signal.answer      ← 晚 0.4s 才到
12:46:32.820 [webrtc] error: applyAnswer before startOffer
```

我们 12s 一到就关 peer 去要中继票，主机的 answer 后脚就到，白丢一次直连。

- `webrtcSignalTimeoutMs` 12s → **16s**：主机的协商超时也是 12s，客户端要略长，
  让主机先给结论，别和它抢
- 一旦 `dataMode === 'relay'`，迟到的 `signal.answer` / `signal.ice` 直接丢弃并记一行日志，
  不再打到已关闭的 peer
- 修完实测：`数据面路径=lan`、`transport.selected sent transport=lan`、
  `connected to host … transport=lan`

## 2026-11-05 13:05（修斜杠命令与权限切换，V0.08.4）

查权限 chip 不生效时，挖出两个更底层的问题：

**1. 斜杠命令一直是坏的。** `commands/execute` 的参数形状写错了：
- 错：`{request: {sessionId, line}}`
- 对：`{agentId: sessionId, line, submittedAttachments: []}`（DSH descriptor 里 `agentId` 是 lookup 传参，
  `submittedAttachments` 必填）

所以 `/compact`、`/permission` 这些以前全部报 `RPC parameters are invalid`，
被 `trySlashCommand` 的兜底当普通消息发出去——等于命令从没生效过。

**2. 回执文案在里层。** `commands/execute` 返回 `{commandId, result:{kind:'success'|'error', text?}}`，
以前直接读顶层 `text`，永远拿到空串。现在统一走 `commandReplyText()`。

**3. 运行期切权限根本没有 RPC。** session API 没有 `selectPermission`（只有 `session/create` 时能指定），
DSH 运行期切换用的是内置命令 `/permission <preset>`（`@deepseek-ai/dsh-permission-presets` 注册）。
客户端改成走命令通道，并从回执里学可选项：

```
permission state: current preset danger-full-access (available: read-only, workspace-write, danger-full-access)
permission switch -> read-only : preset read-only
permission switch -> danger-full-access : preset danger-full-access
```

面板现在：打开齿轮时 `refreshPermissionState()` 读一次当前值+可选项，chip 按主机真实清单渲染并高亮当前档；
`permission/preset` 事件也会同步权威值。

## 2026-11-05 13:10（修工作区/目录浏览端点，V0.08.6）

对照插件 `HARNESS_REMOTE_ALLOWLIST`（`ds-harness-remote/dist/index.js` 里那份）逐个核了一遍，
发现客户端有三个端点压根不在白名单里，所以「工作区列表」「目录浏览」「斜杠命令清单」一直点了没反应：

| 客户端原来调 | 白名单里实际有的 | 参数形状 |
|---|---|---|
| `workspace/list` | **`workspace/follow`**（首帧 `{type:'baseline', value:{items:[…]}}`） | 取到 baseline 立刻关流 |
| `host/listDirectory` | **`directoryPicker/list`** | 裸 `{path}`，不是 `{request:{path}}` |
| `commands/list` 带 `{request:{sessionId}}` | `commands/list` | 裸 `{agentId: sessionId}`，返回**数组**本身 |

顺带把 `commands/execute`（上一轮）和 `commands/list` 统一成 DSH descriptor 的传参方式：
`agentId` + 裸字段，不再包 `request` 外壳。

**未完成验证**：改完之后用户在 App 里正在跑会话（`测试内容询问` 13:07 起），我没敢再点 UI；
hilog 缓冲区也已被冲掉（只剩 5 行），所以这三处需要下次安静的时候再实测一轮：
连上主机后看 `workspace/follow baseline -> N item(s)`、打开文件浏览看目录是否出来、
输入 `/` 看候选是否来自主机而不是内置兜底。

## 2026-11-05 13:20（工作区链路打通 + 齿轮放大，V0.08.8）

**workspace/follow 的 payload 要 Typert 信封**：直接发 `{}` 主机回
`The Host could not complete the request.`；改成 `{args:{}}` 立刻正常：

```
workspace/follow baseline -> 3 item(s)
workspace/list -> 3 item(s)
```

（和 session/follow 的 `{args:{request}}` 同一套规矩：流的 payload 必须包 `args`。）

用户反馈「齿轮太小」：图标本体 20 → 24，外面套 40×40 点击区（原来是 38 的框里画 20）。

**待验证**（用户当时在浏览器里用 App/网页，窗口层级一直把 App 顶下去，没敢继续点）：
目录浏览（`directoryPicker/list` 是否返回内容）、斜杠命令候选是否来自主机。

## 版本历史

| versionName | versionCode | 内容 |
|---|---|---|
| 0.08.8 | 1000045 | 齿轮图标放大到 24（点击区 40） |
| 0.08.6 | 1000043 | 工作区/目录/命令清单改用白名单端点（follow、directoryPicker、agentId） |
| 0.08.4 | 1000041 | 修 commands/execute 参数与回执解析；权限切换改走 /permission |
| 0.08.1 | 1000038 | 等 answer 预算 12s→16s；回落中继后忽略迟到信令 |
| 0.08.0 | 1000037 | 齿轮面板 + 修模型切换（modelCatalog 无参） |
| 0.07.2 | 1000035 | 历史图片回显：session/attachment 拉字节并缓存 |
| 0.07.0 | 1000033 | TURN 候选 + LAN/P2P/TURN 徽标 + 图片插入 |
| 0.06.1 | 1000031 | LAN-only WebRTC 直连跑通（offer/answer/ice + RTCH 分块 + 回落中继） |
| 0.05.1 | 1000029 | 设备卡副标题折行，版本号不再被省略号吃掉 |
| 0.05.0 | 1000028 | 4008 措辞按 reason 分流（节点满 / 票据对不上），票据类不再重试 |
| 0.04.9 | 1000027 | 失败轮提示（上下文超窗/max-tokens/主机拒绝）+ 设备名单行 |
| 0.04.8 | 1000026 | 中继 attach 只打服务端指定节点（票据绑节点，候选轮换必被拒） |
| 0.04.7 | 1000025 | 聊天页/会话面板文案进 I18n，补 68 条英文；日期格式按语言换序 |
| 0.04.6 | 1000024 | 中继预热与 REST 并行；放弃/令牌轮换时正确重建或关闭通道 |
| 0.03.2 | 1000010 | 记住上次连通的中继节点 |
| 0.03.1 | 1000009 | 光感坞、语音、图片、折叠、双语、能力声明补全 |

## 附：TURN 与「减少思考 / bash 文本推送」的关系（回答用户提问）

用户问：能不能用「TURN 模式」减少思考和 bash 文本的推送，少占通道？

- **客户端无法按事件类型少收**：业务事件走的是端到端加密的 Noise 流（帧是密文），
  `session/event` 里思考块、工具调用、工具输出都是主机产生后按序推来的，协议没有
  「只订阅某几类事件」的开关。想少收只能在**主机侧**少产生。
- **真正能减的开关在请求侧**：`reasoningEffort`（顶栏模型胶囊里的推理等级）调低到
  Low/关，思考块自然不生成；bash 输出要让命令自己收敛（`| tail -50`、`> /tmp/x.log`），
  客户端只是把它折叠显示，网络上一个字节都没少。
- **TURN 不是「模式」，是候选路径**：TURN 只在对等直连（host/srflx 候选）都不通时才用上，
  走的是中继服务器，成本更高而不是更低。同网段时走 host candidate，**根本不占 TURN**。
  这次实测同网段：`transport=lan`、Host 侧 `RTT 4ms`。
- **真正占流量的是大对象**：图片/文件，而不是文字。图片已经在客户端压到长边 1600 / JPEG q80
  （实测 3072×4096 的照片压成 196 KB、base64 约 300 KB）；文件走 `workspace.upload.v1` 分块，
  不经过消息流。
