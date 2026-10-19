# ACP Remote / Agent adapter 技术说明

本文记录 Remote 内通用 Agent ACP gateway（#65）与 Cursor backend adapter 的边界。
线协议以 [Remote Protocol v1](protocol.md) 为准。

## 定位

Host Plugin 提供 backend-neutral 的 **Agent ACP gateway**：

```text
ACP Client
  -> 已认证 Remote channel（agent.acp.*）
  -> Host ACP gateway
  -> Cursor `agent acp` adapter（本阶段）
```

- 公共 capability / RPC：`agent.acp.v1`、`agent.acp.*`
- Host 配置键 `cursor.enabled` / `cursor.binary` 只控制 **Cursor adapter**，不是线协议名
- 按 Remote connection 隔离；编译期固定 allowlist；未授权 method fail closed
- 现有 `codex.app.*` 保持不变；**暂不**把 Codex 迁到 ACP adapter

## 启动与后端配置

`acp.enabled` 控制 gateway；`acp.backends` 内各后端独立使用 `enabled`、`command`、`args`、
可选 `cwd`。当前支持 `cursor` / `antigravity` / `pi` / `opencode` / `claude`，不按 binary 名称推测 adapter，也不把不可用后端的
请求转发到其他后端。仅配置旧 `cursor` 字段时，只启用 Cursor。

对于 `opencode`，Host 运行 `opencode acp` 子进程接入标准 ACP 协议，采用标准 `initialize` 握手（避免发送 Cursor 私有 `cursor_login` 鉴权方法）。默认优先探测官方安装位置的 `~/.opencode/bin/opencode`、`~/.local/bin/opencode` 及系统 PATH。独立 capability 声明为 `agent.acp.opencode.v1`。工作区目录来自标准 `session/list` 返回的 cwd，历史通过独立临时进程的 `session/load` 回放生成，不写入 Harness SessionStore。

启动前通过同一命令的 `--help` 检测参数能力，不硬编码主版本号。仅当 CLI 同时声明
`--hostname`、`--port`、`--mdns` 时追加私有 loopback 参数并启用原生归档；三者均不支持时
移除这些旧网络参数，仅通过 stdio ACP 工作。检测失败、输出超限或仅支持部分参数时显式
返回 `OPENCODE_CLI_PROBE_FAILED`，不猜测监听地址或盲目重试另一套参数；关闭后端会取消检测。
官方 v1 使用 npm `opencode-ai`，v2 使用 `@opencode/cli`。已分别以真实 `1.19.3` / `2.0.32`
验证 Host 本地 ACP 主流程；v2 的内部私有服务不开放网络端口，详见
[官方 ACP 文档](https://opencode.ai/v2/docs/cli/acp/)。这不等同于跨设备或 Prompt 验收。

Cursor/Claude 的 Desktop/Android 模型选择读取真实会话 catalog，并等待上游确认。Cursor 为避免进程级模型设置串会话，每个活动会话使用独立进程。Claude 显示名统一为 Claude，工作区与历史投影见 [接入说明](acp-integration.md)。

ACP 在后台启动，各后端独立初始化，不阻塞 Harness Remote 注册和 Client 初始化。
能力声明表示已启用的协议支持，`workspaceTypes.available` 表示实际就绪；关闭期间会清理
正在启动的 CLI，迟到的初始化结果不得重新注册实例。后端配置保存后立即生效，仅更新发生变化的后端。

设置页根据 Host 上配置的命令及运行时支持的候选位置检测后端是否可发现。
检测不可用时工作区开关显示关闭并禁用；手动检测失败会保存该后端的关闭状态，
并立即更新 Host 运行时，适用于 Cursor、AGY、CodeX 和自定义 ACP 条目。
重新检测通过后可以手动开启，不自动恢复为开启。命令可发现不代表已登录或协议就绪，
真实 Remote 可用性仍以 `workspaceTypes.available` 为准。

AGY 会话发现按数据库中的 file URI 解码后与项目目录完整匹配，支持编码目录名和
原生路径分隔符。指定目录缺少数据库归属信息时返回空列表，不把所有 transcript
推测为该目录的会话。历史读取限制在 AGY brain 内的真实 transcript，拒绝越界 ID
和符号链接。切换会话后，客户端丢弃迟到的历史与订阅结果。

## 公共方法（allowlist）

| 方法 | 用途 |
| --- | --- |
| `initialize` | Gateway 返回能力描述（不转发 Cursor 私有 initialize） |
| `session/new` | 在 Host 上已存在的绝对目录创建会话（强制 `mcpServers: []`） |
| `session/load` | 恢复会话 |
| `session/prompt` | Cursor 文本 Prompt；AGY 文本/受限图片 Prompt |
| `session/cancel` | 中断 |
| `dsh/directoryList` | Host 只读单层目录浏览（选 cwd；Remote 扩展） |
| `dsh/workspaceList` | 指定后端的 Host 工作区发现 |
| `dsh/sessionList` | AGY 持久化会话发现 |
| `dsh/sessionHistory` | 历史读取（有界 ACP transfer） |
| `dsh/sessionArchive` | OpenCode 原生归档；要求独立 capability |

线 RPC：`agent.acp.call|respond|stream.*|transfer.*`<br>
事件：`agent.acp.frame` / `agent.acp.stream.closed` / `agent.acp.catalog.changed`

## OpenCode 原生归档

Desktop/Android 的 OpenCode 归档经 `dsh/sessionArchive` 直接调用同一个 Host
`opencode acp` 进程的原生 HTTP API，设置 `time.archived`，原生确认后才移除默认目录成员。
Host 声明 `agent.acp.opencode.archive.v1`，成功后以 `agent.acp.catalog.changed` 同步其他连接。
归档状态由 OpenCode 持久保存，Host 重启后仍隐藏；历史保留可读。活动回复、加载、模型写入和
待审批时拒绝归档，不隐式停止或删除会话。其他 ACP 后端尚无原生归档，不返回本地伪成功。
纯 stdio ACP 构建没有可用的私有 HTTP API 时返回 `OPENCODE_ARCHIVE_UNAVAILABLE`，
会话列表与历史直接使用标准 ACP，不尝试访问未启动的 HTTP 端口。
当前不提供恢复或已归档列表；实现和上游版本边界见[原生归档设计](design/acp-session-archive.md)。

## Web 兼容边界

共享浏览器投影接收标准 `session_info_update.title`。OpenCode 的标题生成独立于回复，
V2 ACP 未必转发原生 rename，因此回复后以有界重试在二十秒内恢复列表标题；关闭投影
取消重读。`New session - <ISO 时间>` / `Child session - <ISO 时间>` 视为占位，
原生标题缺失时仅在内存中使用首条提问前 60 个字符，打开历史时同样恢复；后续正式标题
可替换临时标题，但占位、迟到读取不能覆盖较新的投影，手动改名优先。不写 OpenCode
或 Harness 数据库。独立 Remote Web 需同步该投影后部署，不能视为线上已生效。

Web、Desktop 和 Android 共用独立 `agent.acp.*` RPC / stream / transfer / event。
`dsh/` 扩展只存在于 ACP call 内，不注册到 Harness 或 Codex 业务 API。
`virtual-harness.ts` 是可在浏览器使用的内存 UI 投影，不读取本机 AGY 文件；工作区和历史
由 Host ACP 返回。AGY 工作区仅接受 `antigravity:cwd:` ID，不兼容旧 `cursor:cwd:` ID
或无前缀路径。Cursor / AGY 分别需 `agent.acp.cursor.v1` / `agent.acp.antigravity.v1`；
`agent.acp.v1` 仅表示公共数据面，不据此推断后端。ACP 尚未发布使用，不增加旧配置或 ID 迁移。
独立 Remote Web runtime 的接入和跨设备 E2E 仍待在独立 Server 仓库验证。

## 配置

Cursor adapter 默认**关闭**。开启前请在 Host 本机完成 `agent login`，或配置
`CURSOR_API_KEY`。也可在 Desktop 插件设置中切换开关（立即生效）。

```yaml
ds-harness-remote:
  cursor:
    enabled: true
    binary: agent   # 或 ~/.local/bin/agent 的绝对路径
```

## 实现入口

| 路径 | 作用 |
| --- | --- |
| `packages/plugin/src/acp/gateway.ts` | ACP gateway / 会话归属 / 审批 |
| `packages/plugin/src/acp/method-policy.ts` | 公共 allowlist |
| `packages/plugin/src/acp/peer-bridge.ts` | 每连接 stream / transfer |
| `packages/plugin/src/acp/adapter.ts` | backend adapter 契约 |
| `packages/plugin/src/acp/adapters/cursor-process.ts` | Cursor `agent acp` stdio |
| `packages/plugin/src/acp/adapters/cursor.ts` | Cursor adapter 工厂 |
| `packages/plugin/src/acp/adapters/opencode-process.ts` | OpenCode `opencode acp` stdio |
| `packages/plugin/src/acp/adapters/opencode.ts` | OpenCode adapter 工厂 |
| `packages/plugin/src/acp/virtual-harness.ts` | Desktop Virtual Harness（cwd → Workspace / Session / Composer） |
| `packages/client-core/src/acp-client.ts` | 共享 Client（`AgentAcpClient`） |
| `packages/plugin/src/client-runtime.ts` | 探测独立后端 capability 和就绪状态、打开 Virtual Harness |
| `packages/plugin/src/client.ts` | Remote 模态框列出 / 添加 Cursor 工作区 |

## Desktop 使用

1. Host：设置中开启 **Agent 后端 → Cursor**（`acp.backends` 的 `cursor.enabled`），完成本机 `agent login`，保存后立即生效。
2. Client：侧栏 Remote → 选择在线 Host → 在 **Cursor virtual workspace** 分组点 `+`，浏览并确认 Host 上已有绝对目录。
3. 打开后复用原生 Workspace / Session / Composer；会话 id 形如 `cursor:<acpSessionId>`，不写入 DSH SessionStore。

## Android Client

内存投影（不写入 SessionStore）：

1. 探测 Host capability `agent.acp.cursor.v1` 并确认工作区类型就绪后启用 Cursor 工作区分组。
2. 新建 Cursor workspace = 选择 Host 上已有绝对目录；会话经 `AgentAcpClient`（`agent.acp.*`）创建与流式更新。
3. 文本 Prompt / cancel / approval（`allow-once` | `reject-once`）；暂不支持图片。
4. Workspace backend id 仍为 `'cursor'`（仅 UI）；线协议为 `agent.acp.*`。

## 验证状态

- [x] Host gateway、capability、RPC 路由（`agent.acp.v1`）
- [x] Cursor adapter initialize + authenticate（Host 本地）
- [x] Client `initialize` 公共面（gateway 短路）
- [x] 方法策略单测
- [x] Desktop 设置开关 `settings.cursor.set`（adapter）
- [x] Desktop Virtual Harness（cwd workspace + session/prompt/stream/approval）
- [x] Android Client 投影（`AgentAcpClient` / 内存 Cursor workspace）
- [x] Android 真机：文本 Prompt、思考/正文流式帧、`prompt_completed` catch-up、多轮气泡分离
- [ ] Desktop ↔ 异机 Client 完整 E2E（审批 / cancel / 长工具轮次）
- [ ] 断线重连后 stream 重建与会话内 History 恢复
- [x] Android：重连保留 Cursor 会话并自动重建 ACP stream
- [ ] `session/load` 与跨设备会话列表体验

## 近期后续（不含 Codex→ACP）

1. Android / Desktop：transport 抖动后自动 `stream.open` + `claimSession`
2. Host 侧按 session 保留可分页的展示用 History（不写 DSH SessionStore）
3. 审批 / 提问 UI 与 `agent.acp.respond` 真机矩阵
4. 跨机长时间稳定性与 WebRTC/Relay 丢帧回归

## Android AGY (2026-10-07)

Android 的 `antigravity` 工作区独立使用 AGY catalog/history/prompt 与 ACP stream。首次连接
和刷新均发现 Host 既有目录与会话；新建会话保持空白，回复后更新标题，重连重新加载历史并
订阅 stream。图片通过私有 tmp 缓存与有界 ACP transfer；不调用 Harness Prompt 或写入
SessionStore。批量读取列表不触发预热，选中目录才预热。Hermes 打包及真实 AGY 的
in-process 数据链路已验证；Android 真机与加密跨设备验收尚未完成。
