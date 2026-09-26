# DeepSeek Harness Remote

Continue DeepSeek Harness sessions and experimental Codex workspaces from another device over an end-to-end encrypted connection.

[GitHub](https://github.com/liguobao/ds-harness-remote) · [Full guide](https://github.com/liguobao/ds-harness-remote#readme) · [中文说明](https://github.com/liguobao/ds-harness-remote/blob/main/README.zh.md) · [Remote Web](https://dsh.r2049.cn/app) · [Android](https://github.com/liguobao/ds-harness-remote/releases/latest)

`ds-harness-remote` is the Remote Host and workspace plugin for DeepSeek Harness. Harness keeps running on your work computer with its existing workspaces, tools, and permission controls; Remote gives authorized devices another window into that environment.

> Install this package with `dsh plugin`, not `npm install`. The DSH command updates the selected profile and adds the required bundle configuration.

## Install

### DSH Desktop

[DSH Desktop](https://github.com/liguobao/dsh-desktop) includes Remote and enables it by default. No separate plugin installation is required.

### Existing DSH installation

Add the current package version to the `web` profile, then restart Harness:

```sh
dsh plugin --profile web add -w ds-harness-remote@0.4.19
```

### dsh-TUI Host

Remote can also run as a Host in a terminal-only [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile:

```sh
dsh plugin --profile dsh-tui add -w ds-harness-remote@0.4.19
```

After starting dsh-TUI, manage Remote with `/remote`, `/remote login`, `/remote status`, and `/remote logout`.

## Highlights

- Continue active Harness sessions and review progress from another computer, the web, or Android.
- Send text and image prompts, answer questions, and handle permission requests.
- Open workspaces on another authorized computer without replacing the native Harness interface.
- Use the official workspace file tree and bounded read-only previews on supported Harness versions.
- Use an optional Host-local terminal and authorized loopback development-service previews.
- Open Host Codex projects in the existing Remote UI through the optional experimental Codex domain.
- Reach the Host without opening a public listening port or configuring router port forwarding.

## Compatibility

Plugin `0.4.19` primarily targets DeepSeek Harness `dsh-v0.1.7-rc.1` and also supports `dsh-v0.1.6-alpha.2` and earlier settings hosts. It supports:

- `dsh-v0.1.1-rc.2` through the official legacy `ApiProxy`;
- `dsh-v0.1.2-alpha.1` through `dsh-v0.1.2-rc.1` through the official Typert Remote Gateway;
- `dsh-v0.1.5-rc.1` and `dsh-v0.1.6-alpha.1` Session V3 through the official Typert Remote Gateway.

The same package feature-detects the older settings registry and the `0.1.7-rc.1` Volatile settings entry. Remote Web/Desktop and Android normalize released sessions that still report the retired `code` agent preset to `ptc`.

## Self-hosted Server

This repository includes a minimal, single-account self-hosted Relay Server in [`apps/server`](https://github.com/liguobao/ds-harness-remote/tree/main/apps/server). Configure `DSH_SERVER_ACCOUNT` and `DSH_SERVER_PASSWORD`, then point the Host and clients at the same server URL. It provides account login, device credentials, encrypted Control/Noise forwarding, Relay, and a device-status page. It does not provide the complete multi-account Server, Remote Web session UI, or WebRTC/TURN deployment.

## Security boundary

- Session traffic is encrypted on the Client and decrypted only by the selected Host using `Noise_IK_25519_ChaChaPoly_SHA256`.
- Account membership and the Host's locally pinned device identity must both authorize a connection.
- The Host creates outbound connections only; it does not listen on a public port.
- Remote does not expose general tool RPC, remote desktop, or file-mutation APIs.
- Interactive terminals are disabled by default and require a Host-local setting; they run as the Host user independently of Agent approvals.

## Documentation

- [Complete guide](https://github.com/liguobao/ds-harness-remote#readme)
- [dsh-TUI Remote guide](https://github.com/liguobao/ds-harness-remote/blob/main/docs/dsh-tui.md)
- [Codex Remote technical notes](https://github.com/liguobao/ds-harness-remote/blob/main/docs/codex-remote.md)
- [End-to-end encryption](https://github.com/liguobao/ds-harness-remote/blob/main/docs/end-to-end-encryption.md)
- [Network and transport](https://github.com/liguobao/ds-harness-remote/blob/main/docs/network.md)
- [Protocol reference](https://github.com/liguobao/ds-harness-remote/blob/main/docs/protocol.md)
- [Changelog](https://github.com/liguobao/ds-harness-remote/blob/main/CHANGELOG.md)

This is an independent community project and is not an official DeepSeek product. Licensed under the [MIT License](./LICENSE).
