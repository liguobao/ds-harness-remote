# dsh-TUI Remote Host API plan

Status: WSL Host smoke test complete. Android acceptance remains open for [issue #290](https://github.com/liguobao/ds-harness-remote/issues/290).

## Problem

The dsh-TUI profile can load the Remote Host entry without the Host Remote API suite.
Relay and Noise then connect, but Harness RPC calls cannot complete.
The Android client retries the connection.

Issue #290 reports a working manual profile patch.
The patch adds the Host Remote API packages to the dsh-TUI composition.
The maintainer plans to restore dsh-TUI support in a separate package after version 0.6.3.

## Release boundary

Keep the current browser and Desktop Host entry unchanged.
Add a separate dsh-TUI entry in a later release.
Do not activate two Host entries with the same device identity in one profile.
Do not claim that dsh-TUI works until a real profile passes the checks below.

## Implementation steps

1. Define the dsh-TUI package and its profile patch.
2. List the official Host API packages that the patch must load.
3. Check that the profile provides `connection`, `typertGateway`, and the Host Remote event source.
4. Report a missing service before the Host advertises usable Remote access.
5. Use the existing `ds-harness-remote` CLI for terminal login and status.
6. Keep the existing Remote authentication and peer ownership checks.

The package list needs a check against the selected Harness version.
The current list in issue #290 comes from a 0.2.1 profile.
The 0.2.2 package graph may require a different list or load order.

## Acceptance checks

- A clean dsh-TUI profile loads the package without manual patch edits.
- Host status reports the Remote API as available only when the API suite is active.
- Android opens a Harness workspace, session, and event stream over an encrypted connection.
- Prompt, approval, disconnect, and reconnect work with one Host process.
- A missing Host API package produces a clear startup error.
- The browser and Desktop Host still load one Remote entry.
- The test report records Harness, Plugin, dsh-TUI, Android, Node.js, and transport versions.

## WSL Host validation (2026-11-09)

The test used an isolated `DSH_HOME` and a local self-hosted Server.
The Host ran Harness `0.2.2-rc.1`, dsh-TUI `0.19.0`, and Node.js `24.15.0`.
The TUI package version was `0.1.0-alpha.0` from a local tarball.
The Server version was `0.5.21` from this repository.
The Server had no STUN or TURN configuration.

- The clean profile loaded the official Host API entries from the TUI package patch.
- The first patch left `session-controller` waiting for `fileUploads`.
- The corrected patch loaded `connection` and `file-upload` before the Remote entry.
- The corrected profile started without pending Host API entries.
- The Host connected to the local Server after account authorization.
- A separate Client identity listed one online Host.
- The Host control connection recovered after the Server stopped and restarted.
- A disabled `dsh-api-remotes` entry produced a clear startup error.
- The disabled entry kept the Host offline.

The test used `HostServerApi.authorizeWithAccount` for the local Server.
The `ds-harness-remote` CLI selects the public default Server.
This test did not use that CLI for local account authorization or status.
The TUI profile also warned about two missing optional TUI tool entries.
Those entries were `tool-ralph` and `tool-subagent-list-agents`.

Android workspace, session, event, prompt, approval, and reconnect checks remain open.
The separate TUI package also needs a release path.
