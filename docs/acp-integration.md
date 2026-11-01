# Agent 工作区接入指南

本指南说明如何启用已支持的后端，以及新增 ACP adapter 需要修改的接入点。
当前支持 Cursor、Antigravity（AGY）、Pi Agent、OpenCode、Claude 与 Codex。Cursor / AGY / Pi / OpenCode / Claude 使用 `agent.acp.*`；Codex 保留独立的 `codex.app.*` App Server 数据面。

### Pi Agent（Issue #97，实验性）

在 Host 运行 `npm install -g @earendil-works/pi-coding-agent pi-acp`。先通过 `pi` 配置模型与授权并完成本机对话；Remote 默认自动检测并初始化 Pi Agent，成功后开放工作区。未安装或初始化失败时不可用，不影响其他后端；明确设置 `enabled: false` 或关闭 ACP 总开关时不启动。Remote 设置 → Agent 后端可关闭 Pi Agent。默认命令为 `pi-acp`，参数为空；`pi` 本身的 RPC 模式不是 ACP，不能将命令直接替换为 `pi`。

OpenAI 兼容端点通过 Pi 用户目录的 `models.json` 配置 `baseUrl`、`api`（如 `openai-responses`）和模型；密钥使用 Pi 私有凭据、环境变量或私有 credential command，不放入 Remote 配置。参考 [pi-acp 上游说明](https://github.com/svkozak/pi-acp)。

Pi 工作区使用 `pi:cwd:`，会话展示使用 `pi:`，需要 `agent.acp.pi.v1`。Host 通过标准 ACP `session/list` / `session/load` 发现目录、恢复历史，不读取 Client 本机的 Pi 文件。每个活动会话使用独立 wrapper，历史读取另用临时 wrapper，避免上游加载会话时关闭其他会话。Client 断线只释放订阅及归属，运行中的回复继续；恢复后从 Host 重新读取历史。不写 Harness SessionStore 或 Workspace 数据库。每个 Host Pi adapter 最多保留 30 个活动/已加载会话，另保留 catalog 与一个历史读取槽；达到配额显式失败，可在 Host 关闭后端并重新启用以清理进程。历史最多 8 MiB / 10,000 条 ACP 更新，超限报错而非静默截断。

首版文字 Prompt、流式回复、Tool Call、中断与历史恢复通过 ACP 接入；Pi 工具按 Host 用户权限执行，不承诺额外的 Remote 工具审批隔离。模型与 Thinking 选项只来自适配器的实际 catalog，使用现有 `dsh/sessionModels` / `dsh/selectModel`，不向 Harness/Codex 添加端点。Windows、独立 Remote Web、Android 原生及加密跨设备验收需另行完成。

#### Pi 工具审批与历史读取边界

- Pi 默认使用 Host 用户的 OS 权限，**不会自动对每个内置工具请求审批**。若 Host 的 Pi 扩展在 `tool_call` 中等待 `ctx.ui.confirm`，pi-acp 会转成 `session/request_permission`；Remote 仅允许单次允许、拒绝或取消，按本次上游选项 ID 回传，不提供会话级永久授权。普通 Prompt 不会自动为 Pi 安装审批扩展。Pi 扩展 `select` 若把多个选项都编码为 `allow_once`，当前单次审批契约无法安全区分，保持拒绝，不把选择菜单伪装成工具授权。
- 本机真实 Gateway / Pi / 扩展确认链已验证（包括 `gpt-6-sol` 实际发起的 bash 工具调用，两种决定均正常结束回复）：拒绝不执行、允许一次只执行一次；另一连接不能抢答且不消费合法句柄；待审批时断线不放行，消费/断线后的句柄不可重放。这不是加密跨设备或原生 UI 验收。
- 历史从 Host 的有界 transfer 读取，用户/助手文本及工具结果映射为原生事件；工具调用和输出分开，保留失败状态、bash terminal 输出，连续文本 chunk 合并。目录/历史读取失败不能当成成功的空列表或空对话，也不能因此偷偷新建会话；并发读取同一会话历史共用一次请求。
- `pi-acp@0.0.34` 的 `session/load` 不重放原始 thinking、原始消息 ID/时间或完整工具输入。Remote 不读取 Pi 私有文件来绕过协议：使用稳定的投影消息 ID，未知时间记为 `0`，不宣称无损恢复。实时 Pi bash 输出预览最多保留 1,048,576 个字符，超限显式提示通过有界历史重新读取，而不是伪装为完整输出。
- 已用本机真实模型验证 Gateway → ACP Client → Desktop 内存投影的实时 read/bash 输出与 write diff、进程重启后的历史/分页与继续对话；Android 核心接入测试不等于 APK/真机验收。标准 catalog 的 `nextCursor: null` 也作为正常结束处理，不误报空目录或协议异常。

#### 恢复与重配的竞态边界

- Pi 初次 `session/load` 的文本、思考和工具通知属于历史回放，不发布至实时 stream；只合并匹配会话、上游确认的模型/Thinking 配置。load 期间的 callback 直接拒绝，加载成功后才接受 live 通知和审批。
- Android Pi/AGY 打开会话时不复用旧展示缓存作为新订阅的基线；有界历史返回后合并本次订阅期间收到的实时文本、工具及完成 catch-up，不用打开前的 `running` 值覆盖它们。历史失败显式报错；缺少共同 cursor/原始消息 ID 时只做有 ID/工具调用锚点的边界去重，不凭重复短文本猜测消息身份。
- Claude/Pi catalog 以及缓存 cwd 的目录校验绑定当前后端实例；每次异步读取返回后检查实例仍有效。重配、禁用或关闭期间迟到的旧 catalog 结果不得重建 authority，也不得被当成成功的空列表。
- Pi 首次准备 Prompt 的 cwd/load 尚未完成时也可取消；取消后不启动 Prompt，旧准备任务结束不会清除后续重试。已运行的回复仍通过上游确认停止，Client 断线本身不视为取消。Desktop 的 turn/assistant finish 区分正常完成、失败、中断与 token 上限；Android 恢复后端标签时独立校验 Pi/AGY 的可用性。
- 上述回放隔离与恢复竞态由核心状态机测试覆盖，真实本机 Gateway → ACP Client → Desktop 烟测也确认重启后首次继续对话不会重复插入历史工具结果。不代表新增 Android APK、原生真机或加密跨设备验收。

### Claude（Issue #125）

Host 注册后端 ID 为 `claude`，默认关闭，默认命令为 `claude-agent-acp`、参数为空。使用 [Claude ACP adapter](https://github.com/zed-industries/claude-agent-acp)，需用户在 Host 自行安装并完成 Claude 本机授权；Remote 不自动安装、不发起登录，也不发送 Cursor 专属 `cursor_login` 认证。`claude` CLI 本身不是 ACP 服务，不能配置为 `claude acp`。

Host 的 `acp.backends` 可配置 `{ "id": "claude", "enabled": true, "command": "claude-agent-acp", "args": [] }`，也可指定绝对命令路径与 `cwd`。Host 已接通独立 ACP gateway 的初始化、会话、文字 Prompt、中断、上游 catalog 与有界历史恢复，复用连接归属、单次审批和热重配边界；Desktop/Android 已接入 Claude 工作区、历史、文字会话与模型选择，模型与 effort 仅来自上游 catalog 并等待切换确认。工作区前缀为 `claude:cwd:`，会话前缀为 `claude:`；所有投影仅保留内存。不开放图片输入或直接 Files/Terminal 访问；独立 Remote Web、APK/真机及加密跨设备 E2E 仍待验收。

本机真实接入烟测：使用 `@agentclientprotocol/claude-agent-acp@0.91.0` 及已有 OpenAI 兼容 provider 的同一凭据与 `gpt-6-sol`。该端点实测也支持 Anthropic `/v1/messages`（HTTP 200）；不是把 OpenAI Responses 直接传给 Claude SDK，也未增加协议转换代理。仅在测试子进程设置 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`（去掉末尾 `/v1`）和 `ANTHROPIC_MODEL`，各默认模型同样映射至该模型；使用隔离临时工作目录与 `CLAUDE_CONFIG_DIR`，不修改已有用户配置。真实 `ClaudeAcpClient` 初始化、新建会话及文字 Prompt 完成，收到一个文本 chunk（2 字符）、`end_turn`；未调用工具或触发权限请求。该结果验证 Claude Agent SDK/ACP 运行时搭配兼容端点，不代表调用的是 Anthropic Claude 模型，也不代表 Remote Gateway/加密传输、工具审批、中断或历史已完成 E2E。

#### 工具审批：真实 Host Gateway 验证

沿用上述 adapter、兼容端点和模型，已在隔离临时目录验证真实 `Write` 工具，经 `AcpRemoteGateway` → per-connection peer stream → `respond` 走完整本机审批链：

- 拒绝：收到上游 `reject_once` 选项（真实 ID 为 `reject`），工具未创建目标文件，回复正常结束。
- 单次允许：映射上游 `allow_once`，只创建预期文件且内容匹配；同一会话下一轮再次调用 `Write` 会重新请求审批，拒绝后第二个文件不存在。
- 对真实待审批句柄，另一连接响应、持久授权 `allow-always`、附带任意 `result` 的越权响应均被拒绝，且不消费有效句柄；合法决定仍可提交，提交后重放被拒绝。

Host 按 `options[].kind` 映射真实 `optionId`，不硬编码拒绝 ID。审批绑定连接、会话、backend 与进程实例；无主、旧实例、歧义选项或未知上游请求 fail closed，不向其他设备广播。自动化核心回归另覆盖断线、后端重配、请求字段伪造等边界。

这是本机真实 ACP/Gateway 工具审批验收，不是加密跨设备或 Desktop/Android 原生 UI 验收。仅测试临时文件写入，不新增 Remote 文件写入 RPC、通用上传或 Harness/Codex allowlist。

#### 中断与历史恢复：真实 Host Gateway 验证

Claude 会话与目录来自上游标准 `session/list`；无效 envelope、异常/循环 cursor 或超过 100 页仍未完成的分页显式失败，合法空列表保持为空。Host 对其 cwd 执行 realpath/目录校验，`session/load` 不接受 Client 自报 cwd。未知会话历史失败前不预占会话所有权。历史通过独立临时 adapter 的 `session/load` replay 获取，再转换为文本、推理和工具调用/结果事件，不读取 Claude 私有 transcript。每次最多 8 MiB / 10,000 更新，超限或上游错误显式失败；历史请求不参与工具审批，遇到请求直接拒绝/取消。同一 Host 最多保留 30 个 live/loading Session、一个 history reader；同一已加载 Session 重复 load 本地短路，不重放污染 live stream。未知时间用 `0` 和稳定投影 ID，不宣称恢复上游未提供的原始时间/消息 ID。

沿用现有端点与 `gpt-6-sol` 的真实验证已通过：

- 上游 catalog 发现原会话与 cwd；Host history 恢复用户/助手消息及先前的随机标记。真实 `Bash printf` 的工具输出也在独立 `tool/result` 历史事件中恢复，不把用户 Prompt 中的同名文本误当成工具输出。
- 待审批 `Write` 中断返回 `cancelled`，旧审批句柄失效，文件未创建；其他连接不能取消所属会话。
- 前台 `Bash sleep 45` 运行期间读取独立 history，原 turn 保持运行；随后取消，返回上游 `cancelled`。安全工具可能无需审批，因此中断测试按工具开始事件触发，不等待权限请求。
- 关闭并重新创建整个 Gateway/adapter 后，重新从 catalog 恢复 cwd、load/history 并继续对话，模型准确记住之前的随机标记；不重放原 Prompt 或工具操作。

上述为本机真实 SDK/Host Gateway 验证，不等于客户端重连 UI、Windows、APK/真机或加密跨设备 E2E。

### Hermes Agent（Nous Research）

Host 注册后端 ID 为 `hermes`，默认**关闭**（未安装 Hermes 的 Host 不会被触发拉起），默认命令 `hermes`、参数 `["acp"]`。

Hermes 自带标准 ACP 服务端（`hermes acp`，另有 `hermes-acp` 兼容入口），因此不需要额外的 adapter 或协议转换：

```yaml
acp:
  backends:
    - id: hermes
      enabled: true
      command: hermes   # 或 hermes-acp（此时 args 留空）
      args: [acp]
```

- 认证：Hermes 使用 Host 本机已有的 provider 与密钥配置，不向 Client 发起登录；Remote 只在初始化时发送 `initialize`，不发送 `authenticate`。
- 目录与会话：`session/list` 按 cwd 列出 Hermes 已持久化的会话（标题、更新时间），`session/load` 在响应前回放历史。
- 历史：由独立进程读取并转换为原生事件，模型来源标记为 `hermes`，不写入 Harness SessionStore。
- 模型：`session/new`（或 `session/load`）返回的 `models.availableModels` 即 Host 上的 Hermes 模型清单，切换走标准 `session/set_model`。
- 审批：Hermes 自己的审批策略决定何时请求确认，危险终端操作会通过 `session/request_permission` 交给 Client 单次允许/拒绝。
- 限制：与 Claude 一样不开放 ACP workspace 文件/终端工具入口，也不接收图片 Prompt。

真实验收记录：本机 Host Gateway → `hermes acp` 已完成工作区列举、会话新建、流式回复（`agent_message_chunk`）、工具执行（`terminal` 输出回传）与历史回放。

## 启用已有后端

1. 在 Host 安装对应 CLI，完成其本机授权，并确认命令能运行：Cursor 使用 `agent`，AGY 使用 `agy`，Codex 使用 `codex`。
2. 打开 Host 的 **Remote 设置 → Agent 后端**，检测对应命令；需要时设置绝对命令路径。
3. 开启所需后端并保存。配置热生效，仅更新变化的后端，无需重启整个 DSH；CLI 可发现不代表已登录或协议就绪。
4. 在 Client 登录同账号，选择在线 Host，再选择已就绪的后端工作区。Desktop 与 Android 使用现有工作区/会话界面。

Codex 默认开启，Cursor 默认关闭；AGY 以 Host 配置为准。未就绪的后端不能自动替换为其他后端。
工作目录须在 Host 上已存在；Codex 新增 Project 仅注册真实目录，不创建目录或写入 Harness 存储。

| 后端 | Host 接入 | 使用范围 |
| --- | --- | --- |
| Cursor | `agent acp` stdio，每个会话独立进程 | 文字 Prompt、流式回复、中断、单次审批、真实模型选择 |
| Claude | `claude-agent-acp` stdio | 工作区/历史、文字、流式工具、中断、单次审批、模型/effort |
| OpenCode | `opencode acp` stdio | 工作区/历史、文字、流式回复、中断、模型/effort |
| AGY | `agy --input-format stream-json --output-format stream-json` adapter | 工作区/历史、文字与受限图片、流式回复、模型选择 |
| Pi Agent | `pi-acp` stdio（内部启动 `pi --mode rpc`） | 工作区/历史、文字、流式工具、中断、模型/Thinking |
| Hermes | `hermes acp` stdio（Hermes Agent 自带 ACP 服务端） | 工作区/历史、文字、流式思考与工具、中断、单次审批、模型选择 |
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

仅向 `acp.backends` 添加 command/args 不会自动实现 adapter。当前 gateway 明确识别 Cursor / Antigravity / Pi / OpenCode / Claude，不按可执行文件名称猜测后端。

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
