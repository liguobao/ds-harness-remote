# Harness Remote Plugin 产品设计

状态：Draft v0.2
目标项目：`packages/plugin`

## 1. 产品定位

Remote Plugin 同时承担 Host 和 Desktop Client 两个角色。Host 把官方 Harness
rc.2 `ApiProxy`、v0.1.2 alpha.1–rc.1 或 v0.1.5 rc.1 Session V3 Typert Remote Gateway 的安全子集接入端到端加密通道；Remote
runtime 让官方 Harness UI 使用同账号 Host 上的工作区。产品不呈现 Client 模式开关。

Plugin 是受控数据网关，不是独立 Agent、远程 Shell，也不重新实现 Harness 会话协议。

## 2. 核心用户路径

1. 远端 Harness 用网页生成的一次性设备授权码完成 Host 接入。
2. 本地 Harness 的 Remote 身份使用相同 Server 和账号自动注册或完成一次账号授权。
3. Server 建立同账号 membership，双端从受保护设备详情固定对端公钥。
4. 用户从侧边栏 Remote 入口选择 Host，再选择已有工作区或浏览远端目录添加工作区。
5. 本地官方 Harness UI 通过与本机同代的远端 ApiProxy 或 Typert Gateway 工作；退出或断线时回到对应本地 carrier。

## 3. MVP 范围

- Cordis 生命周期与 GitHub/npm Bundle 入口。
- 站点账号授权 Host/Client 注册；当前 Host 设置页仅开放一次性设备授权码，账号 token 与 device token 隔离。
- 按 Server origin 与 Host/Client 角色隔离身份和 credential。
- 同账号 membership、双端 pinned peer 与设备撤销。
- Host 主动建立 WSS，Relay 上运行 Noise IK。
- rc.2 ApiProxy 与 v0.1.2 Typert Remote endpoint 固定 allowlist、unary、stream 和 approval/question response。
- 后台 Local/Remote ApiProxy 或 Gateway switch 和断线回落，不暴露模式开关。
- 加密 capability 探测、legacy Host 降级与 ApiProxy/Typert 混连 fail-closed。
- Settings 插件卡片、Remote 模态框、远程状态 Header 和脱敏诊断。
- 主机列表过滤本机，并显示 OS、Harness 版本、Plugin 版本与在线状态。
- 已有 Workspace 选择与只读远端目录浏览。
- 配合 `dsh-file-viewer` 的受限远端文件预览（stat、分块读取、目录列表）。

## 4. 非目标

- Android Client 复用协议，但其真实设备 E2E 验收独立进行。
- 不兼容旧 `sessions.* / session.* / permissions.respond / sync.from` 业务协议。
- 不启动公网监听端口。
- 不提供 PTY、SSH、远程桌面、任意文件系统访问或任意 Harness tool RPC；文件内容仅可由
  `dsh-file-viewer` provider 在其授权根/locator 内通过受限只读预览桥访问。
- settings/credentials 仅通过官方 seam 代理：设置写入限 Host 实时注册的命名空间，credential 值只写；不代理 `settings.openDocument`、native path open/picker、目录写入、attachment upload 或下载 API。
- 不在本仓库实现 Server、Remote Web 或 Admin runtime。

## 5. 权限体验

远端 UI 看到并回答的是 rc.2 ApiProxy mux 或 alpha `$events` 的原生
approval/question frame。Plugin 不翻译 permission 数据，也不新增授权范围。最终裁决、过期、
重复响应和取消均由 Host Harness 的官方业务层实现负责。

## 6. 安全承诺

- Host 私钥始终留在本机。
- Server 不能读取 Remote Harness 业务内容。
- Server membership 与 Host 本地 trusted peer 必须同时成立。
- 每个业务请求绑定 Noise connection、Host、Client 与递增 counter。
- Host 方法白名单禁止敏感本地 API；未知方法 fail closed。
- 撤销设备或断开连接后，旧 stream 和旧回答不能继续使用。

## 7. MVP 验收

1. npm 子包与 GitHub 根包均可由 DSH Desktop 识别加载。
2. Host 不监听公网端口，只建立出站连接。
3. Host 完成账号授权注册后只使用 device credential 常驻。
4. Host/Client 同账号注册后自动获得 membership，并固定对端 identity key。
5. 本地 Harness 可选择同账号 Host 和工作区，通过官方 UI 创建和继续远端会话。
6. Remote unary、stream 与 approval response 全部经过当前 Harness 代际的固定 allowlist。
7. 远端连接关闭后 Client 结束旧流并回落 Local。
8. Relay capture 无法解密 payload；篡改、重放和 identity mismatch 被拒绝。
