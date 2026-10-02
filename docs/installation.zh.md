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

macOS/Linux 脚本会在缺少 Node.js 时安装，并注册 Host 后台服务；Linux 使用 systemd
系统服务，需要 sudo。

Windows 将独立的 Node.js、pnpm、DSH 和 Remote 安装到 `%LOCALAPPDATA%\dsh-remote`，
只把 Remote CLI 启动器加入用户 `PATH`，不依赖或替换全局 Node.js。WinSW 注册以当前
Windows 账户运行的开机服务。安装和卸载都需在管理员 PowerShell 中执行，脚本只检查权限，
不会自行提权。首次安装需输入该账户的登录密码（不是 Windows Hello PIN）。密码不写入 XML 配置。为支持交互输入服务账户密码，固定使用
WinSW `3.0.0-alpha.11`；Windows ARM64 使用其 .NET Framework wrapper。

两端均将 Remote 和 File Viewer 安装到 `web` profile。Windows 服务和登录 CLI 使用相同的
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
