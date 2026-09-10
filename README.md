<p align="center">
  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="600">
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="README.zh.md">中文</a>
  &nbsp;·&nbsp;
  <a href="docs/README.md">Documentation</a>
  &nbsp;·&nbsp;
  <strong>Download:</strong>
  <a href="https://github.com/liguobao/dsh-desktop/releases/latest">Windows</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/dsh-desktop/releases/latest">macOS</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/dsh-desktop/releases/latest">Linux</a>
  &nbsp;·&nbsp;
  <a href="https://dsh.r2049.cn/app">Web</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/releases/latest">Android</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ds-harness-remote">npm</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote">GitHub</a>
  &nbsp;·&nbsp;
  <a href="https://dshfind.com/zh/plugins/liguobao/ds-harness-remote?ref=badge"><img src="https://dshfind.com/api/badge/liguobao/ds-harness-remote?metric=downloads&amp;lang=zh" alt="dshfind downloads" width="137" height="20" align="absmiddle"></a>
</p>

## Connect once. Ready whenever you are.

Continue using your DeepSeek Harness instance from a phone, computer, or browser.

Return to the same Harness session from whichever device is with you. Harness keeps running on your work computer, with the same workspaces, tools, and project setup. Remote is simply another window into that environment.

## Features

- Continue active sessions and review their latest progress from another device
- Send new instructions, change direction, and use image prompts with Harness `dsh-v0.1.1-rc.2`, `dsh-v0.1.2-alpha.1`–`rc.1`, or `dsh-v0.1.5-rc.1`
- Answer questions and permission requests from clients with live conversation controls
- Open workspaces from another authorized computer on the same account
- Reuse the native Harness interface instead of maintaining a separate desktop conversation UI
- Preview remote files between two Harness installations with the optional `dsh-file-viewer` plugin
- Run a terminal-only [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile as a Host and authorize it with a GitHub or Zhihu QR code
- The Harness Host does not need a public listening port. Connect securely from anywhere with internet access over a bidirectional end-to-end encrypted channel

## Install

### Path A: DSH Desktop

Install [DSH Desktop](https://github.com/liguobao/dsh-desktop) on Windows, macOS, or
Linux. Remote is included and enabled by default, so no separate plugin installation is required.

### Path B: Existing DSH installation

Add the exact package version through DSH's plugin manager for the `web` profile:

```sh
dsh plugin --profile web add ds-harness-remote@0.4.12
```

Restart Harness after installation.

Do not install this package directly with npm. Only `dsh plugin` updates the selected profile and
adds the bundle's configuration layer.

### Path C: dsh-TUI Host

Remote can run as a Host in a terminal-only [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)
profile; it does not require the Desktop browser `connection` service. Install the plugin in the
TUI profile:

```sh
dsh plugin --profile dsh-tui add ds-harness-remote@0.4.12
```

Start dsh-TUI and use its native slash command:

```text
/remote                    # live Host status
/remote login              # Zhihu QR login by default
/remote login github
/remote status
/remote logout
```

`/remote login` opens a TUI-native QR scene and prints a clickable authorization URL below the QR
code. Login defaults to Zhihu; GitHub is also supported. Host control is enabled by default, and
`/remote logout` revokes the Host and rotates its local device identity. Host configuration is not
exposed yet; the integration uses `https://dsh.r2049.cn`. Tab completion is available for the
subcommands and login providers. The `/remote` Host-management surface supports TUI profiles on
`dsh-v0.1.1-rc.2`, `dsh-v0.1.2-alpha.1`–`rc.1`, and
`dsh-v0.1.5-rc.1`; Remote workspace capabilities are advertised
only when their official Harness carrier is available.

See the [dsh-TUI Remote guide](docs/dsh-tui.md) for the compatibility matrix, rc.2 ApiProxy setup,
status fields, and troubleshooting.

## Quick start

1. Open **Remote** from the Harness sidebar.
2. Sign in with a GitHub or Zhihu QR code, or use your account and password. New password accounts can register through [Remote Web](https://dsh.r2049.cn/app/register); the site shows the current invitation requirements.
3. Enable remote control for the current computer.
4. On another device, open DSH Desktop, Remote Web, or the Android client and sign in to the same account.
5. Select the online Host, then choose an existing workspace or browse remote directories to open one.

The public service currently uses the hosted Remote relay. A supported self-hosted relay
option is not available yet.

## Screenshots

### Desktop

Enable **Allow control of this device** in Remote settings to make the current computer
available as a Host.

On another computer, select an online Host and open one of its workspaces.

<p align="center">
  <img src="docs/images/host-list.png" alt="Remote workspace picker listing online Hosts" width="900">
</p>

The workspace opens in the native Harness interface, with the active Host and encrypted
connection status shown in the header.

<p align="center">
  <img src="docs/images/remote.png" alt="A Harness conversation running through an encrypted remote connection" width="900">
</p>

### Android

Download the latest Android APK from [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest).

Sign in to the Android client with your existing account, select an available computer,
open a workspace, and continue the conversation with text or image prompts. The conversation
toolbar also lets you switch the active model and choose any reasoning effort declared by it.

<p align="center">
  <img src="docs/images/mobile-list.jpg" alt="Android client listing online and offline computers" width="30%">
  <img src="docs/images/image-msg.jpg" alt="Sending an image prompt from the Android client" width="30%">
  <img src="docs/images/image-result.jpg" alt="Viewing the image response in the Android client" width="30%">
</p>

## How it works

```text
DSH Desktop / Remote Web / Android
  ↔ authenticated, end-to-end encrypted channel
Remote Plugin on the Host
  ↔ supported Harness or optional Codex workspace support
Harness sessions/workspaces or Codex projects
```

The Harness Host does not need a public listening port. You can connect from
anywhere with internet access, and Remote communicates over a bidirectional end-to-end encrypted channel.
It switches the client to the selected Host's native Harness API, so the original workspace,
tools, and permission flow remain on that computer. Every settings namespace currently
registered by the Host can also be configured remotely through the official Harness settings
API. Credential values remain write-only, and Host-local document/open actions are never exposed.

## Experimental Codex workspaces

Remote can also show Codex projects from an authorized Host. Pick one from the normal workspace
chooser and continue in the existing Harness or Android interface; there is no separate Codex screen
to learn. The Desktop chooser and Android workspace page can also add a Host directory to the Codex
project catalog without importing it into Harness storage.

Codex Remote is meant as a convenience layer for your own devices. It supports text prompts, image
prompts where available, model and permission controls, interrupt, and approvals. It is still
published as experimental while long-running recovery and compatibility work continue.

Web and Desktop approval controls show the Host-confirmed mode for the selected Codex session.
If it has not been reported, they indicate that Host settings are inherited. Changing the mode
requires Host confirmation; sending a prompt preserves the session's current policy.

Codex is enabled by default and can be turned off in the DeepSeek Remote settings card. Advanced
configuration and implementation notes live in [Codex Remote technical notes](docs/codex-remote.md).

## End-to-end encryption

Harness business traffic is encrypted on the Client and decrypted only by the selected Host using
the fixed `Noise_IK_25519_ChaChaPoly_SHA256` suite. Account membership and locally pinned device
identity keys must both authorize a connection. The service can route connections and observe
network metadata, but it cannot read session messages, prompts, tool output, workspace paths, or
File Viewer content. See [End-to-end encryption](docs/end-to-end-encryption.md) for the handshake,
key lifecycle, visible metadata, replay protection, and security limits.

## Network and transport

The Host opens outbound connections only; it does not listen on a public port or require router
port forwarding. Remote negotiates `LAN -> P2P -> TURN -> Relay`, falling back to the encrypted
WebSocket Relay when WebRTC is unavailable or cannot connect. Every path carries the same Noise
ciphertext and keeps the same Host/Client identity boundary. See [Network and transport](docs/network.md)
for the topology, control and data planes, NAT behavior, fallback, reconnect semantics, and current
validation status.

## Security

- Session traffic is end-to-end encrypted. The service relays ciphertext without storing session plaintext or device private keys.
- Server membership and the Host's locally pinned peer identity must both authorize a connection.
- Remote does not expose a direct shell, PTY, general tool RPC, or remote desktop. Harness tools may still modify files or run commands on the Host under Harness's normal permission controls.
- The workspace picker lists folders only and returns bounded, read-only directory metadata.
- Optional File Viewer access is limited to authenticated, encrypted range reads and continues to enforce provider root and locator authorization.
- Remote file preview cannot write, delete, upload, execute, or open a path in an external application.
- Codex Remote is optional, can be disabled, and follows the same encrypted Host permission boundary as the rest of Remote.
- Removing a device revokes its credentials, membership, and active Remote connections.

## Compatibility

**Breaking change notice:** Plugin `0.4.1` removes the earlier experimental
Remote business RPC surface (`sessions.*`, `session.*`, `permissions.respond`,
`sync.from`). Harness session traffic now only uses the official rc.2
`ApiProxy` or the v0.1.2 Typert Remote Gateway, and this plugin does not provide
an adapter or wire-format translation for the old RPC surface.

Plugin `0.4.12` supports DeepSeek Harness `dsh-v0.1.1-rc.2` through the legacy
official `ApiProxy`, and `dsh-v0.1.2-alpha.1`–`rc.1` through the
official Typert Remote Gateway. It also supports
`dsh-v0.1.5-rc.1` Session V3 through the official Typert Remote Gateway. A `0.4.12` Client running rc.2 remains compatible
with older rc.2 Hosts through the legacy capability fallback.

Both Desktop endpoints must use the same Harness carrier and Session generation. Plugin
`0.4.x` does not translate legacy ApiProxy, the v0.1.2 Session wire, and Session V3 business models: a
Typert Client cannot open an ApiProxy Host, and an ApiProxy Client cannot open a Typert Host. Mixed
v0.1.2/V3 connections are also rejected before switching the native UI or mutating a Workspace.

## Documentation

- [Plugin guide](packages/plugin/README.md)
- [dsh-TUI Remote guide](docs/dsh-tui.md)
- [Codex Remote technical notes](docs/codex-remote.md)
- [Documentation index](docs/README.md)
- [End-to-end encryption](docs/end-to-end-encryption.md)
- [Network and transport](docs/network.md)
- [Remote Protocol](docs/protocol.md)
- [Development status and roadmap](TODO.md)

## Links

- Friendly link: [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — Remote integration is available; see the [dsh-TUI Remote guide](docs/dsh-tui.md).
- Friendly link: [LINUX DO](https://linux.do/)
- Friendly link: [Cyber Liu Kanshan](https://kanshan.r2049.cn/)

## Project status and trademarks

This is an independent community project and is not an official DeepSeek product.
DeepSeek and related names and marks belong to their respective owners.

## License

[MIT](packages/plugin/LICENSE)
