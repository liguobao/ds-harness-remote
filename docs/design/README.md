# 设计文档

| 文档 | 维护范围 |
| --- | --- |
| [产品定位](PRODUCT.md) | 用户路径、仓库边界和设计原则 |
| [界面设计系统](DESIGN.md) | Android / Desktop 的交互规则；具体 token 以源码为准 |
| [Plugin 功能设计](plugin/functional-design.md) | 生命周期、业务域、路径隔离与恢复 |
| [控制面恢复](control-recovery.md) | 共用授权租约，以及 WebRTC / 独立 Relay 的保留条件 |

线协议统一维护在 [protocol.md](../protocol.md)，账号和凭据维护在 [Host 接入指南](../plugin-integration.md)，加密与网络分别见[端到端加密](../end-to-end-encryption.md)和[网络与传输](../network.md)。不在设计目录重复维护同一组协议字段、版本矩阵或测试数量。

运行和安装见[文档入口](../README.md)；未完成工作统一在 [TODO](../TODO.md)，版本变更统一在 [CHANGELOG](../CHANGELOG.md)。临时实施计划、现场验收和发布评审不作为长期设计文档。
