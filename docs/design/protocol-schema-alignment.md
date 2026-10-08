# Protocol Schema 对齐设计

更新时间：2026-10-08；关联 [Issue #34](https://github.com/liguobao/ds-harness-remote/issues/34)。

## 目标与当前状态

[protocol.md](../protocol.md)是 wire contract 权威来源，`packages/protocol` 提供共享类型与运行时校验。
已有 Control / Account / Connect / Relay 等 schema、frame/counter 边界测试、Noise IK vector 和跨仓库 fixtures；
完整 schema 逐项对齐、剩余 golden vectors、独立加密审查与真实 runtime conformance 仍见[TODO](../TODO.md)。
不把 fixture 通过描述成所有领域 schema 已齐全或所有平台已验收。

## 对齐范围

- hello/hello.ack 的版本拒绝、capability 协商与 limits。
- Account authorization、Host 注册码、设备注册/刷新与 Browser 授权交换。
- Connect、Noise 握手 forwarding、Relay、Signaling、Error 和关闭状态。
- Harness ApiProxy / Typert tunnel、事件及有界 transfer。
- CodeX / ACP 独立 RPC、stream、transfer、capability 和工作区类型。
- 原生只读文件、终端输入权、loopback 固定目标限制，以及各领域工具 scope。

不复制 Harness 官方业务对象的完整 schema，不新增另一套 Session / Message / Permission wire format。
本仓库最小 Server 复用规定的子集；完整 Server / Remote Web runtime 仍由独立仓库维护。

## 变更流程

1. 对照协议章节、共享 schema 和消费端列出具体差异。
2. 明确字段的必需性、未知字段策略、版本兼容、capability 与限额。
3. 同步更新协议、共享类型和实际 Host/Client 接入；新增字段采用可验证的加法兼容。
4. 为核心安全边界补正反场景；同一契约的变体用命名场景矩阵，共享 hooks，失败后报告具体场景并继续同组其他场景。
5. 将可跨仓库复用的场景保存在 `fixtures/protocol/v1`；不使用生产账号、真实凭据或用户数据。
6. 在消费端检查其独有的接入、状态与恢复行为；跨端 conformance 在真实目标 runtime 执行。

## 验证入口

- `packages/protocol/tests/conformance-fixtures.test.ts` 按操作及 Control frame 类型组织 fixtures。
- `fixtures/crypto/v1/noise-ik.json` 与 Crypto 测试验证确定性 Noise vector。
- Plugin、client-core 与 transport 测试分别覆盖 allowlist、关联、权限、隔离与恢复。
- 最小 Server 测试覆盖其授权、Control 和 Relay 子集；不代表完整 Server 或部署 E2E。

数量以当前 CI 为准，不因矩阵合并减少边界场景，不通过 skip/exclude 隐藏失败。
单纯源码字符串、布局、图标、配色、文案不属于协议测试预算。

## 完成标准

每项差异有文档/schema/消费端一致的证据，非法版本、字段、尺寸、counter、scope 与权限均 fail closed。
fixtures 可离线、隔离地执行；跨仓库合同和真实 runtime 的验收分别记录。
共享类型/生产构建、核心测试与 Bundle 校验通过后，仍需明确未覆盖的平台和部署边界。
