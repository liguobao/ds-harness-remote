# 交接说明（新会话从这里开始）

> 触发词：用户说「**继续 dshre**」（或「继续 dsh-remote」）时，先读本文件，再按「待办」继续，不需要重新调研。

## 一句话状态

鸿蒙客户端 V0.03 已完成 PR #242 全部审核整改 + 功能对齐 14 项，装在手机上可用；UI 打磨前 3 项已改完并本地提交（`9a80f1d`，因手机掉线尚未装机目视确认），剩主题页/多语言与上游主机缺口。

## 仓库与构建

- 工程：`/storage/Users/currentUser/WorkBuddy/ds-harness-remote-Harmony-7.0/apps/harmony`
- 分支 `release/v0.03`，标签 `V0.03`，**尚未推送**（`git push origin release/v0.03 --tags`）
- 构建：`( umask 000; devecocli build --build-mode debug )`，产物 `entry/build/default/outputs/default/entry-default-signed.hap`
- 装机：`hdc -t 192.168.3.160:33571 install -r <hap>`（手机无线调试，端口每次重开都会变）
- 密码学回归：`node ~/.cache/crypto-check.mjs`（金标向量，6/6）
- 签名：`build-profile.json5` 已由 DevEco 写入本工程签名，**不要覆盖**；仓库 `signingConfigs` 会被 `git checkout` 弄丢时需重新在 DevEco 里点一次签名

## 已完成（不要再重做）

- PR #242 阻断项 5/5：Asset Store 加密落盘（含旧明文迁移）、日志脱敏、bundleName `cn.r2049.dshremote`、测试+CI+签名注入、文档与四语 README
- 建议项：忘记主机公钥（🔑）、断线指数退避重连、删模板 cpp、文件权限 644
- 功能对齐 14 项：插话/排队、中断、斜杠命令、会话改名/归档/搜索、上下文占用、模型选择、推理等级、权限预设、消息分叉、工作区选择、自动重连、忘记主机
- 工作区增删改 + 文件浏览（RPC/运行时/UI 全有）
- UI 精简：标题栏去掉权限胶囊（改长按模型胶囊）、删掉独立排队行（改长按发送键）、Markdown 轻量渲染、工具卡片长命令换行、主机卡整卡可点 + 在线/离线徽标
- 自审报告：`docs/harmony-audit-v0.03.md`（7 个 bug 已修）

## 待办（按顺序）

1. ~~**顶部操作栏合并**~~：已完成（`9a80f1d`）——刷新改圆形图标按钮、退出进溢出菜单，**待装机目视确认**
2. ~~**主机行摘要**~~：已完成（同上）——平台 + 主机版本 + 最近活动时间，**待装机目视确认**
3. ~~**工具调用折叠**~~：已完成（同上）——连续 ≥2 条收成「N 步 · 展开」，**待装机目视确认**
4. 主题选择页、多语言（审核建议但未做）
5. 上游 Host 缺口（需改 `ds-harness-remote` 插件，不是客户端）：`session/updateQueue` 排队投影、附件上传通道、`pinSession`/`unarchiveSession` 透传、`job/list`、`goals/*`、轨迹、子代理

## 已知问题（2026-11-04 补）

- **客户端调了 3 个主机没有的 endpoint**，全部静默失败（hilog 里 `workspace/list unavailable` 就是它）：
  - `workspace/list` → 主机侧应改用 `workspace/follow`（baseline 帧带 items/sessionIds）
  - `host/listDirectory` → 主机侧等价物是 `directoryPicker/list`（参数是裸 `path`，不走 `request` 包装）
  - `session/selectPermission` → 本版 DSH 没有这个端点，权限预设只能在创建会话时给
- 已装插件是 npm `ds-harness-remote@0.6.0`，其 `HARNESS_REMOTE_ALLOWLIST` 只放行标准端点；
  仓库 `packages/plugin` 也没加这三个，所以工作区列表/目录浏览/权限切换目前的实际表现是「点了没反应」
- 装机手机（PLU-AL10，`192.168.3.160:33571`）会掉线，无线调试端口每次重开都变；
  掉线时只能连 `127.0.0.1:40601`（QXS-W10，未登录，只能看登录页）

## 关键文件

- `entry/src/main/ets/services/AppRuntime.ets`：状态机、会话、重连、模型/权限/工作区
- `entry/src/main/ets/net/HarnessClient.ets`：全部 RPC（31 个 endpoint 中已用约 20 个）
- `entry/src/main/ets/services/SecureStore.ets`：Asset Store + 明文迁移 + 身份保护
- `entry/src/main/ets/pages/Index.ets`：全部 UI（单文件，改前先 grep 定位）
- `docs/harmony-parity.md`：功能对齐矩阵与主机缺口
- `docs/harmony-client.md`：架构/构建/签名/发布/维护边界

## 坑

- ArkTS 严格：对象字面量必须有显式类型；`throw` 只能抛 Error 子类
- 构建目录若出现 0700 权限问题，用 `umask 000` 重新构建
- `devecocli run` 会因签名材料跨工程失配而失败，统一用 build + `hdc install`
- 手机 hilog：`hdc -t <phone> shell "hilog -T DSHREMOTE"`
