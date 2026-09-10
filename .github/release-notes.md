## English

`v0.4.12` upgrades DeepSeek Harness `dsh-v0.1.5` support to `rc.1`, keeps the existing rc.2 and v0.1.2 compatibility paths, and adds a Remote-side fallback for released sessions that still name the retired `code` agent preset. It contains the changes since `v0.4.10` ([full comparison](https://github.com/liguobao/ds-harness-remote/compare/v0.4.10...v0.4.12)).

### What changed

- Updates the Plugin, Android, and VS Code Typert clients from the `dsh-v0.1.5-alpha.1` compatibility baseline to `dsh-v0.1.5-rc.1`.
- Keeps `dsh-v0.1.1-rc.2` on the official legacy ApiProxy path and `dsh-v0.1.2-alpha.1` through `dsh-v0.1.2-rc.1` on the official Typert Remote Gateway path.
- Preserves the Session V3 capability contract and rejects mixed v0.1.2/V3 Desktop connections before switching native UI state or mutating a Workspace.
- Normalizes released sessions that still report `agentPreset: "code"` to `ptc` in the Plugin adapter, Android app, and shared Typert Remote client. This keeps old Remote sessions resumable on `dsh-v0.1.5-rc.1` without patching DeepSeek Harness itself.
- Keeps the `0.4.11` experimental Session V3 work in the release line, including Host capability probing and the newer assistant-stream projection path.
- Synchronizes the Plugin and Android app at version `0.4.12` with Android `versionCode 29`.

### Install and downloads

Install through DSH's plugin manager:

```sh
dsh plugin --profile web add ds-harness-remote@0.4.12
dsh plugin --profile dsh-tui add ds-harness-remote@0.4.12
```

- [npm package](https://www.npmjs.com/package/ds-harness-remote/v/0.4.12)
- [Android APK](https://github.com/liguobao/ds-harness-remote/releases/download/v0.4.12/dsh-remote-android-v0.4.12.apk)
- Release assets also include the npm tarball and `SHA256SUMS.txt`.

## 中文

`v0.4.12` 将 DeepSeek Harness `dsh-v0.1.5` 兼容基线升级到 `rc.1`，保留既有 rc.2 与 v0.1.2 兼容路径，并在 Remote 自己的边界里为仍记录已退役 `code` agent preset 的旧会话增加兜底。本版本包含自 `v0.4.10` 以来的改动（[完整对比](https://github.com/liguobao/ds-harness-remote/compare/v0.4.10...v0.4.12)）。

### 主要变更

- Plugin、Android 和 VS Code Typert Client 的 `dsh-v0.1.5` 兼容基线从 `alpha.1` 升级到 `rc.1`。
- `dsh-v0.1.1-rc.2` 继续走官方 legacy ApiProxy 路径，`dsh-v0.1.2-alpha.1` 到 `dsh-v0.1.2-rc.1` 继续走官方 Typert Remote Gateway 路径。
- 保留 Session V3 capability 契约，并在切换原生 UI 状态或修改 Workspace 前拒绝 Desktop v0.1.2/V3 混连。
- Plugin adapter、Android App 和共享 Typert Remote Client 会把旧会话仍上报的 `agentPreset: "code"` 归一为 `ptc`，让旧 Remote 会话可以在 `dsh-v0.1.5-rc.1` 上恢复，而无需修改 DeepSeek Harness 本身。
- 将 `0.4.11` 的实验性 Session V3 工作纳入发布线，包括 Host capability 探测和新的 assistant-stream projection 路径。
- Plugin 与 Android App 版本统一更新为 `0.4.12`，Android `versionCode` 更新为 `29`。

### 安装与下载

请通过 DSH Plugin 管理器安装：

```sh
dsh plugin --profile web add ds-harness-remote@0.4.12
dsh plugin --profile dsh-tui add ds-harness-remote@0.4.12
```

- [npm 包](https://www.npmjs.com/package/ds-harness-remote/v/0.4.12)
- [Android APK](https://github.com/liguobao/ds-harness-remote/releases/download/v0.4.12/dsh-remote-android-v0.4.12.apk)
- Release 附件还包括 npm tarball 与 `SHA256SUMS.txt`。
