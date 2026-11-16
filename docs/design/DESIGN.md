# 界面设计系统

本文维护交互原则和组件归属。具体颜色、字号、间距、时长及响应式阈值以源码为准，不在文档复制一份容易失配的 token 表。

## 设计来源

- Android：[theme.ts](../../apps/android/src/ui/theme.ts)、[theme-context.tsx](../../apps/android/src/ui/theme-context.tsx)、[components.tsx](../../apps/android/src/ui/components.tsx)。
- 动效与弹层：[motion.ts](../../apps/android/src/ui/motion.ts)、[sheet.tsx](../../apps/android/src/ui/sheet.tsx)。系统减少动态效果设置必须有降级。
- 窗口适配：[responsive.ts](../../apps/android/src/ui/responsive.ts)；导航入口为 [App.tsx](../../apps/android/App.tsx)。
- 官方菜单图标的来源与许可见[图标说明](../official-menu-icons.md)。
- Desktop 复用 Harness 原生 Workspace / Session / Conversation UI；Remote 负责账号、Host、工作区选择、设置及远程状态。CodeX / ACP 使用内存投影，不另建持久化会话界面。

## 主题与可访问性

支持系统、浅色和深色主题，组件使用共享 token。文字、图标、选中状态和错误应保持可辨认，不只靠颜色传递状态。

系统字体缩放、按钮名称、焦点反馈、selected/disabled/expanded 语义及键盘适配由共享组件承载。代码与文本预览使用等宽字体。TalkBack、大字体、短窗口和原生设备效果需要目标平台检查，不能将源码中的属性视作无障碍认证。

## 导航与状态

主路径为账号/Server → 设备 → 工作区及会话 → 聊天。会话抽屉按后端、工作区和当前 Host 展示目录，提供搜索、收藏/最近访问与创建入口。折叠、草稿、阅读位置和最近访问按既有加密存储 scope 保存；跨 Host 不复用会话 authority。

Agent / Bot 切换是本机导航偏好，不修改 Host 界面模式。重连不能将不可用后端替换为另一个后端，或把 Remote 请求回落到 Local 数据。设备信息与会话信息显示实际版本、连接、加密与目录；断线时不把旧网络数据显示为当前状态。

Chat 的全屏输入、Sheet、抽屉和图片查看沿用统一动效。关闭 Sheet 播完退出动画再卸载，避免内容跳变；减少动态效果时压低时长并取消位移/缩放。

## 会话与输入

- 历史、流式正文、分析和工具活动保持所属后端的顺序与失败状态；pending 问答/审批不藏在已折叠的活动中。
- 手动向上滚动停止跟随；回到最新消息恢复跟随。程序滚动不能误判为用户阅读意图。
- `+` 提供附件与工具访问，快捷提示词独立展示，轨迹有标题栏入口。实际入口以当前后端 capability 为准。
- Agent 离线仍可编辑草稿，发送保持禁用；断线不能清空或自动发送草稿。Bot 草稿目前是组件内存状态，不承诺落盘恢复。
- 模型、effort 和权限只显示上游提供且确认的值；未知状态明确显示沿用 Host 设置。Agent 审批、会话策略与终端输入权分别呈现。
- 文件上传、Prompt 投递和取消显示真实进度与不确定结果，不因超时自动重放 mutation。

## 响应式与键盘

App 跟随系统旋转。同一导航和连接状态适应手机、平板、分屏与短窗口；聊天保持居中的可读列，满足尺寸条件时采用左目录/右会话双栏。

浮层和对话框按当前窗口限制高度，长内容在层内滚动，提交操作保持可达。使用实时安全区及键盘 inset，旋转后重新测量，不叠加过期的 IME 留白。Bot 表单同样使用键盘避让与可滚动内容。

## 文件、终端与 Bot

Files 的目录、只读预览、分页和保存动作复用会话 scope。图片/PDF/Office 使用本地受限 renderer；不执行 Host HTML/SVG、PDF 脚本或任意外链。显式保存文件与普通内存预览是两条不同流程，限制见[Android 说明](../../apps/android/README.md)。

Terminal 使用本地 xterm WebView，明确区分输入权、退出、离线及 Host 禁用状态。关闭面板释放订阅，结束终端才终止进程；重连恢复有界屏幕，不重放输入。

Bot 团队、群聊、管理、问答和卡片使用共享 Button、IconButton、Sheet、表单与主题。管理和审批先经过当前认证通道，再由 DS-Bot 固定 handler 校验；原生 UI 只覆盖已接入功能。卡片使用受限原生图表/公式，不执行模型 HTML 或脚本。

## Desktop 与维护

Remote 只设置自身贡献的样式，不覆盖 Harness 全局 CSS 或其他插件布局。侧栏折叠/展开、长 Host 名称、键盘焦点和 Windows 拖拽区必须兼容。

访问设置仅 Host 本地修改；后端保存热更新变化的后端。不可发现不等于登录失败，命令可发现也不等于协议就绪。

功能范围和剩余工作统一见 [TODO](../TODO.md)；临时截图、设备日志和测试数量不保存在设计系统中。
