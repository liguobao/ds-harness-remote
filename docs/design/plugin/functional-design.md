# Harness Remote Plugin 功能设计

状态：Draft v0.2
目标项目：`packages/plugin`

## 1. 受控业务接入面

Harness rc.2 会话业务只使用官方 `@deepseek-ai/dsh-host-apiproxy/api`；v0.1.2 alpha.1–rc.1 与 v0.1.5 rc.1 Session V3 会话业务只
使用官方 `TypertGateway` Remote carrier；可选文件预览只使用
`dsh-file-viewer` 暴露的 `fileViewerHost` 只读服务。Plugin 不读取或解释
`SessionStore`、`AgentRegistry`、Workspace 或 Approval 内部对象，也不把 Harness
事件重新投影成另一套 Remote Session/Message/Tool/Permission 模型。

```text
本地 Harness UI
  -> ApiProxySwitch (rc.2) / TypertGatewaySwitch (alpha)
  -> RemoteHarnessApiProxy / RemoteTypertGateway
  -> authenticated Remote channel
  -> HarnessApiBridge / HarnessRemoteBridge allowlist
  -> Host ApiProxy / TypertGateway
  -> 远端 Harness
```

rc.2 远端调用仍使用 Harness 原生 `RpcRequest`、`RpcResponse`、`MuxFrame`、`HostFrame`
和 `ClientResponse`；alpha 保持 Gateway 的 `{ endpoint, payload }`、RPC result、stream item
与 `$events` 语义。Plugin 只负责传输、关联、流生命周期与安全检查。

## 2. 模块结构

```text
packages/plugin/src/
  index.ts                    Cordis 生命周期与服务装配
  config.ts                   配置解析
  service.ts                  Host runtime
  identity-store.ts           设备身份和本地 trusted peer
  server-credentials.ts       device credential
  server-api.ts               Server REST client
  server-connection.ts        Host control/relay/Noise 连接
  connection-controller.ts    单一认证 peer 与业务通道
  rpc-router.ts               仅接受 capability 对应的 Harness tunnel RPC
  harness-api-bridge.ts       Host ApiProxy allowlist 与原生流
  harness-remote-bridge.ts    Host v0.1.2 Typert Remote allowlist 与 stream
  file-viewer-bridge.ts       File Viewer 只读方法白名单与传输限制
  remote-file-content-provider.ts Client 侧远端内容 provider
  remote-directory-browser.ts native picker 场景的只读目录元数据兜底
  remote-api-proxy.ts         Client 侧 ApiProxy 实现
  remote-typert-gateway.ts    Client 侧 alpha Gateway carrier
  api-proxy-switch.ts         Local/Remote 目标切换
  typert-gateway-switch.ts    alpha Gateway unary/stream/event 目标切换
  client-runtime.ts           Desktop Client runtime
  control-runtime.ts          loopback-only 设置与账号授权控制面
  client-secure-transport.ts  Client Noise IK
  client.ts                   Desktop Web client face
  logging.ts                  脱敏日志
```

不再存在 session/agent/workspace/permission adapters、Remote event sequencer、
replay buffer 或自定义 pending approval 状态机。

## 3. 插件生命周期

```ts
export const name = 'ds-harness-remote'

export function apply(ctx, config) {
  ctx.inject(['settings', 'connection', 'typertGateway'], runtimeCtx => {
    if (runtimeCtx.typertGateway supports alpha carrier) activate(runtimeCtx, config)
    else runtimeCtx.inject(['apiProxy'], legacyCtx => activate(legacyCtx, config))
  })
}
```

`apply(ctx, config)`：

1. 顶层 Bundle entry 立即完成激活，不把远端插件依赖变成 Harness 主服务的启动条件。
2. 在隔离的依赖 scope 中等待 `settings`、`connection` 和 `typertGateway`；alpha carrier
   可用时直接激活，否则继续等待 rc.2 `apiProxy`，避免依赖 bundle 行顺序。
3. 校验配置并按规范化 Server origin 选择隔离的身份目录。
4. 捕获不会经过 Local/Remote switch 的 Host `ApiProxy` 或 Typert Gateway dispatcher，为每条认证 Client connection 创建隔离的 allowlist bridge。
5. 创建常驻 Host runtime；Server、对应 Harness carrier 和 Web connection 可用时同时创建后台 Remote runtime。
6. 在 `ctx.effect()` 中启动出站 Server 连接，退出时关闭原生流、secure channel 和控制连接。

Plugin 不订阅 `session/created`、`session/event`、`agent/status` 或
`approval/request`。这些语义由 rc.2 ApiProxy mux/host + `respond()` 或 alpha 官方 `$events`
与 `$events/result` 原样承担。

## 4. Host Harness bridges

Remote 业务 RPC 只有：

- `harness.api.call`
- `harness.api.transfer.open/chunk/commit/read/close`（仅在 `harness.api.transfer.v1` capability 下）
- `harness.api.respond`
- `harness.api.stream.open`
- `harness.api.stream.close`
- `harness.remote.call`
- `harness.remote.transfer.open/chunk/commit/read/close`（仅在 `harness.remote.transfer.v1` capability 下）
- `harness.remote.stream.open`
- `harness.remote.stream.close`
- `harness.transport.describe`
- `fileviewer.call`（仅在 `fileviewer.read.v1` capability 下）

`harness.api.call` 的 `method` 必须命中代码内固定 allowlist。当前允许会话、子 Agent、
Workspace、Skill、Agent Preset、Goal、Host 描述和只读 LLM 目录等原生 UI 所需操作。
`commands.list` 与 `commands.execute` 经官方 Typert gateway 分发，以覆盖原生 UI 的
"+" 命令菜单。Remote 使用 Host 对当前 Agent 解析出的有效命令目录和 handler，因而与
本地 Harness UI 保持一致；它只能执行 Host 已注册的命令，不构成任意方法调用入口。

alpha `harness.remote.call` 与 stream 只转发官方 Gateway carrier envelope，endpoint 必须
命中代码内固定 allowlist。`$events` / `$events/result` 保持官方双向事件关联；
`directoryPicker/pick/createDirectory`、native open、动态 Cordis runtime/source 与未知
endpoint 均拒绝。alpha stream 上限为每连接 16 条，并用显式 `hasValue` 保留
`undefined` stream item。

`host.listDirectory` 是 Workspace picker 的唯一文件系统相关能力。优先转发 Harness browse
capability；若桌面 Harness 只提供 native picker，则 bridge 以只读实现返回同形状的单层目录
元数据。结果有数量上限，不包含文件内容，也不允许目录写入。

Harness `dsh-v0.1.1-rc.2` 图片仍使用官方 ApiProxy：Client 将图片内容放入
`session.prompt`，Host 持久化 attachment 并由 DeepSeek adapter 负责预处理、Files API 上传和
file id 复用；Client 通过只读 `session.attachment` 回读已被该 session 日志引用的图片以显示。
超过单条 secure message 限制的原生 request/response 走 `harness.api.transfer.v1`，每块 512 KiB，
严格有序、按连接隔离并设置总量/并发/空闲期限，不扩大 4 MiB secure message 上限。
alpha 保持同一官方 `session/prompt` 与 `session/attachment` 业务语义，并通过
`harness.remote.transfer.v1` 分块承载超限 Gateway envelope。

安装 `dsh-file-viewer` 后，`fileviewer.call` 复用它的 `fileViewerHost` 服务，只允许
`stat | readRange | list`。单次传输读取最多 512 KiB，目录最多 1000 项；Host 返回值再次做
schema 与大小校验。路径根与 locator 权限由 File Viewer provider 执行，Remote 不绕过该边界。

明确禁止：

- `settings.openDocument` 以及对 Host 实时注册目录之外命名空间的 settings 写入；credentials 只允许官方全局引用语义下的有界 describe/set/unset，值只写且不得进入日志或响应；
- native path open/picker；
- 绕过 File Viewer provider 的文件访问、目录创建/修改/删除或通用文件系统 RPC；
- File Viewer `openExternal`、文件写入、上传与执行；
- attachment upload、download；`session.attachment` 只读回读除外；
- 任意 Cordis service、Harness tool 或反射调用。

Host 可同时服务来自不同 `clientDeviceId` 的连接；RPC pending、stream namespace 和 stream
上限均按 `connectionId` 隔离。每条连接最多打开三个原生流（host、当前 mux、mux 切换缓冲）。同一 Client 设备重连只替换
它自己的旧连接；连接替换、撤销或断开时，只 abort 该连接的 mux/host iterator。Plugin
卸载时才关闭全部连接和流。

## 5. Client Harness transport

`RemoteHarnessApiProxy` 实现与本机相同形状的 `ApiProxy`：

- unary method 转成 `harness.api.call`；
- 大图片 prompt 和 attachment response 使用 transfer wrapper 分块搬运同一原生 envelope；
- `respond()` 转成 `harness.api.respond`；
- `events.mux()` / `events.host()` 转成远端 stream open/close；
- 原生 `rpcId` 保持不变，Remote envelope id 只负责隧道层关联。

`ApiProxySwitch` 向官方 Web UI 暴露稳定对象。选择 Remote 后所有新调用解析到远端
proxy；连接意外关闭时立即回落 Local 并结束旧流。

alpha 的 `RemoteTypertGateway` 对等承载 unary、stream 与 `$events/result`；
`TypertGatewaySwitch` 同时切换 Gateway 的公开 invoke/stream 和 Connection/WebSocket mux
实际调用的 carrier methods。Host bridge 始终使用安装 switch 前捕获的本地 dispatcher，
避免 Remote 目标递归调用自身。

Noise channel 建立后 Client 调用 `harness.transport.describe`。旧 Host 返回
`METHOD_NOT_FOUND` 时按 rc.2 `clientVersion` 降级；新 Host 明确返回 ApiProxy/Remote Gateway
能力。两端 carrier 代际不同则在 Workspace create 或 UI target switch 前返回
`HARNESS_VERSION_INCOMPATIBLE`，当前不翻译 rc.2 与 alpha 的完整业务模型。

Desktop UI 不提供 Client 模式切换。侧边栏始终只有一个 Remote 工作区入口：

- 设备列表过滤本机 Host deviceId；
- 展示规范化系统名称、Harness 版本、Plugin 版本与在线状态；
- 选择已有 Workspace，或浏览远端目录后调用 `workspace.create`；
- Remote 激活后显示独立顶部 Header、连接链路、端到端加密说明和退出链接。

## 6. 安全连接

业务桥只在以下条件全部成立后可见：

- Server active membership 与目标连接一致；
- 双方账号授权的 peer descriptor 与本地 pinned key 完全一致；
- Noise IK transcript 成功绑定 connectionId、Host 和 Client；
- relay counter 连续且密文认证成功。

Server 只看到控制元数据和 ciphertext。Host 不监听公网端口。

## 7. 权限语义

Approval 和 Question 在 rc.2 使用 ApiProxy 原生 mux `ServerRequest` / `ClientResponse`，
在 alpha 使用官方 `$events` waterfall / `$events/result`。Plugin 不创造第二套 permission id、
decision enum 或超时状态机。

Host Harness 仍是唯一权限裁决者。rc.2 Plugin 只允许回答当前原生流实际发出的 rpcId；
alpha 的 eventId/clientId 关联由官方 Gateway 验证。状态按 `connectionId` 隔离，晚到、重复
或格式错误的回答由 Host 官方 carrier 拒绝。连接断开会关闭原生流，
不能继续提交旧回答。

## 8. 核心测试

- ApiProxy allowlist 允许预期方法并拒绝敏感方法。
- Typert Remote endpoint allowlist 拒绝 native open、目录写入、动态 Cordis 与未知 endpoint。
- unary response 保留内层 rpcId。
- mux/host 与 alpha stream frame 转发、显式 `undefined` item 和 close reason 正确。
- 未认证、错误 identity/membership、篡改和重放 fail closed。
- peer 替换或断开时关闭全部原生流。
- Local/Remote switch 可逆，远端断开回落 Local。
- File Viewer 只允许 stat/list/受限 range read，超限和未安装依赖 fail closed。
- Host/Client account token 与 device token 隔离，主机匹配码单次消费，refresh single-flight。

Android 和 VS Code Client 使用相同 rc.2 ApiProxy / v0.1.2 Typert Remote capability 探测；其 UI 和生命周期独立，不构成 Desktop Plugin 的组件兼容要求。
