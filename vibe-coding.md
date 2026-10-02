# DeepSeek Harness Remote — Full Vibecoding Development Prompt

> 仓库范围变更：本文仅保留原始需求背景，权威边界见 `README.md` 和 `docs/README.md`。本仓库提供 Plugin、Client、共享协议和 `apps/server` 最小自部署版本；完整 Server、Remote Web 与 Admin 仍由独立仓库实现。

你是一名资深全栈 / Electron / React Native / WebRTC / FastAPI / TypeScript 工程师。

请帮助我从零设计并实现一个开源项目：

# `deepseek-harness-remote`

它为 **DeepSeek Harness** 提供类似 Codex Remote / Claude Code Remote 的远程访问能力，但第一阶段不要追求完整复刻任何商业产品。

核心目标：

> 在一台运行 DeepSeek Harness 的电脑上安装 Remote 插件后，我可以通过 Android、Web、macOS、Windows、Linux 客户端安全连接到这台电脑，查看 Harness 状态、会话、Agent 输出、权限请求，并继续发送指令。

项目应该优先：

1. 架构清晰；
2. 可自部署；
3. 尽量 P2P；
4. Server 尽量只做协调；
5. 不修改 DeepSeek Harness 核心源码；
6. MVP 能真正跑起来；
7. 安全边界明确；
8. 后续容易扩展成完整 Remote Agent 产品。

---

# 一、必须先阅读和理解的项目

开发前先阅读：

DeepSeek Harness：

`https://github.com/deepseek-ai/deepseek-harness`

DeepSeek Harness Quickstart：

`https://deepseek-harness.github.io/deepseek-harness/guide/quickstart`

重点阅读：

* Cordis plugin architecture
* `inject`
* `apply(ctx)`
* `ctx.effect()`
* `ctx.on()`
* Harness sessions
* agents
* tools
* permissions
* workspace
* Web UI
* Cordis patch / plugin loader
* `dsh web --patch`

Cordis Primer：

`docs/cordis-primer.md`

并参考我已有的桌面端项目：

`https://github.com/liguobao/dsh-desktop`

尤其理解：

* Electron 如何启动本地 `@deepseek-ai/dsh`
* 如何加载独立 Harness plugin
* `$DSH_HOME/profiles/node_modules`
* `--patch`
* Electron main / preload / renderer 安全隔离
* Harness Web UI 与 Electron 的关系
* Windows / macOS / Linux 打包方式

**禁止为了方便直接修改 DeepSeek Harness 源码。**

Remote 必须尽可能以独立 Plugin 实现。

---

# 二、产品定义

项目名称：

`deepseek-harness-remote`

简称：

`DSH Remote`

整体由四部分构成：

```text
DeepSeek Harness Host
        │
        │ Cordis Plugin
        ▼
@dsh-remote/plugin
        │
        ├──────── WebRTC DataChannel ────────┐
        │                                    │
        │                                    ▼
        │                              Remote Client
        │
        │
        └── Signaling / Relay ──► DSH Remote Server
```

完整结构：

```text
deepseek-harness-remote/

apps/
  server/
  server-web/
  desktop/
  android/
  web/

packages/
  plugin/
  protocol/
  crypto/
  webrtc/
  client-core/
  ui/
  config/

docs/

deploy/

examples/
```

推荐使用 monorepo。

JS/TS 包管理优先：

```text
pnpm workspace
```

Python Server 独立维护：

```text
apps/server
```

---

# 三、MVP 产品范围

第一版不要实现完整 Codex Remote。

第一版必须跑通：

## Host 端

电脑运行：

```bash
dsh
```

安装：

```bash
npm install @dsh-remote/plugin
```

或者通过 Harness profile/plugin 机制加载。

Plugin 启动后：

```text
Remote service started

Device Code:
DSH-82KF-7QMP

Server:
https://remote.example.com

Waiting for remote client...
```

可以生成二维码：

```text
dshremote://pair?server=...&code=...
```

Host 必须显示：

* Device ID
* Device name
* OS
* Harness version
* Plugin version
* 在线状态
* Server
* P2P 状态
* 已绑定设备
* 最近远程连接

---

# 四、Remote Client 第一版功能

客户端打开以后：

```text
My Devices

MacBook Pro
Online
P2P

Windows PC
Offline

Linux Server
Online
Relay
```

进入设备：

```text
MacBook Pro

Workspace
~/Projects/foo

Harness
Running

Session
Fix OAuth issue
```

需要支持：

## 1. 查看状态

显示：

* host online/offline
* OS
* hostname
* Harness version
* plugin version
* current workspace
* active session
* connection mode

连接模式显示为：

```text
LAN
P2P
TURN
Relay
```

---

# 五、会话功能

远程端至少能够：

```text
List Sessions
Get Session
Create Session
Resume Session
Send Message
Stop Generation
Subscribe Session Events
```

UI 类似聊天客户端。

例如：

```text
User:
帮我看看 src/auth.ts

Assistant:
我先检查相关文件……

Tool:
read src/auth.ts

Assistant:
这里存在……

Permission Request:
Execute:
npm test

[Allow once]
[Allow]
[Deny]
```

必须支持 Streaming。

不要轮询获取输出。

使用事件协议。

---

# 六、权限请求是第一等公民

Remote 不能变成一个“无条件远程 shell”。

必须把 Harness 原有 Permission 系统映射到 Remote Protocol。

例如：

```json
{
  "type": "permission.request",
  "requestId": "xxx",
  "sessionId": "xxx",
  "permission": {
    "kind": "command",
    "command": "npm test",
    "cwd": "/home/user/project"
  }
}
```

客户端：

```text
Remote permission request

Command:
npm test

Directory:
~/project

[Allow Once]

[Allow Session]

[Deny]
```

Remote Client 不应该拥有比本机 Harness 更高的权限。

原则：

> Remote 只是 Harness UI / control surface 的另一种入口，而不是绕过 Harness 权限模型。

---

# 七、Plugin 架构

实现：

```text
packages/plugin
```

包名：

```text
@dsh-remote/plugin
```

插件遵循 DeepSeek Harness / Cordis 生命周期。

示意：

```ts
export const inject = [
  "sessions",
  "agents",
  ...
]

export function apply(ctx, config) {
  // initialize remote service

  ctx.effect(() => {
    // startup

    return () => {
      // shutdown
    }
  })
}
```

但不要猜测 Harness API。

在写实现前：

**必须首先阅读当前 DeepSeek Harness 源码确认真实 API。**

不要虚构：

```text
ctx.sessions.xxx
ctx.agent.xxx
ctx.permissions.xxx
```

如果 API 和预想不同：

以实际 API 为准。

建立 adapter：

```text
packages/plugin/src/adapters/
  session-adapter.ts
  permission-adapter.ts
  workspace-adapter.ts
  agent-adapter.ts
```

避免 Remote Protocol 与 Harness 内部 API 强耦合。

形成：

```text
Harness API
    │
    ▼
Harness Adapter
    │
    ▼
Remote Protocol
```

未来 Harness API 变更时，只修改 adapter。

---

# 八、Plugin 不启动公开 HTTP Server

默认禁止：

```text
0.0.0.0:xxxx
```

不要简单地：

```text
在 Host 开一个 WebSocket server
然后暴露公网端口
```

Host Plugin 应主动向协调 Server 发起出站连接。

例如：

```text
Host
  └── WSS outbound
          │
          ▼
      Remote Server
```

这样：

* 不要求公网 IP
* 不要求用户配置端口映射
* NAT 后可以使用
* 公司网络更容易工作

---

# 九、Connection 架构

连接优先级：

```text
1 LAN direct
2 WebRTC P2P
3 WebRTC TURN
4 WebSocket encrypted relay
```

抽象统一接口：

```ts
interface RemoteTransport {
  connect(): Promise<void>

  send(data: Uint8Array): Promise<void>

  onMessage(cb): void

  close(): Promise<void>

  getStats(): TransportStats
}
```

实现：

```text
LanTransport
WebRTCTransport
RelayTransport
```

业务协议绝对不能直接依赖 WebRTC API。

---

# 十、WebRTC

优先使用：

```text
RTCPeerConnection
RTCDataChannel
```

用途是数据传输，不需要音视频。

创建：

```text
dsh-control
dsh-events
```

也可以 MVP 只使用一个：

```text
dsh
```

DataChannel：

```text
ordered: true
```

WebRTC signaling 通过 Server 完成。

例如：

```text
Host
 |
 | websocket
 |
Server
 |
 | websocket
 |
Client
```

Server 传递：

```text
offer
answer
ice candidate
```

Server 不参与正常 P2P 数据。

---

# 十一、STUN / TURN

支持配置：

```yaml
iceServers:

  - urls:
      - stun:stun.example.com:3478

  - urls:
      - turn:turn.example.com:3478

    username: xxx
    credential: xxx
```

不要在客户端永久硬编码 TURN 密码。

Server 提供短期 TURN credential。

推荐为 coturn 预留支持。

部署结构：

```text
FastAPI
PostgreSQL/SQLite
coturn
nginx/caddy
```

但 MVP DB 使用 SQLite。

---

# 十二、Relay Fallback

如果 WebRTC 失败：

```text
Host <-- WSS --> Server <-- WSS --> Client
```

Server 只负责转发 envelope。

例如：

```json
{
  "deviceId": "...",
  "connectionId": "...",
  "payload": "..."
}
```

**Relay payload 应使用端到端加密。**

Server 不应该能够读取 Harness conversation 内容。

---

# 十三、端到端加密

不要仅依赖 HTTPS/WSS。

定义 app-level secure channel。

推荐研究并选一种成熟方案：

```text
Noise Protocol
```

或者：

```text
X25519
HKDF-SHA256
ChaCha20-Poly1305
```

优先使用成熟 library。

禁止自己发明密码算法。

每个设备生成：

```text
device public key
device private key
```

private key：

Android：

```text
Android Keystore
```

macOS：

```text
Keychain
```

Windows：

```text
DPAPI / Credential Manager
```

Linux：

```text
Secret Service
```

Web：

```text
IndexedDB
```

Web 安全能力较弱，要在 UI 明确说明。

---

# 十四、设备身份

每个 Host 创建：

```text
device_id
device_name
device_keypair
```

例如：

```json
{
  "deviceId": "01K...",
  "name": "Li's MacBook",
  "platform": "darwin",
  "publicKey": "..."
}
```

Device ID 使用：

```text
UUIDv7
```

或者：

```text
ULID
```

不要：

```text
hostname 作为 ID
MAC address 作为 ID
硬盘序列号作为 ID
```

---

# 十五、设备配对

支持两种方式。

## A. Device Code

Host：

```text
Device code:

82KF-7QMP

Expires in 10 minutes
```

Remote Client：

```text
Enter device code
```

建议 code：

```text
8 位 Base32
```

要求：

* 至少约 40 bit entropy
* 10 分钟过期
* 单次使用
* Server rate limit
* IP rate limit
* device rate limit
* 错误次数限制

不要使用简单：

```text
123456
```

作为永久认证方式。

---

# 十六、QR Code

Host：

```text
┌──────────────────┐
│                  │
│    QR CODE       │
│                  │
└──────────────────┘
```

内容：

```text
dshremote://pair?v=1
&server=https://remote.xxx
&code=82KF7QMP
```

Android 扫码即可配对。

---

# 十七、Login 模式

第一版 Login 可以简化。

支持：

```text
Anonymous Device Pairing
```

后续加入：

```text
Account Login
```

架构提前预留：

```text
users
devices
device_members
sessions
```

Server DB：

```text
users

devices

device_pairings

device_memberships

connections

refresh_tokens
```

匿名 pairing 可以创建：

```text
guest identity
```

但未来能够迁移到账户。

---

# 十八、Server

目录：

```text
apps/server
```

技术栈固定：

```text
Python 3.12+
FastAPI
SQLAlchemy 2
Alembic
Pydantic v2
SQLite
uvicorn
```

不要第一版使用：

```text
Redis
Kafka
RabbitMQ
Celery
Kubernetes
Postgres
```

保持简单。

---

# 十九、Server API

基本 API：

```text
GET /health

POST /api/v1/pairings
POST /api/v1/pairings/claim
POST /api/v1/pairings/confirm

GET /api/v1/devices
GET /api/v1/devices/{id}

DELETE /api/v1/devices/{id}

POST /api/v1/auth/refresh

GET /api/v1/turn/credentials
```

WebSocket：

```text
/ws/v1/host
/ws/v1/client
```

或者统一：

```text
/ws/v1/connect
```

连接建立后 authentication frame：

```json
{
  "type": "hello",
  "role": "host",
  "deviceId": "...",
  "token": "..."
}
```

---

# 二十、Signaling Protocol

例如：

```json
{
  "type": "signal.offer",
  "connectionId": "...",
  "targetDeviceId": "...",
  "sdp": "..."
}
```

```json
{
  "type": "signal.answer",
  "connectionId": "...",
  "sdp": "..."
}
```

```json
{
  "type": "signal.ice",
  "connectionId": "...",
  "candidate": {}
}
```

Server 只转发。

---

# 二十一、Remote Protocol

建立：

```text
packages/protocol
```

这是项目最重要的 shared package。

所有端：

```text
Host Plugin
Desktop
Android
Web
```

都使用同一 Protocol。

Protocol version：

```text
DSH Remote Protocol v1
```

所有 message：

```json
{
  "v": 1,
  "id": "01K...",
  "type": "...",
  "timestamp": 1786...,
  "payload": {}
}
```

---

# 二十二、RPC

采用简单 request / response。

Request：

```json
{
  "v": 1,
  "id": "abc",
  "type": "rpc.request",
  "payload": {
    "method": "sessions.list",
    "params": {}
  }
}
```

Response：

```json
{
  "v": 1,
  "id": "def",
  "type": "rpc.response",
  "payload": {
    "requestId": "abc",
    "result": []
  }
}
```

Error：

```json
{
  "type": "rpc.error",
  "payload": {
    "requestId": "abc",
    "code": "PERMISSION_DENIED",
    "message": "..."
  }
}
```

---

# 二十三、核心 RPC

MVP：

```text
system.info

workspace.get

sessions.list
sessions.get
sessions.create

session.send
session.stop

permissions.respond

connection.ping
```

尽量不要提供：

```text
shell.exec
filesystem.read
filesystem.write
```

这种绕过 Harness 的 Remote RPC。

文件操作应该通过 Harness Agent 完成。

---

# 二十四、Event

Host 主动发送：

```text
session.created

session.updated

message.created

message.delta

tool.started

tool.updated

tool.finished

permission.requested

permission.resolved

agent.status

connection.stats
```

例如：

```json
{
  "type": "event",
  "payload": {
    "event": "message.delta",

    "data": {
      "sessionId": "...",
      "messageId": "...",
      "delta": "正在检查..."
    }
  }
}
```

---

# 二十五、断线恢复

Remote 必须考虑：

```text
手机切 WiFi
进入后台
WebRTC 断开
电脑休眠
网络切换
```

客户端需要：

```text
CONNECTING

CONNECTED_P2P

CONNECTED_RELAY

RECONNECTING

OFFLINE
```

断线后：

1. reconnect signaling
2. recreate WebRTC
3. fallback relay
4. session resync

增加：

```text
events.sequence
```

例如：

```json
{
  "seq": 8271
}
```

客户端保存：

```text
lastSeq
```

Reconnect：

```text
sync.from(lastSeq)
```

如果历史 event 已清理：

```text
FULL_RESYNC_REQUIRED
```

然后请求：

```text
sessions.get
```

---

# 二十六、Keepalive

Host 与 Server：

```text
ping 20-30 秒
```

不要过于频繁。

Host DB heartbeat：

```text
last_seen
```

Client 展示：

```text
Online
Last seen 32 sec ago
```

---

# 二十七、Android

Android 第一版使用：

```text
React Native
```

优先考虑：

```text
Expo
```

但如果 WebRTC / Keystore / native integration 对 Expo 限制明显：

切换：

```text
React Native CLI
```

不要为了 Expo 强行牺牲 WebRTC。

包：

```text
react-native-webrtc
```

状态：

```text
Zustand
```

网络：

```text
fetch
WebSocket
```

Secure Storage：

```text
Keystore backed storage
```

Android MVP 页面：

```text
Server Setup

Pair Device

Devices

Device Detail

Sessions

Chat

Permission Dialog

Settings
```

---

# 二十八、Desktop

不要重复造轮子。

优先复用 / 合并：

`dsh-desktop`

技术：

```text
Electron
React
TypeScript
```

最终可能演进：

```text
DSH Desktop

Local
Remote
```

侧边栏：

```text
Local

Remote Devices
  Mac mini
  Linux Server
```

但第一阶段允许：

```text
apps/desktop
```

单独实现 Remote UI。

应尽量共享：

```text
packages/client-core
packages/ui
packages/protocol
```

---

# 二十九、Web Client

路径：

```text
apps/web
```

技术：

```text
React
Vite
TypeScript
```

Web 是“有限支持”。

支持：

* device list
* connection
* sessions
* chat
* permission approve
* WebRTC

限制：

* 浏览器 storage security
* 页面关闭即断开
* background limitations
* notification limitations
* mobile browser lifecycle

不要尝试做 Web terminal。

---

# 三十、Server Web

用户明确要求：

```text
Python + FastAPI + React + SQLite
```

所以 Server 管理界面：

```text
apps/server-web
```

使用：

```text
React
Vite
TypeScript
```

Server 可以生产部署时托管：

```text
server-web/dist
```

FastAPI：

```text
/static
/
```

页面：

```text
Login

Devices

Pair Device

Connections

Server Settings
```

---

# 三十一、自部署

必须做到：

```bash
docker compose up -d
```

包含：

```text
remote-server
coturn
```

SQLite：

```text
/data/remote.db
```

例如：

```yaml
services:

  server:
    image: ghcr.io/.../dsh-remote-server

  turn:
    image: coturn/coturn
```

支持：

```text
REMOTE_PUBLIC_URL

REMOTE_SECRET_KEY

DATABASE_URL

TURN_URL

TURN_SECRET
```

---

# 三十二、默认 Server

Client 支持默认 Server：

例如：

```text
https://remote.example.com
```

**不要把具体我的生产域名写死在源代码逻辑中。**

定义：

```text
DEFAULT_REMOTE_SERVER
```

build-time / runtime 可覆盖。

例如：

```text
DSH_REMOTE_SERVER
```

用户可以改为：

```text
https://remote.my-company.com
```

---

# 三十三、Server 不是 Remote Computer 的代理 API

Server 不应该保存：

```text
workspace files

source code

conversation plaintext

shell history

tool output
```

正常 P2P 模式：

Server 只知道：

```text
device presence
device public key
pairing
connection metadata
signaling
```

Relay 模式：

Server 只看到 encrypted payload。

---

# 三十四、安全设计

必须写：

```text
docs/SECURITY_ARCHITECTURE.md
```

Threat Model 至少讨论：

### 攻击者拿到 Device Code

措施：

```text
TTL
single-use
rate-limit
pair confirmation
```

### Server 被入侵

不能直接控制 Host。

原因：

```text
device private key stays local
E2EE
```

### 恶意 Client

只能拥有用户明确授权的设备权限。

### Replay attack

message：

```text
nonce
counter
timestamp
```

AEAD。

### Stolen refresh token

支持：

```text
device revoke
token rotation
```

### MITM

设备 key fingerprint 验证。

---

# 三十五、Pair Confirmation

推荐增加安全确认。

Client 输入 code：

```text
82KF-7QMP
```

Host 显示：

```text
Android Pixel 10
wants to connect.

Fingerprint:

F4A2 992C 13AB

[Allow]

[Deny]
```

确认后双方保存：

```text
trusted peer public key
```

这样 Server 即使知道 Device Code 也不能偷偷绑定设备。

---

# 三十六、Capabilities

连接 handshake：

Host：

```json
{
  "protocol": 1,

  "capabilities": [
    "sessions.list",
    "sessions.send",
    "session.streaming",
    "permission.respond"
  ]
}
```

Client 根据 capabilities 隐藏不支持的按钮。

不要假设不同 Harness 版本拥有完全相同能力。

---

# 三十七、Version Compatibility

Handshake：

```json
{
  "remoteProtocol": 1,
  "pluginVersion": "0.1.0",
  "harnessVersion": "...",
  "platform": "darwin"
}
```

如果不兼容：

```text
REMOTE_PROTOCOL_UNSUPPORTED
```

UI：

```text
This device requires DSH Remote 2.x
```

---

# 三十八、日志

Host：

```text
$DSH_HOME/logs/remote.log
```

日志禁止记录：

```text
auth token
private key
full prompt
source file content
TURN password
```

只记录：

```text
connection id
transport
duration
error code
state transition
```

---

# 三十九、Metrics

MVP 本地统计即可：

```text
connection attempts
p2p success rate
relay fallback rate
connection establishment time
disconnects
```

Admin Web：

```text
P2P 78%

TURN 15%

Relay 7%
```

不做复杂监控平台。

---

# 四十、测试

必须有：

## protocol unit tests

测试：

```text
encoding
decoding
version validation
RPC correlation
event sequence
```

## crypto tests

```text
key exchange
encrypt/decrypt
tampered message rejection
replay rejection
```

## server tests

pytest：

```text
pairing
auth
device list
WebSocket auth
signaling
relay authorization
```

## plugin tests

Mock Harness context。

## client-core

测试：

```text
reconnect
transport fallback
RPC timeout
event ordering
```

---

# 四十一、WebRTC 测试

至少测试：

```text
same LAN

different NAT

TURN forced

WebRTC disabled -> Relay

network interruption

client reconnect
```

提供：

```text
FORCE_RELAY=true
```

调试选项。

也提供：

```text
FORCE_TURN=true
```

---

# 四十二、开发模式

应该能做到：

Terminal 1：

```bash
pnpm dev:server
```

Terminal 2：

```bash
pnpm dev:web
```

Terminal 3：

```bash
pnpm dev:plugin
```

或者：

```bash
pnpm dev
```

启动需要的开发服务。

---

# 四十三、Demo Mode

为了开发前端，不应该必须启动 DeepSeek Harness。

提供：

```text
MockHost
```

能够模拟：

```text
sessions

streaming message

tool call

permission request
```

运行：

```bash
pnpm dev:mock-host
```

这样 Android/Web/Desktop 都能独立开发 UI。

---

# 四十四、UI 风格

UI 简洁，接近：

```text
ChatGPT
Codex
Linear
GitHub Mobile
```

而不是传统后台管理系统。

颜色不要过多。

Mobile 优先。

主要页面：

```text
Devices

Device

Sessions

Chat
```

Chat 最重要。

连接状态使用小标签：

```text
P2P

Relay

Offline
```

---

# 四十五、Chat 页面

示例：

```text
< MacBook Pro

Fix OAuth redirect issue

────────────────────

You

检查 OAuth 登录为什么失败。


DSH

我先查看认证相关代码。


▶ Read
src/auth/oauth.ts


DSH

这里 redirect_uri 与后台配置不同。


⚠ Permission

Run:

npm test

[Allow Once]

[Deny]

────────────────────

[ Ask DSH...              ] ↑
```

支持：

```text
Markdown
code block
tool call
permission request
streaming cursor
```

---

# 四十六、不要在第一版做的功能

明确不要：

```text
完整远程桌面

VNC

SSH replacement

PTY terminal

remote filesystem browser

Git GUI

IDE

多人协作

voice

video

screen sharing

cloud workspace

remote git hosting

AI model proxy

billing

organization RBAC

enterprise SSO
```

除非基本架构已经全部完成。

---

# 四十七、MVP Milestones

必须按阶段实现。

---

## Milestone 0 — Research

先不要写大量代码。

输出：

```text
docs/research/
```

包括：

```text
harness-plugin-api.md

harness-session-api.md

harness-permission-api.md

dsh-desktop-integration.md

webrtc-design.md
```

必须基于实际源码。

不要猜。

---

## Milestone 1 — Protocol

完成：

```text
packages/protocol
packages/crypto
packages/client-core
```

包含：

```text
RPC
Events
Handshake
Capabilities
Crypto
Transport interface
```

单元测试通过。

---

## Milestone 2 — Server

完成：

```text
FastAPI

SQLite

Alembic

pairing

devices

WebSocket

signaling

relay
```

可以运行：

```bash
docker compose up
```

---

## Milestone 3 — Mock Host

实现：

```text
mock-host
```

Web client 可以：

```text
pair

connect

view sessions

send message

receive streaming
```

---

## Milestone 4 — Harness Plugin

真正接入：

```text
DeepSeek Harness
```

实现：

```text
sessions

streaming

permission events

send message

stop
```

必须通过 Plugin，不修改 Harness core。

---

## Milestone 5 — Web Client

Web MVP 完整。

这是最快验证整体系统的客户端。

---

## Milestone 6 — Android

使用相同：

```text
client-core

protocol

crypto
```

实现 Android App。

---

## Milestone 7 — Desktop

基于：

```text
dsh-desktop
```

或者共享其 Electron 架构。

实现 Windows：

```text
.exe
portable.exe
```

macOS：

```text
.dmg
```

Linux：

```text
.AppImage
```

---

## Milestone 8 — WebRTC

如果前面为了验证系统先实现 Relay：

现在正式加入：

```text
WebRTC P2P

STUN

TURN

fallback
```

最终优先：

```text
P2P
```

Server Relay 作为最后 fallback。

---

# 四十八、实现策略

非常重要：

不要在第一天同时写：

```text
FastAPI
Web
Android
Electron
WebRTC
Crypto
Harness Plugin
```

最终会出现一堆不能工作的半成品。

按照 vertical slice 开发。

第一个真正可运行的 slice：

```text
Mock Host

↕

Server Relay

↕

Web Client
```

能：

```text
pair
connect
send message
stream result
```

第二个：

```text
Real Harness Plugin
```

替换 Mock Host。

第三个：

```text
E2EE
```

第四个：

```text
WebRTC
```

第五个：

```text
Android
```

第六个：

```text
Desktop
```

---

# 四十九、关于 WebRTC 的现实原则

目标是：

```text
尽量直连
```

而不是：

```text
必须 100% P2P
```

企业 NAT、CGNAT、防火墙可能导致 P2P 失败。

因此系统必须设计为：

```text
WebRTC ICE
      │
      ├─ direct
      │
      ├─ TURN
      │
      └─ encrypted relay
```

任何情况下用户应该首先获得“能连上”的体验。

然后优化连接质量。

---

# 五十、代码质量

要求：

TypeScript：

```text
strict: true
```

禁止大量：

```text
any
```

Python：

```text
ruff
mypy
pytest
```

TS：

```text
eslint
vitest
```

React：

避免巨型 component。

目录：

```text
features/
components/
services/
stores/
```

---

# 五十一、不要过度抽象

MVP 不要出现：

```text
AbstractConnectionFactoryProviderManager

RemoteSessionCoordinatorOrchestrator
```

优先：

```text
ConnectionManager

RemoteClient

RemoteHost

SessionAdapter
```

保持可读。

---

# 五十二、错误处理

定义统一 error codes：

```text
AUTH_FAILED

PAIRING_EXPIRED

PAIRING_INVALID

DEVICE_OFFLINE

DEVICE_REVOKED

CONNECTION_FAILED

P2P_FAILED

RPC_TIMEOUT

UNSUPPORTED_VERSION

PERMISSION_DENIED

SESSION_NOT_FOUND

HARNESS_UNAVAILABLE
```

客户端不要展示：

```text
undefined
Network Error
500
```

而应该转换成用户可理解提示。

---

# 五十三、README

根目录 README 必须说明：

```text
What is DSH Remote?

Architecture

Quick Start

Pairing

Self Hosting

Security

Development

Roadmap
```

README 第一张图画：

```text
               Signaling
             ┌───────────┐
             │   Server  │
             └─────┬─────┘
                   │
               ICE / auth
                   │
        ┌──────────┴──────────┐

 DeepSeek Harness         Android/Web/Desktop
      Plugin
        │
        └──── WebRTC ─────────┘
```

---

# 五十四、Plugin 使用体验

最终用户应该可以类似：

```bash
dsh remote enable
```

如果 Harness Plugin 不允许注册 CLI command：

提供：

```bash
npx dsh-remote setup
```

它帮助写入 Plugin 配置。

不要要求用户手工编辑复杂 YAML。

配置：

```yaml
remote:

  server: https://remote.example.com

  deviceName: My Mac

  enabled: true
```

---

# 五十五、Host CLI

建议提供：

```bash
dsh-remote status

dsh-remote pair

dsh-remote devices

dsh-remote revoke <device>

dsh-remote logout

dsh-remote doctor
```

例如：

```text
$ dsh-remote status

DSH Remote

Device:
MacBook Pro

ID:
01K...

Server:
https://remote.example.com

Status:
Online

Transport:
Ready

Trusted Clients:
2
```

---

# 五十六、Doctor

```bash
dsh-remote doctor
```

检查：

```text
✓ DeepSeek Harness found

✓ Remote plugin installed

✓ Server reachable

✓ Device identity OK

✓ Signaling connected

✓ STUN reachable

✓ TURN configured

✓ Crypto key available
```

这对排查 NAT / 防火墙问题很重要。

---

# 五十七、Server Admin

Web admin 可以查看：

```text
Devices
Connections
Pairings
Server health
TURN health
```

不要显示 conversation 内容。

管理员应该只能看到：

```text
Device

Online

Transport

Last Seen

Version
```

---

# 五十八、最终 Repo Layout

目标：

```text
deepseek-harness-remote/

  apps/

    server/
      app/
      migrations/
      tests/

    server-web/

    web/

    android/

    desktop/

    mock-host/

  packages/

    plugin/

    protocol/

    crypto/

    webrtc/

    client-core/

    ui/

    config/

  deploy/

    docker-compose.yml

    coturn/

    caddy/

  docs/

    architecture.md

    protocol.md

    security.md

    self-hosting.md

    plugin.md

    android.md

    desktop.md

    web.md

  package.json

  pnpm-workspace.yaml

  README.md
```

---

# 五十九、Protocol 文档

必须写：

```text
docs/protocol.md
```

内容：

```text
Handshake

Authentication

Pairing

Encryption

RPC

Events

Reconnect

Versioning

Capabilities
```

协议不能只存在于 TypeScript 类型里。

---

# 六十、Architecture Decision Records

重要选择写 ADR：

```text
docs/adr/

0001-monorepo.md

0002-fastapi-server.md

0003-webrtc-datachannel.md

0004-device-identity.md

0005-e2ee.md

0006-transport-fallback.md

0007-harness-plugin-boundary.md
```

每篇很短即可。

---

# 六十一、最终用户体验

最终最重要的体验：

### PC：

```text
$ dsh

DSH Remote:
82KF-7QMP
```

### 手机：

打开 DSH Remote：

```text
Pair Device
```

输入：

```text
82KF-7QMP
```

电脑确认：

```text
Allow Pixel 10?

[Allow]
```

手机：

```text
MacBook Pro
Online · P2P
```

打开：

```text
My Project
```

看到当前 Harness session。

输入：

```text
继续刚才那个 OAuth 问题。
```

Host 上 DeepSeek Harness 继续执行。

出现：

```text
npm test
```

手机收到：

```text
Permission Request

[Allow Once]
[Deny]
```

点击 Allow。

手机继续看到 Streaming Result。

这就是 MVP 成功标准。

---

# 六十二、明确的验收标准

项目不能仅仅做到“代码很多”。

以下流程必须真实通过：

### Test A

```text
Mac Host
↓
Remote Server
↓
Chrome Web
```

完成 pairing。

### Test B

Chrome 能看到 Host sessions。

### Test C

Chrome 发送：

```text
hello
```

真正进入 DeepSeek Harness session。

### Test D

Harness streaming token 实时出现在 Browser。

### Test E

Harness 发起 permission request。

Browser 可以 Allow / Deny。

### Test F

Chrome 断网再恢复。

Session 恢复。

### Test G

强制：

```text
FORCE_RELAY=1
```

仍然可用。

### Test H

启用 WebRTC。

连接显示：

```text
P2P
```

正常发送消息。

### Test I

TURN-only 网络：

显示：

```text
TURN
```

正常工作。

### Test J

Server 无法解密 Relay payload。

---

# 六十三、开发执行方式

现在开始开发时：

不要一次性生成整个项目后宣布完成。

按以下顺序工作：

1. Inspect DeepSeek Harness source.
2. Inspect dsh-desktop source.
3. 写 research 文档。
4. 提出最终 architecture。
5. scaffold monorepo。
6. 实现 protocol。
7. 写 tests。
8. 实现 Server。
9. 实现 Mock Host。
10. 实现 Web。
11. 跑通第一个 vertical slice。
12. 接入真实 Harness Plugin。
13. 加 encryption。
14. 加 WebRTC。
15. 加 Android。
16. 加 Desktop。
17. 完成 Docker self-host。
18. 完成文档。
19. 跑所有测试。
20. 输出验收结果。

每一个阶段完成后都必须实际：

```text
build

lint

test
```

不要仅凭阅读代码声称通过。

---

# 六十四、遇到不确定 API 时的规则

DeepSeek Harness 仍然快速变化。

所以：

**任何 Harness API 都不能靠猜。**

如果需要：

```text
session
permission
workspace
agent events
plugin loader
web UI
```

先：

```text
grep
rg
read source
read docs
read tests
```

然后才实现。

如果 Harness 当前没有直接暴露某个能力：

优先：

1. 使用已有 service；
2. 使用 existing event；
3. 使用 Cordis plugin extension；
4. adapter；
5. 最后才考虑提交 upstream capability。

不要 fork Harness。

---

# 六十五、编码优先级

发生取舍时，按照以下顺序：

```text
Security
>
Correctness
>
Working MVP
>
Simple Architecture
>
Compatibility
>
P2P performance
>
UI polish
>
Feature count
```

---

# 六十六、最终目标

这个项目的定位不是：

> “从手机 SSH 到电脑，然后操作 DSH。”

而是：

> “DeepSeek Harness 原生的 Remote Control Plane。”

Harness 仍然运行在用户电脑。

代码仍然留在用户电脑。

Agent 仍然在用户电脑上操作 workspace。

Remote Server 负责：

```text
Identity
Pairing
Presence
Signaling
Fallback relay
```

Remote Client 负责：

```text
Observe
Interact
Approve
Resume
```

核心架构：

```text
                 DSH Remote Server
          identity / signaling / relay
                    ▲       ▲
                    │       │
              WSS   │       │ WSS
                    │       │
                    │       │
          ┌─────────┘       └─────────┐
          │                           │
          ▼                           ▼

DeepSeek Harness              Remote Client
Cordis Remote Plugin          Android
Host                          Web
                              Desktop

          └──────── WebRTC ───────────┘
                 encrypted
                  direct
```

最终做到：

> **Server 可以消失，但 Host 和 Client 的信任关系仍然属于用户自己的设备。**

> **Server 可以中继连接，但原则上不能读取用户的 Harness 会话内容。**

> **Remote Client 可以操作 Harness，但不能绕过 Harness 自己的权限系统。**

先完成最小、可靠、能真正使用的版本，再扩展功能。

现在从：

```text
Milestone 0 — Research
```

开始。

先检查 DeepSeek Harness 与 `dsh-desktop` 的真实代码结构，不要立即生成猜测性的 Plugin API。

完成 Research 后输出：

1. Harness 可用的插件 API；
2. Sessions 的真实接入点；
3. Streaming 的真实接入点；
4. Permission 的真实接入点；
5. dsh-desktop 可以复用的代码；
6. 推荐的最终 monorepo tree；
7. 第一条 vertical slice 的实现方案；
8. 已确认事实与仍待验证假设。

然后直接继续进入 Milestone 1，不要因为非关键设计细节停下来询问我。
