# Remote × DSH-Go 配对协议 v1

状态：服务端已实现；Remote / DSH-Go 需按本文实现，尚未进行双端真机联调或生产部署。

## 用户流程与信任边界

电脑插件展示二维码 → 手机扫码、人工确认 → 手机显示 8 位验证码 → 用户在电脑插件界面输入并点击“确认绑定” → Server 仅校验一次 → 双端分别保存凭证 → 手机连接该 Host。

Host 是 DS Harness 插件，不要求 CLI。验证码不向 Host API、通知、日志或模型工具公开。手机不得代替电脑提交确认。服务端能够验证 X25519 私钥持有和手机验证码，**不能仅凭 HTTP 请求证明真人点击**。Remote 必须将最终提交放在专用本机用户界面，禁止模型工具、远程 Client 或普通远程 RPC 调用；loopback/owner principal 本身不是可信人机隔离。若 DS Harness 无可信原生用户交互能力，需要明确该限制，不能宣称完全阻止本机自动化。

所有正式通信使用 HTTPS；仅本地开发沿用既有 HTTP 策略。二维码服务器 origin 必须先展示给手机用户确认；不同 origin 的旧凭证绝不混用。服务端不提供 DeepSeek 身份认证，不传输 DeepSeek 密码、Cookie 或 Token。

## 数据与兼容性

- 新 Host、新手机共同配对：创建随机 `dsh-device:<UUID>` 内部账号，`account_kind=device_only`，无密码。
- 一端已经登记：沿用该端所有者；另一端新设备归入同一内部账号，但只创建本次 Host—手机关系。
- 双端已有相同所有者：只明确授权本次关系。若这对关系此前撤销，本次重新扫码和验证码确认才允许恢复这一对；其他撤销关系不恢复。
- 双端属于不同内部账号：终态失败 `PAIRING_ACCOUNT_CONFLICT`，不合并账号、不转移设备。手机端不得静默覆盖自己已有的其他账号凭证。
- 设备 ID 对应不同公钥、角色、已撤销身份、已注销账号或管理员管理的云 Host：拒绝。被撤销设备不能用此流程复活。
- 新配对设备 `pairing_restricted=1`。新 Host `role=host,inbound_only=1`，独立 installation，不创建 Client。
- 新手机 `role=client,inbound_only=0`。既有设备保留原权限与配置；例如既有手机主动设置了 inbound-only，本流程不会自动解除。
- 配对设备不能使用 `register-owned-role`；通用注册不能重新登记配对设备、为其恢复全账号自动 Membership。
- 旧普通设备间的原有自动授权保持兼容，但自动授权排除配对受限设备。
- Device-only 在密码登录、Web Token 签发/校验及 Admin 判定均被拒绝。设备 Token 不能兑换 Web 权限。
- 配对手机不能通过账号设备删除接口删除整个 Host；可退出自身设备或撤销自己的具体关系。
- 不修改 Noise IK、P2P、TURN、Relay 协议。连接继续要求有效设备身份、同一 owner、正确角色和有效 Membership。

## 编码与设备描述

JSON UTF-8，时间为 Unix 毫秒，二进制为无 padding 的 canonical base64url。设备公钥为 32 字节 X25519；拒绝非法长度、非规范编码及低阶点。Host、手机 ID 与公钥必须分别不同。

设备描述沿用现有注册结构：

```json
{
  "deviceId": "019a0000-0000-7000-8000-000000000001",
  "name": "My computer",
  "role": "host",
  "platform": "desktop",
  "identityKey": "<32-byte-X25519-public-key-base64url>",
  "clientVersion": "optional",
  "harnessVersion": "optional"
}
```

手机必须 `role=client`。ID 沿用现有 UUID / ULID 格式；会话 ID 为 Server 生成的 UUID。名称等字段沿用现有注册校验。

可选 `deepseekUserId` 是 1～256 字符字符串，只能来自实际可用的非敏感用户信息接口；无法取得时省略，不能解析或上传认证材料。Server 用带用途隔离的 HMAC-SHA256 保存摘要及 `verified=false`；未验证摘要不作为认证、找回、合并或授权依据。既有账号的非空元数据不被后续配对覆盖。客户端可提示不一致，但不能声称完成 DeepSeek 身份验证。

所有配对请求最多 8192 UTF-8 字节；拒绝额外字段和重复 JSON 属性。无数据的 POST 也必须发送 `{}`。不要把秘密放进 URL。

## 私钥持有证明

Server 每个会话生成一个临时 X25519 密钥，只返回公钥 `serverPublicKey`。私钥加密存储，随会话清理。设备长期私钥不上传。

除创建会话外，每个配对 POST 都携带：

```http
X-DSH-Pairing-Proof: <base64url(HMAC-SHA256(proofKey, message))>
```

计算如下：

```text
shared = X25519(localDevicePrivateKey, serverPublicKey)
side = "host" 或 "mobile"（claim 使用 mobile）
proofKey = HKDF-SHA256(
  IKM = shared,
  salt = UTF8(sessionId),
  info = UTF8("dsh-pairing-v1/" + side),
  L = 32
)
bodyHash = lowercaseHex(SHA256(UTF8(rootJsonText)))
message = UTF8("POST\n" + exactPath + "\n" + bodyHash)
```

`exactPath` 如 `/api/v1/device-pairing/sessions/<sessionId>/host/confirm`，不含 origin、查询参数，区分大小写。

`rootJsonText` 是实际发送 JSON 根对象的原始文本，保留内部空白、属性顺序和转义；排除根对象前后的空白。推荐只序列化一次、无外层空白、无 BOM，直接对该字符串签 MAC 并发送相同字节。不能先签一种序列化、再用网络库重新序列化。**这不是 JCS。**

Node / Dart 可直接使用既有 X25519 实现，加 RFC 5869 HKDF-SHA256 和 HMAC-SHA256。不能把 X25519 误用为 Ed25519 签名密钥。固定互操作向量见 `clients/fixtures/pairing/v1/proof.json`。

证明绑定操作和请求内容；不单独签二维码秘密。状态操作的同请求重放没有额外权限；状态迁移、领取及最终提交通过数据库终态和幂等限制。

## API

### 1. Host 创建会话

`POST /api/v1/device-pairing/sessions`，无需 Bearer / proof：

```json
{"v":1,"device":{"deviceId":"...","name":"...","role":"host","platform":"desktop","identityKey":"..."},"deepseekUserId":"optional"}
```

响应：

```json
{
  "v": 1,
  "sessionId": "<UUID>",
  "expiresAt": 1790000000000,
  "serverPublicKey": "<base64url>",
  "scanSecret": "<32-random-byte-base64url>",
  "host": {"deviceId":"...","name":"...","role":"host","platform":"desktop","identityKey":"...","clientVersion":null,"harnessVersion":null}
}
```

会话有效期固定 180 秒。创建本身不登记设备、不创建用户、不签发 Token；后续 Host 操作需证明持有该公钥的私钥。创建响应丢失时可创建新会话，旧会话自行过期。

兼容旧格式如下。新 Remote 优先使用下面说明的短凭据格式，旧 JSON 二维码仍有效：

```json
{
  "type": "dsh.remote.pairing",
  "v": 1,
  "serverUrl": "https://dsh.r2049.cn",
  "sessionId": "<from-response>",
  "expiresAt": 1790000000000,
  "serverPublicKey": "<from-response>",
  "scanSecret": "<from-response>",
  "host": {"deviceId":"...","name":"...","role":"host","platform":"desktop","identityKey":"...","clientVersion":null,"harnessVersion":null}
}
```

`serverUrl` 为插件实际使用且手机用户确认的规范 origin，不可带 userinfo、路径、查询或 fragment。Host 公钥指纹建议双方统一为 `lowercaseHex(SHA256(decodedIdentityKey))`，界面可分组显示，不要截取原公钥作为安全指纹。二维码中的秘密不能作为最终授权。

### 2. 手机确认并领取验证码

用户在手机确认后才调用：

`POST /api/v1/device-pairing/sessions/{id}/claim`，mobile proof：

```json
{"scanSecret":"<from-QR>","device":{"deviceId":"...","name":"My phone","role":"client","platform":"android","identityKey":"..."},"deepseekUserId":"optional"}
```

响应：

```json
{"state":"claimed","verificationCode":"00123456","expiresAt":1790000000000}
```

第一份有效 claim 固定本会话的手机身份。完全相同的请求字节和 mobile proof 可恢复同一个验证码；改变请求内容或另一部手机不得接管。不要在恢复时重新生成设备身份。会话进入终态后不能再恢复验证码。

只在手机安全界面展示验证码，保留前导零，不自动复制、分享、记录日志或发到聊天中。Host 端的查询永远不返回验证码。手机不调用 `host/confirm`。

### 3. 双端查询

```text
POST /api/v1/device-pairing/sessions/{id}/host/status
POST /api/v1/device-pairing/sessions/{id}/mobile/status
```

发送 `{}`，分别携带 host / mobile proof。手机只有在 claim 后才能查询。建议每 2～3 秒轮询，后台暂停并处理 429。

响应：

```json
{
  "v":1,
  "sessionId":"...",
  "state":"claimed",
  "expiresAt":1790000000000,
  "recoverUntil":1790000300000,
  "failureReason":null,
  "attemptConsumed":false,
  "submissionId":null,
  "host":{"deviceId":"...","name":"...","role":"host","platform":"...","identityKey":"...","clientVersion":null,"harnessVersion":null},
  "mobile":{"deviceId":"...","name":"...","role":"client","platform":"...","identityKey":"...","clientVersion":null,"harnessVersion":null},
  "credentials":null
}
```

`mobile` 在未 claim 时为 null；`submissionId` 只向 Host 返回。手机需将响应 Host 身份与二维码核对，不能静默接受公钥替换。

`state`：`created → claimed → approved → completed`。

- `approved`：唯一验证码已正确校验并持久化，登记事务尚待完成；**尚无访问授权**。Host 必须用原提交内容和原 submissionId 重试 confirm，不能让用户重新猜码。普通 status 不自动完成登记。
- `failed`：验证码错误或绑定条件冲突，终态。错误验证码 `failureReason=verification_failed`；其他绑定失败用稳定 API 错误代码。
- `cancelled` / `expired`：终态。
- `completed`：持有对应侧身份才能取得该侧 credentials，绝不返回另一侧 Token。

完成后的 `credentials`：

```json
{
  "account":"dsh-device:<UUID>",
  "accountKind":"device_only",
  "device":{"deviceId":"...","name":"...","role":"client","platform":"android","identityKey":"...","clientVersion":null,"harnessVersion":null},
  "inboundOnly":false,
  "pairingRestricted":true,
  "tokens":{
    "accessToken":"...",
    "accessTokenExpiresAt":1790000000000,
    "refreshToken":"...",
    "refreshTokenExpiresAt":1790000000000
  }
}
```

已有普通账号时 `accountKind=standard`，仍不签发 Web Token。新 Host 的 `inboundOnly=true`。既有 Host 可保留原有效凭证，不必覆盖；本会话新签发的两端凭证独立。

结果可恢复至创建后 480 秒（expiresAt + 300 秒），到期返回 404。领取恢复返回相同 Token，而非不断增发。已撤销设备或 Membership 不允许恢复凭证。已领取后沿用正常 `/api/v1/auth/refresh` 机制；不要不断用旧会话状态覆盖已刷新的凭证。安全保存成功后才发布登录成功并自动连接。

### 4. Host 唯一最终提交

仅电脑专用本机界面人工操作：

`POST /api/v1/device-pairing/sessions/{id}/host/confirm`，host proof：

```json
{"submissionId":"<stable-random-id-at-least-16-chars>","verificationCode":"00123456"}
```

`submissionId` 为 16～128 字符、每次新会话使用新的随机值。验证码必须为恰好 8 位 ASCII 数字。字段格式错误返回 422，不进行验证码校验；完整有效格式的最终提交仅允许一次。

- 正确或错误都先持久化此次 submissionId、请求 HMAC 和结果，清除验证码材料。
- 正确后另一个事务原子建立用户、设备、单条 Membership 和双端凭证。
- 错误返回 HTTP 200、`state=failed,failureReason=verification_failed`，整个会话作废。
- 同一 submissionId **且完全相同的 JSON 请求字节**重试返回既定结果；如为 approved 可继续完成登记。不同属性顺序也视为不同请求。
- 不同 submissionId 或内容变更返回 409 `PAIRING_ATTEMPT_USED`，不会再次校验。
- 并发提交只允许一个取得机会。客户端在首次提交前冻结请求字节及标识；超时只查状态或重发原请求，不能修改验证码。
- 结果未知时不能向用户展示“再输一次”。若无法恢复原请求，只能取消并发起全新扫码流程。
- 首次提交在期限内正确但完成前超时，approved 会话仍受原有效期约束；过期后重新扫码。

响应结构同 status。失败后重新生成二维码、手机重新确认；禁止后台自动新建会话继续猜旧验证码。

### 5. 拒绝、取消

```text
POST /api/v1/device-pairing/sessions/{id}/host/cancel
POST /api/v1/device-pairing/sessions/{id}/mobile/cancel
```

`{}`，对应侧 proof。Host 拒绝等同 host/cancel。created/claimed/approved 可取消；终态不被改写，重复取消返回当前状态。completed 之后需撤销 Membership，不以 cancel 撤销已完成绑定。

### 6. 已授权关系查询、撤销

```text
GET /api/v1/device-memberships?limit=50&cursor=<last-membership-id>
DELETE /api/v1/device-memberships/{peerDeviceId}
```

使用现有设备 Access Bearer，不使用配对 proof。列表仅包含调用设备自身的有效关系：

```json
{"items":[{"membershipId":"...","authorizedAt":1790000000000,"peer":{"deviceId":"...","name":"...","role":"...","platform":"...","identityKey":"...","clientVersion":null,"harnessVersion":null}}],"nextCursor":null}
```

limit 1～100。DELETE 撤销本设备与目标设备的这一条关系，不删除设备或账号，不影响其他手机的关系；无有效关系返回 403。Server 发布授权变更，并请求 Gateway 只断开此设备对；通知失败时由现有授权监控收敛，不影响持久化撤销。断网的端到端 P2P 无法由服务端物理保证瞬时断流，仍沿用既有授权与连接生命周期。

退出并撤销本设备沿用 `DELETE /api/v1/devices/self`；续期沿用 `POST /api/v1/auth/refresh`。手机成功保存凭证后使用原设备列表、Host 公钥固定及连接 API；自动连接目标必须是本次批准的 Host。

## 错误、限额和清理

错误沿用 `{ "error": { "code", "message", "requestId", "retryable" } }`。

| HTTP | code | 客户端动作 |
| --- | --- | --- |
| 422 | INVALID_MESSAGE | 修复格式；不自动猜码 |
| 401 | PAIRING_PROOF_INVALID / PAIRING_SCAN_INVALID | 拒绝继续，检查会话和设备身份 |
| 404 | PAIRING_NOT_FOUND | 会话不存在或结果恢复窗口已结束，重新扫码 |
| 409 | PAIRING_NOT_CLAIMED / PAIRING_CLOSED | 查询状态，终态则重新扫码 |
| 409 | PAIRING_ATTEMPT_USED | 禁止改码重试，恢复原提交或重新扫码 |
| 409 | PAIRING_DEVICE_CONFLICT | 身份已撤销/冲突，不复活旧身份 |
| 403 | WEB_ACCESS_DENIED / DEVICE_SCOPE_REQUIRED / PAIRING_REQUIRED | 不尝试 Web、账号级操作或绕过扫码 |
| 429 | RATE_LIMITED / PAIRING_BUSY | 退避，不自动新建会话猜码 |
| 503 | AUTHORIZATION_SYNC_PENDING | 变更可能已保存；查询状态，不换码重试 |

正确码后遇到 `PAIRING_ACCOUNT_CONFLICT`、`HOST_DEVICE_LIMIT_REACHED` 等业务错误以 HTTP 200 的 failed/failureReason 终态返回。SQLite 暂时失败可为 503，查询状态后重发同一提交；唯一尝试一经持久化不会重新开放。

- `PAIRING_CREATE_RATE_LIMIT` 默认每 IP `5/min`。
- `PAIRING_REQUEST_RATE_LIMIT` 默认每 IP `120/min`，包含轮询。
- 全库最多 1000 个未过期的活动会话，限制跨 API 进程共享。
- IP 滑动限流沿用当前进程内实现；多副本不是分布式全局 IP 限流，需沿用入口防滥用措施，不能宣称可防无限分布式攻击。
- 每分钟清理过期验证码及超过恢复窗口的整个会话（包括加密临时私钥、加密双端结果）。请求路径始终检查有效期，不依赖清理任务及时运行。
- 创建会话也清理到期数据；审计保留 30 天，仅记录会话、事件、设备 ID、时间，不含码、Token、私钥或 DeepSeek 原值。
- 响应 `Cache-Control: no-store`。生产框架禁止记录完整请求 URL；本功能秘密均位于 body/header，客户端也不得记录。

## 迁移、测试与接入顺序

迁移 `0005-device-pairing.sql`，旧账号默认 standard、旧设备默认不受 pairing_restricted 限制。独立 runtime 仅登记版本。历史 SQL / checksum 不改。

按 `docs/database-migrations.md` 在授权的维护窗口、所有写入者停止后执行原生 --migrate；本任务没有对人工固定数据库或生产数据库执行迁移，也没有部署/重启。

本地隔离检查：

```sh
dotnet run --project tests/dotnet-pairing/Checks.csproj -c Release
./scripts/check-dotnet.sh
```

建议 Remote 和 DSH-Go 先跑 proof 固定向量，再对隔离服务完成二维码、手机确认、单次错误、重试恢复和自动连接联调。旧 Server 对新路径返回 404 时显示“不支持扫码设备配对”，不能自动降级到缺少人工确认的方式。

### Login discovery

`GET /api/v1/auth/oauth/providers` preserves its OAuth `items` array and adds
`capabilities: { "devicePairing": "dsh-pairing-v1" }`. Clients show the DSH-Go
pairing method only after a successful response with this exact capability.
Missing/unknown capability, legacy fallback and discovery failure must not enable
pairing. Discovery uses `Cache-Control: no-store`; refetch after changing Server.
This advertises Host pairing, not Client/controller authorization.

## 短凭据二维码（fragment-ticket-v1）

登录方式发现接口仍为 `GET /api/v1/auth/oauth/providers`，新增独立字段：

```json
{"capabilities":{"devicePairing":"dsh-pairing-v1","devicePairingQr":"fragment-ticket-v1"},"items":[]}
```

新 Remote 仅在服务端明确声明 `devicePairingQr` 时生成短二维码，否则保留旧 JSON 格式；旧 Remote 的创建响应和配对 API 不变。既有未完成的 JSON 二维码继续有效，重启后保留会话原格式。能力发现的网络/非法响应错误不能静默当成不支持；旧发现接口 404 可以保留 JSON 格式。

```text
https://dsh.r2049.cn/pair#v1.<ticket>
```

`ticket` 是现有 `scanSecret`：32 随机字节的 canonical base64url，无 padding，43 个字符（256 位熵），不是可猜测数字短码。二维码不再包含 sessionId、Host 信息或公钥。服务端只存其 SHA-256 摘要，无新增数据库字段或迁移。

手机必须直接解析扫码文本，不先打开网页、不经过第三方短链服务、不跟随重定向。严格校验 scheme/origin、路径恰为 `/pair`、无 userinfo/query、fragment 匹配 `^v1\.[A-Za-z0-9_-]{43}$`，并验证解码长度与 canonical 编码。限制扫码文本长度（建议最多 2048 UTF-8 字节）。默认要求 HTTPS；HTTP 仅沿用明确允许的本地开发/自托管策略，不能因扫码任意绕过安全策略。先让用户确认服务 origin，再向该 origin 发送无账号凭据的请求；不可携带 Web Cookie、旧 Token、手机私钥或 DeepSeek 凭据。

```http
POST /api/v1/device-pairing/resolve
Content-Type: application/json

{"ticket":"<fragment中v1.之后的43字符>"}
```

响应为现有创建响应，格式完全相同：`v, sessionId, expiresAt, serverPublicKey, scanSecret, host`。手机必须校验 `v === 1`、`scanSecret === ticket`、有效期、Host role/ID、canonical 公钥等原有字段，结合已确认的扫码 origin 建立本次配对上下文；响应不另提供可切换的 serverUrl。只允许 `created` 且未过期的会话解析。未知、错误、已领取、取消、失败、完成或过期的 ticket 均返回 `404 PAIRING_NOT_FOUND`；字段长度或额外字段错误返回 422。响应 `Cache-Control: no-store`。按来源 IP 限流，默认 30/min，超限 429；沿用 8192 字节请求上限。

解析是只读操作，**不消耗领取机会**，网络丢包可安全重发相同 ticket。真正的一次性消费仍在带手机密钥证明的原子 `claim` 中完成；并发手机只允许一个成功。解析不创建用户、不绑定设备、不返回验证码或设备凭据。解析后，先展示服务器和 Host 身份给用户，手机主动确认后再提交 claim。claim 及后续 proof、8 位验证码单次尝试、Host 最终人工确认、权限和凭证恢复协议均不变。claim 响应丢失应重发原 claim，不重新 resolve。

手机须固定首次 resolve 的 Host ID/公钥和服务端会话公钥，后续状态/完成响应必须一致。与旧完整 JSON 的离线携带公钥不同，短格式的首次信息来源是用户确认 origin 的 HTTPS 服务；不能声称它额外提供了独立的 Host 公钥验证。若服务端被攻破，短格式没有独立于该服务的身份保证。

fragment 不进入 HTTP 请求 URL；但 ticket 依旧是秘密，不得进入日志、分析、崩溃上报、剪贴板或外部浏览器历史。POST 请求体也必须在代理和客户端日志中脱敏。GET `/pair` 仅返回无脚本/外部资源的引导文案，不解析、不 claim；设置 no-store、no-referrer 和严格 CSP，通用相机打开页面不会绑定设备。

DSH Go 实现顺序：识别短格式并确认 origin → resolve → 校验并固定会话/Host 信息 → 展示 Host 并由手机用户确认 → 复用原 claim/验证码/轮询/安全存储/自动连接流程。同时保留下面的旧 JSON 扫码解析，用于旧服务和已显示二维码；未知格式明确拒绝，不猜测协议。Dart/Android 实现和真机扫码尚未完成。
