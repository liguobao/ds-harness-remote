# 跨机器会话传输接入指南

客户端可以把单个 Harness 对话或一个工作区内的普通对话复制到另一台 Host。源端只读，目标端在选定的已有工作区创建新会话。当前由 Host 插件提供 RPC，接入方负责选择界面和两台 Host 之间的数据转发。

## 选择来源和目标

1. 客户端分别建立到源 Host 和目标 Host 的加密连接。调用 `harness.transport.describe`，确认源端支持 `session.transfer.export.v1`、目标端支持 `session.transfer.import.v1`。
2. 两端分别调用 `workspace/follow`，从首帧读取工作区 ID。源工作区的 `sessionIds` 可用于展示成员，`session/list` 可补充标题和状态。
3. 用户选择一条源会话或一个源工作区，并选择一个目标工作区。以 `session.transfer.export.open` 返回的清单作为本批实际复制范围，目标工作区 ID 始终取自目标 Host。

## 转发并提交

1. 向源端发起 `export.open`。整工作区和单会话使用同一条传输流程，区别在于导出范围。
2. 为本批分配一个 `batchId`。针对清单中的每条会话，向目标端发起一次 `import.open`，并为后续提交保留一个唯一的 `requestId`。
3. 从压缩字节偏移 0 开始调用源端的 `export.read`，把每块 Base64 数据原样交给目标端的 `import.chunk`。下次读取使用目标端确认的 `receivedBytes`，其中记录的是压缩字节数。源 Host 负责 gzip 压缩，客户端无需解压。
4. 读到带总字节数和 SHA-256 的末块后，等待目标端确认收齐，再提交 `import.commit`。返回的 `sessionId` 属于目标 Host。若 `workspaceAttached` 为 `false`，保留并展示该会话 ID，提示历史已写入但工作区归入失败。
5. 按会话汇总结果。取消未提交的上传时调用目标端的 `import.abort`，完成或放弃本批时调用源端的 `export.close`。

## 处理断线

- 上传阶段断线后，旧连接的句柄失效。若尚未发起提交，重新打开传输并从偏移 0 开始。
- 提交请求已经发出但响应丢失时，用同一设备身份重连目标端，按原 `batchId` 和 `requestId` 调用 `import.status`。Host 进程内的结果保留五分钟。
- 收到 `unknown` 时提示结果无法确认，并让用户先检查目标工作区。客户端应停止自动重提，以免创建重复会话。

首版复制普通会话的历史，附件文件、子会话和跨会话关系暂不迁移。字段、大小限制与返回值见[线协议](protocol.md#跨机器会话传输)。
