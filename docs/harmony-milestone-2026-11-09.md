# 里程碑 2026-11-09：局域网直连恢复（重要节点）

> 节点性质：客户端、主机插件、自建服务器三段链路**全部打通并实测为 LAN 直连**。
> 客户端版本 `0.17.84-lan / 1000206`；主机插件 `ds-harness-remote 0.6.4`（含本机补丁）；仓库已对齐上游 v0.6.4。

## 一、此节点做到的（实测）

| 环节 | 状态 | 证据 |
|---|---|---|
| 手机客户端 | `已连接 · lan` | `hilog/link.log`：`[event] 已连接 · lan` |
| 会话列表 | 180 个会话，落盘快照秒开 | `[conn] 先用本地快照铺开 180 个会话` |
| 熄屏保活 | 长时任务持有，8 分钟零断线 | `power-shell suspend` 期间心跳连续、无 `[disc]` |
| 精简历史 | 开关已同步主机 | `[conn] 精简历史=关 已同步给主机` |
| 自建服务器 | 单实例常驻 | `dshserver status`：进程/端口/登录接口三项通过 |
| 主机注册 | 仅 1 台在线主机 | 服务器 `/api/v1/devices` → `01a1bc15-… openharmony 0.2.2-rc.1` |

## 二、这个节点前后踩过的四类坑（都已在代码/脚本层固化）

1. **运行时版本混用**：`dsh`（0.2.2-rc.1，用户实际运行）与 `dsh-ohos`（内置 0.2.0-rc.2）混用，导致插件依赖被判不兼容。
   → 规定：插件安装/诊断一律用 `dsh`（`plugins` 命令、`--dump-config` 也用 `dsh`）。
2. **profile 被重置**：插件与依赖全部丢失，旧 profile 在 `profiles/web.bak`。
   → 记录：重装顺序 = `dsh plugin --profile web add ds-harness-remote` → 补 peer 依赖（0.2.2-rc.1）→ 配置补丁。
3. **hmdfs 存不住 0600**：`chmod 600` 实测落为 `660`，而 0.6.4 有三处强制 0600（`device.key`、`server-credentials` 两处）。
   → 补丁：`dist/index.js`(2)、`dist/identity-store.js`(1)、`dist/server-credentials.js`(1) 统一放宽策略
     —— **仅当 others 无权限时**容许 0660，仍拒绝 064x/066x。
4. **服务器生命周期**：`nohup … &` 起的进程会随命令结束被杀；曾同时跑两个实例；缺 `DSH_SERVER_PUBLIC_URL` 导致同源校验 403（后台“点登录没反应”）。
   → 脚本 `~/.dsh-server.sh`（别名 `dshserver`）：`setsid` 脱离终端、端口探测防重复、`cmdline+cwd` 双重匹配、显式 `PUBLIC_URL`、pidfile。

## 三、运维口径

```sh
dshserver            # 启动（幂等；终端 .zshrc 也会自动执行）
dshserver status     # 进程 / 端口 / 登录接口 三项体检
dshserver restart    # 改完配置用
dshserver log        # 实时日志（~/.dsh/logs/remote-server.log）
```

- 后台地址：`http://192.168.3.57:8080/app/login`
- 账号：`admin@dsh.local`（密码见服务器启动脚本，不写入仓库）
- **地址必须与脚本里的 `PUBLIC_URL` 完全一致**，否则同源校验 403。

## 四、客户端本节点前累计完成（0.17.61 → 0.17.84）

- 0.17.61–62：会话流重开、授权窗口重发、抖动更快失败与自动重拉
- 0.17.63–68：直连原因、链路日志落盘（`link.log`）、断线事件上报修复、恢复期免探测、跳过设备查询
- 0.17.69–78：**直连真正生效**（`startRtcAttempt` 不再依赖 relayEndpoint）、长时任务保活、静默探测（35s）、follow 首帧自动重开、启动自动连上次主机
- 0.17.79–84：会话列表落盘、恢复免设备查询、连接详情+测延迟、精简历史、敏感内容打码、轮次导航、主题色、桌宠、分享卡、横屏收敛

## 五、明确未做 / 待办

- A8 对话回放链接：需要服务端 `/share` 存储 + 查看页，本节点跳过
- B 组（待办条、`@` 引用、技能组、排队消息管理、后台任务/子代理/轨迹/终端）：需宿主侧透传 endpoint
- 服务器开机自启：目前随“打开终端”自启（系统级服务管理器未开放）
