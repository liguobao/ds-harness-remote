# HarmonyOS 客户端更新记录

## 未发布

- 应用包名（`bundleName`）与 Android 对齐为 `io.github.liguobao.dshremote`；签名 Profile 与设备安装需使用同一包名。
- 支持 `remote.transport.upgrade.v1` 带内传输升级：在中继上完成认证后并行协商 TURN/P2P/LAN 直连，切腿不重建 Noise、不重置流订阅；升级帧使用 `DSHU` 序号头和有界重排处理跨腿乱序，升级失败保持中继数据面。
- 直连协商与初始目录/历史读取有界并行：Wi-Fi/有线最多等 450ms、蜂窝最多 250ms 后回落中继，避免弱网下多等数秒。
- 会话列表隐藏子代理（`subagent`）会话与非当前打开的空白占位会话，空白占位不参与搜索，也不贡献工作区筛选。

## 首次集成

- 提供 HarmonyOS 原生客户端，支持账号登录、Host 选择、多会话及流式回复。
- 支持模型与权限选择、图片和语音输入、会话搜索与归档。
- 支持端到端加密、主机公钥固定、系统安全存储及网络中断恢复。
- 支持 LAN/P2P/TURN/Relay 传输、手机和平板布局、中英文界面与主题切换。

贡献者：[Mangoman2008](https://github.com/Mangoman2008)。
