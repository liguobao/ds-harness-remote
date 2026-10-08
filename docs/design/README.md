# DSH Remote 设计文档

更新时间：2026-10-08；对应 Plugin 0.5.0 当前源码。

本目录描述当前产品和实现边界。运行方式见[根 README](../../README.zh.md)，线协议以
[protocol.md](../protocol.md)为准，实现约束见 [AGENTS](../../AGENTS.md)，未完成工作见
[TODO](../TODO.md)。源码中存在的能力不等于已完成跨设备、跨平台或真机验收。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [产品定位](PRODUCT.md) | 用户、产品目标、仓库边界与设计原则 |
| [界面设计系统](DESIGN.md) | 当前 Android 主题、导航、会话工具与交互规则 |
| [Plugin 产品设计](plugin/product-design.md) | Host、Remote 工作区入口、领域与用户路径 |
| [Plugin 功能设计](plugin/functional-design.md) | 生命周期、数据面、allowlist、工具与恢复 |
| [共享基础](shared-foundation.md) | 身份、授权、加密、传输和共享包职责 |
| [协议 Schema 对齐](protocol-schema-alignment.md) | schema、fixtures、版本与验证边界 |
| [CodeX 内存展示投影](codex-session-history-projection-prompt.md) | App Server authority、原生 UI 载体与生命周期 |

[原始需求提示词](../archive/vibe-coding.md)已归档，只用于追溯需求；当前设计不以原始提示词作为实现依据。

## 当前交付范围

- Plugin：常驻 Host 与本地 Remote 工作区入口同时存在，不提供用户可见的 Client 模式。
- Desktop / 连接本机 Harness 的浏览器：复用官方 Harness UI，提供远程 Header、Files、Terminal 和受限开发服务预览。
- Android：账号授权、Host / Workspace / Session / Chat、图片 Prompt、历史恢复、工作区快捷入口，以及按后端能力接入的会话工具。
- VS Code：账号授权、Host 信任固定、Harness 工作区/会话导航、Prompt 与基础审批；实时更新和恢复仍有待办。
- Browser 扩展：只换取独立设备凭据、显示在线 Host、打开同源 Remote Web。
- `apps/server`：可自部署的单账号、文件持久化、Relay-only Server，提供登录与设备状态页和 Docker 部署入口。
- 完整多账号 Server、Remote Web 会话 UI、Admin 及其数据库、队列和部署基础设施由独立仓库实现。

## 数据面与领域

| 领域 | Host 接入 | Client 展示 | 边界 |
| --- | --- | --- | --- |
| Harness | legacy ApiProxy 或官方 Typert Remote Gateway | Desktop 原生 UI、Android / VS Code Client | 原生会话契约，固定 endpoint allowlist |
| CodeX | stdio App Server，`codex.app.*` | Desktop 内存载体、Android 内存投影 | 不写 DSH 存储；Project / Thread authority |
| Cursor / AGY | ACP gateway，`agent.acp.*` | 浏览器可用的 Desktop 内存载体、Android 投影 | 独立后端 capability、工作区 ID 与会话归属 |

当前兼容范围见[兼容说明](../compatibility.zh.md)，包括 rc.2 ApiProxy、v0.1.2 Typert 与后续 Session V3；
当前兼容说明覆盖 Harness 0.2.0-rc.2，开发依赖声明仍从 `^0.2.0-rc.1` 起。Client 按加密 capability 与 `workspaceTypes.available` 判断协议支持及实际就绪，不能仅依据版本号或后端开关。

## 主路径

1. Host 通过账号密码、GitHub/知乎授权或主机匹配码加入账号；实际授权方式取决于 Server 支持。
2. Client 使用同一账号获得独立身份和设备凭据；Server membership 与 Host 本地 pinned trust 同时成立。
3. Client 固定 Host identity，经 Noise IK 建立加密业务通道。
4. 选择可用后端和工作区，再进入会话；既有 Harness 工作区和 CodeX Project 均可在 Remote 入口选择。
5. Prompt、stream、审批和会话工具进入对应领域的固定 allowlist；退出或断线清理旧句柄，恢复时重新读取历史。

## 访问与配置

- 文件只读；Harness 使用官方 `workspaceFiles` / `officeToPdf` 或 dsh-file-viewer provider，CodeX / ACP 使用 Host 验证过的会话根和受限工具载体。
- 原生终端默认开启，可在 Host 本地关闭；按设备固定归属、按连接校验输入权，断线不重放输入。
- `loopback.ports` 默认空；仅允许 Host 出站访问 `127.0.0.1` 的明确白名单端口。Desktop 的预览代理只监听本机。
- Remote 不得修改插件自身终端、loopback 或后端访问设置。后端开关热更新对应进程和 capability，ACP 初始化不阻塞 Harness Remote。
- AGY 图片缓存是明确授权的私有 tmp 例外，不扩展为通用文件上传或项目写入。

## 验证边界

已有 Harness / CodeX Desktop、Android 主链路和 WebRTC 互操作验证；后续新增工具、模型选择、AGY 加密跨设备链路、Windows、原生 APK、长连接及复杂 HMR 需按 TODO 单独验收。
本次文档同步不增加运行时验收记录。
