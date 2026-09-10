## English

`v0.4.13` is the cumulative upgrade from `v0.4.10` to the current DeepSeek
Harness compatibility line. The main change is support for the latest
`dsh-v0.1.5-rc.1` Session V3 stack, while keeping the existing rc.2 ApiProxy and
v0.1.2 Typert Remote paths available where they are still needed. It contains
the changes since `v0.4.10` ([full comparison](https://github.com/liguobao/ds-harness-remote/compare/v0.4.10...v0.4.13)).

### What changed

- Adds `dsh-v0.1.5-rc.1` Session V3 support across the Plugin, Android app, and
  VS Code Typert client.
- Extends the DSH peer dependency matrix through `0.1.5-rc.1` while keeping
  `dsh-v0.1.1-rc.2` on the official legacy ApiProxy path and
  `dsh-v0.1.2-alpha.1` through `dsh-v0.1.2-rc.1` on the official Typert Remote
  Gateway path.
- Normalizes released sessions that still report the retired
  `agentPreset: "code"` to `ptc`, so old Remote sessions can resume on
  `dsh-v0.1.5-rc.1` without patching DeepSeek Harness itself.
- Restores compatibility around mixed client generations: Hosts with Session V3
  and ApiProxy advertise both carriers for older Remote Web clients, while
  Session V3 Desktop clients can open legacy v0.1.2 Typert Remote Hosts through
  Remote-side history and event normalization.
- Registers the Remote loopback control route directly on the newer DSH web
  server when available, preserving the same request rejection checks.
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

`v0.4.13` 是从 `v0.4.10` 升级到当前 DeepSeek Harness 兼容线的累计版本。主要变化是
兼容最新的 `dsh-v0.1.5-rc.1` Session V3，同时保留既有 rc.2 ApiProxy 与 v0.1.2 Typert
Remote 路径。本版本包含自 `v0.4.10` 以来的改动（[完整对比](https://github.com/liguobao/ds-harness-remote/compare/v0.4.10...v0.4.13)）。

### 主要变更

- Plugin、Android App 和 VS Code Typert Client 都已支持 `dsh-v0.1.5-rc.1`
  Session V3。
- DSH peer dependency 矩阵扩展到 `0.1.5-rc.1`；同时保留 `dsh-v0.1.1-rc.2`
  的官方 legacy ApiProxy 路径，以及 `dsh-v0.1.2-alpha.1` 到
  `dsh-v0.1.2-rc.1` 的官方 Typert Remote Gateway 路径。
- Remote 会把已发布旧会话中仍然上报的已退役 `agentPreset: "code"` 归一为
  `ptc`，因此旧 Remote 会话可以在 `dsh-v0.1.5-rc.1` 上恢复，而无需修改
  DeepSeek Harness 本身。
- 修复不同 Client 代际之间的兼容细节：同时具备 Session V3 与 ApiProxy 的 Host 会继续
  发布两种 carrier，便于旧 Remote Web Client 选择 rc.2 路径；Session V3 Desktop
  Client 也可以通过 Remote 侧 history/event 归一化打开 legacy v0.1.2 Typert Remote
  Host。
- 在新版 DSH web server 可用时直接注册 Remote loopback control route，同时保留相同的
  request rejection 检查。
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
