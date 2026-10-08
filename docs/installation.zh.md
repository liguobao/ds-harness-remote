# 自动安装指南

[English](installation.md)

macOS / Linux：

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell（使用安装所属账户，选择「以管理员身份运行」）：

```powershell
# 先下载再执行。避免 "irm ... | iex"：在 .NET Framework 默认不协商 TLS 1.2 的
# 机器上，irm 失败后向管道传 $null，iex 会报出误导性的 "null-valued
# expression" 错误，掩盖真实的网络故障。
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing https://dsh.r2049.cn/app/install.ps1 -OutFile "$env:TEMP\install.ps1"
if ((Get-Item "$env:TEMP\install.ps1").Length -lt 1KB) { throw '下载的安装脚本异常地小。' }
& "$env:TEMP\install.ps1"
```

macOS/Linux 请使用普通用户运行脚本。已有 Node.js 时复用，缺少时安装到用户目录。
pnpm、DSH 和 Remote CLI 安装到 `~/.local/share/dsh-remote/runtime` 的独立 npm prefix，
保留已有全局 DSH/npm 包和 npm prefix 配置。只将 Remote CLI 启动器加入 shell `PATH`，
保留原有的 `dsh` 命令。安装后打开新终端即可使用启动器。

脚本注册 Host 后台服务：Linux 使用 systemd 系统服务，仅注册服务时请求 sudo；macOS
使用当前用户的 LaunchAgent。可用绝对路径 `DSH_INSTALL_DIR` 指定程序目录，卸载时传入
相同值。显式指定的 `DSH_HOME` 会同时用于服务和登录 CLI。
新版卸载脚本只清理带安装标记的独立运行环境及所选 profile 的 Remote 插件，保留 Node.js、
profile、凭据和已有全局包。对于旧版全局安装，只移除服务与 PATH 条目，保留全局包和
profile 插件；如需手动删除，请先确认它们是否仍被使用。

如果只是给已有 Harness 安装 Remote，请使用[插件安装命令](../README.zh.md#安装)，
无需运行后台服务安装脚本。

Windows 将独立的 Node.js、pnpm、DSH 和 Remote 安装到 `%LOCALAPPDATA%\dsh-remote`，
只把 Remote CLI 启动器加入用户 `PATH`，不依赖或替换全局 Node.js。WinSW 注册以当前
Windows 账户运行的开机服务。安装和卸载都需在管理员 PowerShell 中执行，脚本只检查权限，
不会自行提权。首次安装需输入该账户的登录密码（不是 Windows Hello PIN）。密码不写入 XML 配置。为支持交互输入服务账户密码，固定使用
WinSW `3.0.0-alpha.11`；Windows ARM64 使用其 .NET Framework wrapper。

macOS/Linux 默认将 Remote 安装到 `web` profile（可用 `DSH_PROFILE` 覆盖）；Windows
将 Remote 和 File Viewer 安装到 `web` profile。Windows 服务和登录 CLI 使用相同的
`DSH_HOME`（默认 `%USERPROFILE%\.dsh`）。可用 `DSH_INSTALL_DIR` 指定 Windows 程序目录，
卸载时需传入相同值。安装会迁移当前用户的旧登录任务，保留以前全局安装的 Node.js/npm 包。
CLI 登录或退出后需重启服务，安装结束会打印命令。Windows 卸载会移除独立运行环境和插件，
保留 DSH profile 与凭证；没有安装记录的旧版本需使用对应版本的卸载脚本。

```sh
ds-harness-remote login zhihu
ds-harness-remote status
```

重启 DSH 后按[快速开始](../README.zh.md#快速开始)继续。卸载：`curl -fsSL https://dsh.r2049.cn/app/uninstall.sh | bash`
（Windows：用同样方式下载 `uninstall.ps1` 后执行 `& "$env:TEMP\uninstall.ps1"`；避免 `irm ... | iex`）。若域名不可访问，把
`https://dsh.r2049.cn/app` 换成
`https://raw.githubusercontent.com/liguobao/ds-harness-remote/main/scripts` 再执行即可。
