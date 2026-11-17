# iOS Xcode Cloud 配置

本仓库的 iOS 有两条发布链路并存：

| | GitHub Actions（`ios-release.yml`） | Xcode Cloud |
| --- | --- | --- |
| 触发 | `v*` tag / 手动 | 分支 / tag / PR，在 App Store Connect 里配 |
| 签名 | 仓库 secrets 里的 App Store Connect API key | Apple 侧管理，仓库零凭据 |
| 前提 | 三个 `APP_STORE_CONNECT_*` secrets + `IOS_TEAM_ID` variable | 已提交的原生工程（本方案） |

Xcode Cloud 只执行 **workspace 旁边** 的 `ci_scripts/ci_post_clone.sh`（放仓库根
目录不会被运行，私有仓库实测过），且要求工程在仓库里存在——所以本方案提交
`apps/ios/ios/` 原生工程。仓库侧已全部就绪：

- `apps/ios/ios/DSHRemote.xcodeproj`（`DEVELOPMENT_TEAM = 857C9KMARL`，
  `MARKETING_VERSION = 0.6.5`，`CURRENT_PROJECT_VERSION = 73`）
- `apps/ios/ios/Podfile.lock`
- `apps/ios/ios/ci_scripts/ci_post_clone.sh`：Node 22 + pnpm 9.15.4 →
  `pnpm install`（应用 `patches/`）→ workspace 构建 + 渲染器（Intelligent UI
  按 commit + hash 校验固定版本）→ 写 `.xcode.env.local` → `pod install` →
  预编译 ExpoModulesJSI xcframework

team id 随 pbxproj 提交不是机密泄露：它出现在每一个已上架二进制的签名信息里。
真正的凭据（证书、profile、API key）都不在仓库中。

## 网页配置步骤（一次性，约 10 分钟）

1. **[App Store Connect](https://appstoreconnect.apple.com/) → Xcode Cloud**，
   左侧选中 DSH Remote 产品（`io.github.liguobao.dshremote`）。
2. 没有关联仓库的话先点 **Connect Repository / 设置源代码仓库**，用 GitHub
   账号授权并选择 `vccddd/ds-harness-remote`（fork 也是独立仓库，可以授权）。
3. **Create Workflow**：
   - **分支**：`feat/ios-client`（合并 main 后可改 main）
   - **Project/Workspace**：`apps/ios/ios/DSHRemote.xcworkspace`
   - **Scheme**：`DSHRemote`
   - **Xcode 版本**：默认（最新稳定版）或按需固定
   - **Environment Variables**（可选）：`EXPO_PUBLIC_DSH_REMOTE_SERVER`
     （覆盖打进 bundle 的默认服务器地址；`EXPO_PUBLIC_*` 会内联进 JS，不能放密钥）
   - **Signing**：自动（Xcode Cloud 自己管理证书和 profile，什么都不用填）
4. **Actions**：先只勾 **Build** 验证；通过后再加 **Archive** + **TestFlight**。
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
- GitHub Actions 的 `ios-release.yml` 用 `buildNumber` 原值上传；同一版本
  不要两条链路交叉上传，否则 App Store Connect 拒收重复 build。

## 为什么不用"prebuild 生成、不提交工程"的方案

Xcode Cloud 创建 workflow 时就要在仓库里找到 workspace，且 `ci_scripts/` 必须在
workspace 旁边——两者都要求工程入库，"运行时生成"无法满足工作流创建。私有仓库
此前也是提交工程的同款做法。
