# DSH-Go 接入扫码配对

服务端与 Remote 插件已实现。DSH-Go 需要实现本文的手机侧流程，尚未完成 Dart / Android 真机验收。

权威协议：[device-pairing-v1.md](device-pairing-v1.md)。先执行该协议的固定密钥证明向量，再接入界面和自动连接；不要自行改动 API、状态名称或证明字节编码。

## 用户看到的流程

1. 在 DSH-Go 的 Remote 入口选择扫描电脑二维码。
2. 展示服务器、Host 名称及公钥指纹，用户在手机主动确认。
3. 手机提交 claim 后显示 Server 返回的 8 位验证码，保留前导零。
4. 提示用户到**电脑本机 Remote 插件设置**输入验证码、点击“确认绑定”。手机绝不替电脑提交。
5. 手机轮询等待；Server 完成后安全保存本手机的设备凭证、固定 Host 公钥，自动连接二维码指定的 Host。

文案必须说明：**验证码只有一次校验机会，电脑输错后整个会话失效，需重新生成二维码、扫码和手机确认。**

手机不得提供“替电脑确认”、自动回填、复制/分享验证码到聊天或后台自动猜码的功能。验证码不进入日志、通知正文、分析事件、普通配置或剪贴板。前后台切换、截图及后台预览保护按平台能力落实，并保留无障碍操作。

## 在现有源码中的接入位置

此前源码审查基于 DSH-Go `219f2d1`；实施前复核当前分支，路径或函数变化时按实际实现调整：

| 位置 | 建议改造 |
| --- | --- |
| `packages/dsh_remote/lib/src/server/server_api.dart` | 二维码校验、mobile proof、claim、mobile/status、mobile/cancel 请求 |
| `packages/dsh_remote/lib/src/account/remote_account.dart` | 独立设备身份复用、配对状态、凭证导入、安全存储、Host 公钥固定 |
| `app/lib/remote/relay/dsh_remote_backend.dart` | 向 App 暴露扫码配对状态，完成后复用现有连接路径 |
| `app/lib/state/hosts_state.dart` | 目标 Host 选择、取消/退出/服务器切换竞态隔离 |
| `app/lib/remote/secret_store.dart` | 复用 flutter_secure_storage，不新增普通设置中的秘密存储 |
| App Remote 界面 | 相机扫码、手机确认、验证码展示、等待/失败/重试状态 |

配对是设备登录路径，不走 `_registerWithAccountToken`，不调用 `/auth/register`、`/auth/login`、网站 OAuth 或 `/devices/register`。可以复用其中的身份准备、Token 校验、凭证持久化和状态发布步骤，但不要再请求 Web Token。

新增方法名由 DSH-Go 自行决定；本文没有宣称其已存在或已实现。

## 二维码

Remote 当前生成纯 JSON 二维码：

```json
{
  "type":"dsh.remote.pairing",
  "v":1,
  "serverUrl":"https://dsh.r2049.cn",
  "sessionId":"<UUID>",
  "expiresAt":1790000000000,
  "serverPublicKey":"<32-byte-base64url>",
  "scanSecret":"<32-byte-base64url>",
  "host":{
    "deviceId":"<UUID-or-ULID>",
    "name":"My computer",
    "role":"host",
    "platform":"desktop",
    "identityKey":"<32-byte-base64url>"
  }
}
```

可含协议定义的 nullable/optional 版本字段。限制扫描文本长度、字段长度和协议版本；拒绝非法公钥、设备角色、过期会话和无效 origin。

`serverUrl` 只能是规范 origin，不含路径、query、fragment、userinfo。默认 HTTPS；本地开发及自托管遵循现有策略。手机确认新 origin 前不发送任何既有凭证；跨服务器存储隔离不得被二维码绕过。服务器返回的 Host 身份必须与二维码一致，不静默接受更换后的公钥。

双方界面统一显示完整指纹 `lowercaseHex(SHA256(decodedIdentityKey))`，可按组展示，但底层比较完整公钥。

## 准备手机身份和证明

为该 Server 生成或复用手机自己的 X25519 身份；私钥只在本机安全存储。重试、前后台切换和恢复过程中不能更换 deviceId 或密钥。

对每个 mobile POST：

```text
shared = X25519(phonePrivateKey, QR.serverPublicKey)
proofKey = HKDF-SHA256(shared,
    salt=UTF8(QR.sessionId),
    info=UTF8("dsh-pairing-v1/mobile"), L=32)
raw = 实际发送的 JSON 字符串（只序列化一次，无外层空白）
message = UTF8("POST\n" + path + "\n" + lowercaseHex(SHA256(UTF8(raw))))
X-DSH-Pairing-Proof = base64urlWithoutPadding(HMAC-SHA256(proofKey, message))
```

所有请求使用 UTF-8。哈希的是实际 JSON 文本，不是排序后的对象；属性顺序、内部空白和 Unicode 转义变化都会改变 proof。网络库不能再次序列化。X25519 不是签名算法，不转换为 Ed25519。

固定向量：Server `clients/fixtures/pairing/v1/proof.json`；Remote `fixtures/pairing/v1/proof.json`，两份相同。覆盖 mobile/status 和 Host 证明，Dart 首先核对 mobile 向量。向量中的私钥是公开测试材料，不能用于真实设备。

## 手机确认和验证码

用户主动确认后发送：

```http
POST /api/v1/device-pairing/sessions/{sessionId}/claim
Content-Type: application/json
X-DSH-Pairing-Proof: <mobile-proof>
```

```json
{"scanSecret":"<QR.scanSecret>","device":{"deviceId":"<phone-id>","name":"My phone","role":"client","platform":"android","identityKey":"<phone-public-key>"}}
```

响应：

```json
{"state":"claimed","verificationCode":"00123456","expiresAt":1790000000000}
```

此时**还没有 Remote 登录或连接权限**。

保存本次 claim 的准确请求字节以便受保护地短期恢复；响应丢失可携同一身份和完全相同的请求恢复同一个验证码，不能修改描述字段或为同一会话生成新码。不要把 claim 请求或验证码放入普通配置。临时配对材料必须按 origin、会话和手机身份隔离并在终态清理。

`deepseekUserId` 为可选非敏感元数据。没有实际可用接口时省略；不要为取得它上传或解析 DeepSeek 密码、Cookie、Token。它未经验证，不用于账号合并、设备找回或授权。

## 等待电脑和领取结果

每 2～3 秒：

```http
POST /api/v1/device-pairing/sessions/{sessionId}/mobile/status
Content-Type: application/json
X-DSH-Pairing-Proof: <mobile-proof-for-this-path>

{}
```

| state | 手机行为 |
| --- | --- |
| claimed | 显示验证码，等待电脑人工提交 |
| approved | 电脑验证码已正确提交，等待服务端完成；仍不连接、不发布登录成功 |
| completed | 校验并保存本手机 credentials，固定 Host 公钥后自动连接 |
| failed | 清除验证码，说明配对失败，需要重新扫码；不能继续使用旧码 |
| cancelled | 清除临时状态，回到 Remote 入口 |
| expired | 清除临时状态，要求电脑重新生成二维码 |

completed 响应的 credentials：

```json
{
  "account":"device:<UUID>",
  "accountKind":"device_only",
  "device":{"deviceId":"<phone-id>","name":"My phone","role":"client","platform":"android","identityKey":"<phone-public-key>"},
  "inboundOnly":false,
  "pairingRestricted":true,
  "tokens":{"accessToken":"...","accessTokenExpiresAt":1790000000000,"refreshToken":"...","refreshTokenExpiresAt":1790000000000}
}
```

必须校验：sessionId、二维码 Host 公钥和 ID、本手机 ID/公钥/role、有效的 Token 字段。不要把 Host 凭证作为手机凭证使用。先完成安全存储，再发布登录成功；存储失败可在恢复窗口重取同一组凭证。不能用旧轮询结果覆盖已经刷新的凭证。

本会话结果在 `expiresAt + 300 秒` 后不可领取（创建后共 480 秒）。验证码有效期仍为创建后 180 秒；恢复窗口不增加验证码尝试机会。

自动连接复用原有 RemoteAccount/Host 信任固定、Noise IK、WebRTC/P2P/TURN/Relay 逻辑，目标必须是本次二维码的 Host，不能随意选择列表中的第一台。手机后台时暂停不必要轮询，恢复前先验证当前 origin、账号及配对代次。

## 取消、续期和撤销

用户取消：`POST .../{sessionId}/mobile/cancel`，body `{}`、mobile proof。completed 后不能靠 cancel 撤销绑定。

完成后沿用设备 Token：

- `POST /api/v1/auth/refresh`：正常设备凭证轮换。
- `GET /api/v1/devices`：仅发现已经授权的 Host。
- `GET /api/v1/devices/{hostId}`：获取并核对公钥和 Membership。
- `GET /api/v1/device-memberships`：查看本手机自己的授权关系。
- `DELETE /api/v1/device-memberships/{hostId}`：只撤销本手机与该 Host 的关系。
- `DELETE /api/v1/devices/self`：退出并撤销本手机身份及其授权。

不要调用账号级 Host 删除接口删除整台电脑。绑定不赋予手机 Web、Admin、云资源或其他设备的管理权限。

## 既有账号与异常

- Device-only 不允许 Remote Web 登录；不要提供“继续登录网页”来完成配对。
- 新手机配对既有 Host 时，沿用 Host 内部所有者，只授权这一对。
- 手机已注册在另一个内部账号，而目标 Host 已有不同所有者：Server 返回 failed / `PAIRING_ACCOUNT_CONFLICT`。不自动注销、覆盖已有凭证、合并账号或转移 Host；先向用户解释，让其明确选择后续操作。
- `PAIRING_CLOSED`、`PAIRING_ATTEMPT_USED`：查询结果或重新扫码，不更换验证码继续尝试。
- 429：退避，不能自动生成新会话绕过限制。
- 503 / `AUTHORIZATION_SYNC_PENDING`：变更可能已保存，查询状态；不重新 claim 为另一身份。
- 旧 Server 404：明确不支持；不退回跳过电脑验证码的流程。
- 手机从不调用 `/host/confirm`；原提交恢复由电脑端负责。

新 Host 默认仅被控，不派生 Client 身份。DSH-Go 不能在配对后替 Host 打开主控权限。

## 验收清单

1. Dart 实际运行 mobile proof 固定向量通过。
2. 手机人工确认前不提交 claim；电脑成功提交前无 Token、无远程访问。
3. 手机显示的码保留前导零、只有一个有效期，不向 Host 查询接口或日志泄露。
4. 电脑首次输错，手机进入失败终态；同二维码/验证码不能继续尝试。
5. 手机断网、退出、切后台、重复扫码、服务器切换及迟到响应不能串用身份。
6. 正确完成后安全存储、Host 公钥固定、自动连接；冷启动后按现有设备凭证恢复。
7. 凭证存储失败可在窗口内恢复；已刷新的凭证不被旧结果覆盖。
8. Host 公钥替换、错误会话、错误手机身份、撤销及账号冲突均 fail closed。
9. 正常账号原有密码/OAuth 登录、恢复和连接保持兼容。
10. Android 真机执行完整流程及原有 E2EE/P2P/Relay 回归。Node 模拟手机的通过不等同于 Dart 或真机验收。

## 已完成的跨仓库验证

Remote `scripts/check-device-pairing.ts` 使用隔离临时数据库、实际 C# API/Gateway、Remote HostPairing、HostServerConnection 和 Node 模拟手机，覆盖：配对前无凭证、正确配对、独立凭证、重启恢复、Host hello、Noise/Relay 加密 RPC、具体关系撤销。

它不会连接生产，不使用固定人工账号，不替真实用户批准配对。

运行前构建 Server 的两个 C# 项目；在 Remote 仓库使用 Node 24.9+：

```sh
DSH_PAIRING_SERVER_ROOT=/absolute/path/to/deepseek-harness-server node --import tsx scripts/check-device-pairing.ts
```

完整 wire schema、错误码、限额和迁移说明以权威协议及 Server OpenAPI 为准。
