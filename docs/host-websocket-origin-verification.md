# PR #408：最终 Host bundle 的真实环境验证

验证日期：2026-11-14（Asia/Shanghai）。运行时代码为 PR head
`9762a6f6e2e781189af3ff63efa691a3f2b53365`，插件版本 `0.6.4`。
后续提交只增加本文及可选的发布 bundle 测试，不改变运行时代码或 bundle。

## 环境与产物

- macOS 27.0.1 / arm64，Node.js `24.21.0`。
- 主验收：npm 安装的真实 `@deepseek-ai/dsh@0.2.2-rc.1`，两个独立 `dsh web`
  进程，分别使用独立的 `DSH_HOME`、Host/Client identity 和凭据。
- 补充烟测：当前 Desktop 安装附带的 CLI `0.2.2-rc.3` 启动隔离的 web profile；
  不是 Desktop 窗口验收。
- Server：同一 PR checkout 的 `apps/server`，独立测试账号、私有持久化文件，
  `publicUrl=http://127.0.0.1:8408`。未修改 Gateway Origin 校验。
- Host 页面：`http://127.0.0.1:3408`；Client 页面：`http://127.0.0.1:3409`。
  两者均与 Server Origin 不同。两端设置 `forceRelay: true`。
- 两个进程均通过 profile bundle 加载提交的 `packages/plugin/dist/index.js`，
  没有改写其工厂、注入 WebSocket 实现或替换业务 handler。
- 本轮在同一台电脑上运行独立进程；不是跨物理设备或公网验收。

最终 Host bundle SHA-256：

```text
990f4af589cb3a2820c2d76682629b469af3e03830103ee7e85d164232c0185c
```

直接从 PR Git 对象取出的文件、本机真实加载的文件，以及 `NODE_ENV=production`
重建后的文件，哈希一致。`client.github.js` 重建也没有 Git 差异。
`verify-dsh-plugin.mjs` 通过。全新 checkout 需先生成忽略的 npm `dist/client.js`
再运行该守卫；仅有提交的 GitHub bundle 时会因缺少该文件报 ENOENT。

## 真实 dsh web / Server 结果

所有会话操作经 Plugin Client 的官方 `/api` carrier、加密 Remote 通道和真实 Host
Gateway 执行。没有直接写入会话文件，也没有用 mock gateway 返回成功。

| 检查 | 结果 |
| --- | --- |
| Host 账号登录、设备注册、控制连接 | `online:true`，Server 记录已认证的 `role:host` / Harness `0.2.2-rc.1` |
| Plugin Client 登录、发现 Host | 成功，返回真实 Host membership 和在线状态 |
| 打开工作区 | `mode:remote`、`connected:true`、`transport:Relay`；Host 记录 `authenticated peer channel ready` |
| 会话读写 | Client 通过 `session/create` 新建会话，`session/rename` 返回 `seq:3`，`session/list` 读回标题 |
| 真实历史读取 | `session/page` 返回 `cursor:3`，包含持久化的 `session/title` 事件；标题为 `PR408 final bundle E2E` |
| Server 进程重启 | 保持账号、密码、state 文件，SIGTERM 后重启；无需重新登录，自动恢复并读回原会话 |
| 连续三次连接重置 | 在测试 Server 上对全部实际 WebSocket 调用 `terminate()`，每轮自动恢复并读回同一会话 |
| 正常 WebSocket 关闭 | Server 对实际连接发送 `close(1012, ...)`，自动恢复并读回同一会话 |
| 插件卸载 | 给两个隔离 profile 的 Remote entry 写入 `disabled:true`；官方 Loader 卸载后两端记录 `host runtime stopped` |
| 卸载后的资源 | Server 的 WebSocket / peer / link 数全部归零，后续一分钟以上未出现自动重连；web 进程仍在运行 |

恢复计时从测试脚本开始等待就绪时计算，终点同时要求 Client 已连接、Host 在线，
且一次新的远程 `session/list` 能读回原会话标题；不是仅观察 UI 状态。
计时包括默认重连退避，不能理解为性能保证。

| 场景 | 等待恢复 | Client recoveryGeneration | Host connectedClients |
| --- | ---: | ---: | ---: |
| Server 进程重启 | 29.185s | 1 | 1 |
| 强制断开，第 1 轮 | 29.122s | 2 | 1 |
| 强制断开，第 2 轮 | 14.225s | 3 | 1 |
| 强制断开，第 3 轮 | 22.947s | 4 | 1 |
| 正常关闭后恢复 | 27.847s | 5 | 1 |

Server 每秒采样实际 `wss.clients.size`、peer 和 link 数。此次进程组合的最大值为
`3 / 3 / 1`：Host 控制连接、Client 进程自身的 Host 控制连接、Remote Client 控制连接，
以及一个加密会话 link。五轮恢复没有超过该基线；卸载后为 `0 / 0 / 0`。
这只说明本轮短时检查没有发现重复连接或持续累积，不是长期内存泄漏证明。

Server 在主验收及恢复期间记录到 19 次 upgrade，Origin 全部缺省。另做真实 Server
正反对照：携带 `Origin: http://127.0.0.1:3408` 的普通 `ws` 请求返回 HTTP 403，
日志为 `ws_upgrade_rejected / origin_mismatch`；省略 Origin 的请求 upgrade 成功。
这两个额外探针不携带账号凭据，随后关闭。

官方 `wss://dsh.r2049.cn/ws/v1/connect` 也接受了普通 `ws` 的无 Origin upgrade，
随后主动关闭。这只是未登录的传输层烟测，不是官方 Server 的账号或会话 E2E，
也不能替代最终 bundle 在官方 Server 上的已认证验收。

运行日志摘录（省略身份标识及凭据）：

```text
server: ws_hello_authenticated role=host clientVersion=0.6.4 harnessVersion=0.2.2-rc.1
host: server control connection online
host: authenticated peer channel ready transport=Relay
host: harness remote call ok endpoint=session/create
host: harness remote call ok endpoint=session/rename
host: harness remote call ok endpoint=session/page
client: remote Harness transport ready transport=Relay
host/client: host runtime stopped
server sample after unload: open=0 peers=0 links=0
```

本轮真实 Host/Client/Server 日志未发现未处理 error / rejection / uncaught exception。
未安装的可选 ACP 后端产生 `CURSOR_BINARY_UNAVAILABLE`、`OPENCODE_BINARY_UNAVAILABLE`
等诊断；未使用这些后端。未发送模型 Prompt，会话验收覆盖创建、重命名和读取。

## 最终发布 bundle 的生命周期补充测试

`host-websocket-origin.test.ts` 新增 `DSH_TEST_RELEASE_BUNDLE=1` 可选模式：
`HostServerConnection` 直接从提交的 `dist/index.js` 导入，使用其中打包的 `ws`。
复用真实本地 HTTP/WebSocket gate，覆盖控制连接、控制重连、独立 Relay 数据 socket、
升级前取消、Origin 拒绝、RST、重复恢复和停止。另以真实计时检查：

- upgrade 一直挂起：约 30 秒结束为 `CONNECTION_FAILED`，可停止，无未处理错误。
- upgrade 成功但不返回 `hello.ack`：约 10 秒结束，socket 关闭，无未处理错误。

这两项只在可选模式运行，普通单测不增加 40 秒等待。
可选模式共 12 项：9 项覆盖发布 bundle 的 Host 行为，1 项是 Origin 拒绝对照，1 项检查源码 helper，
1 项确认共享 `AdaptiveTransport` 默认仍使用全局浏览器 WebSocket。
独立 Relay 数据 socket 用的是本地 gate fixture；真实自建 Server E2E 使用其控制连接
复用 Relay 数据路径，不能把 fixture 当作生产独立 Relay 节点验收。

复现检查命令（Node 24，仓库根目录）：

```sh
pnpm install --frozen-lockfile
pnpm --filter @dsh-remote/crypto --filter @dsh-remote/protocol --filter @dsh-remote/webrtc --filter @dsh-remote/client-core -r build
NODE_ENV=production node packages/plugin/scripts/build-bundles.mjs
node scripts/verify-dsh-plugin.mjs
pnpm --filter ds-harness-remote check
pnpm --filter ds-harness-remote test -- tests/host-websocket-origin.test.ts tests/server-connection.test.ts
DSH_TEST_RELEASE_BUNDLE=1 pnpm --filter ds-harness-remote test -- tests/host-websocket-origin.test.ts
```

普通模式：38 pass / 2 个可选超时用例 skipped。发布 bundle 模式：12 pass。
发布包不携带 source map；Vitest 提示缺少 source map 的 warning 不影响结果。
本轮没有重跑 Plugin 全套或 Android 测试；原 PR 的全量 CI 结果与本轮针对性验证分开看待。

## 真实环境复现要点

1. 在私有临时目录安装 `@deepseek-ai/dsh@0.2.2-rc.1`，先构建共享包与 Server。
   用真实 `createRemoteServer` 启动 `127.0.0.1:8408`，提供新的测试账号及密码。
   重启必须复用原账号、密码和 state 文件；改密码会使已有 token 失效。
2. 创建两个完全独立的 `DSH_HOME`，各自建立 web profile，bundle 列表包含
   `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、本 checkout 的 Remote bundle。
   不能只换 profile 名却共用 `DSH_HOME`，否则身份相同会触发 `CONNECTION_REPLACED`。
3. overlay 的 Remote config 设置 `serverUrl=http://127.0.0.1:8408`、
   `forceRelay:true` 和不同 `deviceName`；分别用 `dsh --profile web --no-open --host
   127.0.0.1 --port 3408` / `3409` 启动，保留默认 reconnect。
4. 用各自启动 URL 的 token 换取对应页面 cookie。通过已认证的 loopback
   `/ds-harness-remote/host.account.login`、`client.account.login`、`devices` 和
   `workspace.open` 完成登录和工作区选择。所有 token/cookie 只保存在私有测试目录。
5. 官方 `/api/session/*` 请求使用 `client-request` envelope，payload 为 `{args:...}`：
   `list` 的 args 是 `{_request:{}}`；`create` 是 `{request:{workspaceId}}`；
   `rename` 是 `{request:{sessionId,title}}`；`page` 是
   `{request:{address:{kind:'session',sessionId}}}`。不要用旧版本的 page 参数形状。
6. 在测试 Server 的 `upgrade` 事件仅记录 path / Origin，不记录 raw frame、cookie 或 token。
   记录 Server 重启、实际 socket `terminate()` / `close()` 前后的 Host/Client status，
   每轮恢复后执行新的远程 `session/list`。测试计数器只读取真实 gateway 的状态。
7. 给两个 profile entry 写入 `disabled:true`，等待真实 Loader 卸载，确认日志和连接计数。
   最后停止本轮启动的测试进程。未替换、重启或改写用户现有 Desktop/profile/Server。

## 验收边界

没有在原 Issue 的 Linux 部署上复现修复前的宿主全局 WebSocket 注入。
本轮 macOS 的未修改 Plugin Client 路径也没有发送 Origin；不能由此推断所有 Linux
宿主的 Plugin Client 都已修复。本 PR 仍只改变 Host，既不更改 Plugin Client，
也不更改共享/browser transport 或 Server Origin 策略。

尚未覆盖原 Linux 宿主、真实 Desktop 窗口、官方 Server 已认证会话、跨物理设备、
P2P/TURN、生产独立 Relay 节点、模型生成、长时间网络中断或长期资源趋势。
因此上述记录支持最终 bundle 在所列真实环境中的 Host 修复与生命周期验收，
不宣称此前评论中的全部平台和生产路径都已完成。
