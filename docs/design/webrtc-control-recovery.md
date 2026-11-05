# WebRTC control recovery v1

Status: implemented in the working tree (2026-11-04); validation and remaining device acceptance are recorded below. Not published or deployed.

## Scope and compatibility

The optional `transport.webrtc.resume.v1` capability enables bounded control-plane recovery for an already authenticated Noise session over a healthy LAN/P2P/TURN DataChannel. Server, Host and Client must all support the capability. No new frame may be sent to a peer that did not negotiate it. Missing support retains the existing disconnect/reconnect behavior. Relay, provisional ICE/Noise handshakes and process restarts of either endpoint are excluded. Independent coturn allocations are retained; this does not add TURN failover or change credential TTL.

## Lease and recovery

A connection-scoped authorization lease lasts at most 300000 ms, renewed approximately every 25000 ms while both endpoints confirm the same existing connection. Count locally from the start of the confirming request using a monotonic clock, never from receipt of a possibly delayed reply. Only a matched connection confirmation renews the lease; hello, ping, socket reconnect and one-sided claims do not. A lease expiration check must also guard sends/receives after suspended timers. Socket blackholes cannot extend the lease. Explicit logout, cancellation, replacement, revoked membership, invalid identity/protocol, or a failed DataChannel close immediately.

Control frames: `connection.lease.request` carries connectionId, requestId and a Server-signed recovery ticket. `connection.lease.ack` echoes requestId and carries a replacement ticket and leaseMs=300000. Both sides must submit fresh requests on their authenticated control sockets before either receives an ack. Initial tickets are attached only to negotiated connect.incoming/connect.accepted. Start lease requests only after local Noise authentication completes; no first ack means no detached operation. A matching pair must be less than 30 seconds old. Requests are connection-scoped, and an ack with an unknown, superseded or older-than-30-second requestId is ignored. Tickets bind the logical connection, host/client device IDs and identity keys, and expire after five minutes. They are memory-only endpoint secrets and must never be logged. They permit restoration of control routing only, never data decryption, new authority, or resetting Noise counters.

After control loss, retain healthy authenticated RTC/Noise/RPC/stream state until its last confirmed deadline; reconnect control in the background with jitter and bounded delay. Re-authenticate the device (refresh credentials as needed), submit a lease request for the existing connection, and wait for both endpoints. Restoring a socket alone does not extend the deadline. A Server restart validates its signed tickets using the existing persistent signing secret, rechecks current membership, device identity and the durable connection record, and rebinds each side to its exact new socket. Explicitly terminated/replaced records cannot be resurrected. Requests from sibling browser sockets may not steal active routing.

Socket cleanup for negotiated resumable connections must stop producing terminal peer-lost errors on ordinary network failure. Preserve the bounded detached state until lease expiry; explicit security/administrative closures remain terminal. Legacy connections retain immediate cleanup. Healthy control sockets must retry lease requests too: the other side may reconnect later. Pending requests and detached state must be bounded and expired. At most 64 resumable connections are issued per Host; additional connections retain legacy lifetimes. Server sweeps expired in-memory leases every five seconds; endpoint send/receive guards enforce their own deadline synchronously. The default 25-second renewal rate leaves approximately 275–300 seconds of outage budget, less request/response latency.

## Availability and authorization tradeoff

The product accepts delayed revocation, replacement and online status during a control outage. The lease bounds that delay, rather than guaranteeing five full minutes of Server downtime: recovery/authorization must finish before the deadline. No new connections, ICE restart, automatic route migration or business-request replay are promised. Server recovery must not emit a new connect.incoming for an existing session. Keep local Host trust validation and connection-scoped security boundaries intact.

## Validation

Required: mixed old/new endpoints and Server; LAN/P2P/TURN retained data flow; Server process replacement; unilateral and reordered recovery; blackholed control; lease expiry and late acks; stale generation/socket messages; revocation/replacement/identity mismatch; Relay/handshake immediate failure; logout/dispose cleanup; no replay of RPC or Noise counters. Node fake-runtime tests do not count as native Android or real coturn acceptance. Validate actual TURN allocation refresh across credential expiry separately.

## Host continuity, disposal and rollout

A recovering Host hello optionally includes `recoveryTickets` (maximum 64), only after a prior connection negotiated support. Server validates these device-bound proofs before the ordinary single-Host socket replacement, rebinds proved connections, and durably fences other open records of this Host as `CONNECTION_REPLACED`. A new Host process without the in-memory tickets cannot recover its predecessor's sessions, including after Server restart. Server close code `4012` means recovery tickets were rejected: discard those retained sessions and retry a normal hello. Code `4002` remains an access-credential failure and follows credential refresh while retaining eligible sessions. A rollback to a Server rejecting the additive hello with `4008` drops retained sessions and retries the legacy hello; it does not preserve sessions across capability removal.

`connection.lease.close` carries connectionId and is accepted only on its exact bound socket. Local disconnect, logout, disposal and terminal failure notify the Server when reachable, immediately close the local channel and stop timers; Server closes the durable record and notifies the other side. During a control outage the other side may observe the DataChannel close or its own lease expiry instead. Explicit terminal records cannot be resumed. No database schema migration is introduced. Stable Server signing secret and the existing connection database must survive Server restarts; loss/rotation fails closed.

Rollout order may be Server first or endpoints first: optional capability intersection and per-connection tickets gate the feature, and no version-number inference is used. New Server + old Host/Client, old Server + new endpoints, and mixed old/new peers retain their existing lifetimes. The relay-only self-hosted Server and independent VS Code client do not advertise resume support. Server's integrated Expo Android/iOS client and Remote Web have the same lease contract; Remote's Desktop/Android clients use the shared transport. Existing Server-specific WebRTC budgets, presence feed and Relay attach fallback are retained during source synchronization.

No new UI polling, TURN refresh/TTL change or per-heartbeat database write is added. Lease confirmation rechecks current authorization and open connection records; the Server writes a record when closing/replacing it. Host control reconnection retains configured backoff (default cap 30 seconds); shared Client and Web recovery use jitter with a 15-second nominal cap. Ordinary WebSocket heartbeat remains separate from the connection authorization lease.

## Close semantics and retry jitter (2026-11-05)

Retention decisions are classified by (close code, close reason) through `packages/protocol/src/close-semantics.ts`, never by a bare close code.

- `server shutdown` is the only reason that means an expected Server outage: `apps/server` sends `4009`, the full Server currently sends `4001` (it reserves `4009` for heartbeat expiry), and `1013` is accepted as a transport alias, so all three codes are equivalent when paired with that reason.
- `4009`/`heartbeat timeout` and `4001`/`CONNECTION_FAILED` mean the peer stopped answering. They are retryable and may retain the authenticated session, because a dead peer is indistinguishable from a network partition (which is retained anyway), but they never mean the Server restarted.
- `4003` (replaced), `4004` (revoked), `4002` (credentials), `4008` (invalid frame) and `4011` (protocol) never retain.

Every disconnect backs off; no path retries immediately. All three reconnect loops use full jitter over a single cap window, `[0, cap]`, for the first and every later attempt: Host and Client carrier reconnect use `reconnect.maxDelayMs` (default 30s), WebRTC/Relay control recovery uses 15s. A Server restart is no longer special-cased in the delay (it is the worst case of the same window), only in session retention. `reconnect.initialDelayMs` and `reconnect.jitter` remain accepted configuration but no longer shape the delay; only `maxDelayMs` bounds it.

The WebRTC recovery attempt counter still advances on every scheduled attempt and resets on success and on terminal failure; it no longer changes the delay, and is kept so a future exponential schedule can reuse it.
