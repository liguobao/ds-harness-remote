# 待办与已知限制

只保留未完成的工作。已交付功能写入 [CHANGELOG](CHANGELOG.md)，当前支持范围见[版本兼容](compatibility.zh.md)。源码、自动测试和目标平台实测分别判断；一个基础流程通过不能代表全部场景通过。

## 协议与安全

- [ ] 逐项对齐 `packages/protocol`、[线协议](protocol.md)与消费端的字段必需性、未知字段、版本、限额和错误；补齐 Typert / CodeX / ACP tunnel 的 golden vectors。
- [ ] 明确 handshake step、heartbeat 数值与标识符范围，清理 §22 的 connection ping 歧义；同步共享 fixtures。
- [ ] 完成 Noise 独立安全审查，定义长期连接 rekey 与最大生命周期，核对断线密钥清理。
- [ ] 将 Plugin 身份私钥与 refresh token 接入系统 Keychain / Secret Service；VS Code 已使用 SecretStorage。
- [ ] 复查构建链依赖安全公告并做兼容升级；使用当次 audit 结果，不沿用旧漏洞数量。Plugin bundle 不包含某个构建依赖不表示该依赖无风险。

协议变更必须同步文档、schema 和实际消费端。共享场景使用 `fixtures/protocol/v1` 与 `fixtures/crypto/v1`；Android 原生 conformance 必须在目标 runtime 执行，不能用 Node 测试替代。

## Host、安装与兼容

- [ ] 核定旧 Harness 的维护期限，维护 peer range、开发基线与实际运行组合；不再按退役 alpha/rc 版本重复列待验收任务。
- [ ] 当前 Desktop 的侧栏、插件更新页、设置、Remote Header、限时问答/补答与 Mods 回归；带路径前缀代理下验证 SSE 恢复。
- [ ] 检查 headless / 自定义 profile 缺少 `$events` 时的 Desktop 提示与降级。独立 TUI 包已有服务装配与启动校验；真实审批、全部命令及其他 TUI 版本组合仍需覆盖。
- [ ] 核查 Harness 新增界面语言的 Remote 文案与 `locale/*.json` 元信息。
- [ ] 真实 npm 安装下验证本机/远程允许的第三方插件更新、失败回滚及断网后的状态恢复；拥有当前 Remote 的组合包仍不得经远程替换。
- [ ] 验证 Linux 干净 x64/arm64 安装的 runtime 引导、一次性注册、systemd 启动/重启/自启与客户端在线状态。检查 installer helper 直接 import 时官方 peer 的解析，不以模拟 systemctl 代替实装。
- [ ] Windows Host 双实例、异常退出锁恢复、身份迁移与权限错误；锁支持范围仍限[接入指南](plugin-integration.md)。
- [ ] 完善账号过期、`DEVICE_OWNERSHIP_REQUIRED` 和 legacy owner 的显式恢复体验。
- [ ] 跨平台验证 native picker 的只读目录兜底、symlink、权限错误与大目录截断。

## 网络与恢复

- [ ] 真实网络切换、休眠/唤醒、代理、高延迟和长连接矩阵；覆盖 direct 超时、Relay fallback、心跳/RTT 与错误分类，确认 Prompt/审批/终端输入不重放。
- [ ] 当前 Desktop 官方 stream 与 history baseline 在重连后恢复，覆盖退出、Host 切换、迟到请求与多窗口交错。
- [ ] WebRTC / 独立 Relay 控制租约恢复的目标平台矩阵，包含 Server 重启、单端恢复、租约到期、撤销和替换。详见[控制面恢复设计](design/control-recovery.md)。
- [ ] Android 后台/息屏 1、5、15 分钟及 Doze/OEM 省电下的链路状态；验证前台通知与唤醒锁释放。部分小米系统会冻结进程、禁用 wake lock 并销毁 TCP；通知存在或唤醒重连成功不能视为息屏持续联网。
- [ ] 提供脱敏诊断导出和真实设备长期性能基线。

## Android 与界面

- [ ] 离线草稿（#7 / 上游 #409）：断网编辑、后台/杀进程恢复、重连后手动发送一次及离线发送无副作用；Bot 草稿不落盘的差异保留在使用说明。
- [ ] 大字体、TalkBack、IME/硬件键盘、短窗口、平板/分屏的连续导航和 Sheet 动效；覆盖 reduced motion。
- [ ] Mermaid（#255）的流式源码、长会话回收、性能/内存、横屏和离线抓包；可移植渲染产物与 #186 契约另行设计。
- [ ] Intelligent UI 的 native confirmation → Prompt → Patch、重连与恶意 WebView 消息拒绝。
- [ ] 长历史流量/内存、翻页、完整/精简切换、运行中审批及多 Client 并行观察。评估 Harness 惰性详情句柄与裁剪提示；需要协议、连接缓存和 allowlist 配套。
- [ ] 图片附件、Markdown 工作区图片、大图取消/重连与 PNG 发送错误专项回归。
- [ ] PDF/Office 大文件、字体/转换超时、分页缩放、内存与取消；PDF 文本选择和 TalkBack。
- [ ] 自动化任务的修改/删除/历史分页、跨 Client 刷新；新会话防抖与文件选择器的目标平台回归。
- [ ] 修复 Metro 对 `@noble/hashes/crypto.js` 的 package exports fallback 警告。
- [ ] iOS 原生真机与跨设备回归；Expo export 或 Android APK 不作为 iOS 验收。

## DS-Bot

- [ ] 删除、换段、卡片提交、旁问完成/取消、达到接力上限后继续、主机切换及旧 Host 拒绝。
- [ ] 图表/滑块、真实问答/审批、电脑控制和管理操作的手机矩阵；固定转发白名单不表示 Android UI 全部覆盖。
- [ ] 各语言遗漏、大屏与无障碍专项检查。

## CodeX 与 ACP

- [ ] CodeX 重连历史失败、busy/超时重试、原生跨工作区导航与关闭/迟到 open 交错；远程 project/create、新增后选择与空目录首项目。
- [ ] 按后端核对 catalog、session/load、历史分页、stream 重建与 claim，验证跨设备继续聊和长工具轮次。
- [ ] Cursor / Claude / OpenCode / AGY 的模型选择与确认在 Android、Windows 和跨设备环境回归。
- [ ] Pi / Claude / Hermes 的原生手机与跨设备恢复、工具审批和中断；本机兼容模型烟测不等于完整产品覆盖。
- [ ] OpenCode 原生归档的跨平台/跨设备流程；恢复/已归档列表及其他 ACP 后端原生归档尚未实现，不能用 session/delete 代替。
- [ ] 独立 Remote Web 同步 ACP 投影与后端接入，在其所属仓库完成部署和回归。

## 工具与自部署

- [ ] CodeX / ACP Files/Terminal 的跨设备回归；Windows/Linux PTY、shell、resize、job control、长输出与两小时 idle 回收，区分 pipe fallback。
- [ ] Desktop 开发预览的 localhost 导航入口、复杂 HMR、Cookie/CSP 与浏览器兼容性；Android / Remote Web / VS Code 需独立入口方案。
- [ ] 自部署 Server 的真实 coturn、多种 NAT/UDP 限制、Relay fallback、容器重启后凭据持久化与反向代理长连接。
- [ ] VS Code Extension Host 完整 E2E、失效凭据与自动重连、实时增量/问题回答/历史恢复，以及三平台 SecretStorage/代理。
- [ ] DSH-Go 按[手机接入要求](device-pairing-v1.md#手机客户端接入)实现 Dart proof vectors、扫码、凭据与 Android E2E。模拟 Node 手机不能代替真机；本地 UI 不证明抵抗 OS 自动化的真人在场。
- [ ] 继续拆分 Plugin 工作区选择/OAuth 与 Android composer，先明确取消和状态归属。

完整多账号 Server、Remote Web 与 Admin runtime 不在本仓库实现。安全测试优先覆盖协议、身份、授权、隔离、事件与恢复；普通文案和辅助说明不新增镜像实现的测试。
