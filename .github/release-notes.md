## English

`v0.4.13` is a compatibility release for DeepSeek Harness Remote. It restores the
newer Desktop control route, keeps rc.2 Clients working against Session V3 Hosts
that still expose ApiProxy, and lets Session V3 Desktop clients open legacy
v0.1.2 Typert Remote Hosts through Remote-side normalization. It contains the
changes since `v0.4.12` ([full comparison](https://github.com/liguobao/ds-harness-remote/compare/v0.4.12...v0.4.13)).

### What changed

- Registers the Remote loopback control route directly on the DSH web server
  when available, while preserving Host request rejection checks.
- Advertises legacy ApiProxy capabilities alongside Session V3 when the Host has
  both carriers, so older Remote Web clients can still choose the rc.2 path.
- Allows Session V3 Desktop clients to open legacy v0.1.2 Typert Remote Hosts by
  normalizing legacy session pages, follow snapshots, event names, message
  sources, replacement ranges, and history gaps at the Remote boundary.
- Keeps legacy Typert clients fail-closed against Session V3 Hosts.
- Permits Codex-only Hosts to pass feature probing without requiring a Harness
  carrier.
- Synchronizes the Plugin and Android app at version `0.4.13` with Android
  `versionCode 30`.

### Install and downloads

Install through DSH's plugin manager:

```sh
dsh plugin --profile web add ds-harness-remote@0.4.13
dsh plugin --profile dsh-tui add ds-harness-remote@0.4.13
```

- [npm package](https://www.npmjs.com/package/ds-harness-remote/v/0.4.13)
- [Android APK](https://github.com/liguobao/ds-harness-remote/releases/download/v0.4.13/dsh-remote-android-v0.4.13.apk)
- Release assets also include the npm tarball and `SHA256SUMS.txt`.

## 中文

`v0.4.13` 是 DeepSeek Harness Remote 的兼容性版本。它恢复新版 Desktop 的控制路由，
让仍暴露 ApiProxy 的 Session V3 Host 继续兼容 rc.2 Client，并允许 Session V3 Desktop
Client 通过 Remote 侧归一化打开 legacy v0.1.2 Typert Remote Host。本版本包含自
`v0.4.12` 以来的改动（[完整对比](https://github.com/liguobao/ds-harness-remote/compare/v0.4.12...v0.4.13)）。

### 主要变更

- 在可用时直接把 Remote loopback control route 注册到 DSH web server，同时保留 Host
  request rejection 检查。
- 当 Host 同时具备 Session V3 与 ApiProxy carrier 时继续发布 legacy ApiProxy capability，
  让旧 Remote Web Client 仍可选择 rc.2 路径。
- Session V3 Desktop Client 可以通过 Remote 边界内的归一化打开 legacy v0.1.2 Typert
  Remote Host；归一化覆盖 session page、follow snapshot、event 名称、message source、
  replacement range 与 history gap。
- legacy Typert Client 仍会对 Session V3 Host fail closed。
- 允许仅提供 Codex 能力的 Host 通过 feature probing，不强制要求 Harness carrier。
- Plugin 与 Android App 版本统一更新为 `0.4.13`，Android `versionCode` 更新为 `30`。

### 安装与下载

请通过 DSH Plugin 管理器安装：

```sh
dsh plugin --profile web add ds-harness-remote@0.4.13
dsh plugin --profile dsh-tui add ds-harness-remote@0.4.13
```

- [npm 包](https://www.npmjs.com/package/ds-harness-remote/v/0.4.13)
- [Android APK](https://github.com/liguobao/ds-harness-remote/releases/download/v0.4.13/dsh-remote-android-v0.4.13.apk)
- Release 附件还包括 npm tarball 与 `SHA256SUMS.txt`。
