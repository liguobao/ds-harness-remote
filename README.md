<p align="center">

  <img src="docs/logo.svg" alt="DeepSeek Harness Remote" width="600">
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="README.zh.md">中文</a>
  &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a>
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

Harness keeps running on your work computer, with the same workspaces, tools, and project setup. DS Harness Remote is simply another window into that environment.

The DeepSeek Harness desktop edition is supported. Install the latest release:

`ds-harness-remote@0.6.0`

## Features

- Access your local Harness instance remotely from the web, a PC, or a mobile device: DSH first, with Codex, Cursor, and Antigravity support too.
- DeepSeek Harness Desktop is ready to use after installation, with its native interface and no separate desktop conversation UI.
- Create workspaces, configure models, and switch conversation models with the same smooth workflow as local use.
- No public listening port or public IP is required on the Harness Host. Connect from anywhere with internet access over a bidirectional end-to-end encrypted channel.
- Prefer P2P connections, use TURN relay nodes worldwide, and fall back to multiple Server Relays when needed.
- Access workspace files, read-only previews, remote terminals, and authorized local development-service previews through the native Harness sidebar.
- Remote Tool context injection supports Host and workspace discovery, Harness session creation and management, history reading, waiting for execution, interruption requests, and authorized file transfers. [Details](packages/plugin/README.md#remote-agent-tools).
- Alongside DeepSeek Harness, access native workspaces for Codex, Cursor, Google Antigravity, Pi, OpenCode, Claude Code, Hermes Agent, and other tools through ACP integrations, with remote file browsing and terminals.
- Clients are available across Android, iOS, Web, and native DSH.
- Multiple clients can connect to the same Harness Host simultaneously, with RPC calls and streams isolated per connection.

## Contents

- [Connect once. Ready whenever you are](#connect-once-ready-whenever-you-are)
- [Features](#features)
- [Supported clients](#supported-clients)
- [Install](#install)
- [Quick start](#quick-start)
- [Screenshots](#screenshots)
- [How it works](#how-it-works)
- [Experimental ACP workspaces](#experimental-acp-workspaces)
- [End-to-end encryption](#end-to-end-encryption)
- [Network and transport](#network-and-transport)
- [Security](#security)
- [FAQ](#faq)
- [Documentation](#documentation)
- [Links](#links)
- [Star History](#star-history)
- [Project status and trademarks](#project-status-and-trademarks)
- [License](#license)

## Supported clients

| Client | Form | Status | Notes |
| --- | --- | --- | --- |
| DSH&nbsp;Desktop&nbsp;plugin | Remote sidebar | Supported | Install `ds-harness-remote@0.6.0`; this computer can also be the Host |
| Web | Browser page | Supported | Open [https://dsh.r2049.cn](https://dsh.r2049.cn); reuses the native Harness interface |
| Android | Native app | Supported | Download the APK from [Releases](https://github.com/liguobao/ds-harness-remote/releases/latest); see the [Android guide](apps/android/README.md) |
| DSH Go | A standout app by ccch1mneyyy | Supported | See [ccch1mneyyy/dsh-go: an Android client for DeepSeek Harness. Run it directly on your phone or control DSH on your computer remotely.](https://github.com/ccch1mneyyy/dsh-go) |
| iOS | TestFlight beta | Beta | Not publicly released; see [issue #20](https://github.com/liguobao/ds-harness-remote/issues/20) |
| Browser&nbsp;extension | Chrome | Entry point only | Exchanges an already signed-in Web authorization for a separate device credential, lists online Hosts and opens the same-origin Remote Web; it does not host a conversation UI |
| dsh-TUI | Terminal-only CLI | Supported | Can act as a Host; see the [dsh-TUI Remote guide](docs/dsh-tui.md). The installer never creates a Web service for it automatically |
| Linux | Cloud server | Supported | Sign in on the [official website](https://dsh.r2049.cn/) for unattended installation with a single command and no configuration. |

Several clients can connect to the same Host at once; RPC calls and streams are isolated per connection.

## Install

### DeepSeek Harness Desktop support

Open **Extensions / Plugin management** in DeepSeek Harness Desktop, choose installation
from npm, and enter this package:

`ds-harness-remote@0.6.0`

Restart Desktop afterward. Its official `dsh` launcher can also install the pinned package
with `dsh plugin --profile desktop add -w ds-harness-remote@0.6.0`.

### Linux one-command installation

Visit [https://dsh.r2049.cn](https://dsh.r2049.cn/), sign in, and obtain an installation authorization code to install with one command.

### dsh-TUI Host

For terminal Host setup with [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI), see the
[dsh-TUI Remote guide](docs/dsh-tui.md).

### Native Android client

Keep conversations connected across multiple workspaces at once, and use **Bot mode**, powered by [Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot).

Download the latest APK from [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest), and sign in to the same account to see your Hosts.

## DSH Go — DeepSeek Harness in your pocket: run it locally on your phone or control your computer remotely.

[ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go) has built-in support for the ds-harness-remote protocol. You can run DeepSeek Harness locally on your phone or connect to your computer remotely.

After installing the ds-harness-remote plugin in DSH Go on your phone, you can also connect to the phone’s DSH from your computer or the web and use Mobile Use seamlessly.

### iOS client

- [Join the beta](https://github.com/liguobao/ds-harness-remote/issues/20)

## Quick start

1. Open **Remote** from the DeepSeek Harness sidebar.
2. Choose Zhihu, GitHub, or Google authorization, or sign in with an account and password. Account registration requires an invitation code; email the repository author to request one.
3. On another device, install the same plugin in DeepSeek Harness and sign in as described in steps 1–2. Alternatively, use Remote Web, iOS, Android, or DSH Go directly without installing a plugin.
4. Select an online Host, then choose an existing workspace or browse remote directories to open one.

By default, Remote uses this project's hosted Server at [https://dsh.r2049.cn](https://dsh.r2049.cn).

For self-hosting, use the repository's [minimal Server](apps/server/README.md). The current version includes P2P coordination and a Relay Server, but does not provide the full hosted Remote Web experience.

## Screenshots

### Desktop

On another computer, select an online Host and open its workspace. The workspace opens in the native Harness interface, with the active Host and encrypted connection status in the header.

<p align="center">
  <img src="docs/images/host-list.png" alt="Remote workspace picker listing online Hosts" width="40%">
  <img src="docs/images/remote.png" alt="A Harness conversation running through an encrypted remote connection" width="40%">
</p>

To prevent this computer from controlling other Hosts, open the Host list at [https://dsh.r2049.cn/](https://dsh.r2049.cn/) and enable **Controlled only**. This device will no longer see other devices under your account, while Web and other clients can still connect to it remotely.

### Android

Use text or image prompts, switch models, and access supported workspace files and terminals.

The interface follows the system language and supports English, Simplified and Traditional Chinese, Japanese, Spanish, German, and French. In language settings, tap “More ...” to show all languages. See the [Android guide](apps/android/README.md) for details.

<p align="center">
  <img src="docs/images/mobile-list.jpg" alt="Android client listing online and offline computers" width="30%">
  <img src="docs/images/image-msg.jpg" alt="Sending an image prompt from the Android client" width="30%">
  <img src="docs/images/image-result.jpg" alt="Viewing the image response in the Android client" width="30%">
</p>

Mobile Settings includes a global **Compact conversations** switch, off by default and applied when a conversation is next opened.

Supporting Hosts reduce historical tool details while preserving messages and tool status. Turn the setting off and reopen the conversation to load full history.

## How it works

```text
DSH Desktop / Remote Web / Android
  ↔ authenticated, end-to-end encrypted channel
Remote Plugin on the Host
  ↔ supported Harness or optional Codex workspace support
Harness sessions/workspaces or Codex projects
```

The Harness Host does not need a public listening port. Connect from anywhere with internet access over ds-harness-remote’s bidirectional end-to-end encrypted channel.

The client switches to the selected Host’s native Harness API, keeping the original workspaces, tools, and permission flows on that computer.

Every settings namespace registered by the Host can also be configured remotely through the official Harness settings API, with full support for most plugin settings.

## Experimental ACP workspaces

The Host runs local ACP-capable Agents and forwards prompts, streamed replies, and approvals through ds-harness-remote. Each Agent keeps its own workspaces and sessions; only session translation for DSH is performed, without writing to Harness storage.

Supported backends:

- **Codex** — connected through its independent App Server interface, with the same workspace entry.
- **Cursor** — connected through the CLI's ACP interface.
- **Antigravity (AGY)** — its stream-json CLI is adapted to the ACP gateway.
- **Pi Agent (experimental)** — install `@earendil-works/pi-coding-agent` and `pi-acp` on the Host, configure Pi's provider locally; Remote automatically detects and initializes Pi unless explicitly disabled in Remote settings. The workspace is available only after ACP initialization succeeds. Uses the separate ACP data plane. Tools run with Host-user permissions; per-tool confirmation requires a Pi extension and is not enabled by default.

- **OpenCode** — connected through `opencode acp`, with workspace discovery and history recovery. Host startup checks the CLI's supported options, accepting both native-listener and stdio-only ACP builds. Native session archiving on Desktop/Android requires the authenticated loopback API; builds without it report archiving unavailable. Archive state is saved by OpenCode; history is retained. Unarchive is not yet exposed.
- **Claude** — uses a locally authorized `claude-agent-acp` on the Host; enable it in Remote settings. Desktop/Android support workspaces, history, text prompts and approvals. Image input and direct Files/Terminal access are not available.
- **Hermes** — runs Nous Research's Hermes Agent through its own ACP server (`hermes acp`); opt-in in Remote settings. Desktop/Android support workspaces, history, streamed thinking and tool output, text prompts, approvals and model selection. Image input and direct Files/Terminal access are not available.

Setup and adapter development: [Agent workspace integration guide](docs/acp-integration.md).

Model selection for Cursor, Claude, Hermes, Pi, OpenCode, and AGY on Desktop/Android uses the Host's actual model catalog as determined by the Agent’s ACP interface.

Reasoning effort options depend on what the backend provides. Cursor uses a separate process per session, so model changes do not affect other conversations.

## End-to-end encryption

Harness business traffic is encrypted on the Client and decrypted only by the selected Host using the fixed `Noise_IK_25519_ChaChaPoly_SHA256` suite.

Connections must pass both same-account membership and locally pinned device identity key checks.

The service can coordinate connections and observe necessary network metadata, but it cannot read session messages, prompts, tool output, workspace paths, or remote file contents.

See [End-to-end encryption](docs/end-to-end-encryption.md) for the handshake, key lifecycle, visible metadata, replay protection, and security limits.

## Network and transport

The Host opens outbound connections only; it does not listen on a public port or require router port forwarding.

Remote negotiates paths in the order `LAN -> P2P -> TURN -> Relay`.

When WebRTC is unavailable or cannot connect, it falls back to the encrypted WebSocket Relay.

Every path carries the same Noise ciphertext and keeps the same Host/Client identity boundary.

See [Network and transport](docs/network.md) for the topology, control and data planes, NAT behavior, fallback, reconnect semantics, and current validation status.

## Security

- On LAN and P2P paths, data bypasses the Server except for connection coordination. TURN uses the open-source coturn server; Relay mode forwards traffic over WebSocket.
- Session traffic is end-to-end encrypted. The service relays ciphertext without storing session plaintext or device private keys.
- Server membership and the Host's locally pinned peer identity must both authorize a connection.
- [Remote Tools injection](docs/remote-tools.md) — optional `remote_*` session tools; enabled by default and configurable in detailed Remote settings.

- Interactive terminals use the Host-local `terminal.enabled` switch (on by default). They run as the Host user, independently of Agent approvals.
- General tool RPC and remote desktop are not exposed.
- The workspace picker lists folders only and returns bounded, read-only directory metadata.
- Remote file preview cannot write, delete, upload, execute, or open a path in an external application.
- Codex Remote / Agent ACP is optional, can be disabled, and follows the same encrypted Host permission boundary as the rest of Remote.
- Removing a device revokes its credentials, membership, and active Remote connections.

## FAQ

**Do I need a public IP or port forwarding?**

No. The Host only opens outbound connections and never listens on a public port.

**Can the service read my conversations?**

No. The service relays ciphertext only. Routing, authorization, presence and rate limiting require control metadata such as account and device ownership, online status, connection times and `connectionId`; prompts, conversation content, tool input and output, workspace paths and file preview contents stay unreadable.

**Which machine can act as a Host?**

Any signed-in Harness instance with the Remote plugin installed can act as a Host, whether on Windows, macOS, Linux, or even DSH Go.

**Can several devices connect to one Host at the same time?**

There is currently no limit on concurrent client connections, with RPC calls and streams isolated per connection.

**Which Harness versions are supported?**

The current baseline is `dsh-v0.2.1-rc.5`, compatible with `0.2.0` rc.2 / rc.1. See the [compatibility guide](docs/compatibility.md).

Harness `0.1.1-rc.2` ApiProxy support has been removed from the Host plugin, its bundled Remote client, and Android. Use a Host with the official Typert Remote carrier; Hosts that only provide ApiProxy or lack capability discovery are rejected, with no fallback.

CodeX/ACP keep their independent data planes, and Desktop projections use Typert in memory.

**Why does the Linux installer require root?**

It configures a systemd system service, so the Host, Agent tools and remote terminals run with root privileges. Only expose it to trusted accounts.

**Can I install the iOS app directly?**

It is in TestFlight beta today and not publicly released; see [issue #20](https://github.com/liguobao/ds-harness-remote/issues/20).

**How is this different from frp, a tunnel, or remote desktop?**

Conventional server-based TCP port forwarding routes traffic through a Server, making its bandwidth a potential bottleneck.

This project probes four connection modes in sequence to establish P2P connections even in complex network environments.

Remote desktop captures the entire computer screen and reproduces it on the client, placing demands on upload and download bandwidth as well as computer performance.

This project encrypts and transmits only the messages needed by the native Harness conversation interface. General tool RPC and desktop control are not exposed, and permissions and approvals remain on the Host.

Tailscale, CF Turn, and UU Remote are also excellent solutions; choose whichever fits your needs.

## Recommended plugins

### Intelligent UI

[Intelligent UI](https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui) lets models answer with cards, tables, charts, and forms. The Android client renders them natively and lists the plugin under **Plugins → Remote ready**, where you can enable or disable it and edit live settings.

### [Fei2411/DS-Bot](https://github.com/Fei2411/DS-Bot)

DS Bot is a bot plugin for DeepSeek Harness (dsh) that turns dsh into a bot. You can chat and work with the bots you create.

## Documentation

- [Plugin guide](packages/plugin/README.md)
- [Installation guide](docs/installation.md)
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
- [Android guide](apps/android/README.md)
- The current development baseline is `dsh-v0.2.1-rc.5`; validation scope is documented in [the compatibility guide](docs/compatibility.md).

## Links

- Friendly link: [DSH Go](https://github.com/ccch1mneyyy/dsh-go) — DeepSeek Harness in your pocket: run it locally on your phone or control your computer remotely. Remote integration is available.
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
