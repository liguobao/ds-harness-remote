# 跨机器对话导入导出

首版支持 Harness → Harness。用户可以复制单个对话，也可以复制工作区的对话。源端只读，目标端在用户选定的已有工作区创建新会话。工作区范围仅包含已完成的普通会话历史，代码、配置及附件文件本体留在各自机器。

## 现有查询接口

以下接口通过官方 Typert carrier 调用。

| 接口 | 用途 |
| --- | --- |
| `workspace/follow` | 无入参。首帧 `baseline.value.items` 返回工作区列表，每项含 `workspaceId`、`title`、`path` 和有序 `sessionIds`。源端和目标端各查一次。 |
| `session/list` | 返回会话摘要 `items`。用 `sessionId` 关联工作区成员，补充标题、运行状态和更新时间。当前请求类型只有可选 `cursor`，没有工作区筛选参数。 |
| `session/events`、`session/page` | 用于查看指定会话历史。前者可通过 `address: { kind: 'session', sessionId }` 指定会话，后者用于分页。 |

工作区范围由源 Host 按 `workspaceId` 从官方工作区成员关系解析。Remote 的 `session/list` 超过 2,048 行会裁剪，历史响应也可能应用展示精简。实际导出直接读取源 Host 上官方的已提交历史。

## 传输接口

Host 插件提供接口。启用前通过 `harness.transport.describe` 分别确认源端导出能力和目标端导入能力。字段以[线协议](../protocol.md#跨机器会话传输)为准。

| 接口 | 关键入参 | 结果 |
| --- | --- | --- |
| `session.transfer.export.open` | `scope` 为 `{ kind: 'session', sessionId }` 或 `{ kind: 'workspace', workspaceId }` | 返回导出句柄及固定的会话清单。每项含源会话 ID及历史截止位置。 |
| `session.transfer.export.read` | 导出句柄、源会话 ID、分块偏移 | 按顺序返回 gzip 数据块。末块带压缩总字节数和 SHA-256。 |
| `session.transfer.export.close` | 导出句柄 | 释放源端读取及压缩资源。 |
| `session.transfer.import.open` | 目标 `workspaceId`、`batchId`、源会话 ID、格式版本 | 验证目标工作区并返回上传句柄和分块上限。 |
| `session.transfer.import.chunk` | 上传句柄、偏移、压缩数据块 | 返回目标端已接收字节数。 |
| `session.transfer.import.commit` | 上传句柄、`requestId`、压缩总字节数、SHA-256 | 校验后创建新会话，返回新 `sessionId` 和导入提示。 |
| `session.transfer.import.status` | `batchId`、`requestId` | 查询提交结果，供提交响应丢失后恢复。 |
| `session.transfer.import.abort` | 上传句柄 | 取消未提交的上传并释放资源。 |

## 数据与提交行为

- 源 Host 在打开导出时固定成员清单和每条会话的已完成轮次截止位置。逐条序列化，并在源 Host 内存中做有界 gzip 压缩。Client 通过现有 Noise 加密通道分块转发，无需在源机器生成 ZIP 或落盘。分块连同封装须低于单条安全消息的 4 MiB 上限。
- 目标 Host 检查工作区权限、分块偏移、压缩体积和 SHA-256，并限制解压字节数与事件数量。数据齐全且校验成功后才创建会话。临时传输句柄绑定已认证连接，断线或超时后释放未提交资源。
- 目标 Harness 为每条导入会话分配新 ID，使用目标工作区及本机模型配置。历史工具结果可作为上下文。导入流程只恢复历史数据，源端审批、工具操作及终端输入均无执行语义。
- 工作区批量导入按会话提交，成功项保留。提交结果在目标 Host 进程内按设备、批次和请求 ID 保存五分钟，供 Client 重连后查结果。
- 目标端使用 Harness 的会话准备服务校验事件，再通过持久化服务写入新会话，由工作区服务附加成员关系。附件文件、子会话和跨会话关系目前不迁移。
