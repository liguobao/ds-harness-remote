# 客户端网络诊断与连接提示语建议

> 对象：`dshremote` 鸿蒙客户端（`harmony/`）↔ Remote Server 的 Control/Data 平面。
> 依据：本文所有"现状"结论都取自当前仓库代码，行号为 `harmony/entry/src/main/ets/` 下实际位置；
> 协议侧以 [protocol.md §22 Ping/Pong](protocol.md) 与 [network.md](network.md) 为准。
> 若"PP"指的不是这个客户端，请忽略本文并按目标重新出方案。

## 1. 结论

提示语这一块**已经比多数 App 做得好**：有阶段化文案、有带倒计时的退避提示、有网络错误码本地化、有中继关闭码翻译。
真正的问题不在"说什么"，而在**"什么时候发现要说话"**——客户端自己不做心跳，连接死掉了它不知道：

1. **客户端只被动回 pong，从不主动发 ping**（`RelayTransport.ets:422`、`:844`）。
   RTT 测不了，半开连接也测不出来。唯一的发现路径是：用户发消息 → RPC 等满 **45 秒**（`AppRuntime.ets:561`）→ 报错。
   隧道掉线、飞行模式、锁屏 30 分钟醒来，都落在这个最坏路径上。
2. **Control 通道的 close code 被丢掉了**。`ws.on('close', ...)` 收到 `CloseResult` 但没有往下传（`RelayTransport.ets:226`），
   `handleControlClose()`（`:864`）只记一句 warn 就 `notifyClosed()`。
   结果是协议要求的区分全部失效：`4001`（授权失败 **或** 心跳超时）、`4003`（连接被替换，**必须停止自动重连**）与普通断线
   走同一条恢复路径。protocol.md §22 明确要求 `4001`+`CONNECTION_FAILED` 可重试、未知 reason 与 `4003` 停止自动恢复。
3. **完全没有网络状态监听**。`module.json5` 只申请了 `INTERNET`，全工程没有引用 `@kit.NetworkKit` / `net.connection`。
   所以：切网、断网、恢复网络都没有提示，也不会在"网络刚回来"那一刻立刻重连，只能等退避计时器（1/2/4/8/15/30 秒）。
4. **回前台不做健康检查**。`appBackground`（`AppRuntime.ets:233`）目前只用于发完成通知（`:750`），
   回前台不 ping、不探活，UI 上的绿点（`Index.ets:1302` `connectionDotColor()`）会一直绿着骗人。

一句话：**把"绿点"从"曾经连上过"改成"刚刚证明还活着"。**

> 进度（2026-11-07）：v0.17.37 修了第 1、2 条（关闭码判词 + 静默看门狗）；
> v0.17.38 修了第 3、4 条（网络事件监听 + 回前台探活），并让重连提示真正显示出来；
> v0.17.41 做完 §6 剩下三项（提示语重写、诊断面板、短抖动留在会话页）。
> 另外修掉 `finishConnect()` 只发 `transport.selected` 不赋 `dataMode` 的 bug（v0.17.42）：
> 走直接中继时 `dataMode` 一直是空串，传输徽标/诊断显示空，且迟到的 `signal.answer`
> 不会被「已回落中继」拦下。

## 2. 现状盘点

| 能力 | 位置 | 现状 |
| --- | --- | --- |
| 分阶段连接提示 | `AppRuntime.ets:529/566/573/586`（`setConnectStage`） | ✅ 读取主机信息 → Noise IK → 读能力 → 订阅事件 |
| 断线退避重连 | `AppRuntime.ets:129-130`（1/2/4/8/15/30s ×6）+ `:2755` `handleDisconnect` | ✅ 文案带"第 n/6 次"与秒数 |
| 退避耗尽文案 | `AppRuntime.ets:2776` | ⚠️ "多次重连未成功，请检查网络或稍后手动连接"——信息量太低 |
| HTTP 错误码翻译 | `ServerApi.ets:170` `netErrorCodeHint` | ✅ DNS/不可达/超时/TLS 四类 |
| 中继关闭码翻译 | `RelayTransport.ets:128` `describeAttachFailure` | ✅ 4008 还分了 capacity / ticket 两种 |
| Control 关闭码 | `RelayTransport.ets` `describeControlClose` | ✅ v0.17.37 起按码分流（4001/4003/1001/1006） |
| 心跳 | `RelayTransport.ets` 静默看门狗 | ✅ v0.17.37 只被动检测（收到帧即活着），主动 ping 见 §6 P3 |
| RTT / 丢包 | — | ❌ 仍需客户端 ping，协议未定义 |
| 网络类型与网络事件 | `NetworkMonitor.ets` | ✅ v0.17.38（Wi-Fi / 移动数据 / 断网 / 恢复即重连） |
| 前后台健康检查 | `AppRuntime.onAppForeground` | ✅ v0.17.38 回前台立刻体检 |
| 传输路径展示 | `AppRuntime.ets:595` `transportLabel`（lan/p2p/turn/relay） | ✅ 已连上后可见 |
| 断线时是否留在会话页 | `AppRuntime.ets:2765` 强制 `phase = PHASE_DEVICES` | ⚠️ 一断就被踢回设备列表，重连成功也要重进会话 |

最后一条值得单说：网络抖一下就把用户踢出当前会话，虽然重连会成功，但上下文没了。
建议短抖动（< 10 秒内恢复）留在会话页，只换一条顶部横幅；超过阈值再退回设备列表。

## 3. 网络场景测试矩阵

按层测，而不是"关一下 Wi-Fi 看看"。每条都写清**注入手段**和**该看到什么**。
日志抓取统一用 `hdc shell hilog -T DSHREMOTE`（TAG 见 `util/Log.ets`）。

### 3.1 物理/链路层

| # | 场景 | 注入 | 期望行为 |
| --- | --- | --- | --- |
| L1 | 飞行模式 10 秒后关掉 | 手机快捷开关 | ≤75 秒内发现断连；网络回来立刻重连，不等退避 |
| L2 | Wi-Fi 断，切 4G（换 IP） | 关 Wi-Fi | 提示"网络已切换到移动数据"，重连而不是静默失败 |
| L3 | 路由器拔 WAN 线（局域网还在，出口没了） | 拔线 | 典型半开：**只有客户端主动 ping 才能发现**，否则 PPT 似的"看着在线" |
| L4 | 弱网：300ms RTT + 5% 丢包 | Host 侧 `tc qdisc add dev eth0 root netem delay 300ms loss 5%` | 阶段提示不卡死；RTT 指标能涨上去；不误判断线 |
| L5 | 带宽压到 50kbps | `tc ... rate 50kbit` | 握手超时要有明确文案，而不是无限转圈 |
| L6 | 网络抖动 1 秒闪断 ×5 | `netem loss 100%` 间歇 | 不应触发 6 次退避耗尽，不应把用户踢回设备列表 |

### 3.2 名称解析与证书

| # | 场景 | 注入 | 期望 |
| --- | --- | --- | --- |
| D1 | DNS 不可用 | Wi-Fi 静态 DNS 改成 `10.255.255.1` | "域名解析失败（DNS）…"（已有） |
| D2 | DNS 被劫持到门户页 | 公共 Wi-Fi 认证页 | `/health` 内容校验生效（`ServerApi.ets:235` 已有中文提示） |
| D3 | 系统时间跳错 1 天 | 手动改时间 | TLS 校验失败提示 + 指引校准时间（已有文案，需实测） |
| D4 | 服务器证书过期 | 服务端换过期证书 | 同上，且**不能**自动重试刷屏 |

### 3.3 Control 通道

| # | 场景 | 注入 | 期望 |
| --- | --- | --- | --- |
| C1 | 服务端进程重启 | `systemctl restart` Remote Server | 收到 close（1006/1001），退避重连；文案是"服务器连接重置"而非"与主机的连接已断开" |
| C2 | 心跳超时被踢 | 服务端侧断开/黑洞 75 秒 | close `4001` + `CONNECTION_FAILED` → **可重试**，重新握手 |
| C3 | 授权失败 | 服务端吊销 token/设备 | close `4001` 但 reason 非 `CONNECTION_FAILED` → 掉回登录页，**不**重试 |
| C4 | 同账号另一台设备抢占 | 另一端登录 | close `4003`（连接被替换）→ **停止自动重连**，提示"已在其他设备登录" |
| C5 | access token 过期 | 等 token TTL 到期 | 静默刷新，用户无感；刷新失败才提示重新登录 |

C2/C3/C4 现在**都归到同一句"与主机的连接已断开，n 秒后自动重连"**，这是最该先修的一条。

### 3.4 数据通道（Relay / WebRTC）

| # | 场景 | 注入 | 期望 |
| --- | --- | --- | --- |
| T1 | 中继节点打满 | 压测 relay | 4008 `capacity` 文案（已有）+ 自动换备选节点 |
| T2 | 票据不匹配 | 改系统时间让 ticket 过期 | 4008 `ticket` → 不重试（已有 `retryable=false`） |
| T3 | WebRTC 打通失败落 Relay | 屏蔽 UDP | 回落要有一句过渡提示，不能静默跳变 |
| T4 | 中继 data socket 半开 | 断 TCP 但不发 FIN | 心跳缺失 → 主动 detach + 重连 |
| T5 | 大帧（1MB 附近） | 传大文件 | `FRAME_TOO_LARGE` 文案明确，不误导成网络问题 |

### 3.5 主机侧与应用生命周期

| # | 场景 | 注入 | 期望 |
| --- | --- | --- | --- |
| H1 | 主机休眠/断网 | 关 Host 机器网卡 | `HOST_OFFLINE` 文案，且不消耗 6 次退避 |
| H2 | 主机在线但 Harness 未起 | 停插件 | 阶段提示停在"读取主机能力…"要有超时上限 |
| H3 | 锁屏 30 分钟后回前台 | 锁屏等待 | 回前台立刻 ping 探活；已死则**立即**重连并提示，而不是等用户发消息 |
| H4 | 后台被系统冻结 10 分钟 | 切后台 | 同上 |
| H5 | 会话中途切换主设备 | 设备列表进入另一台 | 文案要区分"断开重连"与"主动切换" |

## 4. 提示语清单（建议直接采用）

原则：**一句话说清"发生了什么 + 为什么会这样 + 你要做什么"**，能自动恢复的不要用红色，不要出现裸错误码（错误码放括号里给排查用）。

### 4.1 连接过程（已有，微调）

| 时机 | 文案 |
| --- | --- |
| 选中主机 | 正在连接「{host}」… |
| 授权 | 正在验证设备授权… |
| 通道 | 建立加密通道（Noise IK 握手）… ✅ |
| 能力 | 读取主机能力… ✅ |
| 订阅 | 订阅会话事件… ✅ |
| 慢链路兜底（>8s） | 网络较慢，握手仍在继续（已用 {n}s）——避免被当成卡死 |

### 4.2 瞬时降级（黄色横幅，可自动恢复，不踢出会话）

| 触发 | 文案 |
| --- | --- |
| 主动 ping 连续 2 次未回 | 网络响应变慢，正在确认连接… |
| 网络类型变化 | 网络已切换到移动数据，正在恢复连接… |
| 短暂断开后重连中 | 连接中断，正在重连（第 {n}/6 次，{s} 秒后） ✅ |
| 重连中但收到新心跳 | 连接已恢复 |
| 中继回落 | 直连不可用，已切换到中继（{turn/relay}） |

### 4.3 需要用户动作（橙色，说清动作）

| 触发 | 文案 |
| --- | --- |
| 退避耗尽 | 已连续 6 次无法连接「{host}」。请确认手机能上网、主机在线，然后点「重新连接」 ← 替换 `AppRuntime.ets:2776` |
| `HOST_OFFLINE` | 主机「{host}」当前离线，可能已休眠或断网。主机恢复后会自动重连 |
| 授权失败（4001 非 CONNECTION_FAILED） | 登录状态已失效，请重新登录 |
| token 刷新失败 | 登录已过期，请重新登录 |
| TLS 失败 | 证书校验失败，请检查手机时间是否正确 |
| DNS 失败 | 找不到服务器 {domain}，请检查网络或服务器地址，具体见设置 |

### 4.4 终态失败（红色，停止自动恢复）

| 触发 | 文案 |
| --- | --- |
| `4003` 连接被替换 | 该主机已在其他设备上建立连接，本机已断开。要接管请点「重新连接」 |
| 设备被吊销 | 本设备授权已被移除，请重新扫码配对 |
| 身份不匹配（`PEER_IDENTITY_MISMATCH`） | 主机身份校验失败，已阻止连接。如更换过主机密钥，请重新配对 |

### 4.5 诊断面板（长按标题旁状态点）

不要做成开发者模式才可见，普通用户点开就是 6 行：

```
服务器      dsh.example.com（0.17.36）
传输        relay（中继：hk-2）· 直连失败：UDP 不通
心跳        25s · 最近一次 2.1s 前 · RTT 42ms（丢 0/20）
会话        已连接 12 分 30 秒 · 重连 0 次
网络        Wi-Fi「Office-5G」· 14:32 切换过一次
最近事件    14:30:11 断线；14:30:12 开始重连；14:30:14 恢复
```

## 5. 心跳诊断设计

> **2026-11-07 更新：§5.1–5.3 已落地**（v0.17.37-lan），实际实现是「静默看门狗 + 关闭码判词」，
> 与初版建议里「客户端主动发 ping」不同——理由见 5.1 下的说明。已改文件：
> `net/RelayTransport.ets`、`services/AppRuntime.ets`。

### 5.1 参数（已实现）

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| 服务端心跳 | 25s 发 ping，75s 无 pong 断连 | protocol.md §22，服务端权威，不改 |
| 心跳间隔来源 | `hello.ack.heartbeatIntervalMs`（缺省 25000） | 已读入，用来算下面的预算 |
| 可疑阈值 | `max(2×心跳, 40s)` | 只记日志（`link state=suspect`），不拆连接 |
| 判死阈值 | `max(3×心跳, 90s)` 无任何服务器帧 | 主动拆连接走重连，不等服务端 |
| 探活节拍 | 5s | 看门狗心跳，不产生网络流量 |
| 活跃判定 | 收到 Control 或数据面的任意服务器帧 | 两处都 `markLinkAlive()` |

**为什么不自己发 ping**：协议里 Control 心跳是服务端驱动的单向机制（服务端 ping、客户端 pong），
仓库里没有服务端实现也没有「客户端 ping 会得到 pong」的证据。**凭空加 ping 不会被回 pong**，
反而会让看门狗把健康连接判死。所以改成纯被动：只要服务器还在按 25s 节奏发帧，链路就是活的；
一旦静默超过 3 个周期，只能是半开或对端已死——这时不需要协议支持也能确定。
代价是发现半开比服务端自己判超时（75s）晚约 15s，换来零协议风险和零服务端改动。
RTT 因此测不了，留给「客户端 ping 由服务端实现后再开」的后续。

### 5.2 实现位置（已实现）

`RelayTransport` 持有 Control socket，看门狗就挂在它身上：

```ts
private lastInboundAt: number = 0;       // 最近一次收到服务器帧
private serverHeartbeatMs: number = 25000; // hello.ack 覆盖
private linkTimer: number = -1;
private suspectLogged: boolean = false;
public closeVerdict: CloseVerdict | undefined; // 断开判词，上层读它
```

节拍（`onLinkTick`，5s 一次）：`age = now - lastInboundAt`
→ `age ≥ max(3×hb, 90s)` 判死并 `fail()`；`age ≥ max(2×hb, 40s)` 首次记 `suspect`。
任何服务器帧（Control 的任意帧、数据面的 ping/relay 帧）都会重置计时并记 `state=healthy`。

### 5.3 Close 码映射（已实现）

`handleControlClose(result)` 现在收 `CloseResult`，判定集中在纯函数 `describeControlClose(code, reason)`：

| code | reason 含 | 判定 | 动作 | 文案 |
| --- | --- | --- | --- | --- |
| `1000` | — | 正常关闭 | 不自动重连 | 连接已被服务器正常关闭 |
| `1001` | — | 对端离开 | 重连 | 服务器正在重启，稍后自动重连 |
| `1006` | — | 异常断开（无 close 帧） | 重连 | 网络中断，连接被异常关闭 |
| `4001` | `CONNECTION_FAILED` / 空 | 心跳超时 | 重连 | 心跳超时，正在重新连接 |
| `4001` | 其他 | 授权失败 | **停止** | 服务器拒绝了本次连接（4001 …），请重新登录后再试 |
| `4003` | — | 连接被替换 | **停止** | 该主机已在其他设备上建立连接，本机已断开 |
| `4008` | `capacity` / `ticket` | 中继 attach 问题 | 见 `describeAttachFailure` | 已有 ✅ |
| 其他 | — | 未知 | 停止自动恢复 | 连接被服务器关闭（{code} {reason}） |

「停止」= `AppRuntime.handleDisconnect` 读到 `stopAutoReconnect` 后清掉退避计时器、
把 `reconnectAttempt` 归零、把判词文案放进 `errorMsg`，让用户手动重连。
可重连时文案变成「{判词}，{n} 秒后自动重连（第 k/6 次）」，比原来的「与主机的连接已断开」多带了原因。

### 5.4 日志规范

一行一条 KV，便于 `hilog | grep` 后 awk 统计：

```
link state=healthy rtt=42 miss=0 tx=20 rx=20 transport=relay ep=hk-2
link state=suspect rtt=1800 miss=2 tx=22 rx=20
link close code=4003 reason=connection-replaced verdict=stop
link recover attempts=2 elapsed=3120 lastErr=close/4001
```

必须记录的字段：`state`、`rtt`、`miss`、`transport`、`closeCode`、`closeReason`、`attempts`、`elapsedMs`、前后台切换时间点。

### 5.5 网络事件（`@kit.NetworkKit`）

申请权限 `ohos.permission.GET_NETWORK_INFO`，监听：

- `connection.on('netAvailable')` → 立刻取消退避定时器，立即重连（现在只能干等 30 秒）
- `connection.on('netLost')` → 直接进"网络已断开"状态，UI 立刻变灰，避免用户以为还在线
- `connection.on('netCapabilitiesChange')` → 判断 Wi-Fi ↔ 蜂窝切换，给"已切换到移动数据"提示

这一条成本最低、体感提升最大：**断网提示变成 0 延迟**。

> **已实现（v0.17.38-lan）**：新增 `services/NetworkMonitor.ets`，`module.json5` 加 `ohos.permission.GET_NETWORK_INFO`。
> 只发出「断网 / 恢复 / 切网」三类事件，重连策略仍在 `AppRuntime`：
> - 断网 → `networkOnline=false`，设备页横幅显示"网络已断开，恢复后自动重连"，状态点转红；
> - 恢复 → 清掉退避定时器**立刻**重连（`retryNow`），不再干等 30 秒；
> - 切网 → `networkType` 变成 Wi-Fi / 移动数据，进日志 `runtime: 网络类型 Wi-Fi`；
> - 首个 `netAvailable` 只当初始化（实测启动时会误报"网络已恢复"，已用 `initialized` 标记压掉）。

### 5.6 回前台探活（已实现）

`Index.onPageShow` → `AppRuntime.onAppForeground()`：补查网络类型，并对已有连接调
`RelayTransport.recheckLink()`（立刻跑一次看门狗判定）。静默已超预算就当场拆连接重连；
在退避等待中则直接 `retryNow('foreground')`。原来这里只把 `appBackground` 置回 false。

### 5.7 提示语可见性（顺带修的大坑）

排查中发现 `reconnectStatus`（"n 秒后自动重连（第 k/6 次）"）**从来没被渲染过**，
只用来给标题旁的状态点染色。现在设备页顶部加了横幅（`linkBannerText()`）：
重连中显示进度 + 「停止重连」，断网时显示断网提示；状态点在断网时也转红。

## 6. 落地顺序

| 优先级 | 内容 | 状态 | 收益 |
| --- | --- | --- | --- |
| P0 | Control close 码解析 + 4001/4003 分流（§5.3） | ✅ v0.17.37 | 修掉"该停不停、该重连不重连"的真 bug |
| P0 | 静默看门狗 + 三段式状态（healthy/suspect/dead）（§5.1-5.2） | ✅ v0.17.37 | 半开连接不再等 45s RPC 超时，最迟 90s 自行重连 |
| P1 | 网络事件监听 + 恢复即重连（§5.5） | ✅ v0.17.38 | 断网/切网提示 0 延迟 |
| P1 | 回前台探活（§5.6） | ✅ v0.17.38 | 锁屏回来不再假绿点 |
| P1 | 重连提示可见（§5.7） | ✅ v0.17.38 | 用户第一次能看到倒计时与次数 |
| P1 | 提示语按 §4 重写（尤其退避耗尽那句） | ✅ v0.17.41 | 用户知道该干什么 |
| P2 | 诊断面板 + 指标（§4.5） | ✅ v0.17.41（链路静默 20 条事件环形缓冲；RTT 待协议） | 现场排障不用连电脑抓 hilog |
| P2 | 短抖动不踢出会话（§2 末） | ✅ v0.17.41 | 少一次上下文丢失 |
| P3 | 客户端主动 ping + RTT | 阻塞 | 需服务端对客户端 ping 回 pong，协议未定义，先不动 |

## 7. 验收判据（可直接当回归用例）

1. 飞行模式 10 秒恢复：**≤5 秒**内恢复会话，用户没被踢回设备列表，无红色报错。
2. 路由器拔 WAN、局域网正常（半开）：最迟 **90 秒**内自行判死并进入重连，文案带"链路静默 N 秒"。
3. 同账号第二台设备登录：本机**不再自动重连**，文案为"该主机已在其他设备上建立连接"。
4. 服务端吊销 token（4001 非 CONNECTION_FAILED）：停止自动重连，文案要求重新登录。
5. 服务端重启（1001）：自动重连成功，文案"服务器正在重启，稍后自动重连"。
6. 锁屏 30 分钟回前台：1 秒内可见探活结果，已死则立即重连。
7. `hilog -T DSHREMOTE` 中 `link close` / `link state` / `link heartbeat` 三类行齐全，能还原整条时间线。

