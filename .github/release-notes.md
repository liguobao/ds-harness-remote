## English

- Fixes Harness version discovery when DSH is installed globally through an npm CLI symlink, restoring `harnessVersion` reporting for `dsh 0.2.0-rc.2` Hosts.
- Retains the DeepSeek Harness 0.2.0 Desktop shell lookup and version-gated workspace compatibility paths.
- Isolates development-service preview HTTP/WebSocket resources per Client and closes revoked-port connections immediately while preserving other allowed previews.
- Publishes the Android app as version `0.4.27` with Android `versionCode 38`.

### Thanks

Thanks to [择梦舟 (@dreamfarer-space)](https://github.com/dreamfarer-space) for contributing [PR #86](https://github.com/liguobao/ds-harness-remote/pull/86) and [PR #87](https://github.com/liguobao/ds-harness-remote/pull/87), which improve per-client preview isolation and immediate loopback port revocation.

## 中文

- 修复 DSH 通过 npm 全局 CLI 符号链接安装时的 Harness 版本探测，恢复 `dsh 0.2.0-rc.2` Host 的 `harnessVersion` 上报。
- 保留 DeepSeek Harness 0.2.0 Desktop 外壳探测及按版本选择的工作区兼容路径。
- 隔离不同 Client 的开发服务预览 HTTP/WebSocket 资源，并在撤销端口时立即关闭已有连接，同时保留其他允许端口的预览。
- 发布版本 `0.4.27` 的 Android App（Android `versionCode 38`）。

### 致谢

感谢 [择梦舟（@dreamfarer-space）](https://github.com/dreamfarer-space) 贡献 [PR #86](https://github.com/liguobao/ds-harness-remote/pull/86) 和 [PR #87](https://github.com/liguobao/ds-harness-remote/pull/87)，改进了不同 Client 的预览隔离和端口撤销时的连接清理。

[Full changelog / 完整改动](https://github.com/liguobao/ds-harness-remote/compare/v0.4.26...v0.4.27) · [Installation / 安装说明](https://github.com/liguobao/ds-harness-remote/blob/v0.4.27/README.md)
