## Compatibility

## Current compatibility targets (2026-10-09)

The development baseline is `dsh-v0.2.1-alpha.1`, retaining the previous `dsh-v0.2.0-rc.2` (and rc.1) official Typert / Session V3 carrier. Peer ranges explicitly admit `0.2.1` and `0.2.2` prereleases and stable releases. A future `0.2.2` RC with the same official carrier contract requires no version-only package edit; that future runtime has not been validated.

Legacy rc.2 ApiProxy is no longer a compatibility maintenance target. Existing implementations and historical types remain, but this change does not upgrade or extend their APIs. Older Typert/settings branches are outside this validation scope.

Timed questions claim `userQuestions/attachWait`, return foreground answers or `ASK_TIMED_OUT` through `$events/result`, and recover late replies only from the official `userQuestions` projection. Late replies use `userQuestions/answer`; disconnect never replays answers. The previous RC's indefinite question flow retains its existing event path.

Optional Claude Code Mods expose only `claudeCodeMods/watchBand` / `pressBand`. Remote status SSE uses document-relative URLs like the official RPC carrier, preserving a reverse proxy path prefix. The proxy must still strip that prefix and configure trusted authority as documented by Harness.

## Historical implementation (not current maintenance targets)

**Breaking change notice:** Plugin `0.4.1` removes the earlier experimental
Remote business RPC surface (`sessions.*`, `session.*`, `permissions.respond`,
`sync.from`). Harness session traffic now only uses the official rc.2
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
