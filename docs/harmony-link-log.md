# 链路日志与「断网之后回不来」（0.17.65）

## 现象

- 常态断线：中继/TURN 跑着跑着就断，频繁。
- 飞行模式后**回不来**：关掉飞行模式，界面上看着还连着，但发消息没反应；
  切到主机列表再点「连接」也不行 —— **必须把这个 App 从后台任务里删掉、重新打开**才能用。

## 根因（两条，都跟「半开连接」有关）

1. **WebSocket 在断网时不报 `close`**。飞行模式/切 Wi-Fi 之后 socket 成了半开状态：
   `RelayTransport` 的 `socket`、`RemoteClientCore`、`HarnessAlphaClient` 全都还在，
   项目自己以为「还连着」。以前唯一能发现它的只有 90 秒静默看门狗，而用户早就被卡住了。
2. **复用路径没有体检**。从会话页退回主机列表时 `keepAliveDeviceId`/`core`/`harness` 都留着
   （设计上为了「再进去不重新握手」）。这时点「连接」走的是复用分支——直接回到那条死连接，
   于是「连上了但点不动」。杀掉进程后这些对象才被清掉，所以「必须删后台任务」。

## 真正的根因（0.17.66，实测日志定位）

上面两条只是「为什么点不动」。实测 link.log 暴露了更致命的一条：

```
03:15:14.945 [net]  网络断开（phase=chat transport=relay）
03:15:22.947 [net]  掉网 8 秒仍未恢复，主动判死链路（不等 WebSocket close）
03:15:22.949 [link] 判死链路：网络已断开 8 秒
03:15:36.637 [net]  网络恢复 type=无网络 phase=chat wasOffline=true
（之后就什么都没有了：没有断线事件、没有重连、没有报错）
```

**`RelayTransport.onClosed` 从来没人订阅。** `SecureTransport` 只在自己被 `close()` 时
才往上抛关闭事件，底层中继自己死掉（WS close/error/看门狗判死）时，事件到 `RelayTransport`
就断了。后果：

- `AppRuntime.handleDisconnect()` 在这条路径上**是死代码**：判词、退避重连、`pendingResumeSessionId` 全都不会发生；
- UI 一直显示「已连接」，直到用户发消息撞上 RPC 超时才露馅；
- 杀掉进程之所以「能修好」，是因为重启把这条死连接的对象全清了。

修法：`SecureTransport.connect()` 订阅 `inner.onClosed`，非主动关闭时清 Noise 状态并向上抛一次
（`handleInnerClosed`），再顺带修两处把恢复卡死的地方：

- `retryNow()` 现在也接受「会话页 + 没有传输对象」——只认 `reconnecting` 是不够的，
  因为判死链路时 `handleDisconnect` 还没跑，`reconnecting` 仍是 false；
- 承载切换判定只认真实承载之间（Wi-Fi / 移动数据 / 有线），「无网络 → Wi-Fi」属于刚恢复，不再误判。

## 修法

| 改动 | 作用 |
|---|---|
| `RelayTransport.isHealthy(maxSilenceMs)` | 「socket 在 + 中继已授权 + 最近有服务器帧」三件都成立才算健康 |
| `RelayTransport.failStale(reason)` | 上层判定不可用就立刻按「静默」判死，走统一断线重连，不等 90 秒看门狗 |
| 复用前体检 | 不健康就**放弃复用**，直接干净重连；日志记 `放弃复用（链路不健康…）` |
| 复用后再验一次 | 复用后拉会话列表失败（且是传输类）→ 自动干净重连一次，不把「加载失败」甩给用户 |
| 掉网 8 秒主动判死 | 断网后不再指望 `close`：8 秒还没恢复就把链路判死，网络一回来立刻重连 |
| 承载切换即判死 | Wi-Fi ↔ 移动数据：旧 socket 的源地址已经没了，直接判死重连 |
| 回前台静默体检 | 静默 ≥45 秒（两个心跳周期）直接判死重连，而不是等看门狗 |
| `retryNow` 放宽三处 | 会话页「重连中」也能立刻重连；退避耗尽（timer 已清）也允许再试；重连计数归零 |
| 连接 30 秒看门狗 | 任何一步卡住都不会让界面永远停在「正在连接」 |

阈值：`LINK_STALE_MS = 45000`（服务端心跳 25s，两个周期没消息即可疑）、
`CONNECT_DEADLINE_MS = 30000`。

## 链路日志（落盘，重启也保留）

`services/LinkLog.ets` 把「在线/断线相关的每一个决策」写进应用沙箱：

```
/data/app/el2/100/base/cn.r2049.dshremote/haps/entry/files/link.log
```

抓取：

```sh
hdc -t <serial> file recv /data/app/el2/100/base/cn.r2049.dshremote/haps/entry/files/link.log ./link.log
```

也可以在 App 里：会话页 ☰ → 底部「诊断」，面板里直接看最近 12 行，
点「复制」带出全部行（含最近 40 行日志）+ 文件路径。

一行一条，格式 `时:分:秒.毫秒 [tag] 内容`，tag 取值：

| tag | 含义 |
|---|---|
| `boot` | 进程启动（每次启动一行，用来切分不同现场） |
| `net` | 断网 / 恢复 / 承载切换 / 掉网 8 秒判死 |
| `link` | 判定链路不可用（判死原因） |
| `conn` | 连接成功/失败、复用与放弃复用、连接超时、自动重连失败 |
| `retry` | 立即重连（网络恢复/回前台触发） |
| `event` | 与界面「最近事件」同一句 |

写盘是同步追加、256KB 轮转一份（`link.log` → `link.log.1`），同时镜像一行到 hilog（前缀 `LINK`），
所以老的抓法 `hilog -x | grep LINK` 仍然可用。

## 现场怎么读（一次飞行模式恢复应该长这样）

```
02:58:10.001 [net]   网络断开（phase=chat transport=relay）
02:58:10.002 [event] 网络断开
02:58:18.030 [net]   掉网 8 秒仍未恢复，主动判死链路（不等 WebSocket close）
02:58:18.031 [link]  判死链路：网络已断开 8 秒
02:58:18.032 [event] 断线：网络已断开 8 秒 → 1s 后第 1 次重连
02:58:19.100 [conn]  连接失败 device=… ：RelayTransport failed to connect …（attempt=1）
02:58:21.200 [conn]  自动重连失败，2s 后第 2 次
02:59:02.010 [net]   网络恢复 type=Wi-Fi phase=devices wasOffline=true
02:59:02.011 [retry] 立即重连（net-available）phase=devices target=…
02:59:06.500 [conn]  复用… / 或直接 connected
02:59:07.200 [event] 已连接 · relay
02:59:09.900 [event] 会话列表已自动恢复（累计 1 次）
```

关键判读：
- 有没有 `网络恢复` 之后紧跟 `立即重连` —— 没有就是恢复链断了（旧版本的症状）；
- 有没有 `放弃复用` —— 有说明体检生效，避免了一次「连上但点不动」；
- 如果反复 `连接失败` 都是同一句报错，看 `[conn]` 里的原文定位是中继票据、容量还是主机不在线。

## 验收（2026-11-08 03:25，真机 0.17.67）

用户手动关 Wi-Fi 22 秒再打开，全程没有碰 App、没有杀进程：

```
03:25:39.379 [disc]  链路断开 code=1006 reason=transport-error attempt=0
03:25:39.380 [event] 断线：网络中断，连接被异常关闭 → 1s 后第 1 次重连
03:25:40 / 42 / 46 / 54  [conn] 连接失败… 自动重连失败，2s/4s/8s/15s 后第 N 次
03:26:01.306 [net]   网络恢复 phase=devices reconnecting=true wasOffline=true
03:26:01.308 [retry] 立即重连（net-available）
03:26:01.344 [net]   承载变化 无网络 → Wi-Fi
03:26:15.060 [event] 已连接 · relay
03:26:20.291 openFollow sessionId=session-94d64a1d…   ← 自动回到同一会话
```

结论：断网 → 判死 → 退避 → 网络恢复即刻重连 → 自动回会话，全链路自动，耗时
**断网期间无感、网络恢复后约 14 秒**（其中大部分是 Wi-Fi 重新关联后第一次 REST + 中继握手）。

## 还留着的限制

- 断网期间本地没有「离线队列」：重连后消息要用户重发（目前不改语义）。
- 若中继节点本身抖动，客户端只能快速失败 + 重连，换节点依赖服务端 `relayCandidates`。


---

# 稳定性这一批（0.17.69–0.17.75，2026-11-08 夜间）

用户的原话：**「如果连局域网都不能保证网络链接，真的就是太差了。」** 这一批就是照这句话做的。

## 1. 直连（LAN DataChannel）以前一次都没跑过

`startRtcAttempt()` 被写在「服务器下发了 `relayEndpoint`」的分支里，而本机服务器的
`connect.accepted` **从来不带** `relayEndpoint`：

```
ctl frame len=169 type=connect.accepted
connect.accepted hints=[] relay= ticket=无   ← 没有端点
```

于是每次都直接 `finishConnect('relay')`，数据面挂在 **Control WS** 上（控制帧和 64KB 数据帧
共用一条 TCP WebSocket）。这就是「局域网里也又慢又容易断」的结构性原因。

- 改为：先试直连，与有没有中继端点无关；没有端点时回落就是「Control WS 承载」。
- 实测（手机 + Edge，同一局域网）：`transport=lan`，连接耗时 ~6s（其中 WebRTC 协商 ~5s）。

## 2. 熄屏 / 后台被冻结 = 心跳回不了 = 服务端踢人

```
03:41:02.258 [disc] 链路断开 #1 code=1006 reason=transport-error · 本次在线 219.5s transport=lan
03:41:06.562 [stat] 连接 #2 · transport=lan · 恢复耗时 4.3s
```

在线 219.5 秒后断一次，恢复只用 4.3 秒（这是 0.17.66 那批的功劳）。
断开发生在手机熄屏闲置期间：**进程被系统冻结 → 回不了服务端 25s 心跳 → 75s 后服务端断开**。

- 新增 `services/KeepAlive.ets`：连着主机期间申请长时任务（`dataTransfer`），断开即释放；
  `module.json5` 增加 `backgroundModes` 与 `ohos.permission.KEEP_BACKGROUND_RUNNING`。
- 日志：`[life] 保活开始（长时任务 dataTransfer）：熄屏/后台不再冻结`。

## 3. 断线检测：从 45~90 秒压到 35 秒

- **应用层心跳探测**：空闲 ≥35 秒（服务端 25 秒一跳，说明漏了一拍）就主动发一个便宜 RPC
  （`harness.transport.describe`，6 秒预算）。有回包 = 链路活着；超时 = 立刻判死走重连。
  主机不认识这个 RPC 时收到「method not found」也算活着。
- 直连入站数据也计入「链路还活着」（否则直连会被误判静默，进而反复重连）。
- 直连数据面报错/关闭 → 立刻 `failStale`，不再等任何超时。

## 4. 失败要快

- 桥里 `connectionState/iceConnectionState` 进 `failed/closed`、`DataChannel close` 立刻上报；
  以前只能等 DataChannel 25 秒超时 → 现在 12 秒，且通常 1~2 秒就知道。
- 直连连续失败 2 次 → 冷却 10 分钟，主机不支持直连时不会每次连接都白等。
- `session/follow` 首帧偶发丢失 → 自动重开一次（600ms 后），不再直接甩红条。

## 5. 连接到底慢在哪（打点）

```
trace connect 分段 6102ms (设备信息 13ms · 中继+握手 96ms · 订阅 1079ms)
trace session/list 5466ms (发出 2ms · 等回 5464ms · 重发 0)
trace session/follow 91ms / 首帧 1362ms      ← 直连下
```

结论：连接时间主要花在 **WebRTC 协商（~5s）** 与 **主机回 session/list（3~9s）**，
不是网络抖动。所以重连策略要「不重来一遍全部」而不是「更快超时」。

## 6. 诊断面板新增

```
稳定：连接 3 次 · 断线 2 次 · 本次已在线 128 秒 · 上次恢复 4.3s
日志：link.log（已落盘，重启也保留）
```
