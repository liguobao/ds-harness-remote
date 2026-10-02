# Self-hosted Server UI

## Overview

仅适用于 `apps/server/web/src`。沿用 `deepseek-harness-server/web/src` 的 React + Ant Design 界面，提供账号密码登录和设备状态。

## Colors

浅色主色为 `#1677ff`，深色主色为 `#4c8dff`。配色及主题变量见 `upstream.css`；`theme.tsx` 复用上游 ThemeProvider，支持系统偏好和手动切换。

## Typography

沿用上游系统字体栈，正文 15px、行高 1.6。

## Layout

登录页沿用上游居中卡片布局；设备页沿用产品页顶栏、页面标题和内容容器。`upstream.css` 保留精选上游原声明，`selfhost.css` 仅作间距及长文本换行适配。

## Components

使用 Ant Design 的密码表单、按钮、Card、Table、Empty、Alert 和状态 Tag。设备表格在窄屏横向滚动。

## 复用约定

沿用上游布局和主题，页面聚焦登录与设备状态。
