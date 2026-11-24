# iOS build and release

The iOS client is an Expo app at `apps/ios`. It shares all of its application
code with the Android client through `packages/app-core`; `apps/ios` holds the native modules, WidgetKit extension and
iOS build identity: `app.json`, `app.config.js`, config plugins, the Hermes
wrapper scripts and the entry point.

## Layout

| Path | Contents |
| --- | --- |
| `packages/app-core` | Shared source: `src/`, `App.tsx`, renderer build scripts, the test suite |
| `apps/android` | Android shell: entry point, `app.json`, Android config plugins, native modules |
| `apps/ios` | iOS shell: entry point, `app.json`, `app.config.js`, iOS config plugins, Hermes scripts |

The native `ios/` project **is committed** (see below for how to regenerate it),
because Xcode Cloud builds the workspace straight from the repository. `Pods/`,
`build/` and `.xcode.env.local` stay ignored. Regeneration is always
`pnpm --dir apps/ios run generate:ios` (pinned to `--no-clean`); a bare
`expo prebuild --platform ios` deletes `ci_scripts/` and resets the team and
version settings.

## Signing is Xcode Cloud's job; Actions only verifies

GitHub Actions never signs and never uploads. The unsigned `ios-build` job
proves the app compiles on every relevant push, and Xcode Cloud — configured in
App Store Connect against `apps/ios/ios/DSHRemote.xcworkspace` — owns signing,
archiving and TestFlight distribution. Its bootstrap is
`apps/ios/ios/ci_scripts/ci_post_clone.sh`; see
[ios-xcode-cloud.md](ios-xcode-cloud.md).

No Apple credential is required by any workflow in this repository. The
repository-level `IOS_TEAM_ID` variable and `APP_STORE_CONNECT_*` secrets, if
configured, are inert: they would only be read by an Actions signing path if
one is ever reintroduced.

`EXPO_PUBLIC_*` values are inlined into the JavaScript bundle and are therefore
never secrets. `EXPO_PUBLIC_DSH_REMOTE_SERVER` overrides the default server for
a build; the in-app default stays user-editable.

Forks build without any configuration: the compile-verification job disables
code signing, and `app.config.js` omits `appleTeamId` when `APPLE_TEAM_ID` is
unset.

## Workflows

**`ci.yml` → `ios-build`** compiles the app unsigned on every pull request or
branch push that touches `apps/ios`, `packages/app-core`, the shared packages,
`patches/` or the lockfile. It needs no Apple credentials, so it runs for fork
pull requests and fork branches alike. It proves the app still builds; it
cannot produce an installable artifact.

A `v*` tag does **not** run this workflow: a tag is the release signal consumed
by Xcode Cloud (signed archive and TestFlight) and, on the upstream repository,
by `release.yml`. Documentation-only changes skip CI entirely via
`paths-ignore`.

macOS runners bill at ten times the Linux rate, which is why the job stays
behind a path filter.

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

Xcode Cloud auto-increments the TestFlight build number, so
`expo.ios.buildNumber` acts as a floor rather than the shipped value.

## Native configuration that must stay declarative

Regenerating `ios/` means anything hand-edited in Xcode is lost. These are the
non-obvious pieces and where they live:

- **Attention widget.** `plugins/with-attention-widget.js` embeds the WidgetKit
  extension. Device signing must cover both the app bundle identifier and its
  `.attention` extension. Local ActivityKit updates require no push entitlement.
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
APPLE_TEAM_ID=857C9KMARL pnpm --dir apps/ios run generate:ios
(cd apps/ios/ios && pod install)
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
