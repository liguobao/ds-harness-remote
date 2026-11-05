# 自部署 Server

[English](README.md) · **中文**

单账号 Remote Server，支持 WebRTC（LAN / P2P / TURN）与端到端加密 Relay，环境变量配置账号密码，Web 提供首页、登录和设备状态页。Server 不包含在 Host 插件 bundle 中，需要单独部署。

当前版本定位为继续维护的最小自部署 Server。完整 Server Web 的产品形态仍在调整，暂不承诺在本仓库开源当前或未来的完整站点。

## 自部署页面

首页地址是 `/`，点击“开始使用”进入登录页；登录成功后进入 `/app/remote` 设备列表。Host 和客户端都填写同一个 Server 地址，并使用相同的账号密码登录。设备凭据由 Server 保存，Web 登录会话使用 HttpOnly Cookie。

## Docker 部署

```bash
cd apps/server
cp .env.example .env
# 编辑 .env，设置账号、密码和访问地址
docker compose up -d --build
```

打开 <http://localhost:8080>。设备凭据保存在 `server-data` 卷；停止使用 `docker compose down`。

公开镜像地址：`ghcr.io/liguobao/ds-harness-remote/server:latest`。需要时可以直接拉取：

```bash
docker pull ghcr.io/liguobao/ds-harness-remote/server:latest
```

若旧镜像启动时无法解析 `@dsh-remote/protocol`，更新源码后执行 `docker compose build --no-cache server && docker compose up -d server`。镜像显式包含 protocol 编译产物，并在构建阶段校验 Server 的模块加载；重建会保留数据卷。

发布镜像由 GitHub Tag 工作流构建。生产环境应使用 HTTPS 反向代理，不要直接把 Node 监听端口暴露到公网。

### 页面白屏或静态资源返回 403

`DSH_SERVER_PUBLIC_URL` 必须与浏览器实际访问的 origin 一致，包括 `http` / `https`、域名和非默认端口；不要填写容器内部地址或页面路径。例如通过 `https://remote.example.com` 访问时，在 `.env` 设置：

```dotenv
DSH_SERVER_PUBLIC_URL=https://remote.example.com
```

修改后执行 `docker compose up -d --force-recreate server`；仅 `docker compose restart` 不会更新环境变量。使用预构建镜像时可加 `--no-build`。保留现有数据卷，不要执行 `down -v`。

如果 JS/CSS 返回 403，且响应 JSON 中为 `AUTH_INVALID`，优先核对上述配置与请求的 `Origin`。Server 在静态资源处理前执行 origin 校验；因此首页可能打开，JS/CSS 却被拒绝，浏览器随后报告 MIME 为 `application/json` 并白屏。不要通过修改 MIME 或删除 origin 校验来绕过。若响应来自反向代理，则检查代理访问规则；代理应保留浏览器原始 `Origin`。

源码 Docker 构建报 protocol 入口无法解析时，也检查文件权限（`ls -ld packages/protocol packages/protocol/package.json`）。镜像会规范化发布文件的读取/目录遍历权限，并在最终 `node` 用户下校验模块加载。

## 本地启动

需要 Node.js 22、pnpm 9.15.4。在仓库根目录执行：

```bash
pnpm install
pnpm --filter @dsh-remote/protocol build
pnpm --filter @dsh-remote/server build
cp apps/server/.env.example apps/server/.env
```

编辑 `apps/server/.env`，设置账号和至少 12 字符的密码，然后启动：

```bash
cd apps/server
node --env-file=.env dist/main.js
```

打开 <http://localhost:8080>。Host 和客户端填写同一 Server 地址，使用同一账号密码登录。建议账号使用邮箱格式，以兼容现有客户端。

| 环境变量 | 用途 / 默认值 |
| --- | --- |
| `DSH_SERVER_ACCOUNT` | 必填，登录账号 |
| `DSH_SERVER_PASSWORD` | 必填，至少 12 字符 |
| `DSH_SERVER_PUBLIC_URL` | 浏览器访问地址，默认 `http://localhost:8080` |
| `DSH_SERVER_HOST` | 监听/端口映射地址，默认 `127.0.0.1`；局域网设为 `0.0.0.0` |
| `DSH_SERVER_PORT` | 默认 `8080` |
| `DSH_SERVER_DATA_FILE` | 默认 `data/state.json`，相对启动目录 |
| `DSH_SERVER_TRUSTED_PROXY_IPS` | 受信任反向代理 peer IP 列表，逗号分隔；留空（默认）时忽略转发 IP |
| `DSH_SERVER_STUN_URLS` | 下发给 Host/Client 的 STUN URL，逗号分隔；留空（默认）时只使用 host candidate |
| `DSH_SERVER_TURN_URLS` | TURN URL，逗号分隔；必须同时配置 `DSH_SERVER_TURN_SECRET` |
| `DSH_SERVER_TURN_SECRET` | coturn REST API 共享密钥；不会下发给客户端 |
| `DSH_SERVER_TURN_TTL_SECONDS` | TURN credential 有效期秒数，60–3600，默认 `300` |

公网使用 HTTPS 反向代理，并将 `DSH_SERVER_PUBLIC_URL` 设为实际域名；代理需支持 `/ws/v1/connect` 的 WebSocket Upgrade，空闲超时大于 75 秒。

## WebRTC 与 TURN

Server 协调与托管 Server 相同的四条路径：`LAN -> P2P -> TURN -> Relay`。

- 在已授权连接的两台设备之间转发 WebRTC `signal.offer` / `signal.answer` / `signal.ice`，并转发发起方的 `transport.selected`（包含对旧 Host 的 `lan -> p2p` 兼容降级）。
- 仅向正在建立的连接的两台设备签发短期 STUN/TURN 配置：`GET /api/v1/turn/credentials`。TURN credential 采用 coturn REST API：`username=<过期秒级时间戳>:<deviceId>`，`credential=base64(HMAC-SHA1(secret, username))`。
- Server 不读取也不解密业务流量：WebRTC 直接承载 Noise 密文，TURN 只转发 WebRTC 数据包，Relay 通过 WebSocket 转发密文。
- WebRTC/TURN 不可用时客户端会自动回退到加密 Relay；`DSH_SERVER_STUN_URLS` / `DSH_SERVER_TURN_URLS` 留空即保持原来的 Relay-only 行为。

需要单独部署 coturn，配置 `use-auth-secret` 且 `static-auth-secret` 与 `DSH_SERVER_TURN_SECRET` 一致，开放 TURN 端口（通常为 3478/UDP、TCP 以及 relay 端口段），并让 STUN/TURN URL 指向 Host 与 Client 都能访问的地址。HTTPS 反向代理只需承载控制 WebSocket 与 REST API，WebRTC/TURN 流量不经过它。

### 反向代理下的限流

默认按 socket peer IP 限流并忽略 `X-Forwarded-For`。使用反向代理时所有连接都来自代理，全部客户端会共用 240/min 的 API 限额和 20/min 的登录限额。将 `DSH_SERVER_TRUSTED_PROXY_IPS` 设为受信任代理 peer IP 的逗号分隔列表，即可按真实客户端 IP 分别限流：

```dotenv
DSH_SERVER_TRUSTED_PROXY_IPS=172.18.0.2,2001:db8::2
```

只接受纯 IPv4 / IPv6 字面量；端口（`10.0.0.1:8080`）、CIDR 网段（`10.0.0.0/8`）和域名会在启动时报错，也不会默认信任任何私网网段。IPv4-mapped IPv6（`::ffff:127.0.0.1`）会规范化为 `127.0.0.1`，两种写法匹配同一条配置。

来自受信任 peer 的请求必须带且仅带一个 `X-Forwarded-For` 头，且值为单个 IP 字面量。缺失、重复、逗号分隔多 IP、`IP:port` 或域名都会返回 HTTP 400 `INVALID_MESSAGE`。其他 peer 的请求一律按 socket IP 处理，客户端无法自行伪造该头来冒充别的地址。

受信任代理必须**覆盖** `X-Forwarded-For` 为真实客户端 IP（不要追加或透传客户端自带的值），并且 Server 端口不能直接暴露到公网，否则信任边界会被绕过。在 Docker 中应填写代理**在 Server 容器内看到的地址**（可用 `docker network inspect <网络名>` 查看），不是 `127.0.0.1`：容器内该地址是 Server 自身。WebSocket 连接和共享同一公网 NAT IP 的客户端仍按同一 IP 共享限额。

修改后执行 `docker compose up -d --force-recreate server`；`docker compose restart` 不会重新加载环境变量。

## 功能

- 支持设备注册、凭据刷新、设备发现、Control、WebRTC LAN/P2P/TURN 协调与端到端加密 Relay。
- 单进程运行；持久化保存 `data` 目录。重启后设备凭据保留，Web 需重新登录；修改密码后设备需重新授权。

验证：`pnpm --filter @dsh-remote/server test`。真实跨机与长期连接仍待回归。UI 复用来源见 [web/UPSTREAM.md](web/UPSTREAM.md)。

## 常见问题

### 会开源当前的完整 Server Web 吗？

暂不考虑。Server Web 的产品形态我还在调整，后续会按实际思路继续演进；当前仓库只承诺维护上面介绍的最小自部署版本。

### 为什么没有多账号、完整 membership 和 Remote Web？

这些能力本身实现门槛不高，但不同用户会有不同的场景和取舍，建议按自己的需求修改。Remote Web 稳定后，未来也可能加入当前 Server；目前没有固定时间表。

## 发布 Tag 检查

发布 Tag 必须与根 `package.json` 和 `packages/plugin/package.json` 的版本一致，例如 `v0.4.15`。Tag 工作流会执行 workspace check、测试、构建、插件 npm 打包、Browser 扩展打包和 SHA256 校验；Server Docker 镜像也从同一个 Tag 构建。

本地可先运行：

```bash
pnpm --filter './packages/**' -r build
pnpm -r check
pnpm -r test
NODE_ENV=production pnpm --workspace-concurrency=1 -r build
node scripts/verify-dsh-plugin.mjs
pnpm --dir packages/plugin pack --pack-destination /tmp/dsh-release-assets
```
