# DSH Remote 文档

## 使用与安装

| 文档 | 用途 |
| --- | --- |
| [项目介绍](../README.zh.md)（[English](../README.md)） | 功能、下载和快速开始 |
| [插件安装](installation.zh.md)（[English](installation.md)） | profile、在线更新、CLI、Linux 服务与卸载 |
| [TUI 组合包](../packages/tui/README.md) | 终端 profile 的 Remote Host 与账号入口 |
| [版本兼容](compatibility.zh.md)（[English](compatibility.md)） | 当前基线、旧 Host 边界与平台限制 |
| [最小自部署 Server](../apps/server/README.zh.md) | 单账号 Server 的配置、Docker 和运行方式 |
| [Remote Tools](remote-tools.md) | 本地 Harness 会话的远程工具注入开关 |
| [隐私政策](PRIVACY.md) | Browser Launcher 的数据处理范围 |

## 后端与界面

- [ACP 后端接入与实现](acp-remote.md)：安装配置、后端差异、OpenCode 归档、gateway 和新增 adapter。
- [Codex 技术说明](codex-remote.md)：App Server、Project/Thread authority 和内存投影。
- [Intelligent UI](intelligent-ui-android.md)：可选离线 renderer 的构建和交互边界。
- [设计文档](design/README.md)：产品边界、界面规则与专项实现设计。

## 协议与安全

| 文档 | 权威范围 |
| --- | --- |
| [Remote Protocol v1](protocol.md) | Host、Client、Server 的线协议 |
| [Host 插件接入](plugin-integration.md) | 账号、设备身份、凭据、迁移与刷新 |
| [端到端加密](end-to-end-encryption.md) | Noise、信任、密钥生命周期和可见元数据 |
| [网络与传输](network.md) | LAN/P2P/TURN/Relay、降级和恢复 |
| [设备配对](device-pairing-v1.md) | 协议、扫码与证明、关系授权及手机客户端接入 |
| [完整 Server 设计](server.md) | 独立站点的 API 与职责；不代表最小 Server 全部实现 |

## 维护

- [TODO](TODO.md) 只保留待办与已知限制；版本变更写入 [CHANGELOG](CHANGELOG.md)。
- 当前版本和依赖以各包 manifest、lockfile 与源码为准；发布状态以正式 Release 为准。
- 协议变化同步 `protocol.md`、共享 schema 与消费端，不另建重复契约。
- 临时验收、发布评审、机器地址、日志、截图、单次构建的产物哈希及性能采样不放进长期文档目录。需要复现的操作保留在测试或工具 README，现场结果放 Issue/PR 或本地忽略目录。

本仓库提供 Plugin、移动端、VS Code Client、Browser Launcher、共享包和单账号自部署 Server。完整多账号 Server、Remote Web 会话 UI 与 Admin 在独立仓库维护。Mock Host 是冻结的旧协议互操作工具，不作为新功能入口。
