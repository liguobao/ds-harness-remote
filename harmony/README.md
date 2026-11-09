# HarmonyOS client

HarmonyOS 7.0（API 26）native client for DS Remote, written in pure ArkTS.

- Build: open this directory in DevEco Studio, or run `hvigorw --no-daemon assembleHap -p product=default -p buildMode=release`
- Minimum system: HarmonyOS 7.0 (API 26) and above
- Tests: `pnpm exec vitest run harmony/tests` (golden vectors from `fixtures/crypto/v1/`)
- Signing: never committed; see the signing section of the guide

Full architecture, security notes, release process and maintenance boundaries: [docs/harmony-client.md](../../docs/harmony-client.md).
