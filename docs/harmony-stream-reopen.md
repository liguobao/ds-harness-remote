# 会话流断了只能重启？——原因与修法（TURN 模式下高发）

## 现象

TURN（跨网段走中继）连上后跑一段时间，聊天页弹红条：

```
RPC
harness.remote.stream.open
```

按钮写「重新打开会话」，但点了没反应，必须杀掉 App 重进。

## 根因（两条，第二条是"点了没用"的直接原因）

1. **重试闭包调错了函数**：`openSession(sessionId)` 开头就是
   `if (this.phase !== PHASE_CHAT || sessionId === this.currentSessionId) return;`。
   会话流断的恰恰是"正在看的这个会话"，`sessionId === currentSessionId` 恒成立 →
   **重试直接 return，什么都不做**。重启 App 之所以有效，是因为那时 `currentSessionId` 是空的。
2. **失败本身通常是传输层不可用**：`harness.remote.stream.open` 是数据面上的 RPC，
   走 TURN 数据 socket。TURN 半开 / 中继节点回收 / 弱网 stall 时，这个 RPC 会
   `timed out` 或 `send failed`，此时原样重试同一个 RPC 只会继续失败——
   必须换链路（重连）而不是重发。

## 修法

| 改动 | 说明 |
|---|---|
| `reopenCurrentSession()` | 专门"重开当前会话的 follow 流"，绕开 `openSession` 的同会话早退；失败时日志打 `session reopened -> …` / `reopen session failed: …` |
| 区分错误类型 `isTransportFailure()` | 超时/发送失败/通道关闭/链路静默 → 传输类；否则当业务拒绝 |
| `reconnectAndReopen()` | 传输类失败时：`pendingResumeSessionId = 当前会话` → `teardownConnection()` → `connectDevice(lastDeviceId)`，连上后 `pickInitialSession()` 直接回到原会话 |
| 按钮文案随类型变 | 传输类显示「重连并重新打开」，业务类显示「重新打开会话」 |
| `nudgeLink()` | 重开失败时顺手 `recheckLink()`，半开连接立即判死，不用干等 90 秒看门狗 |
| 文案 | 传输类失败改成「会话流断了（传输层已不可用）：点「重连并重新打开」换一条链路再进来，不用退出 App。」 |

## 验收

- TURN 模式下断链：红条 →「重连并重新打开」→ 一次点击后**回到同一会话**（不退出、不丢当前选中）。
- hilog 关键行：`reopen session failed: RPC harness.remote.stream.open …` 之后出现
  `会话流失败 → 重连并重新打开`、`connected to host … transport=turn`、`session reopened -> session-…`。

## 姊妹问题：`relay connection has not been authorized`

现象：偶发「会话列表加载失败：RPC harness.remote.call send failed: relay connection has not been authorized」。

根因：`RelayTransport.send()` 要求 `connectionId` 已就位（`connect.accepted` 之后才有）。
重连间隙 / 中继换票重 attach / LAN 回落中继那一瞬间，加密通道已经是"连上"状态，
但数据面还没拿到新的 connectionId，此时任何 RPC（第一个通常就是 `session/list`）的发送会直接抛这句话；
旧逻辑把它当成普通业务错误抛给上层，于是整页显示「会话列表加载失败」，用户只能退出重进。

修法：
- `RemoteClientCore.sendWithAuthRetry()`：识别「not been authorized / relay connection」这类**可重发**失败，
  同一帧最多重发 4 次、每次等 250ms（requestId 不变，主机按 requestId 去重，不会重复业务请求）。
- `RelayTransport.isAuthorized()`：暴露"是否已拿到 connectionId"，排障与后续 gating 用。
- `isTransportFailure()` 把这句话也算传输类失败：会话列表没拉到时的按钮变成「重连并重试」，
  文案改为「与主机的加密通道还没就绪或已断开」，不再说"会话列表加载失败"这种误导。
