# 0.6.5 发布前评审（2026-11-15）

## 范围与结论

基线为 `v0.6.4`，评审起点为 `6070c52c`（339 个文件变化，包含发布 bundle、测试及翻译）。重点检查认证/存储、上传边界、异步压缩、DS-Bot 转发与缓存、Android 表单/状态恢复、发布工作流及打包产物。

本轮发现并修复下述问题。修复后已完成本文列出的自动检查，未发现剩余的发布阻断项；这不是“所有平台和所有功能均无问题”的保证。发布仍需提交本轮变更后由正式 tag 工作流构建，本文没有触发发布；后续真实 TUI 验收临时运行当前构建，结束后已恢复 haru 原 Web 服务。

## 发现与修复

| 级别 | 问题 | 修复与验证 |
| --- | --- | --- |
| P1 | TUI npm 发布步骤会在主包缺失或自身发布失败时中止整个 release job，违背主包 npm 失败后继续发布 GitHub Release/APK 的现有约定 | 主包缺失时跳过 TUI 并告警；TUI 发布失败标记 warning 后继续。对主包缺失、TUI 已发布、发布成功、发布失败四种状态执行了 mock npm shell 验证；未调用真实发布 |
| P1 | Host 将工作区 cwd 规范化为 realpath 后，直接用规范化根校验原 cwd 别名下的绝对路径，误拒绝合法文件；macOS `/var` 与 `/private/var` 的测试可复现 | 只将 Host 授权 cwd 内的绝对路径映射到规范化根，再执行原 containment、ancestor/target symlink 和文件类型检查；不对任意 Client 路径直接放宽 realpath。新增跨平台可信目录别名回归，覆盖三个读取端点、规范路径、别名路径、越界、其他目录别名及内部符号链接。原文件安全场景与新增回归通过；生产 Host bundle 已重建 |
| P2 | packed WebRTC 校验在 macOS 将 realpath 的依赖与非规范化临时目录比较，误判包越界；runtime hook 同样因非规范化 URL 无法命中测试导出缝 | 统一规范化闭包边界和 runtime entry/bundle URL，保留严格闭包判断；GitHub 与 npm 两种实际 tarball 均通过完整打包运行时验证 |
| 文档 | `.github/release-notes.md` 仍指向 0.6.4，0.6.5 Changelog 遗漏后续合入内容 | 更新双语 Release 文档与 Changelog，补充兼容性、升级、验证和未验收范围 |

本机初次全仓测试还发现 TUI workspace 未安装而无法解析主包。使用现有 lockfile 完成 `pnpm install --frozen-lockfile` 后恢复，未修改 lockfile，也没有将此环境问题作为产品缺陷修复。

## 风险检查要点

- LAN 上传：票据绑定原连接/身份/会话/上传，入口仅允许本机 RFC1918 IPv4，固定 RPC 集合，上传开始后不切换通道重放；原连接失效会清理监听和未提交文件。工作区落盘保留权限、总量、偏移、fsync 与不覆盖发布检查。
- 异步压缩：提交 requestId 幂等、操作归属与同会话互斥、普通 RPC deadline 分离；取消需生命周期确认，不用断线或停止等待伪造完成。检查对应测试和已记录的跨设备验收边界。
- 凭据：刷新与迁移共用门闩、确认死亡才清理 Holder、未知布局/不一致记录失败关闭；支持范围仍限集成文档所列环境，升级/降级必须停止全部 Harness 进程。
- DS-Bot：固定 0.3.6 endpoint 名单，未知 endpoint 拒绝；管理/凭据/电脑操作由认证后的 DS-Bot handler 校验。手机验收只支持“主要流程兼容”结论，不能扩展为所有 161 个接口均完成 E2E。
- 缓存与 Android：完整 Host 群聊结果替换部分缓存，读取尚未成功时保留缓存；Bot 表单启用键盘避让与短窗口滚动。已有 MIX 4 验收覆盖这两项修复。

## 本轮最终自动验证

运行时：macOS、Node.js 24.21.0；包管理器使用仓库指定 pnpm 9.15.4。

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，lockfile 未变 |
| `NODE_ENV=production pnpm --workspace-concurrency=1 -r build` | 全仓生产构建通过，含 Android Expo export；不是新 APK 构建 |
| `pnpm -r check` | 通过 |
| `pnpm -r test` | 通过；Protocol 109、Crypto 10、WebRTC 64、Client Core 63、Server 62、Browser 1、VS Code 10、Plugin 738 pass / 5 skipped、Android 692；TUI bundle 验证通过 |
| `node scripts/verify-dsh-plugin.mjs` | 通过 |
| `node scripts/verify-packed-webrtc.mjs` | GitHub 35 / npm 37 个生产包的闭包通过；pure ESM、lazy 初始化、原生不可用回退、并发/缓存初始化及双向有序 DataChannel 通过 |
| `DSH_TEST_RELEASE_BUNDLE=1 ... vitest run tests/host-websocket-origin.test.ts` | 12 项通过，额外执行默认跳过的真实 bundle upgrade/hello 超时及清理场景 |
| Release workflow | YAML 解析与四种 mock npm 情况通过；真实 OIDC/registry 发布未执行 |
| 提交前定向回归 | `harness-remote-bridge.test.ts` 38 项与 `lan-upload.test.ts` 9 项通过；包含真实 TCP 上传在连接替换、断开和设备撤销时清理监听与临时文件 |
| `git diff --check` | 通过 |

默认 Plugin 测试跳过的 5 项中，3 项为 Linux 专属身份/队列恢复，2 项需显式启用 release bundle 模式；后两项已在额外的 12 项 bundle 测试中执行并通过。仍未执行的 Linux/XFS 场景只能引用既有验收，不代表本次在 macOS 又执行了 Linux 测试。

## 真机证据和发布边界

- [haru / MIX 4](android-haru-verification.md)：Bot 创建、模型选择、单聊、群聊实时/历史/重启恢复、键盘、大字体/暗色/横竖屏、终端、预览/下载、2 MiB 上传及哈希。
- [原生 LAN 上传](android-upload-verification.md)：隔离认证上下文中两次 200 MiB，不能替代真实账号/会员登录 E2E。
- [异步压缩](remote-compaction-verification.md)：跨设备 Relay 下长压缩、重连不重提与生命周期确认取消。
- 本轮新增的可信工作区绝对路径修复完成自动回归与真实打包运行时验证；当前 bundle 随后用于 [haru 真实 TUI 验收](tui-haru-verification.md)，未重装新 APK，也未专门构造别名路径。此前真机记录中的 bundle/APK 哈希仍描述当时验收产物。
- 真实 TUI 核心跨设备链路已完成上述版本组合验收；iOS、Windows Host 刷新锁恢复、所有电脑控制/真实审批/提醒流程仍未完整验收。NFS/SMB 与跨主机共用凭据目录不在锁支持范围。
- 既有离线冷启动恢复可能需要手动刷新并选择 Host；测试环境 GLM 额度耗尽和未安装的后端二进制属于环境限制，不应写成已经修复的产品问题。

Release 正文为 [`.github/release-notes.md`](../.github/release-notes.md)，历史条目为 [CHANGELOG](CHANGELOG.md)。本轮未创建 tag、推送、发布 npm/GitHub 或更新生产 Server。
