# Android Intelligent UI integration (optional) — Issue #124

The remote client projects a **successfully settled** DSH `ui_render`, `ui_patch`, `ui_render_widget`, and `ui_compose` into an isolated, versioned UI Artifact (Host + Session + uiId). Tool summaries are never used as UI definitions. Failed/incomplete/stale patches do not mutate the last successful UI. Only the latest complete version appears next to the reply; the original ToolActivity text is unchanged. Composed answers (`kind: "composition"`) order Markdown, Catalog, and Widget blocks; `ui_patch` targets inside a composition address individual catalog blocks via `<compositionId>#<blockId>` with independent block versioning.

## Enable the offline renderer

The client does not ship or require this unrelated DSH plugin by default. First build the portable renderer in `deepseek-harness-intelligent-ui` (Issue #22):
```sh
npm install
npm run build:renderer
```
From the Remote repository root:
```sh
export DSH_INTELLIGENT_UI_RENDERER_BUNDLE=/absolute/path/to/deepseek-harness-intelligent-ui/renderer/renderer.js
pnpm --filter @dsh-remote/android run build:renderers
pnpm --filter @dsh-remote/android run check
pnpm --filter @dsh-remote/android run android
```
For a future npm release that includes `renderer/renderer.js`, alternatively install `deepseek-harness-intelligent-ui` into the **Android build workspace**; the `build-intelligent-ui.mjs` script discovers the package export automatically. It builds the JS into a TypeScript string module at build time; no network or remote eval/bootstrap is required when the app runs. Rebuild the Android app after changing the renderer. Without the optional bundle the card explicitly falls back, and generated Widget code never executes.

## Session security

The WebView top page is locally authored and CSP locked; never interpolate Host HTML into the top page. Arbitrary Widget JavaScript remains inside the upstream renderer's opaque-origin sandbox. Android validates a per-card nonce, scopes the action to the currently connected Host and Session, enforces a message length/rate limit, and **requires native confirmation** for every model-directed action, including buttons and forms. An unconfirmed send is reported as such; no automatic retry occurs. The only exposed action is the existing store `sendMessage` / Session Prompt path. A native navigation denylist prevents generated UI links from opening uncontrolled in the WebView.

Host tool event metadata (especially `meta.ok` and `meta.ui` for patches) must survive `session.history` and mux unmodified. Pending target-device checks are tracked in [TODO](TODO.md).

A successful patch updates the original UI card in place (same uiId/React/WebView instance while mounted); the later Turn shows a version pointer rather than remounting the controls. Android virtualization can still unmount an off-screen card, so purely local input preferences are not a durable cross-device contract.

## 固定 Renderer 来源与升级流程

为避免 CI/Release 依赖可变开发分支，构建时检出经审核的上游提交，并在打包前分别校验 Git commit 和 Renderer blob SHA：

- 上游仓库：`dreamfarer-space/deepseek-harness-intelligent-ui`
- 审核提交：`f3735efffd823f8c34817f4e8554743ac3276225`（已合并的 Intelligent UI PR #82 合并提交，支持多语言本地化、HTML 转义清洗、新版 Table 数据网格与详细错误回显）
- `renderer/renderer.js` Git blob：`ebac4a4c2199383458d4e1fa2121be0e6043c5c0`

更换 Renderer 时需一起更新两个工作流中的固定提交和校验值，在发布前完成新的构建回归；此提交已进入上游主分支。未经审核不可改回浮动 branch/tag。

本地开发仍允许不安装 Renderer，并向用户显示安全降级卡片；**GitHub CI / Release 的 Android APK 是启用 Renderer 的严格构建变体**。Node VM 中验证 Renderer 入口、Hermes 打包成功，不等于真机 WebView 或 Host → Android 双向交互验证。

## Android action boundary

Android overrides Host policy with `allowNetwork: false`, empty CDN and link-origin lists. The parent CSP disallows external script, style, image and font downloads; widgets that need CDN libraries are unsupported in this offline variant. All navigations pass through the native allowlist before Android can open an external browser.

Native bridge messages are length-limited before parsing and require the page nonce. Positive increasing message IDs are consumed once, including requests rejected while busy or throttled. Native confirmation is one-shot; disconnect, leaving the Host/Session, page reload/error and unmount revoke pending confirmation. A late callback or delivery completion cannot send or reply into a replacement page. No automatic retry is performed after unconfirmed delivery.

## Integration after the Android module split

`chat-screen.tsx` projects successful tool metadata and assigns each card to a unique
`ChatSection.key`. `screens/chat/messages.tsx` owns the card, update pointer, and
unavailable-result hint outside the foldable activity list. Patches retain the
original card key while its section remains mounted.

The action bridge continues to call the public store `sendMessage` action, now
implemented by `state/prompt-actions.ts`. It does not duplicate or replace the
connection, session, prompt, or event actions and their stale-operation guards.
