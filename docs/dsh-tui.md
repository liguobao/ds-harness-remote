# 在 dsh-TUI 中使用 DSH Remote

DSH Remote 已适配 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)。将插件安装到
`dsh-tui` profile 后，可以直接在 TUI 中使用 `/remote`，为本机 Harness 开启远程访问权限。

> 兼容边界（2026-11-01）：Remote 插件当前按 DeepSeek Harness `dsh-v0.2.1-rc.5`
> 做开发基线验证；当前公开 dsh-TUI `0.17.0` 的主适配线仍是 DSH `0.2.1-rc.3`。
> 因此 `dsh-TUI 0.17.0 + DSH 0.2.1-rc.5` 尚未列为已验收组合。请优先使用
> dsh-TUI 发布说明中对应的 DSH 版本，或等待 dsh-TUI 明确发布 `rc.5` 适配。
> Remote 插件的 TUI 命令、补全树和场景服务已做可选降级，缺少后两者不会阻塞 Host 启动。

## 支持版本

| DSH 版本 | 需要挂载的官方组件 |
| --- | --- |
| `dsh-v0.1.2-alpha.1`–`rc.1` | `@deepseek-ai/dsh-api-gateway` 提供的 Typert Remote Gateway |
| `dsh-v0.1.5-rc.1` | `@deepseek-ai/dsh-api-gateway` 提供的 Session V3 Typert Remote Gateway |
| `dsh-v0.1.6-alpha.1` | `@deepseek-ai/dsh-api-gateway` 提供的 Session V3 Typert Remote Gateway（与 v0.1.5 rc.1 同一个 Session V3 profile） |
| `dsh-v0.2.0-rc.2` | `@deepseek-ai/dsh-api-gateway` 提供的 Session V3 Typert Remote Gateway（沿用同一 carrier） |
| `dsh-v0.2.1-rc.5` | Remote Plugin 已按该版本验证；当前 dsh-TUI 公开主适配线尚未覆盖该版本 |

## 1. 安装插件

先按照 [dsh-TUI 项目说明](https://github.com/ccch1mneyyy/dsh-TUI) 完成安装，再将 DSH Remote
安装到同一个 profile：

```sh
dsh plugin --profile dsh-tui add -w ds-harness-remote@0.6.0
```

## 2. 启动前挂载 Remote carrier

启动 dsh-TUI 前，需要在 `dsh-tui` profile 中挂载与当前 DSH 版本对应的官方 Remote carrier。
它负责让远程客户端访问 Workspace、Session 和 Prompt。

- 使用 `dsh-v0.1.2-alpha.1`–`rc.1` 时，挂载官方 Typert Remote Gateway。
- 使用 `dsh-v0.1.5-rc.1` 时，挂载同版本官方 Typert Remote Gateway；两端 Desktop 必须都是 Session V3。
- 使用 `dsh-v0.1.6-alpha.1` 时，同样挂载同版本官方 Typert Remote Gateway；它沿用 v0.1.5 的 Session V3 profile。
- 使用 `dsh-v0.2.0-rc.2` 时，挂载 `0.2.0-rc.2` 官方 Typert Remote Gateway；Remote 仍使用 Session V3 carrier。

如果没有挂载对应组件，扫码登录和状态查询仍然可用，但远程客户端无法进入 Workspace。

Harness `0.1.1-rc.2` ApiProxy 支持已移除，请升级到提供 Typert Remote 的 Harness。

### v0.1.2 alpha.1–rc.1 / v0.1.5 rc.1

确认 `dsh-tui` profile 已挂载与当前 DSH 版本匹配的 `@deepseek-ai/dsh-api-gateway`，并提供
`typertGateway` 服务。使用已经包含该 Gateway 的 profile 时，不需要额外挂载旧 ApiProxy。

## 3. 启动 dsh-TUI

如果官方 Remote carrier 已包含在 profile 中，正常启动即可：

```sh
dsh-tui
```

dsh-TUI 运行期间，本机 Harness 会保持可远程访问。

## 4. 扫码登录

启动后输入以下任一命令：

```text
/remote login              # 默认使用知乎
/remote login zhihu
/remote login github
```

TUI 会显示二维码，并在二维码下方显示可点击的授权 URL：

1. 使用知乎或 GitHub 完成扫码授权，也可以直接点击 URL 在浏览器中打开。
2. 等待 TUI 显示登录成功。
3. 按 `Esc` 或 `q` 返回会话界面。
4. 输入 `/remote status` 确认连接状态。

## 5. 查看状态

`/remote` 和 `/remote status` 都会打开状态界面：

```text
/remote
/remote status
```

准备就绪时，重点确认以下三项：

- `Authorization` 显示已登录。
- `Server connection` 显示 `online`。
- `Harness Remote API` 显示 `available (Typert Remote)` 或 `available (Typert Remote Session V3)`。

状态界面还会显示当前设备、已连接的 Remote Client 数量和 Codex Remote 状态。按 `Esc` 或 `q`
即可返回。

## 6. 从另一台设备连接

保持 dsh-TUI 运行，然后在另一台设备上登录同一个 DSH Remote 账号：

1. 在设备列表中选择这台运行 dsh-TUI 的电脑。
2. 选择需要访问的 Workspace。
3. 打开或创建 Session，即可继续发送 Prompt。

可以使用安装了 DSH Remote 的 DSH Desktop、Android Client 或 Remote Web 连接。

## 退出登录

在 dsh-TUI 中运行：

```text
/remote logout
```

退出后，这台电脑将不再以当前设备身份提供远程访问。下次使用时需要重新扫码授权。

## 可选：在启动前登录

如果希望先在普通终端中完成登录，可以使用配套 CLI：

```sh
npm install -g ds-harness-remote@0.6.0
ds-harness-remote login github
ds-harness-remote status
dsh-tui
```

CLI 同样支持 `login zhihu`、`status` 和 `logout`。登录或退出后需要重启 dsh-TUI。

## 常见问题

### `The Host does not provide a compatible Harness Remote API`

当前 profile 没有挂载与 DSH 版本匹配的官方 Remote carrier：

- v0.1.2 alpha.1–rc.1 检查 Typert Remote Gateway 和 `typertGateway` 服务。
- v0.1.5 rc.1、v0.1.6 alpha.1 与 v0.2.0 rc.1 除检查 `typertGateway` 外，还需确认 Host 与 Desktop Client 都使用 Session V3。

Host 与 Desktop Client 还需要使用同一代 Harness carrier 和 Session 格式；旧 Typert Client 无法连接 Session V3 Host；Session V3 Client 可连接兼容的旧 Typert Host。

### 找不到 `/remote`

确认 DSH Remote 安装在 `dsh-tui` profile，而不是只安装在 `web` profile，然后完整重启
dsh-TUI。

### 二维码显示不完整或无法扫描

放大终端窗口后重新运行 `/remote login`。也可以直接点击二维码下方的授权 URL 完成登录。

### 登录后设备仍不在线

运行 `/remote status`，确认 `Authorization` 已登录且 `Server connection` 为 `online`。同时保持
dsh-TUI 进程运行。
