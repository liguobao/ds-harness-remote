# ACP 后端接入与实现

Cursor、Antigravity、Pi、OpenCode、Claude、Hermes 使用独立 `agent.acp.*` 数据面；Codex 使用 [App Server 领域](codex-remote.md)。本篇统一维护后端安装、运行差异与 adapter 接入。RPC/schema/限额统一在[协议](protocol.md#agent-acp-domain)，不在多份指南重复定义。

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
| Hermes | `hermes acp` stdio（Hermes Agent 自带 ACP 服务端） | 工作区/历史、文字与多模态图片、流式思考与工具、中断、单次审批、模型选择 |
| Codex | `codex app-server` stdio | Project/Thread、历史、文字/图片、模型/权限、中断与审批 |

图片规格对 AGY 与 Hermes 相同：每张最多 8 MiB、每条消息最多 4 张（合计不超过 32 MiB），支持 PNG / JPEG / WebP / GIF，单边不超过 8192 像素且不超过 4000 万像素。AGY 将图片写入 Host 专用私有 tmp 缓存，保留 24 小时，系统提前清理 tmp 后图片可能不可用；Hermes 以 base64 内联透传，不写 tmp 缓存。
工具可用性以 Host capability 和会话 scope 为准。最新工具、AGY 加密跨设备链路、Windows、APK/真机与长期稳定性仍有待验证项，见 [TODO](TODO.md)。

## 后端说明

### Cursor

Cursor adapter 默认**关闭**。开启前请在 Host 本机完成 `agent login`，或配置
`CURSOR_API_KEY`。也可在 Desktop 插件设置中切换开关（立即生效）。

```yaml
ds-harness-remote:
  cursor:
    enabled: true
    binary: agent   # 或 ~/.local/bin/agent 的绝对路径
```

### Antigravity（AGY）

Android 的 `antigravity` 工作区独立使用 AGY catalog/history/prompt 与 ACP stream。首次连接
和刷新均发现 Host 既有目录与会话；新建会话保持空白，回复后更新标题，重连重新加载历史并
订阅 stream。图片通过私有 tmp 缓存与有界 ACP transfer；不调用 Harness Prompt 或写入
SessionStore。批量读取列表不触发预热，选中目录才预热。部署与目标平台限制统一见 [TODO](TODO.md)。

### OpenCode 与原生归档

Host 通过 `opencode acp` 标准握手接入，优先探测官方安装目录与 PATH。v1 npm 包为 `opencode-ai`，v2 为 `@opencode/cli`；运行前按同一命令的 `--help` 检测参数能力，不凭版本猜测接口。

仅当同时声明 `--hostname`、`--port`、`--mdns` 时，Host 在同一 ACP 进程启用 `127.0.0.1` 临时端口、`--mdns=false` 和每进程随机 Basic auth。三者均不支持时移除旧网络参数，使用纯 stdio；部分支持、检测失败或超限则明确拒绝启动，关闭后端会取消检测。不另起 opencode serve，也不暴露其 HTTP listener。

原生归档仅对有私有 HTTP API 的构建可用（已知 v1 1.19.3）；v2 2.0.32 为纯 stdio 路径，归档返回 `OPENCODE_ARCHIVE_UNAVAILABLE`，目录、历史和对话继续工作。Host 先校验原生会话，再仅 PATCH time.archived；不调用删除、不维护 Remote 归档索引，也不改 OpenCode 数据库。

HTTP 目标与认证不接受 Client 输入，禁止重定向，响应最多 64 KiB、单次 20 秒，进程关闭时中止请求。目录按页最多四路 GET 核对归档状态，遍历后再应用 limit；归档会话的可信 cwd 保留给只读历史。原生确认后才更新 Client 目录并发布 catalog.changed；加载、回复、模型修改和待审批与归档互斥。完整请求、错误与事件统一见[协议](protocol.md#agent-acp-domain)。

不提供解除归档或已归档列表；其他后端不能仅移除本地列表就返回归档成功。上游参考：[v1 原生归档](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/app/src/pages/session/session-archive.ts)、[v2 ACP](https://opencode.ai/v2/docs/cli/acp/)。

### Pi Agent（Issue #97，实验性）

在 Host 运行 `npm install -g @earendil-works/pi-coding-agent pi-acp`。先通过 `pi` 配置模型与授权并完成本机对话；Remote 默认自动检测并初始化 Pi Agent，成功后开放工作区。未安装或初始化失败时不可用，不影响其他后端；明确设置 `enabled: false` 或关闭 ACP 总开关时不启动。Remote 设置 → Agent 后端可关闭 Pi Agent。默认命令为 `pi-acp`，参数为空；`pi` 本身的 RPC 模式不是 ACP，不能将命令直接替换为 `pi`。

OpenAI 兼容端点通过 Pi 用户目录的 `models.json` 配置 `baseUrl`、`api`（如 `openai-responses`）和模型；密钥使用 Pi 私有凭据、环境变量或私有 credential command，不放入 Remote 配置。参考 [pi-acp 上游说明](https://github.com/svkozak/pi-acp)。

Pi 工作区使用 `pi:cwd:`，会话展示使用 `pi:`，需要 `agent.acp.pi.v1`。Host 通过标准 ACP `session/list` / `session/load` 发现目录、恢复历史，不读取 Client 本机的 Pi 文件。每个活动会话使用独立 wrapper，历史读取另用临时 wrapper，避免上游加载会话时关闭其他会话。Client 断线只释放订阅及归属，运行中的回复继续；恢复后从 Host 重新读取历史。不写 Harness SessionStore 或 Workspace 数据库。每个 Host Pi adapter 最多保留 30 个活动/已加载会话，另保留 catalog 与一个历史读取槽；达到配额显式失败，可在 Host 关闭后端并重新启用以清理进程。历史最多 8 MiB / 10,000 条 ACP 更新，超限报错而非静默截断。

首版文字 Prompt、流式回复、Tool Call、中断与历史恢复通过 ACP 接入；Pi 工具按 Host 用户权限执行，不承诺额外的 Remote 工具审批隔离。模型与 Thinking 选项只来自适配器的实际 catalog，使用现有 `dsh/sessionModels` / `dsh/selectModel`，不向 Harness/Codex 添加端点。Windows、独立 Remote Web、Android 原生及加密跨设备验收需另行完成。

#### Pi 工具审批与历史读取边界

- Pi 默认使用 Host 用户的 OS 权限，**不会自动对每个内置工具请求审批**。若 Host 的 Pi 扩展在 `tool_call` 中等待 `ctx.ui.confirm`，pi-acp 会转成 `session/request_permission`；Remote 仅允许单次允许、拒绝或取消，按本次上游选项 ID 回传，不提供会话级永久授权。普通 Prompt 不会自动为 Pi 安装审批扩展。Pi 扩展 `select` 若把多个选项都编码为 `allow_once`，当前单次审批契约无法安全区分，保持拒绝，不把选择菜单伪装成工具授权。
- 历史从 Host 的有界 transfer 读取，用户/助手文本及工具结果映射为原生事件；工具调用和输出分开，保留失败状态、bash terminal 输出，连续文本 chunk 合并。目录/历史读取失败不能当成成功的空列表或空对话，也不能因此偷偷新建会话；并发读取同一会话历史共用一次请求。
- `pi-acp@0.0.34` 的 `session/load` 不重放原始 thinking、原始消息 ID/时间或完整工具输入。Remote 不读取 Pi 私有文件来绕过协议：使用稳定的投影消息 ID，未知时间记为 `0`，不宣称无损恢复。实时 Pi bash 输出预览最多保留 1,048,576 个字符，超限显式提示通过有界历史重新读取，而不是伪装为完整输出。
- 标准 catalog 的 `nextCursor: null` 表示正常结束，不应误报协议异常。

#### 恢复与重配的竞态边界

- Pi 初次 `session/load` 的文本、思考和工具通知属于历史回放，不发布至实时 stream；只合并匹配会话、上游确认的模型/Thinking 配置。load 期间的 callback 直接拒绝，加载成功后才接受 live 通知和审批。
- Android Pi/AGY 打开会话时不复用旧展示缓存作为新订阅的基线；有界历史返回后合并本次订阅期间收到的实时文本、工具及完成 catch-up，不用打开前的 `running` 值覆盖它们。历史失败显式报错；缺少共同 cursor/原始消息 ID 时只做有 ID/工具调用锚点的边界去重，不凭重复短文本猜测消息身份。
- Claude/Pi catalog 以及缓存 cwd 的目录校验绑定当前后端实例；每次异步读取返回后检查实例仍有效。重配、禁用或关闭期间迟到的旧 catalog 结果不得重建 authority，也不得被当成成功的空列表。
- Pi 首次准备 Prompt 的 cwd/load 尚未完成时也可取消；取消后不启动 Prompt，旧准备任务结束不会清除后续重试。已运行的回复仍通过上游确认停止，Client 断线本身不视为取消。Desktop 的 turn/assistant finish 区分正常完成、失败、中断与 token 上限；Android 恢复后端标签时独立校验 Pi/AGY 的可用性。

### Claude（Issue #125）

Host 注册后端 ID 为 `claude`，默认关闭，默认命令为 `claude-agent-acp`、参数为空。使用 [Claude ACP adapter](https://github.com/zed-industries/claude-agent-acp)，需用户在 Host 自行安装并完成 Claude 本机授权；Remote 不自动安装、不发起登录，也不发送 Cursor 专属 `cursor_login` 认证。`claude` CLI 本身不是 ACP 服务，不能配置为 `claude acp`。

Host 的 `acp.backends` 可配置 `{ "id": "claude", "enabled": true, "command": "claude-agent-acp", "args": [] }`，也可指定绝对命令路径与 `cwd`。Host 已接通独立 ACP gateway 的初始化、会话、文字 Prompt、中断、上游 catalog 与有界历史恢复，复用连接归属、单次审批和热重配边界；Desktop/Android 已接入 Claude 工作区、历史、文字会话与模型选择，模型与 effort 仅来自上游 catalog 并等待切换确认。工作区前缀为 `claude:cwd:`，会话前缀为 `claude:`；所有投影仅保留内存。支持直接 Files/Terminal 访问，复用 Host 工作区路径隔离与终端权限设置；Claude 图片输入暂不支持；独立 Remote Web、APK/真机及加密跨设备 E2E 仍待验收。


#### 审批、中断与历史边界

Host 按上游 `options[].kind` 映射唯一的单次 `optionId`，不硬编码拒绝 ID。审批绑定连接、会话、后端和进程实例；跨连接、持久授权、任意 result、重放、歧义选项及无主请求均拒绝。断线或重配使旧句柄失效。

Claude 会话与目录来自上游标准 `session/list`；无效 envelope、异常/循环 cursor 或超过 100 页仍未完成的分页显式失败，合法空列表保持为空。Host 对其 cwd 执行 realpath/目录校验，`session/load` 不接受 Client 自报 cwd。未知会话历史失败前不预占会话所有权。历史通过独立临时 adapter 的 `session/load` replay 获取，再转换为文本、推理和工具调用/结果事件，不读取 Claude 私有 transcript。每次最多 8 MiB / 10,000 更新，超限或上游错误显式失败；历史请求不参与工具审批，遇到请求直接拒绝/取消。同一 Host 最多保留 30 个 live/loading Session、一个 history reader；同一已加载 Session 重复 load 本地短路，不重放污染 live stream。未知时间用 `0` 和稳定投影 ID，不宣称恢复上游未提供的原始时间/消息 ID。

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
- 图片：支持多模态图片 Prompt，图片作为标准 ACP `image` 内容块随文本一起透传至 `hermes acp`，规格与 AGY 一致（PNG / JPEG / WebP / GIF，单张最多 8 MiB、边长不超过 8192、像素不超过 4000 万，每条消息最多 4 张）。与 AGY 不同，Hermes 直接内联 base64，不写 Host tmp 缓存，因此不存在缓存过期问题。
- 直接 Files/Terminal 使用 Host 共享 ACP workspace tools，受可信 cwd、连接归属、路径隔离与终端开关约束；这与 Agent 自己执行工具相互独立。


## 共享运行时与投影

ACP 在后台启动，各后端独立初始化，不阻塞 Harness Remote 注册和 Client 初始化。
能力声明表示已启用的协议支持，`workspaceTypes.available` 表示实际就绪；关闭期间会清理
正在启动的 CLI，迟到的初始化结果不得重新注册实例。后端配置保存后立即生效，仅更新发生变化的后端。

设置页根据 Host 上配置的命令及运行时支持的候选位置检测后端是否可发现。
检测不可用时工作区开关显示关闭并禁用；手动检测失败会保存该后端的关闭状态，
并立即更新 Host 运行时，适用于 Cursor、AGY、CodeX 和自定义 ACP 条目。
重新检测通过后可以手动开启，不自动恢复为开启。命令可发现不代表已登录或协议就绪，
真实 Remote 可用性仍以 `workspaceTypes.available` 为准。

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
`agent.acp.v1` 仅表示公共数据面，不据此推断后端。不提供早期 ACP 配置或工作区 ID 的迁移；该限制不表示 ACP 尚未实现或发布。
独立 Remote Web runtime 的接入和跨设备 E2E 仍待在独立 Server 仓库验证。

## 新增 ACP 后端

仅向 `acp.backends` 添加 command/args 不会自动实现 adapter。当前 gateway 明确识别 Cursor / Antigravity / Pi / OpenCode / Claude / Hermes，不按可执行文件名称猜测后端。

1. **实现进程 adapter**：参考 [adapter.ts](../packages/plugin/src/acp/adapter.ts) 的 `start / close / isReady / call / respond / respondError / onInbound / onUnavailable` 契约，在 `acp/adapters/` 实现固定后端 ID、请求关联、通知与退出清理。原生 ACP 可参考 Cursor；其他协议需像 AGY 一样明确适配。
2. **注册 Host 生命周期**：在 [gateway.ts](../packages/plugin/src/acp/gateway.ts) 接入后端创建、支持列表、后台启动、就绪检测和 reconfigure。关闭时取消启动，迟到初始化不能重新注册；不可用后端不能静默降级。
3. **定义安全契约**：在 [method-policy.ts](../packages/plugin/src/acp/method-policy.ts)、共享 Protocol 和 [协议](protocol.md) 同步固定方法、字段、backend capability、工作区/会话 ID 和限额。按连接隔离 stream、transfer 和审批；不扩大 Harness 或 Codex allowlist。
4. **接入工作区与展示**：在 Host 实现 backend 明确的 catalog 和 session scope，Client 只消费 Host 接口。更新 [虚拟 carrier](../packages/plugin/src/acp/virtual-harness.ts)、Client 类型/就绪判断和 Android 内存投影；不引入 Node 依赖到浏览器，不写 Harness 持久化。
5. **接入可选能力**：历史、图片、模型和只读文件/终端分别声明 capability。工作区工具必须使用 Host 验证的会话根、固定 endpoints 与终端输入权，不能接受任意 Client cwd 或通用文件上传。
6. **验证核心边界**：覆盖 allowlist、后端/会话归属、权限、RPC/事件顺序、启动中关闭和断线恢复；真实跨设备、目标 runtime 和 CLI 验收单独记录。展示、文案、布局不单独新增测试。

新增后端是源码开发工作，不能把未经实现的注册项列成已支持产品。Codex 继续使用独立领域，当前不迁入 ACP gateway。

## 实现入口

| 文件 | 职责 |
| --- | --- |
| [gateway.ts](../packages/plugin/src/acp/gateway.ts) | 后端生命周期、归属与审批 |
| [method-policy.ts](../packages/plugin/src/acp/method-policy.ts) | 固定方法和参数 schema |
| [adapter.ts](../packages/plugin/src/acp/adapter.ts) / adapters/ | 进程 adapter 契约与实现 |
| [peer-bridge.ts](../packages/plugin/src/acp/peer-bridge.ts) | 每连接流与 transfer |
| [virtual-harness.ts](../packages/plugin/src/acp/virtual-harness.ts) | 浏览器/Desktop 内存展示 |
| [acp-client.ts](../packages/client-core/src/acp-client.ts) | 共享 Client |

核心约束是可信 cwd、后端/会话/连接归属、单次审批、历史与 live 隔离及重配代次校验。剩余平台与长连接工作统一见 [TODO](TODO.md)。
