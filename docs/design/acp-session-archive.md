# OpenCode 原生会话归档

Remote 直接调用 Host 上 OpenCode 原生 HTTP API 设置归档时间。归档状态由 OpenCode
持久保存；不维护 Remote 归档索引，不修改 OpenCode 数据库，也不调用会话删除接口。
当前只实现 OpenCode，不把其他 ACP 后端的本地列表移除视为归档成功。

## 上游接口与进程

核对并实际验证的版本为 OpenCode v1.19.3：

- 原生应用调用 `session.update({ sessionID, directory, time: { archived: Date.now() } })`。
- Host 使用同一个 `opencode acp` 进程自带的 HTTP server，先 GET 校验会话，再
  `PATCH /session/:sessionID?directory=...`，唯一写入字段为 `time.archived`。
- 返回的 session ID、真实目录和有限归档时间必须匹配；原生确认后才返回成功。
  已归档会话重复操作幂等，不重写时间。
- ACP `session/list` 可能仍返回原生已归档会话。Host 对每页条目以最多四个并发 GET
  核对原生归档状态，保留分页 cursor，遍历后再应用 Remote limit。已归档条目的可信
  cwd 仍用于只读历史授权，但不进入默认会话和工作区发现结果。

Host 先读取配置命令的 `--help`，仅当同时声明 `--hostname`、`--port`、`--mdns` 时
启动原生 HTTP listener。三者均不支持时移除旧网络参数，以纯 stdio ACP 启动，不建立
原生归档 API；列表、历史和对话仍可用，归档明确返回 `OPENCODE_ARCHIVE_UNAVAILABLE`。
部分参数支持、检测失败或超限则拒绝启动，避免对旧 CLI 丢失私有监听约束。
检测有时间/输出限额，关闭后端立即取消；不记录 CLI 输出，也不按版本号猜测接口。

启用时监听强制使用 `127.0.0.1`、临时端口及 `--mdns=false`，覆盖配置中的网络 flags；
每个进程使用随机 Basic auth 密码。HTTP URL、认证和 payload 不由 Client 提供，
禁止重定向，响应上限 64 KiB、单次请求超时 20 秒，进程关闭时中止请求。
不额外启动 `opencode serve`，不向 Remote 暴露 HTTP listener。

上游参考：
[原生归档调用](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/app/src/pages/session/session-archive.ts)、
[ACP 入口](https://github.com/anomalyco/opencode/blob/v1.19.3/packages/opencode/src/cli/cmd/acp.ts)。
该发布版 ACP 没有归档方法；dev 分支的 `session/delete` 调用原生 remove，不能替代归档。
当前 HTTP 契约没有确认可用的解除归档语义，本版不实现恢复或已归档列表入口。

## Remote 契约

能力：`agent.acp.opencode.archive.v1`，与 `agent.acp.opencode.v1` 配合使用。
能力表示 Host 实现了该接口；实际后端未就绪或原生接口不兼容时显式失败。

`agent.acp.call` 内固定扩展：

```json
{"method":"dsh/sessionArchive","params":{"backend":"opencode","sessionId":"ses_example"}}
```

响应：`{ backend: "opencode", sessionId: "ses_example", archived: true }`。
ID 必须是原生安全 ID，不能包含 `opencode:` 前缀；不接受 cwd、URL、任意原生方法或 payload。
Host 经 catalog、backend binding 和 realpath 校验解析 authority，并核对原生返回目录。

成功后，向当前已认证的 ACP peers 发布 `agent.acp.catalog.changed`，data 与响应相同。
这是目录失效通知，不是回复完成事件；断线不重放，重连重新读取原生 catalog。
不增加 Harness/Codex allowlist 或另外的业务数据面。

## 并发、历史与客户端

- 空闲会话允许其他已授权同账号连接归档，无需抢占原 session owner。
- 加载、Prompt 准备/执行、模型切换或待审批时拒绝归档；归档期间拒绝这些新写操作。
  不隐式取消回复、批准请求、删除历史或关闭 Host 终端。
- 归档后拒绝 Prompt、session/load 及模型切换，返回 `ACP_SESSION_ARCHIVED`。
  只读历史不取得 owner，通过独立 history reader 读取保留的原生记录。
- 上游失败、目录不匹配、响应未确认、后端替换或关闭均不能返回归档成功。
  冲突为 `ACP_SESSION_BUSY`，原生接口异常为 `OPENCODE_ARCHIVE_UNAVAILABLE`。
  不确定结果由刷新确认，不自动重放其他操作。
- Desktop 内存投影和 Android 均等待原生确认，再移除默认目录成员；失败保留原状态。
  当前连接收到归档事件时同步目录。历史记录保留，未写 DSH SessionStore 或 Workspace 数据库。
  旧 Host 无 capability 时明确报不可用，其他 ACP 后端不再伪造本地归档成功。

## 验证边界

核心测试覆盖原生认证与目录校验、失败确认、重启后目录过滤、活动/并发归档隔离、
后端替换、客户端确认及过期连接结果隔离。真实 OpenCode v1.19.3 在独立临时数据目录
完成新建、跨连接归档、原生时间确认、幂等重试、重启后隐藏及历史读取验证，无 Prompt。
本机验证不等于 Windows、APK/真机、跨设备加密 E2E 或独立 Remote Web 已验收。

CLI 参数检测修复后，1.19.3 的初始化、新建、目录、原生归档、归档目录核对及独立历史读取
已在隔离目录重新验证。官方 v2 npm 包已改为 `@opencode/cli`，真实
`@opencode/cli-darwin-arm64@2.0.32` 校验 integrity 后在临时目录通过初始化、新建、目录、
42 个模型目录与模型切换、独立历史、重启列表与加载；归档明确不可用。两版均未发送 Prompt。
部分支持/失败/超限与启动中关闭由进程 fixture 覆盖；帮助格式分别覆盖 v1 的 `-h, --help`
与 v2 的 `--help, -h`，不将这些验证描述成 Windows 或加密跨设备验收。

v2 参考：[安装与包名](https://opencode.ai/v2/docs/)、
[ACP 协议与进程](https://opencode.ai/v2/docs/cli/acp/)。v2 ACP 启动内部私有服务，不连接
共享后台服务，也不开放网络端口；其 `session/delete` 是删除，不能代替归档。
