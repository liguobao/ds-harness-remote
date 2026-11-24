# iOS Xcode Cloud 配置

iOS 的分工：**GitHub Actions 只验证编译（无签名、零凭据），Xcode Cloud 负责签名、
归档和 TestFlight 分发**。

| | GitHub Actions（`ci.yml` → `ios-build`） | Xcode Cloud |
| --- | --- | --- |
| 职责 | 证明代码能编译 | 签名 + 归档 + TestFlight 分发 |
| 触发 | push / PR（路径过滤） | 分支 / tag / PR，在 App Store Connect 里配 |
| 签名 | 关闭（`CODE_SIGNING_ALLOWED=NO`） | Apple 侧管理，仓库零凭据 |
| 前提 | 无 | 已提交的原生工程（本方案） |

Xcode Cloud 只执行 **workspace 旁边** 的 `ci_scripts/ci_post_clone.sh`（放仓库根
目录不会被运行，私有仓库实测过），且要求工程在仓库里存在——所以本方案提交
`apps/ios/ios/` 原生工程。仓库侧已全部就绪：

- `apps/ios/ios/DSHRemote.xcodeproj`（`DEVELOPMENT_TEAM = 857C9KMARL`，
  `MARKETING_VERSION = 0.6.8`，`CURRENT_PROJECT_VERSION = 76`）
- `apps/ios/ios/Podfile.lock`
- `apps/ios/ios/ci_scripts/ci_post_clone.sh`：Node 22 + pnpm 9.15.4 →
  `pnpm install`（应用 `patches/`）→ workspace 构建 + 渲染器（Intelligent UI
  按 commit + hash 校验固定版本）→ 写 `.xcode.env.local` → `pod install` →
  预编译 ExpoModulesJSI xcframework

team id 随 pbxproj 提交不是机密泄露：它出现在每一个已上架二进制的签名信息里。
真正的凭据（证书、profile、API key）都不在仓库中。

## 触发模型：日常推送不进 Xcode Cloud，只有 `v*` tag 进

- **日常推送 / PR** → GitHub Actions `ci.yml` 的无签名编译验证（见
  [ios-build-and-release.md](ios-build-and-release.md)）。Xcode Cloud 的 workflow
  起始条件**不配分支**，日常推送不会消耗 Xcode Cloud 时长。
- **`v*` tag** → Xcode Cloud 的唯一触发条件：起始条件选 **Tag**（模式 `v*`）。
  tag 同时触发 upstream 的 `release.yml`（npm/GitHub Release/Android APK/容器
  镜像）——iOS 的签名构建与 TestFlight 分发只发生在 Xcode Cloud。

## 网页配置步骤（正式形态，配置在 upstream 仓库）

> 迁移验证期间曾在 fork（`vccddd/ds-harness-remote`）上以分支触发临时配置过
> 一次并验证通过；PR 合并后按下述在 upstream 重建为正式配置，fork 那条可删除。

1. **[App Store Connect](https://appstoreconnect.apple.com/) → Xcode Cloud**，
   左侧选中 DSH Remote 产品（`io.github.liguobao.dshremote`）。
2. **Connect Repository / 设置源代码仓库**：用 GitHub 账号授权并选择
   `liguobao/ds-harness-remote`（upstream，不是 fork）。
3. **Create Workflow**：
   - **Start Condition**：选 **Tag**（不是 Branch），模式填 `v*`——只有打
     release tag 才构建与分发
   - **Project/Workspace**：`apps/ios/ios/DSHRemote.xcworkspace`
   - **Scheme**：`DSHRemote`
   - **Xcode 版本**：默认（最新稳定版）或按需固定
   - **Environment Variables**（可选）：`EXPO_PUBLIC_DSH_REMOTE_SERVER`
     （覆盖打进 bundle 的默认服务器地址；`EXPO_PUBLIC_*` 会内联进 JS，不能放密钥）
   - **Signing**：自动（Xcode Cloud 自己管理证书和 profile，什么都不用填）
4. **Actions**：勾 **Build** + **Archive** + **TestFlight**（Build 已在验证期
   实测通过；Tag 触发的正式构建即走完整分发）。
5. 首次运行约 30–50 分钟（无 Pods 缓存）。`ci_post_clone.sh` 的每一步都会在
   构建日志里带 `ci_post_clone:` 前缀，失败先看这段。

## 日常维护

- 改 iOS 原生配置 → 改 `app.json` / `plugins/`，然后
  `APPLE_TEAM_ID=857C9KMARL pnpm --dir apps/ios run generate:ios`（内置
  `--no-clean`），把 diff 连同 `Podfile.lock` 一起提交。**绝不裸跑 prebuild**
  （会删 `ci_scripts/`、重置 team/版本设置），规则详见
  [apps/ios/AGENTS.md](../apps/ios/AGENTS.md)。
- 发版 bump 版本 → 五处联动（app.json 两处、package.json、app-core、pbxproj
  两个配置块），Xcode Cloud 会自动递增 TestFlight build number，`buildNumber`
  只需是下限。
- 曾存在的 Actions 签名上传链路（`ios-release.yml`）已移除：Xcode Cloud 是唯一
  分发通道，日常推送只需 `ci.yml` 的无签名编译验证通过。仓库里的
  `APP_STORE_CONNECT_*` secrets 与 `IOS_TEAM_ID` variable 当前无任何 workflow
  读取，保留无害；将来若恢复 Actions 签名路径可直接复用。

## 为什么不用"prebuild 生成、不提交工程"的方案

Xcode Cloud 创建 workflow 时就要在仓库里找到 workspace，且 `ci_scripts/` 必须在
workspace 旁边——两者都要求工程入库，"运行时生成"无法满足工作流创建。私有仓库
此前也是提交工程的同款做法。
