# 鸿蒙客户端功能对齐（对照 dsh-go）

> 对照对象：[ccch1mneyyy/dsh-go](https://github.com/ccch1mneyyy/dsh-go) 的 `docs/official-parity.md`。
> 评估基准：DSH Host 通过 `ds-harness-remote` 实际暴露的 31 个 endpoint（见文末附录）。
>
> 图例：✅ 已实现 · 🟡 可实现但未做 · 🔴 受主机能力限制 · ➖ 手机上不适用

## 一、本轮已对齐（V0.03）

| 能力 | dsh-go 入口 | 鸿蒙端实现 | 依赖 endpoint |
|---|---|---|---|
| 排队发送 / 插话 | 输入框长按发送键选「排队 / 插话」 | 输入栏「排队 · 本轮之后 / 插话 · 立刻打断」开关，生成中仍可输入 | `session/prompt`（`mode: queue \| steer`） |
| 中断当前轮 | 生成中的停止键 | 生成中显示 ■ 按钮 | `session/cancel` |
| 斜杠命令 | 输入 `/` 弹出命令面板 | 输入 `/` 弹出候选条，选中填入；发送时优先走命令通道，主机不识别则降级为普通消息 | `commands/list`、`commands/execute` |
| 会话重命名 | 抽屉长按对话 › 重命名 | 点聊天页副标题进入编辑态 | `session/rename` |
| 会话归档 | 抽屉长按对话 › 归档 | 会话列表行**长按**归档 | `workspace/archiveSession` |
| 会话搜索 | 抽屉顶部搜索框 | 会话面板顶部搜索框 | `session/search` |
| 上下文占用 | 输入条里的上下文小环 | 聊天页副标题右侧百分比胶囊（≥80% 转红） | `session/projections` |
| 断线自动重连 | AdaptiveTransport 退避恢复 | 指数退避 1/2/4/8/15/30 秒，最多 6 次，UI 显示重连次数 | 客户端内建 |
| 忘记主机公钥 | 设备详情 › 忘记该主机公钥 | 设备卡片上的 🔑 入口，二次确认后清除固定记录 | 客户端本地 |
| 模型选择 | 聊天顶栏模型胶囊 | 顶栏模型胶囊 → 底部选择面板；目录来自主机 | `session/modelCatalog`、`session/selectModel` |
| 权限预设 | `/permission` 弹窗 | 顶栏权限胶囊 → 选择「只读 / 可写 / 完全」 | `session/selectPermission` |
| 从某条消息分叉 | 消息长按 › 从这里分叉 | 聊天气泡长按 → 确认分叉 | `session/fork` |
| 模型推理等级 | `/model` 里的推理等级 | 模型面板内联等级条（默认 / low / medium / high…） | `session/selectModel` 的 `reasoningEffort` |
| 工作区选择 | 新会话页选择工作目录 | 会话面板顶部工作区胶囊，新建会话落在所选工作区 | `workspace/list` + `session/create { workspaceId }` |

## 二、可实现但尚未做（主机已支持）

按「价值 / 成本」排序，建议 V0.04 起逐个落地。

| 优先级 | 能力 | endpoint | 说明 |
|---|---|---|---|
| P2 | 工作区文件浏览 | `host/listDirectory`、`session/openWorkspacePath` | 只读浏览可先做 |
| P2 | 技能清单 | `skills/list` | **实测 native 主机返回空** `{items: []}`，属主机缺口 |

| P1 | 排队消息管理 | `session/updateQueue` | 需要主机把排队项回显到 projections |
| P1 | 附件与图片 | `session/attachment` | 需要先做附件上传通道（当前协议未暴露 fileUploads 的远程入口） |

| P2 | 工作区管理 | `workspace/create|delete|rename|list` | 多工作区切换 |

## 三、受主机能力限制（需要先动 Host 插件）

以下能力 dsh-go 有，但 `ds-harness-remote@0.6.x` 的 Host 侧**没有暴露**对应 endpoint，鸿蒙端无从调用：

| 能力 | 现状 |
|---|---|
| 后台任务（列表/实时输出/停止） | `dsh-api-job-controller` 只有 `kill`，缺 `job/list`、`job/follow` |
| 长期目标（目标条） | 未暴露 `goals/*` |
| 子代理目录与谱系 | 未暴露子代理查询 |
| 轨迹（事件表） | 未暴露 `session/trajectory` |
| 终端 | 未暴露 terminal 通道 |
| 待办（Todo）条 | projections 未带 todo 投影 |
| 会话置顶 / 取消置顶 | DSH 有 `workspace/pinSession`/`unpinSession`，插件未透传 |
| 会话取消归档 | DSH 有 `unarchiveSession`，插件未透传 |
| 引用文件 / `@` 会话 | 未暴露 `fileReferences/list`、`sessionReferenceResolver/candidates` |
| 交付物卡片 | 未暴露 deliverables |
| 分享卡 / 对话回放 | 需要服务端能力 |

**结论**：上表需要在 `ds-harness-remote` 的 Host 插件里补 endpoint 映射，属于上游改动；建议先提 issue 说明需求，再按优先级逐个透传。

## 四、不适用

| 能力 | 原因 |
|---|---|
| 本机运行 Linux 环境 | dsh-go 自带 Linux 运行时；鸿蒙端定位是「遥控电脑」的远程客户端，不做本机 Host |
| 桌面宠物（Deepy / 鲸娘） | 产品形态差异，非协议能力 |
| 浏览器侧栏 | 官方 Web 版默认不启用 |
| 在本地应用打开 | 需要运行 Host 的机器有桌面 |

## 五、建议排期

| 版本 | 内容 |
|---|---|
| **V0.03（本次）** | 上面「一、本轮已对齐」全部 + 安全加固 + CI/文档 |
| V0.04 | 模型选择器、权限预设图形入口、消息分叉、忘记主机入口 |
| V0.05 | 附件/图片、工作区文件浏览、技能清单 |
| V0.06+ | 依赖上游补 endpoint 的部分（后台任务、目标、子代理、轨迹、终端） |

## 附录：Host 实际暴露的 endpoint（31 个）

```
commands/execute        commands/list           host/describe
host/listDirectory      session/attachment      session/canOpenWorkspacePath
session/cancel          session/create          session/fork
session/history         session/initializeDefaultModel
session/list            session/modelCatalog    session/models
session/openWorkspacePath session/page          session/projections
session/prompt          session/rename          session/search
session/selectModel     session/selectPermission session/updateQueue
skills/list             workspace/archiveSession workspace/create
workspace/delete        workspace/insertBefore  workspace/insertSessionBefore
workspace/list          workspace/rename
```
