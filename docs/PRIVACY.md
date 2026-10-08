# Privacy Policy for DeepSeek Harness Remote

Effective date: August 23, 2026

DeepSeek Harness Remote is a browser extension that opens your linked DeepSeek Harness computers in Remote Web. This policy covers the browser extension.

## Data the extension handles

The extension handles only the data needed to provide its launcher functionality:

- Your Remote Web account identifier.
- An extension-specific device identifier, public key, access token, and refresh token.
- Basic linked-computer metadata returned by Remote Web, including device name, platform, version, online status, and last-seen time.
- Your existing Remote Web authorization token during sign-in. This token is used once to request extension-specific credentials and is not stored by the extension.

The extension does not collect browsing history, page content from other websites, prompts, conversations, source code, or tool output. Its website access is limited to `https://dsh.r2049.cn/*`.

## How data is used

The data is used only to:

- Authorize this browser as a DeepSeek Harness Remote device.
- List your linked computers and show whether they are online.
- Open the selected computer in Remote Web.
- Refresh or revoke the extension's own authorization.

The extension does not sell user data, use it for advertising, or transfer it for purposes unrelated to this functionality.

## Storage and transmission

Extension-specific device data and credentials are stored locally using Chrome extension storage. Requests to Remote Web are sent over HTTPS to `dsh.r2049.cn`.

When you sign out, the extension requests revocation of its device authorization and clears its local identity and credentials. Removing the extension also removes its local extension storage according to Chrome's behavior.

## Contact

For privacy questions or requests, open an issue at:

https://github.com/liguobao/ds-harness-remote/issues

---

# DeepSeek Harness Remote 隐私政策

生效日期：2026 年 8 月 23 日

DeepSeek Harness Remote 是一个用于从 Remote Web 打开已连接电脑的浏览器插件。本政策仅适用于该浏览器插件。

## 插件处理的数据

插件只处理实现入口功能所必需的数据：

- Remote Web 账号标识。
- 插件自己的设备标识、公钥、访问凭证与刷新凭证。
- Remote Web 返回的基础设备信息，包括设备名称、平台、版本、在线状态和最近在线时间。
- 登录过程中已有的 Remote Web 授权凭证。该凭证只用于换取插件自己的设备凭证，不会由插件保存。

插件不会收集浏览记录、其他网站的页面内容、Prompt、对话、源代码或工具输出。插件的网站访问范围仅限 `https://dsh.r2049.cn/*`。

## 数据用途

这些数据只用于：

- 将当前浏览器授权为 DeepSeek Harness Remote 设备。
- 展示已连接的电脑及其在线状态。
- 在 Remote Web 中打开所选电脑。
- 刷新或撤销插件自己的授权。

插件不会出售用户数据，不会将数据用于广告，也不会为与上述功能无关的目的传输数据。

## 存储与传输

插件自己的设备数据和凭证保存在 Chrome 插件本地存储中。访问 Remote Web 的请求通过 HTTPS 发送至 `dsh.r2049.cn`。

退出插件时，插件会请求撤销自己的设备授权，并清理本地身份和凭证。卸载插件后，Chrome 也会按照浏览器行为清理该插件的本地存储。

## 联系方式

如有隐私问题或请求，请在以下地址提交 Issue：

https://github.com/liguobao/ds-harness-remote/issues
