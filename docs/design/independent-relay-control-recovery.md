# Independent Relay control recovery v1 (implemented)

This optional extension retains an authenticated Noise session using an already attached independent Relay node across a temporary main Server control outage. It does not retain connections using the main Server relay, replace lost data sockets, replay business requests, or resume after either endpoint or the Relay node process restarts. Existing WebRTC recovery remains unchanged.

## Negotiation and activation

Use a separate `transport.relay.resume.v1` capability, offered independently by Host, Client and the authenticated Relay node. Server supports it only if all three offered it and the selected data carrier is the same independent Relay assignment. Never send new frames or enable preservation for old peers/nodes. Capability discovery is per live Relay control session; a stale database row is not evidence of support. A control reconnection to a new Server must re-establish node identity and epoch, not infer support from prior process state.

A connection-scoped Server-signed recovery ticket binds connectionId, both device identities/public keys, Relay node ID, epoch, and recovery purpose. It is not an attach ticket and does not authorize a new data socket. Only activate after both endpoints report their original attached data sockets ready, and after Noise authentication. Both must obtain a paired authorization lease acknowledgement; a unilateral claim or TCP/hello alone never extends it. Existing attach and Noise wire formats remain compatible. A Relay assignment alone or a selected `relay` is insufficient: a peer might have fallen back to main-Server Relay.

## Lifecycle and security

The locally enforced lease is 300 seconds from the earliest paired confirming request, using monotonic and wall clocks and send/receive guards after suspension. Revocation/expiry, explicit closure, identity changes and replacement remain fail-closed once observed; during a Server outage revoke propagation may take up to the lease. No app requests or ciphertext are replayed, and Noise and relay counters are never reset or copied. A live but blackholed data socket must not renew authorization based solely on Server control heartbeats; confirm data-plane health before renewal.

Main Server restart preserves the data sockets only while the Relay node process and both endpoint sockets remain alive. A node restart, changed node epoch, or either data socket close immediately terminates the old session. Relay admission ticket expiry does not itself close an already attached socket, but no new attach is allowed on the recovery ticket. Server reconstruction verifies the signed binding, current device/membership/authorization, durable connection record and the live node/epoch; it must tolerate node and endpoint reconnection in any order without treating temporary node unavailability as a permanent denial. It must not silently convert a main-server relay to independent Relay.

Relay node administration, revocation and drain semantics must be specified and enforced for retained sessions; stopping new admissions alone must not accidentally be advertised as immediate closure of established sessions. Limits, backpressure, peer detach, and ticket validation remain enforced. Server socket replacement must preserve only explicitly proven sessions and never steal sibling tabs.

## Verification and compatibility

The implementation includes state-machine coverage for mixed versions, relay attached vs fallback, paired lease confirmation, either data socket loss, node epoch mismatch, late acknowledgements, preserved Relay counters and no replay. A real Relay node control/data-plane smoke test and the existing cross-package checks must pass before release. A full process-restart test with two physical endpoints and a real mobile target remains deployment validation rather than a protocol prerequisite.

Compatibility is capability based. A new Host, Client and Relay node must all advertise `transport.relay.resume.v1` (and the node control channel must advertise `relay.session.check.v1`) before the Server issues a relay recovery ticket. Any old Host, Client or node follows the existing behavior and closes the connection when Server control is lost. The new optional fields `relayRecoveryTicket`, `relayNodeId` and `relayEpoch` are ignored by old peers, so the v1 control frame shape remains compatible.
