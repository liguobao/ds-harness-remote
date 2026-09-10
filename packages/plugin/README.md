# DeepSeek Harness Remote

Continue your DeepSeek Harness sessions and experimental Codex workspaces from another device over an end-to-end encrypted connection.

[GitHub](https://github.com/liguobao/ds-harness-remote) · [Full guide](https://github.com/liguobao/ds-harness-remote#readme) · [中文说明](https://github.com/liguobao/ds-harness-remote/blob/main/README.zh.md) · [Remote Web](https://dsh.r2049.cn/app) · [Android](https://github.com/liguobao/ds-harness-remote/releases/latest)

`ds-harness-remote` is the Remote Host and workspace plugin for DSH. Harness keeps running on your work computer with its existing workspaces, tools, and permission controls; Remote gives your authorized devices another window into that environment.

> Install this package with `dsh plugin`, not `npm install`. The DSH command updates the selected profile and adds the required bundle configuration.

## Highlights

- Continue active sessions and review progress from another computer, the web, or Android
- Send text and image prompts, answer questions, and handle permission requests
- Open workspaces on another authorized computer without replacing the native Harness interface
- Reach the Host without opening a public listening port or configuring router port forwarding
- Protect session traffic with authenticated end-to-end encryption
- Preview remote files through the optional, read-only `dsh-file-viewer` integration
- Open Host Codex projects in the existing Remote UI through the optional experimental Codex domain

## Install

### DSH Desktop

[DSH Desktop](https://github.com/liguobao/dsh-desktop) includes Remote and enables it by default. No separate plugin installation is required.

### Existing DSH installation

Add the exact package version to the `web` profile, then restart Harness:

```sh
dsh plugin --profile web add ds-harness-remote@0.4.14
```

### dsh-TUI Host

Remote can also run as a Host in a terminal-only [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile:

```sh
dsh plugin --profile dsh-tui add ds-harness-remote@0.4.14
```

After starting dsh-TUI, manage Remote with its native slash command:

```text
/remote
/remote login
/remote login github
/remote status
/remote logout
```

`/remote login` uses Zhihu QR authorization by default; GitHub QR authorization is also supported.

## Quick start

1. Open **Remote** from the Harness sidebar.
2. Sign in with GitHub or Zhihu QR authorization, or with your account and password.
3. Enable remote control for the computer that will remain running.
4. Sign in to the same account from DSH Desktop, [Remote Web](https://dsh.r2049.cn/app), or the [Android client](https://github.com/liguobao/ds-harness-remote/releases/latest).
5. Select the online Host and open one of its workspaces.

The public service currently uses the hosted Remote relay at `dsh.r2049.cn`. A supported self-hosted relay option is not available yet.

## Experimental Codex workspaces

Codex Remote is an optional domain inside this plugin. It lets authorized clients open projects reported by the Codex App Server while continuing to use the existing Harness or Android workspace and conversation UI.

Codex support is enabled by default and can be disabled in the DeepSeek Remote settings card. It remains experimental while long-running recovery and cross-version compatibility work continue. See the [Codex Remote technical notes](https://github.com/liguobao/ds-harness-remote/blob/main/docs/codex-remote.md) for the current boundaries and validation status.

## Security boundary

- Session traffic is encrypted on the Client and decrypted only by the selected Host using `Noise_IK_25519_ChaChaPoly_SHA256`.
- Account membership and the Host's locally pinned device identity must both authorize a connection.
- The Host creates outbound connections only; it does not listen on a public port.
- Remote does not expose a direct shell, PTY, general tool RPC, remote desktop, or file-mutation API. Harness tools continue to operate under the Host's normal permission controls.
- Workspace browsing returns bounded, read-only directory metadata. Optional file previews remain read-only and provider-authorized.
- The relay can observe necessary connection metadata but cannot read session messages, prompts, tool output, workspace paths, or file-preview content.

## Compatibility

Plugin `0.4.14` supports:

- DeepSeek Harness `dsh-v0.1.1-rc.2` through the official legacy `ApiProxy`
- DeepSeek Harness `dsh-v0.1.2-alpha.1` through `dsh-v0.1.2-rc.1` through the official Typert Remote Gateway
- DeepSeek Harness `dsh-v0.1.5-rc.1` Session V3 through the official Typert Remote Gateway

Remote Web/Desktop and Android clients normalize released sessions that still report the retired
`code` agent preset to `ptc`, so old sessions can resume on `dsh-v0.1.5-rc.1` without patching
DeepSeek Harness itself.

Both Desktop endpoints must use the same Harness carrier and Session generation. ApiProxy/Typert and v0.1.2/V3 connections are not translated; mixed-generation connections are rejected before mutations.

## Documentation

- [Complete English guide](https://github.com/liguobao/ds-harness-remote#readme)
- [完整中文说明](https://github.com/liguobao/ds-harness-remote/blob/main/README.zh.md)
- [dsh-TUI Remote guide](https://github.com/liguobao/ds-harness-remote/blob/main/docs/dsh-tui.md)
- [End-to-end encryption](https://github.com/liguobao/ds-harness-remote/blob/main/docs/end-to-end-encryption.md)
- [Network and transport](https://github.com/liguobao/ds-harness-remote/blob/main/docs/network.md)
- [Protocol reference](https://github.com/liguobao/ds-harness-remote/blob/main/docs/protocol.md)

## Project status

This is an independent community project and is not an official DeepSeek product. DeepSeek and related names and marks belong to their respective owners.

Licensed under the [MIT License](https://github.com/liguobao/ds-harness-remote/blob/main/packages/plugin/LICENSE).
