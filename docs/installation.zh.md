# Remote 插件安装指南

[English](installation.md)

安装入口只保留 `scripts/install.sh`，不提供 Windows、独立卸载或 Token 包装脚本。

## DSH 插件页在线更新

DSH 0.2.2 起，**从 npm 安装**的 Remote 可在 **扩展 / 插件管理 → ds-harness-remote** 中检查版本并确认更新。更新由 DSH 官方插件管理器执行；支持热更新的宿主会先停止旧版再安装新版，失败或取消时尝试恢复旧版。恢复也可能失败，请以插件页的最终结果为准；宿主要求重启时按提示重启。

GitHub、本地目录、`file:` 和 `link:` 安装不会出现官方在线更新入口。要改用 npm，在同一 Desktop 的官方 `dsh` 启动器中执行：

```sh
dsh plugin --profile desktop add -w ds-harness-remote@latest
```

Web Host 改用实际启动它的 `dsh`、`DSH_HOME` 和 profile（通常为 `web`）。切换安装来源后按宿主提示重启，再回插件页检查版本；不要删除 profile 或 Remote 凭据目录。

Remote 侧栏的版本徽标仍是更新提示，点击链接打开发布页；实际安装在本机 DSH 插件页完成。更新 Remote 会中断它承载的远程连接，请在运行该插件的本机操作。

## Linux：DSH + 一次性注册 + 开机自启

**Linux 必须以 root 运行。系统服务以 root 运行，Remote Host、Agent 工具和远程终端也具有 root 权限。请仅向可信账号开放此服务器。** 当前不支持通过此安装器配置非 root 服务用户。

### 安装

下载并检查脚本后运行。下面的命令让 Token 在 root Shell 中隐藏输入，不写入命令行参数或 shell 历史：

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh -o install.sh
# 检查下载的脚本内容后执行：
sudo -H bash -c '
  read -r -s -p "一次性 Host 注册 Token: " token; printf "\n"
  DSH_REMOTE_REGISTRATION_TOKEN="$token" bash ./install.sh
'
```

若已在 root Shell 中，可去掉 `sudo -H`。使用仓库版本时，把 `./install.sh` 替换为 `./scripts/install.sh`。仓库更新不代表线上脚本已经部署，请先确认所用脚本包含本轮 Linux 完整安装功能。

脚本执行：

1. 检查已有 `DSH_COMMAND` 或 PATH 中的 DSH；存在则复用，不自动升级它。
2. 找不到 DSH 时，在 `/opt/ds-harness-remote/runtime.*` 中安装官方 Node.js 24.9.0、DSH 与插件管理所需的私有 pnpm 9.15.4。Node.js 归档按[官方校验清单](https://nodejs.org/dist/v24.9.0/SHASUMS256.txt)中的固定 SHA-256 校验。稳定 launcher 为 `/opt/ds-harness-remote/bin/dsh`，重复运行会复用。
3. 使用官方 `dsh plugin` 安装或更新所选 profile 的 Remote，默认 `web` profile 和 npm `latest`。
4. 传入 Token 时，通过既有 Host 注册码接口兑换并保存设备凭据。Token 不写入日志、服务配置或持久设备凭据字段；不是模型 API Key。
5. 检查 profile 确认启用了官方 Web Host 入口，配置 systemd **系统服务**，启用开机自启并启动/重启本安装器管理的匹配实例。无需登录或开启 linger。

脚本不修改系统 Node.js、全局 PATH 或 npm 配置，不通过 apt/yum 等安装系统依赖。首次引导要求 Linux x64/arm64、兼容官方 Node.js 二进制的运行库，以及已有的 `curl`、`tar`、`sha256sum`。自动服务需要 systemd 系统管理器可用；非 systemd 容器可用 `DSH_REMOTE_AUTOSTART=0` 跳过服务配置。

未传 Token 时跳过注册，可随后在 Remote 登录；服务进程运行不等于 Host 已完成账号授权或已经在线。首次启动还可能受网络、端口和模型服务配置影响。

### 查看服务

默认 profile 的服务：

```sh
sudo systemctl status ds-harness-remote-web.service
sudo systemctl is-enabled ds-harness-remote-web.service
```

服务 Web 端口只绑定 `127.0.0.1`。脚本确认的是 systemd 进程状态，不代替客户端上的 Host 在线验收。

### 重复安装和安全边界

Remote 凭据存于 `$DSH_HOME/ds-harness-remote`（默认 `~/.dsh/ds-harness-remote`）。安装器处理凭据时，以及升级后首次启动时，都会在读取或创建凭据前自动迁移旧 `remote` 目录，无需手动迁移命令或重新配对。

迁移前校验 Remote 已知目录结构、设备公私钥配对、信任指纹、凭据设备 ID 和 Server scope 哈希，不能只凭目录名认定归属；未知文件或记录不一致时停止迁移。整体移动保留身份、Server 隔离、Token 和信任记录。

已确认归属的目录若因权限、文件占用或跨文件系统而无法移动，且原目录仍完整、目标目录仍不存在，在凭据树外保存回退记录，本进程和后续进程统一使用原目录，不新建替代身份、不清空授权；无法保存回退记录时停止启动，但不改动凭据。升级/重启时应停止旧 Harness 实例；新旧目录同时存在，或发现锁、符号链接时，迁移停止，不合并、不覆盖凭据。

旧安装器使用 `/opt/dsh-remote` 和 `dsh-remote-<profile>.service`，新版不自动迁移这些名称；安装器发现归属本项目的旧服务仍运行或启用时，会在改包前拒绝继续。按新默认值重装前，先停用旧服务（默认 profile：`sudo systemctl disable --now dsh-remote-web.service`）。旧 `dsh-remote` 设置不再自动导入，重装后请重新配置 Remote。

- 普通更新无需再次提供 Token；一次性 Token 已消费后不能重复使用。
- 已有 Host 凭据时拒绝静默覆盖。换绑账号前，应停止原 Host 并通过官方入口退出登录，再使用新 Token。
- 若已注册成功、随后服务启动失败，凭据仍保留；修复环境后不带 Token 重跑。
- 服务带有规范化 `DSH_HOME` 归属标记。只允许更新匹配 home 的安装器管理服务；不同 home、无标记的旧服务和符号链接均不接管。
- profile 的 Web 能力和服务归属在 Token 兑换之前预检查。`headless`、SDK 和终端类 profile（含 `dsh-tui`）不自动生成 Web 服务；可设置 `DSH_REMOTE_AUTOSTART=0`，自行管理进程。dsh-TUI 集成本身不在本版本内。
- 仅启动/重启归属匹配的管理服务，不自动停止其他 DSH 进程。使用同一 home 的旧前台进程应先手动退出，避免连接抢占或端口冲突。
- 不自动迁移、删除旧服务、runtime 或凭据，不提供自动回滚。引导安装中途失败的私有目录可能保留，便于检查。

## macOS：复用已有 Desktop / CLI

macOS 使用普通用户：

```sh
curl -fsSL https://dsh.r2049.cn/app/install.sh | bash
```

优先使用 `~/Applications` 或 `/Applications` 的 Desktop 官方 launcher，否则 PATH 中的 `dsh`。两者都有时优先 Desktop；都没有才停止，不安装 Desktop、DSH 或 Node.js，不创建服务。

Desktop 默认 `desktop` profile，独立 CLI 默认 `web`，可用 `DSH_COMMAND` / `DSH_PROFILE` 显式选择。Token 注册使用同一安装入口，安装后仍需手动重启所选 Desktop/CLI 实例。不传 Token 时在 Remote 或 `/remote login` 登录。

Desktop 也可打开 **扩展 / 插件管理**，从 npm 安装：

```text
ds-harness-remote@0.6.3
```

普通独立 CLI 不能管理保留的 `desktop` profile，必须使用 Desktop 官方 launcher。

## 参数和环境变量

| 配置 | 含义 |
| --- | --- |
| `DSH_COMMAND` | 已有 launcher 路径；显式指定却找不到时失败，不静默换实例 |
| `DSH_PROFILE` | 所选 profile；独立默认 `web`，Desktop 默认 `desktop` |
| `DSH_HOME` | 保留已有值，注册凭据与运行实例使用同一 home；Linux 通常为 root 的 home 下 `.dsh` |
| `REMOTE_VERSION` | Remote 版本，默认 npm `latest` |
| `INTELLIGENT_UI` | 为 `1` 时同时把 Intelligent UI 安装到同一 profile；默认 `0` |
| `INTELLIGENT_UI_VERSION` | `INTELLIGENT_UI=1` 时的 Intelligent UI 版本，默认 npm `latest` |
| `DSH_VERSION` | Linux 缺少 DSH 时的新安装版本，默认 npm `latest`，不升级已有 DSH |
| `DSH_REMOTE_REGISTRATION_TOKEN` | 一次性 Host 注册 Token；推荐通过隐藏输入传入 |
| `DSH_REMOTE_AUTOSTART=0` | Linux 跳过系统服务配置/启动，仍要求 root |
| `DSH_INSTALL_ROOT` | Linux 私有引导安装根目录，默认 `/opt/ds-harness-remote`，必须是绝对路径 |
| `DSH_SYSTEMD_DIR` | 系统 unit 目录，默认 `/etc/systemd/system`；普通部署不要修改 |

也接受 `bash install.sh --token '<一次性Token>'` 或位置参数，但它们可能出现在进程列表和 shell 历史中。不要使用 shell trace/debug 执行带凭据的命令。Token 无效、过期或已消费时注册明确失败。

## 停用和卸载

先停用 Linux 系统服务（按实际 profile 替换 `web`）：

```sh
sudo systemctl disable --now ds-harness-remote-web.service
```

然后使用同一 launcher、profile 和 `DSH_HOME` 执行官方插件移除命令，例如新引导安装的默认路径：

```sh
sudo -H /opt/ds-harness-remote/bin/dsh plugin --profile web remove -w ds-harness-remote
```

Desktop 使用官方插件管理移除。不会自动删除 runtime、profile、设备凭据或服务 unit。Windows 用户仍可使用官方插件管理或已有 Harness 官方命令，但本仓库不再提供 Windows 安装脚本。

## 下载源与验证范围

域名不可访问时，将 `https://dsh.r2049.cn/app` 换为 `https://raw.githubusercontent.com/liguobao/ds-harness-remote/main/scripts`。

模拟下载、systemctl 和目标目录的烟测不等于干净 Linux 服务器的完整下载安装、真实 Token 兑换或重启自启验收。上线前应在目标服务器检查服务状态，并从客户端确认 Host 在线。本仓库修改不会自动部署线上脚本。
