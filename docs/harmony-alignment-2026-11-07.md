# 鸿蒙客户端与上游 ds-harness-remote 的对齐记录（2026-11-07）

上游基线：`liguobao/ds-harness-remote` main（拉到 `v0.6.3` 之后，最新提交 `d37678e`）。
本地鸿蒙客户端分支 `release/v0.03`，本轮对齐后版本 `0.17.38-lan (1000160)`。

## 本轮已对齐

| 上游 | 鸿蒙侧落地 | 说明 |
|---|---|---|
| `b689d7f fix(plugin): page device discovery…` + 协议 §设备分页 | `ServerApi.listDevices` 走 `?limit=50` + 不透明 `cursor` 翻页，读完所有页；老服务端无 `nextCursor` 直接停 | 之前只取第一页，主机多于 50 台会漏；最多 20 页防死循环 |
| `65df580 fix(android): render heartbeat messages as readable prose` | 新增 `services/Heartbeat.ets`；聊天气泡（用户/助手两侧）折成可读正文，附「查看巡检原文 / 收起巡检原文」 | 解析规则与上游一致：只认 `automation_id`/`decision`/`message`/`instructions`，重复字段、未知标签、缺 `automation_id`、截断、被前缀或代码块包住的一律原样显示（9 条上游用例逐条核对通过） |
| `6811e17 feat(android): add composer expand button and fullscreen editing sheet` | 输入坞新增 `⤢` 按钮 → 全屏编辑面板（字数、发送、收起，草稿照常落盘） | 小屏长文不再被候选条和输入坞挤扁 |

## 差异分析后判定「暂不跟」的项

- **关闭语义按 (code, reason) 分类**（协议 §Control heartbeat / `close-semantics.ts`）：正确做法是 `RelayTransport` 按 reason 区分 `server shutdown` / `heartbeat timeout` / `4003` / `4004`。这块与另一个会话正在进行的心跳/重连改动重叠，避免同文件互相覆盖，留给那个改动一起收口。
- **启动自动连接上次主机**（`53ba50d`）：会改启动状态机，与上面同一片区域，等重连逻辑定稿再加。
- **会话列表点击秒开 + 重连无闪白**（`b558751` / `141f1a6`）：鸿蒙侧已有历史缓存先出内容再同步，行为已等价；差别只在「本地加密持久化缓存」。
- **会话抽屉直接新建工作区 + 分组卡片**（`4d87a26` / `24160bd`）：鸿蒙侧已有 `WorkspaceCreateOverlay`（抽屉工作区行里的「＋ 新建」），不做重复实现；分组卡片是 Android 专属视觉。
- **会话图片附件跨版本兼容**（`b6e4f65`）：上游放宽为可传完整 `ImageAttachmentRef`。本机 Host 是 0.2.0-rc.2（严格形态），现状可用；等 Host 升级到 0.2.2+ 再一起改 `sessionAttachment`（改动点已定位：只传 `attachmentId` → 同时带 `attachment` 引用，并容忍回显不完整）。
- **429 限流**（`c6d4411`）：鸿蒙 `ServerApi` 已把 429 当可重试处理，无需改动。
- **WebRTC / TURN / relayRecoveryTicket / `transport.selected.turnNode`**：传输策略，按用户要求不碰。
- **定时任务**（`schedule/create|update` 新增）：鸿蒙侧还没有定时任务入口，属于独立功能，未在本轮范围内。

## 待办（下一轮）

1. `session/attachment` 带上 `attachment` 引用、容忍回显缺字段（Host ≥0.2.2 时必要）。
2. `workspaceFiles/read*` 现在严格限制在 cwd 内（协议 §文件读取）：核对鸿蒙侧「读主机图片 / 预览工作区外文件」的错误提示文案，避免误导。
3. 定时任务面板（`schedule/catalog|create|update|delete|history`）。
