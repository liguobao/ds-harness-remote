# DSH 远程 · 鸿蒙客户端 0.17.101-lan（1000223）

> 一个补丁版：修掉「从电脑发的图片，鸿蒙端历史里是空白」。
> 源码在仓库根 `harmony/`，构建用 `harmony/scripts/build-local.sh`，装机冒烟用 `harmony/scripts/smoke.sh <设备>`。

## 症状

- 手机上自己拍的图发出去 → 立刻能看到（本地有字节，直接显示）。
- 从电脑网页（或别的客户端）往同一会话发的图 → 鸿蒙端那条消息**图片位置是空的**，文字正常。
- 同一条会话在电脑网页里看是正常的，所以问题只在鸿蒙端的「历史回显」。

## 根因

Harness **0.2.2** 收紧了 `session/attachment` 的参数：`attachment` 必须是完整的 `ImageAttachmentRef`，
`attachmentId` / `mediaType` / `bytes` / `width` / `height` 五个字段齐全，主机读取后还要拿实际文件
重新探测一遍、与引用逐项比对；只给 `attachmentId` 在网关的参数校验阶段就被拒。

鸿蒙端历史图片的补字节逻辑一直只发 `sessionId` + `attachmentId`，于是：

1. 历史消息里的图片只有引用、没有字节；
2. 补水请求被拒 → 缓存里记成空串 → 气泡里没有图，也不会重试。

本机刚发出去的消息不走向这条路径（字节在内存里），所以「只有电脑发的看不到」。

## 修法

- `ChatItem` 新增 `imageRefs`，与 `imageAttachmentIds` 一一对应，保存历史消息里**原样的完整引用**；
- 补水时把整条引用一起发给 `session/attachment`，不再自己拼字段；
- 老 Host 仍然兼容：引用缺失/解析失败时退回只发 `attachmentId` 的旧请求；
- 链路日志补 `history image ok … ref=yes|no`、`history image … failed (ref=…)`，以后排这类问题一眼能定位。

## 验证

- `harmony/scripts/build-local.sh` 构建通过，`smoke.sh` 在手机（无线调试）与鸿蒙 PC 上安装 0.17.101-lan 后
  均 `已连接`，无 ArkTS 崩溃；
- 历史引用形状以真实会话日志核对：`user/message` 的图片块里本身就带完整引用，客户端只是之前没用它。
