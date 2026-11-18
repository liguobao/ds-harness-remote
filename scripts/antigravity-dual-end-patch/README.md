# antigravity-dual-end-patch

已安装 `ds-harness-remote` 插件的“防更新自动补丁”工具（macOS）。插件升级覆盖
`dist/index.js`（host entry）后，自动把双端补丁重新贴回。

- 主脚本：`patch.sh`
- 配置模板：`patch.conf`（文件清单 / 原生 marker / 结构 anchor）
- 清单：`manifest.tsv`（`patch.sh regen-manifest` 生成，含 sha256）
- 自测：`selftest.sh`（临时沙箱，不碰真实安装目录）
- 完整文档：`../../docs/antigravity-dual-end-patch.md`

## 快速开始

```bash
P=scripts/antigravity-dual-end-patch/patch.sh

$P selftest                 # 先自测
$P regen-manifest           # 构建完成后生成最终清单（含真实 sha256）
$P check                    # APPLIED / STALE / NATIVE / CONFLICT / MISSING
$P apply                    # 备份 + 原子替换 + 后验 APPLIED
$P install-launchd          # 升级后自动重打补丁
$P status                   # 摘要
$P uninstall-launchd        # 卸载自动任务
```

所有路径可用 `WORKTREE_ROOT` / `PLUGIN_DIR` / `PATCH_CONF` / `PATCH_MANIFEST` / `PATCH_STATE_DIR` 覆盖。
支持 `--dry-run` / `--machine` / `-v`。

## 一句话设计

`dist/index.js` 是 esbuild host entry（4 处 `.gemini/antigravity-cli` 硬编码所在），所以它是唯一 primary 目标，
marker/anchor 检测也在它上面；按文件复制 + checksum 断言，绝不用目录软链接。详细判定顺序、冲突处理与回滚见完整文档。

## marker 定义与判定规则（lead 定稿 manifest 前必读）

`patch.conf` 里有三类字符串，职责严格区分，**不要混用**：

| 类别 | 变量名 | 含义 | 谁会写入 |
| --- | --- | --- | --- |
| 补丁独有 marker | `PATCH_MARKERS` | 只有我们的补丁才有，上游绝不会有。当前 `DSH_AGY_DUAL_END_PATCH_V1` | 源码代理需在补丁里写进 `dist/index.js`（常量或注释均可） |
| 上游原生特征 | `NATIVE_MARKERS` | 只有上游原生支持才会出现的字符串；已定稿为 `--app-data-dir` 与 `AGY_APP_DATA_DIR`（当前 bundle 两者均为 0 次） | 上游新版 |
| 旧结构 anchor | `ANCHORS` | 未打补丁的旧文件里稳定存在的字符串 | 上游旧版；当前 `.gemini/antigravity-cli` |

**关键防误判设计**：NATIVE 判定绝不能只看「双端功能符号」，因为源码代理新增的符号（双端目录常量、
同步函数名等）我们补丁自己也会引入，补丁后 check 会把自己的补丁误判成 NATIVE 而拒绝 apply。
因此规则是：

1. **先按 manifest sha256 命中判 APPLIED**；命中时若补丁 marker 在位 → 交叉验证通过；marker 缺失则告警但不翻转。
2. checksum 未命中、但**补丁 marker 在位** → 判 **STALE**（我们自己的补丁，只是 manifest 可能过期），
   提示 `regen-manifest`，**绝不判 NATIVE**。
3. checksum 未命中、补丁 marker 不在位、且 **旧 anchor 仍在 + 命中上游原生特征** → 判 **NATIVE**，apply 拒绝覆盖。
4. 旧 anchor 消失（即便看到上游特征）→ 一律 **CONFLICT**，交人工确认。
5. 其余 → **STALE**（普通升级覆盖）。

三类字符串均已定稿（`PATCH_MARKERS=DSH_AGY_DUAL_END_PATCH_V1`、
`NATIVE_MARKERS=--app-data-dir / AGY_APP_DATA_DIR`、`ANCHORS=.gemini/antigravity-cli`）。
仓库内 `manifest.tsv` 是 `sha=PENDING` 模板；本地构建后运行 `patch.sh regen-manifest` 生成本机清单，
不要把含本机路径或构建哈希的生成结果提交入库。
