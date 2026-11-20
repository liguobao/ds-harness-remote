# Remote Client 接入「打开 DSH Web」

适用于 DSH Go、Android、iOS 和复用 Remote Noise RPC 的其他 Client。这里的 DSH Web 指当前远程 Host 提供的 Harness 网页界面。线协议见 [DSH Web browser handoff](protocol.md#dsh-web-browser-handoff)，返回值以 [共享 schema](../packages/protocol/src/dsh-web.ts) 为准。

## DSH Go 接入

在 DSH Go 的 DSHarness Remote 连接模式中，复用 Dart 客户端已建立的认证 Noise 连接，在当前 Host 的操作入口接入「打开 DSH Web」。DSH Go 上游 README 仍将 App 内打开远程网页版列为限制，以下是开发接入流程。[DSH Go 项目说明](https://github.com/ccch1mneyyy/dsh-Go#可以做什么)

1. 连接成功后调用 `harness.transport.describe({})`。支持 hostc 的 Host 声明 `dsh.web.v1`。仅在当前连接有可用路径时显示入口，切换 Host 或重连后重新探测。
2. 当前连接为 LAN、Host 声明 `dsh.web.lan.direct.v1` 且 `dshWebLanReady` 未明确返回 `false` 时，调用 `dsh.web.lan.direct.open({})`。其他连接走下节的 hostc 流程。LAN 打开返回 `FEATURE_NOT_SUPPORTED` 且 Host 也声明了 `dsh.web.v1` 时，可改走 hostc。IPv6 直连需额外实现 [同链路 ICE 候选对验证所需的请求参数](protocol.md#dsh-web-lan-handoff)。
3. LAN 响应按 `dshWebLanGrantSchema` 校验，包含 `sessionId`、`url`、`browserGrant` 和 `expiresAt`。IPv4 路径只接受 Host 私网 IPv4 或同机 `127.0.0.1` 上带端口的 HTTP 根地址。用同一 WebView 顶层加载 `GET /__remote/session-bootstrap`，仅在这次请求中通过 `X-DSH-Web-Grant` 传票据。跟随跳转后由 WebView 保存并发送 Cookie。LAN 使用明文 HTTP 和 WebSocket，仅在可信局域网中启用，并将明文加载限制在当前交接地址。
4. WebView 顶层导航限于本次交接的精确 origin。取消、关闭或切换 Host 时清理当前 WebView，并在原 Noise 连接上尽力调用 `dsh.web.lan.direct.close({ sessionId })`。晚到的 LAN 响应也应按返回的 `sessionId` 关闭。重试时重新申请票据，已进入的页面刷新时直接加载根地址。

上机分别验证同网 LAN 和跨网 hostc，确认换票跳转后的首次 GET 携带 Cookie，页面的 HTTP、SSE 和 WebSocket 可用，切换 Host、关闭页面或断开父连接后会话被回收。Android 和 iOS 的 [WebView 实现](../packages/app-core/src/screens/dsh-web-screen.tsx) 可作为参考。

## hostc 联调前置条件

| 组件 | 需要具备的能力 |
| --- | --- |
| Host 插件 | 支持 `dsh.web.v1`。当前 Harness 实例已挂载 `webApp`，Web 监听器已就绪，官方浏览器鉴权可用。插件从运行时读取实际监听地址，支持动态端口。使用本机 HTTPS 时，证书须通过 Host 进程的正常验证。 |
| Remote Server | 已启用 DSH Web 会话接口，支持分配、签票、租约授权复查和关闭。准备一组有效的已配对 Host 与 Client。两台设备属于同一账号。普通账号、仅设备账号和会员均可使用。 |
| hostc Worker | 具备内部控制、Host 出站 WSS、一次性换票和浏览器会话校验。返回的浏览器域名具备有效 HTTPS 证书。 |
| Client | 使用现有配对流程建立已认证的 Noise 连接。WebView 支持顶层表单 POST，并在同一实例中接收 Cookie 和跟随 303。 |

**Host 插件需要一起升级。** 它负责读取本机监听地址、使用既有设备凭据调用 Server、建立出站 WSS，并保留 DSH Web 自身鉴权。本机地址和 DSH 启动凭据留在 Host。Client 一侧沿用已有配对和连接，用户点击即可打开 WebView。

## hostc 打开和关闭

1. **探测能力。** 连接完成后从 `harness.transport.describe({})` 读取 `capabilities`。当前 Host 有 `dsh.web.v1` 且连接在线时显示按钮。切换 Host 或重连后按新连接重新探测。
2. **发起一次打开。** 在当前 Noise 连接上调用 `dsh.web.open({})`。按钮进入等待状态，合并连点。Host 和 Client 身份取自当前连接，RPC 请求体使用空对象。用户切换 Host、关闭打开页或断线时，丢弃晚到的结果。
3. **校验响应。** 用 `dshWebGrantSchema` 校验 `{ url, browserGrant, expiresAt }`。其中 `url` 是干净的 HTTPS 根地址，`browserGrant` 是短期一次性票据，`expiresAt` 是兑换截止时间，以 Unix 毫秒表示。票据在 WSS 就绪后签发，当前 Server 的兑换窗口最长 30 秒。确认票据仍有效后马上打开 WebView。
4. **在 WebView 内换票。** WebView 对 `url` 同源的 `/__remote/session` 发起顶层 POST，发送 URL 编码的 `browserGrant` 字段。Worker 消费票据、返回 `Set-Cookie` 和 `303 Location: /`。同一 WebView 完成跳转，并在后续 HTTP、SSE、WebSocket 握手时自动携带隧道会话 Cookie。
5. **关闭与重试。** WebView 关闭时，对打开它的同一条 Noise 连接尽力发出 `dsh.web.close({})` 并销毁视图。已过期、已消费或兑换结果不明确时，关闭当前视图后重新发起打开请求，取得新票据。刷新已进入的页面时加载干净地址，避免重发换票 POST。

只允许 WebView 顶层导航停留在当前隧道的 HTTPS origin。POST 和重定向都在同一个 WebView 内完成，应用的登录 Cookie、客户端 Bearer 和 Host 拨号 token 均无需传入。票据仅保存在当前打开流程的内存中，避开 URL、持久存储、埋点、错误上报和日志。隧道 Cookie 带 `__Host-` 前缀，含 `Secure`、`HttpOnly`、`Path=/` 和 `SameSite=Lax`，省略 `Domain`，有效期受租约约束。

Android 和 iOS 都从已校验的隧道 HTTPS 根地址派生同源本地表单页的 `baseUrl`，并用 `same-origin` referrer policy 自动提交表单。两端的原生 POST 都可能产生不透明的 Origin，使 Worker 拒绝换票。两端都要实机确认 303 后的首次 GET 已携带 Cookie。现有代码入口是 [设备详情页](../packages/app-core/src/screens/device-screens.tsx) 和 [DSH Web WebView](../packages/app-core/src/screens/dsh-web-screen.tsx)。Host 入口见 [运行时发现](../packages/plugin/src/index.ts) 和 [隧道生命周期](../packages/plugin/src/dsh-web-host.ts)。

## 错误与验收

| 结果 | Client 处理 |
| --- | --- |
| 缺少 `dsh.web.v1` | 隐藏入口。联调时检查 Host 插件及本机 DSH Web 是否兼容、已就绪。 |
| `RATE_LIMITED`（Server HTTP 接口） | 普通账号和仅设备账号共享新建隧道额度。额度用完后稍后重试。 |
| `MEMBERSHIP_REQUIRED` 或 `CONNECTION_NOT_FOUND` | 检查当前设备配对关系和已认证连接。 |
| `DSH_WEB_NOT_READY`、`TUNNEL_UNAVAILABLE` 或打开超时 | 显示可重试错误，用户再次操作时发起新的打开。 |
| 换票返回 `410` 或兑换后页面访问失败 | 清理当前打开流程。重新打开时申请新票据。 |
| WebView 打开后 Host 离线、配对撤销或租约到期 | 当前页面流可能断开。关闭页面后按当前连接状态重新打开。 |

使用已配对的真实设备验证以下场景。

- Android 与 iOS 分别点一次打开。确认顶层 POST 后收到 303，首个 GET 带会话 Cookie，页面可使用 HTTP、SSE 和 WebSocket。
- 将干净 URL 复制到另一浏览器。未兑换该隧道票据的浏览器应被拒绝。
- 并发兑换同一张票据，预期仅一次返回 303。过期后提交原票据应被拒绝。
- 分别验证连点、打开过程中切换 Host、关闭 WebView、断线和撤销配对。关闭或授权失效后，已打开的连接应终止。Host 每 15 秒检查一次授权，断线重拨前也复查。
- 检查 Client、Host、Server 和 Worker 日志，确认地址栏、历史记录和日志里都没有票据、拨号 token、会话 Cookie 或 DSH 启动凭据。
