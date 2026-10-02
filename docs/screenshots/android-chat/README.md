# Android 聊天增强：模拟器验收

本目录是 Android 模拟器的真实截图，不是界面示意图。截图中的个人绝对路径均已遮挡；用量弹窗裁切到弹窗本身，避免弹窗后方的路径泄露。未提交原始截图、UI hierarchy、账号信息或个人运行数据。

## 功能

- `@`：从真实工作区文件树与会话列表选择文件、文件夹、对话；引用采用官方 Harness 语法，编辑框内显示蓝色。
- `/`：命令、技能建议菜单，支持搜索、滚动、选择；编辑框中的命令显示蓝色。
- 回答操作：复制、好的回答、有问题的回答、在新对话中分支、真实用量和时间。
- 轨迹模式：右上角图标切换，按系统、用户、上下文、助手、工具筛选；搜索已加载消息与工具，显示轮次和时间。

## 已验证

验证环境：Windows 本机 Android 模拟器，x86_64 debug APK，经 Metro 加载当前代码；连接真实 Harness 0.2.0-rc.1 Host。

- 原生 Gradle `app:assembleDebug` 成功，`adb install -r` 成功；新加入的 `expo-clipboard` 已进入原生包。
- 文件、目录、对话和命令均实际从菜单点击插入；目录插入 `@src/`，对话使用官方 `dsh-session:` URI。
- 键盘展开与收起时建议菜单可见，长列表可滚动、可点击。Android 原生 attributed TextInput 确实显示蓝色，不依赖被黑色原生文本遮盖的背景高亮层。
- 复制回答后通过 Android 粘贴回编辑框，文本与原回答一致。
- 好/差评价通过官方 Host API 写入并读回。再次打开原会话，差评价仍为选中状态，不只是临时变色。
- 从第一轮助手回答创建真实分支，Host 新会话记录为 seeded，继承 20 个事件，仅一轮历史；原会话的第二轮回答不会被带入该早期分支。另验证了第二轮回答分支。
- 第二轮回答用量：输入 249、输出 74、缓存读取 7296、缓存写入 0、总计 7619；与 Host 投影记录一致。消息时间为 17:33。
- 轨迹的工具筛选显示真实 write/pwsh 调用；搜索 pwsh 后只保留该匹配项；可切回普通对话。
- `pnpm -r check` 通过。
- Android：23 个测试文件、245 个测试通过，包括实际 store 打开的反馈缓存/分页回归和 slash 命令结果测试、官方图标路径/映射测试、背景一致性与快捷按钮删除检查。
- client-core：38 个测试通过。
- ApiProxy / Typert Host bridge：35 个测试通过。
- DSH bundle 校验与 `git diff --check` 通过。

## 截图

| 文件 | 内容 |
| --- | --- |
| `message-actions.png` | 消息操作栏、评价回显、用量和时间 |
| `mention-file.png` | 蓝色文件引用 |
| `mention-folder.png` | 蓝色文件夹引用 |
| `mention-session.png` | 蓝色会话引用，保留官方序列化语法 |
| `slash-command.png` | 蓝色 `/compact` 指令 |
| `trajectory.png` | 轨迹模式和工具筛选 |
| `usage.png` | 真实用量详情弹窗（裁切） |
| `branch.png` | 旧回答分支，历史截止在第一轮 |
| `official-file-menu.png` | 官方 BrowseOutline 文件图标 |
| `official-folder-menu.png` | 官方 FolderClose 文件夹图标 |
| `official-session-menu.png` | 官方 ChatLinesOutline 对话图标 |
| `official-slash-menu.png` | 官方文件、目标、计划图标 |
| `official-slash-commands.png` | 官方压缩、权限图标 |
| `official-skill-menu.png` | 官方模型、下载、技能图标 |
| `goal-result.png` | 真实 `/goal` 指令返回文字弹窗 |
| `unified-file.png` | 文件菜单背景统一为“对话”标题的浅灰 |
| `unified-session.png` | 同色的对话菜单，个人路径已打码 |
| `no-quick-actions.png` | 已删除检查改动、提交代码、查看截图三个快捷入口 |

背景补修：菜单容器、所有分组标题及高亮行均使用 `colors.background`，不再因文件候选高亮而换成不同底色。模拟器像素比对中，文件/对话标题和内容行的背景均为 RGB(245,245,247)。

菜单的原始 SVG 路径来自官方 Harness，保留蓝色；出处与 MIT 许可见 [official-menu-icons.md](../../official-menu-icons.md)。上述新增菜单图标已在模拟器中实际查看，文件项已点击插入，蓝色像素断言通过。`/goal` 查询也真实执行并显示 Host 返回的文字，没有伪造普通聊天消息。

## 验证边界

- 未验证实体手机、跨网络或长期断线重连；debug APK 需要 Metro，并非独立发布 APK。
- 旧 rc.2 ApiProxy Host 没有官方消息评价接口，会明确提示不可用；CodeX 会话的评价与精确消息分支也不伪装成支持。
- Host 未提供消息时间或用量时显示不可用；不会以设备当前时间或估算 token 代替。
- 轨迹使用真实已加载记录；本次短会话未覆盖历史分页按钮的模拟器点测。没有实现桌面端完整的耗时甘特图。
- `/` 菜单的搜索、插入、原生协议参数已验证；没有把所有命令（例如真实 `/compact` 压缩、`/export` 下载）都列为模拟器端已验收。
