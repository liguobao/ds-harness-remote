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
  <a href="https://dsh.r2049.cn/app">Web</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/releases/latest">Android</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/liguobao/ds-harness-remote/issues/20">iOS</a>
</p>

<p align="center">
  <a href="apps/server/README.md">Self-hosting</a>
  &nbsp;·&nbsp;
  <a href="https://www.npmjs.com/package/ds-harness-remote">npm</a>
  &nbsp;·&nbsp;
  <a href="https://dshfind.com/zh/plugins/liguobao/ds-harness-remote?ref=badge"><img src="https://dshfind.com/api/badge/liguobao/ds-harness-remote?metric=downloads&amp;lang=zh" alt="dshfind downloads" width="137" height="20" align="absmiddle"></a>
</p>

## Connect once. Ready whenever you are.

Continue using your DeepSeek Harness instance from a phone, computer, or browser. Return to the same Harness session from whichever device is with you.

Harness keeps running on your work computer, with the same workspaces, tools, and project setup.

DS Harness Remote is simply another window into that environment.

The DeepSeek Harness desktop edition is supported. Install the latest release:

`ds-harness-remote@0.5.13`

## Features

- Access your local Harness instance remotely from the web, a PC, or a mobile device: DSH first, with Codex, Cursor, and Antigravity support too.
- Use the native DeepSeek Harness interface without a separate desktop conversation UI.
- Create workspaces, configure models, and switch conversation models with the same smooth workflow as local use.
- Support DeepSeek Harness Desktop, ready to use after installation.
- Run a terminal-only [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile as a Host.
- No public listening port or public IP is required on the Harness Host. Connect from anywhere with internet access over a bidirectional end-to-end encrypted channel.
- Prefer P2P connections, use TURN relay nodes worldwide, and fall back to Server Relay when needed.
- Access workspace files, read-only previews, remote terminals, and authorized local development-service previews through the native Harness sidebar.
- CodeX and ACP terminals use the Host's default shell in the session directory and restore the terminal screen on reconnect.

## Install

### DeepSeek Harness Desktop support

Open **Extensions / Plugin management** in DeepSeek Harness Desktop, choose installation
from npm, and enter this package:

`ds-harness-remote@0.5.13`

Restart Desktop afterward. Its official `dsh` launcher can also install the pinned package
with `dsh plugin --profile desktop add -w ds-harness-remote@0.5.13`.

### dsh-TUI Host

For terminal Host setup with [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI), see the
[dsh-TUI Remote guide](docs/dsh-tui.md).

### Command-line installation

Add the exact package version through DSH's plugin manager for the `web` profile:

```sh
dsh plugin --profile web add -w ds-harness-remote@0.5.13
```

Restart DeepSeek Harness after installation.

For CLI installation, use `dsh plugin` to install the npm package into the selected profile
and add its bundle configuration layer.

### Plugin installer

The sole installer is `scripts/install.sh`:

- **Linux:** requires root; reuses an existing DSH or bootstraps private Node.js/DSH, accepts a one-time Host registration token, and enables/starts a systemd system service. The Host and remote tools run as **root**; grant access only to trusted accounts.
- **macOS:** run as a normal user; reuses Desktop's official launcher or an existing CLI, without installing DSH or creating services.
- Windows users use official Plugin management or existing Harness commands; no Windows installer is provided.

See the [installation guide](docs/installation.md) for private token input, updates, service controls and validation limits. Repository changes do not automatically deploy the hosted installer.

### Android client

Download the latest APK from [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest), sign in to the same account, and select a Host and workspace to continue your conversation.

### iOS client

- [Join the beta](https://github.com/liguobao/ds-harness-remote/issues/20)

## Quick start

1. Open **Remote** from the Harness sidebar.
2. Sign in with a GitHub or Zhihu QR code, or use your account and password.
3. The Host starts with control of the current computer enabled. Remote terminal access is also enabled by default; you can turn it off in the detailed Remote settings.
4. On another device, open the DeepSeek Harness desktop edition, Remote Web, or the Android client and sign in to the same account.
5. Select the online Host, then choose an existing workspace or browse remote directories to open one.

By default, Remote uses this project's hosted Server at [https://dsh.r2049.cn](https://dsh.r2049.cn).

For self-hosting, use the repository's [minimal Server](apps/server/README.md); its Web page shows device status only.

## Screenshots

### Desktop

The current computer starts with **Allow control of this device** enabled and is available as a Host. Remote terminal access is also enabled by default and can be turned off in the Host's detailed Remote settings.

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

Use text or image prompts, switch models, and access supported workspace files and terminals. See the [Android guide](apps/android/README.md) for details.

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

The Harness Host does not need a public listening port. You can connect from anywhere with internet access.

Remote communicates over a bidirectional end-to-end encrypted channel and switches the client to the selected Host's native Harness API.

The original workspace, tools, and permission flow remain on that computer.

Every settings namespace currently registered by the Host can also be configured remotely through the official Harness settings API.

Credential values remain write-only, and Host-local document/open actions are never exposed.

## Experimental ACP workspaces

The Host runs local AI backends and forwards prompts, streamed replies and approvals through the encrypted Remote channel.

Desktop and Android project their workspaces and sessions into the existing interface in memory, without writing them to Harness storage.

Supported backends:

- **Cursor** — connected through the CLI's ACP interface.
- **Antigravity (AGY)** — its stream-json CLI is adapted to the ACP gateway.
- **Pi Agent (experimental)** — install `@earendil-works/pi-coding-agent` and `pi-acp` on the Host, configure Pi's provider locally; Remote automatically detects and initializes Pi unless explicitly disabled in Remote settings. The workspace is available only after ACP initialization succeeds. Uses the separate ACP data plane. Tools run with Host-user permissions; per-tool confirmation requires a Pi extension and is not enabled by default.

- **OpenCode** — connected through `opencode acp`, with workspace discovery and history recovery. Host startup checks the CLI's supported options, accepting both native-listener and stdio-only ACP builds. Native session archiving on Desktop/Android requires the authenticated loopback API; builds without it report archiving unavailable. Archive state is saved by OpenCode; history is retained. Unarchive is not yet exposed.
- **Claude** — uses a locally authorized `claude-agent-acp` on the Host; enable it in Remote settings. Desktop/Android support workspaces, history, text prompts and approvals. Image input and direct Files/Terminal access are not available.

Model selection is available for Cursor, Claude, Pi, OpenCode, and AGY on Desktop/Android using the Host's actual model catalog and confirmed changes. Effort choices appear when advertised by the backend. Cursor uses a separate process per session so model changes cannot affect other conversations.

- **Codex** — connected through its independent App Server interface, with the same workspace entry.

Setup and adapter development: [Agent workspace integration guide](docs/acp-integration.md).

## End-to-end encryption

Harness business traffic is encrypted on the Client and decrypted only by the selected Host using
the fixed `Noise_IK_25519_ChaChaPoly_SHA256` suite. Account membership and locally pinned device
identity keys must both authorize a connection. The service can route connections and observe
network metadata, but it cannot read session messages, prompts, tool output, workspace paths, or
remote file contents. See [End-to-end encryption](docs/end-to-end-encryption.md) for the handshake,
key lifecycle, visible metadata, replay protection, and security limits.

## Network and transport

The Host opens outbound connections only; it does not listen on a public port or require router
port forwarding. Remote negotiates `LAN -> P2P -> TURN -> Relay`, falling back to the encrypted
WebSocket Relay when WebRTC is unavailable or cannot connect. Every path carries the same Noise
ciphertext and keeps the same Host/Client identity boundary. See [Network and transport](docs/network.md)
for the topology, control and data planes, NAT behavior, fallback, reconnect semantics, and current
validation status.

OAuth sign-in methods are loaded from the Server. Use `ds-harness-remote login list` or `/remote login list` to see available QR providers; new server integrations need no further plugin release.

## Security

- Session traffic is end-to-end encrypted. The service relays ciphertext without storing session plaintext or device private keys.
- Server membership and the Host's locally pinned peer identity must both authorize a connection.
- Interactive terminals use the Host-local `terminal.enabled` switch (on by default). They run as the Host user, independently of Agent approvals. General tool RPC and remote desktop remain unavailable.
- The workspace picker lists folders only and returns bounded, read-only directory metadata.
- Remote file preview cannot write, delete, upload, execute, or open a path in an external application.
- Codex Remote / Agent ACP is optional, can be disabled, and follows the same encrypted Host permission boundary as the rest of Remote.
- Removing a device revokes its credentials, membership, and active Remote connections.

## Documentation

- [Plugin guide](packages/plugin/README.md)
- [dsh-TUI Remote guide](docs/dsh-tui.md)
- [Codex Remote technical notes](docs/codex-remote.md)
- [ACP Remote / Agent adapter notes](docs/acp-remote.md)
- [Documentation index](docs/README.md)
- [End-to-end encryption](docs/end-to-end-encryption.md)
- [Network and transport](docs/network.md)
- [Remote Protocol](docs/protocol.md)
- [Development status and roadmap](docs/TODO.md)
- [Changelog](docs/CHANGELOG.md)
- [Privacy policy](docs/PRIVACY.md)
- The current development baseline is `dsh-v0.2.1-rc.1`; validation scope is documented in [the compatibility guide](docs/compatibility.md).

## Links

- Friendly link: [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — Remote integration is available; see the [dsh-TUI Remote guide](docs/dsh-tui.md).
- Friendly link: [LINUX DO](https://linux.do/)
- Friendly link: [Cyber Liu Kanshan](https://kanshan.r2049.cn/)

## Star History

<a href="https://www.star-history.com/?repos=liguobao%2Fds-harness-remote&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liguobao/ds-harness-remote&type=date&legend=top-left" />
 </picture>
</a>

## Project status and trademarks

This is an independent community project and is not an official DeepSeek product.
DeepSeek and related names and marks belong to their respective owners.

## License

[MIT](packages/plugin/LICENSE)
