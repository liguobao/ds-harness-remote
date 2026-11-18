# Compatibility

## Current baseline

| Component | Scope |
| --- | --- |
| Remote | Source version 0.6.5; Android versionCode / Expo iOS buildNumber 72. This does not establish publication status |
| Harness development baseline | 0.2.2-rc.1, Node.js >=24.9 |
| Older Harness | Official Typert / Session V3 paths for 0.2.1-rc.5 and 0.2.0-rc.2 / rc.1 |
| Peer range | 0.2.1 / 0.2.2 prereleases and stable versions; range acceptance is not runtime validation of every version |
| TUI | Matching standalone `ds-harness-remote-tui`; core Android Relay flow validated with dsh-TUI 0.20.1 + Harness 0.2.2-rc.1 |
| DS-Bot | Fixed named routes aligned with 0.3.6; route coverage is not full mobile E2E coverage |

Enable only one Remote Host entry per TUI profile. Use the `ds-harness-remote` CLI for authorization. See the [bundle instructions](../packages/tui/README.md).

## Harness carrier and attachments

The Host, bundled Remote Client and Android use the official Typert carrier. Hosts without capability discovery or with only the early ApiProxy carrier are rejected. The retired custom `sessions.*`, `session.send`, `permissions.respond` and `sync.from` RPCs are not restored. Legacy branches in the independent VS Code client do not imply current Host support.

- Harness 0.2.2 requires the complete `ImageAttachmentRef`; Android retains byte length and dimensions. The Host bridge sends attachmentId to older Harness. An older client unable to supply the verified reference is explicitly rejected by the new official Gateway.
- Virtual `session/control` sends both legacy key/value and new changes; virtual `session/page` includes cursor and accepts `session/events`.
- Local carriers require a live official owner Peer. Missing Peer or event services must fail explicitly; the standalone TUI bundle composes the official Remote APIs.
- Both negotiated capability and `workspaceTypes.available` must permit a backend. Discovering a command or enabling a setting does not prove login or readiness.

## CodeX, ACP and platforms

CodeX uses its independent App Server domain. Cursor, AGY, Pi, OpenCode, Claude and Hermes use the ACP gateway. Catalog, models, tools and history depend on the actual CLI; see [backend integration](acp-remote.md). A failed backend never falls back to a different backend.

OpenCode v1 native archive requires its authenticated private HTTP API. Pure stdio / v2 builds without that API return unavailable; deletion must not substitute for archive. See the [archive design](acp-remote.md#opencode-与原生归档).

Credential locking targets Linux single-host local ext4/XFS. NFS, SMB and cross-host shared directories are unsupported. Windows Host lock recovery, native iOS, complete backend/approval flows and long network runs remain in [TODO](TODO.md). Stop every Harness process before upgrade or downgrade; see [migration and 0.6.3 downgrade instructions](plugin-integration.md).

Core TUI checks cover session discovery, bidirectional messages, history, file preview/upload, terminal and App restart recovery. They do not cover every TUI command, real approval or other version combinations.
