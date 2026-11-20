# DSH Web 局域网会话交接

Android、iOS、鸿蒙和 Web 采用同一入口。仅当前连接为 LAN 且 Host 声明 `dsh.web.lan.direct.v1` 时，经已认证 Noise 调用 `dsh.web.lan.direct.open({})`。Host 在 RTC 选中的本机私网 IPv4 或同机回环地址 `127.0.0.1` 上分配端口，返回 `{sessionId,url,browserGrant,expiresAt}`。浏览器直接访问该地址，首次换票后以 HttpOnly Cookie 访问页面、API 和 WebSocket。只知道 IP 和端口时返回 401。原生 DSH 凭据只在 Host 使用。

Web 对接时复用 hostc 的弹窗交接，校验弹窗对象、精确 origin 和一次性票据有效期。使用会话 ID 关闭对应 LAN 接口。P2P、TURN、Relay 及旧 Host 调用原有 hostc 接口。LAN HTTP/WS 为明文，适用于可信局域网。[接口与换票细节](../protocol.md#dsh-web-lan-handoff)

Android 和 iOS 支持 Linux Host 的 `dsh.web.lan.ipv6.v1`。Host 按当前 ICE 候选对和内核 IPv6 路由及邻居表复核同链路，绑定选中的本机 IPv6 地址。换票、HTTP 和 WebSocket 都要求请求源地址与已验证的对端 IPv6 地址一致。IPv6 同链路验证失效时，Host 会回收监听和会话。
