# ds-harness-remote 双端补丁：防更新自动补丁机制

适用对象：Antigravity 双端会话功能在 `packages/plugin/src/acp/adapters/antigravity/` 的改动，构建后落到
`packages/plugin/dist/index.js`（esbuild bundle，host entry）。插件升级会把已安装目录里的这个文件覆盖回上游版本，
本机制负责在升级后自动把补丁重新贴回去。

工具目录：`scripts/antigravity-dual-end-patch/`
- `patch.sh` —— 主命令（check / apply / status / regen-manifest / install-launchd / uninstall-launchd / daemon / selftest）
- `patch.conf` —— 配置模板：待打补丁文件清单、原生 marker、结构 anchor
- `manifest.tsv` —— 清单（由 `regen-manifest` 生成，记录每个文件的 sha256）
- `selftest.sh` —— 临时沙箱自测（不碰真实安装目录）

---

## 1. 关键前提（为什么 primary 必须是 dist/index.js）

`packages/plugin/dsh-plugin.json` 的 `facets.host.entry = "dist/index.js"`。esbuild 会把所有 `src` 内联进这个 bundle，
**实际运行的就是 `dist/index.js`**。已安装插件的 `dist/index.js` 中确有 4 处 `.gemini/antigravity-cli` 硬编码。

`dist/acp/**/*.js` 只是 `tsc` 逐文件产物，不是 host 入口；可按需列入 manifest 作为一致性/其他消费者使用，
但绝不能替代 `dist/index.js`。NATIVE / CONFLICT 的 marker 匹配也都在 `dist/index.js` 上进行。

---

## 2. 为什么不能软链接两个目录

直觉做法是“把已安装插件的 dist 软链接到 worktree 的 dist，这样每次构建自动生效”。不要这么做：

1. **粒度不匹配 / 会暴露整个目录**：`ln -s` 是目录级的，会把 worktree 里的 `.ts` 源码、`tsconfig`、测试、map、
   未构建或半成品文件全部暴露给插件运行时；host 只该拿到构建产物。
2. **升级会被打断**：插件升级流程（`npm/pnpm` 安装、覆盖式解包）遇到 symlink 时会删除链接或写入链接目标，
   轻则补丁丢失，重则**污染 worktree 源码目录**（升级进程以为自己在写安装目录，实际写进了源码）。
3. **符号链接解析差异**：`require`/`import`、esbuild bundle 内的 `__dirname`、资源路径解析在 symlink 下行为不一致，
   容易出现“文件明明在却加载不到”的诡异问题。
4. **不可审计**：软链接没有 sha256 概念，无法判断“补丁是否真的生效、是否被升级覆盖”，而这正是本机制的核心能力。
5. **备份/回滚困难**：链接没有内容，出问题时无法把“被打补丁前的文件”原样退回。

正确做法是**按文件复制 + 校验和**：manifest 明确列出哪些文件、源在哪、目标在哪、期望 sha256 是多少；
每次 check 用 checksum 断言状态，apply 前备份、原子替换、替换后复验。

---

## 3. 命令用法

```bash
P=scripts/antigravity-dual-end-patch/patch.sh

$P check                # 逐文件输出状态；最后一行 OVERALL
$P check --machine      # 机器可读: <target>|STATE ... OVERALL|STATE
$P apply                # 幂等应用（NATIVE/CONFLICT 拒绝；先备份后原子替换；后验 APPLIED）
$P status               # 人类可读摘要（路径/状态/最近备份/launchd）
$P regen-manifest       # 构建完成后重新生成 manifest.tsv（写入真实 sha256）
$P install-launchd      # 生成并加载 LaunchAgent
$P uninstall-launchd    # 卸载 LaunchAgent
$P daemon               # launchd 内部使用：check + apply
$P selftest             # 临时沙箱自测，不碰真实安装目录
```

通用选项：`--dry-run`（只打印动作）、`--machine`（check 机器输出）、`-v/--verbose`（调试日志）、`-h/--help`。
所有路径均可用环境变量覆盖，便于自测或迁移：

| 变量 | 默认值 |
| --- | --- |
| `WORKTREE_ROOT` | 脚本所在目录上两级（即本仓库根） |
| `PLUGIN_DIR` | `~/.dsh/profiles/desktop/node_modules/ds-harness-remote` |
| `PATCH_CONF` | `<脚本目录>/patch.conf` |
| `PATCH_MANIFEST` | `<脚本目录>/manifest.tsv` |
| `PATCH_STATE_DIR` | `~/.dsh/antigravity-dual-end-patch` |
| `PATCH_BACKUP_ROOT` | `<PATCH_STATE_DIR>/backups` |
| `PATCH_LOG_FILE` | 空（设置后日志额外追加到该文件） |

退出码：`0` 成功/APPLIED；`1` 常规错误；`2` 用法错误；`3` NATIVE/CONFLICT 阻止；`4` 清单或源未就绪。

---

## 4. check 状态判定逻辑

### marker 三类定义（防误判的核心，lead 定稿前必读）

`patch.conf` 中三类字符串职责严格区分，**不要混用**：

| 类别 | 变量 | 含义 | 谁写入 |
| --- | --- | --- | --- |
| 补丁独有 marker | `PATCH_MARKERS` | 只有本补丁才有，上游绝不会有；当前 `DSH_AGY_DUAL_END_PATCH_V1` | 源码代理写进补丁产物 `dist/index.js`（常量或注释） |
| 上游原生特征 | `NATIVE_MARKERS` | 只有上游原生支持才出现的字符串；已定稿为 `--app-data-dir` / `AGY_APP_DATA_DIR`（当前 bundle 出现 0 次） | 上游新版 |
| 旧结构 anchor | `ANCHORS` | 旧版文件里稳定存在的字符串；当前 `.gemini/antigravity-cli` | 上游旧版 |

**为什么这样分**：源码代理新增的双端符号（双端目录常量、同步函数名等）**我们补丁自己也会引入**。
若把它们当 NATIVE marker，补丁一旦在位、manifest 又恰好过期，check 就会把「自己的补丁」误判成 NATIVE，
apply 反而拒绝覆盖。因此 NATIVE 必须用「上游独有特征」，并且要「旧 anchor 仍在 + 上游特征出现」双条件。

### 判定顺序（先命中即返回）

| 顺序 | 条件 | 状态 | 含义 |
| --- | --- | --- | --- |
| 1 | 清单 sha 为 `PENDING`/空 | **MISSING** | 清单未生成，先 `regen-manifest` |
| 2 | 源构建产物不存在 | **MISSING** | worktree 还没构建出补丁产物 |
| 3 | 安装目标文件不存在 | **MISSING** | 目标缺失，apply 会创建 |
| 4 | 目标 sha256 == 清单 sha256 | **APPLIED** | 补丁已在位；补丁 marker 在场则交叉验证通过，缺失仅告警不翻转 |
| 5 | checksum 未命中，但补丁 marker 在场 | **STALE** | 我们自己的补丁在位、manifest 可能过期；提示 regen，**绝不判 NATIVE** |
| 6 | 旧 anchor 仍在 + 命中上游原生特征 | **NATIVE** | 上游已原生支持，禁止覆盖 |
| 7 | 旧 anchor 消失（即便见上游特征） | **CONFLICT** | 结构已变且证据不足，交人工确认 |
| 8 | 其余 | **STALE** | 普通升级覆盖 |

**总体状态**（OVERALL）按严重度取最高：`CONFLICT > NATIVE > MISSING > STALE > APPLIED`。
`apply` 仅在总体为 NATIVE 或 CONFLICT 时拒绝；STALE / MISSING（源存在时）执行打补丁；APPLIED 直接跳过。

设计要点：
- checksum 判定放在 marker/anchor 之前：已打补丁文件即使不再含某 anchor 也仍判 APPLIED。
- 自打补丁识别（补丁 marker）放在 NATIVE 之前：checksum 漂移但补丁 marker 在场时判 STALE 而非 NATIVE。
- NATIVE 需双条件（旧 anchor 仍在 + 上游原生特征），单一符号命中不足以判 NATIVE。
- 全部字符串比较使用 `grep -Fq`（字面量），不把目标文件内容当正则执行。

`patch.conf` 三类字符串均已定稿：`NATIVE_MARKERS = --app-data-dir / AGY_APP_DATA_DIR`，
`PATCH_MARKERS = DSH_AGY_DUAL_END_PATCH_V1`（已由源码注入 dist/index.js），
`ANCHORS = .gemini/antigravity-cli`（上游旧版稳定存在）。后续若上游改用其他原生实现，需同步更新本节与第 9 节。

---

## 5. apply 的安全流程

1. 读清单；任一 sha 为 PENDING → 退出码 4。
2. 跑 check；任何 NATIVE/CONFLICT → 退出码 3，不做任何写入。
3. 源产物缺失 → 退出码 4。
4. 需要打补丁的目标：先把原文件备份到 `BACKUP_ROOT/<YYYYmmdd-HHMMSS>/<target_rel>`。
5. 逐文件“同目录临时文件 + `cp -p` + `chmod` + `mv -f`”原子替换。
6. 替换后静默再跑一次 check；若 OVERALL != APPLIED → 从备份回滚（原本不存在的目标则删除）并报错退出。
7. 全部通过 → 打印成功与备份路径。

`--dry-run` 会走完前置判定并打印“将备份/将复制”，但不写任何文件。

---

## 6. 升级后自动重打补丁（LaunchAgent）

```bash
$P install-launchd
```

生成的 plist：`~/Library/LaunchAgents/com.aplier.dsh-antigravity-dual-end-patch.plist`

- `ProgramArguments` 全部使用绝对路径：`/bin/bash <abs>/patch.sh daemon`
- `WatchPaths`：`$PLUGIN_DIR/package.json`、`$PLUGIN_DIR/dist`（dist 目录可选但默认包含）
- `RunAtLoad=true`：安装后立即跑一次 check + apply
- `StandardOutPath` / `StandardErrorPath`：
  `~/.dsh/antigravity-dual-end-patch/launchd.out.log` / `launchd.err.log`

升级流程：插件升级覆盖 `package.json` 或 `dist/` → launchd 触发 `daemon` → `check` 判定 STALE（或 NATIVE/CONFLICT）
→ `apply` 重打补丁（NATIVE/CONFLICT 则拒绝并写日志）。`uninstall-launchd` 会 `bootout/unload` 并把 plist 移出
LaunchAgents 留档到状态目录。

兼容性：优先 `launchctl bootstrap/bootout/enable/kickstart`（现代 macOS），失败回退 `launchctl load/unload -w`。

---

## 7. 冲突如何人工处理

出现 CONFLICT 说明目标文件的结构 anchor 已不存在（上游大改）。处理步骤：

1. `P=scripts/antigravity-dual-end-patch/patch.sh; $P check` 看具体哪个目标冲突。
2. 对照备份目录下的原文件与当前安装文件，确认上游改了什么：
   `diff -u <备份>/dist/index.js "$PLUGIN_DIR/dist/index.js"`
3. 若是功能已由上游原生实现 → 更新 `patch.conf` 的 `NATIVE_MARKERS`，使其命中新实现的常量/函数名，
   然后 `$P check` 应转为 NATIVE，`apply` 会安全拒绝；此时应把该条目从 `PATCH_FILES` 移除并在团队内标记“已上游化”。
4. 若确需继续维护补丁 → 由源码代理在新版基础上重新实现改动、重新构建 `dist/index.js`，
   更新 `patch.conf` 的 `ANCHORS` 为新版稳定锚点，再 `$P regen-manifest && $P apply`。
5. 不要手工把 `manifest.tsv` 的 sha 改成“让 check 通过”——这会绕过保护，等于放弃了升级后识别覆盖的能力。

NATIVE 的处理同理：确认上游确实具备双端能力后，移除对应 `PATCH_FILES` 条目并 `regen-manifest`。

---

## 8. 回滚（备份目录）

每次成功 apply 前都会备份到：

```
~/.dsh/antigravity-dual-end-patch/backups/<YYYYmmdd-HHMMSS>/<target_rel>
```

回滚某个时间点：

```bash
BK=~/.dsh/antigravity-dual-end-patch/backups/20260101-120000
cp -p "$BK/dist/index.js" ~/.dsh/profiles/desktop/node_modules/ds-harness-remote/dist/index.js
# 或用工具自身原子写回（对单个文件）：
# DRY_RUN=false ... 手工 cp 即可；回滚后 check 会回到 STALE（上游版本）
```

回滚后 `check` 会显示 STALE（因为文件回到上游版本、与补丁 sha 不符），这是预期现象；
若要彻底回到“未打补丁且不被自动重打”的状态，先 `uninstall-launchd`，再回滚文件。

`status` 命令会显示最近一次备份目录，便于定位。

---

## 9. 维护提示

- `manifest.tsv` 随仓库提供的是 `sha=PENDING` 模板；本地构建出 `packages/plugin/dist/index.js` 后先运行
  `patch.sh regen-manifest` 生成本机清单，不要提交含本机路径或构建哈希的生成结果。
- `patch.conf` 三类字符串已定稿：`PATCH_MARKERS=DSH_AGY_DUAL_END_PATCH_V1`（源码注入 bundle）、
  `NATIVE_MARKERS=--app-data-dir / AGY_APP_DATA_DIR`（上游原生支持才会出现）、
  `ANCHORS=.gemini/antigravity-cli`（旧版稳定存在）。上游改用其他原生实现时需同步更新配置与第 4 节。
- 若上游新增官方双端支持，`check` 会按第 4 节判定 NATIVE 并让 `apply` 拒绝覆盖；结构大改则判 CONFLICT，
  两种情形都需要人工复核，不要绕过。
- 修改补丁脚本后运行 `patch.sh selftest`（10 组用例），不涉及真实安装目录。

注意：本机制的全部文件都在 `scripts/antigravity-dual-end-patch/` 与 `docs/` 下，不改动 `packages/` 源码，
不修改已安装插件以外的系统配置（除用户显式执行的 launchd plist）。
