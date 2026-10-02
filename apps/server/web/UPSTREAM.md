# UI 复用来源

来源：`deepseek-harness-server/web/src`（用户提供的本地 Server 仓库）。

- `upstream.css`：原 `styles.css` 的主题、基础样式、登录页、product header、设备列表及响应式规则，保留原声明和值。
- `theme.tsx`：原文件直接复用；`ThemeToggle.tsx` 仅替换国际化文字。
- `LoginPanel.tsx`：沿用原登录页布局和 Ant Design 账号密码表单。
- `DevicesPage.tsx`：原 `AppHeader` product 布局与 `HostsPage` 的标题、Card、Table、Empty、Tag。
- `main.tsx`：原 `App.tsx` 的 Ant Design 主题配置。
- `selfhost.css`：最小版必要间距及长文字换行。
