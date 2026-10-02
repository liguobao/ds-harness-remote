# DSH Remote Server 设计说明

状态：Draft v0.1
日期：2026-08-15
实现状态：**完整站点位于独立 Server 仓库；本仓库 `apps/server` 提供最小自部署子集。**

## 0. 仓库边界（规范性）

本文保留完整 Server 的设计与互操作契约。用户于 2026-09-19 授权在当前仓库实现最小自部署版本，其运行方式与支持的 API 见 [最小 Server 说明](../apps/server/README.zh.md)。

最小版本参考独立仓库的账号/设备 API、WebSocket Gateway 与 Hub 逻辑，使用环境变量单账号和 JSON 文件持久化，支持 Control/Noise handshake forwarding/opaque Relay。Web 提供登录与设备状态页。后文记录独立 Server 项目的完整设计。

## 1. 定位

DSH Remote Server 是一个自部署的**协调与中继服务**。它负责账号授权设备注册、在线状态、连接授权、WebRTC signaling、短期 TURN credential、加密 Relay 和站点管理；它不执行 Harness 任务，也不保存会话明文。

Server、Remote Web 和 Admin 是一个站点：

- 一个 `REMOTE_PUBLIC_URL`
- 一个 FastAPI 进程/API 入口
- 一个 React 构建
- 一个 SQLite 数据库
- 一个 WebSocket endpoint
- `/app` 为 Remote 用户区
- `/app/admin` 为白名单账号可见的管理区（`/admin` 为旧站点路由别名）

独立 Server 项目内部可以按 Python 后端与 React 前端分层，但生产部署不可拆成两个用户站点。这里描述的是外部 Server 项目的目标结构，不是当前仓库目录规划。

## 2. 目标与非目标

### 目标

- Host 在 NAT 后只通过出站 WSS 即可上线。
- Web/其他 Client 登录账号后直接获得同账号 Host 的访问权限。
- 只允许同一账号下的 Client 与 Host signaling/relay。
- P2P 失败时无缝回退到 TURN 或加密 Relay。
- Admin 能诊断设备、连接和 TURN 健康。
- 单机 SQLite + Docker Compose 即可自部署。
- Server 被入侵时，攻击者仍不能直接读取会话或控制 Host。

### 非目标

- 不保存 prompt、conversation、workspace 文件、tool output 或 shell history。
- 不提供 Harness RPC 的 HTTP 代理。
- 不提供 terminal、SSH、VNC、远程文件系统或模型代理。
- MVP 不引入 Redis、Kafka、RabbitMQ、Celery、Postgres 或 Kubernetes。
- Admin 不拥有会话解密能力。
- MVP 不做组织、RBAC、SSO、计费和多人协作。

## 3. 系统边界

```text
Host Plugin                    Browser Launcher / Remote Web
    |                                  |
    | WSS outbound                     | HTTPS / HTTPS + WSS
    v                                  v
             DSH Remote Server
       +---------------------------+
       | Account + Device API      |
       | WebSocket Connection Hub  |
       | WebRTC Signaling          |
       | Opaque Encrypted Relay    |
       | TURN Credential Service   |
       | Admin API + React Static  |
       +---------------------------+
                    |
                  SQLite
```

控制面包含设备、membership、连接和 signaling 元数据。数据面中的 Harness RPC/Event 在 Host 和 Client 之间端到端加密；Relay 只转发 ciphertext。

## 4. 技术约束

- Python 3.12+
- FastAPI
- SQLAlchemy 2
- Alembic
- Pydantic v2
- SQLite（WAL）
- uvicorn
- React + Vite + TypeScript（统一站点前端）
- coturn（标准部署可选启用）

## 5. 站点路由

| 路由 | 内容 |
| --- | --- |
| `/` | 项目介绍（Landing Page，公开） |
| `/guide` | 使用指南（公开） |
| `/app/access` | 同账号工作电脑远程访问（需登录） |
| `/app/hosts` | Host 接入与状态（需登录） |
| `/app/*` | Remote 用户区（需登录） |
| `/admin/*` | Admin 管理区 |
| `/api/v1/*` | Remote REST API |
| `/api/v1/admin/*` | Admin REST API |
| `/ws/v1/connect` | Host/Client 统一 WebSocket |
| `/health` | liveness |
| `/ready` | readiness，按部署策略限制细节 |

生产环境由 FastAPI 托管 `apps/web/dist`。API/WebSocket route 必须先于 SPA fallback 注册；未知 `/api/*` 返回 JSON 404，不能返回 `index.html`。

## 6. 身份模型

### Device

每个 Host/Client 持有随机 `deviceId` 和本地 X25519 identity key。Server 保存 device descriptor 与 public key，不保存 private key。

每个设备同时绑定 `owner_account`。账号归属决定设备间访问边界，device token 只用于
后续 control plane 身份认证；E2EE peer identity 继续绑定具体 connection。

### Membership

Membership 是 Server 根据相同 `owner_account` 自动维护的 Host/Client 授权边。只有
active membership 且双方账号仍一致时才能：

- 查看 Host presence。
- 创建 Host/Client connection。
- 交换 signaling。
- 使用 Relay。
- 请求该 connection 的 TURN credential。

### Admin

Admin 无独立入口：只有白名单账号（`DSH_ADMIN_EMAILS` / `DSH_ADMIN_ZHIHU_OPEN_IDS`）
可作为管理员。Admin API 仅接受 web Bearer 令牌（`typ=web` + 白名单）；Remote
device Bearer 与普通 web 账号均不能访问 Admin API。

## 7. 设备注册

Host 与 Client 的首次账号归属必须携带站点账号 token 注册随机身份并获取 Server credential。
Host 还可用账号网页生成的一次性主机匹配码接入。注册行为按 IP/账号限速；重复
deviceId 不允许覆盖已有 public key、role 或 owner。

Server credential 使用短 access token + 可旋转 refresh token。数据库仅保存 refresh token hash；检测旧 token 重用时撤销整个 token family。

Host/Client private key 始终留在设备本地。

同一 Plugin 安装在任一角色已经归属账号后，可用该角色 device credential 注册本机的
相反角色。Server 只继承 owner，仍要求两个角色使用不同 deviceId、identity key 和
token pair。

## 8. 账号授权设计

- Host 和 Client 注册后，Server 查找同账号下所有未撤销的异角色设备并建立
  `device_memberships` 行。
- 无论 Host 先注册还是 Client 先注册，最终授权结果一致。
- 同账号设备重新注册会恢复被撤销的派生授权边；撤销整个设备仍使其 token 与连接失效。
- REST 设备详情、presence、TURN 与 WebSocket connect 都继续校验 membership，防止 IDOR。
- WebSocket connect 在创建 connection 前再次校验双方 `owner_account` 完全一致。
- Host 收到 `connect.incoming.authorization = "account"` 后通过受 membership 保护的
  设备详情接口交叉校验 Client descriptor，再写入本机 pinned trust 并进入安全握手；
  不存在额外设备码、确认事件或本机人工确认 UI。

主机匹配码是另一件事：它只授权一个 Host 加入账号，采用 8 位无歧义 Base32、
10 分钟 TTL、单次消费和 keyed hash 存储。

## 9. REST API

### Remote API

| Method | Path | Auth | 说明 |
| --- | --- | --- | --- |
| `POST` | `/api/v1/devices/register` | Account | 注册账号拥有的 Host 或 Client，并同步授权边 |
| `POST` | `/api/v1/devices/register-owned-role` | Device | 为同一安装注册账号拥有的相反角色 |
| `POST` | `/api/v1/account/host-registration-codes` | Account | 生成一次性主机匹配码 |
| `POST` | `/api/v1/devices/register-with-code` | rate limited | 使用主机匹配码注册 Host |
| `POST` | `/api/v1/auth/browser-authorizations/exchange` | Account | 用当前 Web 授权注册 Browser Client |
| `GET` | `/api/v1/account/devices` | Account | 返回账号拥有的 Host 及当前在线状态 |
| `GET` | `/api/v1/devices` | Client | 返回该 Client 同账号可访问的 Host |
| `GET` | `/api/v1/devices/{id}` | membership | Host 元数据 |
| `POST` | `/api/v1/auth/refresh` | refresh token | 旋转 token |
| `GET` | `/api/v1/turn/credentials` | active connection | 短期 TURN credential |

具体 request/response 和错误 envelope 见 [protocol.md](protocol.md)。

### Admin API

| Method | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/health` | Server/DB/WebSocket/TURN 健康 |
| `GET` | `/api/v1/admin/devices` | 全站设备元数据 |
| `POST` | `/api/v1/admin/devices/{id}/revoke` | 撤销设备、token、连接 |
| `GET` | `/api/v1/admin/connections` | 连接元数据 |
| `GET` | `/api/v1/admin/settings` | 脱敏的生效配置 |

Admin API 不提供 conversation、workspace、session title、prompt 或 tool output 字段。

## 10. WebSocket Gateway

统一入口 `/ws/v1/connect`。连接必须在短超时内发送 hello；未认证连接不能进入 ConnectionHub。

状态：

```text
ACCEPTED -> AUTHENTICATING -> READY -> DRAINING -> CLOSED
    |             |            |
    +----------> CLOSED <-------+
```

hello 校验：

- protocol version
- role (`host` / `client`)
- deviceId 与 access token subject 一致
- device 未撤销
- token 未过期
- Origin 合法（浏览器 Client）
- clientVersion 与 Host harnessVersion 格式（提供时）
- capabilities 格式与 frame 大小

同一 device 新连接的处理策略必须明确：MVP 采用新连接替换旧连接，旧连接收到 `CONNECTION_REPLACED` 后关闭。

## 11. Signaling

Server 转发 `signal.offer`、`signal.answer` 和 `signal.ice`，但必须校验：

- connectionId 属于发送方。
- targetDeviceId 与 active membership 匹配。
- 发送方/目标角色正确。
- SDP/candidate 大小、频率和总数在限制内。
- connection 已进入允许 signaling 的状态。

Server 不修改 SDP，不参与 DataChannel 业务协议。

同一 `connectionId` 发往同一目标的 `signal.*`、`transport.selected` 与
`secure.handshake` 必须通过单一有序发送队列转发，禁止为不同 frame 启动彼此独立的
fire-and-forget send task。尤其不能让 `secure.handshake` 越过先收到的
`transport.selected`；否则 Client 和 Host 可能把同一条 Noise channel 绑定到不同数据面。
`lan` 是 `transport.selected` 的一等线协议值；双方声明 `transport.lan` capability 时必须
原样转发。只有目标旧 RC2 Host 未声明该 capability 时，才允许兼容降级为 `p2p`。

## 12. Relay

Relay 是 P2P/TURN 不可用时的数据面 fallback。

外层 envelope 可见字段仅用于路由：protocol、connectionId、sender、target、counter、ciphertext 长度。ciphertext 内是完整 Remote Protocol message。

Server 必须：

- 将 payload 视为 opaque bytes。
- 不记录 payload、nonce、完整 message size 序列或解密失败细节。
- 校验 active membership 和 connection ownership。
- 限制单 frame、每秒 frame、每连接队列和总带宽。
- 使用有界发送队列；慢消费者触发 `SLOW_CONSUMER` 断开。
- device revoke 后立即关闭相关 channel。

## 13. TURN

TURN credential 由 `TURN_SECRET` 动态生成，TTL 与 connection 建立窗口匹配。只有 active membership 且处于连接建立阶段的设备可获取。

Server 不向前端返回 `TURN_SECRET`。Admin 只能看到 TURN URL、是否配置、credential 生成是否正常和可选探测结果。

## 14. 数据模型

### `devices`

`id`, `name`, `role`, `platform`, `public_key`, `owner_account`, `version`, `created_at`, `last_seen_at`, `revoked_at`

### `host_registration_codes`

`id`, `code_hash`, `owner_account`, `status`, `created_at`, `expires_at`, `consumed_at`, `consumed_device_id`

### `device_memberships`

`id`, `host_device_id`, `client_device_id`, `created_at`, `last_connected_at`, `revoked_at`

### `refresh_tokens`

`id`, `device_id`, `membership_id`, `token_hash`, `family_id`, `issued_at`, `expires_at`, `rotated_at`, `revoked_at`

### `connections`

`id`, `host_device_id`, `client_device_id`, `transport`, `connected_at`, `disconnected_at`, `disconnect_code`, `bytes_relayed`, `p2p_established_ms`

### `admin_sessions`

`id`, `session_hash`, `created_at`, `expires_at`, `revoked_at`, `last_seen_at`

### `user_accounts`

站点账号（邮箱或知乎衍生账号 id）：`account`(PK), `password_hash`(argon2id，可空),
`created_at`, `updated_at`, `archived_at`

### `oauth_identities`

知乎 open_id 与账号的绑定及 access token（hash 存储）：`id`, `account`(FK),
`zhihu_open_id`(unique), `access_token`, `access_token_expires_at`, `created_at`, `updated_at`

### `user_profiles`

展示资料：`account`(PK/FK), `open_id`, `name`, `headline`, `avatar_url`, `source`(password|oauth), `updated_at`

### `invite_codes`

一次性邀请码：`invite_code`(PK), `inviter_account`(FK), `invitee_account`, `generation_month`, `created_at`, `used_at`

> 旧 `admin_sessions`（密码会话）表已随白名单 Admin 移除（迁移 `6f2d3e4a5b6c`）。

数据库 schema 明确禁止加入 conversation payload、workspace、session message、tool output 或密钥字段。

## 15. 配置

| 环境变量 | 生产要求 |
| --- | --- |
| `REMOTE_PUBLIC_URL` | 必填，HTTPS URL |
| `REMOTE_SECRET_KEY` | 必填，高熵，不允许默认值 |
| `DATABASE_URL` | 默认 `sqlite:////data/remote.db` |
| `DSH_ADMIN_EMAILS` | Admin 白名单邮箱（逗号分隔）；可选 |
| `DSH_ADMIN_ZHIHU_OPEN_IDS` | Admin 白名单知乎 open_id（逗号分隔）；可选 |
| `STUN_URLS` | 可选 |
| `TURN_URL` | TURN 启用时必填 |
| `TURN_SECRET` | TURN 启用时必填 |
| `HOST_REGISTRATION_CODE_TTL_SECONDS` | 主机匹配码有效期，默认 600 秒 |
| `ACCESS_TOKEN_TTL_SECONDS` | 短 TTL |
| `REFRESH_TOKEN_TTL_SECONDS` | 可配置并支持轮换 |
| `DSH_ZHIHU_OAUTH_APP_ID` | 可选；配置后启用知乎授权登录 |
| `DSH_ZHIHU_OAUTH_APP_KEY` | 可选；同上 |
| `DSH_WEB_LOGIN_TTL_SECONDS` | web 会话有效期，默认 28 天 |
| `DSH_INVITE_CODE_MONTHLY_LIMIT` | 每账号每月邀请码上限，默认 10 |
| `DSH_INVITE_CODE` | 可选；站点通用邀请码，配置后任何人可直接用它注册（可重复使用、无 inviter、不占每月配额） |
| `LOG_LEVEL` | 默认 `INFO` |

启动时校验配置、数据库迁移、可写性和 secret 强度。生产安全配置缺失时拒绝启动。

## 15a. 站点账号登录

Host 插件的账号登录、设备注册、凭证轮换和 WebSocket 接入约定见
[Host 插件接入指南](plugin-integration.md)。

- 站点路由 `/app/*` 需要登录；`/guide`、`/` 公开；站点管理
  `/app/admin`（兼容旧 `/admin`）仅白名单账号。
- 登录方式一：知乎 OAuth（`/api/v1/auth/oauth/start` → 知乎授权 →
  `/api/v1/auth/oauth/callback` → 回跳 `?token=`）。state 为内存短时映射 +
  HttpOnly Cookie 校验；未配置凭据时回跳 `?error=oauth_not_configured`。
- 登录方式二：GitHub OAuth（`/api/v1/auth/oauth/github/start` → GitHub 授权 →
  `/api/v1/auth/oauth/github/callback`）；使用不可变 GitHub user id 绑定站点账号。
- Android Client 可对两种 OAuth 使用固定 `dshremote://oauth` 回跳并领取一次性
  Web token 来注册本机 device；其他外部 `return_to` 仍必须拒绝或规范化为 `/app`。
- 桌面扫码登录由 `POST /api/v1/auth/oauth/qr/start?provider=zhihu|github` 创建短期
  一次性会话，原插件轮询 `GET /api/v1/auth/oauth/qr/{qrId}` 领取结果。省略 provider
  时默认知乎以兼容旧客户端；两种 provider 的 Web token 都不进入二维码、手机回调 URL 或日志。
- 登录方式三：邮箱密码，注册需要邀请码
  （`POST /api/v1/auth/register` / `POST /api/v1/auth/login`）。
- web 会话为 HS256 JWT（`typ=web`），与设备令牌隔离；账号接口
  `/api/v1/auth/me|invite-code|invite-codes` 仅接受 web 令牌。
- Browser Launcher 不实现账号、密码或 OAuth 登录。它从已登录的同源 Remote Web 页面临时
  读取 web token，并调用 `POST /api/v1/auth/browser-authorizations/exchange`，用当前 Web 授权和
  自己的独立 identity 换取 Browser device token pair。web token 不得写入扩展存储、日志或 URL。
- Browser Launcher 不承载 Remote Client runtime。取得自己的 Browser device token 后只查询
  Host 和 presence；点击在线 Host 直接打开同源 `/app/remote/{hostDeviceId}`，复用浏览器现有
  Web 登录状态，任何 token 都不得进入 URL。完整约束见 `protocol.md` §8.3。
- 邀请码由已注册用户在 `/api/v1/auth/invite-code` 生成（每月限量），一次性使用，
  不能由创建者本人使用；被使用后记录 `invitee_account` 与 `used_at`。
- 可选 `DSH_INVITE_CODE`（站点通用邀请码）：`register_account` 优先匹配该配置值
  （大小写/空格归一后比较），命中即放行注册——不生成 `invite_codes` 行、不记录
  inviter/invitee、可重复使用；其余码仍走一次性邀请码校验。

## 15b. Admin（白名单，无独立入口）

- Admin 无密码登录/独立会话。账号命中 `DSH_ADMIN_EMAILS`（邮箱精确匹配）或
  `DSH_ADMIN_ZHIHU_OPEN_IDS`（该账号绑定的知乎 open_id 命中）即为管理员。
- 判定函数 `account_service.is_admin_account()`；Admin API 统一依赖
  `web_bearer` + `admin_account`（非白名单 → 403 `AUTH_INVALID`）。
- 前端：站点管理并入 `/app` 用户区（`AppArea`：远程访问 + 工作电脑 + 站点管理 标签页），
  标签页仅对 `isAdmin` 为真的账号渲染；`/me` 返回 `isAdmin` 供前端判断；
  非管理员直接访问 `/app/admin`（或旧 `/admin`）显示 403 页。导航栏无 Admin 入口。
- `admin_sessions` 表与 `ADMIN_PASSWORD_HASH` 已废弃移除；CSRF 双提交不再需要
  （Admin API 只接受 Bearer web 令牌）。

## 16. SQLite 与迁移

- SQLAlchemy 2 typed models。
- Alembic 管理所有 schema 变更。
- 开启 foreign keys、WAL 和 busy timeout。
- 事务完成设备注册、账号授权边同步和 token 签发。
- 清理任务只删除过期临时 Host code/token，不删除审计所需的 revoke 事实。
- 单进程/少量 worker 是 SQLite MVP 的部署边界；扩展到多实例前迁移 Postgres 和外部 presence store。

## 17. 日志与指标

允许记录：requestId、connectionId、截断 deviceId、route、status、transport、duration、bytes、error code、状态迁移。

禁止记录：Authorization、Cookie、refresh token、主机匹配码明文、private/shared key、TURN secret、E2EE payload、prompt、source code、workspace、tool output。

MVP 指标：

- active Host/Client connections
- Host 接入成功/失败/过期/限速
- P2P/TURN/Relay 比例
- connection establishment time
- reconnect/disconnect count
- relay bytes 和 slow consumer
- DB/TURN readiness

## 18. 安全控制

- REST 使用严格 Pydantic schema；未知字段按 endpoint 风险决定拒绝。
- Host code、login、refresh、register、WebSocket hello 独立限速。
- 所有设备查询从 token subject 的 membership 反查，防止 IDOR。
- Admin 无 cookie/密码会话：仅白名单账号（email / 知乎 open_id）经 web Bearer
  令牌访问，普通与设备令牌一律拒绝（401/403）。
- WebSocket 浏览器 Origin 只允许 `REMOTE_PUBLIC_URL`。
- Static 站点启用严格 CSP、HSTS、`X-Content-Type-Options` 和 frame 限制。
- Token hash 存储、refresh rotation 和 reuse detection。
- Device revoke 同时撤销 token、membership 和现有连接。
- Server 不具有 E2EE identity private key，无法伪造可信 Client。

## 19. Admin 功能

Admin 页面并入同一 React 站点的 `/app` 用户区（`/app/admin`，兼容旧 `/admin`），
导航栏没有独立 Admin 入口；白名单管理员在用户区多一个「站点管理」标签页，
`/api/v1/admin/*` 统一依赖 `web_bearer` + `admin_account`（server.md §15b）。

MVP 页面：Health、Devices、Connections、Settings。Settings 对环境变量驱动字段只读并脱敏。Admin 能撤销设备，但不能查看 Remote 会话内容。

## 20. 核心测试策略

只覆盖 Server 核心安全和状态行为：

- 账号授权边自动建立、跨账号拒绝与 IDOR
- Host 匹配码 expire/single-use/rate-limit
- token rotation/reuse/revoke
- WebSocket hello auth、origin、replacement
- signaling target authorization
- relay membership、frame limit、backpressure
- device revoke 后实时断连
- Admin/Remote auth 隔离
- 数据模型和日志不接收业务明文

静态页面托管、Admin 普通筛选、视觉样式、状态标签和非关键 doctor 展示不单独写测试。

## 21. 部署

标准 Compose：

```text
remote-server
  - FastAPI
  - React dist
  - /data/remote.db

coturn
  - shared TURN secret

caddy/nginx（可选）
  - TLS
  - HTTPS/WSS reverse proxy
```

对外只有一个站点 URL；TURN 另开放其协议所需端口。备份 `/data/remote.db` 与 Server secret，绝不备份客户端/Host private key（它们不应存在于 Server）。

## 22. 实现顺序

1. 配置、数据库、迁移和统一站点静态路由。
2. 账号登录、设备注册、token 与 Host 匹配码。
3. 同账号 membership 自动同步与设备查询授权。
4. WebSocket hello 和 ConnectionHub。
5. signaling 与 opaque Relay。
6. Admin health/devices/connections/settings。
7. rate limit、revoke、backpressure 和日志脱敏。
8. TURN credential 和 Docker Compose。
9. 根据 [protocol.md](protocol.md) 完成互操作验收。
