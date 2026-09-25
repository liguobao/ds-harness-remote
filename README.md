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
  <a href="apps/server/README.md">Self-hosting</a>
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
- Send new instructions, change direction, and use image prompts with supported Harness versions from `dsh-v0.1.1-rc.2` through `dsh-v0.1.6-alpha.1`
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

### Path B: Automated installation

macOS / Linux:

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell (Run as administrator):

```powershell
irm https://dsh.r2049.cn/app/install.ps1 | iex
```

Follow [Quick start](#quick-start) to sign in. See the [installation guide](docs/installation.md) for configuration, service management, and uninstallation.

### Path C: Existing DSH installation

Add the exact package version through DSH's plugin manager for the `web` profile:

```sh
dsh plugin --profile web add -w ds-harness-remote@0.4.17
```

`-w` targets the profile's own workspace root. It is required on pnpm below 11, which
otherwise refuses the add with `ERR_PNPM_ADDING_TO_ROOT`.

Restart Harness after installation.

Do not install this package directly with npm. Only `dsh plugin` updates the selected profile and
adds the bundle's configuration layer.

### Path D: dsh-TUI Host

For terminal Host setup with [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI), see the
[dsh-TUI Remote guide](docs/dsh-tui.md).

## Quick start

1. Open **Remote** from the Harness sidebar.
2. Sign in with a GitHub or Zhihu QR code, or use your account and password. New password accounts can register through [Remote Web](https://dsh.r2049.cn/app/register); the site shows the current invitation requirements.
3. Enable remote control for the current computer.
4. On another device, open DSH Desktop, Remote Web, or the Android client and sign in to the same account.
5. Select the online Host, then choose an existing workspace or browse remote directories to open one.

The public service uses the hosted Remote relay. For a minimal single-account deployment,
see the [self-hosted Server](apps/server/README.md); its Web page shows device status only.

## Authorization recovery and multiple instances

Each running Host needs its own device identity. Profiles sharing the same `DSH_HOME`
share Remote credentials; use a separate `DSH_HOME` and authorize each instance if
both must stay online. When another connection replaces this Host (`CONNECTION_REPLACED`),
automatic reconnect stops to prevent the two instances from repeatedly disconnecting each other.

Expired credentials refresh under a cross-process lock. If the Server rejects a
handshake, the Host can refresh and retry it once. If refresh is rejected, use
`/remote login [github|zhihu]` or authorize the Host again in Remote settings.
The log marks refresh failures with `phase: credential_refresh` without exposing credentials.

`SERVER_CREDENTIALS_BUSY` means another process holds the refresh lock. After an
abnormal exit, stop **all** instances sharing that `DSH_HOME`, remove only the
`server-credentials.json.refresh-lock` directory beside the affected credentials
under `remote/servers/<serverHash>/<role>/`, then authorize again and restart.
Locks are never taken over based on age: a suspended process could still use the old token.

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

Harness conversations open **Files** (workspace folders and paged read-only UTF-8 previews) and **Terminal** from the conversation title bar. These require the native APIs in DSH `0.1.6-alpha.2` or later (including `0.1.7-rc.1`) and an updated Remote Host plugin. Enable **Remote terminal** in the Host's local Remote settings before opening a shell. The Terminal panel lists the terminals owned by this device and creates a new one only when you tap ＋ in its title bar; opening the panel never creates a terminal. Android restores terminals from the Host snapshot; it never replays input after disconnect. In Files, Back returns from a file to its directory and closes the tool only at the workspace root; refresh also sits in the title bar. These tools are not exposed for CodeX conversations.

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
- Interactive terminals require the Host-local `terminal.enabled` switch (off by default). They run as the Host user, independently of Agent approvals. General tool RPC and remote desktop remain unavailable.
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

Plugin `0.4.17` supports DeepSeek Harness `dsh-v0.1.1-rc.2` through the legacy
official `ApiProxy`, and `dsh-v0.1.2-alpha.1`–`rc.1` through the
official Typert Remote Gateway. It also supports
`dsh-v0.1.5-rc.1` and `dsh-v0.1.6-alpha.1` Session V3 through the official Typert Remote
Gateway; a `0.1.6` Host reports patch `6` and therefore selects the same Session V3
profile with no wire-format adapter. A `0.4.13` Client running rc.2 remains compatible
with older rc.2 Hosts through the legacy capability fallback.

Remote Web/Desktop and the Android app also normalize released sessions that
still report the retired `code` agent preset to `ptc`, so old sessions can
resume on `dsh-v0.1.5-rc.1` or `dsh-v0.1.6-alpha.1` without changing DeepSeek Harness itself.

Desktop endpoints must use a compatible Harness carrier. Plugin `0.4.17` selects the legacy
ApiProxy path for rc.2 Hosts when that Host exposes it, and Session V3 Desktop clients can open
legacy v0.1.2 Typert Remote Hosts through Remote-side history and event normalization. Legacy
Typert clients still reject Session V3 Hosts before switching the native UI or mutating a Workspace.

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

## Minimal self-hosted Server

Run the optional single-account Relay Server in [`apps/server`](apps/server/README.md). Set `DSH_SERVER_ACCOUNT` and `DSH_SERVER_PASSWORD`; its small Web page offers login and device status. Point both Host and Client at your Server URL and sign in with the same account. Device credentials survive restarts.

## Native sidebar and development previews

Harness `0.1.6-alpha.2` and later workspace files and read-only previews use the official APIs; the existing dsh-file-viewer bridge remains available. The Remote Host activates on both host generations: the ≤`0.1.6` settings-registry path and the `0.1.7-rc.1` Volatile entry path are feature-detected at runtime, so one package covers both.
Reads follow the Host Session filesystem permissions, including authorized files outside cwd; directory listings stay within the workspace.
These native sidebar features target Harness Sessions, not the CodeX in-memory projection.

On the **Host computer → Remote plugin settings**, toggle **Remote terminal** (it saves and applies immediately), then enter **Remote preview ports** and use the adjacent **Save access settings** button. Both runtime access controls apply without restarting the Host.

Terminal access defaults off and reports how to enable it when attempted. This switch does not fix ordinary login or connection errors.
Terminals run as the Host user independently of Agent approvals. Only terminals created by the current Remote device are exposed; input is never replayed after disconnect.

In Desktop or a browser connected to Harness on the same computer, choose **Preview service** in the Remote header and enter an authorized port.
The native browser sidebar opens the Host's IPv4 `127.0.0.1` HTTP service through P2P or Relay, including WebSocket and same-origin hot reload.
Relative asset paths are preserved. IPv6-only services must also listen on `127.0.0.1`.
Previews use separate random local origins and close on disconnect or leaving Remote. Remote Web pages, Android and VS Code preview UIs are not included.
No ports are allowed by default. Authorized services may accept writes: this is not read-only HTTP access.
Arbitrary network destinations, CONNECT, HTTPS upstreams, cross-origin redirects and hard-coded remote localhost URLs are unsupported.
Request bodies are capped at 1 MiB and responses at 64 MiB. Access settings can only be changed locally on the Host.
