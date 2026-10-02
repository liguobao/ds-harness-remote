# Host 插件接入指南

状态：最新 Server 账号授权契约；Plugin 已实现账号密码、主机匹配码、device token 隔离与账号派生 membership。

本文面向 DeepSeek Harness Host 插件开发者，描述插件如何登录账号、注册本机、保存凭证并连接 Remote Server。

## 1. 接入模型

Host 接入分为两层认证：

- **账号认证**：用户登录 Server，授权当前账号新增或恢复 Host。
- **设备认证**：Host 注册完成后获得独立的设备 access/refresh token，用于后台常驻连接。

账号 token 只用于注册 Host 和账号接口，不用于 WebSocket；设备 token 不可调用账号接口。Server 不保存设备私钥，也不执行 Harness 任务。

插件必须同时提供两种接入方式：

1. **账号密码接入**：插件登录账号后直接注册 Host；
2. **主机匹配码接入**：用户在已登录网页生成一次性匹配码，再把它输入插件。

两种方式最终得到相同的设备 token，后续刷新和 WebSocket 行为完全一致。主机匹配码只负责把一个 Host 接入账号；Host 与 Web/其他 Client 之间不再有单独的授权流程，同账号归属就是连接授权依据。

## 2. Server 地址

插件默认 Server：

```text
https://dsh.r2049.cn
```

同时允许用户输入自定义部署地址，例如：

```text
https://remote.example.com
```

插件应将地址规范化为不带末尾 `/` 的 HTTPS origin。除显式开发模式外，不接受 HTTP。一次接入中的登录、Host 注册、token refresh 和 WebSocket 必须使用同一个 origin：

```text
REST:      {serverUrl}/api/v1/...
WebSocket: wss://{serverHost}/ws/v1/connect
```

切换 Server 时，不得把旧 Server 的账号 token、设备 token、deviceId 或账号授权状态发送给新 Server。建议按规范化后的 `serverUrl` 隔离本地凭证和设备身份。

## 3. 账号登录

### 3.1 邮箱密码

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "用户密码"
}
```

成功响应：

```json
{
  "token": "web-account-jwt",
  "expiresAt": 1786000000000,
  "account": "user@example.com",
  "profile": {},
  "isAdmin": false
}
```

插件将 `token` 临时作为 `accountToken`。可以通过以下接口验证登录状态：

```http
GET /api/v1/auth/me
Authorization: Bearer <accountToken>
```

未注册用户需先在网页或插件 UI 中使用邀请码调用 `POST /api/v1/auth/register`。

### 3.2 OAuth 与扫码登录

先检查当前 Server 是否启用对应 OAuth：

```http
GET /api/v1/auth/oauth/status
GET /api/v1/auth/oauth/github/status
```

返回 `{ "configured": true }` 后，Web 登录可分别打开：

```text
{serverUrl}/api/v1/auth/oauth/start?return_to=/app
{serverUrl}/api/v1/auth/oauth/github/start?return_to=/app
```

当前 Server 完成 Web 授权后会回到同源 `/app?token=<accountToken>`。Android Client 可使用固定 App scheme `dshremote://oauth` 作为 `return_to`，Server 会回跳 `dshremote://oauth?token=<accountToken>`；除此之外的外部 URL 或自定义 scheme 必须被规范化为 `/app`，避免开放重定向。

桌面插件使用一次性扫码会话，`provider` 可为 `zhihu` 或 `github`；省略时为兼容旧客户端默认使用 `zhihu`：

```http
POST /api/v1/auth/oauth/qr/start?provider=github
```

Server 返回 `{ "qrId", "scanUrl", "expiresIn", "provider" }`。插件只把同源 `scanUrl` 编码成二维码，并轮询：

```http
GET /api/v1/auth/oauth/qr/{qrId}
```

结果依次为 `pending`、`complete`（含一次性 `token`）或 `expired`。手机在 `scanUrl` 完成 GitHub/知乎 OAuth 后只看到完成页；Web token 不进入二维码、手机回调 URL 或日志，并且只能由发起插件领取一次。插件领取后立即用该 token 注册本机 device，再丢弃 web token。

账号 token 当前没有 refresh 接口；过期后需要重新登录。已经注册并持有有效 device refresh token 的 Host 后台运行不依赖账号 token。

## 4. 生成本机设备身份

首次接入某个 Server 时，插件在本机生成并安全保存：

- `deviceId`：UUIDv7 或 ULID；
- X25519 static identity key pair；
- `identityKey`：32 字节 X25519 公钥的无 padding base64url，通常为 43 字符。

私钥只能保存在本机安全存储中，禁止上传 Server、写日志或随诊断包导出。建议本地存储按 `serverUrl` 分区。

## 5. 注册 Host

### 5.1 方式一：账号密码直接接入

插件先按 §3.1 使用账号密码取得 `accountToken`，再注册 Host：

```http
POST /api/v1/devices/register
Authorization: Bearer <accountToken>
Content-Type: application/json

{
  "v": 1,
  "device": {
    "deviceId": "0198...",
    "name": "My Workstation",
    "role": "host",
    "platform": "darwin",
    "identityKey": "base64url-x25519-public-key",
    "clientVersion": "0.1.0"
  }
}
```

成功返回设备凭证：

```json
{
  "accessToken": "device-access-jwt",
  "accessTokenExpiresAt": 1786000000000,
  "refreshToken": "opaque-device-refresh-token",
  "refreshTokenExpiresAt": 1789000000000
}
```

重要行为：

- 缺少账号登录：`401 ACCOUNT_AUTH_REQUIRED`；
- 已有 Host 属于其他账号：`403 DEVICE_OWNERSHIP_REQUIRED`；
- 已有 deviceId 没有账号 owner：`403 DEVICE_OWNERSHIP_REQUIRED`，不允许继续使用，必须创建新的 device identity；
- 相同账号、deviceId 和 identityKey 可以重新注册；
- 相同 deviceId 不允许更换 role 或 identityKey。

注册成功后，`accountToken` 不应继续作为后台连接凭证。插件应安全保存设备 token pair。

### 5.2 方式二：主机匹配码接入

用户登录同一个 Server 的网页，在控制台“工作电脑”页面生成主机匹配码。网页实际调用：

```http
POST /api/v1/account/host-registration-codes
Authorization: Bearer <accountToken>
Content-Type: application/json

{}
```

响应：

```json
{
  "registrationId": "0198...",
  "code": "ABCD-EFGH",
  "expiresAt": 1786000000000
}
```

插件让用户输入该码，然后连同本机 Host descriptor 一次提交：

```http
POST /api/v1/devices/register-with-code
Content-Type: application/json

{
  "v": 1,
  "code": "ABCD-EFGH",
  "device": {
    "deviceId": "0198...",
    "name": "My Workstation",
    "role": "host",
    "platform": "darwin",
    "identityKey": "base64url-x25519-public-key",
    "clientVersion": "0.1.0"
  }
}
```

成功响应与 §5.1 相同，直接返回设备 access/refresh token。匹配码具备以下约束：

- 8 位、10 分钟有效、只能成功使用一次；
- 同一账号只保留一个有效匹配码，重新生成会立即作废旧码；
- Server 只保存独立域的 keyed hash，不保存明文；
- 只允许注册 `role=host`；
- 按账号限制生成频率，按来源 IP 限制尝试频率；
- `HOST_REGISTRATION_CODE_NOT_FOUND`：码不存在或格式无效；
- `HOST_REGISTRATION_CODE_EXPIRED`：码已过期；
- `HOST_REGISTRATION_CODE_CONSUMED`：码已被使用。

匹配码消费与 Host owner 写入在同一数据库事务中完成。插件收到超时或网络错误时，应先检查请求结果，不能盲目用同一码并发重试；明确收到未消费类网络错误时可串行重试一次。

### 5.3 Desktop Client 账号接入

Desktop Client 使用 §3.1 的账号密码取得临时 `accountToken`，再调用
`POST /api/v1/devices/register`，descriptor 使用 `role=client` 且不携带
`harnessVersion`。Client 不允许使用主机匹配码，也没有 Host 生成、领取或确认的设备码。

注册成功后只保存 Client 自己的 device token。`GET /api/v1/devices` 返回同账号 Host
及 membership；Client 随后逐个调用 `GET /api/v1/devices/{hostDeviceId}` 获取 identity
key，并在本机固定该 key。相同 Host deviceId 的 key 发生变化时必须拒绝覆盖和连接。

### 5.4 同一安装自动持有 Host / Remote 身份

Desktop Plugin 没有用户可见的 Client 模式开关。Host runtime 常驻运行；用户首次打开
Remote 工作区入口时，插件按需准备独立的 Remote（协议角色仍为 `client`）身份。同一安装
只需首次完成任一角色的账号归属；准备尚未注册的另一角色时，插件使用当前角色的有效
device access token 调用：

```http
POST /api/v1/devices/register-owned-role
Authorization: Bearer <currentDeviceAccessToken>
Content-Type: application/json
```

body 使用 §5.3 相同的注册 envelope，但新角色必须拥有独立 deviceId 和 identity key。
Server 继承当前设备的 `owner_account` 并返回新角色自己的 token pair。之后 Host/Client
后续启动分别读取各自保存的凭据，不再注册。该接口不得接受相同 role、相同 deviceId、无账号
owner 的设备或其他 Server 签发的 token。

Host 与 Remote 必须使用不同 deviceId 和 identity key。Remote 主机列表应排除本机 Host
deviceId，避免用户把当前 Harness 连接回自身。

## 6. 凭证保存和刷新

建议按以下结构保存，字段名仅供参考：

```json
{
  "serverUrl": "https://dsh.r2049.cn",
  "authorizationMethod": "account",
  "account": "user@example.com",
  "deviceId": "0198...",
  "deviceAccessToken": "...",
  "deviceAccessTokenExpiresAt": 1786000000000,
  "deviceRefreshToken": "...",
  "deviceRefreshTokenExpiresAt": 1789000000000
}
```

使用主机匹配码接入时，`authorizationMethod` 为 `host_registration_code`，响应不返回
账号名，因此本地 `account` 可以省略。该字段只用于展示接入状态，不参与 Server 鉴权。

刷新设备 token：

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "deviceId": "0198...",
  "refreshToken": "current-refresh-token"
}
```

Server 每次刷新都会轮换 refresh token。插件必须将整组新凭证原子落盘后再废弃旧值；旧 token 重用会撤销整个 token family。不要并发刷新，同一设备应使用 single-flight/互斥锁。

Plugin 使用凭据文件旁的 `server-credentials.json.refresh-lock` 目录锁，在获得锁后重新
读取凭据，串行执行读取、刷新与原子落盘。等待 15 秒仍未获得锁时返回
`SERVER_CREDENTIALS_BUSY`，不按锁龄抢占。进程异常退出后，应停止所有共享该目录的实例，
移除遗留锁并重新授权，避免重用可能已被 Server 消耗的 refresh token。
刷新失败日志只标记 `phase: credential_refresh` 与错误码，不记录响应正文或 token。

同一 deviceId 只保留一个控制连接。收到 `4003` 时 Plugin 进入 `CONNECTION_REPLACED`
并停止自动重连；同时运行的 Host 应使用独立 `DSH_HOME` 并分别授权。
收到 `4002` 时，Plugin 使用被拒绝的 access token 对照锁内最新凭据，必要时刷新，
随后重试握手一次；新凭据仍被拒绝时停止恢复，成功完成握手才重置恢复预算。

建议在 access token 到期前 60 秒刷新。收到 `TOKEN_EXPIRED` 可刷新后重试一次；收到 `AUTH_INVALID` 或 `DEVICE_REVOKED` 应停止自动重试，清理设备凭证并提示用户重新登录/接入。

## 7. 建立 WebSocket

连接：

```text
wss://dsh.r2049.cn/ws/v1/connect
```

自定义 Server 则从 HTTPS origin 派生 `wss` URL。access token 必须放在首个 `hello` frame 中，禁止放在 URL query：

```json
{
  "v": 1,
  "id": "0198...",
  "type": "hello",
  "timestamp": 1786000000000,
  "payload": {
    "role": "host",
    "deviceId": "0198...",
    "accessToken": "device-access-jwt",
    "protocols": [1],
    "clientVersion": "0.2.9",
    "harnessVersion": "0.1.0-rc.8",
    "capabilities": ["transport.p2p", "transport.turn", "transport.relay"]
  }
}
```

Host 在启动时优先调用本机 rc.2 `ApiProxy.host.describe` 读取 `version`；alpha 不提供
ApiProxy，或旧 Harness 返回已知占位值/不提供该方法时，从当前运行入口定位 `@deepseek-ai/dsh`
运行包读取版本：CLI/dsh-TUI 入口位于该包根目录之下，沿入口祖先链查找；0.2.0 Desktop 由
`app.asar` 内的 `@deepseek-ai/dsh-desktop-host` 入口拉起、Harness 包是其兄弟目录，则按入口的
模块作用域解析 `@deepseek-ai/dsh/package.json`。读取成功时，Host 在设备注册
descriptor 和首次 `hello` 中作为 `harnessVersion` 上报。读取都失败时省略字段，不能
阻止控制连接。Server 对缺失字段保留已有值。

连接建立后 5 秒内未发送合法 `hello` 会被关闭。成功响应 `hello.ack`：

```json
{
  "v": 1,
  "id": "0198...",
  "type": "hello.ack",
  "timestamp": 1786000000000,
  "payload": {
    "protocol": 1,
    "serverVersion": "0.1.0",
    "connectionSessionId": "0198...",
    "heartbeatIntervalMs": 25000,
    "maxControlFrameBytes": 65536,
    "maxRelayFrameBytes": 1048576,
    "capabilities": ["transport.relay"]
  }
}
```

Server 会发送 `ping`，插件必须及时返回相同 nonce 的 `pong`。同一 deviceId 建立新 WebSocket 时，旧连接会以 `4003 CONNECTION_REPLACED` 关闭，因此插件内部也应保证只有一个连接管理器。

断线重连建议使用带 jitter 的指数退避。认证失败时先刷新设备 access token；设备被撤销时停止重连。

## 8. 账号授权与连接事件

Web 或其他客户端使用同一个账号登录并注册 `role=client` 后，Server 会自动为它与该账号下的 Host 建立授权边。没有创建、领取或确认设备码的接口。

Client 发起 `connect.request` 且 Host 在线时，Host WebSocket 收到：

```json
{
  "v": 1,
  "id": "0198...",
  "type": "connect.incoming",
  "timestamp": 1786000000000,
  "payload": {
    "connectionId": "0198...",
    "clientDeviceId": "0198...",
    "clientIdentityKey": "base64url-x25519-public-key",
    "authorization": "account",
    "preferredTransports": ["lan", "p2p", "turn", "relay"]
  }
}
```

插件只接受 `authorization: "account"`，并校验 `clientDeviceId`、`clientIdentityKey` 与字段格式。随后使用 Host device token 调用 `GET /api/v1/devices/{clientDeviceId}`，确认返回的 role、membership 和 identity key 与事件完全一致；本机已有相同 deviceId 但 key 不同则 fail closed。验证通过后把 descriptor 写入本机 pinned trust，无需弹出人工确认窗口，即可进入安全握手。

`clientIdentityKey` 是本次端到端安全握手的远端静态公钥。插件必须把它绑定到该 `connectionId`，握手期间或连接建立后都不得被替换。Client 同样通过 `GET /api/v1/devices/{hostDeviceId}` 获取并固定 Host 的 `identityKey`。Server 只路由密文，不能替代端到端密钥校验。

Host 必须按 `connectionId` 同时维护来自不同 `clientDeviceId` 的安全通道和对应 Harness bridge（rc.2 ApiProxy 或 v0.1.2 Typert Remote）；
手机 Web 与电脑 Web 等不同设备可以同时在线。每个连接独立计算 pending RPC 和 stream 上限，
其 stream frame 只返回原连接。同一 `clientDeviceId` 重连时只替换该设备的旧连接，不影响其他
Client。

Server 通过原有 `error` frame 的可选 `payload.connectionId` 关闭单条逻辑连接。字段存在时
插件只清理对应 tunnel、RPC router 与原生流，Control WebSocket 和其他 Client 保持在线；字段
不存在时沿用原来的 Control/操作级错误处理。为兼容旧插件，Server 对低于 `0.2.13`、未上报
或版本格式无效的 Host 保持 last-client-wins，不会同时下发多个 Client connection。

## 9. 账号设备查询

使用账号 token 查询当前账号拥有的 Host：

```http
GET /api/v1/account/devices
Authorization: Bearer <accountToken>
```

响应中的每个 Host 都包含 `deviceId`、名称、平台、版本、`lastSeenAt` 与
`online`。`online` 表示当前是否有该 Host 的 WebSocket 连接，可直接用于网页或
插件的主机状态展示。

该接口用于插件登录后的设备恢复/展示，不替代本机私钥。若 Server 返回某个 Host，
但本机没有对应私钥，插件不能冒充或自动认领该设备，应创建新的 device identity。

## 10. 最小状态机

```text
NO_SERVER
  → CHOOSE_ENROLLMENT
      ├─ PASSWORD_LOGIN → ACCOUNT_AUTHENTICATED
      └─ ENTER_HOST_CODE → CODE_READY
  → DEVICE_REGISTERED
  → DEVICE_TOKEN_READY
  → WS_CONNECTING
  → ONLINE

access token expired → REFRESHING → WS_CONNECTING
AUTH_INVALID         → ACCOUNT_LOGIN_REQUIRED
DEVICE_REVOKED       → REVOKED（停止重连）
server changed       → NO_SERVER（切换到该 Server 独立的本地状态）
```

## 11. 日志与安全要求

插件日志不得包含：

- 账号密码、账号 token；
- device access/refresh token；
- X25519 private key；
- 尚未使用的主机匹配码；
- Noise handshake secret 或解密后的业务 payload。

可以记录经过截断或哈希处理的 deviceId、connectionId、错误码和连接阶段。生产环境必须校验证书，不允许“忽略 TLS 错误”。

## 最小自部署 Server

本仓库 `apps/server` 提供上述账号密码、设备注册/自有角色注册、刷新、设备详情和 Control/Relay API 子集。账号来自 `DSH_SERVER_ACCOUNT`，密码来自 `DSH_SERVER_PASSWORD`。配置自定义 Server 地址后选择账号密码登录。运行方法见 [README](../apps/server/README.zh.md)。
