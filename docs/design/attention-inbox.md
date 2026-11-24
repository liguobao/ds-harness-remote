# Attention Inbox、零明文盲唤醒与 iOS Live Activity 设计

本文定义跨后端（Harness / CodeX / ACP / DS-Bot）的统一待办收件箱（Attention Inbox）、零明文盲唤醒信号（`attention.signal.v1` / `push.wake.v1`）、断线审批暂挂不变量，以及 iOS ActivityKit Live Activity 扩展蓝图。线协议字段与严格 Schema 以 [protocol.md](../protocol.md) 和 `packages/protocol/src/attention.ts` 为权威。

## 1. 架构与零明文信任边界

```text
Host (Harness / CodeX / ACP / DS-Bot)
  ├─ [Control WS · attention.signal.v1] ──► Server (内存 digest / 盲 Webhook / APNs·FCM·Live Activity)
  │    仅发严格校验的 AttentionDigest（计数 0..99 + urgentKind + urgency + 32-hex 随机 token）
  │
  └─ [Noise E2EE 隧道 · attention.inbox.v1] ──► 已认证 Client (Android / iOS / Desktop / VS Code)
       attention.{list, follow, resolveToken, ackUnread} -> AttentionItem / AttentionTarget
```

1. **零明文硬隔离**：
   - `AttentionDigest` 是唯一允许离开 Noise 隧道的注意力对象，经 `attentionDigestSchema.strict()` 强制校验；任何额外键（`title`、`sessionId`、`prompt`、`path`、`command`、`summary`）在发送端与接收端均 fail-closed 拒绝。
   - `attentionToken` 必须是 128-bit 密码学随机小写十六进制串（`/^[a-f0-9]{32}$/`），由 Host 进程内存维护短期映射表；既不可逆推出 `sessionId`，也不落盘到 Server。
   - 推送或灵动岛被点击后，Client 携带 `hostDeviceId + attentionToken` 唤醒并完成既有 membership + pinned key + Noise IK 握手，随后在加密隧道内调用 `attention.resolveToken({ token })` 换取 `AttentionTarget`；命中则直达目标会话，过期/已处理/不可达则安全回退 `{ kind: 'inbox' }`。
2. **统一聚合与排序（Lody 启发）**：
   - Host 侧 `HostAttentionTracker` 汇总 Harness、CodeX、ACP 与 DS-Bot 四类后端的待审批、待问答、运行中及未读完成/失败状态，维护进程内单调递增 `revision`，并限制列表上限 `MAX_ATTENTION_ITEMS = 64`。
   - **背景观察边界**：在无 Client 连接（0-client）状态下，Host 可持续观察 CodeX、ACP 以及 Harness 被动只读 `session/control`（会话标题与持久化 `userQuestions`，使用 `interactions: 'none'`，严禁注册 `interactions: 'answer'` 抢占本地答题权）；Harness 瞬时 `$events` 审批/运行态与 DS-Bot 路由事件则通过已认证连接的实时桥接（`HarnessRemoteBridge` / `PluginRouteBridge`）旁路汇入 `HostAttentionTracker`。
   - 展示与汇总统一使用纯函数 `compareAttentionItems`：`waiting_question (0) > waiting_approval (1) > running (2) > failed_unread (3) > completed_unread (4)`，同级按 `updatedAt` 降序，再按 `id` 字典序升序。
3. **Server 能力分层**：
   - 本仓库自部署 `apps/server` 仅实现内存态 `attention.signal.v1`（缓存最新 `AttentionDigest` 并在 `/api/v1/devices` 与 `/presence` 返回可选 `attentionDigest`，另支持可选盲 Webhook），不宣告 `push.wake.v1`。
   - 独立完整 Server 实现 `push.wake.v1`（`PUT/DELETE /api/v1/devices/self/push-target` 与 `PUT/DELETE /api/v1/devices/self/live-activities/:hostId`），负责向 APNs/FCM 派发盲唤醒通知与 ActivityKit 状态更新。

## 2. Codex / ACP 断线审批暂挂不变量（Detached Approval Hold）

移动端切后台、锁屏或网络切换会短暂中断 Noise 连接。若 Host 在连接断开瞬间立刻拒掉所有未决审批，用户点击盲推送返回时审批句柄已失效；但无限期悬挂或放宽权限同样破坏安全边界。因此断线审批暂挂必须满足以下不变量：

1. **有界宽限窗口与全局上限**：仅当 Host 在 `AttentionItem.detachedExpiresAt` 显式声明有限截止时间时，允许在发起连接断开后暂挂待审批请求；CodeX 与 ACP 共享单一全局暂挂上限（`MAX_DETACHED_APPROVALS = 16`），超时仍无已认证同账号 Client 接管应答，必须自动按既有 fail-closed 语义拒绝/取消并释放句柄。
2. **禁止放宽授权语义**：暂挂不改变既有单次审批契约——Harness 仅限 `allow_once | deny`（禁 `allow_session`），CodeX 仅限 `accept | decline | cancel`，ACP 仅限按 `options.kind` 映射的单次 `allow-once | reject-once | cancel`（禁 `allow-always`）。
3. **禁止盲通道回传决策**：推送通知快捷按钮、Control WS 与 Server REST 严禁直接提交审批结果；任何审批/问答响应都必须在重新完成账号 membership、本机 pinned identity key 与 Noise 加密认证后的隧道内发出。
4. **身份与生命周期隔离**：宽限期内接管的 Client 必须属于同一 `owner_account` 并通过 Host trusted peer 校验；会话取消（`session/cancel`）、后端重载、设备撤销或 Host 关闭时，所有暂挂审批必须立刻撤销，迟到应答返回 `PERMISSION_NOT_PENDING`。
5. **非持久化与内存投影**：暂挂句柄与 `AttentionItem` 仅存 Host/Client 内存，严禁写入 DSH `SessionStore`、Workspace 数据库、Harness 日志或 Server 持久化存储。

## 3. iOS ActivityKit Live Activity Swift Extension 蓝图

### 3.1 零明文 `ActivityAttributes` 映射

iOS Live Activity 仅把本地已知的 Host 标识放入静态 `Attributes`，动态 `ContentState` 与 `AttentionDigest` 一一对应，确保 APNs `apns-push-type: liveactivity` 负载全程零明文：

```swift
import ActivityKit
import Foundation

struct DshHostAttentionAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var revision: Int
        var pendingApprovals: Int   // 0..99
        var pendingQuestions: Int   // 0..99
        var runningSessions: Int    // 0..99
        var completedUnread: Int    // 0..99
        var urgentKind: String?     // "approval_needed" | "question_needed" | "turn_completed" | "turn_failed" | "clear"
        var urgency: String         // "critical" | "normal" | "silent"
        var attentionToken: String? // /^[a-f0-9]{32}$/
        var updatedAt: Int64        // Unix epoch ms
    }

    var hostDeviceId: String
    var hostDisplayName: String
}
```

### 3.2 令牌生命周期与深链交互

1. **启动与令牌同步**：用户在 App 中开启某 Host 的 Live Activity 后，监听 `activity.pushTokenUpdates`（及 iOS 17.2+ `Activity<DshHostAttentionAttributes>.pushToStartTokenUpdates`），向完整 Server 调用 `PUT /api/v1/devices/self/live-activities/:hostId` 上报 `activityPushToken`（与可选 `pushToStartToken`、`environment`、`activityId`）；结束或退出登录时调用 `DELETE /api/v1/devices/self/live-activities/:hostId`。
2. **灵动岛与锁屏呈现**：
   - Compact / Minimal：显示高优先级角标（`pendingQuestions + pendingApprovals > 0` 高亮待处理数，否则显示 `runningSessions`）。
   - Expanded / Lock Screen：展示主机本地名称、待审批/待问答/运行中计数及通用本地化状态提示，不渲染任何会话标题或命令文本。
   - 点击深链：`dshremote://attention?host=<hostDeviceId>&token=<attentionToken>`（无 token 时省略 `token` 直接打开该 Host 的 Attention Inbox），App 在加密连接建立后调用 `attention.resolveToken` 导航。

### 3.3 iOS 本地实时活动

iOS 客户端通过 `DshRemoteLiveActivity` 与随 App 嵌入的 `HostAttentionWidget` 展示当前连接的 Host。开启任务提醒且有待处理、运行中或未读项目时，用加密通道收到的摘要更新锁屏与灵动岛。点击后按 Host 和可选的不透明 token 打开收件箱。关闭提醒、断开连接或清空计数会结束活动。

当前原生模块使用本地 ActivityKit 更新。上文的 APNs token 注册、后台远程更新与签名真机投递仍待接入。打包时，扩展的 Bundle ID 使用主 App 的 Bundle ID 加 `.attention`，版本和构建号随主 App 同步。
