# HarmonyOS 客户端更新记录

## 未发布

- **华为离线推送端到端接入**：支持通过本地构建配置注入调试签名包名与 AGC `client_id`，接入 `PushToken` 生命周期及上线自动注册 `push.huawei.register`，支持点击离线推送通知通过 `sessionId` 直达对应会话；主机插件新增 `$events` 后台监听，在会话完成、审批确认、提问等待及异常时向离线注册设备发送带 `clickAction` 的华为推送。
- **DS-Bot 使用体验**：复用 Android 同源角色头像及许可，支持图片头像、引擎标识和群成员头像；名册按可见消息生成摘要，并在后台尝试补取缺失投影；输入框支持多行，补充会话菜单中的详情、编辑、复制、主 Bot 设置、删除确认和新会话操作。
- **DS-Bot 加载与竞态修复**：名册请求去重、提前发布加载结果、连接就绪后重试；保护用户选择免受初始会话迟到覆盖，发送失败保留草稿。

- **协议与传输补齐**：新增 512KB 分片传输编解码（`TransferCodec.ets`）、扩展 `RemoteGateway` 能力探测与 `RESPONSE_TOO_LARGE` 自动分片回退、统一 `SessionToolsClient.ets` RPC 通道。
- **富文本与对话体验**：支持多语言语法高亮代码块、TeX 公式卡片、Markdown 表格、Mermaid 标记识别；新增 `@` 会话/文件/技能 与 `/` 斜杠命令弹窗、长按引用回复、`👍/👎` 消息反馈、普通文件附件与多模式/Agent 预设切换；接入 `wantAgent` 系统后台审批/提问/完成通知。
- **生产力面板补齐**：新增「工作区文件浏览器」（上传/分页预览/图片/PDF 与 Office 转 PDF 预览）、「多标签远程终端」（ANSI 缓冲与快捷按键栏）、「会话活动中心」（后台任务与日志/待办/子智能体/排队插话）、「主机插件与设置」弹窗，以及「定时任务」直接创建与启停切换。
- **多后端完整支持**：接入 `CodexRemoteClient` 与 `AgentAcpClient`（Cursor / AntiGravity / Claude / OpenCode / Pi / Hermes），支持会话列表后端筛选与多后端新建/续聊/中断/审批/模型切换。
- **DS-Bot 与 Intelligent UI**：新增原生 `DS-Bot` 团队工作台（Bot/群聊切换、`/btw` 旁白提问、`@` 成员提及、问答/审批/交互视图、成员与群聊创建、用量统计与偏好设置），并在对话中原生渲染 `ui_render` / `ui_patch` / `ui_compose` / `ui_render_widget` 智能交互卡片。
- **工程与版本管理**：新增 `OUR_CHANGES.md` 与 12 组 Vite 单元测试（89 项用例），补充本地 API 21 构建脚本 `scripts/build-local-api21.mjs`。
- **多 Harness 目录修复**：切换 Codex/Antigravity/OpenCode 现在会立即拉取各自会话；工作区按 Harness 过滤；Codex `thread/list` 带分页参数；ACP 无标题会话不再被当作空白隐藏；并记录各后端目录数量日志。
- **DS-Bot 抽屉对齐 Android**：抽屉内 DS-Bot 标签保持抽屉打开并显示机器人/群聊名册（筛选、搜索、新建、头像、状态点、主 Bot 星标），Bot 页顶栏改为 `☰ / 头像+名称+引擎徽标 / ⋯` 并移除 emoji 图标。
- **Android 1:1 界面与交互对齐**：
  - 左侧抽屉对齐 Android 结构：`🐳 DS Harness Remote` + `⋮` 溢出菜单（插件/自动化任务/设置/关于/检查更新）、`智能体 | DS-Bot` 下划线切换、工作区 Harness 下拉选择器（`切换 Harness`）、可折叠白底工作区分组卡片（`WorkspaceGrouping.ets` 含紧凑相对时间 `16h`/`3d` 与「展开剩余 N 个会话」）以及底部主机切换与设置栏；
  - 对话页对齐 Android 阅读体验：左侧 `☰` 抽屉按钮、居中会话标题（点击打开「对话信息」弹窗 + 模型选择）、右侧轨迹与新建双按键胶囊；全宽无边框助手消息流；统一圆角输入卡（`+`「更多操作」含相机拍照/相册/文件与工作区/模式/工具访问/操作权限，`⚡` 提示词与全屏编辑，加密提示页脚）。
  - **矢量图标复用与着色对齐**：直接复用 `apps/android` 中的官方 DeepSeek 品牌图标（`fish-logo.ts`、`official-menu-icon-data.ts`、`dsh-icons.tsx`）及整套 Lucide 线性矢量 SVG 资源，并通过 `Theme.iconTintFilter`（`BlendMode.SRC_IN`）进行主题着色，全面替代原 emoji 符号并保持空心描边还原。
- 应用包名（`bundleName`）与 Android 对齐为 `io.github.liguobao.dshremote`；签名 Profile 与设备安装需使用同一包名。
- 支持 `remote.transport.upgrade.v1` 带内传输升级：在中继上完成认证后并行协商 TURN/P2P/LAN 直连，切腿不重建 Noise、不重置流订阅；升级帧使用 `DSHU` 序号头和有界重排处理跨腿乱序，升级失败保持中继数据面。
- 直连协商与初始目录/历史读取有界并行：Wi-Fi/有线最多等 450ms、蜂窝最多 250ms 后回落中继，避免弱网下多等数秒。
- 会话列表隐藏子代理（`subagent`）会话与非当前打开的空白占位会话，空白占位不参与搜索，也不贡献工作区筛选。

## 首次集成

- 提供 HarmonyOS 原生客户端，支持账号登录、Host 选择、多会话及流式回复。
- 支持模型与权限选择、图片和语音输入、会话搜索与归档。
- 支持端到端加密、主机公钥固定、系统安全存储及网络中断恢复。
- 支持 LAN/P2P/TURN/Relay 传输、手机和平板布局、中英文界面与主题切换。

贡献者：[Mangoman2008](https://github.com/Mangoman2008)。
