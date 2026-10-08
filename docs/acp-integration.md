# Agent 工作区接入指南

本指南说明如何启用已支持的后端，以及新增 ACP adapter 需要修改的接入点。
当前支持 Cursor、Antigravity（AGY）与 Codex。Cursor / AGY 使用 `agent.acp.*`；Codex 保留独立的 `codex.app.*` App Server 数据面。

## 启用已有后端

1. 在 Host 安装对应 CLI，完成其本机授权，并确认命令能运行：Cursor 使用 `agent`，AGY 使用 `agy`，Codex 使用 `codex`。
2. 打开 Host 的 **Remote 设置 → Agent 后端**，检测对应命令；需要时设置绝对命令路径。
3. 开启所需后端并保存。配置热生效，仅更新变化的后端，无需重启整个 DSH；CLI 可发现不代表已登录或协议就绪。
4. 在 Client 登录同账号，选择在线 Host，再选择已就绪的后端工作区。Desktop 与 Android 使用现有工作区/会话界面。

Codex 默认开启，Cursor 默认关闭；AGY 以 Host 配置为准。未就绪的后端不能自动替换为其他后端。
工作目录须在 Host 上已存在；Codex 新增 Project 仅注册真实目录，不创建目录或写入 Harness 存储。

| 后端 | Host 接入 | 使用范围 |
| --- | --- | --- |
| Cursor | `agent acp` stdio | 文字 Prompt、流式回复、中断、单次审批 |
| AGY | `agy --input-format stream-json --output-format stream-json` adapter | 工作区/历史、文字与受限图片、流式回复、模型选择 |
| Codex | `codex app-server` stdio | Project/Thread、历史、文字/图片、模型/权限、中断与审批 |

AGY 图片每张最多 8 MiB、每次最多 4 张，写入 Host 专用私有 tmp 缓存，保留 24 小时；系统提前清理 tmp 后图片可能不可用。
工具可用性以 Host capability 和会话 scope 为准。最新工具、AGY 加密跨设备链路、Windows、APK/真机与长期稳定性仍有待验证项，见 [TODO](TODO.md)。

## 实现方式

```text
Desktop / Android 的内存工作区与会话投影
  -> 已认证、端到端加密 Remote channel
  -> Host 每连接 bridge / RPC / stream / transfer
  -> ACP gateway -> Cursor / AGY adapter
     或 Codex domain -> App Server
```

Client 不读取本机 AGY 数据库或 transcript，不写 DSH SessionStore、Workspace 数据库或 Harness 日志。
Host 决定工作目录与会话归属；capability 表示协议支持，`workspaceTypes.available` 表示实际就绪，两者都满足才开放工作区。
独立 Remote Web runtime 在 Server 仓库维护，本仓库浏览器兼容投影不等于跨站点验收。

## 新增 ACP 后端

仅向 `acp.backends` 添加 command/args 不会自动实现 adapter。当前 gateway 明确识别 Cursor / Antigravity，不按可执行文件名称猜测后端。

1. **实现进程 adapter**：参考 [adapter.ts](../packages/plugin/src/acp/adapter.ts) 的 `start / close / isReady / call / respond / respondError / onInbound / onUnavailable` 契约，在 `acp/adapters/` 实现固定后端 ID、请求关联、通知与退出清理。原生 ACP 可参考 Cursor；其他协议需像 AGY 一样明确适配。
2. **注册 Host 生命周期**：在 [gateway.ts](../packages/plugin/src/acp/gateway.ts) 接入后端创建、支持列表、后台启动、就绪检测和 reconfigure。关闭时取消启动，迟到初始化不能重新注册；不可用后端不能静默降级。
3. **定义安全契约**：在 [method-policy.ts](../packages/plugin/src/acp/method-policy.ts)、共享 Protocol 和 [协议](protocol.md) 同步固定方法、字段、backend capability、工作区/会话 ID 和限额。按连接隔离 stream、transfer 和审批；不扩大 Harness 或 Codex allowlist。
4. **接入工作区与展示**：在 Host 实现 backend 明确的 catalog 和 session scope，Client 只消费 Host 接口。更新 [虚拟 carrier](../packages/plugin/src/acp/virtual-harness.ts)、Client 类型/就绪判断和 Android 内存投影；不引入 Node 依赖到浏览器，不写 Harness 持久化。
5. **接入可选能力**：历史、图片、模型和只读文件/终端分别声明 capability。工作区工具必须使用 Host 验证的会话根、固定 endpoints 与终端输入权，不能接受任意 Client cwd 或通用文件上传。
6. **验证核心边界**：覆盖 allowlist、后端/会话归属、权限、RPC/事件顺序、启动中关闭和断线恢复；真实跨设备、目标 runtime 和 CLI 验收单独记录。展示、文案、布局不单独新增测试。

新增后端是源码开发工作，不能把未经实现的注册项列成已支持产品。Codex 继续使用独立领域，当前不迁入 ACP gateway。

## 参考文档

- [ACP Remote 技术说明](acp-remote.md)：方法、配置、图片与后端生命周期。
- [Codex Remote 技术说明](codex-remote.md)：App Server、Project authority 与投影。
- [Plugin 功能设计](design/plugin/functional-design.md)：共享认证、工具、配置与恢复。
- [Remote Protocol](protocol.md)：线协议、capability、scope 和限额的权威来源。
