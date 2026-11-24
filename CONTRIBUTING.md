# Contributing to ds-harness-remote

[简体中文](CONTRIBUTING.zh.md)

Thank you for your interest in contributing to `ds-harness-remote`. Whether you are reporting a bug, improving documentation or translations, testing across devices, or submitting a pull request, this guide explains how the repository is organized and how changes are verified.

For deep architectural invariants and coding-agent rules, see [`AGENTS.md`](AGENTS.md) (and [`apps/android/AGENTS.md`](apps/android/AGENTS.md) for mobile-specific constraints). For the documentation index and current roadmap, see [`docs/README.md`](docs/README.md) and [`docs/TODO.md`](docs/TODO.md).

## Ways to contribute and repository scope

- **Report bugs or propose features**: Blank issues are disabled (`blank_issues_enabled: false`). Please open an issue using one of the Chinese or English forms in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).
- **Improve docs and localization**: Clarify guides, keep translations aligned, or add troubleshooting details.
- **Test across environments**: Verify behavior on real Desktop, Web, Android, iOS, HarmonyOS, TUI, VS Code, or self-hosted server setups.
- **Submit code and tests**: Fix bugs, strengthen protocol/state-machine coverage, or implement scoped enhancements.

### What lives in this repository

| Area | Scope |
| --- | --- |
| `packages/plugin` | DeepSeek Harness Remote Host plugin, local workspace entry, Remote Agent Tools, and `ds-harness-remote` CLI |
| `packages/tui` & `packages/tui-plugin` | Standalone `ds-harness-remote-tui` host bundle (`packages/tui`) and its unpublished development/contract verification package (`packages/tui-plugin`) |
| `packages/{protocol,crypto,webrtc,client-core}` & `fixtures/` | Shared wire protocol schemas, Noise/crypto primitives, WebRTC transport, shared client core, and conformance vectors |
| `packages/app-core`, `apps/android`, `apps/ios` | Shared React Native / Expo mobile application code (`packages/app-core`) plus Android and iOS app shells |
| `apps/harmony` | Native HarmonyOS client (ArkTS + ArkWeb WebRTC), built outside the pnpm workspace |
| `apps/server` | Minimal single-account self-hosted server (blind Noise/control relay, optional WebRTC/TURN, Docker/Compose) |
| `apps/browser` & `apps/vscode` | Chrome/Edge MV3 launcher extension and VS Code extension client |

### Out of scope

- `examples/mock-host` is a frozen legacy-protocol interop tool; do not add new features there.
- Multi-account servers, Remote Web session UIs, Admin frontends/backends, databases/migrations/queues, and Kubernetes/Terraform setups are out of scope for this repository. [`docs/server.md`](docs/server.md) documents the full hosted service design for protocol reference and does not represent implemented features of `apps/server`.

## Prerequisites and quick start

### Base toolchain

- **Node.js `^24.22.3 || >=26.13.1`** (CI runs on `24.22.3`)
- **`pnpm@9.15.4`** (declared in `packageManager` in root `package.json`; run `corepack enable` to match it automatically)
- `.npmrc` sets `node-linker=hoisted` to stay compatible with Windows path length limits.

Install dependencies and build the workspace packages first:

```bash
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
```

Root `package.json` intentionally has **no `scripts`** because it serves as the DSH Desktop GitHub installation boundary. Run workspace commands with `pnpm -r` or `pnpm --filter`.

### Per-component notes

- **Host plugin (`packages/plugin`)**: Run `pnpm --filter ./packages/plugin build`, `check`, or `test` (filtering by path avoids matching the root `package.json`, which shares the name `ds-harness-remote`). See [`packages/plugin/README.md`](packages/plugin/README.md) and [`docs/plugin-integration.md`](docs/plugin-integration.md).
- **TUI packages (`packages/tui` and `packages/tui-plugin`)**: Both share the package name `ds-harness-remote-tui`. Always filter by path (`pnpm --filter ./packages/tui-plugin check` / `test`); `./packages/tui` has no `scripts`. See [`packages/tui/README.md`](packages/tui/README.md).
- **Self-hosted server (`apps/server`)**: Build `@dsh-remote/protocol` before standalone verification. Never commit `apps/server/data/` or `.env`. See [`apps/server/README.md`](apps/server/README.md) ([简体中文](apps/server/README.zh.md)).
- **Mobile (`packages/app-core`, `apps/android`, `apps/ios`)**: Shared source, offline renderer build scripts, and unit tests live in `packages/app-core`. Rebuild `./packages/**` after changing shared packages.
  - **Android**: Native builds require JDK 17 and the Android SDK. Because the app uses `react-native-webrtc` and native modules, **Expo Go is not supported**—use a Development Build or native APK. See [`apps/android/README.md`](apps/android/README.md) and [`apps/android/AGENTS.md`](apps/android/AGENTS.md).
  - **iOS**: Native builds require macOS and Xcode. The native `apps/ios/ios/` project is committed for Xcode Cloud; always regenerate with `pnpm --dir apps/ios run generate:ios` (pinned to `--no-clean`) and never run a bare `expo prebuild --platform ios`, which removes `ci_scripts/` and resets team/version settings. See [`docs/ios-build-and-release.md`](docs/ios-build-and-release.md).
- **HarmonyOS (`apps/harmony`)**: Built outside the pnpm workspace with DevEco Studio (HarmonyOS API 26 SDK), `ohpm`, and `hvigorw`. Before opening the project in DevEco Studio, generate the shared terminal asset from the repository root:
  ```bash
  node packages/app-core/scripts/build-terminal.mjs apps/harmony/entry/src/main/resources/rawfile/terminal.html
  ```
  See [`docs/harmony-client.md`](docs/harmony-client.md) for unsigned/signed build steps and device smoke testing.

## Build, verification, and generated artifacts

For full local verification aligned with CI's `quality` job:

```bash
pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm -r check
pnpm exec oxlint --type-aware --quiet packages apps scripts
node scripts/verify-dsh-plugin.mjs
pnpm -r test
NODE_ENV=production pnpm --workspace-concurrency=1 -r build
node scripts/verify-packed-webrtc.mjs
git diff --exit-code -- packages/plugin/dist/index.js packages/plugin/dist/client.github.js
```

- Always pass `--workspace-concurrency=1` for a full production build so mobile build steps and plugin bundling do not contend with each other.
- If you modify tracked shell scripts (`*.sh`, excluding `zsh` scripts such as `apps/ios/ios/ci_scripts/ci_post_clone.sh`) and have `shellcheck` installed locally, run `shellcheck -S warning <script.sh>` (CI runs this across all tracked non-`zsh` `*.sh` files).
- `node scripts/verify-packed-webrtc.mjs` packs and production-installs both the root package and `packages/plugin` into temporary directories; run it after `./packages/**` is built in an environment that can run `npm install`.

### Committed generated artifacts vs. ignored outputs

- **Must be rebuilt and committed together with source changes**: Whenever you modify `packages/plugin` or any shared package it bundles (`packages/{protocol,crypto,webrtc,client-core}`), rebuild the packages with `pnpm --filter './packages/**' -r build` (the plugin bundler consumes compiled `dist/` outputs from shared packages), verify with `node scripts/verify-dsh-plugin.mjs`, and commit the updated `packages/plugin/dist/index.js` and `packages/plugin/dist/client.github.js`. Before pushing, confirm `git diff --exit-code -- packages/plugin/dist/index.js packages/plugin/dist/client.github.js` stays clean after the full production build.
- **Keep out of Git (ignored outputs)**: `packages/plugin/dist/client.js` (generated during build and checked by `verify-dsh-plugin.mjs`, but ignored by Git), `packages/app-core/src/generated/`, `apps/android/src/generated/`, `apps/server/data/`, `.env`, `apps/harmony/build-profile.local.json5`, `*.hap`, `*.tgz`, `artifacts/`, and `docs/screenshots/`.
- **Root manifest invariants**: Do not add `scripts`, `private: true`, or `repository.directory` to the root `package.json`. Keep `package.json`, `dsh-plugin.json`, `packages/plugin/package.json`, `packages/plugin/dsh-plugin.json`, and `packages/plugin/src/version.ts` consistent with [`scripts/verify-dsh-plugin.mjs`](scripts/verify-dsh-plugin.mjs) and [`AGENTS.md`](AGENTS.md).

## Testing and optional checks

- **Test runner and discovery**: Workspace TypeScript/JavaScript packages use **Vitest** with default test discovery (no standalone `vitest.config.*` files). `packages/tui-plugin`'s `test` script runs `node scripts/verify-bundle.mjs` for bundle/dependency contract checks.
- **Scoped runs**: Run `pnpm --filter <name-or-path> check` and `pnpm --filter <name-or-path> test` while iterating. Note that `packages/app-core`'s `check` and `test` automatically run `build:renderers` and `verify:workspace`, and `packages/plugin`'s `build`, `check`, and `test` prepend `verify-version-sync.mjs`.
- **Mobile tests**: `apps/android` and `apps/ios` do not define a `test` script in their `package.json`; shared mobile unit tests live in `packages/app-core`. The standalone Android notification locale test (`apps/android/tests/live-task-notification-locales.test.ts`) is not wired into `pnpm -r test` and can be run directly with `pnpm exec vitest run apps/android/tests/live-task-notification-locales.test.ts`.
- **HarmonyOS Node-side checks** (not part of `pnpm -r test`, run by CI's `quality` job):
  ```bash
  pnpm exec vitest run apps/harmony/tests
  node apps/harmony/scripts/check-i18n.mjs
  node apps/harmony/scripts/bump-version.mjs --check
  ```
- **Platform-specific and optional checks**:
  - CI runs `xfs-refresh` on a loopback XFS filesystem on Linux (`pnpm --dir packages/plugin exec vitest run tests/server-credentials.test.ts tests/identity-store.test.ts`) to exercise V2 hard-link refresh locks.
  - Node-side unit tests do not substitute for native Android, iOS, or HarmonyOS device validation. State clearly in your PR what was verified natively and what was not.

### Test authoring guidelines

Focus test budget on real behavioral invariants (see [`AGENTS.md`](AGENTS.md#test-policy)):

- Wire protocol codecs and schema validation
- Identity, encryption, tamper, and replay protections
- Authorization, pairing, credential locks, and migration
- RPC correlation, fail-closed checks, route allowlists, and async compaction state machines
- Transport switching and reconnect state machines

Avoid brittle unit tests for static copy, icons, colors, layout, or source-text matching. When covering multiple variants, prefer isolated scenario matrices via [`scripts/test-scenarios.mjs`](scripts/test-scenarios.mjs) and never hide failures with `skip` or `exclude`.

## Code style and local conventions

This repository uses lightweight static checks and editor defaults without a dedicated formatter or Git hooks:

- **Editor and line endings**: [`.editorconfig`](.editorconfig) sets UTF-8, LF line endings, 2-space indentation, final newlines, and trailing-whitespace trimming, with per-file overrides for `*.md`, `*.patch`, `packages/plugin/dist/*.js`, and `Makefile`. [`.gitattributes`](.gitattributes) enforces LF for `*.sh` scripts and preserves whitespace exemptions for generated plugin bundles and `*.patch` files.
- **TypeScript and React linting**: [`.oxlintrc.json`](.oxlintrc.json) configures type-aware **Oxlint** (`oxlint` + `oxlint-tsgolint`), run via `pnpm exec oxlint --type-aware --quiet packages apps scripts`. Error-level rules enforce `react/rules-of-hooks`, `typescript/no-floating-promises`, `typescript/no-misused-promises` (with `checksVoidReturn.attributes: false`), and a curated set of core correctness rules (such as `no-debugger`, `no-unreachable`, and `no-dupe-keys`); `react/exhaustive-deps` and `eslint/no-unused-vars` (`_` prefix ignored) are warnings. Generated/vendored/native directories (such as `dist/`, `generated/`, `vendor/`, `apps/harmony/`, `examples/mock-host/`, and `fixtures/`) are ignored, and overrides for `**/tests/**`, `*.test.ts(x)`, and `scripts/transport-bench/**` relax `react/rules-of-hooks` and `typescript/no-misused-promises` (see [`.oxlintrc.json`](.oxlintrc.json) for the full list).
- **What is not configured**: The repository does **not** configure ESLint, Prettier, Biome, `commitlint`, or Husky Git hooks. Strict TypeScript (`strict: true` in `tsconfig.base.json`, plus `noUncheckedIndexedAccess: true` in `packages/app-core`), Oxlint, ShellCheck (for tracked non-`zsh` `*.sh` scripts), and repository verification scripts form the static checks.

Match the conventions of the subtree you edit rather than reformatting unrelated code:

- **Node / ESM TypeScript** (`packages/{plugin,protocol,crypto,webrtc,client-core}`, `apps/{server,browser,vscode}`): 2-space indentation, single quotes, no trailing semicolons, trailing commas, and explicit `.js` extensions on relative imports (`NodeNext`).
- **Mobile TypeScript** (`packages/app-core`, `apps/{android,ios}`): 2-space indentation, no trailing semicolons, extensionless relative imports (Expo TypeScript resolution).
- **HarmonyOS ArkTS** (`apps/harmony/entry/src/**/*.ets` and companion `.mjs` scripts): 2-space indentation, single quotes, trailing semicolons, and explicit type annotations.
- **Encoding and whitespace**: Follow [`.editorconfig`](.editorconfig) and [`.gitattributes`](.gitattributes) (save text files as UTF-8 without BOM), and run `git diff --check` before committing.

For wire protocol changes, update [`docs/protocol.md`](docs/protocol.md), `packages/protocol`, `fixtures/`, and affected consumers together rather than inventing parallel contracts.

## Documentation and localization

### Documentation rules

- Root documentation files are limited to `README.md`, `README.zh.md`, `README.ja.md`, `CONTRIBUTING.md`, `CONTRIBUTING.zh.md`, and `AGENTS.md` (alongside `LICENSE` and root manifest/config files). Topic guides live under [`docs/`](docs/README.md) and design documents under [`docs/design/`](docs/design/README.md).
- Do not commit temporary acceptance logs, machine addresses, build hashes, performance dumps, or verification screenshots to the repository. Attach screenshots directly to your PR description instead.
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md) records user-facing changes and contributors; routine PRs do not need to edit release entries.

### Translation sources and sync checks

| Surface | Location | Languages & verification |
| --- | --- | --- |
| Mobile app shared UI (Android & iOS) | `packages/app-core/src/locales/` | 9 locales; `Messages` is derived from `zh-CN.ts` and the other 8 files are checked at compile time via `satisfies Messages` or the typed `messageCatalogs` map in `i18n.ts` (`tsc --noEmit`). If editing Android foreground-service notification copy, also check `apps/android/plugins/with-remote-foreground-service.js`. |
| Host plugin injected UI | `packages/plugin/src/client-locale.ts` | 4 locales (`en`, `zh`, `ru`, `uk`), key-checked by TypeScript. |
| Plugin marketplace metadata | `locale/` and `packages/plugin/locale/` | 5 locales (`en`, `ja`, `ru`, `uk`, `zh`) for both `*.json` and `README.*.md`. **No automated sync check exists**—keep both directories byte-identical when editing. |
| HarmonyOS client | `apps/harmony/entry/src/main/ets/services/I18n.ets` | 2 locales (Chinese & English), enforced by `node apps/harmony/scripts/check-i18n.mjs`. |
| VS Code & Browser extensions | `apps/vscode/package.nls*.json`, `apps/browser/_locales/*/messages.json` | 2 locales (Chinese & English), manual sync. |

## Pull requests, commits, and CI

1. **Branch from latest `main`**: Fork the repository (or use an isolated branch/worktree from the latest upstream `main`) and keep each PR focused on a single goal. For large multi-package or protocol changes, open an issue first or split the work into independently reviewable PRs.
2. **Commit messages**: There is no enforced commitlint hook, but commit history follows Conventional Commits style (for example `feat(plugin): ...`, `fix(app-core): ...`, `docs: ...`, `refactor(server): ...`). Both English and Chinese descriptions are welcome.
3. **PR description**: Explain the motivation or root cause, summarize the key changes, reference related issues (`Closes #...` / `Refs #...`), and list the exact verification commands you ran along with any untested platforms. Never include tokens, private keys, pairing QR codes, conversation prompts, or personal local paths in code, comments, logs, or screenshots.

### What GitHub Actions runs

The workflows below describe what automation executes in this repository; final merge decisions rest with maintainers and check outcomes:

- **[`.github/workflows/ci.yml`](.github/workflows/ci.yml)** runs on `push` and `pull_request`, with **`paths-ignore: ["**.md", "docs/**"]`** (Markdown-only and `docs/**` PRs do not automatically trigger CI).
  - For code or config changes, it runs `changes` (path detection), `quality` (workspace build, dist diff check, typecheck, type-aware Oxlint, ShellCheck on non-`zsh` `*.sh` scripts, `verify-dsh-plugin.mjs`, workspace tests, HarmonyOS Node contract/i18n/version checks, production build, and `verify-packed-webrtc.mjs`), `xfs-refresh` (Linux XFS credential lock tests), and `plugin-package` (`.tgz` and browser extension packaging).
  - Path-gated jobs run conditionally: `android-apk` (PR builds target `arm64-v8a` only) and `ios-build` (unsigned compilation on macOS; requires no Apple credentials, so fork PRs can run it).
- **[`.github/workflows/harmony-hap.yml`](.github/workflows/harmony-hap.yml)** runs only on the upstream repository's self-hosted `harmonyos` runner via manual dispatch or release invocation; it does not run automatically on fork PRs.

## Security and privacy boundaries

- **Encryption vs. visible metadata**: Session payloads, prompts, model outputs, tool input/output, approvals, workspace paths/source, and file uploads travel over `Noise_IK_25519_ChaChaPoly_SHA256` end-to-end encryption and cannot be decrypted by the signaling/relay server, provided the server honestly distributes initial device identity keys (see the trust model in [`docs/end-to-end-encryption.md`](docs/end-to-end-encryption.md)). Even then, the server still observes metadata including account/device ownership, `deviceId`, role, display name, public identity key, online presence, connection timing, `connectionId`, negotiated capabilities/network path, IP addresses, WebRTC signaling/ICE candidates, and relay frame sizes, directions, and timing. Do not describe end-to-end encryption as hiding metadata from the server. Browser Launcher privacy scope is documented in [`docs/PRIVACY.md`](docs/PRIVACY.md).
- **Sanitize diagnostics**: Never log or post tokens, private keys, pairing codes, QR codes, prompts, source code, or personal host paths.
- **Reporting security vulnerabilities**: **Do not disclose security vulnerabilities or exploit PoCs in public issues or pull requests.** Check the repository's [Security page](https://github.com/liguobao/ds-harness-remote/security) first and use GitHub's private vulnerability reporting form if it is enabled. If private reporting is not available there, do not post exploit details publicly—open a minimal contact note asking a maintainer for a private channel before sharing reproduction details.

## Maintainer releases and license

- **Releases**: Official version bumps, npm publishing, GitHub Releases, container images, Android APKs, and unsigned HarmonyOS HAPs are handled by maintainers on the upstream repository via `v*` tags and [`.github/workflows/release.yml`](.github/workflows/release.yml) (iOS signing and TestFlight distribution run through Xcode Cloud; see [`docs/ios-xcode-cloud.md`](docs/ios-xcode-cloud.md)). Regular contribution PRs should not bump package versions or run `npm publish` from the repository root.
- **License**: This repository is licensed under the [MIT License](LICENSE) (`Copyright (c) 2026 DSH Remote contributors`). Specific vendored components retain their upstream licenses (for example, [`packages/app-core/src/vendor/ds-bot/`](packages/app-core/src/vendor/ds-bot/README.md) is Apache-2.0).
