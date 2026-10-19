## Unreleased

- Fix sidebar footer layout corruption on Harness 0.2.x: Remote styles only its own official footer-slot entry, without overriding host CSS Modules classes or legacy better-sidebar account/connection rows. Expanded entries can shrink beside other actions; collapsed entries keep a 36 px icon seat. The active entry keeps Exit in normal flow so long host names can shrink without overlapping it.
- 修复 Harness 0.2.x 侧栏 footer 布局错乱：Remote 仅设置官方 footer slot 内自身入口的样式，移除对宿主 CSS Modules 类名及旧 better-sidebar 账号/连接条的覆盖；展开入口可与其他按钮并排收缩，折叠入口保持 36 px 图标区域；远程状态下退出按钮参与正常布局，长主机名收缩时不会与其重叠。

## 0.5.14 - 2026-10-19

- Unifies first-party package/client versions at `0.5.14` (tag `v0.5.14`); Android `versionCode` and Expo iOS `buildNumber` advance to `58`.
- 自有包与客户端版本统一为 `0.5.14`（Tag `v0.5.14`）；Android `versionCode` 与 Expo iOS `buildNumber` 升至 `58`。
- Release validation: workspace type checks, 732 tests, production builds including Android Hermes export, version consistency and DSH bundle checks pass. The local Desktop build was confirmed by the user; APK generation and publication run in the release workflow.
- 发布前全仓类型检查、732 项测试、生产构建（含 Android Hermes export）、版本一致性与 DSH bundle 校验通过；本机 Desktop 修复版本已由用户确认。APK 生成与发布由 Release 工作流执行。

- Add a Save button beside the Remote sign-in Server address. Saving applies the Server and refreshes its sign-in methods automatically, discarding the previous QR flow and pending discovery results.
- Remote 登录面板的 Server 地址旁增加“保存”；保存后应用地址并自动刷新登录方式，清理旧二维码流程与迟到的登录方式结果。
- Animate the text suffix during Android connection/recovery (`.` → `..` → `...`) on the connection page, workspace recovery state and chat banner. Reserve the suffix width and keep timer updates inside the small suffix component. Type checking and arm64 Release APK build passed; the updated APK was installed and consecutive native screenshots confirmed the changing suffix on the connection page. No presentation-only tests added.
- Android 连接页、工作区恢复状态和聊天重连提示在原有文字后增加 `.` → `..` → `...` 动画，预留宽度防抖动，定时刷新仅作用于省略号组件。类型检查与 arm64 Release APK 构建通过，覆盖安装后连续真机截图确认连接页省略号变化；未新增纯展示测试。
- On the attached Xiaomi phone, switching to system Settings for about 84 seconds with the screen on retained the connection, process, foreground service and wake lock; returning did not trigger reconnection. This short app-switch check does not cover long background duration or screen-off freezing. Battery settings were unchanged.
- 已连接小米手机在亮屏状态切到系统设置约 84 秒再返回，连接、进程、前台服务与唤醒锁保留，未触发重连；保持现有省电设置。该短时切 App 验证不代表长时间后台或息屏冻结已通过。
- Synchronize Remote account sign-out with the already mounted settings page. One sign-out waits for both Host and Client cleanup and clears both credential stores even if revocation fails; Remote teardown rejects stale connection/workspace results and still closes the carrier when stream or preview cleanup fails.
- 修复 Remote 面板退出账号后设置页仍保留旧授权的问题：账号变化通过现有状态推送同步；一次退出等待 Host/Client 清理并清除两份凭据，单项撤销失败不跳过其他清理。退出后拒绝迟到连接/工作区结果，流或预览清理失败仍关闭底层连接。隔离浏览器烟测通过，真实 Desktop 跨设备验收待完成。

- Verify Android's encrypted Host path every 25 seconds with a five-second deadline, and run bounded recovery while backgrounded. Retain the existing foreground service across recovery attempts, publish connecting/connected/reconnecting notification states, and release it after exhaustion or explicit disconnect. Type checking, 149 Android tests and arm64 Release APK build passed; long screen-off and OEM battery-policy acceptance remains pending.
- Android 每 25 秒检查加密 Host 链路（五秒超时），后台同样执行有界重连；恢复期间复用既有前台服务与唤醒锁，通知同步连接中/已连接/断线重连状态，耗尽重试或主动断开后释放。类型检查、149 个 Android 测试及 arm64 Release APK 构建通过；长时间息屏与厂商省电策略仍待真机验收。
- After an in-place install on the attached Xiaomi phone with battery settings unchanged, a roughly four-minute screen-off/wake cycle delivered a carrier error and recovered the connection / chat in about 2.3 seconds without restarting the process. The wake lock was disabled by the system while asleep; this verifies that recovery only, not continuous screen-off networking or long-term stability.
- 保持小米手机现有省电设置，覆盖安装后约四分钟息屏/唤醒复测捕获 carrier error，约 2.3 秒后自动恢复连接、通知和聊天，进程未重启。息屏时系统仍将唤醒锁标记为 DISABLED；该结果只验证本次恢复，不代表息屏网络持续可用或长期稳定性通过。
- Follow-up Xiaomi system logs confirmed `greeze` froze the app and destroyed its live TCP sockets about 5.7 seconds after screen-off, despite its foreground service. Errors arrived after waking; continuous screen-off connectivity remains unresolved under that device's unchanged power policy.
- 后续小米系统日志确认 `greeze` 在息屏约 5.7 秒后冻结 App，并直接销毁其 TCP sockets，前台服务仍存在；错误在唤醒后投递。在现有省电策略下，息屏持续联网仍未解决。

- Load Android workspace/session catalogs only for the opened backend category; connection setup now probes availability without loading every backend. Refresh stays within the current category, category failures stay inline, and retired category requests cannot replace the current list or error. Home shortcuts load only their target backend. Type checking, 147 Android tests and APK build passed; the attached phone verified CodeX/OpenCode category switching and CodeX refresh without the OpenCode failure banner. OpenCode still returns its existing upstream internal error when opened.
- Android 工作区/会话目录改为点击顶部分类后按需加载；连接设备仅探测可用能力，不再预加载所有后端。下拉仅刷新当前分类，错误显示在对应分类内，切换后忽略旧分类迟到结果；首页快捷入口仅加载目标后端。类型检查、147 个 Android 测试和 APK 构建通过；已连接手机验证 CodeX/OpenCode 分类切换及 CodeX 下拉刷新，OpenCode 错误不再跨分类显示。打开 OpenCode 后，其既有上游内部错误仍存在。

- Place Android's global error banner below the system safe-area inset with its own overlay layer; expand close/retry targets to at least 44 dp so status-bar gestures and screen headers cannot block dismissal. Native device acceptance remains pending.
- Android 全局错误条按系统安全区移到状态栏下方，以独立浮层显示；关闭/重试按钮点击区域至少 44 dp，避免系统状态栏和页面标题栏遮挡点击。原生真机验收待完成。
- Keep the Android chat at the latest reply when keyboard/composer layout or measured message content changes. Only user scrolling changes follow intent; coalesce scroll commands with a trailing update so the final reply measurement is retained. Type checking and APK build passed; after an in-place install, the user confirmed on the attached phone that opening the keyboard keeps the reply bottom visible and scrolling up preserves the reading position.
- Android 聊天在键盘/输入栏布局或消息实际尺寸变化后继续跟随回复末尾；仅用户滚动改变跟随意图，合并滚动并保留最后一次更新，避免漏掉完整回复的最终位置。类型检查与 APK 构建通过；覆盖安装后，用户在已连接手机上确认弹出键盘仍能看到回复底部，手动上翻后保留阅读位置。
- Show connection loss/recovery on the Android workspace screen instead of a false “No workspaces yet” state. Offer reconnect and return-to-devices actions, hide creation/management while disconnected, and reload catalogs before showing the list again. Reconnecting from this screen does not reopen the previous conversation.
- Android 工作区页断线后显示连接中断/恢复状态，不再误报“还没有工作区”；提供重新连接和返回设备列表，断线期间隐藏新建/管理操作，连接并重新读取目录后再显示列表。从此页重连不主动打开上一段对话。
- Coalesce Android CodeX stream notifications in order, skip unchanged projections, and update only changed history items. Completion and approvals drain pending deltas; retired subscriptions cannot update a reopened session. Stabilize empty chat artifact props to reduce list churn. Device stacks linked both a receive-handler disconnect and a VirtualizedList crash to React's update-depth limit. The rebuilt APK passed one complete live reply on the attached phone; long-running and background validation remains pending.
- Android CodeX 连续流事件按顺序合并更新，跳过未变化投影，仅更新变化的历史项；完成与审批前处理完待刷新增量，旧订阅不能污染重开的会话。聊天空 artifact 属性保持稳定。真机堆栈确认消息处理器断线与列表崩溃均涉及 React 更新深度上限；重建 APK 后用户确认一轮完整实时回复与操作正常，长时间与后台验收仍待完成。

- Hide unavailable Android message usage and unsupported CodeX feedback/branch actions. Show CodeX message timestamps from upstream/history when available, otherwise retain the first local receipt time for live messages. Native APK/device acceptance remains pending.
- Android 消息用量无数据时隐藏；CodeX 隐藏不支持的点赞、踩和分支操作。消息时间优先使用上游/历史时间，实时消息缺少上游时间时保留首次本地接收时间；原生 APK/真机验收待完成。
- Apply the same cleanup to all Android workspace types: remove feedback buttons, keep branching only for delivered Harness messages with an event sequence, and share timestamp display between chat and trajectory. ACP history preserves missing timestamps as unknown; matching live/history rows retain known history times.
- Android 所有类型工作区统一移除点赞/踩，仅为带原生事件序号且已送达的 Harness 消息保留分支；聊天与轨迹统一显示时间。ACP 历史缺失时间保持未知并隐藏，实时消息使用首次接收时间；历史与实时合并时保留已知历史时间。
- Recover Android foreground carrier loss with up to three delayed attempts, Relay recovery for Auto WebRTC paths, and selected-session/history restoration without replaying prompts. Stop automatic retries on protocol/security refusals or connection replacement; hide the offline thinking indicator. Add payload-free carrier/secure-receive diagnostics. APK/device validation remains pending.
- 修复 Android 前台通道断开后只能手动重连的问题：最多延迟重试三次，Auto 下 WebRTC 掉线走新 Relay 连接，恢复当前会话及历史，不重发 Prompt。协议/鉴权拒绝与连接被替换停止自动恢复；断线时隐藏“正在思考”，补充不含消息内容的断线诊断。APK 与真机验收待完成。
- Repairs Android background connection service ownership: request Android 13+ notification permission, start before authentication awaits, keep RN timers eligible through a service-owned Headless JS task, and hold/release a partial CPU wake lock with the active carrier. Native startup failures reach the connection UI; retired connection callbacks cannot stop a replacement service.
- 修复 Android 后台连接保活：补齐 Android 13+ 通知权限，在异步鉴权前启动服务，通过服务归属的 Headless JS task 保持 RN 定时器运行，并按连接生命周期持有/释放 CPU 部分唤醒锁。原生启动失败传回连接界面；旧连接的迟到回调不能停止新连接的服务。
- On resume, verify a bounded encrypted capability round trip before retaining a locally open socket; restore the selected session through existing reconnect when unhealthy. Requires a rebuilt APK; screen-off/Doze/OEM device acceptance remains pending.
- 返回应用时通过有界加密 capability 请求确认链路，半开连接走既有重连并恢复会话。需重建 APK；息屏、Doze 与厂商省电策略的真机验收待完成。

## 0.5.13 - 2026-10-19

- Unifies all first-party package/client versions at `0.5.13`, matching tag `v0.5.13`; Android `versionCode` advances from `51` to `57`, skipping `52`–`56`, and Expo iOS `buildNumber` is `57`.
- 本仓库各自有包与客户端版本统一为 `0.5.13`，与 Tag `v0.5.13` 一致；Android `versionCode` 从 `51` 升至 `57`，跳过 `52`–`56`，Expo iOS `buildNumber` 同步为 `57`。
- Adds Host support for encrypted `workspace.upload.v1`: files up to 20 MiB can be saved only in the current session's Host-verified workspace root, with bounded chunks, per-connection/session isolation, no-overwrite publication and partial-file cleanup. Client-selected paths and generic filesystem RPC remain unavailable; the independent Remote Web upload UI/deployment is outside this release.
- Host 新增加密 `workspace.upload.v1`：单文件最大 20 MiB，只能保存到当前会话经 Host 验证的工作区根目录；分块有界、按连接/会话隔离、提交不覆盖已有文件，并清理未完成临时文件。不接受客户端目标路径或通用文件系统 RPC；独立 Remote Web 上传界面与部署不属于本次发布。
- Recover OpenCode titles in the shared browser projection: consume ACP title updates, retry catalog reads for up to twenty seconds after completion, and use the first user message temporarily when the native title is missing. History restores that fallback; stale reads and native placeholders cannot replace newer or manually renamed titles. No native database writes; independent Remote Web deployment remains pending.
- 修复 OpenCode 共享浏览器投影的标题恢复：接收 ACP 标题事件，回复结束后最多二十秒限时重读列表，原生标题缺失时临时显示首条提问；历史可恢复该临时标题，旧读取与原生占位标题不能覆盖新标题或手动改名。不写原生数据库；独立 Remote Web 部署仍待同步。
- Detect OpenCode ACP network options before startup, retaining the authenticated private listener on compatible CLIs and using stdio-only ACP when those options are absent. Unsupported native archiving fails explicitly without blocking session discovery or history; failed/partial probes fail closed and are cancelled on shutdown.
- 启动前检测 OpenCode ACP 网络参数能力：兼容 CLI 保留认证私有监听器，缺少这些参数时使用纯 stdio ACP。原生归档不可用会明确失败，不阻塞会话发现或历史；检测失败或参数不完整时拒绝启动，关闭后端取消检测。
- Verified with official OpenCode `1.19.3` (`opencode-ai`) and `2.0.32` (`@opencode/cli`), including both help formats, session discovery/recovery and v2 model selection; v1 native archive remains available. No Prompt or encrypted cross-device acceptance was performed.
- 已用官方 OpenCode `1.19.3`（`opencode-ai`）与 `2.0.32`（`@opencode/cli`）验证两种帮助格式、会话发现/恢复和 v2 模型切换；保留 v1 原生归档。未执行 Prompt 或加密跨设备验收。
- Adds QR sign-in to the Android client through an explicit “Sign in with QR code” entry. The login screen requests the Server provider list and displays the locally rendered same-origin `scanUrl` only after the entry is tapped; large screens use a bigger code, while browser OAuth and email/password sign-in remain available.
- Android 客户端新增「扫码登录」点击入口：只有点击后才会请求 Server provider 并展示本地渲染的同源二维码；大屏使用更大的二维码，浏览器 OAuth 与邮箱密码登录保留。
- Validates provider/QR responses against same-origin and malformed payloads, falls back to the legacy per-provider OAuth status endpoints on older Servers, and stops polling off-view or when the Server changes.
- 校验 provider/二维码响应的同源与格式；旧 Server 回退到 per-provider OAuth status 接口；离开扫码视图或修改服务地址时停止轮询/作废旧会话。
- Completes QR sign-in after the one-time token is claimed: the client stops polling immediately and drives device registration/navigation without render-dependent effect restarts, so a successful scan no longer ends with “QR code expired” or a skipped login.
- 修复扫码登录完成阶段：领取一次性 token 后立即停止轮询，设备注册与跳转不再依赖会随渲染变化的 effect 依赖，扫码成功后不会再次轮询已消费会话而显示二维码过期或跳过登录。
- Adds a tablet split view to the Android chat: at ≥760 dp wide the session list stays on the left and the conversation, header and composer render on the right; selecting another conversation updates only the right pane. Narrow and short windows keep the single-pane phone layout.
- Android 聊天页新增平板双栏：宽度 ≥760 dp 时左侧常驻会话列表，右侧显示会话头部、消息与输入栏；在左栏切换会话只更新右侧内容。窄屏和短窗口保持手机单栏布局。

## 0.5.12 - 2026-10-18

- Unifies all first-party package/client versions at `0.5.12`; Android `versionCode` and Expo iOS `buildNumber` are both `50`.
- 本仓库各自有包与客户端版本统一为 `0.5.12`；Android `versionCode` 与 Expo iOS `buildNumber` 均为 `50`。
- Fence ACP/CodeX requests and ownership rollback against disconnected peers and replaced backends; isolate retired Prompt completions and stop OpenCode history readers on shutdown or overflow.
- Fix Pi modern model/Thinking state confirmation and bound CodeX/ACP file-preview allocation before reading oversized files.
- Update compatible security patches in direct and transitive dependencies. Production-dependency audit findings drop from 32 to 5; the remaining Expo/Metro build-chain advisories and acceptance limits are tracked in [TODO](TODO.md).
- Fix CodeX new conversations with current App Server versions: a Thread without its first user message is projected as an empty history baseline instead of a failed read, so the Session opens and can be followed.
- Unlocks Android screen rotation and adapts chat content, the composer, bottom sheets, workspace dialogs and tool panels to landscape and short windows.
- 修复 ACP/CodeX 迟到请求与归属回滚越过断线/后端替换边界、旧 Prompt 污染新任务，以及 OpenCode 历史子进程关闭和超限清理。
- 修复 Pi 现代模型/Thinking 快照和切换确认，文件预览在读取超大文件前执行内存限额。同步兼容的依赖安全补丁，剩余 5 项 Expo/Metro 构建链公告与验收边界见 TODO。未升级或发布版本。
- 修复当前 App Server 版本下 CodeX 无法新建对话：尚未收到首条用户消息的 Thread 不再被当作历史读取失败，而是投影为空历史基线，新会话可以打开并跟随。未升级或发布版本。
- Android 客户端解除竖屏锁定，聊天内容、输入栏、底部弹层、工作区对话框与工具面板适配横屏和短窗口。

## 0.5.11 - 2026-10-18

- Unifies all first-party package/client versions at `0.5.11`; Android `versionCode` and Expo iOS `buildNumber` are both `49`.
- 本仓库各自有包与客户端版本统一为 `0.5.11`；Android `versionCode` 与 Expo iOS `buildNumber` 均为 `49`。
- Improves Android reply visibility and current-work navigation, adds conversation information, and removes cloud Host image packaging from this repository.
- 改进 Android 回复展示与当前工作导航，新增会话信息，并移除本仓库的云主机镜像打包入口。
- Thanks @sugershun for the Windows Desktop/Android compatibility report and version-pinned reinstall confirmation (#129). Continuing thanks to @pengyz (#115), @dreamfarer-space (#118, #126, #128) and @luojiyin1987 (#121, #123) for the earlier contributions this release builds on; these are not new 0.5.11 code contributions.
- 感谢 @sugershun 在 #129 中反馈 Windows Desktop/Android 兼容问题并确认指定版本重装有效；也感谢 @pengyz（#115）、@dreamfarer-space（#118、#126、#128）和 @luojiyin1987（#121、#123）此前贡献的代码、测试与文档，它们是本版持续改进的基础，并非本版新增代码贡献。

- Fixes the installer on macOS's system Bash 3.2, rejects unknown ACP model-selection session IDs, prioritizes exact model IDs and rejects ambiguous aliases, and preserves OpenCode history errors so failed reads can be retried instead of appearing empty.
- 修复安装器在 macOS 系统 Bash 3.2 下的语法错误；ACP 模型切换拒绝未知会话，模型 ID 优先精确匹配并拒绝有歧义的别名；OpenCode 历史读取失败保留错误供重试，不再显示为成功的空历史。

- Fixes OpenCode Files/Terminal requests and file change subscriptions rejected by an incorrect Cursor tool scope; backend and session scope checks remain strict.
- 修复 OpenCode Files/Terminal 请求和文件变化订阅被误按 Cursor 作用域拒绝的问题，保留严格的后端及会话隔离。

- Keeps ACP workspace conversations newest first, refreshes existing activity timestamps from the Host, and preserves the saved update time when reading history.
- 修复 ACP 工作区会话的时间排序：最近更新的会话优先，刷新时同步 Host 的更新时间，读取历史不再把时间改成当前时间。

- Adds OpenCode native session archiving on Desktop/Android through the same Host ACP process's authenticated loopback HTTP API. OpenCode persists the archive state; default catalogs hide archived sessions across restart while retaining history. Clients wait for confirmation and share catalog updates. Active turns cannot be archived; unarchive and other ACP backends are not supported yet.
- Desktop/Android 接入 OpenCode 原生会话归档，直接调用同一 Host ACP 进程的认证 loopback HTTP API；状态由 OpenCode 持久保存，重启后默认列表仍隐藏、历史保留。客户端确认后更新并同步目录；活动回复拒绝归档，暂不提供恢复或其他 ACP 后端原生归档。

- Adds confirmed Cursor/Claude model selection on Desktop/Android, isolates Cursor model settings by session, and adds Claude workspace/history/chat entry points with the display name Claude. Restored Claude prompts load the trusted session before starting; cancellation during loading cannot start a late turn.
- 接入 Desktop/Android 的 Cursor、Claude 真实模型目录及切换；Cursor 按会话隔离模型设置，补齐 Claude 工作区、历史和文字会话入口，显示名统一为 Claude。恢复 Claude 会话时先加载可信目录，加载期间取消不会启动迟到回复。

- Fixes OpenCode model selection using the Host's actual ACP catalog and confirmed per-session changes; removes hardcoded catalogs and false success on upstream errors. Adds Android AGY model/effort selection, standardizes the display name to Pi, and removes ineffective Cursor model choices.
- 修复 OpenCode 模型选择：读取 Host 实际 ACP 模型目录，按会话调用上游切换并确认结果，移除写死目录及吞错后的虚假成功；补齐 Android AGY 模型/思考强度选择，显示名统一为 Pi，并移除 Cursor 无效模型选项。

- Fixes OpenCode workspaces on a Host where the CLI is installed at the official `~/.opencode/bin/opencode` location, and wires OpenCode project/session discovery plus `session/load` history replay so saved conversations load again.
- 修复 OpenCode CLI 安装在官方 `~/.opencode/bin/opencode` 时 Host 无法发现后端的问题，并接入 OpenCode 的项目/会话发现与 `session/load` 历史回放，已保存的会话可以重新加载。

- Fixes RC.1 Desktop web boot against older Harness Hosts whose `ui-theme` settings omit the new font fields. Remote supplies missing display defaults in received settings views while preserving Host schemas, revisions and write refusals.
- 修复 RC.1 Desktop 连接旧 Harness Host 时，`ui-theme` 缺少新字体字段导致主题初始化失败、界面模块无法激活的问题。Remote 仅为接收到的设置视图补齐显示默认值，保留 Host schema、revision 和写入拒绝结果。

- Restores full Linux installation in the sole installer: requires root, bootstraps private Node.js/DSH/pnpm when DSH is missing, accepts one-time Host registration tokens and enables/starts a root systemd system service. Existing DSH is reused; unit ownership and Web capability are preflighted before token redemption. Real clean-server/reboot acceptance remains pending.
- 单一安装器恢复 Linux 完整安装：要求 root，缺少 DSH 时安装私有 Node.js/DSH/pnpm，支持一次性 Host Token 注册并启用、启动 root systemd 系统服务；复用已有 DSH，兑换 Token 前检查服务归属与 Web 能力。真实干净服务器和重启验收仍待完成。

- Keeps only the macOS/Linux installation entry, removes Windows installation/check scripts and separate uninstall/token wrappers, and directs removal to official Plugin management or CLI commands. Build/test utilities are unchanged.
- 安装相关脚本仅保留 macOS/Linux 单一入口，移除 Windows 安装/检查脚本及独立卸载、Token 包装入口；卸载统一使用官方插件管理或命令，构建/测试辅助脚本不变。

- Validation: workspace check, 683 tests in 101 files, production build including Android Hermes export, DSH bundle validation and npm package-entry checks pass. Bash 3.2/modern Bash installer file/pipe smoke checks pass. Windows, native APK/device, encrypted cross-device and clean-server/reboot acceptance remain pending; the Metro noble/hashes exports fallback warning remains.
- 验证：全仓 check、101 个文件 / 683 个测试、含 Android Hermes 导出的生产 build、DSH bundle 与 npm 打包入口检查通过；Bash 3.2/新版 Bash 安装器文件和管道执行烟测通过。Windows、原生 APK/真机、加密跨设备及干净服务器/重启自启验收仍待完成；Metro noble/hashes exports fallback 警告保留。

## 0.5.10 - 2026-10-17

- Unifies all first-party package versions at `0.5.10`, including Plugin, Android, VS Code, Browser, Server and shared packages; Android `versionCode` and Expo iOS `buildNumber` are both `48`.
- Adds Android Intelligent UI cards with version recovery, offline rendering and native confirmation for model-directed actions (#126 / #124). Release APKs bundle the pinned, audited renderer; full action/patch and reconnect device acceptance remains pending.
- Improves Android 14/15+ edge-to-edge system bars, keyboard and modal insets (#128), reliable sends, queue visibility, agent-team display and chat responsiveness (#115 / #118). Workspace sessions in the drawer expand three at a time.
- Adds OpenCode and Claude Host/Android workspace support alongside experimental Pi; encrypted cross-device acceptance remains pending.
- Adds real WebSocket relay security coverage and refreshes acceptance priorities (#123 / #121).
- Thanks @pengyz (#115), @dreamfarer-space (#118, #126, #128), @luojiyin1987 (#121, #123), and @liguobao for code, review, testing, documentation and release integration since `v0.5.8`.
- 本仓库各自有包版本统一为 `0.5.10`，包含 Plugin、Android、VS Code、Browser、Server 与共享包；Android `versionCode` 与 Expo iOS `buildNumber` 均为 `48`。
- Android 新增 Intelligent UI 卡片、版本恢复、离线渲染及模型操作前的原生确认（#126 / #124）；Release APK 打包固定审核版本的 renderer，完整操作/patch 与重连真机验收仍待完成。
- 改进 Android 14/15+ 沉浸式系统栏、键盘及弹窗避让（#128），补齐可靠发送、队列可见性、Agent 团队面板与聊天响应优化（#115 / #118）；抽屉中每次展开三个工作区会话。
- 在实验性 Pi 基础上加入 OpenCode、Claude Host/Android 工作区支持；加密跨设备验收仍待完成。
- 增加真实 WebSocket Relay 安全验证并更新验收优先级（#123 / #121）。
- 感谢自 `v0.5.8` 以来参与本版的 @pengyz（#115）、@dreamfarer-space（#118、#126、#128）、@luojiyin1987（#121、#123）及 @liguobao，贡献代码、审查、验证、文档与发布集成。

The following entries retain the implementation and validation milestones recorded during development; later client integration supersedes earlier Host-only scope notes.
以下保留开发期间的实现与验证记录；后续客户端接入已扩展早期仅 Host 的范围说明。

- Updates the Harness baseline to `0.2.1-rc.1` and Cordis to `4.0.5`. Admitted Remote connections own independent Gateway Peers, including event replies and Fetch routes. Adapts native duplex terminals to the existing bounded terminal tunnel with Host acknowledgements and no input replay; supports RC.1 projection results and isolated CodeX/ACP projection reads. Cross-device and native-device acceptance is pending.
- Harness 开发基线升级至 `0.2.1-rc.1`、Cordis `4.0.5`；已认证连接使用独立 Gateway Peer，覆盖事件回复和 Fetch 路由。官方双向终端接入既有有界终端隧道，按 Host 确认输入且断线不重放；补齐 RC.1 投影结果与 CodeX/ACP 独立投影读取。跨设备与原生真机验收仍待完成。

- Splits the four handwritten source files over 2,000 lines into Plugin client views, CodeX catalog/history projections, Android account/workspace actions and chat components. Existing public entries and protocol behavior are preserved; Harness lifecycle tests no longer start installed Agent CLIs.
- 四个超过 2000 行的手写源码按领域完成首轮拆分，保留既有入口与协议行为；Harness 生命周期测试隔离本机 Agent CLI。
- 修复 Android 账号刷新与工作区操作的迟到结果竞态：账号切换立即失效旧刷新，凭据及信任清理按序执行；工作区结果校验连接代次、后端实例和操作归属，旧成功或错误不能覆盖当前目录、错误与忙碌状态。新增 7 个核心契约测试（命名场景矩阵）；全仓 check、647 tests 和 Android Hermes 生产导出通过，未进行原生真机或跨设备验收。
- 进一步将 Android store、CodeX/ACP virtual Harness、Plugin client runtime 按连接、会话、实时投影、事件载体和控制路由拆分；四个入口及本轮新模块均低于 1000 行。全仓 check、640 tests、生产 build/Hermes、DSH bundle 校验及浏览器投影烟测通过。

- Centers Android home/single-action headers and removes raised button backgrounds from toolbar icons. Host details show the platform on the right and separate DSH and Remote plugin version rows.
- Android 首页及单操作标题栏保持居中，移除工具栏图标外层按钮背景和阴影；主机列表在线/离线改为纯文字，移除列表改名图标；主机信息页在名称后提供重命名图标、右侧显示系统类型，DSH 和 Remote 插件版本分别成行；连接页版本信息以 `DSH 版本号 | Plugin 版本号` 单行居中展示。

- Android connection progress shows Harness and Remote plugin versions. Workspace headers use an underlined, clickable Host name and remove network status and the overflow menu; Host details always expand network diagnostics.
- Android 连接进度页展示 Harness 和 Remote 插件版本；工作区标题改为带下划线、整段可点击的主机名，移除网络状态和右上角更多菜单；主机信息页直接展开网络详情。

- Android workspace lists and favorite/recent shortcuts consistently exclude Host-archived Harness sessions after refresh or reconnect. Archiving applies the confirmed archive set without a second catalog request; late results from a disconnected Host cannot overwrite the current connection.
- Android 工作区列表及收藏/最近访问快捷入口统一排除 Host 已归档的 Harness 会话，刷新和重连后仍保持隐藏。归档直接应用 Host 确认结果，不再依赖第二次目录读取；旧连接的迟到结果不能覆盖当前连接状态。

- Fixes Pi cancellation during initial cwd/session loading: cancelled preparations cannot start a prompt or clear a newer retry. Desktop Pi projection preserves error, cancellation and token-limit outcomes instead of reporting every turn as completed. Android restores Pi/AGY tabs only when their respective backend is available.
- 修复 Pi 首次 cwd/session 加载期间的取消：已取消的准备任务不能启动 Prompt，也不能清除后续重试状态；Desktop Pi 投影保留失败、中断和 token 上限状态，不再统一显示正常完成。Android 恢复 Pi/AGY 标签时分别检查对应后端可用性。

- Isolates Pi initial-load replay from live streams, preserving confirmed model/thinking configuration while rejecting load-time callbacks. Android Pi/AGY history recovery retains new-subscription live messages and completion catch-up instead of overwriting them with a delayed snapshot. Claude/Pi catalog and cached cwd validation reject retired backend generations after reconfiguration or shutdown.
- 修复 Pi 初次 load 的历史回放混入实时流：保留上游确认的模型/Thinking 配置，拒绝加载期间的 callback；Android Pi/AGY 历史恢复合并本次订阅的实时消息及完成 catch-up，不再由迟到快照覆盖。Claude/Pi catalog 与缓存 cwd 校验绑定后端实例，重配/关闭后拒绝旧代际结果。

- Preserves Pi history/catalog read failures instead of inventing an empty conversation. Restores native tool results, failures and terminal output, merges text chunks and coalesces concurrent history reads. Real local Pi model/tool-confirmation and restart/history/pagination/continue smoke tests pass; Pi still has no default per-tool approval, and pi-acp 0.0.34 does not replay original thinking, tool arguments, message IDs or timestamps.
- 修复 Pi 历史/目录失败被当成空对话、工具输出与错误丢失、文本 chunk 拆分及并发历史读取；真实本机模型工具确认、重启历史/分页/继续聊验证通过。Pi 仍无默认逐工具审批，pi-acp 0.0.34 未重放的原始 thinking、工具参数、消息 ID/时间不伪造恢复。

- Adds Claude ACP Host interruption and catalog/load/history recovery (#125), using a bounded, separate replay reader that does not interrupt active tools. Real Gateway tests confirm pending approval cancellation, running-tool interruption, and process restart with restored conversation context; client UI and encrypted cross-device acceptance remain pending.
- 补齐 Claude ACP Host 中断与 catalog/load/history 恢复（#125），使用有界独立 replay reader，不打断正在运行的工具；真实 Gateway 验证待审批取消、运行中断及进程重启后的上下文继续对话，客户端 UI 与加密跨设备验收待完成。
- Adds the initial, opt-in Claude ACP Host backend (#125). Local smoke tests use the existing compatible endpoint with `gpt-6-sol` through the real Claude Agent SDK adapter; client workspace/history and encrypted cross-device acceptance remain pending.
- Hardens ACP tool approvals: maps single-use choices to the upstream option IDs, rejects persistent grants and arbitrary permission results, and binds each handle to its connection/session/backend instance. Real Gateway checks cover deny, allow once, a fresh approval on the next tool call, cross-connection attempts and replay.
- 新增默认关闭的 Claude ACP Host 首批接入（#125），使用现有兼容端点与 `gpt-6-sol` 完成真实 SDK/ACP 烟测；客户端工作区、历史和加密跨设备验收待完成。
- 修复 ACP 工具审批：按上游真实选项 ID 映射单次允许/拒绝，禁止持久授权和任意 permission result，句柄绑定连接/会话/后端实例。真实 Gateway 验证拒绝、单次允许、下一工具重新审批，以及跨连接和重放拒绝。

- Adds experimental Pi Agent ACP support (#97), automatically detected and initialized unless explicitly disabled: Host detection, isolated session wrappers, catalog/history, streaming tools, interrupt and Host-confirmed model/thinking selection, with Desktop/Android in-memory workspaces. Local Pi/OpenAI and real Gateway recovery smoke tests pass; encrypted cross-device, Windows and native Android acceptance remain pending.
- 新增实验性 Pi Agent ACP 后端（#97），默认自动检测并初始化、尊重用户明确关闭：Host 检测、独立会话进程、目录/历史、流式工具、中断及上游确认的模型/Thinking，接入 Desktop/Android 内存工作区。本机 Pi/OpenAI 对话与真实 Gateway 恢复烟测通过；加密跨设备、Windows 与 Android 原生验收待完成。

- Fixes CodeX workspace re-entry after disconnect: restores the last successfully opened Thread from bounded, Host/Workspace-scoped memory, or chooses the latest catalog Thread without busy-read probes. Navigation memory is cleared on account sign-out; no mutations are replayed.
- Preserves CodeX history read failures instead of returning a successful empty baseline. Busy/timeouts and malformed pages remain errors; older App Server history API fallback is retained.

### 中文

- 修复 CodeX 断线后重新进入工作区的会话选择：从按 Host／工作区隔离且有界的内存中恢复上次成功打开的 Thread；无有效记忆时选择目录中最近更新的 Thread，不再通过 busy-read 探测跳到旧会话。退出账号清除导航记忆，不重放任何写操作。
- CodeX 历史读取失败不再返回成功的空基线；busy、超时及异常分页响应保留错误，同时继续兼容旧 App Server 的历史读取接口。

## 0.5.9 - 2026-10-16

- Separates Control authorization, ICE discovery, WebRTC negotiation and Noise handshake deadlines. Server-provided WebRTC budgets remain compatible, including 20-second fallback and legacy Servers without the optional field. Cancellation and disconnect settle startup and ignore late results.
- Applies the Server WebRTC budget to the Host responder as well, preserving its local default for legacy Servers and avoiding early closure while the Client is still negotiating.
- Keeps the Remote status strip, and the scrim of its connection panel, clickable in the Windows Desktop caption. The strip is placed in the title bar row, which the shell declares as the window drag region, so without an explicit opt-out every press only started a window drag; both surfaces now exclude themselves from that region with the same marker the shell's own caption controls use.
- Advances the Plugin and Android app to `0.5.9` (Android `versionCode 47`).

### 中文

- 拆分 Control 授权、ICE 配置获取、WebRTC 协商和 Noise 握手超时，兼容 Server 下发的 20 秒等待及不带该可选字段的旧 Server；取消或断线立即结束启动等待，并忽略迟到结果。
- Host 响应端同样采用 Server 协商等待时间，旧 Server 保留本地默认值，避免 Client 仍在协商时 Host 提前关闭 RTC。
- 修复 Windows Desktop 顶栏中的 Remote 状态条及其连接线路面板遮罩无法点击：状态条位于标题栏行内，而该行被 shell 声明为窗口拖拽区，未显式退出时点击只会变成拖动窗口；两处现使用 shell 自有顶栏控件相同的标记退出拖拽区。
- Plugin 与 Android App 升级到 `0.5.9`（Android `versionCode 47`）。

## 0.5.8 - 2026-10-16

- Refreshes Android with frosted floating headers, pill actions, a rounded floating composer, and a white light theme with subtle card outlines (#111, #112, #113).
- Keeps Remote login method tabs on one row.
- Advances the Plugin and Android app to `0.5.8` (Android `versionCode 46`).
- Thanks @dreamfarer-space for the Android interface improvements and Host compatibility/lifecycle fixes in #111, #112, #113, #116, and #117.
- Adds Android's locally saved default permissions for new Harness and CodeX chats: backend default, workspace write, or full access. Backend default preserves Harness computer settings and CodeX workspace write. Existing chats keep their permissions; new Harness chats require Host confirmation, and CodeX remembers the returned policy per Host and Thread.
- Cancels Host Server HTTP requests, including authentication and response body consumption, when the runtime closes; keeps the request deadline active through body reads. The TUI lifecycle test uses an abortable local fixture instead of a live Server.
- Loads Node's SQLite builtin natively so AGY session discovery remains usable with older Vite test runners when the optional `sqlite3` CLI is absent.
- Preserves the caller's Peer when the gateway switch forwards local RPCs, preventing `gateway/internal` / missing `signal` failures with Harness `0.2.1-alpha.4`. Remote tunnel calls retain their existing three-argument contract.
- Removes Android's standalone Conversations menu and screen; conversations are accessed through their device's workspace. Archive confirmation no longer points to the removed screen.
- Rounds the pressed highlight on Android workspace conversation rows and adds padding around its contents.
- Replaces the minimal shared CodeX/ACP shell bridge with a Host-owned terminal controller: verified default/candidate interactive shells, xterm screen snapshots, bounded output followers, idempotent allocation and retryable process cleanup. Committed terminals survive request timeouts and disconnects; backend reconfiguration and Host shutdown await cleanup. Remote scopes, device ownership and input claims remain isolated.
- Adds conservative unattended reclamation only after two hours of confirmed idle activity without window holds or followers. PTY/activity support comes from the Host subprocess provider; the compatibility pipe fallback still lacks terminal resize and job control. Windows/Linux and encrypted cross-device acceptance remain pending.
- Fixes terminal cancellation after allocation commit and binds input to the current connection's follower even when attachment IDs are reused. Disconnect also revokes pending follows. ACP reconfiguration continues stopping changed backends after cleanup errors and retries unfinished cleanup when the same settings are saved again; affected backends stay unavailable until cleanup succeeds.

### 中文

- Android 更新毛玻璃悬浮顶栏、胶囊操作按钮和圆角悬浮输入框；浅色主题统一为白色，并增加精细卡片轮廓（#111、#112、#113）。
- Remote 登录方式选项保持单行显示。
- Plugin 与 Android App 升级到 `0.5.8`（Android `versionCode 46`）。
- 感谢 @dreamfarer-space 在 #111、#112、#113、#116、#117 中贡献 Android 界面改进及 Host 兼容性和生命周期修复。
- Android 设置新增「新对话默认权限」并保存在手机本地，可选择使用默认权限、工作区内修改或完全权限，自动用于新建 Harness / CodeX 对话。「默认」保留 Harness 电脑端设置与 CodeX 工作区内修改行为。已有对话不变；Harness 读取 Host 确认后的权限，CodeX 按 Host / Thread 保存实际返回的权限。
- Host 关闭时取消 Server HTTP 请求（包括鉴权和响应体读取），请求超时覆盖完整响应读取阶段；TUI 生命周期测试改用可取消的受控请求，隔离真实 Server。
- AGY 会话发现通过 Node 原生加载 SQLite 内置模块，兼容旧版 Vite 测试运行器且无需依赖可选的 `sqlite3` 命令。
- 修复 Gateway 切换器转发本地 RPC 时丢失调用方 Peer，导致 Harness `0.2.1-alpha.4` 返回 `gateway/internal` / 缺少 `signal` 的问题；远程隧道仍保留原有三参数调用契约。
- 移除 Android 独立「对话」菜单及列表页，统一从所属设备的工作区进入会话；归档确认文案不再指向已移除的页面。
- Android 工作区中的会话行按压高亮改为圆角，并为内部内容增加留白。
- CodeX / ACP 的简易 shell bridge 改为共用 Host 终端控制器：验证默认/可选交互 shell、xterm 屏幕快照、有界输出订阅、幂等创建和可重试进程清理。已创建终端不受请求超时或断线影响；后端重配与 Host 关闭等待清理，保留会话 scope、设备归属与连接输入权隔离。
- 无窗口持有者或 follower、连续两小时明确 idle 时才自动回收。PTY 和 activity 由 Host subprocess 提供；兼容 pipe 仍不支持终端 resize/job control。Windows/Linux 与加密跨设备验收待完成。
- 修复分配提交后的请求取消，并将输入权绑定到当前连接的 follower，即使复用 attachment ID 也不能跨连接输入；断开同时撤销尚未完成的 follow。ACP 重配遇到清理失败仍停止变化后端，再次保存相同设置可重试未完成清理，相关后端在清理成功前保持不可用。

## 0.5.7 - 2026-10-14

- Discovers enabled OAuth providers from the Server for Desktop, CLI, and dsh-TUI login, including server-defined QR providers; older Servers fall back to configured GitHub/Zhihu status endpoints only when discovery returns 404.
- Clarifies Android recovery instructions when another Harness process holds a Session writer, including fully exiting the other process before retrying (#108, contributed by @dreamfarer-space).
- Reports the selected TURN relay node through the optional `transport.selected.turnNode` field and tolerates CodeX resume refusals for newly created, not-yet-persisted Threads when changing permissions; actual permission-update failures still reject the request.
- Advances the Plugin and Android app to `0.5.7` (Android `versionCode 45`).
- Adds a Host-side DS Bot operation allowlist: remote chat and roster management remain available; installation, upgrades, schedule mutations, credentials, capability scripts, and unknown operations are refused before local dispatch.
- Gates DS Bot roster and newly created Session responses on membership in the official Session catalog, with at most two refreshes for a missing identity; an already-ready catalog or a silently failed refresh cannot publish unknown Sessions.
- Restricts plugin route forwarding to the exact `api/bot` endpoint, preventing official Harness RPCs from bypassing the Remote allowlist, local settings restrictions, and terminal policy.
- Reports DS Bot forwarding refusals with distinct safe error codes in its native error envelope, including missing Host routes, unsupported carriers, disconnected or incompatible catalogs, and catalog readiness failures.
- Adds the native schedule UI's read-only `schedule/list` and `schedule/catalog` endpoints to the fixed Remote allowlist, keeps remote RPC failures in the official response envelope, and dispatches Host plugin routes through the official Connection Fetch carrier on Desktop without requiring a local HTTP server.
- Keeps sidebar footer plugin entries stacked vertically. The expanded Remote entry shows its icon and label below DS Bot; the collapsed sidebar retains a compact icon button. Bot mode keeps its account and Connect plugins controls together in their original row, with Remote on a separate row below. Tooltips retain the target name; connected expanded rows restore a separate Exit action, while the collapsed icon returns to local workspaces.
- Fixes DS Bot route forwarding to use the official control request envelope from page startup, retain proxy prefixes and cancellation, and refresh the official Session catalog before publishing remote roster changes. Disconnected, unsupported, and CodeX/ACP catalogs reject plugin route requests instead of falling back to local roster data.

### 中文

- Desktop、CLI 与 dsh-TUI 登录从 Server 发现已启用的 OAuth 登录方式，支持服务端定义的扫码 provider；仅发现接口返回 404 时兼容旧 Server 的 GitHub/知乎配置状态接口。
- Android 遇到其他 Harness 进程占用 Session writer 时，明确提示完整退出占用进程再重试（#108，由 @dreamfarer-space 贡献）。
- 通过可选 `transport.selected.turnNode` 字段上报实际选择的 TURN 节点；CodeX 新建且尚未持久化的 Thread 修改权限时，兼容其 resume 拒绝，真实权限更新失败仍保持拒绝。
- Plugin 与 Android App 升级到 `0.5.7`（Android `versionCode 45`）。
- Host 对 DS Bot 子操作实行固定白名单，保留远程会话与成员/群聊管理；安装升级、日程增删、凭据、能力脚本及未知操作在本机 dispatch 前拒绝。
- DS Bot roster 和新会话响应必须通过官方 Session 目录的 ID 校验，缺失时最多刷新两次；目录曾进入 ready 或刷新失败后正常返回，均不能放行尚不可解析的新 Session。
- 插件路由转发仅开放精确的 `api/bot` 端点，阻止官方 Harness RPC 绕过 Remote 白名单、本地设置限制和终端策略。
- DS Bot 转发拒绝保留原生错误封装与具体安全错误码，区分 Host 未加载路由、能力缺失、断线、后端不兼容和会话目录未就绪，避免统一显示 HTTP 502。
- 补齐原生日程 UI 的只读 `schedule/list` 与 `schedule/catalog` 固定白名单，远程 RPC 错误保留官方响应封装；Host 插件路由优先使用官方 Connection Fetch carrier，使 Desktop 不依赖本机 HTTP 服务。
- 侧栏底部插件入口保持上下排列；展开时 Remote 在 DS Bot 下方显示图标与文字，折叠时保留紧凑图标按钮；Bot 模式保留头像与「连接插件」原有整行布局，Remote 单独占下方一行。悬停保留目标名称；连接后展开行恢复独立「退出」按钮，折叠图标点击返回本地工作区。
- 修复 DS Bot 路由转发：页面启动即启用，使用官方控制请求封装，保留代理前缀与取消信号；发布远程 roster 变化前刷新官方会话目录。断线、不支持及 CodeX/ACP 目录下拒绝插件路由请求，避免回落到本地 roster。

## 0.5.6 - 2026-10-13

- Preserves image and Office preview bytes through the local Harness Connection HTTP hop by emitting official binary attachments from the Remote gateway switch.
- Advances the Plugin and Android app to `0.5.6` (Android `versionCode 44`).

### 中文

- 修复远程图片和 Office 预览经过本机 Harness Connection HTTP RPC 时丢失字节类型的问题：Remote gateway switch 使用官方二进制附件封装。
- Plugin 与 Android App 升级到 `0.5.6`（Android `versionCode 44`）。

## 0.5.5 - 2026-10-13

- Adds Android conversation archiving: archive from the chat header or with a swipe gesture, then find archived conversations from the Conversations screen.
- Aligns the Plugin settings page with the native DSH detail layout and keeps its injected locale dictionaries in a shared module.
- Closes oversized Harness Remote stream frames as failed without dropping the encrypted peer connection.
- Advances the Plugin and Android app to `0.5.5` (Android `versionCode 43`).

### 中文

- Android 新增对话归档：可在会话标题栏归档，也可在列表中滑动归档，并在“对话”页面查看已归档内容。
- Plugin 设置页适配 DSH 原生详情页布局，并将注入客户端的语言字典整理为共享模块。
- 超过安全消息大小的 Harness Remote 流帧会以失败结束，同时保持加密对端连接可用。
- Plugin 与 Android App 升级到 `0.5.5`（Android `versionCode 43`）。

## 0.5.4 - 2026-10-12

- Fixes Remote Web workspace image and Office preview responses by materializing Harness Gateway binary attachments on the Host and restoring them to `Uint8Array` in the client gateway.
- Rebuilds the Plugin bundle and synchronizes the Android/Plugin release version.

# Changelog

## 0.5.3 - 2026-10-11

- Keeps the Android remote connection alive in the background through a dedicated foreground service; returning to the app restores the ongoing session without reconnecting.
- Refines Android remote session tools: the Files/Terminal tool access now appears once a session is connected, with session tool, terminal, and workspace file panel fixes.
- Redesigns the Android device unbind interaction with new swipe gestures and animations (#99), contributed by @dreamfarer-space.
- Rotates a revoked Host identity when the account logs in again, so a revoked device can recover its credentials.
- Restores the `harness.api.v1` capability in the committed Plugin bundle and encodes remote workspace binary responses correctly.
- Advances the Plugin and Android app to `0.5.3` (Android `versionCode 42`).

### 中文

- Android 新增前台服务，切后台后保持远程连接；回到应用即可继续当前会话，无需重连。
- 优化 Android 远程会话工具入口：会话连接后即显示 Files/Terminal 工具访问，并修复会话工具、终端与工作区文件面板相关问题。
- 重做 Android 设备解除绑定的滑动交互与动效（#99），由 @dreamfarer-space 贡献。
- 账号重新登录时轮换已被撤销的 Host 身份，被撤销设备可恢复凭据。
- 恢复提交 bundle 中的 `harness.api.v1` capability，并修复远程工作区二进制响应的编码问题。
- Plugin 与 Android App 升级到 `0.5.3`（Android `versionCode 42`）。

## 0.5.2 - 2026-10-10

- Adds account-owned Host removal from the Android device list, with swipe-to-remove confirmation and local credential cleanup.
- Improves Antigravity ACP cancellation, restart recovery, thinking-stream capture, and tool completion status reporting.
- Serves unprojected Harness surfaces through the Host gateway so ACP clients can keep their existing workspace view.

## 0.5.1 - 2026-10-09

- Advances the Plugin and Android app to `0.5.1` (Android `versionCode 40`).

- Updates the Harness development baseline to `0.2.1-alpha.1`, retaining `0.2.0-rc.2` and admitting `0.2.2` prereleases; legacy ApiProxy is no longer a compatibility maintenance target.
- Adds fixed official timed-question and Claude Code Mods endpoints; Android claims timed questions, displays remaining time, and restores continued questions from Host projections without replaying replies.
- Preserves Web reverse proxy prefixes in the Remote status SSE URL.

- Fixes Android ACP live activity grouping for Antigravity and Cursor by retaining prompt boundaries, completion/interruption/failure evidence, and reply/tool ordering; AGY command and file tools use the existing collapsed process summaries.
- Aligns the Android saved-prompts button height and padding with the model selector.

## 0.5.0 - 2026-10-08

- Adds independent Cursor and Antigravity workspace types over the authenticated `agent.acp.*` data plane, including Desktop/Web memory projections and Android AGY conversation history and image prompts.
- Adds shared read-only workspace files and Host-controlled terminals to Cursor and AGY sessions, with session directory containment and device ownership enforcement.
- Loads AGY model and reasoning choices from the installed CLI, applies confirmed changes to the same conversation, caches the catalog per running backend, and avoids redundant CLI startup during model changes.
- Adds Android slash commands, inline references, message actions, new-conversation and trajectory controls, and a direct saved-prompts entry with persistent edits and deletions.
- Improves Android turn completion, interruption, error handling, and reconnect recovery; serves `/health` and `/ready` aliases in the self-hosted Server.
- Advertises structured `workspaceTypes` while preserving Harness and CodeX capability discovery for existing clients and Hosts.
- Applies backend switches live, disables undiscoverable workspace switches, and cancels backend initialization when disabled.
- Uses consistent capability and readiness checks on Desktop and Android; prevents late ACP history and subscriptions from replacing another conversation.
- Matches AGY project URIs exactly, handles encoded directory names and native file paths, and confines restored transcripts to the AGY brain directory.
- Replaces local-data-dependent AGY tests with isolated fixtures and preserves the main branch's Android session recovery improvements.
- Makes committed Plugin bundles reproducible across pnpm dependency layouts.
- Advances the Plugin and Android app to `0.5.0` (Android `versionCode 39`).

## 0.4.27 - 2026-09-30

- Fixes Harness version discovery for globally installed DSH CLI symlinks, so Hosts running `dsh 0.2.0-rc.2` report their Harness version again.
- Keeps the DeepSeek Harness 0.2.0 Desktop shell lookup and its version-gated workspace compatibility paths intact.
- Isolates development-service preview HTTP/WebSocket resources per Client and closes connections immediately when their ports are revoked, without affecting other allowed previews.
- Adds regression coverage for npm CLI symlinks and the `0.2.0-rc.2` Session V3 profile.
- Advances the Android app to `0.4.27` (`versionCode 38`) alongside the Plugin release.

## 0.4.26 - 2026-09-30

- Improves the Android conversation composer and adds more actions to the conversation menu.
- Adds transport heartbeat diagnostics and Noise IK golden-vector coverage for easier connection troubleshooting and protocol maintenance.
- Fixes the Windows uninstall path when optional plugins are missing, and keeps the committed Host bundle aligned with the merged release state.
- Advances the Android app to `0.4.26` (`versionCode 37`) alongside the Plugin release.

## 0.4.25 - 2026-09-29

- Desktop Remote Web and Android now merge multiple reasoning and plan segments from the same assistant turn into one default-collapsed analysis section. The answer remains visible, and tapping the section expands the complete reasoning.
- Both clients preserve tool activity rows while grouping Harness turns and CodeX turns consistently by their native turn identifiers.
- Advances the Android app to `0.4.25` (`versionCode 36`) alongside the Plugin release.

## 0.4.24 - 2026-09-29

- Fixes Harness version detection on the DeepSeek Harness 0.2.0 Desktop shell. When the running entrypoint is `@deepseek-ai/dsh-desktop-host` inside `app.asar`, the Host now resolves the `@deepseek-ai/dsh` package through the entrypoint's module scope instead of relying on the ancestor chain only, so it reports `harnessVersion` again.
- Restores the version-gated workspace compatibility paths on 0.2.0 Hosts, fixing the Remote Web file-change subscription and byte-range reads (legacy `workspaceFiles/changes` root-path injection, `workspaceFiles/readBytes` range nesting under `options`, and the 0.2 default-Workspace request shape).
- Advances the Android app to `0.4.24` (`versionCode 35`) alongside the Plugin release.

## 0.4.23 - 2026-09-29

- Upgrades the official DeepSeek Harness development baseline to `dsh-v0.2.0-rc.1` and publishes peer ranges for the new `0.2.0-rc.1` package line.
- Keeps Session V3 selection and the 0.1.7 workspace payload adaptations correct on `0.2.0-rc.1`, including command attachments and byte-range reads.
- Extends the authenticated fixed allowlist for the 0.2.0 native UI (`session/projections`, workspace application lookup, default workspace initialization, and session pinning).
- Advances the Android app to `0.4.23` (`versionCode 34`) alongside the Plugin release.

## 0.4.22 - 2026-09-28

- Fixes the latest Typert Remote provider-directory request by preserving the required plain-object `args` payload.
- Tightens the Typert gateway request type to match the current Remote contract and adds regression coverage for empty provider-directory calls.
- Advances the Android app to `0.4.22` (`versionCode 33`) alongside the Plugin release.

## 0.4.21 - 2026-09-28

- Updates Remote Web model configuration compatibility for DeepSeek Harness 0.1.7; the provider-directory payload regression in that release is fixed in 0.4.22.
- Adds one-time Host registration installers and the `ds-harness-remote register <server-token>` CLI command; the token installers enable the Host terminal setting for the registered service.

## 0.4.20 - 2026-09-27

- Restores the Remote settings page's sign-out action in both clean and unsaved states.
- Shows the local Host name and device ID in Remote settings.
- Includes localized package metadata for the DSH plugin manager.

## 0.4.19 - 2026-09-27

- Refreshes the published npm package README and release metadata to match the repository's current 0.4.18 feature set, compatibility range, self-hosted Server scope, and installation commands.

## 0.4.18 - 2026-09-26

- Primarily improves compatibility with DeepSeek Harness `0.1.7-rc.1`: the plugin handles the Volatile settings entry, updated Typert stream-open signature, workspace file change/read payloads, and the new byte response shape while retaining the `0.1.6` settings path.
- Keeps the legacy `0.1.6-alpha.2` Host path working, including onboarding acknowledgement handling when the older settings registry rejects the new welcome field.
- Thanks to [HuanLinOTO](https://github.com/HuanLinOTO) for the `0.1.7-rc.1` compatibility work and the accompanying fixes.

## 0.4.17 - 2026-09-22

- Fixes the CodeX workspace terminal in Remote sessions. The Host now answers the official `terminal/*` contract for `codex:<threadId>` scopes: `environment` carries `scrollback`, `shells` uses `{path,args,name}`, `list`/`create`/snapshot/state carry the full `WebTerminalInfo` with `controllerId`, mutations resolve to void, `retain` acknowledges with `retained`, and `follow` opens with a snapshot followed by `sequence + 1` output. The shell starts through the Host `subprocess` service (PTY) when available and falls back to a plain pipe otherwise; recovery screens replay a bounded output journal.
- Routes CodeX virtual Harness file and terminal requests from Desktop clients through the authenticated Host carrier, so remote CodeX sessions can use the Host workspace files and terminal APIs.
- Collapses the Host list on the Remote page while a Host is connecting, so the progress panel is on screen, and limits the list to five rows with internal scrolling.

## 0.4.16

- Restores the Remote settings card border and rounded corners in Harness 0.1.6, adds inner spacing, and limits the card width.

## 0.4.15

- Adds the native workspace file tree and read-only previews for Harness `0.1.6-alpha.2`.
- Adds remote terminals and development-service previews, enabled locally on the Host with settings that apply immediately. Previews currently require Desktop or a browser connected to a local Harness.
- Adds a single-account self-hosted relay with Docker deployment files, plus refreshed landing, login, and device-status pages. Remote Web conversations are not included.
- Adds macOS/Linux and Windows Host installation scripts and a downloadable Chrome/Edge extension ZIP.
- Fixes Host authorization recovery and repeated connection replacement between instances (#70).
- Switches Desktop Host status to live updates, reducing polling.

## 0.4.14

- Adds configurable ACP (Agent Client Protocol) IDE backends. The Plugin carries a
  backend-neutral `AcpGateway` plus a stdio JSON-RPC adapter, exposes the
  `agent.acp.v1` capability with bounded prompt and update limits, and lets the
  Remote settings surface enable, add, and probe backends (Codex, Cursor, Kimi,
  or a custom command). ACP is enabled by default but gated on an availability
  check, so a missing CLI reports `not installed` instead of failing the Host.
- Shows Host-side connected Clients in the Remote host picker as a
  `{count} connected` pill next to Refresh, with a dropdown that lists the peers
  and their platform, instead of a standalone settings card.
- Adds experimental DeepSeek Harness `dsh-v0.1.6-alpha.1` support to the Plugin
  and its Host/Remote carriers. `0.1.6` builds report patch `6`, so they already
  select the established v0.1.5 Session V3 Typert Remote Gateway profile and need
  no additional wire-format adapter or version branch.
- Extends the DSH peer dependency matrix to `>=0.1.5-alpha.1` and drops the
  `0.1.5-rc.1` upper bound, so the `0.1.6` line resolves as supported instead of
  being rejected by peer validation. The range is intentionally left open-ended.
- Moves the Plugin development, type-check, and test baseline to
  `@deepseek-ai/dsh-*@0.1.6-alpha.1`.
- Verifies the Web → Host main path against a standalone
  `dsh-v0.1.6-alpha.1` instance running the local Plugin build. Cross-machine,
  CodeX, Android, VS Code, and WebRTC coverage on `0.1.6` is outside this
  verification set and stays tracked in `docs/TODO.md`.
- Selects the command attachment field by Host version, so `dsh-commands` 0.1.2
  (`images`) and the newer attachment field both round-trip image prompts.
- Publishes the `harnessCapabilities` constant from protocol §17, documents the
  control extensions, marks `webrtcEnabled` as an implementation extension, and
  adds the `HARNESS_VERSION_INCOMPATIBLE` and `RESPONSE_TOO_LARGE` error codes.
- Android: opens on the device list titled `DSH Remote` instead of connecting to
  the remembered Host on launch (`resolveAutoConnectDevice` is kept but no longer
  routed), adds per-host workspace favorites shown as home-screen links that
  connect and open the workspace's latest conversation, falls back to the three
  most recently visited workspaces while Favorites is empty, shows the device and
  transport as the workspaces header with back navigation, and aligns assistant
  activity, reasoning, and answer text on one left edge.
- Android: offers the conversation quick actions (review changes, commit,
  review screenshot) in Harness conversations as well as CodeX ones, stops icon
  buttons from painting solid black interiors in the light theme (the plus showed
  up as a filled black circle) with the create buttons now using the accent tint,
  and keeps the remembered workspace collapse when a home-screen shortcut opens
  the list.
- Advances the Plugin, VS Code extension, and Android app to `0.4.14`
  (`versionCode 31`).

## 0.4.13

- Registers the Remote loopback control route directly on the DSH web server
  when available, preserving the same request rejection checks while restoring
  `/ds-harness-remote/*` control calls on newer Desktop hosts.
- Advertises legacy ApiProxy capabilities alongside Session V3 when the Host has
  both carriers, so older Remote Web clients can still select the rc.2 path.
- Lets Session V3 Desktop clients open legacy v0.1.2 Typert Remote Hosts by
  normalizing legacy session pages, follow snapshots, event names, message
  sources, replacement ranges, and history gaps at the Remote boundary.
- Keeps legacy Typert clients fail-closed against Session V3 Hosts and permits
  Codex-only Hosts to pass feature probing without requiring a Harness carrier.
- Advances the Plugin, VS Code extension, and Android app to `0.4.13` (`versionCode 30`).

## 0.4.12

- Upgrades the DeepSeek Harness `dsh-v0.1.5` compatibility baseline from
  `alpha.1` to `rc.1` across the Plugin, Android, and VS Code Typert clients.
- Extends the DSH peer dependency matrix to `0.1.5-rc.1` while retaining the
  existing Session V3 capability and mixed-generation rejection behavior.
- Normalizes released Remote sessions that still report the retired `code`
  agent preset to `ptc` in the Plugin adapter, Android app, and shared
  Typert Remote client so old sessions resume on `dsh-v0.1.5-rc.1` without
  patching Harness itself.
- Advances the Plugin and Android app to `0.4.12` (`versionCode 29`).

## 0.4.11

- Adds experimental DeepSeek Harness `dsh-v0.1.5-alpha.1` support across the
  Desktop Plugin, Android, and VS Code Typert clients.
- Advertises Session V3 Hosts with `harness.remote.v3` and rejects Desktop
  v0.1.2/V3 mixed connections before switching targets or mutating a Workspace.
- Updates the CodeX native projection for Session V3 headers, replacement ranges,
  assistant settlement streams, and strict event validation while retaining the
  `dsh-v0.1.2-alpha.1`–`rc.1` path.
- Narrows DSH peer dependency ranges to versions covered by the compatibility
  matrix and advances the Plugin and Android app to `0.4.11` (`versionCode 28`).

## 0.4.10

- Fixes Web and Desktop Codex approval controls to show Host-confirmed policy,
  require Host confirmation for changes, and preserve the current Thread policy
  when sending prompts or forking.
- Remembers the selected DSH or CodeX workspace tab per Host on Android and
  removes the redundant permission hint below the chat composer.
- Shows one active Desktop transport probe at a time, progressing from the LAN
  cue to P2P during direct negotiation and retaining the actual selected route.
- Aligns Account Authorization schemas and credential validation across the
  Plugin, Android, Browser, and VS Code clients, with shared protocol fixtures
  also consumed by Android tests.
- Advances the Plugin and Android app to `0.4.10` (`versionCode 27`).

## 0.4.9

- Refines the Desktop Remote workspace chooser with selected Host and version
  details in the header, direct Host switching, compact three-item DSH and
  CodeX lists, centered expand actions, backend-specific icons, and
  double-click opening without nested list scrollbars.
- Drives Desktop connection feedback from the Host runtime's real transport
  phases and selected route, and removes the extra simulated workspace-opening
  progress stage before handing control to the native Harness UI.
- Adds DSH and CodeX workspace tabs plus name/path search on Android, and opens
  the first conversation immediately after creating a workspace.
- Advances the Plugin and Android app to `0.4.9` (`versionCode 26`).

## 0.4.8

- Reworks Android workspace creation into one `New workspace` flow. When Codex
  is available, the creation sheet lets users choose DSH or Codex as the
  workspace type before selecting the Host directory.
- Improves Android reply feedback with a visible generating state before the
  first streamed item, activity indicators for active reasoning and running
  tools, and an animated streaming cursor.
- Advances the Plugin and Android app to `0.4.8` (`versionCode 25`).

## 0.4.5

- Fixes a `v0.4.4` Desktop startup regression where the Remote browser client
  could poll `/ds-harness-remote/status` before the local Connection service had
  registered the plugin control route, producing frequent HTTP 405 transport
  failures after upgrade. Desktop activation now waits for Connection again
  while dsh-TUI keeps its connection-less Host startup path.

## 0.4.4

- Fixes Codex permission inheritance so existing Threads can keep the App Server's
  persisted approval and sandbox settings, while explicit Android or Desktop
  permission changes still update the remote Thread before the next turn.
- Restores Android reopen and reconnect handling for active Codex turns by
  preserving `activeTurnId` in paged history and allowing the same trusted phone
  to interrupt a recovered in-flight turn after the connection is replaced.
- Hardens Codex Workspace authority by preferring `project/list`, falling back to
  exact `thread/list.cwd` roots only when needed, and validating descendant
  Workspaces with lexical and `realpath` containment.
- Adds the native dsh-TUI `/remote` flow, including default Host startup when no
  browser connection exists, CLI entrypoints, Tab completion, and refreshed user
  docs for GitHub installation.
- Advances the Plugin and Android app to `0.4.4` (`versionCode 24`).

## 0.4.3

- Adds the default-on Codex Remote domain with a settings toggle to the existing encrypted Plugin channel,
  with a fixed App Server allowlist, `project/list`-backed virtual Workspaces plus exact
  `thread/list.cwd` fallback when no projects are available, real descendant Workspace creation
  guarded by lexical and `realpath` containment, paged
  Thread history, live turn projection, prompts, interrupt, and approvals.
- Reuses the native DSH Workspace, Session, conversation, tool, permission, and
  approval surfaces for the Desktop in-memory projection without writing Codex
  data into DSH stores or logs.
- Extends Android with the same `codex.app.*` capability, including project and
  Thread navigation, paged history, model/reasoning controls, image prompts,
  interrupt, and one-time approvals.
- Preserves CodeX message images through the Desktop virtual Session projection
  and Android chat/history projection so safe PNG, JPEG, WebP, and GIF data
  images render in Remote.
- Adds Protocol v1 conformance fixtures and enforces bounded Control, Relay,
  WebRTC, and encrypted transport frames before payload decoding.
- Advances the Plugin and Android app to `0.4.3` (`versionCode 23`).

## 0.4.2

- Adds DeepSeek Harness `dsh-v0.1.2-alpha.2` compatibility while retaining the
  `dsh-v0.1.2-alpha.1` Typert Remote and `dsh-v0.1.1-rc.2` ApiProxy paths.
- Stops importing the `settingsNamespace` helper removed by Harness alpha.2;
  Settings registration now uses a literal that remains type-compatible with
  rc.2 and alpha.1.
- Preserves alpha.2 `RemoteError` identity across the encrypted Desktop stream
  bridge so Host failure codes are not collapsed to `gateway/internal` by the
  local Harness mux.
- Moves the compatibility build matrix to the alpha.2 Gateway, Client, Settings,
  locale, sidebar, slot, and settings UI packages and adds a Bundle regression
  check for the removed Settings export.
- Corrects prerelease peer ranges so strict npm resolution accepts both the
  claimed `0.1.1-rc.2` and `0.1.2-alpha.x` package families, without asking
  alpha installs to resolve the retired rc.2-only ApiProxy package.
- Advances the Plugin and Android app to `0.4.2` (`versionCode 22`).

## 0.4.1

- Replaces the withdrawn `v0.4.0` Release and tag so the alpha.1 Remote Client,
  Host support, and follow-up transport fixes ship as one supported version.
- Adds DeepSeek Harness `dsh-v0.1.2-alpha.1` Desktop support through the
  official Typert Remote Gateway carrier while retaining the
  `dsh-v0.1.1-rc.2` ApiProxy path.
- Adds encrypted Host capability discovery, alpha unary/stream/event routing,
  bounded large-envelope transfers, and a fixed fail-closed endpoint allowlist.
- Keeps an rc.2 Client compatible with older rc.2 Hosts through the legacy
  capability fallback, while rejecting mixed alpha.1/rc.2 Desktop generations
  before native UI switching or Workspace mutation.
- Fixes Host transport selection ordering so `transport.selected` cannot race
  the Noise handshake and bind the two peers to different WebRTC/Relay paths.
- Restores native `@roamhq/wrtc` loading from pnpm-linked DSH profiles on
  Windows, macOS, and Linux, with additional connection diagnostics.
- Correctly identifies private, address-hidden `host`/`prflx` candidate pairs
  as LAN while retaining public peer-reflexive paths as P2P.
- Keeps alpha.1 `dynamicCordisRunner/*` calls local instead of forwarding local
  UI/runtime loading to the selected Host.
- Refreshes Android connection progress, selected-route highlighting, compiled
  workspace verification, and client version metadata.
- Advances the Plugin and Android app to `0.4.1` (`versionCode 21`).

## 0.3.36

- Replaces `v0.3.35`; the previous Release and tag were withdrawn so recent
  connection-progress, login, Android, and remote File Viewer updates ship
  together.
- Fixes desktop and Android Remote connection progress so direct-path probing
  shows `LAN -> P2P` and finishes with the actual selected transport.
- Fixes the plugin QR login completion race and adds a refresh action for
  desktop Remote Hosts.
- Raises remote File Viewer Save As to 1 GiB on LAN/P2P while keeping TURN,
  Relay, disconnected, and unknown routes at 100 MiB.
- Refreshes Android connection transport labels and advances the Plugin and
  Android app to `0.3.36` (`versionCode 19`).

## 0.3.35

- Fixes desktop Remote connection progress so it only shows the first active
  probe group. Automatic connections now show `LAN -> P2P` while probing direct
  paths and finish with the actual selected transport, such as `Using P2P`,
  instead of advancing to TURN on a timer.
- Applies the same progress-route fix to the Android connection screen while
  keeping the full transport preference order for real negotiation and Host
  control-plane metadata.
- Advances the Plugin and Android app to `0.3.35` (`versionCode 18`).

## 0.3.34

- Fixes DSH Desktop startup after upgrading from legacy `dsh-remote` installs
  by moving the browser locale namespace to the canonical
  `ds-harness-remote` id.
- Adds startup migration for legacy loader entries named `dsh-remote` or
  `@dsh-remote/plugin`, disabling them once the canonical plugin is running.
- Adds a client singleton guard so duplicate loader entries cannot register
  duplicate browser contributions in one window.
- Advances the Plugin and Android app to `0.3.34` (`versionCode 17`).

## 0.3.33

- Uses an isolated native WebRTC helper under Electron so DSH Desktop can use
  the native Node RTC backend without loading the addon inside the signed app
  process.
- Prefers direct ICE before TURN/Relay and keeps selected candidate-pair
  telemetry in the desktop connection details.
- Fixes desktop Remote progress so the final route reflects the actual
  connected transport, such as `P2P`, instead of always ending on Relay.
- Advances the Plugin to `0.3.33`; Android remains at `0.3.32`
  (`versionCode 16`).

## 0.3.32

- Keeps the desktop Remote Host list showing the Harness version by sending
  `harnessVersion` during Host device registration as well as the control
  `hello` frame.
- Moves the Remote account sign-out action next to the current device name in
  the desktop Remote workspace window.
- Unifies the DSH plugin package, Cordis instance, settings namespace, and
  client module ids on `ds-harness-remote`.
- Advances the Plugin and Android app to `0.3.32` (`versionCode 16`).

## 0.3.31

- Shows the Remote Client connection probe order during Host connection, including LAN, P2P, TURN, and Relay steps in the desktop progress UI.
- Adds the preferred transport order to the desktop connection details panel with localized labels.
- Shows the same probe order on Android connection progress and device connection information screens.
- Gates remote File Viewer browser-side Save As by route: LAN, P2P, and TURN are allowed, while Relay and disconnected routes stay disabled.
- Advances the Plugin and Android app to `0.3.31` (`versionCode 15`).

## 0.3.30

- Lets authenticated Remote clients configure every settings namespace
  currently registered by the Host through the official Harness ApiProxy,
  including plugin settings and global credential references.
- Keeps configuration writes bounded and fail-closed: unknown namespaces are
  rejected, credential values remain write-only, and Host-local
  `settings.openDocument` stays unavailable remotely.
- Adds remote model-provider configuration and draft endpoint discovery while
  sanitizing discovery failures so submitted keys and endpoints cannot be
  echoed back through adapter errors.
- Adds a lightweight Chrome/Edge MV3 launcher that exchanges existing Web
  authorization for isolated Browser credentials, lists online Hosts, and
  opens the selected Host in Remote Web.
- Hardens VS Code disconnect and sign-out state, including serialized auth
  transitions and revocation with the latest rotated device credentials.
- Makes pull-request file inspection fail closed and limits Android APK builds
  to relevant changes.
- Advances the Plugin and Android app to `0.3.30` (`versionCode 14`).

## 0.3.29

- Keeps the Android conversation smooth while a reply streams: scrolling now
  follows streaming text at a throttled, non-animated cadence, and memoized
  chat rows stop unchanged messages from re-rendering on every delta, so back
  navigation and the keyboard stay responsive during long replies.
- Makes the Android workspace folder picker scrollable so deep project
  directories can be browsed, and removes the workspace subtitle for a
  cleaner header.
- Shows the Harness and plugin versions next to each Android device row
  (platform + DSH version + plugin version) and shortens the Windows label to
  `Win`.
- Advances the Android app to `0.3.29` (`versionCode 13`).

## 0.3.28

- Redesigns the Android device flow with a dedicated connection-progress page,
  clearer device/workspace navigation, a refreshed startup screen, and separate
  More, Settings, and About destinations.
- Adds in-app update checks with APK download/install handoff and progress
  feedback from the Android More screen.
- Renders reasoning as a compact, collapsed disclosure while it streams and
  after completion, tightens tool activity spacing, and fixes composer sizing
  when the Android keyboard opens or closes.
- Adds an offline refresh action to the conversation header. It reconnects the
  secure channel, reloads the current session baseline, and resumes in place
  without leaving the conversation.
- Aligns the Android app version with the GitHub Release at `0.3.28` while
  advancing its Android install sequence to `versionCode 12`, so in-app update
  comparisons remain accurate.

## 0.3.27

- Adds English and Simplified Chinese Android interfaces with a persistent
  in-app language selector and an option to follow Android's current locale.
- Localizes Android screens, status labels, dates, validation, and client-side
  connection errors, and declares both locales to Android's native app settings.
- Adds current Android device-list and image-prompt screenshots.
- Updates the Android app to `0.3.11` (`versionCode 11`).

`v0.3.27` supersedes `v0.3.26`; the previous Release and tag were withdrawn so
the Android localization and preceding fixes ship in one consolidated release.

## 0.3.26

- Adds an Android About & Updates section with the installed app/build version,
  the full open-source repository URL, and the latest GitHub Release URL.
- Keeps plugin-injected instructions and other model-facing context out of the
  Android transcript by requiring the authoritative human `source.kind = user`
  marker for both historical and live `user/message` events.
- Updates the Android app to `0.3.10` (`versionCode 10`).

`0.3.25` was withdrawn before `0.3.26` because
Android could display plugin-injected model context as user conversation rows.

## 0.3.25

- Adds Android photo-picker image prompts with previews, Host-projected image
  limit checks, and bounded ApiProxy transfer for large encrypted requests.
- Keeps image-only prompts visible in Android chat history and preserves local
  previews while the native user event reconciles.
- Splits the Android adaptive icon into a transparent foreground mark and a
  system-masked background, removing the nested border on launcher icons.

## 0.3.24

- Adapts the Remote ApiProxy bridge to DeepSeek Harness `dsh-v0.1.1-rc.2`
  image prompts and Host-side image preprocessing / Files API reuse.
- Allows the native read-only `session.attachment` lookup so sent and
  historical session images can render on the Remote Client.
- Adds bounded, ordered, per-connection chunk transport for large native
  ApiProxy requests and responses without raising the 4 MiB secure-message
  limit or exposing a separate upload/filesystem API.

## 0.3.23

- Adds progress details while the DSH Client connects to a remote Host and
  opens a remote workspace.
- Verifies installation and plugin loading against DeepSeek Harness
  `dsh-v0.1.1-rc.1`.
- Updates local DSH development peers to `0.1.1-rc.1` while keeping the
  published peer range compatible with older DSH builds.

## 0.3.22

- Adds provider-aware GitHub and Zhihu QR sign-in while keeping password
  sign-in available.
- Uses version tags as GitHub Release titles.

## 0.3.21

- Opens the workspace selected in the Remote picker instead of leaving the
  local workspace active.
- Includes the latest Android connection and chat stability fixes and
  deterministic client RPC termination errors.

## 0.3.19

- Namespaces the plugin's loopback Web RPC route as `/ds-harness-remote` so it can run
  alongside Remote Web UI plugins that own the public `/remote` route.

## 0.3.18

- Restores compatibility with legacy `0.3.15` Hosts: Remote workspaces and
  sessions continue to load, while the unsupported remote command catalog
  degrades to an empty compatibility catalog.
- Enables remote file viewing only when the selected Host version supports
  `fileviewer.read.v1`; legacy and unknown Hosts keep the provider disabled.
- Adds bounded, read-only remote file preview through `dsh-file-viewer` for
  compatible Hosts. Writes, uploads, execution, and `openExternal` remain
  unavailable.
- Adds detailed LAN/P2P/TURN/Relay connection-path diagnostics to the Remote
  header.

`0.3.17` was withdrawn because its Client could forward `commands.list` and
register the remote file provider against older Hosts without a compatibility
fallback.
