# DSH Go 对话备份与同步接入指南

DSH Go 可以把一台 Harness Host 上的普通对话备份到手机，再恢复到原 Host 或另一台 Host 的已有工作区。也可以在两台 Host 同时在线时直接转发。本文约定 DSH Go 侧的接入方式，Host 使用现有的 `session.transfer.*` RPC。每次恢复都会创建新会话；源会话后续产生的消息需要再次备份。

## 配对与选择

按 [DSH Go 扫码配对协议](device-pairing-v1.md)完成配对，通过已认证的 Noise 连接调用 `harness.transport.describe`。备份需要源端声明 `session.transfer.export.v1`，恢复需要目标端声明 `session.transfer.import.v1`，分别检查即可。用对应 Host 的 `workspace/follow` 首帧列出可选工作区，用源工作区的 `sessionIds` 和 `session/list` 展示对话。

## 备份到手机

下列方法名均省略 `session.transfer.` 前缀。

1. 调用 `export.open({scope: {kind: "session", sessionId}})`。备份整个工作区时传 `{scope: {kind: "workspace", workspaceId}}`。保存返回的清单，每项的 `throughSeq` 是此次包含的事件序号上界。
2. 逐条处理清单。从 `offset = 0` 调用 `export.read({handle, sessionId, offset})`，确认返回偏移一致，将 `data` 按标准 Base64 解码，顺序写入临时文件。按实际写入的压缩字节数推进偏移。
3. 末块包含 `totalBytes` 和小写十六进制 `sha256`。核对整个 gzip 文件的长度和 SHA-256，再发布该条备份。建议清单记录源 Host 身份、源工作区和会话 ID、`throughSeq`、格式版本 1、文件引用、长度与摘要。整批中断时只把已校验的条目标为可恢复。
4. 结束时调用 `export.close({handle})`。若读取中断，丢弃未完成文件，重新打开导出并从零读取该会话，以新清单为准。对话文件含用户内容，应放在应用私有存储并使用平台提供的静态加密保护，日志仅记录状态。

## 从手机恢复到 Host

1. 让用户选择目标 Host 上已有的工作区。校验本地文件长度和摘要，为本批生成唯一 `batchId`，每条会话生成独立 `requestId`。
2. 逐条调用 `import.open({workspaceId, batchId, sourceSessionId, formatVersion: 1})`，使用目标端返回的句柄。从零开始按返回的 `chunkBytes` 切分 gzip 文件，每块单独编码为标准 Base64，调用 `import.chunk({handle, offset, data})`。收到 `receivedBytes` 等于该块结束偏移的确认后再发送下一块。
3. 收齐后，先持久记录目标 Host、设备身份、`batchId`、`requestId` 和待确认状态，再调用 `import.commit({handle, requestId, totalBytes, sha256})`。保存返回的目标 `sessionId`。若 `workspaceAttached` 为 false，显示“历史已恢复，未加入工作区”及目标会话 ID，避免重复导入。
4. 提交前取消可调用 `import.abort({handle})`。上传断线后重新打开导入并从零上传。若提交已发出但结果丢失，以同一设备身份重连目标 Host，调用 `import.status({batchId, requestId})`。`completed` 按成功结果处理；查询返回原提交错误时展示该错误。结果只在 Host 进程内保留五分钟，遇到 `unknown` 标为“结果待核对”，让用户检查目标端，停止自动重提。

## 两台 Host 直接同步

分别连接两端，对每条会话把源端 `export.read` 的 Base64 数据原样传给目标端 `import.chunk`，以下一条目标端确认的压缩偏移继续读取。末块确认后使用源端给出的长度和摘要提交。DSH Go 可记录源 Host、源会话、已复制的 `throughSeq` 与目标会话 ID，提示哪些对话已有副本。再次复制更新过的对话会生成另一份完整快照，目标端已有历史保持独立。

## 范围与限制

单块最多 256 KiB，单会话压缩前后各限 8 MiB、最多 50,000 个事件，工作区导出最多接受 2,048 条候选会话。工作区导出跳过子会话与无可复制轮次的会话。附件文件、跨会话关系和工作区源码不在备份内。导入时 Host 将工作目录事件映射到目标工作区。完整字段与生命周期见[线协议](protocol.md#跨机器会话传输)。
