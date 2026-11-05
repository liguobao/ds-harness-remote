## Compatibility

## Current compatibility targets (2026-11-05)

The development baseline is `dsh-v0.2.2-rc.1`, retaining `dsh-v0.2.1-rc.5` (and `0.2.0-rc.2`/rc.1) on the official Typert / Session V3 carrier. Peer ranges admit the `0.2.1` and `0.2.2` alpha/beta/RC and stable releases; this round adapts and locally validates the `0.2.2-rc.1` release.

What the 0.2.2 adaptation covers:

- The development baseline moves to `0.2.2-rc.1` with Cordis `4.1.0`, Loader `1.1.0`, Include `1.1.0` and Node.js `>=24.9` (the 0.2.2 engine requirement). CI, the private runtime in `scripts/install.sh` and the installation docs move to Node.js 24.9.0.
- 0.2.2 changes the `session/attachment` request from `attachmentId` to the full `ImageAttachmentRef` (the Host verifies format, byte length and dimensions). Android sends the full reference; the Host bridge normalizes by running Harness version: older Hosts receive the durable id, while a legacy client talking to a 0.2.2 Host is rejected explicitly by the official Gateway because the verified fields cannot be supplied.
- 0.2.2 changes `session/control` projection updates to `{ seq, changes: [{ key, val }] }`. The CodeX/ACP virtual sessions send both old and new fields so 0.2.0–0.2.2 official clients apply them; the virtual `session/page` result now carries `cursor` and accepts the `session/events` alias.
- The virtual `session/attachment` request also carries the full reference in 0.2.2; the CodeX/ACP virtual carriers accept both shapes.
- The fixed Remote Host allowlist adds the endpoints the 0.2.2 official client calls: `toolResults/watch`, `schedule/edit`/`run`/`deleteInactive`/`deliveryLimits`, `pluginManager/listVersions`/`readBundleDetail`/`updateBundle` and `session/events`. `pluginManager/updateBundle` lets trusted devices update third-party bundles but never the Remote plugin itself (or a bundle containing it).
- The other 0.2.2 Session changes (optional projection summaries, passive `session/follow` `activate`, optional `session/page.throughSeq`) are additive; existing Remote clients and `remote_*` tools keep working.
- The 0.2.2 Gateway requires a live calling Peer on every local carrier; a peerless `$events` open fails with a `TypeError` and makes Desktop clients reconnect-loop. Host activation now always prepares an owner Peer (official `Peer`/`OperatorPeer` first, then the official Connection service `createPeer`), and peerless local opens use that shared fallback or fail with an actionable error.

Validation: Plugin check, 72 files / 527 tests, production build and DSH bundle verification pass; Android check and 54 files / 520 tests pass. A separate DSH 0.2.2-rc.1 instance with this repository's open-source Server and the installed plugin also passed Host activation, Web UI rendering, control-plane/settings reads and writes, and opening a Remote workspace. Real Desktop/Android APK, encrypted cross-device E2E and the new 0.2.2 UI still lack manual acceptance; Remote copy for the six new official UI languages remains to be added.

The Remote Plugin baseline and the dsh-TUI baseline are separate. The current public dsh-TUI `0.17.0` release lists `dsh-v0.2.1-rc.3` as its primary compatibility line, so this repository does not claim dsh-TUI `0.17.0` plus the new Harness baseline as runtime-validated.

## Current compatibility targets (2026-10-25)

The development baseline is `dsh-v0.2.1-rc.5`, retaining the previous `dsh-v0.2.0-rc.2` (and rc.1) official Typert / Session V3 carrier. Peer ranges explicitly admit `0.2.1` and `0.2.2` prereleases and stable releases. A future `0.2.2` RC with the same official carrier contract requires no version-only package edit; that future runtime has not been validated.

The Remote Plugin baseline and the dsh-TUI baseline are separate. The current public dsh-TUI `0.17.0` release lists `dsh-v0.2.1-rc.3` as its primary compatibility line, so the dsh-TUI `0.17.0` plus Harness `0.2.1-rc.5` pairing is not claimed as runtime-validated here.

Harness `0.1.1-rc.2` ApiProxy support has been removed from the Host plugin, its bundled Remote client, and Android. Use a Host with the official Typert Remote carrier; ApiProxy-only Hosts and missing capability discovery are rejected. CodeX/ACP keep their independent data planes and use Typert for Desktop projection. This change does not update the standalone VS Code client or the independent Remote Web repository.

Timed questions claim `userQuestions/attachWait`, return foreground answers or `ASK_TIMED_OUT` through `$events/result`, and recover late replies only from the official `userQuestions` projection. Late replies use `userQuestions/answer`; disconnect never replays answers. The previous RC's indefinite question flow retains its existing event path.

Optional Claude Code Mods expose only `claudeCodeMods/watchBand` / `pressBand`. Remote status SSE uses document-relative URLs like the official RPC carrier, preserving a reverse proxy path prefix. The proxy must still strip that prefix and configure trusted authority as documented by Harness.

Each authenticated Remote connection owns an official RC.1 owner Peer. RPCs, event replies, streams and plugin Fetch routes share that Peer, which is disposed on disconnect; one Peer cannot answer another Peer's event stream. The fixed Remote allowlist remains authoritative and now includes read-only `remoteAccess/follow`.

The native RC.1 `terminal/attach` duplex stream is translated locally to the existing Remote `follow/write/resize` subset, then back to the official Host attach stream. Android and older clients keep their current protocol. Input is bounded and acknowledged only after the Host ack, preserving device ownership, connection input rights and no replay after disconnect. Older Host and CodeX/ACP terminal environments supply the RC.1 input buffer limit. `session/projections` supports the new result discriminator; CodeX/ACP projections read only their own memory/history.

Validation covers the actual RC.1 npm Gateway/Peer implementation, core terminal state transitions, workspace type checks, automated tests, production builds (including Android Hermes export) and DSH bundle verification. Desktop UI, Android APK/device, independent Remote Web and encrypted cross-device E2E acceptance remain pending.

2026-10-17 boot compatibility fix: the RC.1 theme reads new font fields directly. A valid `ui-theme` section from a `0.2.0-rc.2` Host lacks those fields, causing `undefined.split` during theme initialization and blocking dependent modules. Remote fills absent display defaults in settings reads and successful write responses, preserving Host schemas, revisions, persistence and write authorization. The older Host may still reject unsupported new font settings. The installed official RC.1 theme bundle reproduced the failure and passed initialization with the corrected view, including validation against the old schema and response preservation checks. Plugin check/build, 20 related Gateway tests and bundle verification passed; actual cross-device boot recovery remains unverified.

## Historical implementation (not current maintenance targets)

**Breaking change notice:** Plugin `0.4.1` removes the earlier experimental
Remote business RPC surface (`sessions.*`, `session.*`, `permissions.respond`,
`sync.from`). In that release, Harness session traffic used the official rc.2
`ApiProxy` or the v0.1.2 Typert Remote Gateway, and this plugin does not provide
an adapter or wire-format translation for the old RPC surface.

Plugin `0.5.0` targets DeepSeek Harness `dsh-v0.2.0-rc.2` and retains compatibility with `dsh-v0.1.7-rc.1`, while also supporting `dsh-v0.1.6-alpha.2` and earlier settings hosts. It supports `dsh-v0.1.1-rc.2` through the legacy
official `ApiProxy`, and `dsh-v0.1.2-alpha.1`–`rc.1` through the
official Typert Remote Gateway. It also supports
`dsh-v0.1.5-rc.1`, `dsh-v0.1.6-alpha.1`, and `dsh-v0.2.0-rc.2` Session V3 through the official Typert Remote
Gateway; a `0.1.6` Host reports patch `6` and therefore selects the same Session V3
profile with no wire-format adapter. A `0.4.13` Client running rc.2 remains compatible
with older rc.2 Hosts through the legacy capability fallback. `0.5.0` also reads the
running Harness version from the 0.2.0 Desktop shell's `@deepseek-ai/dsh-desktop-host`
entrypoint as well as from the CLI entrypoint, so Hosts started by the current Desktop app
keep reporting `harnessVersion` and the version-gated workspace compatibility paths
(legacy `workspaceFiles/changes`, byte-range reads) stay active.

Remote Web/Desktop and the Android app also normalize released sessions that
still report the retired `code` agent preset to `ptc`, so old sessions can
resume on `dsh-v0.1.5-rc.1` or `dsh-v0.1.6-alpha.1` without changing DeepSeek Harness itself.

Desktop endpoints must use a compatible Harness carrier. Plugin `0.5.0` selects the legacy
ApiProxy path for rc.2 Hosts when that Host exposes it, and Session V3 Desktop clients can open
legacy v0.1.2 Typert Remote Hosts through Remote-side history and event normalization. Legacy
Typert clients still reject Session V3 Hosts before switching the native UI or mutating a Workspace.

In `0.5.0`, `workspaceTypes` remains an optional addition to the authenticated transport description. Harness and CodeX clients that do not consume this field keep using the existing capabilities. When a Host supplies it, Desktop and Android require a matching negotiated capability and an available type before entering that workspace; declarations cannot enable an unnegotiated API. ACP uses independent Cursor/AGY capabilities and workspace IDs, with no migration of unpublished ACP configurations or workspace identifiers.
