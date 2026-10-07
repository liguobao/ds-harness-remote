# DSH Remote Protocol v1

状态：Draft v0.2（首版发布前，不保留旧业务 RPC 兼容）
日期：2026-09-10
协议版本：`1`
实现状态：**当前仓库实现 Client/Plugin 侧协议与最小单账号 Relay Server；完整 Server 由独立项目实现**

## 0. 文档地位与仓库边界（规范性）

本文必须保留，是 Host Plugin、所有 Remote Client、共享协议包和外部 Server 的唯一线协议契约。

当前仓库负责：

- `packages/protocol` 的类型、schema、编解码和版本校验
- Plugin 的 rc.2 ApiProxy tunnel、v0.1.2 alpha.1–rc.1 与 v0.1.5 rc.1 Session V3 Typert Remote tunnel、加密、重连和 capability 行为
- Mock Host/Client 与协议 conformance fixtures

`apps/server` 实现本文的单账号注册/刷新、设备发现、Control 与 Relay 子集；范围见 [最小 Server](../apps/server/README.md)。其余多账号、主机匹配码、Browser 授权、WebRTC/TURN 与 Admin 能力仍属于独立 Server，不得把未实现的能力声明为可用。

任何与本文不一致的示例代码都视为未完成实现，不能反向修改协议语义。当前尚未发布，
旧 Android 业务 RPC 明确不兼容；首版发布后破坏兼容性的变更必须提升协议版本。

## 1. 范围

DSH Remote Protocol 定义 Host Plugin、DSH Remote Server 和 Remote Client 之间的互操作边界，包括：

- 设备注册和 Server credential
- 账号授权与 Host/Client membership
- Host 账号密码或一次性主机匹配码接入
- Remote Web 授权换取 Browser Launcher 独立设备凭证
- WebSocket authentication
- WebRTC signaling 与 Relay routing
- Host/Client 端到端安全通道
- rc.2 ApiProxy tunnel 的 unary、respond 与 mux/host streaming
- v0.1.2 alpha.1–rc.1 与 v0.1.5 rc.1 Session V3 Typert Remote 的 unary、stream 与 `$events` 双向事件 carrier
- reconnect 与原生 stream 重建
- capability 与版本协商
- 错误码、限制和安全不变量

Admin API 不属于 E2EE Remote Protocol。它是同站点的独立 HTTPS API，定义在 [server.md](server.md)。

## 2. 规范术语

本文的“必须”“禁止”“应该”“可以”是规范性要求。

- **Host**：运行 DeepSeek Harness 与 `@dsh-remote/plugin` 的设备。
- **Client**：通过 Remote transport 控制 Host 的 Desktop Harness、VS Code、Android 或 Remote Web；
  Browser Launcher 只注册 `role=client` device 以发现 Host，本身不是 Remote Client runtime。
- **Server**：负责账号授权、presence、signaling 和 opaque Relay 的协调服务。
- **Device**：具有随机 deviceId 和本地 identity key 的 Host 或 Client。
- **Membership**：Server 根据相同账号归属自动派生的 Host/Client 授权边。
- **Connection**：一个已授权 Host/Client pair 的临时通信实例。
- **Control frame**：Server 可读的 WebSocket signaling/routing JSON。
- **Remote message**：安全通道内的 RPC/Event 业务消息，Server 不可读。
- **Secure channel**：Host 与 Client 之间基于 Noise 的端到端加密会话。

## 3. 分层

```text
HTTPS REST
  account login / Web-to-Browser authorization / device token / device metadata / TURN

WSS Control Channel
  hello / connect / signaling / secure handshake relay / opaque relay

Secure Channel
  Noise transport ciphertext

Remote Protocol
  RPC request / response / error / event

Harness Business Tunnel
  rc.2 ApiProxy call / respond / mux / host
  v0.1.2 Typert Remote call / stream / events
```

业务层禁止直接调用 WebSocket、RTCPeerConnection 或 Server REST；必须通过 `RemoteTransport` 与 client/plugin core。

## 4. 编码与基础类型

### 4.1 JSON

REST、Control frame 和解密后的 Remote message 使用 UTF-8 JSON。发送端禁止输出 `NaN`、`Infinity`、负零、稀疏数组或非 JSON 类型。

接收端必须：

- 拒绝无效 UTF-8/JSON。
- 拒绝重复安全关键字段的非规范解析结果。
- 对未识别的必需 enum 值 fail closed。
- 不把原始 parser 错误直接展示给用户。

### 4.2 标识符

- `deviceId`：UUID 或 ULID 字符串。新实现应该生成 UUIDv7 或 ULID。
- 接收端必须接受已有 Client 生成的 UUIDv4 `deviceId`。
- `membershipId`, `connectionId`, `message.id`：UUIDv7 或 ULID 字符串。
- `sessionId`：Harness 原生 SessionId，不由 Server 改写。
- `requestId`：引用发起 RPC 的 Remote message `id`。
- 内层 `rpcId`：Harness rc.2 ApiProxy 原生 request/response correlation id，Plugin 不改写；alpha 的关联由官方 Gateway carrier 负责。

ID 只能用于定位，不能单独作为授权凭据。

### 4.3 时间

所有 JSON 时间使用 Unix epoch milliseconds，字段名以 `At` 结尾。TTL 同时返回绝对 `expiresAt`；Client 不应仅依赖本机倒计时做安全判断。

### 4.4 Binary/Base64URL

REST/Control JSON 中的 key、nonce、handshake 和 ciphertext 使用无 padding Base64URL。WebRTC DataChannel 可直接发送 binary Noise transport frame，不再 Base64 编码。

## 5. 版本规则

顶层协议版本字段为：

```json
{ "v": 1 }
```

规则：

- Major protocol 只有整数版本。
- 接收端不支持 `v` 时返回 `UNSUPPORTED_VERSION` 并关闭连接。
- v1 可以新增 optional 字段和 capability；不能改变现有字段语义或 enum 含义。
- 新增 RPC/Event 必须由 capability 宣告。
- 未协商的 method/event 不能发送。
- hello 的 `protocols` 是无重复版本集合。Server 选择双方支持的最高版本。
- 没有共同版本时，Server 返回 `UNSUPPORTED_VERSION` 并关闭连接。

## 6. REST 通用格式

成功响应直接返回 endpoint schema。失败响应统一为：

```json
{
  "error": {
    "code": "HOST_REGISTRATION_CODE_EXPIRED",
    "message": "The host registration code has expired.",
    "requestId": "01K...",
    "retryable": false,
    "details": {}
  }
}
```

`details` 可省略，只能包含不泄露 secret/内部栈的结构化信息。

分页响应：

```json
{
  "items": [],
  "nextCursor": null
}
```

## 7. Device Descriptor

```json
{
  "deviceId": "01K...",
  "name": "Workstation",
  "role": "host",
  "platform": "linux",
  "identityKey": "base64url-x25519-public-key",
  "clientVersion": "0.1.0"
}
```

规则：

- `role` 仅为 `host` 或 `client`。
- `deviceId` 必须是 ULID 或 UUID。新设备应该使用 UUIDv7 或 ULID。
- `name` 必须包含可见文本。UTF-8 编码后不得超过 128 字节。
- `platform` 必须匹配 `[a-z0-9][a-z0-9._-]*`。长度不得超过 64 字节。
- `identityKey` 是 Noise static X25519 public key。
- `identityKey` 必须是 32 字节公钥的规范无 padding Base64URL。编码长度必须是 43 个字符。
- `clientVersion` 和 `harnessVersion` 的 UTF-8 编码长度必须是 1 到 64 字节。
- Host 可在注册时携带 `harnessVersion`，Server 必须接受；Host 也会从 Harness
  `host.describe` 读取运行中版本并在首次 `hello` 中刷新上报。
- Client descriptor 禁止携带 `harnessVersion`。
- `name` 是不可信显示字符串，限制长度并转义。
- Server 禁止接受同一 deviceId 替换为不同 identityKey。
- Descriptor 和注册 envelope 禁止包含未定义字段。

## 8. 设备注册与 Token

面向插件实现的端到端接入步骤、错误处理和本地存储要求另见
[Host 插件接入指南](plugin-integration.md)。

### 8.1 注册

`POST /api/v1/devices/register`

Host 和 Client 的首次账号归属必须携带由同一 Server 签发的站点账号 Bearer token；
同一安装的相反角色可按 §8.1.2 从已有 device credential 继承 owner。插件默认连接
`https://dsh.r2049.cn`，也可以由用户配置自定义 Server；登录、注册、refresh、
WebSocket 不得跨域混用。注册成功后，Server 为同一账号下的 Host 与 Client 自动
建立或恢复 membership。

请求：

```json
{
  "v": 1,
  "device": {
    "deviceId": "01K...",
    "name": "Chrome on Pixel",
    "role": "client",
    "platform": "web",
    "identityKey": "...",
    "clientVersion": "0.1.0"
  }
}
```

响应：

```json
{
  "accessToken": "opaque-or-jwt",
  "accessTokenExpiresAt": 1786000000000,
  "refreshToken": "opaque-secret",
  "refreshTokenExpiresAt": 1789000000000
}
```

Access token 和 refresh token 的 UTF-8 编码长度必须是 16 到 8192 字节。
两个到期时间必须是正安全整数。

注册是账号授权的 bootstrap。Client 注册完成后可列出并连接同账号的 Host；不同
账号之间不建立 membership，也不能读取设备详情或 presence。

### 8.1.1 主机匹配码注册

除账号 Bearer token 外，Host 插件也可以使用账号网页生成的一次性主机匹配码。
该码只用于授权一个 Host 加入账号，不参与 Host/Client 连接。

账号生成匹配码：

```http
POST /api/v1/account/host-registration-codes
Authorization: Bearer <web-account-token>
```

响应：

```json
{ "registrationId": "01K...", "code": "ABCD-EFGH", "expiresAt": 1786000000000 }
```

插件注册 Host：

```http
POST /api/v1/devices/register-with-code
```

请求包含 `{ "v": 1, "code": "ABCD-EFGH", "device": <Host Device Descriptor> }`，
成功响应与 §8.1 相同。主机匹配码 10 分钟过期、单次消费、只允许 `role=host`，
Server 使用独立用途的 keyed hash 落库。

匹配码请求必须使用大写 `XXXX-XXXX` 格式。每个 `X` 只能是 ASCII 字母或数字。

### 8.1.2 自有设备角色切换

同一 Plugin 安装已持有有效 Host 或 Client device credential 时，可以用该设备 access
token 为本机注册相反角色，无需再次登录账号或输入主机匹配码：

```http
POST /api/v1/devices/register-owned-role
Authorization: Bearer <currentDeviceAccessToken>
```

请求 body 与 §8.1 相同，但 descriptor 必须使用新的 deviceId、独立 identity key 和与
当前设备相反的 role。Server 从当前设备继承 `owner_account`，拒绝无 owner、相同
deviceId 或相同 role，并为新角色签发独立 token pair、同步同账号 membership。
角色切换只复用账号归属，不得复用 Host/Client 私钥或 device token。

### 8.2 Refresh

`POST /api/v1/auth/refresh`

```json
{
  "deviceId": "01K...",
  "refreshToken": "opaque-secret"
}
```

Server 必须轮换 refresh token。旧 token 重用触发 token family revoke。Client 必须原子替换本地 token；不能在日志或 URL 中传 token。
成功响应必须使用 §8.1 的 token pair schema。请求和响应禁止包含未定义字段。

### 8.3 Remote Web 授权换取 Browser Launcher 凭证

Browser Launcher 不实现账号、密码或 OAuth 登录。用户已在 Remote Web 登录时，扩展从同源
页面临时读取当前 web token，并立即用它和本地产生的独立设备 identity 换取自己的 device
token pair：

```http
POST /api/v1/auth/browser-authorizations/exchange
Authorization: Bearer <web-token>
Content-Type: application/json
```

```json
{
  "v": 1,
  "device": {
    "deviceId": "01KBROWSER...",
    "name": "Browser on macOS",
    "role": "client",
    "platform": "browser",
    "identityKey": "base64url-x25519-public-key",
    "clientVersion": "0.3.29"
  }
}
```

响应为 §8.1 的 device token pair，并额外返回非空 `account`。约束：

- `account` 的 UTF-8 编码长度必须是 1 到 254 字节。
- exchange 只接受有效的 `typ=web` Bearer，并且只能注册 `role=client, platform=browser`；设备
  descriptor、账号归属、membership 和 token 签发规则与 §8.1 相同。
- 扩展不得把 web token 写入 `chrome.storage`、日志、URL 或长期内存；exchange 完成后只保存
  自己的 Browser device credential。
- 浏览器扩展只负责 Host presence 展示和打开 Remote Web，不实现 Remote transport、ApiProxy
  或会话 UI。点击在线 Host 后直接打开同源 `/app/remote/{hostDeviceId}`，复用浏览器现有的 Web
  登录状态；任何 token 都不得进入 URL。

## 9. 账号授权协议

账号归属是访问边界。每次 Host 或 Client 注册时，Server 为该设备与同账号下所有
未撤销的异角色设备建立 membership；后注册的 Host 或 Client 必须得到相同结果。
已撤销授权边在同账号设备重新注册时恢复，因为账号状态是权威来源。

规范要求：

- Host 与 Client 的 `owner_account` 必须非空且完全一致。
- 不允许匿名 Client 注册，也没有设备码创建、领取、确认或轮询接口。
- `GET /api/v1/devices` 只返回当前 Client 通过同账号授权边可访问的 Host。
- 设备详情、presence、TURN 和连接请求继续校验 membership，防止 IDOR。
- Server 发出 `connect.incoming` 前再次校验双方账号一致，历史跨账号授权边无效。
- Host 只接受 `authorization: "account"` 的连接事件，并使用自己的 device token
  调用 `GET /api/v1/devices/{clientDeviceId}`；只有返回的 membership、role 和
  `identityKey` 与事件完全一致，且不冲突于本机 pinned key，才把该 key 绑定到连接。
- 注销账号会清除 Client 设备 token；重新登录同账号可重新注册设备并恢复访问。

## 10. Control Channel

### 10.1 WebSocket

URL：`wss://<REMOTE_PUBLIC_URL>/ws/v1/connect`

连接后 5 秒内必须发送 `hello`。在 `hello.ack` 前，除 hello 外的 frame 均拒绝。

### 10.2 Control frame envelope

```json
{
  "v": 1,
  "id": "01K...",
  "type": "hello",
  "timestamp": 1786000000000,
  "payload": {}
}
```

Control frame 是 Server 可读 JSON，不得放置 Remote 业务明文。
Control frame 必须使用 WebSocket text message。接收端必须拒绝 binary message。

非 Relay Control frame 的 UTF-8 JSON 上限为 64 KiB。
Relay Control frame 的 UTF-8 JSON 上限为 1 MiB。

### 10.3 Hello

```json
{
  "v": 1,
  "id": "01KMSG...",
  "type": "hello",
  "timestamp": 1786000000000,
  "payload": {
    "role": "host",
    "deviceId": "01KHOST...",
    "accessToken": "...",
    "protocols": [1],
    "clientVersion": "0.2.9",
    "harnessVersion": "0.1.0-rc.8",
    "capabilities": ["transport.p2p", "transport.turn", "transport.relay"]
  }
}
```

`clientVersion` 是插件/Client 软件的版本，与 Device Descriptor §7 的 `clientVersion` 同源，用于
Server 展示设备版本和诊断；与 `hello.ack` 的 `serverVersion` 对称。插件建立连接时必须上报自己的
版本；对 Server 而言这是 v1 新增的 optional 字段，不能因为缺失或未知版本而拒绝连接。

`protocols` 必须包含至少一个非负安全整数，且不能有重复值。当前实现只支持 v1。
`capabilities` 必须是无重复的非空字符串集合。接收端必须忽略未知 capability。
发送端只能使用双方都支持的 capability。

Host 的 `harnessVersion` 优先来自本机 Harness `host.describe.version`；旧 Harness 返回已知
占位值或不提供该方法时，从当前 `@deepseek-ai/dsh` 运行包读取版本。Host 注册 descriptor
在可用时携带该值，首次 `hello` 也会再次上报以刷新设备记录。字段同样可选：插件不发送时
Server 必须保留已有值，不能清空或拒绝连接；Client 不发送该字段。

ack：

```json
{
  "v": 1,
  "id": "01K...",
  "type": "hello.ack",
  "timestamp": 1786000000000,
  "payload": {
    "protocol": 1,
    "serverVersion": "0.1.0",
    "connectionSessionId": "01KWS...",
    "heartbeatIntervalMs": 25000,
    "maxControlFrameBytes": 65536,
    "maxRelayFrameBytes": 1048576,
    "capabilities": ["transport.relay", "transport.p2p"],
    "webrtcEnabled": true,
    "webrtcFallbackTimeoutMs": 12000
  }
}
```

WebSocket 关闭后 access token 不能通过 URL/query 泄露。Server 日志必须过滤 hello payload 中的 token。

`hello.ack.capabilities` 是 Client hello 与 Server 支持能力的交集，不是 Server 的完整能力列表。
Server 不能返回 Client 未宣告的 capability。Client 后续只能使用该集合中的能力。
该字段对旧 Server 兼容为 optional。字段缺失时，Client 只能使用 `transport.relay`。

`maxControlFrameBytes` 和 `maxRelayFrameBytes` 可以声明更小的上限。
双方必须对后续收发 frame 使用该上限。大于 v1 默认值的声明必须拒绝。

`webrtcEnabled` 是可选实现扩展。值为 `false` 时，Client 只能使用 Relay。
字段缺失时，Client 可以协商 WebRTC。Client 仍必须遵守 `hello.ack.capabilities`。

`webrtcFallbackTimeoutMs` 是可选实现扩展。它必须是正安全整数。
字段缺失时，Client 使用本地超时。字段存在时，Client 使用 Server 与本地值中的较大值。

## 11. 建立 Host/Client Connection

Client control frame：

```json
{
  "v": 1,
  "id": "01K...",
  "type": "connect.request",
  "timestamp": 1786000000000,
  "payload": {
    "hostDeviceId": "01KHOST...",
    "preferredTransports": ["lan", "p2p", "turn", "relay"]
  }
}
```

Server 校验 membership、双方账号归属一致且 Host online 后创建 `connectionId`，向 Host 发送：

```json
{
  "v": 1,
  "id": "01K...",
  "type": "connect.incoming",
  "timestamp": 1786000000000,
  "payload": {
    "connectionId": "01KCONN...",
    "clientDeviceId": "01KCLIENT...",
    "clientIdentityKey": "...",
    "authorization": "account",
    "preferredTransports": ["lan", "p2p", "turn", "relay"]
  }
}
```

WebRTC DataChannel 建立后，Initiator 必须先发送 `transport.selected`，再开始 Noise
握手。Host 必须按同一 Control WebSocket 上的消息顺序，在创建 authenticated channel 前应用该
选择；不得忽略该帧并仅依赖本机异步 RTC ready 回调，否则两端可能分别把同一条 Noise channel
绑定到 WebRTC 与 Relay。Noise channel 建立后，迟到或冲突的 `transport.selected` 不得切换
已有连接的数据面。Server 必须按 `connectionId` 保持 `transport.selected` 与
`secure.handshake` 的转发顺序；Host 仍必须容忍二者被乱序交付，在 transport 尚为
`negotiating` 时暂存握手，而不能自行猜测为 Relay。

`transport.selected.payload.transport` 的允许值为 `lan | p2p | turn | relay`。`lan` 是一等
线协议值，双方声明 `transport.lan` capability 时必须端到端保留；Server 仅可为未声明该
capability、仍只接受 `p2p | turn | relay` 的旧 RC2 Host 将 `lan` 兼容降级为 `p2p`。

Host 必须要求 `authorization` 为 `account`，校验 identityKey 格式，并通过受 membership
保护的设备详情接口确认 Client descriptor。本机已有相同 deviceId 但公钥不同则必须拒绝；
验证通过后写入/更新本机 pinned peer，并把该 key 与 `connectionId` 绑定，才可返回
`connect.accepted`。安全握手期间不允许替换远端 key。

同一 Host 必须允许不同 `clientDeviceId` 各自建立并保持独立的 active connection，例如手机
Web 与电脑 Web 可同时连接。RPC pending 数、stream namespace、stream 上限与断开清理均按
`connectionId` 隔离。仅同一个 `clientDeviceId` 的新连接替换该设备的旧连接，不得关闭其他
Client 的 connection 或原生流。

Server 使用现有 `error` control frame 的可选 `payload.connectionId` 通知单条逻辑连接
断开。字段存在时 Host 只关闭该 connection 的 Noise/RTC、RPC router 和 stream，不得把错误
提升为整个 Control WebSocket 的终止状态；字段不存在时保持原有 Control/操作级错误语义。
这是兼容扩展，旧插件可以忽略未知字段。Server 对 `hello.clientVersion < 0.2.13`、缺失或
无效版本保持 last-client-wins，避免把多个 Client fan-in 到旧插件的单例连接状态。

## 12. Secure Channel

### 12.1 算法

账号授权连接使用成熟 Noise 实现：

```text
Noise_IK_25519_ChaChaPoly_SHA256
```

- Initiator：Client。
- Responder：Host。
- 双方 static X25519 key 来自账号授权的设备注册与 `connect.incoming` 事件。
- Prologue 绑定：`DSH-REMOTE`, protocol v1, connectionId, Host deviceId, Client deviceId。
- 禁止自行实现 Noise state machine 或修改算法组合。

Client 从同账号设备详情获取 Host identity key；Host 将账号授权的连接事件与同一设备
详情交叉校验后获取 Client identity key。双方必须把这些 key 固定到本机 trust store，
并绑定到 Noise 握手和 connectionId。

### 12.2 Handshake relay

Noise handshake bytes 通过 Control frame 转发：

```json
{
  "v": 1,
  "id": "01K...",
  "type": "secure.handshake",
  "timestamp": 1786000000000,
  "payload": {
    "connectionId": "01KCONN...",
    "targetDeviceId": "01KHOST...",
    "step": 1,
    "data": "base64url-noise-handshake"
  }
}
```

Server 只校验 connection ownership、step 上限和 frame size，不解析 Noise payload。

### 12.3 Transport frames

Noise handshake 完成后，Remote message JSON 作为 Noise transport plaintext。Relay 时 Noise ciphertext 放入 `relay` control frame；WebRTC 时直接发送 binary ciphertext。

Noise transport 单消息最大为 65,535 bytes（包含 AEAD tag）。编码后的 Remote message
超过 48 KiB 时，发送方必须先切成 DSH secure fragments，再逐片 Noise 加密。fragment
使用 binary plaintext：`DSHF` magic、1-byte version、32-bit messageId、16-bit index、
16-bit total、32-bit totalBytes 和最多 48 KiB payload。接收方只在同一 authenticated
channel 内按 messageId 重组，最多接受 4 MiB 的完整消息和 8 个并行重组；重复、乱序、
长度不一致或超限必须关闭 secure channel。小消息继续直接使用 Remote message JSON，
保持兼容和低开销。

每方向维护独立 nonce/counter。重复、过旧、认证失败、超限或连接不匹配 frame 必须关闭 secure channel。达到 Noise 实现建议的消息/字节阈值时 rekey 或重建 connection。

`fixtures/crypto/v1/noise-ik.json` 固定双方 static key、ephemeral private key、prologue、握手消息、
传输密文和 counter。其他实现必须产生相同的无填充 base64url 输出。
这些输出是 protocol v1 的 compatibility baseline。实现或依赖升级不得直接重写该向量。
有意改变 wire output 时必须发布新协议版本和新向量。

TLS/WSS 保护到 Server 的链路，但不能替代本节 E2EE。

## 13. Relay frame

```json
{
  "v": 1,
  "id": "01K...",
  "type": "relay",
  "timestamp": 1786000000000,
  "payload": {
    "connectionId": "01KCONN...",
    "targetDeviceId": "01KHOST...",
    "counter": 42,
    "ciphertext": "base64url-noise-transport-message"
  }
}
```

`counter` 必须是 `0..Number.MAX_SAFE_INTEGER` 范围内的整数。它用于 Server 基础限速和排序诊断，
不作为解密 nonce 的权威来源。Noise frame 内部状态才是认证依据。

Server 禁止解密、解析、缓存到数据库或记录 `ciphertext`。

## 14. WebRTC Signaling

### Offer

```json
{
  "v": 1,
  "id": "01K...",
  "type": "signal.offer",
  "timestamp": 1786000000000,
  "payload": {
    "connectionId": "01KCONN...",
    "targetDeviceId": "01KHOST...",
    "sdp": "..."
  }
}
```

### Answer

`type: signal.answer`，payload 同上并携带 answer SDP。

### ICE

```json
{
  "v": 1,
  "id": "01K...",
  "type": "signal.ice",
  "timestamp": 1786000000000,
  "payload": {
    "connectionId": "01KCONN...",
    "targetDeviceId": "01KHOST...",
    "candidate": {
      "candidate": "...",
      "sdpMid": "0",
      "sdpMLineIndex": 0
    }
  }
}
```

DataChannel 名称：`dsh`，`ordered: true`。即使 WebRTC 已加密，Remote message 仍通过 Noise secure channel，保持 Relay/P2P 相同的应用安全边界。

连接降级顺序：LAN -> P2P -> TURN -> Relay。WebRTC 候选使用 RFC 1918、链路本地或回环地址时
可记录为 LAN；Tailscale `fd7a:115c:a1e0::/48`、`100.64.0.0/10` 等 overlay/CGNAT 地址即使
以 `host` candidate 出现也必须记录为 P2P。切换 transport 不改变 secure channel peer
identity；必要时重建 Noise connection 并执行 event resync。

## 15. Remote Message Envelope

以下消息仅存在于 secure channel plaintext 中：

```json
{
  "v": 1,
  "id": "01KMSG...",
  "type": "rpc.request",
  "timestamp": 1786000000000,
  "payload": {}
}
```

`type` v1 枚举：

- `rpc.request`
- `rpc.response`
- `rpc.error`
- `event`
- `ping`
- `pong`

Control-only 类型（hello, signaling, relay）禁止出现在 secure channel 业务层。

## 16. RPC

Plugin Host 的业务路由只接受 capability 对应的官方 Harness tunnel。rc.2 使用：`harness.api.call`、
`harness.api.transfer.open`、`harness.api.transfer.chunk`、`harness.api.transfer.commit`、
`harness.api.transfer.read`、`harness.api.transfer.close`、`harness.api.respond`、
`harness.api.stream.open`、`harness.api.stream.close`。alpha 使用：
`harness.remote.call`、`harness.remote.transfer.open`、`harness.remote.transfer.chunk`、
`harness.remote.transfer.commit`、`harness.remote.transfer.read`、`harness.remote.transfer.close`、
`harness.remote.stream.open`、`harness.remote.stream.close`。所有新旧 Host 都可接受只读的
`harness.transport.describe` capability 探测；旧 Host 对此返回 `METHOD_NOT_FOUND`。
此外只允许在
`fileviewer.read.v1` capability 下的 `fileviewer.call`。可选 Codex 领域仍属于同一个 Remote Plugin，
但在线上仍使用独立的 `codex.appserver.v1` / `codex.appserver.transfer.v1` capability、
`codex.app.*` RPC 和 event namespace；只有认证 Client Plugin 内的临时展示 target 可以把它包装成
原生 Harness Session carrier，Android Client 则只能在本机内存中投影到已有移动端状态。Host、Server
与 Android 都不得伪造或持久化第二份 Harness/CodeX Session。
旧 `system.info`、`workspace.get`、`sessions.*`、`session.*`、
`permissions.respond`、`connection.ping` 与 `sync.from` 已退出 Plugin 协议，Host 必须返回
`METHOD_NOT_FOUND`。Android 旧原型不是兼容目标。

### 16.1 Request

```json
{
  "v": 1,
  "id": "01KREQUEST...",
  "type": "rpc.request",
  "timestamp": 1786000000000,
  "payload": {
    "method": "harness.api.call",
    "params": {
      "method": "session.list",
      "rpcId": "native-rpc-id",
      "payload": {}
    }
  }
}
```

### 16.2 Response

```json
{
  "v": 1,
  "id": "01KRESPONSE...",
  "type": "rpc.response",
  "timestamp": 1786000000100,
  "payload": {
    "requestId": "01KREQUEST...",
    "result": {}
  }
}
```

### 16.3 Error

```json
{
  "v": 1,
  "id": "01KERROR...",
  "type": "rpc.error",
  "timestamp": 1786000000100,
  "payload": {
    "requestId": "01KREQUEST...",
    "code": "SESSION_NOT_FOUND",
    "message": "The session is no longer available.",
    "retryable": false,
    "details": {}
  }
}
```

每个 request 必须恰好产生一个 response 或 error。事件不是 RPC 完成信号。调用端必须按 requestId 关联并在超时后丢弃晚到 response。

调用端在结果未知时不得盲目重发官方 Harness mutation。rc.2 内层 `rpcId` 保持 Harness 的
原生关联语义；alpha 保持官方 Gateway 的 `{ ok, value|error }` envelope；外层 request id
只关联隧道 response/error。

## 17. Capability

Host handshake 的 capability 例子：

```json
[
  "transport.relay",
  "harness.api.v1",
  "harness.api.transfer.v1",
  "harness.remote.v1",
  "harness.remote.transfer.v1",
  "fileviewer.read.v1",
  "codex.appserver.v1",
  "codex.appserver.transfer.v1",
  "agent.acp.v1",
  "agent.acp.transfer.v1"
]
```

建立 Noise channel 后，Desktop/Web/Android Client 必须先调用 `harness.transport.describe`，Params 为
空对象，Result 为 `{ "capabilities": string[], "workspaceTypes"?: RemoteWorkspaceTypeDescription[] }`。当前 Host 按实际注入服务动态返回
`harness.api.v1`、`harness.remote.v1` 或 `harness.remote.v3`，不得宣告不存在的 carrier。
Typert Host 必须只宣告与本机 Session wire 对应的一项：v0.1.2 使用
`harness.remote.v1`，v0.1.5 rc.1 使用 `harness.remote.v3`；禁止同时宣告两项。旧 Host 返回
`METHOD_NOT_FOUND` 时，Client 才使用 `clientVersion` 做 rc.2 保守降级。

ACP 的 `agent.acp.v1` / `agent.acp.transfer.v1` 及 `agent.acp.<backend>.v1` 声明表示
Host 已启用且实现该后端协议，不代表 CLI 已初始化完成。ACP 后台初始化不阻塞 Harness Remote
上线；初始化中或启动失败时，`workspaceTypes` 对应项的 `available` 必须为 `false`，数据面调用
返回不可用。关闭的后端不声明能力；明确选择的后端不可用时禁止转发到其他后端。后端就绪后，
再次调用 `harness.transport.describe` 可取得最新可用性，无需重新建立加密连接。

### 17.1 工作区类型能力声明（workspaceTypes）

为支持 Web 等客户端动态渲染工作区类型选择器并避免在前端硬编码判断，Host 在 `harness.transport.describe`
响应中提供结构化的工作区类型列表 `workspaceTypes`：

```json
{
  "capabilities": [
    "transport.relay",
    "harness.api.v1",
    "harness.api.transfer.v1",
    "codex.appserver.v1",
    "codex.appserver.transfer.v1"
  ],
  "workspaceTypes": [
    {
      "id": "codex",
      "name": "CodeX",
      "capability": "codex.appserver.v1",
      "available": true
    }
  ]
}
```

#### 概念区分

在 Remote 协议中明确区分以下三层概念：

1. **工作区类型（workspace type）**：
   - 表示 Host 支持的工作区类型与协议载体形态（例如 CodeX）。
   - `id` 使用稳定的小写标识符（如 `codex`）；`name` 仅用于展示（如 `CodeX`）；`capability` 为关联的底层能力标识（如 `codex.appserver.v1`）；`available` 表示当前真实可调用。
   - Web 端与客户端通过遍历 `workspaceTypes` 动态渲染工作区类型入口，无需为新类型增加前端分支判断。
   - 严禁将项目路径、会话内容、prompt、文件内容或 tool output 放入能力描述响应。
2. **工作区 / 项目（workspace / project）**：
   - 表示 Host 上的具体项目目录实体（例如 CodeX 的具体 project root 目录，或 Harness 原生 workspace 目录）。
   - 具体项目依然通过各工作区领域的数据面接口（例如 `project/list`、`thread/list` 中的 cwd 或 Harness workspace 列表）获取，绝不混入类型声明。
3. **会话（session / thread）**：
   - 表示在具体工作区/项目上下文中的具体交互会话。
   - 例如 CodeX Thread（`codex:<threadId>`）或 Harness Session ID，由各会话生命周期与消息流管理。

#### 准确性与兼容约束

1. **真实可用性判定**：
   - 只有真实可调用工作区运行时（如 CodeX App Server）且能力协商完成（`account/read` 成功确认已登录）时，才声明 `available: true`。
   - 若服务启动失败、权限不足、未登录、协议不兼容或能力未协商成功，必须返回不可用或直接省略该条目，严禁仅根据本地安装文件存在就声明可用。
2. **双向兼容性**：
   - 继续保留现有的 `capabilities` 字符串数组；不支持 `workspaceTypes` 的旧客户端仍可通过 `codex.appserver.v1` 工作。
   - 新客户端支持读取 `workspaceTypes`，并在未提供时平滑回退；遇到 malformed 数据安全容错，不得崩溃。
   - 不修改现有的 Harness Remote、WebRTC、Relay、Noise 加密和 Server 中继协议。
3. **新增工作区类型扩展规范**：
   - 后续扩展新的工作区类型时，必须配套提供：
     1. 对应的 `capability` 标识；
     2. `workspaceTypes` 中的声明条目（稳定小写 `id` 与展示名称 `name`）；
     3. 对应的数据面 RPC / Stream / Event allowlist 策略及通道隔离实现。

Web 接入时，`workspaceTypes` 是现有 `harness.transport.describe` 响应的可选加法字段，
无需修改 Server 中继或握手协议。既有 Harness / CodeX 数据面应直接复用；新客户端优先读取
有效的类型条目及 `available`，旧 Host 未提供该字段时才沿用 `capabilities` 判断。类型列表
不是 Harness 入口的完整替代：当前 Host 单独声明 CodeX 和已启用的 ACP 后端，Harness
入口仍由原有 `harness.api.v1` / `harness.remote.v1|v3` 能力决定。未知类型可以展示其 `name`，
但只有已有对应 RPC / 数据面处理器时才允许进入，不得据类型声明代理任意方法。

ApiProxy 与 Typert Remote contract 仍随 Desktop Plugin 发布物升级，但新增的可选业务能力
必须保持加法兼容。当前实现不翻译 rc.2 与 alpha 的完整 Harness 业务模型：本地与远端
carrier 或 Session 代际不一致时，Desktop Client 必须在选择目标、创建 Workspace 或其它 mutation 前
返回 `HARNESS_VERSION_INCOMPATIBLE`。

当前最低兼容矩阵：

| Host Plugin / Harness | 业务 carrier | Remote Workspace / Session | File Viewer | 图片分块 |
| --- | --- | --- | --- | --- |
| `0.3.15–0.3.23` / rc.2 | `harness.api.v1`（旧 Host 由版本降级识别） | 支持 | `0.3.17+` 且 provider 存在时支持 | 不支持 |
| `0.3.24–0.3.36` / rc.2 | `harness.api.v1` | 支持 | provider 存在时支持 | `harness.api.transfer.v1` |
| `0.4.x` / rc.2 | capability 探测返回 `harness.api.v1` | 支持 | provider 存在时支持 | `harness.api.transfer.v1` |
| `0.4.x` / v0.1.2 alpha.1–rc.1 | capability 探测返回 `harness.remote.v1` | 支持 | provider 存在时支持 | `harness.remote.transfer.v1` |
| `0.4.12+` / v0.1.5 rc.1 与 v0.1.6 alpha.1 | capability 探测返回 `harness.remote.v3` | 支持 | provider 存在时支持 | `harness.remote.transfer.v1` |

未知版本按 `0.3.15` 之前的能力处理。未来 Server 暴露 Host capability 后，应优先使用
capability，`clientVersion` 仅保留为旧 Server 的兼容路径。

## 18. 历史数据结构（已废弃）

§18.1–18.6 是冻结 Android 原型的旧投影，已在代码中清除，不是 Plugin Host 可接受或
发出的结构。业务结构以 rc.2 官方 ApiProxy 或 v0.1.2 alpha Typert Remote contract 为准。

原结构包括：SystemInfo、WorkspaceInfo、SessionSummary（含 status/createdAt/lastSeq）、
Message（含 role/content 数组）、ToolCall（含 callId/input/output）和 PermissionRequest
（含 status/expiresAt）。这些类型不再出现在 `packages/protocol` 中。

## 19. Core RPC Methods

旧 Core RPC（`system.info`、`workspace.get`、`sessions.list`、`sessions.get`、`sessions.create`、
`session.send`、`session.stop`、`permissions.respond`、`connection.ping`、`sync.from`）
均已退出 Plugin 协议，Host 必须拒绝。

### Native Harness API bridge

`harness.api.v1` 用于让安装了 Plugin Client face 的本地 Harness 继续使用官方 UI 操作远端 Host。它不是通用反射 RPC；Host 必须以代码内固定 allowlist 校验每个 `method`，未知或禁止方法返回 `METHOD_NOT_ALLOWED`。

#### `harness.api.call`

Params：

```json
{
  "method": "session.list",
  "rpcId": "native-harness-rpc-id",
  "payload": {}
}
```

Result 是 Harness `ApiProxy` 的原生 `RpcResponse`，必须回显内层 `rpcId`。v1 allowlist 仅包括：

- session list/search/create/history/models/selectModel/rename/fork/prompt/attachment/updateQueue/cancel
- subagent list/history/prompt/interrupt
- `host.describe`、`host.listDirectory`（只读目录元数据，用于远程 Workspace 选择器）
- workspace list/create/rename/delete/reorder/attach/archive
- skill list、agent preset list/select/read
- goal create/edit/pause/resume/complete/clear
- `commands.list`、`commands.execute`（经官方 Typert gateway 分发，使用 Host 对当前 Agent 的有效注册命令）
- LLM provider/model list
- Host 设置与模型发现平面：`settings.describe/update/replace/mutate`、`credentials.describe/set/unset`、`llm.discoverModels`

`session.attachment` 只转发 Harness 原生的只读查询；Host ApiProxy 必须验证 attachment 已被指定 session 的持久化日志引用后才返回内容。它不能创建、上传、修改或枚举附件。明确禁止 native path open/picker、`settings.openDocument`、目录创建、绕过 File Viewer provider 的文件读取、attachment upload、download 以及任何未列出方法。`host.listDirectory` 只返回单层目录元数据。Host 应优先调用官方 ApiProxy browse capability；当桌面 Harness 只组合 `native` picker 时，Plugin 可在已认证的 Host bridge 内提供等价的只读元数据实现。该兜底必须限制结果数量，只返回目录名、绝对路径、面包屑、Home 路径和 hidden 标志，不得读取文件内容、写入文件系统或扩展为通用文件系统 RPC。若该只读列表能力可用，Bridge 可在 `host.describe` 响应中补充 `canOpenPath: true`，仅用于让 Remote Web 显示目录浏览入口，不代表允许 native picker 或打开路径。`commands.list` 与 `commands.execute` 不是通用方法调用入口：Bridge 必须要求 payload 仅含 `agentId`（`execute` 另含长度受限的 `line` 和空附件数组；当前字段名为 `submittedAttachments: []`，旧 Client 使用 `images: []` 时 Host bridge 会按 Typert descriptor 自动兼容，省略两者时注入空数组），并经官方 Typert gateway 使用 Host 对当前 Agent 解析出的有效命令目录和 handler。命令语法、名称解析、Agent scoped shadowing、参数校验和执行语义均由 Host 命令注册表负责，与本地 Harness UI 一致；未注册命令不会进入 handler。额外字段、非空附件数组、缺失必需参数和超长输入在 Bridge 边界 fail closed。外层 Remote request id 负责安全通道去重，内层 `rpcId` 保持 Harness UI 的原生关联语义。

命令附件字段按 Host 版本选择：v0.1.5 及以上使用 `submittedAttachments`，更早版本使用 `images`；未知版本按旧字段处理。

Host 设置平面允许已认证且通过本地 identity 固定的 Remote peer 配置 Host 当前注册的设置分区，必须满足以下作用域约束，否则在 Bridge 边界 fail closed：

- `settings.update/replace/mutate` 的目标命名空间必须存在于 Host 原生 `settings.describe` 实时返回的目录中（未注册或目录不可用即拒绝）；`patch`/`section`/`ops` 序列化后不得超过 64 KiB，`ops` 最多 64 条，`path` 最多 8 段且每段不超过 64 字节，`ns` 不超过 128 字节。
- `settings.describe` 返回原生 seam 当前注册的全部命名空间及其已经过原生 secret redaction 的值；Bridge 必须强制把 `hasDocument` 设为 `false`。写入仍可携带 `expectedRevision`，冲突语义由原生 seam 决定。
- `credentials.describe/set/unset` 沿用 Harness 官方的全局 credential-reference 语义。引用名称必须是 POSIX 环境变量形态（`^[A-Za-z_][A-Za-z0-9_]*$`，最长 128 字节），`set` 的 value 最长 8 KiB。credential 值只允许在 `credentials.set` 入站方向出现，不得写入日志、不得出现在任何响应里。
- `llm.discoverModels` 只允许探测 HTTPS 端点（localhost 允许 HTTP），禁止 URL 内嵌凭据和 fragment；`baseURL` 最长 2048 字节，`apiKey` 最长 8 KiB，且仅作草稿探测，Host 不存储、不返回该 key。Bridge 必须把所有探测失败折叠为固定的 `model-discovery-failed` 文案和不含 endpoint/key 的安全 details，不得透传 adapter 错误消息。
- `settings.openDocument`、native path open/picker、目录创建、任意文件访问仍然禁止。设置写入不允许命中实时注册目录以外的命名空间；credential 引用、设置 payload 和模型发现端点必须继续满足上述边界。

#### `harness.api.transfer.*`

`harness.api.transfer.v1` 是 `harness.api.call` 的有界分块封装，用于 rc.2 图片 prompt 和
`session.attachment` 响应超过单条 4 MiB secure message 的情况。分块重组后的内容仍必须是
完全相同的 `{ method, rpcId, payload }` 原生 envelope，并再次经过固定 allowlist；它不是新的
Harness 业务协议，也不能绕过 ApiProxy。Client 不直接调用 DeepSeek Files API，API key、图片
预处理、上传与 file id 缓存仍只存在于 Host 的官方 adapter。

- `open`: `{ transferId, totalBytes, totalChunks }`，每个 authenticated connection 最多两个活动输入 transfer。
- `chunk`: `{ transferId, index, data }`，`data` 为 canonical base64，解码后每块最多 512 KiB，必须从 0 开始严格有序且恰好一次。
- `commit`: `{ transferId }`，完整重组并调用原生 ApiProxy；小响应内联返回，大响应返回 `{ kind: "chunked", transferId, totalBytes, totalChunks }`。
- `read`: `{ transferId, index }`，严格顺序读取响应分块。
- `close`: `{ transferId }`，成功、取消或失败后释放输入/输出状态；连接断开时 Host 必须清除该连接的全部 transfer。

单个 transfer 上限 288 MiB（容纳上游默认 200 MiB source image aggregate 的 base64
envelope），空闲 2 分钟过期。任何重复 id、乱序、重放、非 canonical base64、声明长度不符、
超限或跨 connection transfer id 都必须 fail closed。每个 chunk 仍作为独立 Remote RPC 经过
Noise 加密、计数器防重放和 membership/trusted-peer 校验。

#### `harness.api.respond`

Params：`{ "message": ClientResponse }`。只用于回答由 Harness 原生事件流发出的 approval/question ServerRequest；`rpcId` 必须由同一 `connectionId` 的 mux stream 实际发出，Client 不能自行创造可回答的 Host request，也不能回答只发送给其他 connection 的请求。

#### `harness.api.stream.open` / `harness.api.stream.close`

Open Params：

```json
{
  "streamId": "client-stream-id",
  "stream": "mux",
  "rpcId": "native-open-rpc-id",
  "payload": {}
}
```

`stream` 仅允许 `mux | host`，每条 peer connection 最多同时打开三个原生流：常驻的 host/mux 各一条，加一条 mux 切换缓冲。mux 流的 `payload` 可携带可选 `sessionId`（focus）：提供后 Host 只转发该 session 的 mux 帧（`session/event`、approval、question 等），其余 session 的流量不进入 tunnel；省略时转发全部。Remote Web 每次只关注一个 session，用 focus 避免把其他活跃 session 的大事件流（可能达数 MB）推过 WebRTC/relay 数据面。切换 session 时 Client 先打开新 mux，成功后立即关闭旧 mux；新流失败时保留旧流。Close Params：`{ "streamId": "client-stream-id" }`。`streamId` namespace、三条流上限和生命周期都属于发起它的 `connectionId`；不同 Client 可使用相同 `streamId`，不得互相关闭或接收对方的 tunnel event。连接替换、撤销或断开时 Host 只取消该 connection 的全部流。

### Harness v0.1.2 alpha.1–rc.1 / v0.1.5 rc.1 Typert Remote bridge

`harness.remote.v1` 只承载 `dsh-v0.1.2-alpha.1`–`rc.1` 官方 `TypertGateway` 已编码的 carrier
envelope；`harness.remote.v3` 承载 `dsh-v0.1.5-rc.1` 的相同官方 carrier 与 Session V3
业务 envelope。Plugin 不解析或重建远端 Harness Session、Workspace、Approval、Question 等业务模型，也不
注册第二套 Remote namespace。

两项 capability 复用相同的 `harness.remote.call`、stream 与 transfer RPC。它们的区别是
Session 业务语义：V3 使用 `SessionWireHeader.version = 3` 与 `isSeeded`，replacement surface
operation 使用 `{ op: "replace", startSeq, endSeq }`，实时 Assistant 输出使用
`assistant-stream` frame，并要求最终 `assistant/message.data.stream`。v0.1.2 的 replacement 使用
`{ op: "replace", start, end }`。Desktop Client 不在 v0.1.2 与 V3 格式之间翻译，只允许相同代际互连；
Android 与 VS Code 可直接消费各自已声明支持的 Host 格式。

#### `harness.remote.call`

Params：

```json
{
  "endpoint": "workspace/create",
  "payload": { "args": { "request": { "path": "/workspace/project" } } }
}
```

Result 必须保持官方 Connection RPC 结果：`{ "ok": true, "value"?: ... }` 或
`{ "ok": false, "error": { "code", "message", "details" } }`。Host 通过启动时捕获的本地
Gateway dispatcher 调用，禁止回到已切换的 Client facade 形成递归。

固定 allowlist 包括原生 UI 所需的 Session、Workspace、Commands、Goals、Settings、
Credentials、LLM、Skills、Subagents、Message Feedback、Plugin Inventory、File References、
Session Reference、只读 `directoryPicker/list` 与布尔能力探测 `session/canOpenWorkspacePath`
endpoints，以及 Gateway 内部的 `$events` 和
`$events/result`。明确禁止 `directoryPicker/pick`、`directoryPicker/createDirectory`、
`session/openWorkspacePath`、Settings/native open、动态 Cordis package/source/runtime 操作、
Agent Preset copy/delete 和任何未列出的 endpoint。endpoint 必须命中代码内固定集合，不能
根据 Typert registry 动态扩张。`directoryPicker/list` 遇到只支持 Browser capability 的 Host
picker 时，可以退回 Plugin Host 本地只读目录枚举；`session/canOpenWorkspacePath` 可基于该
受限枚举返回 `true`，且仍只允许单层目录元数据。Client 的 Gateway target switch 必须让
`dynamicCordisRunner/*` 固定调用本地 Gateway，不得因选中远端 Host 而把本机 UI/runtime
装载请求转发到 Host。

#### `harness.remote.stream.open` / `harness.remote.stream.close`

Open Params：`{ "streamId", "endpoint", "payload" }`；Close Params：`{ "streamId" }`。
`endpoint` 可为 allowlisted stream Remote（例如 `workspace/follow`、`session/follow`、
`session/control`）或 `$events`。每个 authenticated connection 最多 16 条 alpha stream；
stream id、取消和断开清理均按 `connectionId` 隔离。

Host 对每个 item 发送 `harness.remote.frame`：

```json
{ "streamId": "...", "hasValue": true, "value": {} }
```

`value` 可省略，此时 `hasValue: true` 表示官方 stream 实际产生了一个 `undefined` item，
不能把它解释成流结束。终止通过 `harness.remote.stream.closed` 单独发送，reason 为
`cancelled|completed|failed|peer-disconnected`；`failed` 可携带 Gateway 归一化后的
`failure: { code, message, details }`。

`$events` 是官方 alpha Gateway 的 Host-to-Client Cordis event stream。Client 对 waterfall
事件的结果必须经 allowlisted `$events/result` unary endpoint 返回原 Host；Plugin 不创造
permission id、decision enum 或额外响应状态机。

#### `harness.remote.transfer.*`

`harness.remote.transfer.v1` 是 `harness.remote.call` 的有界分块封装。操作、512 KiB chunk、
288 MiB 总大小、严格有序/恰好一次、canonical base64、每连接输入/输出各两个 transfer 和
2 分钟 idle 规则与 `harness.api.transfer.v1` 相同。重组后的 JSON 必须仍是
`{ endpoint, payload }`，并再次经过同一固定 endpoint allowlist；它不能绕过 Gateway 或
扩展可调用业务面。直接调用若收到 `RESPONSE_TOO_LARGE`，Client 必须以相同请求自动重试一次
该分块路径；其他错误不得触发隐式重试。

新版 DSH 0.1.6 的 `permissions` Session 投影仅保留 `currentValue`；选项通过官方
`permissionPresets/catalog`（`{ args: {} }`）读取，返回 `{ options: [{ value, name, description? }] }`。
Host 固定 allowlist 仅增加该只读 endpoint；预设切换继续使用官方 `commands/execute`。
旧版投影自带 `options` 时继续使用原选项。catalog 不可用时不得猜测选项或提升权限。

### Native sidebar: read-only files and Host-configurable terminal

Harness `0.1.6-alpha.2` 原生侧栏通过现有 `harness.remote.*` carrier 传输；不新增 Harness wire format。
固定只读 allowlist：`workspaceFiles/list|stat|read|readBytes|readAll|readRelated|changes`，以及
`officeToPdf/generation|render`。Host 官方 Session lookup、组合文件系统、分页与大小限制继续生效。
注意：上游 `list` / `changes` 限于工作区；文件读取遵循 Session 文件系统权限，允许工作区外的已授权文件，
不能把“只读”表述成“只能读取 cwd 内文件”。旧 `fileviewer.read.v1` 仍使用 provider 授权。
对 `codex:<threadId>` scope，Host 使用 CodeX thread 当前 `cwd` 作为独立根目录，并额外拒绝根目录之外的路径；
该映射不改变 Harness Session 的既有工作区权限。CodeX 终端同样按 thread 建立独立 context。

`terminal.enabled` 默认 true。Host 本地开关切换即保存并更新拦截，在后续加密 capability 探测中宣告 `harness.terminal.v1`。
只允许 unary `terminal/environment|shells|list|create|write|resize|rename|close` 与 stream
`terminal/follow|retain`；不允许 wildcard、exec、spawn 或改变官方终端语义。
关闭时，任何终端调用都返回 `TERMINAL_DISABLED`，提示用户在 Host 本地开启开关后重试。
这个提示不能用于一般登录/连接失败。开关是对受信任 Remote 设备的 Shell 授权，不是 Agent 审批：
终端继承 Host 执行环境系统用户权限，cwd 不是 filesystem sandbox。

Host 生命周期内记录 `(sessionId, terminalId) -> authenticated deviceId`，最多 256 个归属记录；
Client 不能接管本地创建或其它设备的终端。list 仅返回本设备归属；write/resize 还必须命中当前连接
建立的 attachment。断开结束 follow/retain，不重放 write；重新连接通过官方快照恢复已保留的终端。
进程回收遵循上游保留/空闲策略，Host 重启不恢复进程。终端关闭成功移除归属。

Host 访问设置禁止由 Remote `settings/update|replace|mutate` 修改（命名空间
`ds-harness-remote`、`dsh-remote`，包括 legacy ApiProxy）；只能通过 Host 本地设置入口修改。
加密发送串行化，队列最多 8 MiB / 256 消息；Relay 等待 WebSocket 缓冲回落至 512 KiB，
最多等待 10 秒，失败关闭通道。Client stream 队列最多 4 MiB / 256 帧，超限终止流并要求恢复。
这些上限不保证终端每一行输出都可保留；恢复使用上游有界屏幕快照。

### Restricted loopback preview

Capability `loopback.http-ws.v1`，唯一方法 `loopback.call`，schema 和共享类型在
`packages/protocol/src/loopback.ts`。所有请求必须经已有 membership + trusted identity + Noise 通道。
Host `loopback.ports` 是本地配置的端口白名单，默认空，最多 16 个，范围 1024–65535；在 Host 本地保存后立即生效，无需重启。
撤销端口时 Host 必须关闭所有连接中该端口已有的 HTTP/WebSocket 句柄，包括等待响应或握手的请求，
结束挂起的读取并丢弃该句柄缓存的数据；仍被允许的端口不受影响。重新允许端口后必须新建句柄，不能恢复已撤销的句柄。
目标固定 IPv4 `127.0.0.1`，不接受 hostname、URL、DNS、CONNECT、TLS 或任意 TCP 通道。
请求 HTTP body 允许 POST/PUT 等开发服务操作；这不是只读文件通道，授权端口意味着允许与该服务交互。

请求为以下严格对象：

- `{op:"describe"}` → `{ports:number[]}`。
- `{op:"http.open", id:UUID, port, path, method, headers:[name,value][], body?:base64}` → `{status,headers}`。
- `{op:"http.read", id}` → `{data:base64,done:boolean}`，按需读取最多 64 KiB，一次仅一个在途 read。
- `{op:"ws.open", id, port, path, headers, protocols:string[]}` → `{protocol:string}`。
- `{op:"ws.send", id, data:base64, binary:boolean}` → `{sent:true}`；按顺序发送，不重放。
- `{op:"ws.read", id}` → `{messages:[{data,binary}],closed:boolean}`，最多等待 20 秒；仅一个在途 read。
- `{op:"close", id}` → `{closed:true}`，幂等清理 HTTP/WS handle。

handle 按加密连接隔离；最多 16 个。HTTP 头等待 20 秒，请求体最大 1 MiB，响应最多 64 MiB；
WS 单消息最大 256 KiB、待消费队列最大 1 MiB / 256 消息。60 秒没有 RPC 活动回收 handle；
断线清理全部 handle。禁止 Host 自动跟随 HTTP 或 WS 重定向；不记录 headers/body/URL 查询内容。

Client Plugin 在本机 `127.0.0.1` 的随机端口创建代理，每个 Host 端口使用独立随机
`dsh-<192-bit secret>.localhost` origin。必须验证完整 Host 与有值的 Origin，拒绝 service worker 注册，
移除 hop-by-hop headers、Cookie Domain 和跨 origin 重定向。上游 Origin 按已授权目标重写，
HTTP 请求/响应和 WS 消息在端到端加密通道中传输，Relay 只处理密文。
浏览器→本机代理与 Host→loopback 服务是本机 HTTP/WS，不宣称这两段是 TLS。

第一版入口是 Desktop / 浏览器连接本机 Harness 时的 Remote Header「预览服务」，输入授权端口后
打开原生 Browser tab；相对资源路径与使用当前 origin 的 HMR WebSocket 可正常转发。
硬编码远端 localhost 地址、外部重定向、HTTPS upstream、远程 Web preview gateway、Android/VS Code
预览 UI 不在本版范围。浏览器必须支持 `.localhost` 的 loopback 解析；预览域名是临时访问凭据，
退出 Remote 或断线关闭监听器。普通公网网页仍由原生侧栏浏览器直接访问。

### File Viewer read bridge

`fileviewer.read.v1` 仅用于把已安装 `dsh-file-viewer` 的现有只读能力带到 Remote UI，
不构成通用文件系统 RPC。业务方法只有 `fileviewer.call`：

```json
{
  "endpoint": "readRange",
  "payload": {
    "path": "/workspace/report.csv",
    "offset": 0,
    "length": 524288
  }
}
```

`endpoint` 只允许：

- `stat`：payload `{ "path": locator }`；
- `readRange`：payload `{ "path": locator, "offset": nonNegativeInteger, "length": 1..524288 }`；
- `list`：payload `{ "path": locator }`，返回最多 1000 项。

Host 必须调用 `fileViewerHost` 服务，让被选中的 File Viewer provider 执行根目录或 locator
授权；Remote 不得直接调用 Node filesystem 绕过该边界。Host 必须再次验证返回 schema 和
大小。Client 可把多个不超过 512 KiB 的 range 拼成 File Viewer 所需的较大读取。

禁止 `readHead`（Client 以 offset 0 的 `readRange` 实现）、`openExternal`、写入、上传、删除、
重命名、执行和任意 endpoint。Host 未安装 File Viewer、请求超限、provider 拒绝或返回异常时
必须 fail closed。错误不得回显 Host 内部路径或原始 filesystem 异常。

### Agent ACP domain

Agent ACP 是现有 Remote Plugin 内部的通用业务面（见 #65），不是第二个 Plugin，也不是
Codex 专用 API。Host 通过 `acp.enabled` 和 `acp.backends` 独立配置 Cursor / Antigravity
adapter 的启用、command、args 与 cwd；旧 `cursor.enabled` / `cursor.binary` 仅兼容 Cursor。
`agent.acp.v1`、`agent.acp.transfer.v1` 与 `agent.acp.<backend>.v1` 表示启用且已实现的协议；
实际就绪状态见 `workspaceTypes.available`，后台初始化不得阻塞 Harness Remote。
现有 `harness.api.*` / `harness.remote.*` 和 `codex.app.*` 的线协议、路由与能力不受影响。

业务 RPC 固定为 `agent.acp.call|respond|stream.*|transfer.*`，事件固定为
`agent.acp.frame|stream.closed`，所有 Client（包括 Web）使用同一独立 ACP 数据面。
`agent.acp.call` 不是通用代理；编译期 allowlist 仅含 `initialize`、`session/new`、`session/load`、
`session/prompt`、`session/cancel`、以及 Host 扩展 `dsh/directoryList`、`dsh/workspaceList`、
`dsh/sessionList`、`dsh/sessionHistory`。这些 `dsh/` 名称是 ACP call 内的 Host 扩展，
不得通过 Harness ApiProxy / Typert 业务端点调用。

Client 侧 `initialize` 由 Gateway 返回 backend-neutral 能力描述，不把 Cursor 私有 method 名暴露为公共面。AGY 的
`dsh/sessionList` 在指定有效工作目录时可异步预热该目录的一个空闲进程，不等待初始化、
不发送 prompt，也不注册客户端 Session；`session/new` 才领取预热进程。AGY 摘要数据库
中零步数且无标题的记录若已有持久化 transcript，历史发现应按数据库中的工作区归属
恢复该会话；没有 transcript 的空闲预热进程不显示为历史会话。Remote 在 AGY 回复完成
和历史重新发现时读取持久化标题，并以有序 title projection 更新已有会话；AGY 标题
为空时使用 transcript 中首条用户消息的摘要，不修改 AGY 数据库。`session/new`
强制 `mcpServers: []`，cwd 必须经 `realpath` 确认为 Host 上已存在的绝对目录。Cursor Prompt
仅允许文本块；AGY 还允许 `{ type: "image", mimeType, data }`（canonical base64、PNG/JPEG/WebP/GIF，
每张最多 8 MiB，每次最多 4 张）。`session/prompt.backend` 可显式指定后端，必须与已有会话后端
一致，图片不能转发到 Cursor。图片 Prompt 和含图片的 History 使用已有 ACP transfer 分块通道。
按用户 2026-10-07 授权，Host 在 tmp 专用私有缓存按会话哈希目录和随机文件名保存图片，
总量上限 512 MiB，拒绝越界和 symlink；24 小时后在后续上传时清理，系统也可能提前清理 tmp。
AGY 1.3.0 的 stream-json 不接受 image block，Host 将缓存目录加入 AGY `--add-dir`，
用 text 内的受限引用让其 `view_file` 读取图片。缓存目录不作为 Workspace 暴露。
Remote 将图片投影到原生 user/message 与 session/attachment，仅返回所属 Session 引用的图片；
历史从该 AGY transcript 的引用恢复仍有效的附件，用户文案移除内部缓存引用。
不得接受 Client 提交的文件路径，不提供通用文件上传 RPC，不写入项目目录。权限类上游请求经 `agent.acp.respond` 回传（`allow-once` / `allow-always` /
`reject-once` / `cancel`）。有序 `session/update` 与 `session/request_permission` 经
`agent.acp.frame` 下发。

Web / Desktop 可在 Client 内存中把 ACP Workspace / Session 投影到原生 Harness UI，
该投影不改变 Harness Host API，也不写入 DSH SessionStore、Workspace 数据库或日志。
客户端工作区发现与历史读取只调用 ACP 接口，不回退读取 Client 本机的 AGY 数据库或文件。
新工作区 ID 分别使用 `cursor:cwd:<encoded-path>` 和 `antigravity:cwd:<encoded-path>`；
工作区只接受所属后端前缀，不兼容旧 AGY 的 `cursor:cwd:` ID，也不接受无前缀路径作为 ID。既有 Session ID（Cursor `cursor:`、AGY `acp:`）
保持不变。`agent.acp.v1` 仅表示公共 ACP 数据面；Cursor 和 AGY 分别必须明确声明
`agent.acp.cursor.v1` 和 `agent.acp.antigravity.v1`。ACP 尚未发布使用，不提供旧 ACP
配置或工作区 ID 的迁移逻辑。
`dsh/sessionHistory` 使用有界 ACP transfer 读取含图片或大文本的响应；图片 Prompt 的
transfer commit 使用与普通 Prompt 相同的长超时，chunk 顺序、大小与连接归属校验不变。
History 显式后端及 Session 前缀必须与已绑定的后端一致；Cursor History 不读取 AGY transcript。

Cursor adapter 实现细节见 [ACP Remote](acp-remote.md)。

### Codex App Server domain

Codex 是现有 Remote Plugin 内部的可选独立业务领域，不是第二个 Plugin。Host 本机配置
`codex.enabled: true` 后，Plugin 才可使用配置的 `codex.binary` 启动 `codex app-server`。Plugin
与 App Server 只使用默认 stdio JSONL；App Server 不监听 Remote/公网端口。初始化与账户状态探测
成功后，Host 才宣告 `codex.appserver.v1` 与 `codex.appserver.transfer.v1`；Workspace authority 在
首次读取时按下述规则解析，空 `project/list` 不得让已经可用的 Codex domain 整体降级。
当 `codex.binary` 保持默认值时，macOS Host 可以优先发现 ChatGPT App 内置 Codex 后再回退到
`PATH`；用户显式配置的 binary 不得被替换或补充候选项。

Client Plugin 可在用户从 Remote 工作区选择器进入 CodeX 模式后，将已认证的 `codex.app.*`
carrier 包装成临时 rc.2 `ApiProxy` 或 v0.1.2 Typert target。该 target 只在内存中把 CodeX 工作目录、
Thread、History/live frame 映射为 DSH 原生 Workspace/Session/Event，使原生 Conversation Renderer
和 Composer 可以消费；它不是新的线协议，也不得把虚拟记录写入 DSH SessionStore、Workspace
数据库或 Harness 日志。退出 CodeX 模式或连接关闭时必须销毁 target 和全部 stream。
Android Client 可在相同 capability 探测后直接消费该 `codex.app.*` carrier，并只在 Android 内存中
把 Workspace catalog、Thread 与 History/live frame 投影到已有 Workspace/Session/Chat 状态；不得据此
恢复冻结的旧 Android `sessions.*`/`session.*` RPC，也不得持久化第二份 CodeX 数据。

业务 RPC 固定为：

- `codex.app.call`、`codex.app.respond`；
- `codex.app.stream.open`、`codex.app.stream.close`；
- `codex.app.transfer.open|chunk|commit|read|close`。

`codex.app.call` envelope 为 `{ "method": string, "params": unknown }`，但它不是通用 JSON-RPC
代理。Host 编译期 allowlist 仅包含 `account/read`、`model/list`、`project/list`、`project/create`、`thread/list`、
`thread/read`、`dsh/sessionHistory`、`dsh/directoryList`、`thread/start`、`thread/resume`、`thread/fork`、
`thread/name/set`、`thread/archive`、`thread/unarchive`、`thread/unsubscribe`、`turn/start`、
`turn/steer` 与 `turn/interrupt`，且每个 params 都必须通过严格 schema。`thread/delete`、
`thread/shellCommand`、`thread/inject_items`、`thread/rollback`、background terminal、
`command/*`、`process/*`、`config/*`、登录写接口和未显式列出的实验 API 一律返回 `METHOD_NOT_ALLOWED`。

CodeX App Server 的 `project/list` 是虚拟 Workspace 的首选来源。只要它返回至少一个带绝对根目录的
有效项目，Client Plugin 与 Android Client 就只投影这些项目，`thread/list` 里不能归属到任一 project id
或 project root 的 Thread 不得返回为可见 Session。当 `project/list` 返回空列表、全部项目均无有效根
目录，或该方法不可用时，Host 才可把 App Server 自己通过 `thread/list` 返回的绝对 `cwd` 作为精确
Workspace authority；Client Plugin、Remote Web 与 Android Client 可为这些 `cwd` 生成只读后备
Workspace。不得从多个 `cwd` 推测或提升到共同父目录。没有绝对 `cwd` 的 Thread 在后备模式下不可见。

`project/create` 只允许 `{ name, roots: [{ path }], idempotencyKey }`：`name` 为 1..256 字符，
`idempotencyKey` 为 16..256 字符，且 `roots` 必须恰好包含一个 1..4096 字符的绝对目录。Host 必须在
调用 App Server 前对该路径执行 `resolve`、`realpath` 和目录类型校验，并把 canonical path 作为新增
project root。返回值只保留 project 的 `id`、`name`、绝对 `roots`、`position`、`createdAt` 与
`updatedAt`，不得转发 metadata。该操作会显式扩展后续的 Workspace authority，但不会创建目录、
写入 DSH Workspace 存储或开放任意 App Server method。

其它带 `threadId` 的调用必须先用只读 `thread/read(includeTurns:false)` 重新验证该 Thread 仍属于当前
Workspace authority；如果该只读验证因 App Server 当前状态临时失败，Host 最多只能用同一 authority
下的 `thread/list` 结果兜底。Remote 创建 Thread 时 Host 只能接受 `project/list` 暴露的项目根目录、
后备模式中 `thread/list` 已返回的绝对 `cwd`，或这些 authority 根目录经过词法路径与 `realpath` 双重
校验后仍位于根内的真实子目录。不得接受越过 authority 根的 Client 自报路径、`..` 跳转或符号链接
逃逸。`dsh/directoryList` 只供 CodeX 虚拟 Workspace 的原生新建会话流程浏览目录，Host 只能对上述
authority 根内的真实目录返回单层只读子目录元数据、面包屑和截断标记，不得返回文件内容、执行打开、
创建目录或把符号链接越界目标暴露为可选目录。虚拟 Session 的原生权限控件
只暴露 `workspace-write` 与 `danger-full-access` 两个固定 preset；Client 传 preset 名，Host 映射为
App Server 的审批与 sandbox 字段，不接受任意 sandbox、writable roots 或额外授权。默认
`workspace-write` 映射为 `approvalPolicy: "on-request"`、`sandbox: "workspace-write"` 和
`sandboxPolicy.type: "workspaceWrite"`；用户显式确认的 `danger-full-access` 映射为
`approvalPolicy: "never"`、`sandbox: "danger-full-access"` 和
`sandboxPolicy.type: "dangerFullAccess"`。`thread/start` 未带 preset 时使用 `workspace-write` 作为
Remote 新 Thread 的保守默认；已有 Thread 的 `thread/resume|fork` 与 `turn/start` 未带 preset 时，
Host 不注入审批或 sandbox 覆盖，让 App Server 继承该 Thread 已保存的默认值。只要 Client 显式提交
preset，Host 仍必须重新映射为 canonical 策略，不能接受 Client 提交的底层字段或 Thread 历史里的旧策略。
审批响应本身仍只允许单次 accept/decline/cancel，不提供 `allow_session`。

CodeX App Server 可把 `turn/start` 的部分配置覆盖作为同一 Thread 后续 turn 的默认值；Remote 可从
`thread/start|resume|fork` 响应或 `thread/settings/updated` 事件里的有效 `approvalPolicy` 与
`sandbox/sandboxPolicy` 反推上述两个固定 preset。`thread/list` / `thread/read` 的 `Thread` 元数据本身
不携带该设置，所以 Android Client 仍可以把用户显式选择的 CodeX preset 作为本地 UI 偏好，按 Host
设备与 Thread 维度保存，并在之后需要显式覆盖时继续提交同一个 preset。

Web 与 Desktop Remote 的审批控件按 Thread 回显 Host 已确认的 preset，不能把客户端默认值或
同工作区其它 Thread 的选择当成当前策略。`dsh/sessionHistory` 可附带
`permissionPreset: "workspace-write" | "danger-full-access" | null`：Host 只从成功的 App Server
响应、明确完成的设置更新和 `thread/settings/updated` 记录内存快照；不支持的策略组合、未知设置
以及 Host App Server 重启后返回 `null`，旧 Host 可省略该字段。纯查看不得调用 `thread/resume`。
Client 未获知策略时显示沿用 Host 设置，发送与 fork 默认省略 preset，避免缓存覆盖其它客户端的修改。
新 Thread 仍显式采用 `workspace-write`，不继承相邻 Thread 的 Full access。

显式 `thread/resume(permissionPreset)` 由 Host 优先调用官方 `thread/settings/update` 落实到
已加载的 Thread；未加载或旧 App Server 可回退到 resume，但返回策略不匹配时必须再次设置成功，
否则返回错误，不得假报切换成功。该内部调用只含固定映射后的审批、sandbox 和已允许的 model，
不扩大 Remote method allowlist。另一连接持有 active writer 时拒绝权限切换；成功后同步同 Thread
观察者，并在后续只读 History 中回显。

CodeX 虚拟 Session 接受文本，以及 Desktop Composer 从剪贴板或 Android 系统图片选择器产生的
PNG、JPEG、WebP、GIF 图片 Prompt。
Client 只能把原生 `{ type: "image", mediaType, data }` 转为 CodeX 领域的同形受限 input，并在存在
图片时使用 `codex.appserver.transfer.v1`；Host 必须验证 MIME、canonical base64、part 数量与
288 MiB envelope 上限，再转换为 App Server 的 `{ type: "image", url: "data:..." }`。禁止外部
URL、Host path、临时文件、attachment id 和其它 input 类型。由于不开放通用文件附件，Client 仍
隐藏 Composer 的“+”入口；Host 不能依赖 UI 隐藏作为安全边界。

每条认证连接拥有独立的 `streamId -> threadId` 订阅与 transfer 容器。一个 Thread 同时只允许
一个 connection 持有 active turn mutation lease。`codex.app.frame` 只发送给订阅该 Thread 的
connection；`codex.app.stream.closed` 结束对应虚拟 stream。命令执行和文件变更审批只路由给
active turn owner，并以 Host 生成的 opaque `requestHandle` 暴露。`codex.app.respond` 只接受
`accept|decline|cancel`，错误 connection、重复、过期或伪造 handle 必须 fail closed；断线时未决
审批自动 decline。`acceptForSession`、execpolicy amendment 和额外 permission grant 不得进入
Remote frame。

`codex.appserver.transfer.v1` 使用独立的 512 KiB chunk、288 MiB 总上限、canonical base64，
承载大 History 响应和图片 Prompt request；它保持严格有序/恰好一次、每连接输入/输出各两个
transfer 和 2 分钟 idle 清理。重组后的内容必须再次
解析为 `codex.app.call` 并经过同一 allowlist / project-list policy，不能借分块扩权。

App Server 意外退出或 stdio 失效时，Host 立即撤回动态 capability、清空 active-turn lease 与审批
handle，并以 `failed` 结束全部旧 Codex stream。Host 按 `1s -> 2s -> 4s -> 8s -> 15s` 最多五次
重启 App Server；重启只重新执行 initialize/account probe，禁止重放任何 call/mutation。Desktop
Client 必须重新探测 capability，重新打开 stream，并以 `thread/read(includeTurns:true)` 替换本地
baseline 后继续归并 live event。Android Client 同样必须重新探测 capability、重开 stream，并以
Host 分页 `dsh/sessionHistory` 替换移动端 baseline；若分页基线包含仍在运行的 Turn，Host 必须保留
open step/turn 语义并返回顶层 `activeTurnId`，以便同一连接或同一设备的替换连接可以发起
`turn/interrupt`。任何一端都不得自动重放不确定的 mutation。

Desktop 打开 Thread 时只用 `thread/read(includeTurns:true)` 建立持久化 baseline，Remote stream
只是 Host 侧的事件过滤器，不得因纯查看自动调用 `thread/resume`。用户明确继续发送前才
resume；如果 App Server 因 Thread 已在本进程加载而拒绝重复 resume，Host 可在已经完成
`thread/read` 归属校验后把该操作视为幂等成功。不确定结果的 turn、rename 或 archive 不自动重放。

## 20. Events

Plugin 按 Harness 代际发送 `harness.api.frame` / `harness.api.stream.closed`，或
`harness.remote.frame` / `harness.remote.stream.closed`。可选 Codex 领域发送
`codex.app.frame` / `codex.app.stream.closed`。

冻结 Android 原型事件（`session.created`、`session.updated`、`message.created`、
`message.delta`、`tool.started`、`tool.updated`、`tool.finished`、
`permission.requested`、`permission.resolved`、`agent.status`、`connection.stats`）
已退出协议，Host 不得发送，Client 不得依赖。历史类型概览见 §18。

Event envelope：

```json
{
  "v": 1,
  "id": "01KEVENT...",
  "type": "event",
  "timestamp": 1786000000000,
  "payload": {
    "seq": 8272,
    "event": "harness.api.frame",
    "data": {}
  }
}
```

`seq` 在同一 Host identity 上严格递增。重放必须保留原始 seq/id/timestamp。

### `harness.api.frame`

data：`{ "streamId": "...", "frame": RpcRequest<MuxFrame | HostFrame> }`。该 event 不进入 Host 的通用 seq replay buffer；Harness Client Runtime 负责按原生流语义重连并重新取得 history baseline。

### `harness.api.stream.closed`

data：`{ "streamId": "...", "reason": "cancelled|completed|failed|peer-disconnected" }`。Client 收到后必须结束对应 iterator；transport 意外关闭时本地模式切换器必须 fail closed，不得继续向旧 Host 提交请求。

### `harness.remote.frame`

data：`{ "streamId": "...", "hasValue": true, "value"?: unknown }`。`hasValue` 区分显式
`undefined` item 与无数据；该 event 不进入通用 seq replay buffer。

### `harness.remote.stream.closed`

data：`{ "streamId": "...", "reason": "cancelled|completed|failed|peer-disconnected", "failure"?: { "code", "message", "details" } }`。
Client 收到后结束对应 iterator；`failed` 必须以 Gateway 归一化 failure 拒绝 iterator。

## 21. Event Replay 与重连

本节旧 `sync.from` 机制已退出 Plugin。Desktop Client 重连后重新打开官方 mux/host
stream，并由 Harness UI 重新读取原生 history baseline；Plugin 不维护第二套 replay buffer。

Client 为每台 Host 持久化 `lastSeq`，但不必持久化解密后的 conversation。

Secure channel 恢复后调用扩展 RPC：

```text
sync.from
```

Params：

```json
{ "afterSeq": 8271 }
```

Result：

```json
{
  "events": [],
  "lastSeq": 8290,
  "hasMore": false
}
```

如果 Host replay buffer 不再包含所需 seq，返回：

```json
{
  "code": "FULL_RESYNC_REQUIRED",
  "details": { "currentSeq": 9000 }
}
```

Client 随后调用 `sessions.get` 获取当前会话 snapshot。恢复期间 Send/permission 按钮必须禁用，避免在未知状态上产生副作用。

Event 去重 key 为 `(hostDeviceId, seq)`。收到 `seq <= lastSeq` 的重放事件忽略；收到 `seq > lastSeq + 1` 立即暂停 reducer 并同步。

## 22. Ping/Pong

应用层 `connection.ping` 已退出 Plugin；只保留 Control Channel heartbeat。

Control Channel heartbeat 默认 25 秒，75 秒未收到有效 pong 视为断开。应用层可通过 `connection.ping` 估计 Host RTT。

Control ping：

```json
{
  "v": 1,
  "id": "01K...",
  "type": "ping",
  "timestamp": 1786000000000,
  "payload": { "nonce": "01K..." }
}
```

pong 回显 nonce。Heartbeat 不能携带业务数据。

## 23. 错误码

### Protocol / Version

- `INVALID_MESSAGE`
- `UNSUPPORTED_VERSION`
- `CAPABILITY_NOT_SUPPORTED`
- `METHOD_NOT_FOUND`
- `METHOD_NOT_ALLOWED`
- `REQUEST_CONFLICT`
- `FRAME_TOO_LARGE`
- `RATE_LIMITED`

### Auth / Device

- `AUTH_REQUIRED`
- `AUTH_INVALID`
- `ACCOUNT_AUTH_REQUIRED`
- `TOKEN_EXPIRED`
- `DEVICE_NOT_FOUND`
- `DEVICE_REVOKED`
- `DEVICE_OWNERSHIP_REQUIRED`
- `MEMBERSHIP_REQUIRED`
- `PEER_IDENTITY_MISMATCH`
- `HOST_REGISTRATION_CODE_NOT_FOUND`
- `HOST_REGISTRATION_CODE_EXPIRED`
- `HOST_REGISTRATION_CODE_CONSUMED`

### Connection / Transport

- `HOST_OFFLINE`
- `CONNECTION_NOT_FOUND`
- `CONNECTION_FAILED`
- `CONNECTION_REPLACED`
- `P2P_FAILED`
- `TURN_UNAVAILABLE`
- `RELAY_UNAVAILABLE`
- `SLOW_CONSUMER`
- `SECURE_CHANNEL_FAILED`

### Harness

- `HARNESS_UNAVAILABLE`
- `HARNESS_VERSION_INCOMPATIBLE`
- `RESPONSE_TOO_LARGE`
- `SESSION_NOT_FOUND`
- `SESSION_NOT_READY`
- `AGENT_BUSY`
- `PERMISSION_DENIED`
- `PERMISSION_NOT_PENDING`
- `RPC_TIMEOUT`
- `FULL_RESYNC_REQUIRED`
- `INTERNAL_ERROR`

错误 message 面向用户但不包含内部路径、stack、secret 或原始异常。`retryable` 只表示同一操作稍后重试可能成功，不代表 Client 应自动重放非幂等请求。`error.payload.connectionId` 为可选字段；存在时错误作用域仅限该逻辑连接。

错误码字段可以使用非空扩展字符串。子系统扩展应使用稳定前缀。
当前前缀包括 `CODEX_*` 和 `FILE_VIEWER_*`。扩展码不属于上面的 v1 标准错误码集合。

## 24. 默认限制

| 项 | 默认限制 |
| --- | --- |
| Hello timeout | 5 s |
| Host registration code TTL | 10 min |
| Control JSON frame | 64 KiB |
| Relay Control JSON frame | 1 MiB |
| Reassembled secure message | 4 MiB |
| Harness business transfer chunk（解码后） | 512 KiB |
| Harness ApiProxy / Typert Remote transfer | 288 MiB；每连接输入/输出各 2 个；2 min idle |
| Codex App Server transfer | 512 KiB chunk；288 MiB；每连接输入/输出各 2 个；2 min idle |
| File Viewer range / RPC | 512 KiB |
| File Viewer directory entries / RPC | 1,000 |
| RPC text input | 64 KiB |
| 同连接 pending RPC | 128 |
| 同 session pending permission | 16 |
| ICE candidates / connection | 256 |
| Heartbeat interval | 25 s |
| Heartbeat disconnect | 75 s |
| Event replay window | 至少 10,000 events 或 15 min，取先达到者 |

Server/Host 可协商更小限制，但必须在 hello/system.info 中公布。超限必须返回稳定错误或关闭违规连接，不能无限缓存。

## 25. 安全不变量

所有 conforming 实现必须满足：

1. 账号归属是 Host/Client 访问边界，device token 只能代表其所属账号内的设备。
2. Membership、双方账号一致性、Host/Client 本机 pinned peer 和 connection identity key 绑定必须同时成立。
3. Remote RPC/Event 不以明文经过或落盘到 Server。
4. TLS/WSS 不能替代 Noise secure channel。
5. Client 不能请求通用 shell/filesystem RPC 绕过 Harness；显式开启的原生 terminal 与 loopback 例外遵循下述独立边界。
6. Permission 只能映射 Harness 当前 request，默认 fail closed。
7. `harness.api.call.method`、`harness.remote.call.endpoint` 与 `codex.app.call.method` 必须命中各自编译期固定 allowlist；禁止通过对象反射、Typert/Cordis registry、service 名或任意 endpoint 扩权。
8. 当前 Harness v1 只允许 Remote `allow_once`/`deny`，不得伪造 session grant。
9. Device revoke 使 token、membership 和现有 connection 失效。
10. 重放/乱序/身份不匹配的 secure frame 必须拒绝。
11. Host/Client 首次账号归属必须由同一 Server 的账号授权；Host 也可使用该账号生成的
    一次性主机匹配码。同一安装仅可用 device token 注册独立的相反角色；device token
    仍不可调用账号接口，切换 Server 不得复用旧 origin 的身份、凭证或授权状态。
12. 日志禁止记录 token、code 明文、key、prompt、source、workspace 和 tool output。
13. Admin 无法从数据库或 API 获取 E2EE conversation。
14. 未协商 capability 的功能不得调用或展示为可用。
15. Codex Thread 继续归 Codex App Server 所有；Remote 可在 Client Plugin 内临时伪装为原生 Workspace/Session/Event，也可在 Android 内存中投影为已有移动端 Workspace/Session/Chat 供展示与操作，但不得写入 DSH SessionStore、Workspace 数据库、Harness 日志或另建 CodeX 数据存储。

## 26. Conformance 测试

协议实现至少通过：

- JSON/envelope/schema/version vectors
- RPC correlation、timeout、late response 和 idempotency
- event seq、duplicate、gap、replay 和 full resync
- Host/Client account authorization、owner mismatch 与跨账号访问拒绝
- Host registration code expire/single-use
- Noise IK handshake、peer mismatch、tamper、replay 和 rekey
- signaling/relay membership authorization
- Relay capture 无法解密业务 payload
- permission allow/deny/cancel/timeout/disconnect fail-closed
- transport 从 P2P/TURN 降级 Relay 后保持 session continuity

UI 排版、静态说明和 Admin 普通筛选不属于协议 conformance。

## 27. 实现差距管理

当前 `packages/protocol`、`packages/crypto`、`packages/webrtc` 和 Server scaffold 是早期代码，不得仅因类型存在就声明符合本规范。

实现阶段应维护 checklist：

- 每个本文 frame/type 都有 schema。
- 每个 schema 都有正反测试 vector。
- Noise library 和握手 transcript 已固定。
- Server 只解析 control envelope，不解析 relay plaintext。
- Host ApiProxy bridge allowlist 与真实 Harness API 一致。
- Web/Host/Mock Host 至少两两互操作。

### CodeX Session workspace and terminal scope

A Remote `workspaceFileScopeId` or terminal `agentId` may identify either a Harness
Session or a CodeX Session. CodeX sessions use the form `codex:<threadId>` and are
resolved by the Host; they are never looked up as Harness agents. The Host obtains
the current CodeX thread `cwd`, creates an independent workspace-file scope and
terminal context per thread, and applies the same path normalization, realpath,
symlink, size, terminal ownership, and Remote settings checks as Harness sessions.
A CodeX scope cannot access paths outside that thread's `cwd`; invalid, ended, or
cwd-less threads return stable `CODEX_SESSION_INVALID`, `CODEX_THREAD_UNAVAILABLE`,
or `CODEX_WORKSPACE_UNAVAILABLE` errors. Server transport only forwards encrypted
RPC and does not perform this mapping or authorization.

CodeX terminals reuse the official `terminal/*` semantics unchanged: `environment`
returns `{cwd,maxInputBytes,maxCols,maxRows,scrollback}`, `shells` returns
`{path,args,name}`, and `list` / `create` / every snapshot and state `info` carry the
official `WebTerminalInfo` including `controllerId`. `write|resize|rename|close`
resolve to void, `retain` acknowledges with `{type:"retained"}` without taking input
ownership, and `follow` starts with `{type:"snapshot",sequence,screen,info}` followed
by `{type:"output",sequence,data}` where each `sequence` is exactly the previous one
plus one. The Host starts the shell through its `subprocess` service (PTY, containment,
process-range termination) when that service is available and falls back to a plain
pipe otherwise. This carrier has no terminal emulator, so `screen` is a bounded raw
output journal replayed into the client emulator, prefixed with a reset when the
journal was truncated.

### ACP catalog reads without prewarming

`agent.acp.call` 内的 `dsh/sessionList` Params 新增可选布尔字段 `prewarm`，默认 `true`。
`false` 仅关闭该次列表读取触发的空闲 CLI 预热，不改变后端选择、身份/权限校验或 catalog
来源；Android 批量读取各目录时使用它，防止为每个目录启动一个进程。此字段不扩展 method
allowlist，也不提供文件写入能力。

### ACP shared workspace tools and live AGY models

`agent.acp.workspace-files.v1` enables readonly workspace files. `agent.acp.terminal.v1`
is advertised only while the Host Remote terminal setting is enabled. Both work for
Cursor and Antigravity; session scope is supplied by the backend, never a client cwd.
`agent.acp.antigravity.models.v1` enables the live installed AGY model catalog and
confirmed per-conversation model/effort selection. Remote versions below `0.5.0`
continue to ignore `workspaceTypes`; newer clients require these optional capabilities.

- `agent.acp.call` method `dsh/toolCall` takes `{sessionId,backend,endpoint,args}`.
  `sessionId` is the native ID; every scope in `args` must equal its UI ID
  (`cursor:<nativeId>` or `acp:<nativeId>`). The fixed unary endpoints are
  `workspaceFiles/list|stat|read|readBytes|readAll` and
  `terminal/environment|shells|list|create|write|resize|rename|close`.
- `agent.acp.stream.open` accepts an optional `tool:{backend,endpoint,args}` with
  only `workspaceFiles/changes|terminal/follow|terminal/retain`. Tool values use
  `agent.acp.frame` with the explicit `streamId` and
  `frame:{method:"dsh/workspaceTool",params:{value}}`. Agent updates continue to
  use session-scoped delivery. Existing stream close and disconnect cleanup apply;
  late opens after cancellation release their subscriptions.
- Host scopes come only from canonical session creation or the Host transcript
  catalog. Missing scope, backend mismatch, cross-session IDs, path traversal and
  symlinks outside the root fail closed. Terminals keep the shared native snapshots,
  monotonic output sequences, device ownership and connection attachment policy.
  Disconnect retains terminals for reconnect; domain shutdown ends its processes.
- `dsh/sessionModels` takes `{sessionId,backend:"antigravity"}` and returns
  `{current,routable,groups,failures}` in the existing session model shape.
  `dsh/selectModel` additionally takes `{model,reasoningEffort?}` and returns
  `{selected}` only after resuming the same AGY conversation with validated CLI
  `--model`/`--effort` flags. Model IDs and effort variants come from `agy models`;
  Thinking variants use their CLI model ID and do not pass an invalid `--effort thinking`.
  Selection is rejected during a prompt or another model change. Until an explicit
  choice is confirmed, `current.model` is `host-settings`; it does not claim a default
  model that the Host has not reported. Existing Host configuration and permissions
  remain active. Clients without these optional capabilities keep Host settings.
  The live model directory is cached for the Host backend lifetime; concurrent
  reads share discovery, failed discovery can retry, and reloading the backend
  invalidates the cache. Selecting the confirmed model and effort again is a no-op.
  Optional `agent.acp.antigravity.model-load.v1` means selection also loads a
  Host-discovered conversation directly with its target model and canonical cwd;
  clients may omit the preceding `session/load`. Without it, keep the load step.
  The Host emits a session update `{sessionUpdate:"model_selection",selected}`
  after confirming selection and before prompts with that selection. Clients
  preserve the selected model in each turn's message source and do not relabel
  earlier replies after a model change. AGY transcripts without model metadata
  must not be assigned a fabricated historical model.
