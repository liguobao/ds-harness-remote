# TODO

更新日期：2026-10-29。当前源码版本为 `0.6.0`，Android `versionCode 69`，Expo iOS `buildNumber 69`；Tag、npm 与 GitHub Release 状态以实际发布结果为准。

最近一次构建验证见 [AGENTS.md 的 0.5.20 合并后重建记录](../AGENTS.md#post-merge-0520-rebuild-2026-10-27)：全仓 check、847 tests、串行生产 build（含 Android Hermes）、DSH bundle 与打包检查通过。这是既有验证记录，本轮文档清理未重新运行；未新增 APK、原生真机或跨设备验收。Metro noble/hashes exports fallback 警告仍保留。

Harness `0.2.1-rc.1` 为开发基线。保留 `0.2.0-rc.2` / rc.1 的官方 Typert Session V3。
peer range 接纳 `0.2.2` 预发布版。版本范围不代表 runtime 验收通过。
Host 插件、随包 Remote 客户端和 Android 已移除 Harness `0.1.1-rc.2` ApiProxy 兼容。请使用提供官方 Typert Remote carrier 的 Host；仅提供 ApiProxy 或不支持能力发现的旧 Host 会被拒绝，不再降级。CodeX/ACP 保留独立数据面，Desktop 内存投影统一使用 Typert。本轮不改独立 VS Code Client 或独立 Remote Web 仓库。
完整 Server、Remote Web 和 Admin 在独立 Server 仓库实现。
本仓库 `apps/server` 提供最小单账号 Relay Server。

状态规则：勾选项只表示条目所述范围完成。源码实现、自动化验证与真机验收分别记录。
RC.1 的源码适配与本地自动化验证见兼容性说明；不能替代真机验收。

## 2026-10-24 DS Bot 0.2.1 适配

- [x] 固定放行旁问、取消与群聊继续；Android 精确识别 `/btw`，拒绝时不退回普通 Prompt，恢复当前和旧分段旁问卡片。
- [x] 原生图表、公式、输入组件与提交；HTML 摘要降级，不运行模型 HTML/脚本。
- [ ] 真实 0.2.1 Host 的 Desktop/Android 加密跨设备验收：旁问完成/取消、群聊达到上限后继续、分段历史、断线与旧 Host 拒绝、大字体/TalkBack 和图表/滑块交互。

## 2026-10-22 Android Bot 模式

- [x] 主机工作区「＋」左侧 Agent/Bot 切换；原生团队、专属对话、Bot/群聊管理、模型/思考等级、问答、单次审批和交互卡片；复用现有加密 plugin route 与官方 Session 历史。
- [ ] 真机/跨设备验收：ds-bot 0.2.0 创建/删除、群聊实时与历史、会话换段、卡片提交、断线恢复、主机切换、键盘和大屏布局。
- [ ] Bot 专属文案补齐简中/英文之外的语言；当前其他语言回退英文。

## 原生自动化任务（2026-10-27 更新）

- [x] 放行官方 schedule/history、schedule/update、schedule/delete，复用既有列表和事件 carrier。
- [x] Android 已合并自动化任务列表、搜索/状态筛选、规则/记录查看、删除及会话入口（#176）；不代表已完成真机验收。
- [ ] Android 自动化任务、文件选择器（#174）、新会话防抖（#175）与息屏恢复改进（#172）的原生真机及跨设备回归。
- [ ] 更新 Host 插件后，在真实 Desktop/浏览器远程连接中验收任务修改、删除、历史分页和跨 Client 变更刷新；本地契约验证不等于跨设备验收。

## 2026-10-21 移动端精简历史

- [x] 全局持久化开关与新 Host capability 协商；按连接隔离历史精简，保留正文、游标、工具关联和错误状态，模式切换失效旧分页缓存；旧 Host 不做手机本地精简。
- [ ] 重建 APK 后完成真机/跨设备验收：各后端长历史流量与内存、历史翻页、完整/精简切换、重连恢复、运行中审批，以及与 Desktop 并行打开同一会话。

## 2026-10-18 版本审查后续

- [ ] Android 保活修复真机验收：安装重建 APK，确认通知权限与常驻通知、后台/息屏 1/5/15 分钟的 Relay/WebRTC 心跳与消息更新、回前台半开连接恢复、断开后通知与唤醒锁释放；覆盖默认/不受限制省电、Doze 与 Wi-Fi/蜂窝切换。本机类型/契约测试与原生编译不等于这些场景已通过。
  - 同日亮屏切 App 烟测：16:46:11 切入系统设置，16:47:35 返回 Remote；相同进程、FGS 与 wake lock 保持，未出现 carrier error、重新建连或恢复失败。约 84 秒短时切换通过；没有修改省电设置，不替代长时间后台与息屏验收。
  - 2026-10-19 追加修复：每 25 秒通过既有加密 capability RPC 探活（五秒超时），后台沿用最多三次恢复，并在恢复期间保留既有 FGS/Headless task/wake lock；通知显示真实连接阶段，耗尽重试释放服务。Android check、149 tests 与 arm64 Release APK 构建通过。已连接小米手机 16:12 记录 Control error 与网络不可用；息屏快照中服务仍 foreground，但 remote-connection wake lock 被标记 DISABLED，不能把通知存在当作链路存活或认定仅由标准 Doze 导致。长时间/OEM 省电及跨设备验收仍待完成。
  - 同日 16:20 覆盖安装后，保持现有省电设置；16:21 建立 P2P，约四分钟息屏后唤醒于 16:25:47 收到 control-error，16:25:50 已完成新加密连接并更新 connected 通知，聊天恢复，同一进程未退出。约 2.3 秒恢复通过；未修改电池优化白名单，息屏期间 wake lock 仍被禁用，不能将其记为持续联网或 15 分钟稳定性通过。
  - 同日后续系统日志确认小米息屏冻结：16:40:33.987 `Going to sleep`，16:40:39.696 以 `reason: greeze` 禁用本 App wake lock，16:40:39.699 同时记录 `Destroyed live tcp sockets for uids={10440}` 与 `frozen uid = 10440 reason=screen off`。约 5.7 秒即主动断开 TCP；16:40:40.981 唤醒、16:40:41.142 才向 JS 投递 control-error，16:40:44.332 重建 P2P。此前 16:21 与 16:35 两次息屏也在约 5.7 秒后以 greeze 禁用锁。该手机在 FGS/procState 4 下仍受厂商冻结，不能靠 JS 心跳/重连或普通部分唤醒锁保证息屏持续联网；用户要求保持省电设置，未修改白名单或厂商策略。尚需在用户选择的省电策略下验收，不能将唤醒重连成功记作后台保活成功。
- [x] 修复 ACP/CodeX 异步结果隔离、归属回滚、旧 Prompt、OpenCode history reader、Pi 模型确认及文件预览内存限额；全仓 check、689 个测试及生产 build 通过。修复尚未发布。
- [x] 修复 Plugin/Server/Protocol 的 Zod 高危公告：生产直接依赖升级至 `zod@4.6.7`，所有远程数组输入增加明确数量上限，能力发现与工作区目录解析在手动遍历前先做上限校验；协议回归覆盖超限且子项非法的输入。发布包不再包含 `zod@3`。
- [ ] 继续处理 `pnpm audit --prod --registry=https://registry.npmjs.org` 报告的构建链依赖公告（当前仍为 4 high / 1 moderate / 1 low）：Expo/Metro 的 zod、image-size（2 项）、node-forge、uuid，以及 deepmerge。它们不进入 Plugin 生产 bundle；image-size/uuid 需要兼容升级，node-forge/deepmerge 当前无可用修复。不得把构建链依赖视为无风险。
- [ ] 在 Windows、Android APK/真机、独立 Remote Web 与加密跨设备环境回归本轮断线/后端替换修复；本机 check/test/Hermes 构建不替代目标平台验收。

## Harness 0.2.1-rc.1

- [x] 升级依赖/锁文件；按已认证连接绑定并释放官方 Peer，覆盖 RPC、Remote events 与 Fetch 路由。
- [x] 兼容官方 terminal/attach 的双向输入确认，保留现有 Remote 终端协议、设备/连接归属及断线不重放；补齐新版 Session projection 结果与 CodeX/ACP 内存读取。
- [x] RC.1 官方 Gateway/Peer 契约与核心终端回归、全仓 check/test。
- [ ] Desktop UI、Android APK/真机、独立 Remote Web，以及加密跨设备的 Prompt、审批、终端恢复与文件预览验收。

## Pi Agent ACP（Issue #97）

- [x] 注册默认自动检测、初始化成功才可用且尊重明确关闭的 `pi` 后端（`pi-acp`），独立 capability、Desktop/Android 内存工作区与会话投影。
- [x] 本机安装 Pi Agent 与 ACP wrapper，使用已有 OpenAI 兼容配置完成真实 CLI 对话及 Gateway 创建会话、流式工具回复、历史读取与归属拒绝验证。
- [x] Pi 工具审批与历史复核：真实模型触发扩展 confirm，单次拒绝不执行/允许一次；跨连接抢答、断线和重放拒绝。真实 Gateway → ACP Client → Desktop 内存投影验证工具输出、重启历史、分页与继续聊；修复历史失败伪空结果、工具输出/错误丢失及并发历史读取。上游未重放的 thinking、原始输入/ID/时间不宣称无损恢复。
- [x] 修复首次 load 的历史混入 live、准备阶段取消后仍启动 Prompt、Android 历史覆盖本代 live/审批、Desktop 错误/中断被标记完成，以及后端标签恢复条件；核心代际/恢复矩阵与真实本机重启后首载无重复烟测通过。
- [ ] Windows、独立 Remote Web、Android APK/原生真机及真实加密跨设备恢复验收。不要把本机 Gateway 烟测视为这些目标已通过。

## Claude Code ACP（Issue #125）

- [x] 创建 [Issue #125](https://github.com/liguobao/ds-harness-remote/issues/125)，开始 Host `claude` 后端与专用 ACP stdio adapter 接入，默认关闭。
- [x] 完成 Desktop Plugin 与 Android Claude 工作区/会话内存投影、独立后端识别、历史恢复与模型切换；独立 Remote Web runtime 另行接入。
- [x] 复用已有 OpenAI 兼容端点/凭据与 `gpt-6-sol` 完成真实 Claude ACP 初始化、文字对话及本机 Gateway `Write` 工具拒绝/单次允许；同会话第二次工具调用重新审批，真实句柄的跨连接、持久授权、result 越权及重放被拒绝。
- [x] Claude Host 中断、catalog/load 与独立有界 history：真实待审批 Write 取消后旧句柄失效/无文件；Bash 运行期间 history 不打断 turn，随后返回 cancelled；Gateway/adapter 进程重启后 catalog/load/history 与上下文继续对话通过。
- [ ] Claude 独立 Remote Web、重连 UI 实机、Windows、APK/真机及加密跨设备验收；本机兼容模型测试不代表 Anthropic Claude 模型或完整产品验收。

## 当前执行顺序

1. P0：对齐协议 schema，完成安全审查与真实 Relay 拒绝验证。
2. P0：完成当前 Harness 版本的跨设备问答、Mods 与代理 SSE 验收。
3. P1：补齐网络切换、stream 与 history 恢复。
4. P1：完成 `0.5.8` 终端与 Android 文件预览的跨平台验收。
5. P1：核对 ACP 历史与恢复缺口，完成跨设备继续聊验收。
6. P2：完善 VS Code、系统安全存储、诊断导出和部署验收。

## 领域模块拆分与审查（2026-10-17）

打包产物和生成文件不计入拆分目标。

- [x] 四个超过 2000 行的手写源码完成首轮领域拆分；保留协议、入口与单一连接/流状态所有者。
- [x] Harness 生命周期测试隔离本机可选 Agent CLI，原测试与断言保留。
- [x] 账号目录刷新：阻止退出/切换账号后的旧成功、旧鉴权错误和凭据清理影响新账号。
- [x] 工作区创建/修改：统一各后端成功与错误分支的连接代次、实例及操作归属检查。
- [x] Android store、CodeX/ACP virtual Harness、Plugin client runtime 按功能进一步拆分；四个入口和第二轮新增模块均低于 1000 行，共享状态保持单一所有者。
- [ ] 继续拆分 Plugin 工作区选择/OAuth 流程和 Android composer；先明确取消和状态归属。

## P0：当前 Harness 兼容验收

- [ ] `0.2.1-alpha.1`：真实 Desktop / Android 加密跨设备限时问答、补答与 Mods 展示验收。
- [ ] 后续 `0.2.2` RC：实际发布后验证官方 carrier、依赖和跨版本连接。
- [ ] 带路径前缀代理：真实反向代理下验证 Remote SSE 断线恢复。
- [ ] Harness `0.2.1-alpha.4`：跨设备验证 Gateway Peer 转发修复。
- [ ] 维护支持版本矩阵。分别记录开发依赖、范围接纳、自动化验证与真机验收。

Desktop 已使用独立 Remote 工作区入口：本地选择账号下的 Host 与远端 Workspace，或通过
只读目录浏览添加 Workspace，随后复用原生 Harness UI。当前实现已跑通真实设备、Web→Host
主链路和独立 Server 跨仓库联调，具备开发预览发布条件；后续重点转为安全审查、恢复策略、跨平台矩阵和长期稳定性。

测试预算只用于协议、安全、账号授权、认证连接、ApiProxy/Typert Remote allowlist/stream 生命周期和核心
transport 状态机；普通 UI、文案和辅助脚本不单独补测试。

## 已完成基线

- [x] Issue #70：Plugin 刷新跨进程互斥、握手恢复单次重试、重复 Host 连接停止抢占及授权恢复提示
- [ ] Issue #70：Windows 双实例与异常退出遗留锁的实机回归（已有进程级锁与状态机测试）

- [x] pnpm monorepo、共享 Protocol/Crypto/Transport/Client Core
- [x] Host 账号密码/主机匹配码接入、Client 账号接入、device token rotation 与按 Server/角色隔离的身份状态
- [x] 同账号 membership、受保护 peer descriptor 与本地 pinned trust 双重授权
- [x] Relay control、标准 Noise IK、counter/replay 拒绝与 opaque ciphertext
- [x] Desktop Plugin Host runtime、Settings 配置和 GitHub/npm Bundle 入口
- [x] dsh-TUI profile 在无 Desktop `connection` 服务时默认启动 Host，并通过原生 `/remote` 的 `login [github|zhihu]`、`status`、`logout` 完成终端授权和状态管理；`ds-harness-remote` 保留为启动前 CLI
- [x] 历史 Host ApiProxy bridge 与 switch（2026-10-25 已移除）
- [x] Harness v0.1.2 alpha.1–rc.1 Typert Remote unary/stream/event carrier、固定 endpoint allowlist、加密 capability 探测；rc.2 ApiProxy 激活分支已移除
- [x] Harness v0.1.5 rc.1 / v0.2.0 rc.1 Session V3 capability、严格 surface replacement、Assistant stream 与 v0.1.2/V3 mutation 前混连拒绝
- [x] 升级官方依赖到 `dsh-v0.2.0-rc.1`，修正 0.2.0 版本判断、Workspace payload 与原生 UI allowlist，并完成 Plugin 核心回归测试
- [x] 历史 Android / VS Code 双数据面接入（2026-10-25 Android 已移除 rc.2，VS Code 暂保留）
- [x] Remote 模态框、主机自过滤、OS/Harness/Plugin 版本展示、远端 Workspace 与目录选择
- [x] Remote Header、LAN/P2P/TURN/Relay 链路、端到端加密状态与退出入口
- [x] 配合 dsh-file-viewer 的远端只读文件 stat/list/分块预览桥与 Client provider
- [x] 不同 Web Client 同时连接一个 Host；RPC、stream 与断开清理按 connectionId 隔离
- [x] Web → Host 主链路真实环境验证：账号授权、Host presence、Remote Workspace、Session/Prompt/approval 与断开回落
- [x] 独立 Server 跨仓库联调：REST、Control WebSocket、Relay、Signaling、conformance fixture 与 membership/IDOR 防护
- [x] 删除自定义 Session/Agent/Workspace/Permission adapters、event replay 和旧 Host RPC 路由
- [x] GitHub Actions 使用 Node.js 22 和 pnpm 9.15.4 执行 build、check、test 与 Bundle 校验

## P0：Plugin 可用链路

- [ ] 单一安装入口实机回归：Linux root 干净 x64/arm64 上的 Node.js/DSH 引导、真实一次性 Token 注册、systemd 系统服务立即启动/重启自启及客户端在线确认；macOS 已有 CLI/Desktop launcher、desktop/web profile 选择和注册回归。模拟下载/systemctl 与回环 API 烟测不等于目标机验收；Windows 使用官方插件管理或命令，不维护专用脚本。

- [x] 在真实 dsh-desktop 中验证 GitHub 安装、重启、Host/Client 配置和 Bundle 入口
- [x] 在真实 dsh-TUI alpha.2 profile 中验证 `/remote` 补全、GitHub/知乎扫码、上线与跨机 Session/Prompt/approval
- [x] 分别用 `dsh-v0.1.1-rc.2`、`dsh-v0.1.2-alpha.1` 与 `dsh-v0.1.2-alpha.2` 跑通双机 Workspace/Session/Prompt/approval E2E，并验证混合代际在 mutation 前拒绝
- [ ] 核定旧版 Harness 的维护范围。逐项决定以下历史验收是否仍需执行。
- [ ] 历史待验收 `dsh-v0.1.2-rc.1`：Desktop/dsh-TUI 跨机会话与长期稳定性。
- [ ] 历史待验收 `dsh-v0.1.5-rc.1`：跨机会话、CodeX replacement/stream 与重连。
- [x] 用独立 `dsh-v0.1.6-alpha.1` 实例跑通 Web → Host 主链路（Plugin 树加载、Host identity、Codex 域与 client bundle 下发）
- [ ] 历史待验收 `dsh-v0.1.6-alpha.1`：跨机会话、CodeX replacement/stream 与重连。
- [x] 用两台真实 Harness + 外部 Server 跑通同账号授权、选择 Remote、创建/继续会话
- [x] 验证原生 mux/host stream、approval/question respond 与断线关闭行为
- [x] 用手机 Web 与电脑 Web 同时连接一个真实 Host，验证并发操作、同设备重连和流隔离
- [ ] 验证 allowlist 覆盖官方 UI 的必需方法；允许已认证 Remote peer 通过官方 seam 管理 Host 实时注册的 settings 命名空间与全局 credential 引用（credential 值只写），并保持 `settings.openDocument`、native path、任意文件访问及通用 attachment upload/download 禁止；官方 `workspace/create` 目录创建和独立 `workspace.upload.v1` 按协议限定范围
- [x] 用两台真实 Harness 验证 dsh-file-viewer 文本、图片、PDF、大文件分块与断线回落
- [ ] 在 macOS、Windows、Linux 验证 native picker 只读目录兜底、symlink、权限错误和大目录截断
- [ ] 完善账号过期、`DEVICE_OWNERSHIP_REQUIRED` 和 legacy owner 的显式恢复体验
- [x] transport 关闭后 pending unary/stream 立即返回稳定错误，并清理 timer 和 abort listener

## P1：Agent ACP / Cursor / Antigravity（实验）

- [x] [OpenCode 原生归档](design/acp-session-archive.md)：直接调用同一 ACP 进程的认证 loopback HTTP API，持久状态由 OpenCode 管理；固定 capability/扩展、可信 cwd、并发隔离、跨连接事件与 Desktop/Android 确认后更新。
- [x] OpenCode ACP 启动按 CLI 参数能力检测，兼容带网络参数与纯 stdio 构建；无原生 HTTP API 时归档明确不可用，列表/历史继续工作。修复尚未发布。
- [x] OpenCode 共享浏览器内存投影接收标准标题事件，回复后限时恢复异步标题，占位标题用首条提问临时替代并从历史恢复；保护手动改名和迟到目录读取。独立 Remote Web 需同步投影并部署，真实模型命名与跨设备验收仍待完成；本机隔离 `2.0.32` Prompt 尝试遇到上游模型错误。
- [x] 核实官方 OpenCode v2 已改用 `@opencode/cli`；真实 `2.0.32` 隔离验证初始化、新建、列表、42 个模型目录与模型切换、独立历史及重启恢复。v1 `1.19.3` 原生归档回归通过；v2 无该私有 HTTP API，归档明确不可用。未发送 Prompt，跨设备验收仍待完成。
- [ ] OpenCode 归档的 Windows、APK/真机及加密跨设备 E2E；独立 Remote Web 在 Server 仓库同步。恢复/已归档列表与其他 ACP 后端原生归档仍未实现；不得将 `session/delete` 当作归档。
- [x] OpenCode 模型目录与切换使用真实 ACP 上游响应，按会话隔离；Pi / AGY / OpenCode 投影只提交确认状态，Android 接入 AGY 模型/思考强度。
- [x] Cursor / Claude Remote 真实模型目录与上游确认的切换，Cursor 按会话隔离进程；Claude Desktop/Android 工作区、历史与文字会话入口。
- [ ] Cursor / Claude 模型选择的 APK/真机、Windows 与加密跨设备验收。
- [ ] OpenCode 模型切换及 AGY Android 模型选择的 APK / 真机 / 加密跨设备验收。

通用 `agent.acp.*` gateway 已接入 Cursor 与 Antigravity adapter。技术说明见
[docs/acp-remote.md](acp-remote.md)。**暂不**推进 Codex→ACP adapter。

- [x] Host gateway、capability、allowlist、Cursor stdio adapter
- [x] ACP Web 兼容边界：独立 API/事件、浏览器安全内存投影、远端历史分块与后端工作区 ID 隔离
- [ ] 独立 Remote Web 的 AGY 接入与跨设备回归（在独立 Server 仓库完成 runtime 变更）
- [x] ACP 后台初始化与 Harness Remote 启动隔离；各后端独立遵循启用开关、command/args/cwd，明确选择不可用后端时 fail closed
- [x] Desktop Virtual Harness 与设置开关（默认关闭）
- [x] Android 内存 Workspace/Session/Chat 投影与文本 Prompt 流式
- [x] inbound 订阅生命周期、`prompt_completed` catch-up、多轮气泡分离
- [ ] 核对 Desktop 与 Android 的 ACP stream 重建及会话 claim。补齐缺失路径。
- [x] Android：重连保留 Cursor workspace/session，并自动 `stream.open`
- [ ] 按 Cursor / Antigravity 核对 Host History 分页。补齐 Android/Desktop 恢复缺口。
- [ ] 按后端核对 `session/load` 与会话列表。验证跨设备继续聊。
- [ ] 审批 / 提问真机矩阵与长工具轮次稳定性
- [ ] Desktop ↔ 异机 Client 完整 E2E

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
- [x] 增加 Typert 内存虚拟载体（旧 rc.2 投影已移除），将 CodeX History/live 映射为原生 Session 事件
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
- [ ] 用真实 Desktop 与 Android 回归 CodeX 重连历史错误、busy/超时后的重试；Desktop 另验证原会话内存恢复、原生跨工作区导航及断线/退出账号与迟到 open 的交错（本轮核心契约测试不等于跨设备验收）
- [ ] 用真实 Desktop 与 Android 验证远端 `project/create`、新增后自动选择和空 CodeX 目录首个项目流程

## P0：协议与安全

本地集成验证不替代真实跨设备验收。

- [ ] 将 `packages/protocol` 与 `docs/protocol.md` 的 Control、Account Authorization、Connect、Relay、ApiProxy tunnel、Error 和 Limits schema 逐项对齐
- [ ] 拒绝原始 JSON 中重复的安全字段。分别核对 Control 与 REST 入口。
- [ ] 对齐 Connect 公钥格式与 Handshake/Relay 的规范 Base64URL 校验。
- [ ] 明确握手 step、heartbeat 数值与标识符范围。同步 schema 和共享 fixtures。
- [ ] 清理协议第 22 节的 `connection.ping` 冲突说明。区分 replay/rekey 目标与实现状态。
- [x] 清理仅供冻结 Android 原型使用的旧 Session/Event 类型（PR #54, commit 5304fcd + 8ad988b）
- [x] 固定 hello/hello.ack 版本拒绝、capability 协商与 Control/Relay frame 上限
- [x] 拒绝超限 Control/Relay frame 和 binary Control frame
- [ ] 完成 Noise 实现的独立安全审查。
- [ ] 定义并实现长期连接 rekey 与连接最大生命周期。
- [ ] 核对断线密钥清理。补齐清理策略与核心测试。
- [ ] 增加剩余协议 golden vectors
- [x] 增加 Noise IK golden vector
- [x] 补齐 counter 安全整数边界与 Control/Relay frame limit 测试
- [ ] 补齐真实 Relay 链路的篡改、重放和错误 identity 跨层验证
- [x] WSL 本地 Server/WebSocket 验证密文篡改与提高 counter 后的重放拒绝。
- [x] WSL 本地 Relay 验证错误静态公钥与连接 prologue 的 Noise 握手拒绝。

## P1：Transport 与恢复

- [x] Host 与 Relay/Adaptive transport 响应 Control ping。Host 状态提供最后活动时间。
- [ ] 核对各端 heartbeat 超时处理。补齐 RTT 与错误分类。
- [x] 完成 WebRTC offer/answer/ICE、STUN/TURN、短期 credential 与 Relay fallback 基础链路
- [ ] 完善 `connecting -> direct -> relay -> reconnecting -> offline` UI 状态机和网络切换恢复
- [ ] 核对 direct 超时和 Relay fallback。验证切换不重复提交 Typert mutation。
- [ ] 核对 Desktop 重连后的官方 stream 与 history baseline 恢复。补齐缺失路径。
  - WSL 模拟已覆盖旧 stream 中断、新连接重订阅，以及从 Host 读取新的快照和历史。已修复关闭后清理 RPC 等待超时。真实 Desktop 验收仍待完成。
- [ ] 验证休眠唤醒、Wi-Fi/蜂窝切换与高延迟 Relay。检查 Prompt 和审批不重放。

## P1：跨仓库 Server 联调（已完成）

- [x] 持续同步 `server.md`、`protocol.md` 与 Host Plugin 接入契约
- [x] 冻结 REST、Control WebSocket、Relay 和 Signaling 合约
- [x] 在两仓 CI 使用同一组 conformance fixtures
- [x] 验证 Server 无法解密 ApiProxy payload，且 host registration code/token/membership/IDOR 防护成立

## P2：工程与发布

- [ ] Plugin 使用系统 Keychain/Secret Service 保存身份私钥和 refresh token。VS Code 已使用 SecretStorage。
- [ ] 完成多窗口、休眠/唤醒、代理网络和系统浏览器账号授权
- [x] 根包声明 MIT License。Plugin 与 Android 已使用版本号及发布记录。
- [ ] 明确发布渠道、实验能力标记与版本维护期限。兼容验收见支持版本矩阵任务。
- [ ] 提供脱敏日志导出和真实设备长连接性能基线
- [ ] 修复 Android Metro 对 `@noble/hashes/crypto.js` 的 package exports fallback 警告。

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

`apps/android` 当前仅使用 Typert Remote Harness 数据面，并接入可选 CodeX Remote：账号登录注册、成员设备列表与 identity key
固定、Adaptive transport + Noise secure channel、`harness.api.*` 或 `harness.remote.*`
tunnel 与 mux/Gateway frame 聊天。功能已对标 Web 端 Remote 控制台：新建/继续/归档会话、历史分页、
模型目录与切换、相册图片 Prompt（Host limits 预检 + transfer 分块）、Workspace 管理（创建+只读目录浏览/重命名/删除/排序）、连接详情面板与
传输偏好（Auto/TURN/Relay），以及跟随系统/英文/简体中文/日语/繁体中文/西语/德语/法语语言设置。CodeX 侧直接消费独立
`codex.app.*`，使用 `project/list` Workspace 或精确的 `thread/list.cwd` 后备 Workspace、分页 History/独立 stream、模型/权限、图片 Prompt、
interrupt 与单次审批，不恢复旧 Android RPC。剩余工作：

- [x] 数据面端到端联调（本地 Server + 真实插件 Host + smoke client）：账号授权、加密 Relay、
      mux 流、会话列表、`host.describe` 透传与 approval `client-response` 应答
- [x] 更新 smoke client：优先选择在线 Host（presence 探测）、按插件 bridge 的嵌套帧类型匹配
      `assistant/chunk`（原实现永远匹配不到）
- [x] 真机/模拟器 UI E2E：账号登录、设备列表、连接、会话与聊天
- [x] 真机验证 Android Photo Picker 多选、超限提示与大图片 transfer
- [x] 重连后 mux/Gateway stream 重开与 history baseline 重建的真机验证
- [x] Android 前台断线有界恢复：最多三次重试、Auto WebRTC 掉线改走新 Relay、当前 CodeX 会话历史/订阅恢复且不重发 Prompt；连接替换与协议拒绝停止自动恢复
- [ ] 本轮前台恢复真机验证，并用不含消息内容的 carrier/secure-receive、网络切换和 Harness stream 诊断确认断线触发原因。2026-10-19 arm64 release APK 构建及同签名覆盖安装通过；13:35 的 Control 1012 已由用户确认是 Server 重启，14:04 再次记录 1012，其后三次自动恢复未成功。13:40:36 捕获到解密/重组后的 `message-handler` 异常并主动关闭通道；14:06:20 又捕获到进程退出，Hermes sourcemap 确认为 `Maximum update depth exceeded`，堆栈落在 VirtualizedList 更新调度。14:11:42 旧诊断版再次捕获 `message-handler` 错误，sourcemap 映射至相同 React 更新深度检查，经 Zustand listener 和 `session-event-actions.ts` 的 CodeX 状态发布抛出，解释了消息处理器关连接与列表定时器致进程退出两条路径。已合并 CodeX 流更新、跳过未变化投影、保留未变化消息引用并隔离旧订阅；事件顺序/完成前刷新/旧订阅隔离等 40 项相关测试与 Android 类型检查通过，修复 APK 已覆盖安装。14:13–14:17 真机回归由用户确认完整回复与操作正常，同一进程无渲染/接收异常；期间另有网络不可用和 Control 1011 关闭，随后均建立新连接。该轮通过不等于长期稳定性验收，Server 关闭原因与长时间/后台/网络切换仍待验证。
- [x] WebRTC P2P/TURN 路径真机验证（react-native-webrtc 与 Host werift 互操作）
- [x] 共享 Protocol 包统一执行协议 conformance fixtures；Android 保留自身授权、加密连接与恢复测试
- [ ] 在 Android 原生 runtime 执行跨端 conformance（Node 中共享协议测试不作为原生验收）

`apps/android` 与 Mock Host 曾作为旧 Remote RPC 原型冻结；现在 Android 直接实现/消费官方
Typert Remote contract，不得在 Plugin Host 恢复 `sessions.*`、`session.send`、
`permissions.respond` 或 `sync.from`。

## 不在本仓库实现

- 完整多账号 Server、Remote Web、Admin runtime 及其数据库、队列和部署代码（`apps/server` 最小自部署版本除外）
- 绕过官方 Session 文件系统或 dsh-file-viewer provider 的任意文件访问、独立文件写入 RPC、远程桌面或通用 Harness tool RPC；用户明确授权的原生 terminal、受限 loopback 预览、`workspace.upload.v1` 及官方 `workspace/create` 目录创建除外，边界以协议为准
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

## 最小自部署 Server

- [x] 环境变量单账号、登录/状态页、持久化设备凭据、Control/加密 Relay 转发
- [ ] 完成 Docker 镜像构建与容器启动验收。记录健康检查和凭据持久化结果。
- [ ] 真实 Desktop/Android/VS Code 跨机 E2E 与反向代理长期连接回归

## 原生侧栏与开发预览（2026-09-20）

- [x] alpha.2 官方只读文件树/预览 API allowlist、默认开启且可在详细 Remote 设置中关闭的原生终端开关
- [x] 终端按设备归属、连接 attachment 校验；禁止 Remote 修改插件自身访问设置
- [x] CodeX / ACP 共用终端控制器：Host 默认交互 shell 与可选 shell、xterm 屏幕恢复、幂等创建、有界订阅和等待进程清理
- [ ] 验证 CodeX / ACP 终端的 Desktop / Android 加密跨设备流程。
- [ ] 验证 Windows/Linux PTY、shell 配置、resize 与 job control。单独记录 pipe fallback 限制。
- [ ] 验证无窗口持有者与 follower 时的两小时 idle 回收。验证活跃终端保持运行。
- [x] 白名单 IPv4 loopback HTTP/WebSocket 通道与独立本机预览 origin
- [ ] 接入 Harness 浏览器地址解析前的异步导航扩展点，将远程模式下的 localhost/端口输入转为已授权的 Remote 预览 URL。当前仅有后端 preview.open，无前端入口；暂时隐藏远程模式下原生侧栏开始页的浏览器入口，避免误访问 Desktop 本机。此隐藏不禁用已有浏览器标签页、快捷键或聊天链接打开。
- [x] Relay 背压、串行加密发送、有界 stream 消费队列
- [ ] Windows/Linux 真机、跨机高延迟 Relay、大输出终端、多设备回归
- [ ] 真实应用复杂 HMR、硬编码 localhost、Cookie/CSP 和浏览器兼容性回归
- [ ] Remote Web / Android / VS Code 预览入口（需独立方案，不复用本机 preview URL）

## Android native session tools (2026-09-21)

- [x] 兼容旧版内嵌 permissions.options 与新版 permissionPresets/catalog，补齐 Host 只读 allowlist
- [x] Harness 会话工作区目录浏览、UTF-8 分页只读预览；不支持的 Host 显示更新提示
- [x] Android 本地 xterm 终端、创建/恢复/结束、归属与输入权隔离、序号检查和断线不重放
- [ ] 真机验证新旧 DSH 权限切换、Host 热开启/关闭终端、跨机重连、Windows 路径与 shell、长输出、IME/TalkBack/大字体
- [ ] #159 Android 历史附件与 Markdown 工作区图片真机/跨设备验收：Typert 大图、AI/工具图片、全屏、取消与重连；单独复现并定位 PNG 发送报错。
- [ ] Android 图片/PDF/Office 只读预览真实 Host 与真机验收：大文件、转换超时/字体缺失、取消与断线、内存峰值、分页缩放
- [ ] PDF 文本选择与 TalkBack 验收（当前已有受限文本叠层，真机未验证）

## Android AGY (2026-10-07)

- [x] AGY 工作区/会话 catalog、空白新会话、历史/图片、流式、标题刷新与重连恢复
- [ ] Android AGY APK 与真机/加密跨设备回归；每目录超过 100 个会话的分页体验
