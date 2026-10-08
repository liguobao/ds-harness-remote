# Remote Plugin 功能设计

更新时间：2026-10-08；目标项目：`packages/plugin`。

## 1. 数据面

| 领域 | Remote 接口 | Host authority |
| --- | --- | --- |
| Harness legacy | `harness.api.*` | 官方 ApiProxy、原生流和权限响应 |
| Harness Typert | `harness.remote.*` | 官方 Gateway endpoint 与事件关联 |
| CodeX | `codex.app.*` | stdio App Server、Project / Thread 根目录 |
| Cursor / AGY | `agent.acp.*` | backend adapter、Host 会话/catalog |
| File Viewer | `fileviewer.call` | provider 已授权的 root / locator |
| 开发预览 | `loopback.call` | Host 本地端口白名单 |

业务都复用认证后的 Noise channel，但独立 capability、allowlist、RPC/event 和状态。
不得将 ACP 方法塞入 Harness 或 CodeX API，也不得引入平行的 Harness session/agent/workspace/permission 协议。
兼容版本和 carrier 选择见[兼容说明](../../compatibility.zh.md)；schema 与具体限额见[协议](../../protocol.md)。

## 2. 生命周期与模块

| 模块 | 职责 |
| --- | --- |
| `index.ts` / `config.ts` | Cordis 装配、配置解析、settings 兼容和热更新 |
| `service.ts` / `server-connection.ts` | Host、Control/Relay、每连接业务桥 |
| `identity-store.ts` / `server-credentials.ts` | 按 Server origin/角色隔离身份、信任和凭据 |
| `harness-api-bridge.ts` / `harness-remote-bridge.ts` | 官方 Harness 固定 allowlist、原生流与有界 transfer |
| `api-proxy-switch.ts` / `typert-gateway-switch.ts` | Local / Remote carrier 切换 |
| `client-runtime.ts` / `client.ts` | 加密 capability、工作区类型、选择与内存 carrier |
| `workspace-bridge.ts` / `codex-workspace-bridge.ts` | 有界只读文件和按会话隔离的 CodeX 工具 scope |
| `terminal-policy.ts` | Host 开关、设备归属、连接输入权 |
| `loopback-host.ts` / `loopback-preview.ts` | Host 白名单请求与 Client 本机独立预览 origin |
| `codex/` | App Server、authority、allowlist、虚拟 carrier、审批 |
| `acp/` | 后端注册表、gateway、独立工具、transfer、虚拟 carrier |
| `control-runtime.ts` / `control-route.ts` / `control-stream.ts` | 本机设置、账号授权与 Host status SSE |

顶层 Plugin 激活不等待可选 Agent 后端。Host 捕获未经过 Remote switch 的本地 dispatcher，避免请求递归。
每条认证连接独立创建 bridge 和 pending/stream/transfer 状态，连接替换只清理其自己的旧状态。
ACP 后台初始化；关闭中清理启动进程，迟到的结果不得重新注册。

settings 通过 `typeof settings.register === 'function'` 分流旧注册表与新 Volatile entry 路径。
终端开关、loopback 保存和 Agent 后端配置热生效；只重载发生变化的后端，其待审批句柄和流失效，其他后端保留。

## 3. Harness bridge 与 Client carrier

rc.2 使用官方请求、响应、mux/host frame 与 `respond()`；Typert 使用官方 invoke、stream、`$events` / `$events/result`。
Plugin 仅负责认证、方法过滤、RPC 关联、流生命周期和传输，不读取 Harness 内部 SessionStore 或重建业务模型。

- Unary、respond、stream open/close 进入对应固定 allowlist。
- 图片 Prompt 和大 History / attachment 走已协商的有界 transfer，保持原生业务 envelope。
- 官方命令仅使用 Host 注册的目录与 handler；不允许反射任意 service。
- 官方 settings 写入限实时注册的命名空间，排除插件自身访问设置；credential 只写入有界引用，不返回秘密值。
- 禁止 native open/picker、目录写入、动态 Cordis runtime/source、通用 attachment upload/download 和未知 endpoint。

Client 先调用 `harness.transport.describe`。老 Host 缺少方法时保留 legacy 降级；新 Host 按 capability、
版本 profile 和现有事件/history 归一化选择 carrier。不支持的组合在 mutation 或 UI target 切换前拒绝，不进行任意 wire format 翻译。
Remote 退出/断线结束旧流并回落本地；恢复时重新认证和读取 baseline，不重放 mutation。

## 4. 原生文件与终端

Harness 复用官方 `workspaceFiles` / `officeToPdf` 固定 allowlist，并保留 dsh-file-viewer 的 stat/readRange/list 桥。
CodeX `codex:<threadId>` 由 Host 解析成独立 Thread cwd scope，不当作 Harness agent ID。
共享工作区桥对路径、realpath、符号链接、读取大小与终端操作执行有界校验。

CodeX 工具使用原生 `workspaceFiles/*` / `terminal/*` 语义；不是放开 App Server 的 `command/*` 或 `process/*`。
ACP 工具使用独立 `dsh/toolCall` 与有 tool 参数的 stream，限编译期固定 endpoints；scope 必须与 backend/session 匹配。
客户端不能提交任意 cwd 来扩展工具 authority。

终端默认开启，Host 本地可立即关闭。固定设备归属与当前连接输入权；follow/retain、输出序号和关闭遵循原生语义。
断线保留可恢复的终端状态但不重放输入；领域关闭结束其进程。Host subprocess 服务可用时使用 PTY，否则回退 pipe；
共享桥输出是有界原始日志，由 Client 终端模拟器重放。

Android 图片/PDF 最大 8 MiB、Office 源文件最大 50 MiB；本地打包 PDF.js/xterm 渲染器，生成源文件不提交。
PDF 只读，不提供脚本、外链、导出或明文文件缓存；真机与跨设备效果另行验收。

## 5. Loopback 预览

`loopback.http-ws.v1` / `loopback.call` 只访问 `127.0.0.1` 的 Host 白名单端口；默认未授权。
Host 只出站连接，禁止 CONNECT、任意主机和通用 TCP 转发。
Desktop Client 随机本机监听端口承载独立 preview origin；Header 提供「预览服务」。
本机预览 URL 不能当作 Remote Web、Android 或 VS Code 的可用地址，复杂 HMR、Cookie/CSP 与网络条件仍需回归。

## 6. CodeX 与 ACP

CodeX 默认开启，通过 stdio App Server 访问固定方法。
Workspace authority 优先 `project/list`，缺少有效根目录才回退到 `thread/list` 已返回的绝对 cwd。
`project/create` 仅注册 Host 真实目录，realpath + 目录验证后由 App Server 返回 Project 扩展 authority。
新 Thread 子目录需词法路径与 realpath 双重校验；已有 Thread 操作也重新校验归属。
详见[CodeX 投影](../codex-session-history-projection-prompt.md)。

ACP 当前实现 Cursor 和 Antigravity adapter，不按命令名称选择后端，不对明确选中的不可用后端降级。
启用 capability 与实际 `workspaceTypes.available` 分离；Cursor/AGY 工作区 ID 分别生成，AGY 使用 `antigravity:cwd:`。
浏览器内存 carrier 只从 Host ACP 读取工作区、历史和图片，不依赖 Node、AGY 数据库或本机 transcript。
Host 的 AGY catalog/transcript 则执行项目归属、realpath、符号链接与迟到结果隔离。

AGY 图片仅 PNG/JPEG/WebP/GIF，每张 8 MiB、每次 4 张；专用 tmp 私有缓存总量 512 MiB、保留 24 小时，后续上传触发清理。
AGY 1.3.0 stream-json 接收 text，图片通过固定 add-dir 和 view_file 使用；历史只读当前会话引用且仍有效的缓存图片。
Cursor 保持文字 Prompt。AGY 模型目录来自安装 CLI，模型/effort 切换待 Host 确认，不推测默认或历史模型。
具体 capability 与选择时序见协议。

## 7. 身份、恢复与审批

Server membership、Host 本地信任、pinned identity、Noise transcript 与计数器校验全部通过后才开放业务桥。
凭据刷新使用跨进程目录锁，锁内重新读取凭据；握手拒绝最多刷新恢复一次。
`4003` 作为 `CONNECTION_REPLACED` 停止自动抢占；并行 Host 分别使用独立 DSH_HOME。

Harness 保持官方审批关联；CodeX / ACP 保持独立、按连接隔离的审批句柄。Remote 决策只允许单次允许或拒绝。
断线、后端关闭、撤销或替换使相关 stream、transfer、待审批状态失效，不自动重放 Prompt 或终端输入。
Android 对支持的后端重开 stream 并读取 history baseline；通用 pending call 恢复和长期稳定性仍按 TODO 跟踪。

Host status 通过本机 SSE 首帧完整快照、变化推送和空闲保活更新；旧 Host 不支持 SSE 时保留 unary status 降级。
连接建立进度与二维码登录属于独立交互流程，不等于常态 status 轮询。

## 8. 验证要求

测试预算用于 schema/版本、身份加密、授权、RPC、allowlist、权限隔离、事件顺序、恢复和 transport 状态机。
共享契约不在各 Client 重复测试；跨端 conformance 必须在真实目标 runtime 运行。
展示、布局、文案和静态说明以类型检查及必要人工烟测验证。
既有主链路结果与最新工具、AGY 模型选择、Windows、APK / 真机、复杂预览验收分开记录，见[TODO](../../TODO.md)。
