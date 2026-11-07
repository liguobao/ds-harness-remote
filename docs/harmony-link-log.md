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

## 还留着的限制

- 断网期间本地没有「离线队列」：重连后消息要用户重发（目前不改语义）。
- 若中继节点本身抖动，客户端只能快速失败 + 重连，换节点依赖服务端 `relayCandidates`。
