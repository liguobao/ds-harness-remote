# Android → haru 真机验收（2026-11-14）

## 环境与变更

- 手机：Xiaomi MIX 4（2106118C），ADB `6690723a`，arm64-v8a。
- 使用 `bash scripts/install-android-release.sh` 构建当前 checkout 并覆盖安装；App 0.6.5 / versionCode 72，保留原数据。workspace build、Android check、Release APK 构建和安装版本核对通过。
- Host：`liguobao@192.168.31.9`（haru），DSH 0.2.2-rc.1，`~/.dsh/profiles/web`，`dsh-web.service`。
- Remote Host 保持原安装的 npm 0.6.4；本次查询 npm 的 latest 也是 0.6.4。没有将仓库开发版 Host 覆盖到该实例。
- 通过官方 `dsh plugin --profile web add ds-bot@0.3.6` 安装 npm latest DS-Bot，并重启 `dsh-web.service` 加载。服务恢复 active，Remote 控制连接 online。
- 手机首次信任的 haru 指纹与 SSH 读取的 Host 日志一致。连接信息显示 P2P 直连、Noise IK / ChaCha20-Poly1305；本轮不能算 LAN TCP 数据通道验收。

## 真机结果

| 项目 | 结果与证据 |
| --- | --- |
| 主机目录与认证连接 | haru 在线，信任后加载工作区和真实会话列表 |
| 新建会话、切换模型与发送 | 独立测试会话先收到 GLM 429；改为 DeepSeek-V4.1-Flash 后返回 `HARU_ANDROID_SMOKE_OK` |
| 历史重载、用量与轨迹 | 重启后可再次打开测试会话，回复及用量可见；轨迹可显示系统/用户/助手记录与筛选入口 |
| 文件目录与只读预览 | 打开 `/home/liguobao/.000-dsh-smoke-20261114/preview.txt`，显示 `HARU_FILE_PREVIEW_OK` |
| 文件下载 | 点击“保存到手机”，`/sdcard/Download/preview.txt` 为 21 bytes，ADB 读取内容与 Host 一致 |
| 文件上传 | 从 Android 系统文件选择器选取 2 MiB 二进制，上传为 `/home/liguobao/haru-android-smoke-20261114.bin`；两端 SHA-256 均为 `91d3beb88a9b2f778a6c44a1c53b63d3c79931845a9aef84b3fb414610bd1938` |
| 终端 | 手机打开 zsh，执行 `echo HARU_TERMINAL_SMOKE_OK` 并显示正确输出；结束测试终端 |
| Bot 新建与模型选择 | 创建 `AndroidSmoke1114`、`AndroidSmokePeer1114`，指定 DeepSeek-V4.1-Flash，列表显示就绪 |
| Bot 单聊 | 从手机发送后显示 `HARU_BOT_SMOKE_OK` |
| 群聊创建与回复 | 创建含上述两个 Bot 的 `AndroidSmokeRoom1114`；Host 两名成员均回复，手机只显示第一名，见下文 |
| 断网与重连 | 短时关闭 Wi-Fi 后显示连接失败；恢复 Wi-Fi 后可重新加载。离线冷启动出现主机列表失败时，需手动刷新并选择 haru |
| 离线草稿 | Agent 会话离线仍可输入 `OFFLINE_DRAFT_1114`；发送按钮 `enabled=false`，显示“连接恢复后才能发送”；强制关闭 App、重启并重连后同会话草稿仍在，未自动发送；验收后已清空测试草稿 |
| 设置入口 | 外观、语言、密度、活动组件、启动恢复等设置项正常加载；未更改用户设置 |

## 发现的问题

### 创建 Bot 的表单被键盘遮住

复现：DS-Bot → 新建 → 创建 Bot → 点击名称输入框。软键盘打开后，屏幕只见灰色遮罩与键盘，创建表单整体落到键盘后；UI hierarchy 仍记录名称输入框位于约 y=1750、创建按钮位于约 y=2175，未随键盘避让。

输入完成后用输入法“确认”收起键盘，可以继续选模型和创建。创建 Bot 成功不代表键盘交互通过；此问题尚未修复。

### 群聊第二名成员的回复未在手机显示

复现：两名测试 Bot 组成群聊，发送 `Each bot reply with HARU_GROUP_OK only.`。

- 手机只显示 AndroidSmoke1114 的 `HARU_GROUP_OK`；切出重进、滑动、重启 App 后仍只显示第一条。
- haru 本机认证后的 DS-Bot `room-chat` 返回两条 Bot item，分别来自 AndroidSmoke1114、AndroidSmokePeer1114，正文均为 `HARU_GROUP_OK`。
- 手机列表的群聊预览已经显示第二名成员 `AndroidSmokePeer1114：HARU_GROUP_OK`，但会话正文缺失。
- 已检查实际安装的 Remote 0.6.4 bundle：`BOT_REMOTE_OPERATIONS` 没有 `group-rows` / `room-chat`；保留 `room-progress`。compact history 仍使用 `LIMIT = 512`，没有当前仓库的 `compactBotRound`。

现有证据指向旧 Host 的转发/历史投影兼容边界，但尚未用当前开发版 Host 对照复测，不能宣称已经证明唯一根因或修复。当前仓库对应更新见 `packages/plugin/src/plugin-route-bridge.ts`、`compact-bot-round.ts` 与 `apps/android/src/services/bot-room-rows.ts`。

### 环境限制

- 默认 GLM-5.3-Flash 返回 HTTP 429、供应商 code 1310（Weekly/Monthly Limit Exhausted），提示 2026-11-17 16:44:03 重置。DeepSeek 模型本轮可用；仅改了测试会话/Bot 的模型，未修改 Host 全局默认模型。
- 服务日志报告 Codex / Cursor binary unavailable、Antigravity ENOENT；这些后端在本轮服务环境中不可用，不能算对应 App 功能验收失败或通过。

## 其他 Host 本机检查与边界

通过认证后的本机 HTTP 调用验证 DS-Bot state、models、providers、diagnostics、computer-system-status、local-agents、schedules、hello、notices、avatar-library、thinking、chat、usage-summary、run-stats 返回成功。不存在的审批返回 `bot/stale`。这些是 Host 本机检查，不能替代手机端对应功能的 E2E。

没有验收：真实审批、电脑控制、拍照/相册与图片发送、Mermaid/PDF、提醒创建/触发、长压缩、取消生成、跨其他 Host 的业务切换、公网 TURN/Relay 强制路径、LAN TCP、大文件长时压力、后台 Doze、TalkBack、横屏与 iOS。

保留命名为 AndroidSmoke 的测试会话/Bot/群聊和上述小型文件，便于复现；没有改动现有项目源码、账号凭据或 Host Remote 安装版本。手机 Wi-Fi 已恢复。

## 2026-11-15 修复与 Host 更新

上述“尚未修复”与 Host 0.6.4 描述属于 11 月 14 日首次验收。11 月 15 日按用户要求继续：

- Bot / 群聊编辑器改用支持键盘避让的 `SheetModal`。Android 使用 `KeyboardAvoidingView` 的 height 行为，面板最大高度同时限制到实际可用布局高度并留出顶部安全区。竖屏保留固定操作按钮；短窗口将标题、表单、按钮及内边距一起放入滚动区域，避免固定内容挤掉输入区。
- 群聊轮次成功读取后，以 Host 结果替换部分实时缓存；查询尚未成功时继续显示缓存。增加“缓存只有第一名、Host 已返回两名”和“成功返回空列表”的回归覆盖。
- Android 全套 80 文件 / 692 tests、Android check、相关 Plugin 20 tests、Plugin check、全 packages build、DSH bundle 校验通过；使用安装脚本重建并覆盖安装修复版 App 0.6.5 / 72。
- haru 使用官方 CLI 安装当前仓库打包的 Host 0.6.5，DS-Bot 保持 0.3.6。安装包永久保存在 `~/.local/share/ds-harness-remote/builds/20261115-haru-fix/ds-harness-remote-0.6.5.tgz`，profile 依赖指向此文件。
- 停止对应服务后完整备份原 profile 至 `~/.local/share/ds-harness-remote/backups/20261115-haru-fix-001656/profile`。升级后服务 active、Remote 控制连接 online；本轮未改账号凭据。
- 包 SHA-256：`035a2898a546e139c5550cff32f00d37972f9e03d3480dafff976984648d24d1`；安装后的 Host `dist/index.js` 与本地构建 SHA-256 一致：`14444aac4ffe2e670e333c2b176db93ebdf65fe1a5dbdafe8ecc5db79211b86d`。

### 修复后的真机回归结果

- 原 `AndroidSmokeRoom1114` 历史：两名成员的 `HARU_GROUP_OK` 均在手机显示，原先缺失的第二条已恢复。
- 同群聊发送 `Each bot reply with HARU_GROUP_NEW_OK only.`：两名成员的实时回复均显示；强制关闭 App 后重新连接并打开群聊，两条新回复仍完整。Host 的 `room-chat` 也确认两轮共四条成员回复。
- 键盘保持打开时，竖屏名称、模型选择与创建按钮均在键盘上方；保持键盘打开成功创建 `KeyboardFix1115`。最终 APK 又在暗色 + 系统字号 1.3 下保持键盘打开成功创建 `KeyboardFinal1115`（指定 DeepSeek-V4.1-Flash），收到 Bot 欢迎消息。
- 横竖屏切换检查：横屏表单可滚动，输入法切入全屏编辑模式后点“完成”可回到表单继续操作。全屏编辑是该输入法的系统界面，不能把此场景描述为键盘打开时整张 App 表单仍同时可见。
- 最终 APK / 新 Host 下复测终端，正确显示 `HARU_HOST_065_OK`；验收后结束终端。
- 再次从手机上传 `haru-android-smoke-20261115.bin`（2 MiB）至 Host home，两端 SHA-256 与前轮相同。
- 再次预览并下载临时目录的 `preview.txt`；手机生成 `Download/preview (1).txt`，内容仍为 `HARU_FILE_PREVIEW_OK`。
- 字号、夜间模式、自动旋转与旋转方向已恢复到测试前设置（1.0 / no / 1 / 0）。本轮新增的两个 Keyboard 测试 Bot 保留，便于复现。
- 最终安装 APK SHA-256：`cec9be1b1d1ed3e5c27f1ddb00c9d749c04f588c071619cdce6486d922f7466d`。最终源码再次通过 Android 全套 692 tests；安装脚本包含的 check、Release 构建与版本核对通过，`git diff --check` 通过。

本轮两个问题已通过上述 MIX 4 真机回归。仍未新增平板、iOS、其他输入法、公网强制 TURN/Relay、LAN TCP、大文件压力或全功能验收；11 月 14 日记录的其他环境限制仍适用。

截图：[键盘打开的表单](images/haru-20261115/bot-keyboard.png)、[大字体与暗色](images/haru-20261115/bot-keyboard-large-dark.png)、[横屏返回表单](images/haru-20261115/bot-landscape.png)、[重启后群聊回复](images/haru-20261115/group-restart.png)。


## 2026-11-15：真实 TUI 补充验收

已在 haru 启动独立 profile 的真实 dsh-TUI 0.20.1（Harness 0.2.2-rc.1），使用当前 Remote 0.6.5 构建与手机 Android 72 完成核心链路验收。详细产物、步骤、证据和范围见 [TUI 验收记录](tui-haru-verification.md)。验收后恢复原 Web 服务。
