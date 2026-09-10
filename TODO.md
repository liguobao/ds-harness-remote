# TODO

本清单按 2026-09-10 的兼容方向维护：Harness v0.1.1 rc.2 使用官方 ApiProxy，
v0.1.2 alpha.1–rc.1 使用既有 Typert Remote Gateway，v0.1.5 rc.1 作为 Session V3
兼容目标。Android 与 VS Code Client 通过 capability 探测兼容这些 Host carrier；Server、Remote Web 和 Admin 只在独立
Server 仓库实现。

Desktop 已使用独立 Remote 工作区入口：本地选择账号下的 Host 与远端 Workspace，或通过
只读目录浏览添加 Workspace，随后复用原生 Harness UI。当前实现已跑通真实设备、Web→Host
主链路和独立 Server 跨仓库联调，具备开发预览发布条件；后续重点转为安全审查、恢复策略、跨平台矩阵和长期稳定性。

测试预算只用于协议、安全、账号授权、认证连接、ApiProxy/Typert Remote allowlist/stream 生命周期和核心
transport 状态机；普通 UI、文案和辅助脚本不单独补测试。

## 已完成基线

- [x] pnpm monorepo、共享 Protocol/Crypto/Transport/Client Core
- [x] Host 账号密码/主机匹配码接入、Client 账号接入、device token rotation 与按 Server/角色隔离的身份状态
- [x] 同账号 membership、受保护 peer descriptor 与本地 pinned trust 双重授权
- [x] Relay control、标准 Noise IK、counter/replay 拒绝与 opaque ciphertext
- [x] Desktop Plugin Host runtime、Settings 配置和 GitHub/npm Bundle 入口
- [x] dsh-TUI profile 在无 Desktop `connection` 服务时默认启动 Host，并通过原生 `/remote` 的 `login [github|zhihu]`、`status`、`logout` 完成终端授权和状态管理；`ds-harness-remote` 保留为启动前 CLI
- [x] Host ApiProxy allowlist bridge、mux/host stream 与后台 Local/Remote ApiProxy switch
- [x] Harness v0.1.2 alpha.1–rc.1 Typert Remote unary/stream/event carrier、固定 endpoint allowlist、加密 capability 探测与 legacy ApiProxy 激活兼容
- [x] Harness v0.1.5 rc.1 Session V3 capability、严格 surface replacement、Assistant stream 与 v0.1.2/V3 mutation 前混连拒绝
- [x] Android 与 VS Code Client 按 Host capability 在 rc.2 ApiProxy 和 v0.1.2 Typert Remote 之间选择数据面
- [x] Remote 模态框、主机自过滤、OS/Harness/Plugin 版本展示、远端 Workspace 与目录选择
- [x] Remote Header、LAN/P2P/TURN/Relay 链路、端到端加密状态与退出入口
- [x] 配合 dsh-file-viewer 的远端只读文件 stat/list/分块预览桥与 Client provider
- [x] 不同 Web Client 同时连接一个 Host；RPC、stream 与断开清理按 connectionId 隔离
- [x] Web → Host 主链路真实环境验证：账号授权、Host presence、Remote Workspace、Session/Prompt/approval 与断开回落
- [x] 独立 Server 跨仓库联调：REST、Control WebSocket、Relay、Signaling、conformance fixture 与 membership/IDOR 防护
- [x] 删除自定义 Session/Agent/Workspace/Permission adapters、event replay 和旧 Host RPC 路由
- [x] GitHub Actions 使用 Node.js 22 和 pnpm 9.15.4 执行 build、check、test 与 Bundle 校验

## P0：Plugin 可用链路

- [x] 在真实 dsh-desktop 中验证 GitHub 安装、重启、Host/Client 配置和 Bundle 入口
- [x] 在真实 dsh-TUI alpha.2 profile 中验证 `/remote` 补全、GitHub/知乎扫码、上线与跨机 Session/Prompt/approval
- [x] 分别用 `dsh-v0.1.1-rc.2`、`dsh-v0.1.2-alpha.1` 与 `dsh-v0.1.2-alpha.2` 跑通双机 Workspace/Session/Prompt/approval E2E，并验证混合代际在 mutation 前拒绝
- [ ] 用 `dsh-v0.1.2-rc.1` 补跑 Desktop/dsh-TUI 跨机 Workspace/Session/Prompt/approval E2E 与长期稳定性回归
- [ ] 用 `dsh-v0.1.5-rc.1` 补跑 Desktop/dsh-TUI 跨机 Workspace/Session/Prompt/approval、CodeX replacement/stream、重连 E2E 与长期稳定性回归
- [x] 用两台真实 Harness + 外部 Server 跑通同账号授权、选择 Remote、创建/继续会话
- [x] 验证原生 mux/host stream、approval/question respond 与断线关闭行为
- [x] 用手机 Web 与电脑 Web 同时连接一个真实 Host，验证并发操作、同设备重连和流隔离
- [ ] 验证 allowlist 覆盖官方 UI 的必需方法；允许已认证 Remote peer 通过官方 seam 管理 Host 实时注册的 settings 命名空间与全局 credential 引用（credential 值只写），并保持 `settings.openDocument`、native path、目录写入、任意文件访问、attachment upload 和 download 禁止
- [x] 用两台真实 Harness 验证 dsh-file-viewer 文本、图片、PDF、大文件分块与断线回落
- [ ] 在 macOS、Windows、Linux 验证 native picker 只读目录兜底、symlink、权限错误和大目录截断
- [ ] 完善账号过期、`DEVICE_OWNERSHIP_REQUIRED` 和 legacy owner 的显式恢复体验
- [x] transport 关闭后 pending unary/stream 立即返回稳定错误，并清理 timer 和 abort listener

## Codex Remote Session / History（已完成，实验发布）

Codex 属于同一个 Remote Plugin，但在 Plugin 内保持独立业务领域。它在 Remote 工作区选择阶段
提供虚拟 Workspace/Session 数据源，并把 `Thread -> Turn -> Item` 临时投影为 DSH 原生 Session
事件；不迁移数据，也不写入 DSH SessionStore。

- [x] 增加默认开启、可在设置中关闭的 `codex.enabled` 与本机 `binary` 配置；Workspace 优先使用 CodeX `project/list`，为空或不支持时回退到 `thread/list.cwd`
- [x] 增加 Host 单例 stdio App Server 生命周期、initialize/account probe 与动态 capability
- [x] 增加独立 `codex.app.*` RPC/event/transfer、固定 method schema allowlist 与大 History 分块
- [x] 增加按 connection 隔离的 stream、active-turn owner、opaque approval handle 与断线 fail-closed
- [x] 增加共享 Client Core Codex client、`DisplaySession` / `DisplayHistoryItem` 纯展示投影
- [x] Android 按动态 capability 直接接入 `codex.app.*`，将 `project/list`/Thread/分页 History/live frame 合并到现有 Workspace/Session/Chat
- [x] Android 接入 CodeX 模型与 reasoning、固定权限预设、系统图片选择器 Prompt、interrupt 和单次命令/文件审批
- [x] 在 Remote 工作区选择器中增加 CodeX 虚拟工作区入口，不增加本地入口或独立页面
- [x] Desktop 与 Android 增加 CodeX Workspace 创建入口，通过固定 `project/create` 白名单新增经 Host 校验的真实目录
- [x] 增加 rc.2 ApiProxy / v0.1.2 Typert 内存虚拟载体，将 CodeX History/live 映射为原生 Session 事件
- [x] 将 reasoning/plan delta、command/file/MCP progress、Thread status、model reroute 与 Web Search/Subagent/Image/Compaction/Review Mode Item 投影到原生 chunk、状态、projection 和工具卡片
- [x] 将新建空 Thread 稳定挂载到当前 CodeX Workspace，并增加 Host 端消息边界 History 分页与 Client 端 Session 元数据搜索
- [x] 复用 DSH 原生 Workspace/Session 列表、Conversation Renderer、Composer、工具与审批 UI
- [x] 接入原生 Session 权限预设切换、剪贴板图片 Prompt 分块传输，并在不开放通用文件附件时隐藏 Composer“+”入口
- [x] 增加 App Server crash 后有界指数退避重启；关闭旧 stream 且不自动重放 mutation
- [x] 使用当前 v2 schema 与真实 Codex App Server 完成 stdio initialize/account/project/list/read 冒烟
- [x] 使用真实 Codex App Server 完成本机 thread/start、幂等 resume、streamed turn/completed、History 回读与归档清理冒烟
- [x] 迁移旧 `dsh-remote` 用户设置，并在 macOS 默认配置下自动发现 ChatGPT App 内置 Codex
- [x] 用两台真实 DSH Desktop 跑通加密跨机 resume/turn/event/approval/interrupt 与大 History 传输
- [x] 验证 App Server crash、Host transport 重连和多 Desktop Web Client 同时观察同一 Thread
- [x] 用 Android 真机跑通 CodeX Workspace→Thread→Prompt/steer/approval/interrupt、大 History、图片分块与断线重连
- [ ] 用真实 Desktop 与 Android 验证远端 `project/create`、新增后自动选择和空 CodeX 目录首个项目流程

## P0：协议与安全

- [ ] 将 `packages/protocol` 与 `docs/protocol.md` 的 Control、Account Authorization、Connect、Relay、ApiProxy tunnel、Error 和 Limits schema 逐项对齐
- [ ] 清理仅供冻结 Android 原型使用的旧 Session/Event 类型
- [x] 固定 hello/hello.ack 版本拒绝、capability 协商与 Control/Relay frame 上限
- [x] 拒绝超限 Control/Relay frame 和 binary Control frame
- [ ] 完成 Noise 实现独立安全审查、长期连接 rekey 与断线密钥清理策略
- [ ] 增加协议与加密 golden vectors
- [x] 补齐 counter 安全整数边界与 Control/Relay frame limit 测试
- [ ] 补齐真实 Relay 链路的篡改、重放和错误 identity 跨层验证

## P1：Transport 与恢复

- [ ] 实现 control heartbeat、RTT、最后活动时间和错误分类
- [x] 完成 WebRTC offer/answer/ICE、STUN/TURN、短期 credential 与 Relay fallback 基础链路
- [ ] 完善 `connecting -> direct -> relay -> reconnecting -> offline` UI 状态机和网络切换恢复
- [ ] 定义 direct 超时和 Relay fallback，切换中不得重复已提交的 ApiProxy mutation
- [ ] 重新连接后重开原生 mux/host stream，并由官方 UI 重新获取 history baseline

## P1：跨仓库 Server 联调（已完成）

- [x] 持续同步 `server.md`、`protocol.md` 与 Host Plugin 接入契约
- [x] 冻结 REST、Control WebSocket、Relay 和 Signaling 合约
- [x] 在两仓 CI 使用同一组 conformance fixtures
- [x] 验证 Server 无法解密 ApiProxy payload，且 host registration code/token/membership/IDOR 防护成立

## P2：工程与发布

- [ ] 使用系统 Keychain/Secret Service 保存身份私钥和 refresh token
- [ ] 完成多窗口、休眠/唤醒、代理网络和系统浏览器账号授权
- [ ] 明确版本、License、发布策略与兼容矩阵
- [ ] 提供脱敏日志导出和真实设备长连接性能基线
- [ ] 修复冻结 Android 原型的 Metro exports fallback 警告（仅在恢复 Android 产品线时）

## VS Code Client

`apps/vscode` 已实现 Extension 基础入口、SecretStorage 连接身份/凭证、账号密码与扫码登录、同账号
Host 列表与 identity fingerprint 固定、Adaptive transport + Noise、rc.2 ApiProxy / v0.1.2 Typert Remote
capability 探测，以及 Host → Workspace → Session 层级导航、Prompt、permission command、approval 响应和编辑区会话面板。该能力仍是开发者预览，剩余工作：

- [ ] 在真实 VS Code Extension Host、外部 Server 与跨机 Harness Host 上完成 E2E
- [ ] 增加 token 失效恢复与连接断开后的自动重连
- [ ] 完善实时增量渲染、question 响应界面与重连后的 stream/history 恢复
- [ ] 验证 VSIX 在 macOS、Windows、Linux 的系统 SecretStorage 与代理网络行为

## Browser Launcher（已完成）

`apps/browser` 只作为 Chrome/Edge 的 Remote Web 入口，不实现第二套完整 Client。它负责
从已登录 Remote Web 换取独立 Browser device credential、在线 Host 列表和打开 Remote Web。

- [x] 收缩为 Web 授权入口和在线 Host 列表，删除扩展内账号/扫码登录、Remote transport 与会话 UI
- [x] 临时读取同源 Web 登录授权，经专用 exchange 接口换取隔离的 Browser device credential，不持久化 Web Token
- [x] 点击在线 Host 后直接打开同源 `/app/remote/{hostId}`，复用浏览器已有 Web 登录状态
- [x] 加载 unpacked 扩展，联调 Web 授权、presence 刷新和目标 Host 跳转

## Android Client（主链路已完成）

`apps/android` 已迁移到当前 rc.2 ApiProxy / v0.1.2 Typert Remote 双数据面，并接入可选 CodeX Remote：账号登录注册、成员设备列表与 identity key
固定、Adaptive transport + Noise secure channel、`harness.api.*` 或 `harness.remote.*`
tunnel 与 mux/Gateway frame 聊天。功能已对标 Web 端 Remote 控制台：新建/继续/归档会话、历史分页、
模型目录与切换、相册图片 Prompt（Host limits 预检 + transfer 分块）、Workspace 管理（创建+只读目录浏览/重命名/删除/排序）、连接详情面板与
传输偏好（Auto/TURN/Relay），以及跟随系统/英文/简体中文语言设置。CodeX 侧直接消费独立
`codex.app.*`，使用 `project/list` Workspace 或精确的 `thread/list.cwd` 后备 Workspace、分页 History/独立 stream、模型/权限、图片 Prompt、
interrupt 与单次审批，不恢复旧 Android RPC。剩余工作：

- [x] 数据面端到端联调（本地 Server + 真实插件 Host + smoke client）：账号授权、加密 Relay、
      mux 流、会话列表、`host.describe` 透传与 approval `client-response` 应答
- [x] 更新 smoke client：优先选择在线 Host（presence 探测）、按插件 bridge 的嵌套帧类型匹配
      `assistant/chunk`（原实现永远匹配不到）
- [x] 真机/模拟器 UI E2E：账号登录、设备列表、连接、会话与聊天
- [x] 真机验证 Android Photo Picker 多选、超限提示与大图片 transfer
- [x] 重连后 mux/Gateway stream 重开与 history baseline 重建的真机验证
- [x] WebRTC P2P/TURN 路径真机验证（react-native-webrtc 与 Host werift 互操作）
- [x] 同步协议 conformance fixtures 到 Android 侧校验

`apps/android` 与 Mock Host 曾作为旧 Remote RPC 原型冻结；现在 Android 直接实现/消费官方
ApiProxy / Typert Remote contract，不得在 Plugin Host 恢复 `sessions.*`、`session.send`、
`permissions.respond` 或 `sync.from`。

## 不在本仓库实现

- Server、Remote Web、Admin runtime 及其数据库、队列和部署代码
- Shell、PTY、绕过 dsh-file-viewer provider 的任意文件访问、文件写入、远程桌面或通用 Harness tool RPC
- 绕过 ApiProxy allowlist 的 Cordis service 反射

## 第一版完成标准

- [x] 双角色 Plugin 可安装到真实 DeepSeek Harness 并主动连接外部 Server
- [x] Host 账号授权注册后只使用独立 device credential 常驻
- [x] Desktop Client 使用同账号注册并从授权设备详情固定 Host identity key
- [x] Desktop Client 在真实原生 UI 打开 Remote Workspace 并退出回到 Local
- [x] 原生会话、stream、tool、approval/question 通过 ApiProxy tunnel 正常工作
- [x] 连接断开后旧 stream/answer 失效并安全回落 Local
- [ ] Relay capture 无法解密 payload，篡改、重放和 identity mismatch 被拒绝
- [x] 核心 check/test/build 与 Bundle 校验通过
