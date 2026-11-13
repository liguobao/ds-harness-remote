# Remote 异步 /compact 真机验证

对应 PR #420 review 要求的三项：超过旧 35s/60s 边界仍成功、断线重连继续观察且不重跑、
显式取消后状态/事件/底层收尾一致。本文只描述最小验证步骤与证据字段，不包含会话正文。

## 1. 前置条件

- **Host**：一台 DGX Spark，运行 DSH（Web/Desktop 均可）并安装本分支的 `ds-harness-remote`
  （Host 角色），模型后端为本地 GLM-5.3-Flash，prefill 约 1k tok/s。
- **Client**：另一台设备（Android 手机上的 DSH Remote，或另一台电脑的远程 Web 控制台）。
  必须经过 Remote（LAN/P2P/TURN/Relay 任一），不能是 Host 本机直连。
- **上下文**：准备一个 ≥ 400K token 的会话（或 500K 档），确保单次压缩明显超过 60s。
- **版本记录**：DSH 版本、插件 commit（`git rev-parse --short HEAD`）、Android APK 版本、
  连接方式（客户端连接页显示 LAN/P2P/TURN/Relay）、模型名。
- **Host 日志**：保持 `ds-harness-remote` 的 `logLevel=info`（默认），日志中会出现：
  - `remote compaction accepted`
  - `remote compaction cancellation requested`
  - `remote compaction confirmation`
  - `remote compaction settled`（含 `durationMs`）
- **会话事件**（Host 侧）：每次操作应只有一条 `command/run`（name=compact）、一条
  `compaction/start`，以及一条 `compaction/end`/`command/done`。可在 Host 的会话日志或
  客户端会话事件中查看；数量是最重要的证据。

## 2. 用例 A：超过 60s 仍成功

1. 客户端打开大上下文会话，发送 `/compact`。
2. 预期：界面进入命令忙状态（发送键变为停止/忙碌），压缩持续 > 60s（通常 2–8 分钟）。
3. 完成后预期：命令返回成功（“Compacted N history items…”），没有 `RPC_TIMEOUT`。
4. 记录：
   - 开始/结束时间、总耗时
   - Host 日志 `accepted` 与 `settled ... succeeded` 的 `durationMs`
   - 会话事件中 `command/run`、`compaction/start`、`compaction/end` 各 1 条

判定：耗时 > 60s 且最终 `succeeded`，客户端无超时错误。

## 3. 用例 B：压缩中断线重连

1. 发送 `/compact`，等 Host 日志出现 `remote compaction accepted`（或客户端显示压缩中）。
2. 在压缩进行中关闭客户端网络（飞行模式/断网）约 30 秒，再恢复。
3. 预期：
   - 客户端重连成功；Host 日志出现同一 `operationId` 的 status 查询（`compaction/status`），
     没有新的 `remote compaction accepted`。
   - 压缩在 Host 继续运行；会话事件中仍然只有 1 条 `command/run`、1 条 `compaction/start`。
   - 最终客户端/日志得到同一操作的终态，不出现第二次压缩。
4. 记录：断线时长、重连后首个 status 的 `operationId`、Host 日志中 `accepted` 的次数
   （必须为 1）、`command/run` 次数（必须为 1）。

判定：重连后查询的是同一 operationId，Host 未重跑压缩。

## 4. 用例 C：显式取消

1. 发送 `/compact`，等压缩开始（`compaction/start`）。
2. 点击输入框右侧的停止按钮（tracked 压缩进行中会显示；旧命令/普通回合仍走原停止逻辑）。
3. 预期：
   - 客户端立即显示“取消请求已发送/取消中”，随后按 Host 确认结果变为：
     - `cancelled`：Host 在 `session/events` 中确认同一 `sourceCommandId` 的
       `compaction/end` 带 error；Host 日志 `settled ... cancelled`。
     - `unconfirmed`：压缩已提交但取消期间无法确认持久化；客户端提示“已提交但无法确认”，
       **不会**再自动发起第二次压缩。
   - 会话事件：`compaction/start` 1 条、`compaction/end` 1 条；取消后不应再出现新的
     `compaction/start`。
   - Host 日志：`cancellation requested` → `confirmation` → `settled`。
4. 记录：取消时刻、最终客户端状态、Host `settled` 的 state、`compaction/end` 是否有 error。

判定：客户端不再显示“运行中”，最终状态与 Host 日志/事件一致；若为 `unconfirmed`，文档需注明
持久化结果不可确认，且没有重跑。

## 5. 结果模板（贴回 PR）

```
环境
- DSH: <version>, plugin: <commit>
- Host: DGX Spark x2, GLM-5.3-Flash, prefill ~<n> tok/s
- Client: Android <version> / Web, transport: LAN|P2P|TURN|Relay

A. 长压缩
- 上下文/耗时: <tokens> / <mm:ss>
- Host log: accepted -> settled succeeded, durationMs=<n>
- events: command/run=1, compaction/start=1, compaction/end=1(error=no)

B. 断线重连
- 断线时长: <s>
- accepted 次数: 1; command/run 次数: 1
- 重连后 status operationId: <id>（与首个 accepted 的 id 相同）

C. 取消
- 取消时刻/最终状态: <state>
- Host log: cancellation requested -> confirmation -> settled <state>
- events: compaction/end error=<yes/no>; 取消后新增 command/run=0
```

## 6. 失败时的取证

- 客户端：错误文案、`commandResult`、断线前后截图/录屏（不含会话正文）。
- Host：`grep 'remote compaction' <host-log>` 的完整片段；`accepted` 次数、
  `command/run` 次数、`operationId` 与状态变化。
- 若出现 `unconfirmed`：记录当时是否有 `compaction/end`、是否再次发起压缩。

## 实测记录（2026-11-13，跨设备）

- Host：MacBook Pro（隔离的 DSH profile），DSH `0.2.2-rc.1`，插件 `b117427a`；
  模型 `dgx-spark` / GLM-5.3，端点 `100.104.125.29:1235`（DGX Spark 上的 TensorFold 服务）。
- Client：**另一台机器 DGX Spark-01**（aarch64，Node 22），通过 Mac 上的自托管 Remote Server
  （`192.168.1.11:8080`）以 Relay 连接；Host 与 Client 均使用 E2E 加密的 Remote 通道。
- 会话：600,074 字符的参考材料，压缩报告 `Compacted 4 history items (~150845 tokens)`。
- 所有用例的会话事件均为 `command/run=1`、`compaction/start=1`、`compaction/end=1`。

| 用例 | 结果 |
| --- | --- |
| A. 长压缩 | 137.66s 后 `succeeded`；Host 日志 `settled succeeded, durationMs=137396` |
| B. 断线重连 | 压缩开始 0.5s 后断开，15.6s 后重连；用同一 `operationId` 继续观察，202.07s 后 `succeeded`；Host 日志 `accepted` 仅 1 次，`command/run` 仅 1 条 |
| C. 显式取消 | 压缩开始 5.5s 后取消，先返回 `cancelling`；Host 两次 `confirmation not-yet` 后确认 `compaction/end` 失败，6.18s 时 `cancelled`；事件仍为 1/1/1 |

Host 日志摘录（`b117427a`）：

```
remote compaction accepted {"operationId":"c7aa8f06-...","sessionId":"session-5eadae9a-...","budgetMs":1800000}
remote compaction settled {"operationId":"c7aa8f06-...","state":"succeeded","durationMs":137396}

remote compaction accepted {"operationId":"b5f1576f-...","sessionId":"session-83604d2d-...","budgetMs":1800000}
remote compaction settled {"operationId":"b5f1576f-...","state":"succeeded","durationMs":200767}

remote compaction accepted {"operationId":"32bfe660-...","sessionId":"session-14fd1ce9-...","budgetMs":1800000}
remote compaction cancellation requested {"operationId":"32bfe660-..."}
remote compaction confirmation {"operationId":"32bfe660-...","kind":"not-yet"}
remote compaction confirmation {"operationId":"32bfe660-...","kind":"not-yet"}
remote compaction confirmation {"operationId":"32bfe660-...","kind":"finished","failed":true}
remote compaction settled {"operationId":"32bfe660-...","state":"cancelled","durationMs":6171}
```

结论：三个验收项均通过；断线期间 Host 未重跑压缩，取消经过 `compaction/end` 确认后才判定终态。
