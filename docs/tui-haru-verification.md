# haru 真实 Harness TUI / Android 验收

日期：2026-11-15。结论：本次实测组合的核心远程链路通过，未发现新增阻断问题。

## 环境与产物

- Host：haru，Ubuntu 22.04 x64，Node.js 24.9.0，Harness 0.2.2-rc.1。
- 真实交互界面：`@deepseek-harness-tui/dsh-tui@0.20.1`，在 tmux PTY 中运行，非 headless 或模拟 Gateway。
- Remote：当前工作区构建的 `ds-harness-remote@0.6.5` 与独立组合包 `ds-harness-remote-tui@0.6.5`；包含 release review 的工作区别名修复。
- 手机：Xiaomi MIX 4，Android App 0.6.5 (72)，沿用上一轮已安装 APK，没有重新构建 APK。
- 实际连接：`dsh.r2049.cn` Relay，Noise IK / ChaCha20-Poly1305。此次不构成 LAN/P2P/TURN 验收。

Tarball SHA-256：

```text
7bbdca79f19652ef5e14ea8b7831552716d9ab2b90f3183966cfc6a6e4400c90  ds-harness-remote-0.6.5.tgz
35bfb0bfffb52a3880276a84afcce4f7d83df167326e82e18a482e831d54d967  ds-harness-remote-tui-0.6.5.tgz
```

## 启动方式与隔离

安装到独立 profile `~/.dsh/profiles/remote-tui-accept-20261115`，组合 `@deepseek-ai/dsh-base`、真实 TUI 与 `ds-harness-remote-tui`。只启用一个 Remote Host entry。使用既有 `~/.dsh` 身份和授权，先停止 `dsh-web.service`，确认 Web 端口关闭，再启动 TUI，避免同一身份并发运行。

```sh
export PATH="$HOME/.nvm/versions/node/v24.9.0/bin:$PATH"
export DSH_HOME="$HOME/.dsh"
export TERM=xterm-256color
export DSH_TUI_LANG=zh
cd "$HOME/.local/share/ds-harness-remote/tui-acceptance-20261115/workspace"
dsh --profile remote-tui-accept-20261115
```

安装依赖需要明确允许 native build；离线安装后检查 profile 的 bundles 列表包含上述三项。启动时出现 `tool-ralph` 和 `tool-subagent-list-agents` patch 目标缺失警告，未阻止 TUI 与本轮 Remote 功能。没有将含凭据的配置或原始安装日志纳入仓库。

## 实测结果

| 项目 | 结果 |
| --- | --- |
| TUI 建立会话，手机发现工作区及会话 | 通过；手机读取 TUI 创建的 `HARU_TUI_LOCAL_OK response` 会话 |
| TUI 发起真实模型请求，手机读取结果 | 两端正文一致；模型实际回复 `HARU_TUI_LOCAL_ETOKEN`，没有按要求输出 OK，本项只据此确认同步，不将它记作模型指令遵循成功 |
| 手机继续同一会话，TUI 同步更新 | 手机发送 `What is 2 plus 2? Answer with the single digit.`，手机与真实 TUI 均显示回复 `4` |
| 手机远程终端 | 在测试工作区执行 `echo HARU_TUI_TERMINAL_OK`，终端回显同名标记 |
| 工作区文件列表与正文预览 | `preview.txt` 显示 `HARU_TUI_FILE_OK` |
| 手机上传二进制文件 | 2 MiB 文件成功落盘；SHA-256 与原文件一致，见下方 |
| App 强制退出后重新打开 | 重新完成连接，恢复同一会话及两轮历史，包括回复 `4` |
| 验收后恢复服务 | 已终止临时 TUI，原 `dsh-web.service` 为 active，重新监听 `127.0.0.1:43123` |

上传文件 `haru-android-smoke-20261115.bin` SHA-256：

```text
91d3beb88a9b2f778a6c44a1c53b63d3c79931845a9aef84b3fb414610bd1938
```

证据：[手机共享会话](images/tui-haru-20261115/shared-session.png)、[文件预览](images/tui-haru-20261115/file-preview.png)、[真实 TUI 屏幕文本](images/tui-haru-20261115/tui-session.txt)。临时安装、测试文件及日志留在 haru 的 `~/.local/share/ds-harness-remote/tui-acceptance-20261115`，便于复现。

## 范围

本轮覆盖上述版本组合的会话发现、双向消息与历史、终端、文件预览、Relay 上传和 App 重启恢复。未覆盖全部 TUI 命令、DS-Bot TUI 扩展、电脑控制、真实审批、提醒、其他 Harness/TUI 版本、iOS 或 Windows。可信路径别名边界由已有自动测试覆盖，本轮未专门构造别名路径。原 Web profile 未替换为本次测试 tarball；验收后已恢复原服务。本轮没有打 tag 或发布。
