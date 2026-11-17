# iOS build and release

The iOS client is an Expo app at `apps/ios`. It shares all of its application
code with the Android client through `packages/app-core`; `apps/ios` holds only
the iOS build identity: `app.json`, `app.config.js`, config plugins, the Hermes
wrapper scripts and the entry point.

## Layout

| Path | Contents |
| --- | --- |
| `packages/app-core` | Shared source: `src/`, `App.tsx`, renderer build scripts, the test suite |
| `apps/android` | Android shell: entry point, `app.json`, Android config plugins, native modules |
| `apps/ios` | iOS shell: entry point, `app.json`, `app.config.js`, iOS config plugins, Hermes scripts |

The native `ios/` project is **not** committed. `expo prebuild --platform ios`
regenerates it from `app.json`, `app.config.js` and `plugins/`, so every native
setting must be expressible declaratively. This is the main difference from the
private repository, where `ios/` is tracked because Xcode Cloud builds it
directly.

## Deployment identity is not in the repository

This repository is public, so the Apple team and the signing material are
supplied at build time.

| Name | Kind | Value | Used by |
| --- | --- | --- | --- |
| `IOS_TEAM_ID` | Variable | Apple Developer team id | `app.config.js` (`APPLE_TEAM_ID`), `xcodebuild` `DEVELOPMENT_TEAM` |
| `APP_STORE_CONNECT_ISSUER_ID` | Secret | Issuer UUID | archive, export, upload |
| `APP_STORE_CONNECT_KEY_ID` | Secret | 10-character key id | archive, export, upload |
| `APP_STORE_CONNECT_PRIVATE_KEY` | Secret | Full `.p8` contents | archive, export, upload |

Configure these under **Settings → Secrets and variables → Actions**. The App
Store Connect API key covers both automatic signing and the TestFlight upload,
so no distribution certificate or provisioning profile needs to be stored here.

`EXPO_PUBLIC_*` values are inlined into the JavaScript bundle and are therefore
never secrets. `EXPO_PUBLIC_DSH_REMOTE_SERVER` overrides the default server for
a build; the in-app default stays user-editable.

Forks build without any of this: the compile-verification job disables code
signing, and `app.config.js` omits `appleTeamId` when `APPLE_TEAM_ID` is unset.

## Workflows

**`ci.yml` → `ios-build`** compiles the app unsigned on every pull request that
touches `apps/ios`, `packages/app-core`, the shared packages, `patches/` or the
lockfile. It needs no Apple credentials, so it runs for fork pull requests. It
proves the app still builds; it cannot produce an installable artifact.

**`ios-release.yml` → `testflight`** runs on a `v*` tag, archives with automatic
signing and uploads to TestFlight. It is pinned to the `ios-release`
environment, so you can require a manual approval before anything is signed.

macOS runners bill at ten times the Linux rate, which is why the unsigned job
stays behind a path filter.

## Version coupling

A release tag requires these to agree:

- `package.json`, `packages/plugin/package.json`, `packages/tui/package.json`
- `packages/app-core/package.json`
- `apps/android/package.json` and `apps/android/app.json` (`expo.version`)
- `apps/ios/package.json` and `apps/ios/app.json` (`expo.version`)

and these to match each other:

- `apps/android/app.json` → `expo.android.versionCode`
- `apps/ios/app.json` → `expo.ios.buildNumber`

`release.yml` enforces both, and additionally rejects an `expo.ios` section in
`apps/android/app.json` so the retired copy cannot drift back.

Because GitHub Actions does not auto-increment the build number the way Xcode
Cloud does, **`expo.ios.buildNumber` is authoritative and must be raised for
every TestFlight upload.** App Store Connect rejects a duplicate
`CFBundleVersion` for the same version string.

## Native configuration that must stay declarative

Regenerating `ios/` means anything hand-edited in Xcode is lost. These are the
non-obvious pieces and where they live:

- **Scene lifecycle.** `plugins/with-ios-scene-lifecycle.js` plus
  `plugins/ios-scene-lifecycle.swift` move React Native startup into
  `scene(_:willConnectTo:options:)`. Without it the app traps at launch on
  iOS 27 with *"UIScene life cycle is required for apps built with this SDK"*.
  The `UIApplicationSceneManifest` in `app.json` is the other half; the manifest
  alone yields a blank window. The plugin throws if the Expo template changes
  underneath it.
- **Background grace.** `plugins/with-background-connection-grace.js` adds a
  short `beginBackgroundTask` window so the WebSocket survives a brief
  backgrounding. Deliberately not a `UIBackgroundModes` declaration: iOS grants
  no indefinite background mode for WebSockets.
- **Hermes build phase.** `plugins/with-ios-build-diagnostics.js` marks the
  `hermes-engine` framework-replacement phase always-out-of-date, so switching
  Debug/Release cannot reuse the wrong binary.
- **Hermes global declarations.** `plugins/with-ios-hermes-globals.js` re-adds
  `HERMES_CLI_PATH` to the generated `.xcode.env`, pointing at
  `scripts/hermesc-with-globals.sh`. That wrapper passes
  `-include-globals=scripts/hermes-runtime-globals.js` so the bundler keeps
  undefined-variable diagnostics on while still declaring the globals React
  Native installs at runtime. Keep the wrapper executable.
- **Privacy manifest.** `expo.ios.privacyManifests` in `app.json` generates
  `PrivacyInfo.xcprivacy`. Prebuild writes that file only when the key is
  present.
- **Deployment target.** iOS 16.4, via `expo-build-properties`. If Xcode reports
  a mismatch against Expo modules, re-run `pod install` rather than raising it.
- **Plugin order matters.** `with-background-connection-grace` must come before
  `with-ios-scene-lifecycle`: the grace plugin inserts before an anchor the
  scene plugin's regenerated region would otherwise swallow.

## Dependency patches

`patches/` carries five pnpm patches applied by `pnpm install`. All five touch
only `ios/`, `apple/` or CocoaPods ruby scripts, so the Android build is
unaffected:

| Patch | Effect |
| --- | --- |
| `react-native-webview@13.16.1` | Fixes an always-zero data-detector mask that disabled every data-detector option. A behavior fix, not cosmetic |
| `react-native@0.86.2` | CocoaPods `rncore.rb` build warnings |
| `react-native-safe-area-context@5.7.0` | Fabric component-view warnings |
| `expo-localization@57.0.1` | iOS localization module warnings |
| `expo-modules-autolinking@57.0.10` | Project integrator warnings |

Re-verify them on any dependency upgrade. Never apply them by editing
`node_modules/` or `Pods/` directly.

## Building locally

```sh
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm --filter @dsh-remote/app-core run build:renderers
pnpm --dir apps/ios exec expo prebuild --platform ios --no-install
pod install --project-directory=apps/ios/ios
pnpm --dir apps/ios run ios          # or open apps/ios/ios/DSHRemote.xcworkspace
```

Set `APPLE_TEAM_ID` first for a device build; a simulator build does not need
it. Without `DSH_INTELLIGENT_UI_RENDERER_BUNDLE` the Intelligent UI renderer
falls back to a disabled stub: Release still compiles, but those cards do not
render.

## Checks

```sh
pnpm --filter @dsh-remote/app-core check   # renderers + data planes + tsc
pnpm --filter @dsh-remote/app-core test
pnpm --dir apps/ios check                  # tsc over the shell
```

## Xcode Cloud

GitHub Actions is the supported path in this repository. Xcode Cloud remains
possible, but it requires a committed `ios/` directory or a bootstrap script,
and `ci_scripts/ci_post_clone.sh` is only executed when it sits next to the
`.xcworkspace`. See [ios-xcode-cloud.md](ios-xcode-cloud.md).
