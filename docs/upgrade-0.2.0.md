# DeepSeek Harness 0.2.0-rc.1 compatibility

The `dsh-v0.2.0-rc.1` release keeps the Typert Remote carrier on the Session V3 wire used by the 0.1.5–0.1.7 line, but publishes every official package under the `0.2.0-rc.1` version. Remote now uses that package line for its development build and advertises it in the plugin peer ranges.

The compatibility adapter treats `0.2.0-rc.1` as Session V3, applies the 0.1.7 workspace file payload rules to the 0.2.0 host, and accepts the 0.2.0 zero-argument default Workspace request when an older client includes the retired naming object. The fixed authenticated endpoint allowlist includes the native 0.2.0 calls for session projections, application lookup, default Workspace initialization, and pinning.

Validation covered Plugin type checking, production bundle generation, the full Plugin test suite, and explicit 0.2.0 cases for Session V3 selection, command attachments, workspace file requests, and the new allowlist entries. A real cross-device `dsh-v0.2.0-rc.1` Desktop/TUI run remains a follow-up item in `docs/TODO.md`.
