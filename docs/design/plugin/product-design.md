# Remote Plugin 产品设计

更新时间：2026-10-08；目标项目：`packages/plugin`。

## 定位

一个 Plugin 同时提供 Host runtime 与本地 Remote 工作区入口，无用户可见的 Client 模式。
Harness 通过官方 ApiProxy / Typert Remote carrier 接入；CodeX、Cursor、AGY 保留各自独立的数据面，Desktop 以内存载体复用原生 Workspace / Session / Conversation UI。

## 用户路径

1. 在 Desktop 插件管理或指定 dsh profile 安装 Plugin；GitHub 根包和 npm 子包均保留发布入口。
2. Host 通过账号密码、GitHub/知乎授权或主机匹配码加入账号。dsh-TUI 可用 `/remote login|status|logout` 和终端二维码。
3. Client 使用同账号的独立设备身份登录，选择在线 Host；列表过滤本机，并展示系统、Harness / Plugin 版本及连接状态。
4. 选择已就绪的 Harness / CodeX / Cursor / AGY 工作区，或通过对应领域受限的目录入口添加。
5. 打开或新建会话，发送 Prompt、查看历史和流式回复、执行受支持的模型/权限操作与单次审批。
6. 使用当前领域支持的 Files / Terminal；开发服务预览仅在已授权端口及受支持的 Desktop 本机入口开放。
7. 退出 Remote 回到本地 Harness；断线使旧 stream 和审批句柄失效，恢复后读取新的历史 baseline。

最小自部署 Server 只支持其账号密码和设备凭据子集，不承诺托管站点的第三方授权功能。

## 产品组成

| 组成 | 行为 |
| --- | --- |
| Host | 只出站连接；按认证连接隔离桥、stream、transfer 和待审批句柄 |
| Remote 入口 | 账号授权、Host/版本、工作区类型与就绪状态、目录浏览 |
| Remote Header | 当前 Host、链路、加密说明、退出和预览服务 |
| 本地设置 | Host 访问、终端、loopback 白名单、Agent 后端命令和开关 |
| CodeX | 默认开启；App Server 数据源；Project/Thread 与内存展示投影 |
| ACP | Cursor 默认关闭；Cursor/AGY 独立配置、capability 和会话归属 |

`workspaceTypes.available` 表示实际就绪；capability 表示支持的协议。两者都满足才允许进入对应工作区。
后端保存热更新相关进程、流和 capability，不重启整个 DSH；不受影响的后端及 Harness 加密连接保留。

## 访问边界

- 原生文件树与预览只读，使用官方工具或 provider 授权范围；不增加通用文件写入 RPC。
- CodeX Project 注册限 Host 上已存在的真实绝对目录，不创建目录、不推测共同父目录。
- CodeX 工具 scope 来自 Host 确认的 Thread cwd；ACP 工具 scope 来自会话创建或 Host catalog。
- 终端默认开启，以 Host 用户权限运行；终端归属与输入权独立于 Agent 审批，断线不重放输入。
- Loopback 只访问本地白名单端口，不支持任意目标、CONNECT 或通用 TCP 转发。
- Remote 禁止修改 `ds-harness-remote` / `dsh-remote` 自身访问设置。
- AGY 图片仅允许 PNG/JPEG/WebP/GIF，每张 8 MiB、每次 4 张，写私有 tmp 缓存，保留 24 小时且总量有界。

## 非目标

- 远程桌面、SSH、任意 filesystem / Harness tool / Cordis service RPC。
- 旧实验性 Harness `sessions.* / session.send / permissions.respond / sync.from` Remote 业务协议。
- 写入 DSH 持久化存储的 CodeX / ACP 会话投影。
- 本仓库内完整多账号 Server、Remote Web 会话 UI、Admin 或其数据库与部署基础设施。

## 安全与验收

Server membership 与 Host 本地 pinned trust 同时成立；设备 identity 不匹配、未知连接、错误 target、篡改和重放均拒绝。
业务仅进入认证后的 Noise channel；token、私钥、匹配码、Prompt、源码与工具输出不写日志。
权限只允许单次允许/拒绝，连接结束后旧审批不能继续使用。

已有核心链路验收不覆盖所有新能力。CodeX Project 新建、AGY、原生工具、Windows、复杂预览和长期恢复的剩余验收见[TODO](../../TODO.md)。
