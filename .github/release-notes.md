## English

- Refreshes the npm package documentation and installation metadata for the current release line.
- Improves compatibility with DeepSeek Harness `dsh-v0.1.7-rc.1`: Volatile settings entries, the updated Typert stream-open signature, workspace file payloads, and byte responses are supported while the `0.1.6` settings path remains available.
- Keeps `dsh-v0.1.6-alpha.2` and earlier settings hosts working, including onboarding acknowledgement handling when the older settings registry rejects the newer welcome field.
- Ships the CodeX Remote workspace file and terminal forwarding added in 0.4.17, including PTY-backed subprocesses when available, pipe fallback, bounded output replay, reconnect snapshots, terminal ownership, resize, and state handling.
- Includes the native workspace file tree and read-only previews, Host-local terminals, and authorized loopback development-service previews from the 0.4.15 release.

## 中文

- 更新 npm 包文档和安装元数据，使其与当前发布线保持一致。
- 提升对 DeepSeek Harness `dsh-v0.1.7-rc.1` 的兼容性：支持 Volatile settings、更新后的 Typert stream-open 签名、工作区文件 payload 与 byte 响应，同时保留 `0.1.6` settings 路径。
- 保留 `dsh-v0.1.6-alpha.2` 及更早 settings Host 的可用性，包括旧 settings 注册表拒绝新版 welcome 字段时的引导确认兼容。
- 包含 0.4.17 加入的 CodeX Remote 工作区文件和终端转发：优先使用 PTY，支持管道回退、有限输出回放、断线快照、终端归属、尺寸调整和状态更新。
- 包含 0.4.15 加入的原生工作区文件树与只读预览、Host 本地终端及授权 loopback 开发服务预览。

## Contributors / 贡献者

- [@ccch1mneyyy](https://github.com/ccch1mneyyy) — Android 文件预览、会话工具栏和终端面板改动（PR [#73](https://github.com/liguobao/ds-harness-remote/pull/73)、[#74](https://github.com/liguobao/ds-harness-remote/pull/74)）。

[Full changelog / 完整改动](https://github.com/liguobao/ds-harness-remote/compare/v0.4.18...v0.4.19) · [Installation / 安装说明](https://github.com/liguobao/ds-harness-remote/blob/v0.4.19/README.md)
