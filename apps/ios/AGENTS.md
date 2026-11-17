# iOS 客户端规范（apps/ios）

本目录只承载 iOS 构建身份，应用代码全部在 `packages/app-core`。改 UI 或业务逻辑
去共享包改，改完两端同时生效；本目录只处理原生配置、入口与签名相关的事。

完整构建与发布说明见 [docs/ios-build-and-release.md](../../docs/ios-build-and-release.md)。

## 不提交原生工程

`apps/ios/ios/` 由 `expo prebuild --platform ios` 生成，已在 `.gitignore` 中忽略。
因此**任何原生设置都必须能声明式表达**：写进 `app.json`、`app.config.js` 或
`plugins/` 下的 config plugin。在 Xcode 里手改工程设置不会进仓库，下次 prebuild 即丢。

与私有仓库的最大差别就在这里：私有仓库提交 `ios/` 以供 Xcode Cloud 直接构建，
所以那边禁止裸跑 `expo prebuild -p ios`；本仓库没有这个限制，重新生成是常态。

## 敏感配置走 Actions

仓库是公开的，Apple 账号与签名材料不进代码：

- `IOS_TEAM_ID`（variable）→ `app.config.js` 读 `APPLE_TEAM_ID`，未设置时不写
  `appleTeamId`，不签名的编译验证因此可以在 fork 上跑。
- `APP_STORE_CONNECT_ISSUER_ID` / `APP_STORE_CONNECT_KEY_ID` /
  `APP_STORE_CONNECT_PRIVATE_KEY`（secrets）→ 仅 `ios-release.yml` 使用。

不要把 team id、证书、profile、`.p8` 或 `.env.local` 提交进来；`.gitignore` 已覆盖
常见后缀，别用 `-f` 绕过。`EXPO_PUBLIC_*` 会被内联进 JS bundle，永远不能放密钥。

## 版本联动（四处 + 跨端一处）

1. `app.json` 的 `expo.version` 与 `expo.ios.buildNumber`
2. `package.json` 的 `version`，必须等于 `expo.version`
3. `packages/app-core/package.json` 的 `version`
4. 仓库根与 `packages/plugin`、`packages/tui` 的 `version`

跨端：`apps/ios/app.json` 的 `expo.ios.buildNumber` 必须等于
`apps/android/app.json` 的 `expo.android.versionCode`。`release.yml` 会校验这两条，
并拒绝 `apps/android/app.json` 里再出现 `expo.ios` 段。

GitHub Actions 不像 Xcode Cloud 会自动递增 build number，所以 `buildNumber`
是实际上传值：**每次发 TestFlight 都要 +1**，否则 App Store Connect 拒收重复的
`CFBundleVersion`。

## config plugin 注意事项

- `plugins/` 下四个插件都是必需的，顺序不能动：
  `with-background-connection-grace` 必须在 `with-ios-scene-lifecycle` 之前
  （前者按锚点插入，后者会重写自己标记之后的整段内容）。
- `with-ios-scene-lifecycle` 在 Expo 模板变动时会主动抛错，这是刻意设计：
  iOS 27 下缺少 scene 适配会在启动时直接 trap。修模板变化，不要删这个检查。
- `with-ios-hermes-globals` 负责在 prebuild 后把 `HERMES_CLI_PATH` 写回
  `.xcode.env`。`scripts/hermesc-with-globals.sh` 必须保持可执行位。
- 新增 `expo-*` 或任何带原生代码的依赖后，在 `apps/ios/ios` 下跑 `pod install`
  验证；`Podfile.lock` 不提交（随 `ios/` 一起忽略）。

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
pnpm --dir apps/ios exec expo prebuild --platform ios --no-install   # 原生配置改动后
```
