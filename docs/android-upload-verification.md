# Android upload verification — 2026-11-14

Android Release 0.6.5 (72), arm64 phone → local Mac Host, DSH 0.2.2-rc.3,
over an authenticated Noise/LAN connection. Timings cover upload open through
commit, excluding fixture download. No chat message is sent by the benchmark.

| Path | Payload | Time | Throughput | Data chunks |
| --- | --- | --- | --- | --- |
| Existing JSON/Base64 | 200 MiB | 75.113 s | 2.663 MiB/s | 3200 |
| Negotiated binary | 200 MiB | 60.727 s | 3.293 MiB/s | 800 |

The existing path spent 2.546 s in JSON serialization and 2.297 s in UTF-8
encoding. These synchronous stages explain under 7% of total elapsed time;
RPC encoding alone was not the dominant bottleneck. Binary upload removes
Base64 expansion and uses 256 KiB chunks instead of 64 KiB. The binary run
made 802 RPCs including open/commit and remained on LAN at completion.

Both received 200 MiB files matched the source SHA-256:
`35bb574b8020da0c837b5289dcb122234b515cd8b502012f52af151fe6b8af64`.

Compatibility validation:

- A 4 MiB legacy-format upload to the updated Host completed successfully and
  matched its source checksum. Legacy open responses retain 64 KiB chunks.
- Automated tests verify that a Host without the binary capability receives
  unchanged JSON/Base64 requests, without an encoding field or mutation probe.
- Capability support is scoped to the current connection and cleared on Host
  replacement/close. Missing base capability or upload service cannot advertise
  binary support. Mismatched negotiation/acknowledgements abort without replay.
- Wire codec tests cover byte offsets, limits, truncation, invalid versions and
  non-upload headers; Host tests cover mixed encodings, scope and offset checks.

Checks: Protocol 106 passed, Client Core 63 passed, Android 663 passed;
Plugin 716 passed / 3 skipped. On macOS, the Plugin suite used a canonical
`TMPDIR` (`fs.realpathSync(os.tmpdir())`) to avoid `/var` versus `/private/var`
aliases in existing workspace containment fixtures. Type checks, production
Plugin/Android builds and DSH bundle validation passed.

No iOS or TURN/Relay device performance acceptance was performed. The legacy
wire path was exercised on-device; historical Host releases were not separately
reinstalled for this run. Temporary benchmark hooks are not part of the release
bundle. Fixtures are removed after checksum verification.

## Independent new-phone benchmark (2026-11-14)

Xiaomi 2106118C (`odin`, arm64) → Mac over LAN UDP, without logging in to
Remote or running a production Host profile. Reproducible code and commands:
[`scripts/transport-bench`](../scripts/transport-bench/README.md). A separate
Hermes entry uses the production Noise / secure / RTC codecs, native cipher,
native RTC sender and `WorkspaceUploadHost`, with temporary identities and a
fresh temporary workspace. The dedicated RPC pump varies the upload window;
this is transport/upload performance evidence, not account/session E2E acceptance.

64 MiB fixture; timings include open through commit and Host SHA-256 verification,
excluding the ADB fixture download and connection setup:

| Encoding / chunk | Window | Seconds | MiB/s | Chunk ACK p95 |
| --- | ---: | ---: | ---: | ---: |
| Base64 / 64 KiB | 4 | 19.107 | 3.350 | 116 ms |
| Binary / 256 KiB | 4 | 13.344 | 4.796 | 297 ms |
| Binary / 256 KiB | 8 | 13.810 | 4.634 | 658 ms |
| Binary / 256 KiB | 16 | 12.253 | 5.223 | 976 ms |
| Binary / 256 KiB | 4, repeated | 14.409 | 4.442 | 350 ms |

All five transfers matched SHA-256
`6b05df8e8ae6fbdb41e7b6a30475da969cf6edeaf6ca0e384435227ef2040ca8`.
RTC statistics show the payload-carrying nominated host/UDP candidate pair on
the local IPv4 subnet, with no TURN/Relay. HTTP signaling/results use ADB reverse;
the measured WebRTC payload does not.

The first binary/window-4 run improved throughput by 43% over Base64; the repeated
window-4 result still improved it by 33%. Its local cumulative stage times were
approximately 0.28 s reading, 0.22 s encoding/framing, 1.18 s encrypting and 2.28 s
sending. These do not account for all elapsed time and overlap outstanding RPCs.
The preliminary four-window-only sweep measured 4.723 / 4.610 / 4.782 / 4.441 MiB/s
for windows 4 / 8 / 16 / 4. The larger-window gain is modest and variable across
these short runs, while queued chunk acknowledgement latency increases. Keep the
production window at 4 pending broader network measurements. No new production
transport behavior is changed by this benchmark.

Validation: independent APK built and ran on the phone; five comparison transfers
plus four preliminary transfers passed checksum verification; mobile TypeScript
check and 15 upload/secure-transport regression tests passed. The benchmark is a
separate build entry and is never imported by the shipping application.

## Independent 200 MiB follow-up (2026-11-14)

Same new phone, standalone harness and LAN host/UDP path; fixture download and
connection setup excluded, Host SHA-256 verification included.

| Encoding | Window | Seconds | MiB/s | Chunk ACK p95 |
| --- | ---: | ---: | ---: | ---: |
| Base64 | 4 | 57.135 | 3.500 | 106 ms |
| Binary | 4 | 43.089 | 4.642 | 318 ms |
| Binary | 8 | 42.085 | 4.752 | 575 ms |
| Binary | 16 | 42.887 | 4.663 | 1162 ms |
| Binary | 4, repeated | 43.395 | 4.609 | 327 ms |

Default-window binary uploads saved 13.74–14.05 seconds versus the Base64
baseline: about 24–25% less elapsed time, or 32–33% higher throughput.
Windows 8/16 saved only 0.2–1.0 additional seconds over the first window-4
run, with higher queued chunk latency; retain production window 4.

All five files matched SHA-256
`11acf1e2dd0ff44254dc1e49f4587eccc39531e5143c53083335ece66c3499a8`.
The temporary APK was replaced with the normal release, and the benchmark
listener and ADB reverse mapping were removed. The build runner now forces
the JS bundle task to rerun when embedding a fresh temporary control URL.

## Trusted-channel transport experiments (2026-11-14)

Same Xiaomi phone and 200 MiB workload; Noise encryption and the existing Host
upload writer/authority checks remain enabled. All 16 experimental transfers
passed SHA-256 verification. Each group runs existing binary RPC, bulk stream,
existing binary RPC again, then bulk stream again. Setup/download are excluded;
commit and Host checksum verification are included.

| Transport / sender | Existing RPC, two runs | Bulk stream, two runs |
| --- | --- | --- |
| RTC + existing RPC / cumulative ACK | 42.001 s / 44.121 s | 43.197 s / 44.439 s |
| RTC + complete ~48 KiB ciphertexts | 44.601 s / 45.283 s | 41.874 s / 43.618 s |
| LAN TCP + JS WebSocket sender | 28.595 s / 28.464 s | 31.228 s / 28.470 s |
| LAN TCP + native binary sender | 11.590 s / 10.746 s | 14.120 s / 14.224 s |

The cumulative-ACK stream alone does not improve elapsed time. Sending complete
Noise ciphertexts instead of extra 8 KiB RTC fragments reduces the send count
from 30,402 to 4,367, but improves elapsed time only modestly in these tests.

The strongest result is **LAN TCP with native byte sending and unchanged binary
RPC semantics: 10.746–11.590 seconds (17.26–18.61 MiB/s)**. Compared with the
previous ~43-second default binary RTC upload, this saves about 32 seconds,
approximately 74% elapsed time / nearly 4x throughput. The TCP groups bypass
both SCTP/WebRTC and the Host native-RTC helper IPC; this is not a measurement
of SCTP cost alone.

Inspection of the pinned RN WebSocket implementation found that its public
`send(ArrayBuffer)` encodes Base64 in JS. Using the native byte API reduced
cumulative send-call time from about 25 seconds to 1.3 seconds in the first
RPC comparison. Noise encryption was retained. The cumulative-ACK stream remains
slower even with the native sender, so changing the confirmation protocol is
not justified by these results.

These are isolated benchmark data paths, **not a production Remote feature**.
Ephemeral identities and an ADB-delivered temporary token replace production
account/session setup. The TCP payload listener binds the Mac LAN IPv4 address
on port 18793; only control port 18792 is mapped with ADB reverse. A production
implementation still needs authenticated connection-bound negotiation, scoped
short-lived transfer authorization, listener lifecycle, cancellation/revocation,
old-peer fallback and reconnection tests. Public P2P TCP reachability and
TURN/Relay were not tested.

Reproduction flags and native-hook details are in
[`scripts/transport-bench/README.md`](../scripts/transport-bench/README.md).
The builder restores the temporary Kotlin/Gradle edits. The phone was restored
to the normal APK; temporary listeners and ADB reverse mappings were removed.
Checks: mobile TypeScript, 21 upload/secure/native-sender/codec tests, native APK
builds, shell syntax and diff check passed.

## Production LAN upload integration (2026-11-14)

Implemented `workspace.upload.lan.v1` and `workspace.upload.lan.open` in the
production Host router/runtime, with Android upload routing and the native
`RemoteWebSocketBinary` byte sender. Eligible binary uploads of at least 1 MiB
use a scoped independent Noise/TCP connection. The temporary endpoint is pinned
to the selected LAN peer IPv4 address; tickets are single-use, short-lived and
bound to the existing connection, device static key, session and upload ID.
Only fixed upload methods are accepted. Original writer authority/root/offset/size
checks, fsync and non-overwriting publication remain intact.

Only an unsupported/unreachable negotiation **before file open is sent** can
fall back. No data/open/commit replay occurs after an ambiguous failure. File
RPC callers also capture the main connection generation, so an in-progress
upload cannot continue on a replacement Host/carrier. P2P, TURN/Relay, IPv6,
small files, older Hosts and APKs without the native sender use the existing path.

The production-code harness reused the actual mobile uploader, `LanUploadRoutes`,
`LanUploadTransport`, native sender, Host `RpcRouter`, `LanUploadHost` and
`WorkspaceUploadHost`. It supplied an isolated authenticated-context fixture over
ADB instead of requiring account login; this is not full real-profile
authentication/membership E2E acceptance. The fixture fails if any file mutation
falls back to its HTTP control adapter.

| Payload | Run | Elapsed | Throughput | Integrity |
| --- | --- | ---: | ---: | --- |
| 200 MiB | 1 | 15.617 s | 12.806 MiB/s | SHA-256 matched |
| 200 MiB | 2 | 11.560 s | 17.301 MiB/s | SHA-256 matched |

Both files matched
`f23e2a599bd29436eb7e25ed7482bccfdd698d7c14f23f740bacd5f2f9887c0b`.
Timings include production negotiation, the new Noise handshake, native file
reading, open through commit and client cleanup; they exclude initial fixture
download and subsequent out-of-band benchmark SHA-256 verification. The earlier
prototype numbers include Host hashing in the commit reply, so they are not
exactly identical timing boundaries.

Checks: Protocol 109 tests; Plugin 724 passed / 3 skipped; Android 680 passed.
Host and Android type checks, all packages production builds, Android Release
APK builds, DSH bundle validation and diff check passed. Node 24.21 built the
packages. On macOS, the Plugin suite used `TMPDIR=/private/tmp` for existing
workspace-containment fixtures. The ordinary APK is installed on the new phone;
Host bundle output is rebuilt. The existing live DSH profile was not replaced
or restarted, and no package/release was published.

The benchmark listeners/ADB reverse mapping were cleaned up, fixture files
removed, and the original charging display setting restored. No iOS, real
public P2P/TURN/Relay phone acceptance, historical Host reinstall, firewall-drop
manual test or long-duration disconnect acceptance was performed in this run.
