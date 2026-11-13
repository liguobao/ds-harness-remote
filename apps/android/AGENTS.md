## Offline composer drafts (Issue #7 / upstream #409, 2026-11-12)

聊天输入框的 `editable` 不再由连接状态决定：`chat-screen.tsx` 通过
`chat/composer-gate.ts` 的 `composerEditable({ permissionSelecting, uploading })` 计算，
只有权限切换与上传中会锁定；动作入口（`+`、快捷提示词、附件、工具、权限）继续由
`composerDisabled`（含 `!connected`）禁用。`submit()` 先用同一模块的 `submitIntent()`
判定，`'offline'` 在 `applyDraft('')`/`setQuotes([])` 之前返回，因此离线点击不会清空草稿、
不会插入乐观行；`'ignore'` 覆盖空内容、上传中、历史同步窗口与权限切换。输入框下方在
`!connected && draft.length > 0` 时显示 `chat.offlineSendBlocked`（`composerHint` 样式，
`accessibilityLiveRegion="polite"`）。

store 侧同轮失败关闭：`state/prompt-actions.ts` 的 `sendMessage` 在 `local:` 乐观行插入
之前对 `connection.phase !== 'connected'` 返回 `'rejected'`，Harness / CodeX / ACP 共用
同一入口；注意 `'kept'` 契约要求调用方不回填草稿，因此离线绝不能走到那里。
全屏输入框收起改为只在 `sessionId` 变化时发生，重连不再打断编辑。

边界：草稿仍复用 `browse-memory` 的加密 `draft`（按 server/账号/设备/identity 作用域），
600ms 去抖写入，切后台由 `browse-tracking` flush；不做自动发送、排队或 Host 侧存储。
Bot 模式输入框本就不依赖连接（`inputDisabled`），但其草稿是组件本地 state、不落盘，
本轮未改。

验证：Android check、62 文件 / 581 tests（新增 `chat-quote-and-composer.test.ts` 的
输入可用性矩阵与 `session-recovery.test.ts` 的离线失败关闭场景）与 `git diff --check`
通过。未构建 APK，未做真机断网/后台/TalkBack 验收。

## Notification conversation navigation (Issue #378, 2026-11-09)

显式外部会话打开成功后，App 的 chat 路由携带独立 externalOpenRevision，ChatScreen
据此解锁抽屉并关闭会话列表；重复打开当前会话也触发，普通自动选择会话仍保留启动侧栏。
成功导航切回 Agent 模式并关闭 Host 切换层，支持从设置页等返回目标聊天。保留 bootstrapComplete
等待；空设备目录也消费链接并显示未知 Host 错误，不回退连接另一设备。聊天路由允许全局
错误横幅，避免未知 Host / Session 静默失败。并行 openKnownSession 使用代际隔离迟到提交；
尚未覆盖用户离开页面或同 Host 断线重连期间的完整导航取消。

验证：Android check、现有 61 文件 / 553 tests、production Hermes export（29 MB）与
 git diff --check 通过；本机 Node 22.22.0 / pnpm 9.15.4，存在 TUI 要求 Node >=24.9
的环境警告；保留 Metro noble/hashes exports fallback 警告。未新增展示类测试，
未构建 APK 或验证 Android 真机通知点击；验收矩阵见关联 Issue / PR。

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Conversation image restoration (Issue #159, 2026-10-25)

Android 已移除 rc.2 ApiProxy 客户端；Harness 仅接入 Typert Remote，旧 Host 不再降级。
Harness 历史图片保留 attachmentId 与所属 sessionId，按需通过官方 session/attachment 读取，复用 Typert 有界 transfer。AI 纯图片回复与工具结果
图片不再丢弃，Markdown 工作区图片复用授权 workspaceFiles 预览，不读取手机同名路径。
图片只在组件内存中保存，8 MiB 与现有像素/尺寸限制保持生效；导航、断线或连接替换后拒绝
迟到结果，支持全屏查看与重试。HTTP(S)/协议相对外部图片仍仅显示描述，不自动联网；
CodeX/Claude 不因此获得新的文件读取权限。PNG 发送报错尚无复现，不宣称本次已修复。
本次原生真机与真实跨设备图片显示验收仍待完成。

验证：Android check、36 文件 / 209 tests、production Hermes export 与 git diff --check
通过；保留 Metro 的 @noble/hashes/crypto.js exports fallback 警告。未构建或发布新 APK。

## Conversation activity dock (2026-11-01)

Harness 会话输入框上方新增待办、目标与后台任务折叠行。待办与目标直接读取官方
`todos` / `goal` 投影；后台任务使用已放行的 `job/list` / `job/follow` 只读流，
始终传入当前 sessionId，切换会话/连接时取消订阅，不增加 Host allowlist 或任务控制权限。
后台列表运行中优先、按时间倒序并使用虚拟列表；输出仅保留组件内存中的末尾 64K 字符，
丢失/截断有提示，观察不消费模型输出。工具分类摘要统计调用次数，不推断受影响文件数。
七种语言已补齐。Android check、Release APK 构建与 MIX 3 安装通过；真机已显示真实
目标、待办进度与后台任务列表。未验证本轮暗色、横屏、无障碍、目标操作或后台任务取消；
本轮仅提供只读展示。既有 Metro noble/hashes exports fallback 警告保留。

同日布局修正：非空短对话通过 contentContainer 的 flexGrow / flex-end 贴近输入区，
不在工具摘要与底部状态之间留整屏空白；按用户参考将目标/待办/后台任务显示为独立纤细胶囊，
目标状态、待办进度、当前后台任务与耗时在折叠态可见。生成中空输入区收成单行，
点击文字区展开原输入框；状态不伪造上下文百分比。摘要使用普通正文权重，保持 44dp 点击区域。
类型检查与 Release 构建通过。

## Chat screen module boundaries (2026-11-01)

`chat-screen.tsx` 保留页面编排与会话操作；`chat/composer.tsx` 和 `chat/action-menu.tsx`
负责输入区与更多操作菜单。附件选择、消息投影、滚动/阅读位置、命令与引用提示、快捷提示词、
返回键优先级分别位于 `chat/use-chat-{attachments,transcript,scroll,mentions,prompts,back-handler}.ts`。
文案映射保存 key，在渲染时读取当前语言；拍照与相册共用校验流程。发送失败的滚动恢复通过
命令与回滚闭包封装，保留会话切换/用户滚动后的失效保护。返回键监听读取最新面板状态；
运行中编辑时发送与独立停止按钮均可用，空输入仍可折叠为单行。

本轮共享包 build、Android check、44 文件 / 326 tests、production Hermes export 与 diff check
通过。先重建共享包后，旧 client-core dist 导致的 Hermes 类型错误消失；未修改 ACP 模型服务。
保留 Metro noble/hashes exports fallback 警告；Intelligent UI 未安装，使用安全 fallback。
未新增展示类测试，未构建 APK，未进行模拟器或真机交互验收。
