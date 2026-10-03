# Android 快捷提示词入口验证

基于 main `5a1b9f7`（PR #91 合并提交），2026-10-02 完成本地验证。

环境：Android 14 / API 34、x86_64 AVD，720 × 1280、320dpi（360dp 宽），
无 KVM 的软件模拟。原生构建使用 JDK 17、Android SDK 36、NDK 27.1.12297006。

截图来自实际 Android APK 中的生产 `ChatScreen`，使用明确标注的本地样例会话，
仅注入连接状态和本地发送回调；Modal、键盘、设备返回键使用原生实现。
临时样例入口未提交，正式 `index.ts` 继续加载 `App`。

| 本地原生操作 | 结果 |
| --- | --- |
| 输入栏按钮直接打开提示词 | 三条内置提示词和编辑入口均可见 |
| 编辑页连续按设备返回键 | Editor → Manager → Picker → Chat |
| 键盘弹出时点击快捷入口 | 键盘收起；关闭面板后草稿保留 |
| 点选「检查改动」 | 样例会话新增一条对应消息，草稿保留 |
| `+` → 工具访问 | 文件、终端、轨迹入口均保留 |
| 切换英文 | Prompts 按钮完整显示，模型名称保留可见前缀；列表文案为英文 |

自动验证：Android TypeScript、26 个 Vitest 文件 / 280 项测试通过。
新增 8 项真实组件交互回归，覆盖 Harness / CodeX、草稿、返回流程、禁用状态、
多语言、保存覆盖及删除记录的重载、文件/终端/轨迹选择。
原有 14 项提示词存储测试继续通过。正式入口的 Hermes 导出及 x86_64
`:app:assembleRelease` 构建通过。

| 截图 | 文件 |
| --- | --- |
| 中文直接入口 | [direct-entry-zh.png](direct-entry-zh.png) |
| 中文提示词面板 | [picker-zh.png](picker-zh.png) |
| 工具入口 | [tools-preserved.png](tools-preserved.png) |
| 发送后保留草稿 | [sent-with-draft.png](sent-with-draft.png) |
| 英文直接入口 | [direct-entry-en.png](direct-entry-en.png) |
| 英文提示词面板 | [picker-en.png](picker-en.png) |

本轮验证没有连接真实 Host，截图不代表跨设备传输或真实文件/终端执行验收。
