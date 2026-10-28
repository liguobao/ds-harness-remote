# WSL protocol security validation

Date: 2026-10-28.
Branch: `fix/protocol-security-validation`.

## Scope

This work checks protocol boundaries in the current repository.
The full Server and Remote Web use a separate repository.
Local WebSocket tests do not establish cross-device acceptance.

## Changes

| Boundary | Implementation |
| --- | --- |
| JSON | `parseWireJson` rejects duplicate decoded keys within each object. Byte inputs require valid UTF-8. |
| Control | The decoder checks frame limits before payload validation. Identifiers reject whitespace, control characters, and excess length. |
| Connect | Incoming identity keys require the canonical encoding of 32 bytes. Transport preferences cannot repeat. |
| Handshake | Step must be 1 or 2. Existing connection handlers check direction and handshake state. |
| Relay | Ciphertext requires canonical unpadded Base64URL. Existing counter and frame limits remain active. |
| Timers | Heartbeat and fallback intervals cannot exceed the JavaScript timer limit. |
| REST | The local Server and bundled clients reject duplicate response or request fields before authorization processing. |

## Contract coverage

| Area | Evidence and remaining gap |
| --- | --- |
| Account authorization | Existing strict descriptor, registration, refresh, and browser-exchange schemas remain active. |
| Control envelope | Existing version, type, timestamp, and frame-size checks combine with duplicate-field rejection. |
| Connect and Relay | Shared fixtures cover canonical encoding, public keys, counters, and routing boundaries. |
| ApiProxy | Historical types remain for VS Code. Current Host and Android do not restore retired ApiProxy endpoints. |
| Business payloads | Native carriers and fixed Host allowlists validate business arguments. The shared JSON decoder checks raw field ambiguity. |
| Errors | Standard and extension error codes retain their existing contract. Parser errors do not contain raw input. |
| Identifiers | Control checks length and control characters. Full UUID/ULID format alignment remains incomplete. |

Protocol §4.2 requires coordinated identifier changes.
Existing factories emit UUIDv4, and historical clients can emit opaque identifiers.
The local Server also derives an opaque membership identifier.
Do not mark complete schema alignment until producers, consumers, and cross-repository fixtures agree.

## Validation

Validation uses Node.js 22.17.1 and pnpm 9.15.4 on WSL2.
The shared package build and DSH bundle check pass.
Protocol, Crypto, WebRTC, and local Server tests pass.
Plugin Server API and connection tests pass.
Android, Browser, and VS Code checks and relevant tests pass.
`git diff --check` passes.

The full Plugin test and check gates still fail in Harness RC.1 tests.
The installed `dsh-client-connection` package has no `Peer/createPeer` API.
The same five test failures occur at the branch starting commit.
This branch does not change those tests or the installed Harness API.

The local Server tests use real HTTP and WebSocket connections.
They cover duplicate credentials, invalid UTF-8, ciphertext tampering, replay, and incorrect peer identities.
Crypto tests preserve the existing Noise IK golden vector.

## Remaining acceptance

- Complete identifier format alignment across repositories.
- Define a Noise key lifetime and inspect provider key cleanup.
- Obtain an independent Noise implementation review.
- Run the shared fixtures in the Android native runtime.
- Test the deployed Relay with separate Host and Client devices.
- Synchronize raw JSON validation with the independent Server and Remote Web.

These items remain open in `TODO.md`.
