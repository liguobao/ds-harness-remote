# HarmonyOS 客户端更新记录

## 0.03 — 2026-11-04

对应 `AppScope/app.json5`：`versionName 0.03` / `versionCode 1000008`。

### 新增能力

- **插话与排队**：输入栏可切换「排队 · 本轮之后 / 插话 · 立刻打断」；生成中仍可输入，插话会立刻打断当前轮的下一步行动。
- **中断当前轮**：生成中显示停止键（`session/cancel`）。
- **斜杠命令**：输入 `/` 弹出候选条，选中填入；发送时优先走 `commands/execute`，主机不识别该命令时自动降级为普通消息。
- **会话重命名**：点击聊天页副标题进入编辑态。
- **会话归档**：会话列表行长按归档。
- **会话搜索**：会话面板顶部搜索框（`session/search`）。
- **上下文占用**：副标题右侧百分比胶囊，≥80% 转红（`session/projections`）。
- **断线自动重连**：指数退避 1/2/4/8/15/30 秒，最多 6 次，界面显示重连进度。
- **模型选择**：聊天顶栏模型胶囊 → 底部选择面板（`session/modelCatalog` + `session/selectModel`）。
- **权限预设**：顶栏权限胶囊 → 只读 / 可写 / 完全三种预设（`session/selectPermission`）。
- **从消息分叉**：长按任意聊天气泡 → 确认后从该条消息分叉出新会话（`session/fork`）。
- **忘记主机公钥**：设备卡片上的 🔑 入口，二次确认后清除固定记录，下次连接重新走 TOFU。

### 安全

- 设备 X25519 私钥、账号 `accessToken`/`refreshToken`、Host 公钥固定记录改用 **Asset Store Kit**（`Accessibility.DEVICE_UNLOCKED` + `SyncType.NEVER`），不再以明文写入 `preferences`；升级后首次启动自动迁移历史明文数据并删除明文条目。
- 控制帧日志只记录 `type` 与长度，不打印 payload；会话列表日志不再输出会话标题（`docs/protocol.md` §25 不变量 12）。

### 构建与工程

- `bundleName` 由 IDE 模板值改为 `cn.r2049.dshremote`，`vendor` 改为 `r2049`。
- 移除 DevEco 模板的 `entry/src/main/cpp` 原生模块与 `libentry.so` 依赖，构建不再引入 `libc++_shared.so`。
- 仓库内文件权限统一为 644。
- 新增密码学一致性测试：用仓库 `fixtures/crypto/v1/noise-ik.json` 校验 X25519 公钥推导、handshake msg1 逐字节、msg2 payload、双向 transport 帧与篡改拒绝。
- 设备端测试替换模板用例：`Crypto.test.ets`（X25519 对称性、AEAD 往返、篡改/换钥拒绝）、`SecureStore.test.ets`（Asset Store 可用性、token/身份往返、host pin 清除）。
- CI：`apps/harmony` 纳入变更检测，`quality` 任务新增一致性测试步骤。
- 新增 `.github/workflows/harmony-hap.yml`（自建 runner + Secrets 注入签名）与 `apps/harmony/scripts/inject-signing.mjs`。
- 文档：新增 `docs/harmony-client.md`、`docs/harmony-parity.md`、`apps/harmony/README.md`，并同步 `README.md` / `README.en.md` / `README.ja.md` / `README.zh.md` 的客户端表格。

### 已知限制

- 仅支持 HarmonyOS 7.0（API 26）及以上。
- Noise IK 尚未实现 Rekey（与共享 `packages/crypto` 同步待办）。
- 界面文案仍为中文硬编码，未接入多语言资源。
