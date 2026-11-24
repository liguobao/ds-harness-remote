# iOS 客户端规范（apps/ios）

本目录只承载 iOS 构建身份，应用代码全部在 `packages/app-core`。改 UI 或业务逻辑
去共享包改，改完两端同时生效；本目录只处理原生配置、入口与签名相关的事。

完整构建与发布说明见 [docs/ios-build-and-release.md](../../docs/ios-build-and-release.md)。

## 原生工程已提交（Xcode Cloud 直接从仓库构建）

`apps/ios/ios/` 是**已提交的源代码**（含 `project.pbxproj`、`Podfile.lock`、
`ci_scripts/ci_post_clone.sh`），因为 Xcode Cloud 只执行 workspace 旁边的
`ci_scripts/`、只认仓库里存在的工程。这与 Android 侧不对称：Android 原生目录
各机器本地生成、不入库。

**绝不裸跑 `expo prebuild -p ios`**（不带 `--no-clean`）：默认模式会重建整个
`ios/`——删掉 `ci_scripts/`，并重置 `project.pbxproj` 里的 `DEVELOPMENT_TEAM`、
`CURRENT_PROJECT_VERSION`、`MARKETING_VERSION`。统一用：

```bash
APPLE_TEAM_ID=857C9KMARL pnpm --dir apps/ios run generate:ios   # 已内置 --no-clean
```

每次 generate 后过一遍 `git diff apps/ios/ios`：正常只应有 Info.plist 层面的
变化；若 pbxproj 丢了上述三个设置，`git restore` 该文件再手补。误跑裸 prebuild
后同样 `git restore apps/ios/ios` 找回。

绝不提交 `ios/Pods/`、`ios/build/`、`ios/.xcode.env.local`（gitignore 已覆盖，
别用 `-f` 绕）。`DEVELOPMENT_TEAM = 857C9KMARL` 会随 pbxproj 提交——team id
本身不是机密（任何已上架二进制的签名信息里都能看到），真正的凭据（证书、
profile、API key）不在仓库里，见下。

## 版本号联动（pbxproj 也要手动同步）

1. `app.json` 的 `expo.version` 与 `expo.ios.buildNumber`、`package.json` 的
   `version`、`packages/app-core/package.json` 的 `version`，与仓库根及
   plugin/tui 保持一致（`release.yml` 校验）。
2. `generate:ios` 会同步 Info.plist 的 `CFBundleShortVersionString` /
   `CFBundleVersion`；**pbxproj 的 `MARKETING_VERSION` /
   `CURRENT_PROJECT_VERSION` 需手动改两个配置块**（Debug + Release）。
3. 跨端：`expo.ios.buildNumber` 必须等于 `apps/android` 的
   `expo.android.versionCode`（`release.yml` 校验相等）。Xcode Cloud 会自动
   递增 TestFlight build number，`buildNumber` 只需是下限。

## 分工：Actions 验证编译，Xcode Cloud 负责签名分发

- **GitHub Actions**（`ci.yml` → `ios-build`）：无签名编译验证
  （`CODE_SIGNING_ALLOWED=NO`），不需要任何 Apple 凭据，fork 分支/PR 直接可跑。
  Actions 不做签名、不上传 TestFlight。
- **Xcode Cloud**：从已提交的工程直接构建，签名由 Apple 侧管理，仓库里
  不需要任何凭据。引导脚本 `ios/ci_scripts/ci_post_clone.sh` 负责 Node/pnpm、
  workspace 构建、渲染器、pod install 与 ExpoModulesJSI 预编译。配置步骤见
  [docs/ios-xcode-cloud.md](../../docs/ios-xcode-cloud.md)。
- 仓库的 `APP_STORE_CONNECT_*` secrets 与 `IOS_TEAM_ID` variable 当前无任何
  workflow 读取（曾用于已移除的 Actions 签名链路），保留无害。

不要把 team id、证书、profile、`.p8` 或 `.env.local` 提交进来；`.gitignore`
已覆盖常见后缀，别用 `-f` 绕过。`EXPO_PUBLIC_*` 会被内联进 JS bundle，
永远不能放密钥。

## config plugin 注意事项

- `plugins/` 包含锁屏扩展的 target 配置与启动插件。启动插件有顺序依赖：
  `with-background-connection-grace` 必须在 `with-ios-scene-lifecycle` 之前
  （前者按锚点插入，后者会重写自己标记之后的整段内容）。
- `with-ios-scene-lifecycle` 在 Expo 模板变动时会主动抛错，这是刻意设计：
  iOS 27 下缺少 scene 适配会在启动时直接 trap。修模板变化，不要删这个检查。
- `with-ios-hermes-globals` 负责在 prebuild 后把 `HERMES_CLI_PATH` 写回
  `.xcode.env`。`scripts/hermesc-with-globals.sh` 必须保持可执行位。
- 新增 `expo-*` 或任何带原生代码的依赖后：改 `apps/ios/package.json`，
  `APPLE_TEAM_ID=... pnpm --dir apps/ios run generate:ios`，再在
  `apps/ios/ios` 下 `pod install`，把更新后的 `Podfile.lock` 一起提交。

## 平台差异写在共享包里

`packages/app-core` 同时服务两端，加平台分支用 `Platform.OS`，不要在共享代码里
假设 Android。已知需要注意的点：Android 专属 API（`ToastAndroid`、
`StorageAccessFramework`、`expo-intent-launcher`、前台服务）必须有 iOS 分支或守卫；
`BackHandler` 在 iOS 是空实现，无需守卫。

iOS 最低 16.4（`expo-build-properties`），Android `minSdkVersion` 26。引入新原生
API 时两端都要确认。

## 提交前自检

```bash
pnpm --filter @dsh-remote/app-core check
pnpm --filter @dsh-remote/app-core test
pnpm --dir apps/ios check
git status --short apps/ios/ios   # 原生产物改动是否都带上了
```
