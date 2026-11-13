# DSH 远程 · 鸿蒙客户端 0.17.86-lan（1000208）

对应的产物：`dshremote-v0.17.86-lan.hap`（调试签名，2.6 MB）
代码位置：仓库根 `harmony/`；本机签名配置不入库，构建用 `harmony/scripts/build-local.sh`。

## 本版做了什么

- 补齐文档：README 四语的鸿蒙客户端一行恢复（中文 README 在合并上游时被误删），
  并把过时路径 `apps/harmony` 统一改成工程现位置 `harmony/`
- 版本号统一：`AppScope/app.json5` 与 `ServerApi.CLIENT_VERSION_FALLBACK` 都为 `0.17.86-lan`，
  避免兜底路径把假版本报给主机
- 构建链更干净：`build-profile.json5` 不再含签名材料（certpath / storeFile / 密码），
  本机构建改用 `harmony/scripts/build-local.sh`（临时顶替 → 构建 → 无条件还原）

## 上一节点（0.17.84 / 0.17.85）已包含的能力

- **稳定性**：断线事件上报修复、退避重连、会话流自动重开、静默探测（35s）、长时任务保活（熄屏不断）、
  断网恢复实测 4.3 秒回原会话
- **局域网直连**：修复「直连代码从未执行」的结构性 bug → `transport=lan` 实测通过
- **可观测**：`link.log` 落盘（重启保留）、诊断面板（打点 / 抖动计数 / 保活 / 连接详情 + 测延迟）
- **对齐 dsh-Go A 组**：精简历史、敏感内容打码、轮次导航 + 每轮用量、主题色、桌宠、分享卡、横屏收敛
- **体验**：启动自动连上次主机、会话列表落盘秒开、恢复场景免设备查询

## 升级方式

```sh
hdc -t <设备序列号> install -r dshremote-v0.17.86-lan.hap
```

> 调试签名只对签名时在线的设备有效；换正式包前需先卸载。
