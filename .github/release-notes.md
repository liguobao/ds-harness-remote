## 中文

**v0.6.3 · Android build 71**

### 更新

- 适配 DeepSeek Harness `0.2.2-rc.1`：远程会话图片按新的附件引用契约恢复展示，CodeX/ACP 会话的实时状态适配新的投影帧，新增的轨迹原始结果、自动化任务编辑与第三方插件更新界面可通过 Remote 使用。
- 要求 Node.js `>=24.9`（与 Harness 0.2.2 一致）；Linux 安装器改为安装 Node.js 24.9.0。

### 修复

- 修复 Harness 0.2.2 上转发事件流因缺少调用 owner Peer 而触发的 Desktop 客户端重连循环。
- Remote 启动时不再自动禁用同名的第三方 `dsh-remote` 插件；只自动迁移自有的 `@dsh-remote/plugin` 旧名。若旧的本地安装使用裸名，请确认其来源后再手动禁用。

## English

**v0.6.3 · Android build 71**

### Updates

- Support DeepSeek Harness `0.2.2-rc.1`: remote session images display again with the new attachment reference contract, CodeX/ACP sessions keep live state updates with the new projection frames, and the new Trajectory raw results, automation editing, and third-party plugin update surfaces work over Remote.
- Require Node.js `>=24.9`, matching Harness 0.2.2. The Linux installer now provisions Node.js 24.9.0.

### Fixes

- Fix a Harness 0.2.2 reconnect loop caused by opening the forwarded Remote event stream without a calling owner Peer.
- Preserve other plugins named `dsh-remote` when Remote starts. Only the owned `@dsh-remote/plugin` legacy name is migrated automatically; if an older local installation used the bare name, check its origin before disabling it manually.
