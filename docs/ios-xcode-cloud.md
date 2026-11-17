# iOS Xcode Cloud configuration

GitHub Actions is the supported release path for this repository; see
[ios-build-and-release.md](ios-build-and-release.md). This document covers
running Xcode Cloud as well, which is useful when you want Apple-managed
signing and automatic TestFlight build numbering without storing an App Store
Connect API key in repository secrets.

## The constraint to design around

Xcode Cloud starts from a repository checkout and looks for an Xcode project or
workspace. This repository does not commit `apps/ios/ios`, so there is nothing
for it to open until `expo prebuild` has run.

Xcode Cloud runs `ci_scripts/ci_post_clone.sh` after cloning and **before** it
resolves the project, and the script is only executed when it sits beside the
workspace. So the bootstrap script has to both generate the native project and
live where the generated project will be.

That gives two workable options.

## Option A: generate in `ci_post_clone.sh` (keeps `ios/` out of git)

Commit only `apps/ios/ci_scripts/ci_post_clone.sh` and let it produce
`apps/ios/ios/` on the Xcode Cloud machine.

Workflow settings:

- **Repository**: this repository.
- **Primary branch** or tag trigger as you prefer.
- **Xcode**: 26 or later. **macOS**: the matching runtime image.
- **Project/Workspace**: `apps/ios/ios/DSHRemote.xcworkspace`. Xcode Cloud needs
  this path to exist when it resolves the build, which it does because
  `ci_post_clone.sh` has already generated it.
- **Scheme**: `DSHRemote`.
- **Environment variables**: `APPLE_TEAM_ID` (so `app.config.js` writes the
  team into the generated project), optionally
  `EXPO_PUBLIC_DSH_REMOTE_SERVER`. Mark nothing here as secret: Expo inlines
  `EXPO_PUBLIC_*` into the bundle.
- **Signing**: Xcode Cloud manages certificates and profiles. No secrets in the
  repository.

The script must do what the GitHub Actions job does, in this order:

1. Install Node 22 or 24 and pnpm 9.15.4. Xcode Cloud images ship neither at a
   pinned version, so install explicitly.
2. `pnpm install --frozen-lockfile` **at the repository root** — the app
   depends on `workspace:*` packages.
3. Build the workspace packages, then the renderers:
   `pnpm --filter './packages/**' -r build` and
   `pnpm --filter @dsh-remote/app-core run build:renderers`.
   `src/generated/` is gitignored and Metro requires it.
4. Clone and verify the pinned Intelligent UI renderer (same commit and file
   hash the GitHub workflows assert), export
   `DSH_INTELLIGENT_UI_RENDERER_BUNDLE` and `DSH_REQUIRE_INTELLIGENT_UI=true`.
5. `pnpm --dir apps/ios exec expo prebuild --platform ios --no-install`.
6. Write `apps/ios/ios/.xcode.env.local` with an absolute `NODE_BINARY`. The
   bundling phase sources it and the `xcodebuild` PATH does not include the
   Node you just installed. The `HERMES_CLI_PATH` line is restored by
   `plugins/with-ios-hermes-globals.js` during prebuild, so do not duplicate it
   here.
7. `pod install` in `apps/ios/ios`.
8. Pre-build the ExpoModulesJSI xcframework. The
   `[CP-User] Build ExpoModulesJSI xcframework` phase compiles an SPM package
   through a nested `xcodebuild -quiet`, which swallows the real error on
   failure. Building the slices first surfaces it; on success the phase hits its
   hash cache. Keep it Release for both `iphoneos` and `iphonesimulator`.

The private repository's script is a working reference for steps 1, 4, 6, 7 and
8, but its paths assume a `clients/` workspace root and the package filter
`@dsh-remote/android`. In this layout the workspace root is the repository root,
the iOS package is `@dsh-remote/ios`, the renderers belong to
`@dsh-remote/app-core`, and the app lives at `apps/ios`.

Caveat: `expo prebuild` runs on every build, so Xcode Cloud cannot cache
`Pods/` or derived data across builds as effectively as it would with a
committed project. Expect each archive to take roughly as long as a clean
build.

## Option B: commit the generated project (closest to the private repo)

Run `pnpm --dir apps/ios exec expo prebuild --platform ios` locally, remove
`/ios` from `apps/ios/.gitignore`, and commit `apps/ios/ios/`. Xcode Cloud then
resolves the workspace without any bootstrap, and `ci_post_clone.sh` only has to
install dependencies and run `pod install`.

The costs are real, which is why this repository does not do it by default:

- `DEVELOPMENT_TEAM` lands in `project.pbxproj` in a public repository.
- `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` must be hand-synchronized in
  two configuration blocks on every version bump.
- A bare `expo prebuild --platform ios` deletes `ci_scripts/` and resets those
  settings. Only `--no-clean` is safe, and the resulting diff needs review on
  every run.

If you choose this, mirror the private repository's guard rails: a
`generate:ios` script pinned to `--no-clean`, and a documented review step for
`git diff apps/ios/ios`.

## Build numbers

Xcode Cloud can increment the TestFlight build number itself, in which case
`expo.ios.buildNumber` acts as a floor rather than the shipped value. If you run
both Xcode Cloud and the GitHub Actions release workflow against the same app
record, pick one as the source of truth: Actions uses `buildNumber` verbatim, so
a Cloud-incremented build can collide with it. Keeping Actions for releases and
Xcode Cloud for pull-request verification avoids the overlap entirely.
