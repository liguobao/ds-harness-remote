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

Continue using your DeepSeek Harness instance from a phone, computer, or browser.

Return to the same Harness session from whichever device is with you. Harness keeps running on your work computer, with the same workspaces, tools, and project setup. Remote is simply another window into that environment.

The DeepSeek Harness desktop edition is supported. When installing manually, use this pinned
plugin version through DSH's plugin manager:

`ds-harness-remote@0.4.27`

## Features

- Continue active sessions and review their latest progress from another device
- Send new instructions, change direction, and use image prompts with supported Harness versions from `dsh-v0.1.1-rc.2` through `dsh-v0.2.0-rc.2`
- Answer questions and permission requests from clients with live conversation controls
- Support the DeepSeek Harness desktop edition with pinned Remote plugin releases
- Open workspaces from another authorized computer on the same account
- Reuse the native Harness interface instead of maintaining a separate desktop conversation UI
- Run a terminal-only [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) profile as a Host and authorize it with a GitHub or Zhihu QR code
- The Harness Host does not need a public listening port. Connect securely from anywhere with internet access over a bidirectional end-to-end encrypted channel
- Native workspace files, read-only previews, terminal access, and authorized local development-service previews are available through the Harness sidebar.

## Install

### DeepSeek Harness Desktop support

Remote supports the DeepSeek Harness desktop edition. Use this pinned plugin version through the
command-line installation below:

`ds-harness-remote@0.4.27`

### dsh-TUI Host

For terminal Host setup with [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI), see the
[dsh-TUI Remote guide](docs/dsh-tui.md).

### Command-line installation

Add the exact package version through DSH's plugin manager for the `web` profile:

```sh
dsh plugin --profile web add -w ds-harness-remote@0.4.27
```

`-w` targets the profile's own workspace root. It is required on pnpm below 11, which
otherwise refuses the add with `ERR_PNPM_ADDING_TO_ROOT`.

Restart Harness after installation.

Do not install this package directly with npm. Only `dsh plugin` updates the selected profile and
adds the bundle's configuration layer.

### Android client

Download the latest Android APK from [GitHub Releases](https://github.com/liguobao/ds-harness-remote/releases/latest).

Sign in to the Android client with your existing account, select an available computer, and open a workspace. Continue the conversation with text or image prompts; the conversation toolbar also lets you switch the active model and choose any reasoning effort declared by it.

Tap **Prompts** beside the composer's `+` button to open the saved prompt list, then tap a prompt to send it. Edit prompts in the same panel. Files, Terminal, and Trajectory remain under `+` → **Tool access**.

### Automated installation (background service)

Install Remote Host as a background service. For service management, login, directory settings,
and uninstallation, see the [installation guide](docs/installation.md).

macOS / Linux:

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell (run as administrator):

```powershell
$installer = "$env:TEMP\install.ps1"
Invoke-WebRequest -UseBasicParsing https://dsh.r2049.cn/app/install.ps1 -OutFile $installer
& $installer
```

## Quick start

1. Open **Remote** from the Harness sidebar.
2. Sign in with a GitHub or Zhihu QR code, or use your account and password. New password accounts can register through [Remote Web](https://dsh.r2049.cn/app/register); the site shows the current invitation requirements.
3. The Host starts with control of the current computer enabled. Remote terminal access is also enabled by default; you can turn it off in the detailed Remote settings.
4. On another device, open the DeepSeek Harness desktop edition, Remote Web, or the Android client and sign in to the same account.
5. Select the online Host, then choose an existing workspace or browse remote directories to open one.

The public service uses the hosted Remote relay. For a minimal single-account deployment,
see the [self-hosted Server](apps/server/README.md); its Web page shows device status only.

## Minimal self-hosted Server

Run the optional single-account Relay Server in [`apps/server`](apps/server/README.md). Set `DSH_SERVER_ACCOUNT` and `DSH_SERVER_PASSWORD`; its small Web page offers login and device status. Point both Host and Client at your Server URL and sign in with the same account. Device credentials survive restarts.

## Screenshots

### Desktop

The current computer starts with **Allow control of this device** enabled and is available
as a Host.

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

Sign in to the Android client with your existing account, select an available computer,
open a workspace, and continue the conversation with text or image prompts. The conversation
toolbar also lets you switch the active model and choose any reasoning effort declared by it.

Harness conversations open **Files** (workspace folders and paged read-only UTF-8 previews) and **Terminal** from the conversation title bar. These require the native APIs in DSH `0.1.6-alpha.2` or later (including `0.1.7-rc.1` and `0.2.0-rc.2`) and an updated Remote Host plugin. Remote terminal access is enabled by default and can be turned off in the Host's detailed Remote settings. The Terminal panel lists the terminals owned by this device and creates a new one only when you tap ＋ in its title bar; opening the panel never creates a terminal. Android restores terminals from the Host snapshot; it never replays input after disconnect. In Files, Back returns from a file to its directory and closes the tool only at the workspace root; refresh also sits in the title bar. These tools are not exposed for CodeX conversations.

The permission selector supports both older inline options and the separate `permissionPresets/catalog` used by newer DSH 0.1.6 builds. Update the Host Remote plugin too; unsupported Hosts show an actionable error instead of fabricated permission options.

Android Files also previews PNG/JPEG/GIF/WebP images and PDF documents, plus DOC/DOCX/XLS/XLSX/PPT/PPTX when the Host provides `officeToPdf`. Binary previews are limited to 8 MiB (Office sources: 50 MiB). PDF rendering is bundled locally, with no CDN, external viewer, or file export. Unknown binary types are not treated as text. All access remains read-only and authorized by the official Session filesystem; native-device and cross-device preview validation is still pending.

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

## Experimental Agent ACP / Cursor workspaces

Remote can also open Host-local Cursor Agent sessions through a backend-neutral Agent ACP gateway
(`agent.acp.*`). Desktop reuses the native Workspace / Session / Composer shell; Android uses an
in-memory Cursor workspace projection. Text prompts, streaming thought/message updates, cancel, and
one-shot approvals are supported. Cursor image prompts are not supported. AGY workspaces accept
PNG/JPEG/WebP/GIF images (8 MiB each, up to four per prompt) through a private Host temporary cache.
AGY reads these files with its image tool; cached images can be restored with conversation history
for up to 24 hours, unless the system clears temporary files earlier.

ACP backends initialize in the background, so AGY/Cursor startup does not delay Harness Remote
registration or Client initialization. `acp.enabled` gates the domain; each supported entry in
`acp.backends` uses its own `enabled`, `command`, `args`, and optional `cwd`. Currently the gateway
implements `cursor` and `antigravity`; other registry entries do not launch or advertise an adapter.
An explicitly selected disabled or unavailable backend fails without routing to another backend.
Configuration changes require a DSH restart.

The Cursor adapter is **off by default**. Enable `cursor.enabled` in DeepSeek Remote settings, finish
`agent login` (or set `CURSOR_API_KEY`) on the Host, and restart DSH. Details:
[Agent ACP / Cursor adapter notes](docs/cursor-remote.md).

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

## Security

- Session traffic is end-to-end encrypted. The service relays ciphertext without storing session plaintext or device private keys.
- Server membership and the Host's locally pinned peer identity must both authorize a connection.
- Interactive terminals use the Host-local `terminal.enabled` switch (on by default). They run as the Host user, independently of Agent approvals. General tool RPC and remote desktop remain unavailable.
- The workspace picker lists folders only and returns bounded, read-only directory metadata.
- Remote file preview cannot write, delete, upload, execute, or open a path in an external application.
- Codex Remote is optional, can be disabled, and follows the same encrypted Host permission boundary as the rest of Remote.
- Agent ACP / Cursor is optional and off by default; it follows the same encrypted Host permission boundary and a fixed method allowlist.
- Removing a device revokes its credentials, membership, and active Remote connections.

## Documentation

- [Plugin guide](packages/plugin/README.md)
- [dsh-TUI Remote guide](docs/dsh-tui.md)
- [Codex Remote technical notes](docs/codex-remote.md)
- [Agent ACP / Cursor adapter notes](docs/cursor-remote.md)
- [Documentation index](docs/README.md)
- [End-to-end encryption](docs/end-to-end-encryption.md)
- [Network and transport](docs/network.md)
- [Remote Protocol](docs/protocol.md)
- [Development status and roadmap](TODO.md)
- Remote compatibility details are maintained in [the compatibility guide](docs/compatibility.md).

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

Android also supports AGY workspaces through the independently enabled Antigravity ACP backend:
Host catalog discovery, new conversations, durable history, live replies, title refresh, reconnect,
and text/image prompts. PNG/JPEG/WebP/GIF images are limited to 8 MiB each and four per message;
images use the Host's private temporary cache. See [Android notes](apps/android/README.md#agy-workspaces)
for validation limits.
