# Server 职责与接入边界

本文说明 Remote 与 Server 的职责划分。线协议统一在 [protocol.md](protocol.md)；完整站点的内部实现、数据库 schema、迁移、Admin 和部署配置由独立 Server 仓库维护。

## 两种 Server

| 范围 | 本仓库 `apps/server` | 独立完整 Server |
| --- | --- | --- |
| 账号 | 环境变量配置的单账号 | 多账号及站点支持的授权方式 |
| 持久化 | JSON 文件 | 由独立仓库维护 |
| 设备 | 注册、自有角色、刷新、发现和撤销等已实现 API | 完整账号/设备管理与关系授权 |
| 连接 | Control、Noise 握手转发、可配置 WebRTC signaling/TURN credential、加密 Relay | 同一协议及部署实际启用的可选扩展 |
| Web | 登录和设备状态页 | Remote Web 会话 UI 与 Admin |
| 可选配对/Relay 恢复 | 不声明未实现能力 | 按 capability 协商，不能由版本号推断 |

最小 Server 的安装、环境变量、API 和 Docker 说明见 [README](../apps/server/README.zh.md)。未配置 STUN/TURN 时保持 Relay-only；它不是完整站点的替代实现。

## 职责

Server 处理账号授权、设备 credential、membership、presence、连接协调、ICE/TURN 配置与密文路由，不执行 Harness 或 Agent 任务。

- Host 与 Client 使用独立设备身份和凭据，主动建立出站 Control WebSocket。
- REST、Control、Relay 与 signaling 均校验设备状态、角色、有效关系和连接归属。
- 账号 token 与 device token 隔离；账号 token 只用于对应账号 API 和设备 bootstrap，不作为 Control 身份。
- 普通同账号设备按协议派生 membership；扫码配对受限设备只取得显式批准的关系，不能恢复全账号自动授权。
- 首次公钥分发依赖 Server；既有 key pinning 与 Noise 不构成独立的首次身份验证，见[信任边界](end-to-end-encryption.md#2-设备身份与信任)。

## 互操作接口

稳定入口包括 `/api/v1/*` REST 和 `/ws/v1/connect` Control WebSocket。请求、响应、错误、frame 限额和 capability 以协议为准，不在本文件复制 schema。

Host 注册、刷新和本地存储见 [Plugin 接入](plugin-integration.md)；Browser Launcher 只换取自己的独立设备凭据、查询 Host 并打开 Remote Web，不在扩展内实现会话 runtime。

Server 必须按每条 connection 保持 signaling、`transport.selected` 与 `secure.handshake` 的转发顺序；未知 target、错误角色、越权连接及超限帧拒绝。单条逻辑连接关闭不能影响同一 Host 的其他 Client。

TURN credential 仅向有权限且正在建立连接的双方签发；TURN secret 不返回客户端。Relay 只处理不透明密文，并执行连接归属、大小、背压和慢消费者限制。

## 可选能力

能力由当前 Server、Host、Client 以及所需节点共同协商，缺少任一方时保留原行为：

- [设备配对](device-pairing-v1.md)：手机确认、单次验证码与电脑本机最终提交；不等同普通 OAuth 登录。
- 独立 Relay attach：短期 ticket 绑定节点、epoch、connection 与设备对；不能复用到另一条连接。
- [控制面恢复](design/control-recovery.md)：共用双端授权租约；WebRTC 需健康 DataChannel，独立 Relay 需原 data socket 存活。不恢复主 Server Relay、丢失的 socket 或端点重启。

控制面中断时，已协商租约可能延迟撤销传播；不能宣称 Server 能物理保证断网 P2P 的瞬时断流。恢复不重放业务请求，也不重置 Noise counter。

## 安全与运维

- 生产 REST/Control 使用 HTTPS/WSS；开发与自托管 HTTP 例外必须符合客户端显式策略。
- 浏览器 Origin、令牌 subject、角色、membership 和连接状态独立校验；服务端授权不能替代端到端身份固定。
- 不保存或记录 Prompt、会话、工作区路径、源码、工具输出、Relay ciphertext、设备私钥或临时票据。
- 可记录脱敏设备/连接 ID、错误码、状态、时长和聚合流量；不得把授权 header、Cookie 或完整敏感请求体写入日志。
- refresh 轮换与直接后继恢复必须原子持久化，保留原过期时间；过时 token 不能撤销当前有效 pair。
- 设备/关系撤销更新持久状态并终止相关活动连接；不影响其他授权设备。
- Admin 只管理账号、设备、连接和部署元数据，不获得会话解密能力。完整站点的 Admin 鉴权与路由在其所属仓库维护。
- TLS 反向代理需支持 WebSocket upgrade；API/WS 先于 SPA fallback，未知 API 返回 JSON 错误。健康检查不暴露凭据或敏感配置。
- 备份持久设备状态及本 Server 所需 secret；不要把 Host/Client 私钥复制到 Server。恢复、迁移和多实例部署遵循对应 runtime 的运维指南。
