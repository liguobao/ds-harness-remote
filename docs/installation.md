# Automated installation guide

[简体中文](installation.zh.md)

macOS / Linux:

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell (**Run as administrator** under the account that will own the installation):

```powershell
# Download first, then run. Avoid "irm ... | iex": when .NET Framework cannot
# negotiate TLS 1.2, irm fails and pipes $null into iex, which surfaces a
# misleading "null-valued expression" error instead of the network failure.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing https://dsh.r2049.cn/app/install.ps1 -OutFile "$env:TEMP\install.ps1"
if ((Get-Item "$env:TEMP\install.ps1").Length -lt 1KB) { throw 'Downloaded installer is unexpectedly small.' }
& "$env:TEMP\install.ps1"
```

On macOS/Linux, the script installs Node.js if missing and registers a Host background
service (Linux uses a system-level systemd unit and requires sudo).

On Windows, it installs a private Node.js, pnpm, DSH and Remote runtime under
`%LOCALAPPDATA%\dsh-remote`, and adds only the Remote CLI launcher to your user `PATH`.
It does not require or replace global Node.js. WinSW registers an automatically started
service running as your Windows account. Run both installation and uninstallation from
an administrator PowerShell window; the scripts check privileges and do not elevate
themselves. Enter the account's password (not a Windows Hello PIN) on first installation. Passwords are not written to the XML
configuration. The wrapper is pinned to WinSW `3.0.0-alpha.11` for its interactive
service-account prompt. Windows ARM64 uses its .NET Framework wrapper.

Both platforms install Remote and File Viewer into the `web` profile. Windows preserves
`DSH_HOME` (default `%USERPROFILE%\.dsh`) for both the service and login CLI.
Use `DSH_INSTALL_DIR` to override the Windows program directory, and use the same value
when uninstalling. An existing same-user logon task is removed during migration;
previous global Node.js/npm packages are left in place. Restart the service after CLI
login/logout; the installer prints the command. Windows uninstall removes its private
runtime and plugins, while retaining DSH profiles and credentials. Legacy installations
without an installation record require their original uninstaller.

```sh
ds-harness-remote login zhihu
ds-harness-remote status
```

Restart DSH and continue with [Quick start](../README.md#quick-start). To uninstall:
`curl -fsSL https://dsh.r2049.cn/app/uninstall.sh | bash`
(Windows: download `uninstall.ps1` the same way and run `& "$env:TEMP\uninstall.ps1"`; avoid `irm ... | iex`). If the domain is unreachable,
swap `https://dsh.r2049.cn/app` for
`https://raw.githubusercontent.com/liguobao/ds-harness-remote/main/scripts` and run the same way.
