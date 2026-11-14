# Independent Android transport benchmark

Runs without a Remote account, production server, Host profile or selected session.
The dedicated entry uses Hermes on the physical phone, the existing native cipher
and RTC sender, production Noise / secure / RTC codecs, and the actual
`WorkspaceUploadHost`. It writes only to a newly created temporary directory.

From the repository root, with workspace dependencies already built:

```sh
pnpm exec tsx scripts/transport-bench/host.ts
# In a second terminal, with exactly the intended ADB serial:
scripts/transport-bench/build-device.sh 6690723a
```

Set `DSH_BENCH_MIB=200` on the Host command for a larger fixture (default 64,
allowed range 1–200). The build script requires the generated Android project,
Android SDK and JDK. It temporarily selects `apps/android/bench/index.tsx` in the
ignored generated Gradle file, restores that file on exit, forces the JS bundle task to rerun so each temporary
control URL is embedded freshly, and installs
`/tmp/dsh-independent-bench.apk` without clearing app data. It does not edit the
shipping JS entry or introduce a login bypass into the application.

The temporary app automatically runs Base64/64 KiB at window 4, then binary/256
KiB at windows 4, 8, 16, and 4 again. The host prints JSON results and writes
`results.json` under the temporary directory announced at startup. Each commit
must match the fixture SHA-256, including the exact byte count. Output files and
the phone fixture are deleted after verification. RPCs time out after 60 seconds;
failed mutations are not retried.

Control, fixture download, and result collection use a token-scoped HTTP endpoint
bound to Mac loopback via `adb reverse tcp:18792 tcp:18792`. WebRTC payloads use
LAN UDP, with no STUN/TURN server configured. Ephemeral keys establish Noise IK;
no account credentials are read. Final RTC statistics allow checking the selected
candidate pair. Record the actual pair rather than assuming the ADB control path
also carries benchmark data.

Timing includes upload open through commit **and host checksum verification**,
excluding fixture download and connection setup. Stage counters are cumulative
local CPU/wait time and must not be added to RPC latency percentiles. This harness
has its own bounded RPC pump to compare window sizes; it does not exercise the
production login, capability negotiation, session authorization, reconnect state
machine, or full production router. A 512 KiB RTC buffered-amount guard limits
queue growth; observed native buffered amounts may lag actual native queues.

After testing, stop the Host with Ctrl-C, remove the ADB mapping, and reinstall a
normal release APK (the benchmark intentionally occupies the same package):

```sh
adb -s 6690723a reverse --remove tcp:18792
adb -s 6690723a install -r apps/android/dsh-remote-latest.apk
```

The runner leaves normal release APKs untouched. Do not distribute the benchmark
APK as a normal release. Raw results include local candidate addresses; use a
summary when sharing results.

## Cumulative-ACK stream experiment

```sh
DSH_BENCH_MIB=200 DSH_BENCH_EXPERIMENT=stream pnpm exec tsx scripts/transport-bench/host.ts
# Then build-device.sh as above.
```

Runs binary RPC / experimental bulk / binary RPC / experimental bulk on the same
connection. Both use Noise and the existing 8 KiB RTC chunk codec. Bulk uses a
32-byte scope/offset header inside Noise, with at most 48 KiB plaintext per frame,
a 1 MiB sender credit limit, and cumulative acknowledgements after at least
512 KiB of successful writes (or at EOF). The Host coalesces frames into at most
256 KiB calls to the existing upload writer, retaining its workspace checks and
commit behavior. It refuses unknown upload IDs, noncontiguous offsets, oversized
transfers and more than 2 MiB of queued stream data. Stream errors prevent commit;
there is no mutation replay. Acknowledgements mean the writer accepted the bytes,
not that each batch has been fsynced; publication still uses normal commit.

The experimental `bench.stream.open` method and raw frame parser exist only in
this harness. Production routers do not accept them. This measures whether
removing per-chunk RPC encoding/responses helps before proposing a protocol.

## Large RTC frame and LAN TCP controls

Use `DSH_BENCH_EXPERIMENT=stream-large` to send complete ~48 KiB Noise
ciphertexts as DataChannel messages rather than applying the extra 8 KiB RTC
fragmentation. The dedicated build temporarily increases the native sender's
message limit to 65,535 bytes and restores its source on exit. Existing production
limits and the normal APK remain unchanged. This is an experiment, not evidence
that every RTC backend/old peer handles larger messages efficiently.

```sh
DSH_BENCH_MIB=200 DSH_BENCH_TRANSPORT=websocket pnpm exec tsx scripts/transport-bench/host.ts
# Then build-device.sh as above.
```

The TCP control uses a token-scoped WebSocket listener on the Mac's LAN IPv4
address, port 18793 (`DSH_BENCH_LAN_ADDRESS` overrides en0 detection). Payloads
remain Noise-encrypted; it does not use a cleartext file upload or ADB transport.
The loopback HTTP control endpoint remains on 18792. The four comparison cases
are RPC / cumulative-ACK bulk / RPC / cumulative-ACK bulk, all on TCP. Noise
ciphertexts are complete WebSocket messages, without the extra RTC fragmentation.

This intentionally bypasses both WebRTC/SCTP and the Host native-RTC helper IPC.
A difference cannot be attributed to SCTP alone. It demonstrates a possible LAN
data path, not public P2P TCP reachability, automatic discovery, production
authorization or transport fallback. No production listener is added. Stop the
Host and reinstall the normal APK after measurement as described above.

## Native WebSocket byte-send control

```sh
DSH_BENCH_MIB=200 DSH_BENCH_TRANSPORT=websocket DSH_BENCH_NATIVE_WS=1 pnpm exec tsx scripts/transport-bench/host.ts
# Then build-device.sh as above.
```

The dedicated builder injects `native-websocket-bench.kt.txt` into its temporary
native source snapshot and restores the original after building. The bridge
uses RN 0.86's public `WebSocketModule.sendBinary(ByteString, Int)` API on the
existing socket, avoiding `WebSocket.send(ArrayBuffer)`'s JS Base64 conversion.
No WebSocket connection, key, nonce, authorization or retransmission is owned by
the bridge. The JS entry serializes Noise encryption and uses the same upload
window/credit bounds. This hook is deliberately absent from production sources
and normal release APKs; promoting it requires a supported production transport
contract and corresponding reconnect/authorization/compatibility testing.

## Production LAN upload implementation on a phone

```sh
DSH_BENCH_MIB=200 DSH_BENCH_PRODUCTION=1 pnpm exec tsx scripts/transport-bench/host.ts
# Then build-device.sh as above.
```

Runs the actual mobile `uploadStagedFileToWorkspace`, `LanUploadRoutes`, native
`RemoteWebSocketBinary` and `LanUploadTransport` against the production
`RpcRouter`, `LanUploadHost` and `WorkspaceUploadHost`. The test fixture replaces
the already-authenticated control context with an ADB-token-authorized HTTP
adapter carrying fresh identities and one connection ID. This avoids accounts,
but does not claim production Server membership/login E2E acceptance. The
fixture provides the known Host LAN address instead of discovering it from a
real authenticated RTC connection; unit tests cover that address/mode gate.

Two full uploads are required. Any fallback of file mutations to the control
adapter is treated as a test failure. Every received file must match its source
SHA-256 and length and is deleted after verification. Production timings include
negotiation, new Noise handshake, file open through commit and client cleanup,
but exclude the subsequent out-of-band benchmark SHA-256 verification and the
initial fixture download. This differs slightly from the earlier prototype
timings, which include Host hashing inside the commit reply.
