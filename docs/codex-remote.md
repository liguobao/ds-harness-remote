# Codex Remote 技术说明

本文记录 Codex Remote 的实现边界、配置方式和当前验证状态。用户入口请看根
[README](../README.md)；线协议和安全约束以 [Remote Protocol v1](protocol.md) 为准。

## 定位

Codex Remote 是现有 Remote Plugin 内的实验性可选领域，不是独立插件，也不是 Server runtime。
它复用 Remote 已有的账号授权、Host 选择、端到端加密连接和客户端入口，让用户在远端设备上打开
Host 上的 Codex 项目。

Remote 只做展示和操作转发。Codex 的 Thread、Turn、History、运行状态和审批状态继续由 Codex
App Server 管理；Remote 不导入、不复制，也不另建一套 Codex 数据库。

## 用户界面

连接 Host 后，Remote 工作区选择器可以展示 Codex 工作区。用户选择后继续使用现有 Harness 或
Android 会话界面：

- Desktop 复用 Harness 原生 Workspace、Session、Conversation、Composer、工具卡片和审批控件。
- Android 复用移动端已有 Workspace、Session、Chat、模型、权限、图片、停止和审批控件。
- Desktop Remote 选择器和 Android Workspace 页面都可选择 Host 上的真实目录并新增 Codex 项目。
- 不增加独立 Codex 页面、本地模式入口或第二套 Thread 导航。

虚拟 Workspace 和 Session 只存在于内存展示层。退出 Codex 模式、切换 Host 或断开连接时，对应
展示状态、订阅和审批状态都必须销毁。

## 与 Codex 桌面端、CLI 切换同一对话

使用 Remote 时，建议按需完全退出正在使用同一对话的 Codex 桌面端或 CLI，避免写入占用冲突；
若提示对话正在其他客户端中使用，退出对应客户端并等待占用释放后重试即可。

同一 Thread 同时只能由一个 Codex 进程持有写入占用。Remote 仅查看已有历史不会主动恢复
Thread；发送消息、新建或恢复 Thread 时可能获取占用。回复完成但仍停留在该 Thread 时，
Remote 会保留占用。

从 Remote 切回本机时，先切换到另一条对话或关闭远程页面。最后一个观察者离开后，Host
自动退订并释放空闲 Thread；运行中的 Turn、活动 Goal 和未决审批会延后释放。
Goal 自动续轮期间即使暂时空闲也会保留，直到 Goal 完成或停止且当前 Turn 收尾后再释放。
多个远程客户端观察同一 Thread 时，只关闭其中一个不会释放。

各客户端的释放时机不同：

| 客户端 | 释放时机与使用建议 |
| --- | --- |
| Remote | 最后一个观察者离开且 Thread 空闲后自动释放；无需每轮对话退出。 |
| Codex 桌面端 | 切走不保证释放。本机核对的 `26.1111.21308` 会缓存最多 10 条符合条件的普通非活动 Thread，通常在非活动 3 小时后退订，超量时优先清理最旧的；活动视图、观察者或任务可继续保留。需要立即交接时，可在其他任务结束后完全退出应用。 |
| 交互式 CLI | `0.167.1` 在成功新建或切换普通会话时主动退订旧 Thread；语音、侧边会话及保留的后台任务等有例外。正常退出本地 CLI 会关闭其内嵌 App Server；仅切换终端标签页不会退出会话。 |
| `codex exec` | `0.167.1` 正常任务结束时退订并关闭内嵌 App Server。 |

桌面端与 CLI 的策略可能随版本变化。CLI 结论来自对应版本源码核对：
[切换退订](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/tui/src/app/voice_owner.rs#L123)、
[退出](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/tui/src/app/event_dispatch.rs#L3856)、
[exec 收尾](https://github.com/openai/codex/blob/rust-v0.167.1/codex-rs/exec/src/lib.rs#L1390)。
退订后还需等待原生卸载：本机测得默认约 60 秒，不能与桌面端退订前的缓存时间混淆。
Remote 仅给自身 App Server 设置零空闲卸载延迟，不改变桌面端或 CLI 配置，也不能替它们释放。
不要删除 `~/.codex/thread-writer-locks` 中的文件来抢占；真正的锁由进程文件描述符持有。

## Workspace 来源

可见 Workspace 优先来自 Codex App Server 的 `project/list`。当该接口不可用或没有可用根目录时，
Host 可以使用 `thread/list` 已返回的绝对 `cwd` 精确生成只读后备 Workspace。

新增 Workspace 通过固定白名单中的 `project/create` 写入 Codex 项目目录。Host 只接受单个现存绝对
目录，并在调用 App Server 前执行 `realpath` 和目录类型校验；成功后 Client 重新读取 `project/list`，
不会把项目写入 DSH Workspace 存储。后备 Workspace 不支持此创建流程。

新建 Thread 的目录只能来自上述 authority root 内的真实子目录。Host 必须同时执行词法路径校验和
`realpath` 校验，拒绝 `..`、符号链接逃逸和 Client 自报的越界路径，也不得推测共同父目录。

## 实现与内存投影

Host 实现在 `packages/plugin/src/codex/`，Client 经 `CodexRemoteClient` 和每连接 bridge 访问固定 App Server 方法。Desktop 虚拟 carrier 不得将未知方法回落到本机 Harness。VS Code 当前不提供 CodeX 会话入口。

Workspace 使用 `codex-workspace:project:`，Session 使用 `codex:<threadId>`；这些 ID 仅定位，不授予目录或 Thread 权限。Remote 不读取 `~/.codex` 私有 JSONL/SQLite，也不建立第二份数据存储。



Desktop 端会把 Codex Thread 映射成临时 DSH Session，把 History 和实时 frame 映射成原生 Session
事件。Android 端直接消费同一 Codex 领域，并只在移动端内存中生成展示投影。

实时投影覆盖 assistant、reasoning、plan、命令输出、文件输出、文件变更摘要、MCP progress、
Thread 状态和模型切换。Web Search、Subagent、Image、Compaction 和 Review Mode 复用原生工具卡片。
大段实时工具输出只保留有界内存窗口；文件 patch 只传递路径和变更类型，不把原始 diff 写成
Workspace 文件内容。

History 优先使用 Host 分页 `dsh/sessionHistory`，旧 App Server 才回退到 `thread/read(includeTurns:true)`；不能把失败当空历史。Host 按 DSH 消息边界分页后再传输。Client 只在当前可见 Thread 的标题、预览、目录和
标识中做本地搜索。

## 操作与权限

Project create、Thread create、rename、archive、restore、prompt、interrupt 和 approval 操作都必须路由回 Codex App Server
的固定白名单方法。Remote 不能通过反射、任意 method name、process/config 入口或通用文件系统协议
扩权。

Web 与 Desktop Remote 的审批模式按 Thread 显示 Host 已确认的设置。尚未获知时显示沿用 Host
设置，不把 `workspace-write` 误报为已有会话的当前值。显式切换需 Host 成功确认，并同步观察者；
普通发送和 fork 不重放缓存的 preset，新 Thread 使用 `workspace-write`。纯查看只读取 Host 的
内存快照，不恢复会话；Host 重启后，尚未再次获知的模式回到未知状态。

Codex 支持文本 Prompt，以及 Desktop 剪贴板粘贴或 Android 系统图片选择器提供的 PNG、JPEG、WebP、
GIF 图片 Prompt。图片走受限的加密分块传输；通用文件附件、外部 URL、Host path 直接引用和目录写入
不开放。

权限遵循 Remote 原有 Host 边界：同账号 membership、Host identity 固定、Noise 安全通道、自适应
传输和连接隔离都必须继续成立。虚拟 Workspace/Session 不得写入 DSH SessionStore、Workspace 存储、
Harness 日志或第二份 Codex 数据存储。

## 配置

Codex 默认开启，可在 Remote 的 Agent 后端设置中关闭。保存后热更新该后端，不需要重启整个 DSH。

```yaml
ds-harness-remote:
  codex:
    enabled: false
    binary: codex
```

`binary` 必须指向支持 `codex app-server` 的 Codex CLI。在 macOS 保持默认 `codex` 时，Plugin 会先
尝试当前 ChatGPT App 内置的 Codex，再回退到 `PATH`；显式配置的 binary 始终原样使用。

旧 `dsh-remote` 设置不再自动导入；已有旧配置应通过本机设置界面重新配置。身份与凭据目录迁移属于另一流程，见[接入指南](plugin-integration.md)。

## 当前验证状态

Codex Remote 已完成 Desktop 跨机、Android 真机、Web → Host、多客户端观察、大 History、Prompt、
approval、interrupt 和图片分块的真实设备验证，但仍以实验功能发布。后续恢复策略、跨平台矩阵和
长期稳定性以 [TODO](TODO.md) 为准；不应把 TODO 中的目标能力描述为已完成。

Thread 释放修复于 2026-11-14 在 macOS、Codex `0.167.1` / `0.169.0-alpha.11.1` 上通过原生
writer lock 实测：最后订阅释放、其他 Thread 保留、独立 App Server 接管、快速重开、运行中
断线完成后释放，以及无 stream 的 resume 在断线时释放。全仓 check、测试（1,742 通过、
3 项既有跳过）、生产构建与 bundle 校验通过。用户 Web → Desktop 交接成功；反向交接实测
受桌面端持锁阻挡。CLI 切换/退出仅核对源码；本次修复未新增跨设备、Android/iOS、Windows/Linux 验收。

macOS 全仓测试使用 `TMPDIR=/private/tmp pnpm -r test`，避开既有工作区路径测试的临时目录别名差异。
释放实现和关闭确认边界见 [协议说明](protocol.md#codex-app-server-domain)。


## Files、Terminal 与生命周期

`codex-workspace-bridge.ts` 将 Thread cwd 解析为独立工具 scope，不把 CodeX ID 当作 Harness agent，也不扩大 App Server allowlist。只读文件和终端使用固定 workspaceFiles / terminal 语义；路径、realpath、符号链接、尺寸、设备归属与连接输入权仍在 Host 校验。

CodeX / ACP 共用 Host `RemoteTerminalController`。有 subprocess 支持时使用 PTY；pipe fallback 不支持 resize 或 job control。屏幕恢复使用有界 xterm 快照，不回放原始输出；断线释放输入权而保留已提交进程，后端重配或关闭则等待清理。只有无持有者/follower 且持续明确 idle 两小时才回收，unknown/busy 不回收。具体字段及限额统一见[协议](protocol.md#codex-session-workspace-and-terminal-scope)。

切换 Host/领域、注销、断线或关闭后端清理对应内存载体、stream、pending waiter 和审批。热更新只影响变化的后端；迟到结果不能更新新实例，也不重放不确定 mutation。
