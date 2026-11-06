# dsh-TUI Remote Host API plan

Status: Draft for [issue #290](https://github.com/liguobao/ds-harness-remote/issues/290).

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
5. Restore the terminal login, status, and logout commands in the separate package.
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

## Open design decisions

- Choose the separate package name and publish path.
- Choose the owner of the official Host API package list.
- Decide how the package detects an absent Remote event source without private Gateway fields.
