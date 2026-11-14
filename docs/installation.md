# Remote plugin installation

[简体中文](installation.zh.md)

The sole installer is `scripts/install.sh`. There are no Windows, separate uninstall or token-wrapper scripts.

## Online updates in DSH Plugin management

Starting with DSH 0.2.2, Remote **installed from npm** can check for versions and update under **Extensions / Plugin management → ds-harness-remote**. The official DSH plugin manager owns the update. With hot reload, it stops the old version before installing the new one and attempts to restore the previous version if installation fails or is cancelled. Restoration can also fail; check the final result in Plugin management and restart when requested.

GitHub, local directory, `file:` and `link:` installations are not eligible for official online updates. To switch to npm, use the same Desktop's official `dsh` launcher:

```sh
dsh plugin --profile desktop add -w ds-harness-remote@latest
```

For a Web Host, use its actual launcher, `DSH_HOME` and profile (usually `web`). Restart when requested after switching sources, then check versions in Plugin management. Keep the profile and Remote credential directory.

The local Remote dialog offers an update only after its registry check finds a newer version and official Plugin management marks the installation updatable. Other sources retain a release link. Updating Remote interrupts its connections; operate locally. Before upgrade or downgrade, stop every Harness process and back up profiles and credentials; see the [integration guide](plugin-integration.md).

## Linux: DSH, one-time registration and boot startup

**Linux requires root. The system service runs as root, so Remote Host, Agent tools and remote terminals also have root privileges. Only grant access to trusted accounts.** This installer currently does not configure a non-root service user.

### Install

Download and inspect the script first. This example reads the token privately inside a root shell rather than putting it in command arguments or shell history:

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh -o install.sh
# Inspect the downloaded script before running:
sudo -H bash -c '
  read -r -s -p "One-time Host registration token: " token; printf "\n"
  DSH_REMOTE_REGISTRATION_TOKEN="$token" bash ./install.sh
'
```

Omit `sudo -H` when already in a root shell. For a repository checkout, replace `./install.sh` with `./scripts/install.sh`. Repository changes are not automatically deployed to the hosted endpoint; confirm your downloaded script includes the full Linux flow.

The installer:

1. Reuses `DSH_COMMAND` or an existing DSH on PATH without upgrading it.
2. If absent, installs official Node.js 24.9.0, DSH and private pnpm 9.15.4 under `/opt/ds-harness-remote/runtime.*`. The Node.js archive is pinned to the [official SHA-256 checksums](https://nodejs.org/dist/v24.9.0/SHASUMS256.txt). The stable launcher is `/opt/ds-harness-remote/bin/dsh`, reused on subsequent runs.
3. Installs/updates Remote using official `dsh plugin` management, defaulting to the `web` profile and npm `latest`.
4. If a token is supplied, exchanges it through the existing Host registration-code API and persists device credentials. The token is not written to logs, service configuration or persistent device-credential fields. It is not a model API key.
5. Verifies the profile has an active official Web Host startup, configures a systemd **system service**, enables boot startup, and starts/restarts the matching installer-managed instance. No login or linger is needed.

It does not change system Node.js, global PATH or npm configuration, or install OS dependencies through apt/yum. Initial bootstrap requires Linux x64/arm64 with libraries compatible with official Node.js binaries, plus existing `curl`, `tar` and `sha256sum`. Automatic services require a working systemd system manager; use `DSH_REMOTE_AUTOSTART=0` in non-systemd containers to skip service setup.

Without a token, registration is skipped; sign in through Remote later. A running service does not mean the Host is authorized or online. Network access, occupied ports and model-provider configuration can also affect initial operation.

### Inspect the service

For the default profile:

```sh
sudo systemctl status ds-harness-remote-web.service
sudo systemctl is-enabled ds-harness-remote-web.service
```

Web binds only to `127.0.0.1`. The installer checks systemd process state, not end-to-end Host availability in a client.

### Reinstallation and safety

Remote credentials live under `$DSH_HOME/ds-harness-remote` (default `~/.dsh/ds-harness-remote`). Installation credential setup and the first startup after an upgrade automatically move the old `remote` directory before reading or creating credentials. No manual migration command or re-pairing is needed.

Before moving, migration verifies the known Remote layout, device key pairs, trusted-peer fingerprints, credential device IDs and Server scope hashes. Unknown files or inconsistent records stop migration; a directory name alone is not treated as proof of ownership. The entire directory moves together, retaining identities, Server scopes, tokens and trusted peers.

If a verified directory cannot be moved because of permissions, a busy filesystem or a filesystem boundary, Remote records the fallback choice outside the credential tree, and this and subsequent processes continue using the same legacy directory. It does not create replacement identities or clear authorization. If this record cannot be saved, startup stops without changing credentials. This fallback requires the original directory to remain intact and the destination to remain absent. Stop old Harness instances as part of upgrading/restarting; if both directories exist, or locks or symlinks are found, migration stops without merging or overwriting credentials.

Older installer releases used `/opt/dsh-remote` and `dsh-remote-<profile>.service`. These names are not automatically migrated. The installer refuses to proceed if an owned legacy service is still active or enabled. Before reinstalling with the new defaults, stop and disable the old service (for the default profile: `sudo systemctl disable --now dsh-remote-web.service`). Old `dsh-remote` settings are no longer imported; configure Remote again after reinstalling.

- Routine updates do not need another token. A consumed one-time token cannot be reused.
- Existing Host credentials are never silently replaced. Stop the original Host and sign out through official controls before changing accounts with a fresh token.
- If registration succeeds but service startup fails, credentials remain. Repair the environment and rerun without a token.
- Units carry a canonical `DSH_HOME` ownership marker. Only matching installer-managed units are updated. Different homes, unmarked legacy units and symlinks are not taken over.
- Web capability and unit ownership are preflighted before token redemption. Headless, SDK and terminal-only profiles (including `dsh-tui`) do not get Web units; use `DSH_REMOTE_AUTOSTART=0` and manage those processes separately. For TUI profiles, install the matching standalone [ds-harness-remote-tui bundle](../packages/tui/README.md); enable only one Remote Host entry.
- Only matching managed services are started/restarted. Other DSH processes are not stopped automatically; exit old foreground processes using the same home to prevent connection replacement or port conflicts.
- Legacy services and runtimes are not migrated or deleted. Credentials are retained and their directory migration follows the rules above. There is no automatic rollback; failed bootstrap directories may remain for inspection.

## macOS: reuse Desktop / CLI

Run as a normal user:

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

The installer prefers Desktop's official launcher under `~/Applications` or `/Applications`, otherwise `dsh` on PATH. Both present is valid; neither present fails. It does not install Desktop, DSH or Node.js, or create services.

Desktop defaults to `desktop`; standalone CLI defaults to `web`. Override with `DSH_COMMAND` / `DSH_PROFILE`. Token registration uses the same installer; restart the selected Desktop/CLI manually afterward. Without a token, sign in through Remote or the standalone `ds-harness-remote login` CLI.

Alternatively, open Desktop **Extensions / Plugin management** and install from npm:

```text
ds-harness-remote@0.6.5
```

An ordinary standalone CLI cannot manage the reserved `desktop` profile; use Desktop's official launcher.

## Options and environment

| Setting | Meaning |
| --- | --- |
| `DSH_COMMAND` | Existing launcher; an invalid explicit selection fails rather than switching instances |
| `DSH_PROFILE` | Selected profile; standalone defaults to `web`, Desktop to `desktop` |
| `DSH_HOME` | Existing value is preserved; registration and runtime share one home, usually root's `.dsh` on Linux |
| `REMOTE_VERSION` | Remote release, default npm `latest` |
| `INTELLIGENT_UI` | `1` also installs the Intelligent UI companion into the same profile; default `0` |
| `INTELLIGENT_UI_VERSION` | Intelligent UI release when `INTELLIGENT_UI=1`, default npm `latest` |
| `DSH_VERSION` | New Linux DSH installation version, default npm `latest`; does not upgrade an existing DSH |
| `DSH_REMOTE_REGISTRATION_TOKEN` | One-time Host token; private interactive input is recommended |
| `DSH_REMOTE_AUTOSTART=0` | Skip Linux service setup/start; root is still required |
| `DSH_INSTALL_ROOT` | Linux private bootstrap root, default `/opt/ds-harness-remote`; absolute path required |
| `DSH_SYSTEMD_DIR` | System unit directory, default `/etc/systemd/system`; leave unchanged for ordinary deployments |

`bash install.sh --token '<one-time-token>'` and a positional token are also accepted, but may expose it through process listings or shell history. Do not use shell tracing/debugging with credentials. Invalid, expired or consumed tokens fail registration.

## Stop and remove

Disable the Linux system service first, replacing `web` with the actual profile:

```sh
sudo systemctl disable --now ds-harness-remote-web.service
```

Then use the same launcher, profile and `DSH_HOME` with official plugin removal. For the default newly bootstrapped launcher:

```sh
sudo -H /opt/ds-harness-remote/bin/dsh plugin --profile web remove -w ds-harness-remote
```

Use Desktop Plugin management on Desktop. Runtime directories, profiles, device credentials and unit files are not automatically deleted. Windows users can still use official Plugin management or an existing Harness CLI, but no Windows installer is maintained here.

## Download source and validation limits

If the domain is unavailable, replace `https://dsh.r2049.cn/app` with `https://raw.githubusercontent.com/liguobao/ds-harness-remote/main/scripts`.

Smoke checks with mocked downloads/systemctl and temporary target directories are not clean-server installation, production token redemption or reboot acceptance. Verify the service on the target server and confirm the Host is online in a client. Repository updates do not deploy hosted scripts automatically.
