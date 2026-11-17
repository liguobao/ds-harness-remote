# 共享应用代码规范（packages/app-core）

本包是 Android 与 iOS 两端的全部应用代码：`src/`、`App.tsx`、渲染器构建脚本与测试。
`apps/android` 和 `apps/ios` 只是薄外壳（入口、`app.json`、原生配置、平台插件）。

**改这里的任何代码都同时影响两端。** 提交前请确认 iOS 侧也成立，iOS 最容易漏。

先读版本化文档再写代码：<https://docs.expo.dev/versions/v57.0.0/>

## 平台分支规则

共享代码里不能假设 Android。写平台差异用 `Platform.OS`，并且遵循下面已核实的结论：

- **需要守卫**：`ToastAndroid`（iOS 下只 `console.warn`，用户收不到任何反馈）、
  `FileSystem.StorageAccessFramework`（iOS 直接 reject）、`expo-intent-launcher`、
  `NativeModules.DshRemoteDownloads`、`PermissionsAndroid`。
- **不需要守卫**：`BackHandler`（iOS 是空实现）、`AppRegistry.registerHeadlessTask`
  （iOS 下注册后永不触发）、`requireOptionalNativeModule`（iOS 返回 `null`，各
  工厂自带降级路径）、`src/services/foreground-service.ts`（9 个方法内部都已
  `Platform.OS !== 'android'` 提前返回）、`collapsable`、`blurMethod` 等
  Android 专属 props（iOS 忽略）。
- **iOS 专属时序**：RN `Modal` 的 `onDismiss` 只在 iOS 触发。弹层关闭后再开
  picker 必须等 dismiss 完成，否则 UIKit 静默不弹。`src/screens/chat/modal-action-queue.ts`
  和 `src/screens/chat/confirm-dialog.tsx` 是现成的两种写法，照着用。

## 设备身份

`src/services/storage.ts` 按 `Platform.OS` 生成 `platform` 与设备名，并在读到与当前
平台不符的旧记录时就地修正（保留 `deviceId` 与密钥）。不要把 `platform` 写死成
`'android'`——服务端会按这个值展示设备类型。`src/types.ts` 的联合类型要同步。

## 生成目录

`src/generated/` 由 `scripts/build-*.mjs` 产出，已忽略，不提交；Metro 必需。

```bash
pnpm --filter @dsh-remote/app-core run build:renderers
```

未设置 `DSH_INTELLIGENT_UI_RENDERER_BUNDLE` 时 Intelligent UI 只会生成禁用 stub：
Release 仍可编译，但卡片不渲染。CI 通过固定 commit + 文件 hash 校验该渲染器来源。

## 依赖边界

- 本包的 `dependencies` 只放纯 JS 库（xterm、markdown-it、mermaid、pdfjs、zustand 等）。
- `react`、`react-native`、`expo-*` 等由宿主应用提供，放在 `peerDependencies`，
  避免两端装出两份实例。
- `expo-intent-launcher` 是 Android 专属，列为 optional peer；只在守卫分支里用。
- 新增原生依赖要同时加进 `apps/android` 和 `apps/ios` 的 `dependencies`，
  否则另一端 autolinking 拿不到。

## 版本

`version` 必须与仓库根、`apps/android`、`apps/ios` 一致，`release.yml` 会校验。

## 自检

```bash
pnpm --filter @dsh-remote/app-core check   # 渲染器 + 数据面校验 + tsc
pnpm --filter @dsh-remote/app-core test
```

测试套件（`tests/`）属于本包，`pnpm -r test` 只会跑这一份，两端不重复执行。
