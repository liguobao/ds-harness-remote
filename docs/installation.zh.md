# Remote 插件安装指南

[English](installation.md)

## DeepSeek Harness Desktop

打开 **扩展 / 插件管理**，选择从 **npm** 安装，输入包名和版本：

```text
ds-harness-remote@0.5.0
```

安装后重启 Desktop。更新和卸载也使用同一插件管理入口。
Desktop 管理自身运行环境和专用 `desktop` profile；普通独立 DSH CLI 不能管理这个保留
profile，需要使用 Desktop 官方提供的 `dsh` 启动器。

## 使用已有 Harness 命令安装或更新

脚本只通过已有 Harness 插件管理器安装 `ds-harness-remote`。不安装或升级 DSH、Node.js、
pnpm，不修改 PATH 或 npm 配置，也不注册后台服务。请使用普通用户运行。

macOS / Linux：

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell（无需管理员窗口）：

```powershell
# 先下载再运行；Windows PowerShell 5.1 下载 HTTPS 文件需要启用 TLS 1.2。
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$installer = Join-Path $env:TEMP 'dsh-remote-install.ps1'
Invoke-WebRequest -UseBasicParsing https://dsh.r2049.cn/app/install.ps1 -OutFile $installer
& $installer
```

脚本优先使用找到的 Desktop 官方启动器：macOS 检查 `~/Applications` 和 `/Applications`，
Windows 检查 Desktop 在 `HKCU\Software\DeepSeekHarness\Command` 记录的命令目录；
否则使用 PATH 中的 `dsh`。两种环境同时存在时，可用 `DSH_COMMAND` 明确选择独立 CLI。
选择 Desktop 启动器时默认
使用 `desktop` profile，否则默认使用 `web`。
找不到已有命令时，脚本会给出 Desktop 插件管理操作说明并停止，不会报告安装成功。
未提供官方 CLI 的旧版 Desktop 仍可通过插件管理安装上述 npm 包。

可用 `DSH_COMMAND` 指定已有启动器路径（包括自定义 Desktop 安装位置），`DSH_PROFILE`
指定 `dsh-tui` 等 profile，`REMOTE_VERSION` 固定插件版本。默认安装 npm 的 `latest`，
重跑会更新所选 profile 中的 Remote。已有 `DSH_HOME` 会原样传给 Harness。

独立 CLI 的等效命令：

```sh
dsh plugin --profile web add -w ds-harness-remote@latest
```

使用 Desktop 官方启动器时改为 `--profile desktop`。重启所选 Harness 实例，打开
**Remote** 登录；dsh-TUI 中使用 `/remote login`。

## 卸载 Remote

使用 Desktop 插件管理，或执行等效的插件移除命令：

```sh
dsh plugin --profile web remove -w ds-harness-remote
```

线上 `uninstall.sh` 和 `uninstall.ps1` 使用与安装脚本相同的启动器/profile 选择逻辑，
只移除 Remote。使用与安装时相同的 `DSH_COMMAND`、`DSH_PROFILE` 和 `DSH_HOME`。
Windows 卸载脚本同样先下载再运行。

原后台服务安装器、独立运行环境和 token 安装包装脚本已停用。新版脚本不自动迁移、停止
或删除旧服务/运行环境，保留已有 DSH profile、凭据和其他插件。使用旧全局卸载脚本前，
请先确认它会删除哪些包。

若域名不可访问，把 `https://dsh.r2049.cn/app` 换成
`https://raw.githubusercontent.com/liguobao/ds-harness-remote/main/scripts`。
