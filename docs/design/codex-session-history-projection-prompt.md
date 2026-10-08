# CodeX Workspace / Session 内存展示投影设计

更新时间：2026-10-08。文件名保留既有引用；本文描述当前设计，不再作为从零实现的任务提示词。

## 1. 定位与入口

CodeX 保留在 Remote Plugin 的 `packages/plugin/src/codex/` 独立领域，Host 使用 stdio App Server，Remote 使用 `codex.app.*`。
Desktop 通过临时 ApiProxy / Typert carrier 复用原生 Workspace / Session / Conversation / Composer；Android 直接消费同一领域并在内存中投影。
VS Code 当前不增加 CodeX 会话入口。完整 Remote Web runtime 仍在独立 Server 仓库；本仓库最小 Server 只转发加密数据。

用户从 Remote Host 的工作区选择器进入 CodeX Project / Workspace，可选择既有目录或注册 Host 现存目录。
CodeX 默认开启，可在 Host 后端设置中关闭；capability 与 `workspaceTypes.available` 同时成立才进入工作区。
命令可发现不代表 App Server 已登录或就绪。

## 2. 数据所有权与 authority

App Server 保存 Project、Thread、Turn、Item、History、运行与审批状态；Client 仅维护临时映射和 stream。
不得写 DSH SessionStore、Workspace 数据库、Harness 日志或自建展示数据库，不读取 `~/.codex` 私有 JSONL/SQLite。

Workspace 优先由 `project/list` 得到；缺少可用根目录才使用 App Server `thread/list` 已返回的绝对 cwd 精确回退。
不推测共同父目录，不接受 Client 自报路径作为 authority。
`project/create` 仅接受 Host 已存在的单个绝对目录，Host 执行 realpath 和目录校验，App Server 返回新 Project 后才扩展 authority。
新 Thread 可使用 authority 根内经词法路径和 realpath 双重验证的真实子目录；带 threadId 的调用也校验 Thread 归属。

Workspace ID 使用 `codex-workspace:project:` 前缀，Session ID 使用 `codex:<threadId>`。
ID 只是映射，不能单独授权访问路径、Thread 或文件。

## 3. 数据流

```text
Desktop 原生 UI / Android Workspace、Session、Chat
  -> Client 内存展示投影
  -> CodexRemoteClient
  -> membership + pinned identity + Noise channel
  -> 每连接 Codex bridge 与固定 allowlist
  -> Host stdio Codex App Server
```

Desktop 虚拟 carrier 只实现 UI 需要的固定 endpoint；未知方法拒绝，不能回落到 Host 本地 Harness Session。
各版本 carrier 和 Session V3 兼容以[兼容说明](../compatibility.zh.md)和源码为准。

## 4. 方法与原生操作

| UI 动作 | App Server 操作 |
| --- | --- |
| Project 列表 / 注册 | `project/list` / `project/create` |
| 新会话 / 打开历史 | `thread/start` / `thread/read` |
| Fork / Rename / Archive | `thread/fork` / `thread/name/set` / `thread/archive` |
| 发送 Prompt | `thread/resume` 后 `turn/start` |
| 运行中调整 | `turn/steer`，校验 expectedTurnId |
| 停止 | `turn/interrupt` |
| 审批 | Host `codex.app.respond`，单次允许或拒绝 |

打开历史不自动 resume；发送前恢复相应 Thread。账户、模型、unsubscribe/unarchive 等操作仍受编译期 allowlist 限制，
完整 schema 与限额见[协议](../protocol.md)及 `codex/method-policy.ts`。
禁止 raw App Server 代理、`command/*`、`process/*`、任意 config、Thread 删除/注入和远程 API Key 登录。

图片以受限 base64 input 经 CodeX transfer 传递，在 Host 转为 App Server data URL；不接收通用附件、外部 URL 或任意 Host path。
权限控件显示 Host 确认的会话策略，未知时标明沿用 Host 设置；切换确认后生效。

## 5. History 与实时事件

打开 Session 从 `thread/read(includeTurns: true)` 取得 baseline，按 Turn/Item 顺序生成原生展示事件。

| CodeX 数据 | 原生展示 |
| --- | --- |
| Turn 开始/结束 | turn start/end |
| User / Agent message | user/assistant message |
| Assistant / reasoning delta | 原生 chunk 和 reasoning |
| Plan | todo/write 与计划展示 |
| Command / MCP / tool / file change | tool call/result 与受限摘要 |
| Output delta / progress | 同一 tool result 的有界累计更新 |
| Thread / model 状态 | session status 与模型选择投影 |
| 未识别 Item | 安全忽略，不透传任意原始对象 |

snapshot 保持 header/cursor/records/hasMore 和事件顺序；实时流处理开始、delta、完成、状态与审批。
大 History 走有界 transfer，断线后新的持久化 baseline 替换临时 live 状态，不重放 mutation 或建立永久 replay buffer。

## 6. CodeX Files / Terminal

当前 CodeX 会话已接入受限工作区工具。`codex-workspace-bridge.ts` 由 Host 将 `codex:<threadId>` 解析为 Thread cwd，
独立创建文件 scope 和终端上下文；不把 CodeX ID 当作 Harness agent，也不扩大 App Server allowlist。
路径规范化、realpath、符号链接、尺寸与会话有效性校验和 Harness 工具一致，不能越过该 Thread cwd。

只读文件使用固定 `workspaceFiles/*` 语义。终端使用官方 `terminal/*` shape、快照、controllerId、follow/retain 与单调输出序号，
遵循 Host 开关、设备归属与连接输入权。Host subprocess 可用时提供 PTY，否则 pipe；Client 模拟器重放有界原始输出。
这是受控会话工具入口，不能成为 raw App Server shell/command 或通用 filesystem RPC。

## 7. 生命周期与验证

切换领域/Host、退出 Remote、撤销、断线或关闭 CodeX 时清理对应内存载体、stream、pending waiter 和审批句柄。
Host 配置热更新只重启变化后端；其他后端保留。工具和审批按认证连接隔离，未知连接、identity mismatch、越权 root 和迟到回复拒绝。
日志不包含 token、私钥、Prompt、历史、源码或工具输出。

核心验证保护 authority、allowlist、History/live 顺序、RPC、审批、恢复和文件/终端隔离；纯展示不新增测试。
已有 CodeX Desktop/Android 主链路验收不等于 Project 新建、最新工具、Windows 与长连接全部通过。
剩余验收见[TODO](../TODO.md)，使用与边界见[CodeX 技术说明](../codex-remote.md)，实现约束见 [AGENTS](../../AGENTS.md)。
