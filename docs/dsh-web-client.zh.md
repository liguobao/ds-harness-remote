# Remote Client 接入「打开 DSH Web」

适用于 Android、iOS 和复用 Remote Noise RPC 的其他 Client。线协议见 [DSH Web browser handoff](protocol.md#dsh-web-browser-handoff)，返回值校验复用 [共享 schema](../packages/protocol/src/dsh-web.ts)。

## 联调前置条件

| 组件 | 需要具备的能力 |
| --- | --- |
| Host 插件 | 支持 `dsh.web.v1`。当前 Harness 实例已挂载 `webApp`，Web 监听器已就绪，官方浏览器鉴权可用。插件从运行时读取实际监听地址，支持动态端口。使用本机 HTTPS 时，证书须通过 Host 进程的正常验证。 |
| Remote Server | 已启用 DSH Web 会话接口，支持分配、签票、租约授权复查和关闭。准备一组有效的已配对 Host 与 Client。两台设备属于同一账号，账号持有有效会员权益。 |
| hostc Worker | 具备内部控制、Host 出站 WSS、一次性换票和浏览器会话校验。返回的浏览器域名具备有效 HTTPS 证书。 |
| Client | 使用现有配对流程建立已认证的 Noise 连接。WebView 支持顶层表单 POST，并在同一实例中接收 Cookie 和跟随 303。 |

**Host 插件需要一起升级。** 它负责读取本机监听地址、使用既有设备凭据调用 Server、建立出站 WSS，并保留 DSH Web 自身鉴权。本机地址和 DSH 启动凭据留在 Host。Client 一侧沿用已有配对和连接，用户点击即可打开 WebView。

## 打开和关闭

1. **探测能力。** 连接完成后从 `harness.transport.describe({})` 读取 `capabilities`。当前 Host 有 `dsh.web.v1` 且连接在线时显示按钮。切换 Host 或重连后按新连接重新探测。
2. **发起一次打开。** 在当前 Noise 连接上调用 `dsh.web.open({})`。按钮进入等待状态，合并连点。Host 和 Client 身份取自当前连接，RPC 请求体使用空对象。用户切换 Host、关闭打开页或断线时，丢弃晚到的结果。
3. **校验响应。** 用 `dshWebGrantSchema` 校验 `{ url, browserGrant, expiresAt }`。其中 `url` 是干净的 HTTPS 根地址，`browserGrant` 是短期一次性票据，`expiresAt` 是兑换截止时间，以 Unix 毫秒表示。票据在 WSS 就绪后签发，当前 Server 的兑换窗口最长 30 秒。确认票据仍有效后马上打开 WebView。
4. **在 WebView 内换票。** 首次导航直接对 `url` 同源的 `/__remote/session` 发起顶层 POST，发送 URL 编码的 `browserGrant` 字段。Worker 消费票据、返回 `Set-Cookie` 和 `303 Location: /`。同一 WebView 完成跳转，并在后续 HTTP、SSE、WebSocket 握手时自动携带隧道会话 Cookie。
5. **关闭与重试。** WebView 关闭时，对打开它的同一条 Noise 连接尽力发出 `dsh.web.close({})` 并销毁视图。已过期、已消费或兑换结果不明确时，关闭当前视图后重新发起打开请求，取得新票据。刷新已进入的页面时加载干净地址，避免重发换票 POST。

首次导航示例，校验过的 `grant` 是打开 RPC 的结果。

```ts
const source = {
  uri: new URL('/__remote/session', grant.url).href,
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'browserGrant=' + encodeURIComponent(grant.browserGrant),
}
```

只允许 WebView 顶层导航停留在当前隧道的 HTTPS origin。POST 由同一个 WebView 的原生网络栈发送并跟随重定向，应用的登录 Cookie、客户端 Bearer 和 Host 拨号 token 均无需传入。票据仅保存在当前打开流程的内存中，避开 URL、持久存储、埋点、错误上报和日志。隧道 Cookie 带 `__Host-` 前缀，含 `Secure`、`HttpOnly`、`Path=/` 和 `SameSite=Lax`，省略 `Domain`，有效期受租约约束。

Android 的 WebView POST 使用原生 `postUrl`，表单 body 是跨平台必需项，自定义 headers 在 Android POST 路径上不会传递。iOS 使用 WKWebView 的原生请求。两端都要实机确认 303 后的首次 GET 已携带 Cookie。现有代码入口是 [设备详情页](../packages/app-core/src/screens/device-screens.tsx) 和 [DSH Web WebView](../packages/app-core/src/screens/dsh-web-screen.tsx)。Host 入口见 [运行时发现](../packages/plugin/src/index.ts) 和 [隧道生命周期](../packages/plugin/src/dsh-web-host.ts)。

## 错误与验收

| 结果 | Client 处理 |
| --- | --- |
| 缺少 `dsh.web.v1` | 隐藏入口。联调时检查 Host 插件及本机 DSH Web 是否兼容、已就绪。 |
| `WEB_ENTITLEMENT_REQUIRED` | 提示需要有效会员。 |
| `MEMBERSHIP_REQUIRED` 或 `CONNECTION_NOT_FOUND` | 检查当前设备配对关系和已认证连接。 |
| `DSH_WEB_NOT_READY`、`TUNNEL_UNAVAILABLE` 或打开超时 | 显示可重试错误，用户再次操作时发起新的打开。 |
| 换票返回 `410` 或兑换后页面访问失败 | 清理当前打开流程。重新打开时申请新票据。 |
| WebView 打开后 Host 离线、会员撤销或租约到期 | 当前页面流可能断开。关闭页面后按当前连接状态重新打开。 |

使用已配对的真实设备验证以下场景。

- Android 与 iOS 分别点一次打开。确认顶层 POST 后收到 303，首个 GET 带会话 Cookie，页面可使用 HTTP、SSE 和 WebSocket。
- 将干净 URL 复制到另一浏览器。未兑换该隧道票据的浏览器应被拒绝，另一位会员登录 Remote 也一样。
- 并发兑换同一张票据，预期仅一次返回 303。过期后提交原票据应被拒绝。
- 分别验证连点、打开过程中切换 Host、关闭 WebView、断线和撤销会员。关闭或授权失效后，已打开的连接应终止。Host 每 15 秒检查一次授权，断线重拨前也复查。
- 检查 Client、Host、Server 和 Worker 日志，确认地址栏、历史记录和日志里都没有票据、拨号 token、会话 Cookie 或 DSH 启动凭据。
