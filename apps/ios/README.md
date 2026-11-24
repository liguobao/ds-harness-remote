# DSH Remote for iOS

The iOS client for [DSH Remote](../../README.md): end-to-end encrypted remote
access to DeepSeek Harness, CodeX, Claude Code and other workspaces from your
iPhone or iPad.

It is distributed through TestFlight; see
[issue #20](https://github.com/liguobao/ds-harness-remote/issues/20) for the
current beta status.

## What is in this directory

The iOS shell owns the native modules and WidgetKit extension. Screens,
connection logic, state and renderers live in
[`packages/app-core`](../../packages/app-core) and are shared with
the Android client.

| File | Purpose |
| --- | --- |
| `app.json` | Expo configuration: version, build number, `Info.plist` keys, privacy manifest, plugin list |
| `app.config.js` | Injects the Apple team from the environment so no account identity is committed |
| `index.ts` | Entry point: polyfills, WebRTC globals, root component |
| `plugins/` | Expo configuration plugins and the lock screen / Dynamic Island widget |
| `modules/remote-native/` | Local ActivityKit updates and CryptoKit acceleration for Noise frames |
| `scripts/` | Hermes compiler wrapper supplying runtime global declarations |

The repository includes the generated `ios/` workspace and its embedded widget target for Xcode Cloud.

## Requirements

- iOS 16.4 or later
- macOS with Xcode 26 or later to build
- Node 24, pnpm 9.15.4

## Building

```sh
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm --filter @dsh-remote/app-core run build:renderers
pnpm --dir apps/ios run generate:ios
(cd apps/ios/ios && pod install)
pnpm --dir apps/ios run ios
```

Set `APPLE_TEAM_ID` to your Apple Developer team before building for a device.
A simulator build needs no signing identity.

Expo Go is not supported: the app depends on `react-native-webrtc` and local
native modules, so it requires a development build or a release archive.

Full build, signing and release documentation is in
[docs/ios-build-and-release.md](../../docs/ios-build-and-release.md), and the
Xcode Cloud alternative is in
[docs/ios-xcode-cloud.md](../../docs/ios-xcode-cloud.md).

## Contributing

Application changes belong in `packages/app-core` and affect both platforms;
read its [AGENTS.md](../../packages/app-core/AGENTS.md) first, especially the
platform-branch rules. Changes in this directory are limited to native
modules, configuration, extensions, the entry point and signing.
