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

两种方式最终得到相同的设备 token，后续刷新和 WebSocket 行为完全一致。主机匹配码只负责把一个 Host 接入账号；普通账号设备按 membership 派生连接授权；配对受限设备只取得显式绑定关系，见文末配对契约。

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

客户端先匿名获取当前 Server 可用的 OAuth 列表：

```http
GET /api/v1/auth/oauth/providers
```

响应使用 `Cache-Control: no-store`，只包含已配置完整凭据的提供商，不返回密钥、token 或账号信息：

```json
{
  "items": [
    {
      "id": "google",
      "displayName": "Google",
      "startUrl": "/api/v1/auth/oauth/google/start",
      "qrStartUrl": "/api/v1/auth/oauth/qr/start?provider=google"
    }
  ]
}
```

`id` 是服务端定义的字符串，不是客户端枚举；按返回顺序展示 `displayName`。
入口 URL 是相对于所选 Server base URL 的 `/api/v1/auth/` 路径。
客户端必须拒绝外域、协议相对地址、控制字符和路径越界；不得根据已知提供商拼接入口。
新字段应允许向前兼容。空 `items` 表示暂无可用 OAuth，应保留邮箱密码登录。
`qrStartUrl` 缺省或为 `null` 表示不支持扫码，桌面插件只显示支持扫码的条目。

Web 登录打开 `startUrl` 并添加 `return_to=/app`。授权后回到同源
`/app?token=<accountToken>`。Android 可使用固定 App scheme `dshremote://oauth`；其他
外部 URL 或自定义 scheme 会被规范化为 `/app`，避免开放重定向。

桌面插件向所选条目的 `qrStartUrl` 发起 `POST`，Server 返回
`{ "qrId", "scanUrl", "expiresIn", "provider" }`。插件只把同源 `scanUrl` 编码成二维码，并轮询：

```http
GET /api/v1/auth/oauth/qr/{qrId}
```

结果为 `pending`、`complete`（含一次性 `token`）或 `expired`。手机授权后只显示完成页；
Web token 不进入二维码、手机回调 URL 或日志，并且只能由发起插件领取一次。
插件领取后立即用该 token 注册本机 device，再丢弃 web token。

旧的 `/oauth/status`、`/oauth/github/status`、`/oauth/google/status` 和各提供商
`start`/`callback` 接口继续兼容；`POST /oauth/qr/start` 省略 `provider` 时仍默认知乎。
未知 provider 返回 422，已支持但未配置的 provider 返回 503。
插件仅在列表接口返回 404 时回退查询旧的知乎/GitHub状态接口；网络故障、服务端错误和
无效列表必须显示错误与重试入口，不能假装可用。

插件 Remote 登录页在进入授权页面和 Server 切换时重新获取列表，按语言偏好优先选择
已启用的知乎或 GitHub，其余条目保留服务端顺序，未启用的偏好不会阻挡其他提供商。
命令行使用 `ds-harness-remote login list` 查看可用条目，
随后通过 `login <id>` 登录。未指定 ID 时优先选择可用的知乎，否则选择首个扫码提供商。

新增 OAuth 需要在独立 Server 实现授权、回调与账号绑定，并在其 provider discovery 注册展示名称、入口、配置检查和扫码分发。部署服务端后，已接入列表
协议的插件会自动展示；新增提供商无需再次修改、构建或发布插件。现有旧插件需先更新一次。

账号 token 当前没有 refresh 接口；过期后需要重新登录。持有有效 device refresh token
的已注册 Host 后台运行不依赖账号 token。

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
`harnessVersion`。Client 不允许使用主机匹配码，不使用配对设备码；扫码设备配对是另一条独立流程。

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

Server 每次首次刷新都会轮换 refresh token。插件必须将整组新凭证原子落盘后再废弃旧值。按 [协议 §8.2](protocol.md#82-refresh)，刷新响应丢失可恢复尚未再次轮换、撤销或过期的直接后继；若恢复 pair 的 access 已过期，保存后用其 refresh token 继续正常轮换。过时 token 被拒绝但不会撤销当前有效凭据；旧版 Server 可能仍采用重用即撤销策略。不要并发刷新，同一设备应使用 single-flight/互斥锁。

Plugin 在凭据文件旁保存 `server-credentials.json.refresh-lock` 文件。文件内容为
`DSH_REFRESH_LOCK_V2`。它标记 V2 刷新队列，也阻止 0.6.3 创建同名目录锁。
每个刷新进程用独立 Holder 文件排队。进程退出后，新进程清理已确认死亡的 Holder。
获得队列后，Plugin 重新读取凭据，再执行刷新和原子落盘。等待 15 秒后仍未入队时，
Plugin 返回 `SERVER_CREDENTIALS_BUSY`。进程状态不明时，Plugin 保留 Holder。
硬链接不可用时，Plugin 返回 `SERVER_CREDENTIALS_LOCK_UNSUPPORTED`，不执行刷新。
默认目录迁移和刷新共用目录外的闸门。迁移等待活跃刷新，并清理死亡 Holder。
迁移识别队列写入留下的 `.tmp` 文件；这些文件不授予队列所有权。
刷新失败日志只标记 `phase: credential_refresh` 与错误码，不记录响应正文或 token。

此锁正式支持 Linux 单机本地 ext4 和 XFS。WSL2 ext4.vhdx 用于开发和测试。
不要将 `DSH_HOME` 放在 NFS 或 SMB 共享目录。不要让两台主机共用凭据目录。
Windows Harness Host 的锁恢复仍待目标平台验证。Windows 上不明 PID 状态会保留锁。

升级时先停止所有 Harness Host 和 CLI 进程。确认旧进程退出后再启动新版。
旧版不能读取 V2 Marker。新版也不能接管旧版的活跃目录锁。
如需降级到 0.6.3，优先恢复升级前的完整 `$DSH_HOME` 备份。
没有备份时，先停止全部进程并备份当前 `$DSH_HOME`。
然后检查每个 `server-credentials.json.refresh-lock*` 文件，确认没有活跃 Holder。
删除 V2 Marker、Holder 和队列 `.tmp` 文件。将 `$DSH_HOME/ds-harness-remote`
改名为 `$DSH_HOME/remote`，再安装 0.6.3。不要同时保留两个根目录。
0.6.3 的凭据 schema 只接受 `account`、`host_registration_code` 和 `owned_device`。
如凭据使用新字段，保留备份并在 0.6.3 中重新授权。0.6.3 不能直接读取这些凭据。

同一 deviceId 只保留一个控制连接。收到 `4003` 时 Plugin 进入 `CONNECTION_REPLACED`
并停止自动重连；同时运行的 Host 应使用独立 `DSH_HOME` 并分别授权。
收到 `4002` 时，Plugin 使用被拒绝的 access token 对照锁内最新凭据，必要时刷新，
随后重试握手一次；新凭据仍被拒绝时停止恢复，成功完成握手才重置恢复预算。

建议在 access token 到期前 60 秒刷新。收到 `TOKEN_EXPIRED` 可刷新后重试一次；收到 `AUTH_INVALID` 或 `DEVICE_REVOKED` 应停止自动重试，清理设备凭证并提示用户重新登录/接入。

用户随后在 Remote 登录界面使用账号密码重新授权时，Plugin 会把这次显式登录视为新的授权边界：若原
`deviceId` 已被 Server 移除，则先轮换本机 identity、重建 Host 控制连接，再用刚取得的账号 token
注册新设备。这样不需要先进入设置页执行一次完整退出；后台连接仍保持 fail-closed，不会自行抢占或恢复被移除的设备。

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

Host 在启动时从当前运行入口定位 `@deepseek-ai/dsh`
运行包读取版本：CLI 入口位于该包根目录之下，沿入口祖先链查找；0.2.0 Desktop 由
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

当前 Host 使用 `[0, reconnect.maxDelayMs]` 的 full jitter 重连；默认上限 30 秒，控制恢复循环另见[恢复契约](design/control-recovery.md)。认证失败时先刷新设备 access token；设备被撤销时停止重连。

## 8. 账号授权与连接事件

Web 或其他客户端使用同一个账号登录并注册 `role=client` 后，Server 会自动为它与该账号下的 Host 建立授权边。这条普通账号路径不使用设备码；配对受限设备仍按独立配对契约确认和授权。

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

Host 必须按 `connectionId` 同时维护来自不同 `clientDeviceId` 的安全通道和对应 Harness bridge（Typert Remote）；
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

完整 hosted Server 的网页管理和 Android 使用以下接口修改账号拥有的 Host 名称：

```http
PATCH /api/v1/account/devices/{deviceId}
Authorization: Bearer <accountToken-or-authorized-client-device-token>
Content-Type: application/json

{"name":"书房电脑"}
```

请求名称去除首尾空白，长度为 1–128 个字符；成功响应包含服务端保存的 `name`。
Host 在线或离线均可修改名称，设备 ID、身份密钥和 membership 保持原值。
Android 使用已授权的 Client device token，不保存账号 token 或重新注册 Host；
服务端仍负责检查账号设备归属。此接口尚未在本仓库的最小自部署 Server 中实现，
不支持的 Server 会返回错误，Android 保留编辑内容供重试。

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

本仓库 `apps/server` 提供上述账号密码、设备注册/自有角色注册、刷新、设备详情、Control、WebRTC signaling/TURN credential 与 Relay API 子集。账号来自 `DSH_SERVER_ACCOUNT`，密码来自 `DSH_SERVER_PASSWORD`；WebRTC 的 STUN/TURN 由 `DSH_SERVER_STUN_URLS` / `DSH_SERVER_TURN_URLS` / `DSH_SERVER_TURN_SECRET` 配置，留空时保持 Relay-only。配置自定义 Server 地址后选择账号密码登录。运行方法见 [README](../apps/server/README.zh.md)。

## Device pairing v1

扫码配对是独立的设备授权入口，电脑本机确认和手机接入要求统一维护在[设备配对协议](device-pairing-v1.md)。Host 接入时按 discovery 能力判断是否提供该入口，不复制另一套 API 或状态定义。
