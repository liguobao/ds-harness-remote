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
