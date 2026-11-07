# Self-hosted Server

**English** · [中文](README.zh.md)

A single-account Remote Server with WebRTC (LAN / P2P / TURN) and end-to-end encrypted Relay, configured through environment variables. Its Web UI includes a landing page, sign-in, and device status page. The Server is deployed separately from the Host plugin bundle.

This remains a small self-hosted Server that we intend to maintain. The product shape of the full Server Web is still evolving, so this repository does not promise to open source the current or future full site.

## Self-hosted Web flow

The `/` landing page links to `/app/login`; a successful sign-in continues to `/app/remote`. Point both Host and Client at the same Server URL and use the same account and password. Device credentials are persisted by the Server, while Web sessions use an HttpOnly cookie.

## Refresh response recovery

If a refresh succeeds but its response is lost, retrying the previous refresh token returns the same successor pair, including after a Server restart. Recovery remains available until that successor is rotated again, revoked, or expired; it does not extend either token's lifetime. An expired recovered access token can be replaced by rotating the recovered refresh token. Older tokens are rejected without revoking current credentials.

Existing device state remains compatible. Tokens already consumed before this Server upgrade have no recovery metadata and cannot be recovered. Revoked or expired credentials still require sign-in. Updating the Plugin alone does not add this Server behavior. Recovery metadata contains no plaintext bearer tokens; see [the refresh protocol](../../docs/protocol.md#82-refresh).

## Docker deployment

```bash
cd apps/server
cp .env.example .env
# Edit .env: set your account, password, and public URL
docker compose up -d --build
```

Open <http://localhost:8080>. Device credentials persist in the `server-data` volume. Stop the service with `docker compose down`.

Public image: `ghcr.io/liguobao/ds-harness-remote/server:latest`. Pull it directly when needed:

```bash
docker pull ghcr.io/liguobao/ds-harness-remote/server:latest
```

If an older image fails to resolve `@dsh-remote/protocol`, update the source and rebuild with `docker compose build --no-cache server && docker compose up -d server`. The image explicitly includes the compiled protocol package and checks the Server import graph during the build. Rebuilding preserves the data volume.

The GitHub Tag workflow builds the production image. Put an HTTPS reverse proxy in front of it instead of exposing the Node listener directly to the public internet.

### Blank page or static assets returning 403

`DSH_SERVER_PUBLIC_URL` must match the browser-facing origin, including `http` / `https`, hostname, and any non-default port. Do not use the internal container address or a page path. For access through `https://remote.example.com`, set this in `.env`:

```dotenv
DSH_SERVER_PUBLIC_URL=https://remote.example.com
```

Apply it with `docker compose up -d --force-recreate server`; `docker compose restart` does not update environment variables. Add `--no-build` when using a prebuilt image. Keep the existing data volume; do not run `down -v`.

If JS/CSS returns 403 with `AUTH_INVALID` in the JSON response, compare this setting with the request's `Origin`. The Server checks origins before serving static assets, so the HTML may load while JS/CSS is rejected. The browser then reports an `application/json` MIME error and displays a blank page. Do not change MIME types or remove origin checks to bypass this. If the response comes from the reverse proxy, check its access rules; preserve the browser's original `Origin` header.

For protocol entry-resolution errors during Docker source builds, also inspect source permissions (`ls -ld packages/protocol packages/protocol/package.json`). The image normalizes read/directory-traversal permissions on published files and checks module loading as the final `node` user.

## Local setup

Requires Node.js 22 and pnpm 9.15.4. From the repository root:

```bash
pnpm install
pnpm --filter @dsh-remote/protocol build
pnpm --filter @dsh-remote/server build
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env` with your account and a password of at least 12 characters, then start:

```bash
cd apps/server
node --env-file=.env dist/main.js
```

Open <http://localhost:8080>. Set the same Server URL on your Host and Client, then sign in with the same account. Use an email address as the account name for compatibility with existing clients.

| Variable | Purpose / default |
| --- | --- |
| `DSH_SERVER_ACCOUNT` | Required login account |
| `DSH_SERVER_PASSWORD` | Required; at least 12 characters |
| `DSH_SERVER_PUBLIC_URL` | Browser-facing URL; default `http://localhost:8080` |
| `DSH_SERVER_HOST` | Listen / port-binding address; default `127.0.0.1`, use `0.0.0.0` for LAN access |
| `DSH_SERVER_PORT` | Default `8080` |
| `DSH_SERVER_DATA_FILE` | Default `data/state.json`, relative to the working directory |
| `DSH_SERVER_TRUSTED_PROXY_IPS` | Comma-separated trusted reverse-proxy peer IPs; empty (default) disables forwarded-IP handling |
| `DSH_SERVER_STUN_URLS` | Comma-separated STUN URLs handed to Host/Client; empty (default) keeps host candidates only |
| `DSH_SERVER_TURN_URLS` | Comma-separated TURN URLs; requires `DSH_SERVER_TURN_SECRET` or `DSH_SERVER_TURN_USERNAME` + `DSH_SERVER_TURN_PASSWORD` |
| `DSH_SERVER_TURN_SECRET` | coturn REST API shared secret; never sent to clients |
| `DSH_SERVER_TURN_USERNAME` | Static TURN username for deployments that cannot use a shared secret; mutually exclusive with `DSH_SERVER_TURN_SECRET` |
| `DSH_SERVER_TURN_PASSWORD` | Static TURN password; must be set together with `DSH_SERVER_TURN_USERNAME` |
| `DSH_SERVER_TURN_TTL_SECONDS` | TURN credential lifetime in seconds, 60–3600, default `300` (applies to short-lived credentials only) |

For public access, use an HTTPS reverse proxy and set `DSH_SERVER_PUBLIC_URL` to your domain. The proxy must support WebSocket Upgrade at `/ws/v1/connect` with an idle timeout above 75 seconds.

## WebRTC and TURN

The Server coordinates the same four paths as the hosted Server: `LAN -> P2P -> TURN -> Relay`.

- It forwards WebRTC `signal.offer` / `signal.answer` / `signal.ice` between the two devices of an authorized connection, and forwards the initiator's `transport.selected` (including the legacy `lan -> p2p` downgrade for older Hosts).
- It issues short-lived STUN/TURN servers through `GET /api/v1/turn/credentials` only to the two devices of an establishing connection. TURN credentials use the coturn REST API: `username=<expiryUnixSeconds>:<deviceId>`, `credential=base64(HMAC-SHA1(secret, username))`.
- It never sees or decrypts session traffic: WebRTC carries Noise ciphertext directly, TURN only forwards WebRTC packets, and Relay forwards ciphertext over WebSocket.
- When WebRTC or TURN is unavailable, Clients fall back to the encrypted Relay automatically. Leaving `DSH_SERVER_STUN_URLS` / `DSH_SERVER_TURN_URLS` empty keeps the Relay-only behavior.

Deploy coturn separately with `use-auth-secret` and `static-auth-secret` matching `DSH_SERVER_TURN_SECRET`, open the TURN ports (normally 3478/UDP and TCP plus a relay port range), and point the STUN/TURN URLs at addresses reachable from the Host and Client. The HTTPS reverse proxy is only needed for the control WebSocket and REST API; WebRTC and TURN traffic do not pass through it.

For a TURN deployment that cannot use a shared secret, set `DSH_SERVER_TURN_USERNAME` + `DSH_SERVER_TURN_PASSWORD` instead of `DSH_SERVER_TURN_SECRET` (never both); the Server then hands the static pair to connection participants. Prefer short-lived REST API credentials — static ones are shared by every connection until rotated.

### Rate limiting behind a reverse proxy

By default the Server rate-limits by the socket peer IP and ignores `X-Forwarded-For`. Behind a reverse proxy every connection comes from the proxy, so all clients share one 240/min API limit and one 20/min login limit. Set `DSH_SERVER_TRUSTED_PROXY_IPS` to a comma-separated list of proxy peer IPs to restore per-client limits:

```dotenv
DSH_SERVER_TRUSTED_PROXY_IPS=172.18.0.2,2001:db8::2
```

Only bare IPv4 and IPv6 literals are accepted. Ports (`10.0.0.1:8080`), CIDR ranges (`10.0.0.0/8`) and hostnames make the Server fail at startup; no private network is trusted implicitly. IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is normalized to `127.0.0.1`, so either form matches the same entry.

A request from a trusted peer must carry exactly one `X-Forwarded-For` header whose value is a single IP literal. A missing or duplicate header, a comma-separated list, an `IP:port` value or a hostname is rejected with HTTP 400 `INVALID_MESSAGE`. Requests from any other peer always use their socket IP, so a client cannot spoof a different address by sending the header itself.

The trusted proxy must **overwrite** `X-Forwarded-For` with the real client IP (do not append to or pass through a client-supplied value), and the Server port must not be reachable directly from the public internet, or the trust boundary is bypassed. In Docker the trusted IP is the proxy's address **as seen from the Server container** (check `docker network inspect <network>`), not `127.0.0.1`: inside the container that address is the Server itself. WebSocket upgrades and clients sharing one public NAT IP still share a per-IP limit.

Apply the change with `docker compose up -d --force-recreate server`; `docker compose restart` does not reload environment variables.

## Features

- Device registration, credential refresh, device discovery, Control, WebRTC LAN/P2P/TURN coordination, and end-to-end encrypted Relay.
- Single-process operation with persistent data. Device credentials survive restarts; Web users sign in again. Changing the password requires devices to reauthorize.

Tests: `pnpm --filter @dsh-remote/server test`. Cross-machine and long-running validation remain pending. UI sources: [web/UPSTREAM.md](web/UPSTREAM.md).

## FAQ

### Will this repository open source the current full Server Web?

Not for now. The product shape of Server Web is still being worked out and will continue to evolve with that direction. This repository only promises to maintain the small self-hosted version described above.

### Why are multi-account support, full membership, and Remote Web not included?

These capabilities are not especially difficult to build, but users have different scenarios and trade-offs, so it is reasonable to adapt them to your own needs. Remote Web may be added to this Server after it becomes stable; there is no fixed schedule.

## Release Tag checks

A release tag must match the versions in the root `package.json` and `packages/plugin/package.json`, for example `v0.4.15`. The Tag workflow runs workspace checks, tests, builds, npm plugin packing, browser-extension packaging, and SHA256 checksums; the Server image is built from the same tag.

Run the checks locally before creating a tag:

```bash
pnpm --filter './packages/**' -r build
pnpm -r check
pnpm -r test
NODE_ENV=production pnpm --workspace-concurrency=1 -r build
node scripts/verify-dsh-plugin.mjs
pnpm --dir packages/plugin pack --pack-destination /tmp/dsh-release-assets
```
