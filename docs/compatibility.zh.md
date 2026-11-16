# 版本兼容

## 当前基线

| 组件 | 范围 |
| --- | --- |
| Remote | 当前源码 0.6.5；Android versionCode / Expo iOS buildNumber 72。版本号不等于已经发布 |
| Harness 开发基线 | 0.2.2-rc.1，Node.js >=24.9 |
| 旧 Harness | 保留 0.2.1-rc.5、0.2.0-rc.2 / rc.1 的官方 Typert / Session V3 路径 |
| peer range | 接纳 0.2.1 / 0.2.2 预发布及正式版；范围接纳不等于每个版本均有运行时验收 |
| TUI | 同版本独立 `ds-harness-remote-tui` 组合包；已验证 dsh-TUI 0.20.1 + Harness 0.2.2-rc.1 的 Android 核心 Relay 链路 |
| DS-Bot | 固定路由对齐 0.3.6；覆盖命名接口不代表所有接口均完成手机端到端验证 |

TUI profile 只启用一个 Remote Host entry，授权使用 `ds-harness-remote` CLI。完整安装方式见[组合包说明](../packages/tui/README.md)。

## Harness carrier 与附件

Host、随包 Remote Client 和 Android 只使用官方 Typert carrier。缺少 capability discovery 或仅提供早期 ApiProxy 的 Host 会被拒绝；不恢复 `sessions.*`、`session.send`、`permissions.respond` 或 `sync.from` 自定义业务协议。独立 VS Code 中的历史兼容分支不代表当前 Host 支持该路径。

- Harness 0.2.2 的图片附件请求使用完整 `ImageAttachmentRef`；Android 保留字节数与尺寸。Host 桥对旧 Harness 降级为 attachmentId；旧客户端不能为新 Host 补齐引用时，由官方 Gateway 明确拒绝。
- `session/control` 内存投影同时携带旧 key/value 与新 changes；虚拟 `session/page` 提供 cursor，并接受 `session/events`。
- 本地 carrier 使用存活的官方 owner Peer；缺少 Peer 或事件服务的组合必须明确失败。独立 TUI 包负责装配官方 Remote API。
- `workspaceTypes.available` 与协商 capability 均成立才开放对应后端。命令可发现、开关开启或版本范围匹配不表示后端已登录或就绪。

## CodeX、ACP 与平台

CodeX 使用独立 App Server 数据面；Cursor、AGY、Pi、OpenCode、Claude、Hermes 使用 ACP gateway。会话目录、模型、工具和历史能力取决于实际 CLI。安装条件见[接入指南](acp-remote.md)，不按 CLI 名称推断协议，也不把失败后端替换成其他后端。

OpenCode v1 的原生归档依赖受认证的私有 HTTP API；纯 stdio / v2 构建没有该 API 时返回不可用，不能以删除代替归档。详见[归档设计](acp-remote.md#opencode-与原生归档)。

凭据刷新锁支持 Linux 单机本地 ext4/XFS；NFS、SMB、跨主机共享目录不在支持范围。Windows Host 锁恢复、iOS 真机、全部后端/审批流程和长期网络稳定性仍有待办，见 [TODO](TODO.md)。升级或降级前停止全部 Harness 进程，迁移与 0.6.3 降级步骤见[接入指南](plugin-integration.md)。

TUI 核心验证覆盖会话发现、双向消息、历史、文件预览/上传、终端和 App 重启恢复；不扩展为全部 TUI 命令、真实审批或其他版本组合的兼容承诺。
