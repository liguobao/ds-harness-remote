# 鸿蒙客户端 vs 安卓客户端：功能差距清单

> 对比基准：`apps/android`（约 140 个文件 / 29k 行）与 `apps/harmony`（26 个文件 / 13k 行）。
> 结论：鸿蒙端目前覆盖「登录 → 连主机 → 会话 → 发消息/图片/语音 → 设置」的主干，
> 安卓端的**生产力外设**（终端、文件预览、多后端、自动化）基本都还没有。

## 已经对齐（鸿蒙有）

| 能力 | 安卓 | 鸿蒙 |
|---|---|---|
| 登录（账号密码 / 扫码 / OAuth） | ✅ | ✅ |
| 主机列表、在线状态、改名、公钥固定 | ✅ | ✅ |
| 会话列表/搜索/新建/改名/分叉/归档 | ✅ | ✅ |
| 会话流（文本/思考/工具卡片/审批/提问） | ✅ | ✅ |
| 发消息、插话（steer）、排队、中断 | ✅ | ✅ |
| 模型目录与切换、推理等级 | ✅ | ✅（0.08.0 修好） |
| 权限预设切换 | ✅ | ✅（0.08.4 起走 `/permission`） |
| 斜杠命令补全 | ✅ | ✅（0.08.6 修好） |
| 图片发送（相册→压缩→prompt） | ✅ | ✅ |
| 图片预览（缩放/拖动/双击） | ✅ | ✅ |
| 语音输入 | ✅ | ⚠️ 按住说话已做；转写依赖主机 speech 插件 |
| 主题（跟随/浅/深）+ 语言（中/英） | ✅ | ✅ |
| 文字大小调节 | ✅ | ✅（0.09.0） |
| 响应式布局 | ✅ `responsive.ts` | ✅（0.09.0，断点 880/1020/1180） |
| 直连（LAN/P2P/TURN + 回落 relay） | ✅ react-native-webrtc | ✅ ArkWeb + WebRTC（0.06.1 起） |
| 断线重连 | ✅ `connection-recovery` | ⚠️ 只有退避重连，无前台保活 |

## 鸿蒙端还没有（按建议优先级排）

1. **文件预览**：PDF（`pdf-preview`）、通用文件卡（`file-card`）、工作区文件预览
   （`workspace-file-preview`）。鸿蒙只有图片预览。
2. **代码块高亮与复制**：安卓 `code-block.tsx`（184 行）做语法高亮 + 复制按钮；
   鸿蒙是等宽纯文本。
3. **@文件提及 / 引用回复**：`mention-popover`、`quote-preview`。鸿蒙完全没有。
4. **Markdown 数学公式**：`markdown-math` + `math-svg`（KaTeX 风格离线渲染）。
5. **定时任务 / 自动化**：`automation-tasks-modal`、`schedule-actions`（cron、一次性）。
6. **多后端**：CodeX / Claude / Cursor / Antigravity / OpenCode / Pi 各自的 client 与切换 UI，
   含工作区前缀与历史投影。鸿蒙只走 Harness 原生。
7. **终端面板**：`terminal-panel` + `terminal-attachment`（交互式 shell、resize、粘贴）。
8. **插件管理**：`plugins-modal` + `plugin-inventory`（列插件、启停）。
9. **任务板 / 子代理 / 轨迹**：`job/list`、`subagents/*`、`chat-trajectory` 轨迹视图。
10. **键盘插入区处理**：`keyboard-inset.tsx`（安卓处理软键盘顶起与滚动）；
    鸿蒙靠 Stack 底部定位，横屏/分屏下还需实测。
11. **图片预览元数据 / 附件缓存策略**：安卓有 `attachment-cache`、`image-preview-metadata`；
    鸿蒙目前是内存 Map，无上限也无淘汰。
12. **官方菜单图标集**：`official-menu-icon-data.ts`（393 行）与 DSH 桌面一致；
    鸿蒙用自绘 SVG。

## 建议的落地顺序

1（文件预览）→ 2（代码高亮）→ 3（@提及/引用）→ 5（定时任务）→ 6（多后端）。
第 4、8、9 属于「有更好、没有不阻塞」；第 7 终端体量大且安全敏感，放最后。
