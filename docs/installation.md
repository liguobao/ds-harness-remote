# Remote plugin installation

[简体中文](installation.zh.md)

## DeepSeek Harness Desktop

Open **Extensions / Plugin management**, choose the GitHub plugin installation entry,
and paste this address:

```text
https://github.com/liguobao/ds-harness-remote
```

Restart Desktop after installation. Use the same plugin manager to update or remove Remote.
Desktop manages its own runtime and `desktop` profile. An ordinary standalone DSH CLI
cannot manage that reserved profile; use Desktop's official `dsh` launcher instead.

## Install/update with an existing Harness command

The scripts install only `ds-harness-remote` using the existing Harness plugin manager.
They do not install or upgrade DSH, Node.js or pnpm, change PATH or npm configuration,
or register background services. Run them as your normal user.

macOS / Linux:

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

Windows PowerShell (no administrator window required):

```powershell
# Download first. TLS 1.2 is needed by Windows PowerShell 5.1 for HTTPS downloads.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$installer = Join-Path $env:TEMP 'dsh-remote-install.ps1'
Invoke-WebRequest -UseBasicParsing https://dsh.r2049.cn/app/install.ps1 -OutFile $installer
& $installer
```

The scripts prefer Desktop's official launcher when found: macOS checks `~/Applications`
and `/Applications`; Windows checks Desktop's recorded command directory in
`HKCU\Software\DeepSeekHarness\Command`. Otherwise they use `dsh` on PATH.
Set `DSH_COMMAND` to explicitly select your standalone CLI when both are installed.
When the selected launcher is
Desktop's, the default profile is `desktop`; otherwise it is `web`.
If no command is available, the script stops with Desktop plugin-manager instructions;
it does not report a successful installation. Older Desktop versions without an official
CLI can still install the GitHub address through Plugin management.

Use `DSH_COMMAND` to select an existing launcher (including a custom Desktop location),
`DSH_PROFILE` to select a profile such as `dsh-tui`, and `REMOTE_VERSION` to pin a release.
The default package version is npm's `latest`; rerunning updates Remote in the selected
profile. An existing `DSH_HOME` is passed through to Harness.

The equivalent standalone CLI command is:

```sh
dsh plugin --profile web add -w ds-harness-remote@latest
```

For Desktop's official launcher use `--profile desktop`. Restart the selected Harness
instance, open **Remote**, and sign in; in dsh-TUI use `/remote login`.

## Remove Remote

Use Desktop Plugin management, or run the equivalent plugin removal command:

```sh
dsh plugin --profile web remove -w ds-harness-remote
```

The hosted `uninstall.sh` and `uninstall.ps1` scripts resolve the existing launcher/profile
in the same way as the installers and remove only Remote. Use the same `DSH_COMMAND`,
`DSH_PROFILE` and `DSH_HOME` values. Download the Windows script before running it as above.

The former service installers, private runtimes and token-install wrappers are retired.
The new scripts do not migrate, stop or delete an older service/runtime. Existing DSH
profiles, credentials and other plugins are retained. Do not run an old global uninstaller
without checking which packages it would remove.

If the hosted domain is unreachable, replace `https://dsh.r2049.cn/app` with
`https://raw.githubusercontent.com/liguobao/ds-harness-remote/main/scripts`.
