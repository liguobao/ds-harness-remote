# Changelog

## 0.4.12

- Upgrades the DeepSeek Harness `dsh-v0.1.5` compatibility baseline from
  `alpha.1` to `rc.1` across the Plugin, Android, and VS Code Typert clients.
- Extends the DSH peer dependency matrix to `0.1.5-rc.1` while retaining the
  existing Session V3 capability and mixed-generation rejection behavior.
- Advances the Plugin and Android app to `0.4.12` (`versionCode 29`).

## 0.4.11

- Adds experimental DeepSeek Harness `dsh-v0.1.5-alpha.1` support across the
  Desktop Plugin, Android, and VS Code Typert clients.
- Advertises Session V3 Hosts with `harness.remote.v3` and rejects Desktop
  v0.1.2/V3 mixed connections before switching targets or mutating a Workspace.
- Updates the CodeX native projection for Session V3 headers, replacement ranges,
  assistant settlement streams, and strict event validation while retaining the
  `dsh-v0.1.2-alpha.1`–`rc.1` path.
- Narrows DSH peer dependency ranges to versions covered by the compatibility
  matrix and advances the Plugin and Android app to `0.4.11` (`versionCode 28`).

## 0.4.10

- Fixes Web and Desktop Codex approval controls to show Host-confirmed policy,
  require Host confirmation for changes, and preserve the current Thread policy
  when sending prompts or forking.
- Remembers the selected DSH or CodeX workspace tab per Host on Android and
  removes the redundant permission hint below the chat composer.
- Shows one active Desktop transport probe at a time, progressing from the LAN
  cue to P2P during direct negotiation and retaining the actual selected route.
- Aligns Account Authorization schemas and credential validation across the
  Plugin, Android, Browser, and VS Code clients, with shared protocol fixtures
  also consumed by Android tests.
- Advances the Plugin and Android app to `0.4.10` (`versionCode 27`).

## 0.4.9

- Refines the Desktop Remote workspace chooser with selected Host and version
  details in the header, direct Host switching, compact three-item DSH and
  CodeX lists, centered expand actions, backend-specific icons, and
  double-click opening without nested list scrollbars.
- Drives Desktop connection feedback from the Host runtime's real transport
  phases and selected route, and removes the extra simulated workspace-opening
  progress stage before handing control to the native Harness UI.
- Adds DSH and CodeX workspace tabs plus name/path search on Android, and opens
  the first conversation immediately after creating a workspace.
- Advances the Plugin and Android app to `0.4.9` (`versionCode 26`).

## 0.4.8

- Reworks Android workspace creation into one `New workspace` flow. When Codex
  is available, the creation sheet lets users choose DSH or Codex as the
  workspace type before selecting the Host directory.
- Improves Android reply feedback with a visible generating state before the
  first streamed item, activity indicators for active reasoning and running
  tools, and an animated streaming cursor.
- Advances the Plugin and Android app to `0.4.8` (`versionCode 25`).

## 0.4.5

- Fixes a `v0.4.4` Desktop startup regression where the Remote browser client
  could poll `/ds-harness-remote/status` before the local Connection service had
  registered the plugin control route, producing frequent HTTP 405 transport
  failures after upgrade. Desktop activation now waits for Connection again
  while dsh-TUI keeps its connection-less Host startup path.

## 0.4.4

- Fixes Codex permission inheritance so existing Threads can keep the App Server's
  persisted approval and sandbox settings, while explicit Android or Desktop
  permission changes still update the remote Thread before the next turn.
- Restores Android reopen and reconnect handling for active Codex turns by
  preserving `activeTurnId` in paged history and allowing the same trusted phone
  to interrupt a recovered in-flight turn after the connection is replaced.
- Hardens Codex Workspace authority by preferring `project/list`, falling back to
  exact `thread/list.cwd` roots only when needed, and validating descendant
  Workspaces with lexical and `realpath` containment.
- Adds the native dsh-TUI `/remote` flow, including default Host startup when no
  browser connection exists, CLI entrypoints, Tab completion, and refreshed user
  docs for GitHub installation.
- Advances the Plugin and Android app to `0.4.4` (`versionCode 24`).

## 0.4.3

- Adds the default-on Codex Remote domain with a settings toggle to the existing encrypted Plugin channel,
  with a fixed App Server allowlist, `project/list`-backed virtual Workspaces plus exact
  `thread/list.cwd` fallback when no projects are available, real descendant Workspace creation
  guarded by lexical and `realpath` containment, paged
  Thread history, live turn projection, prompts, interrupt, and approvals.
- Reuses the native DSH Workspace, Session, conversation, tool, permission, and
  approval surfaces for the Desktop in-memory projection without writing Codex
  data into DSH stores or logs.
- Extends Android with the same `codex.app.*` capability, including project and
  Thread navigation, paged history, model/reasoning controls, image prompts,
  interrupt, and one-time approvals.
- Preserves CodeX message images through the Desktop virtual Session projection
  and Android chat/history projection so safe PNG, JPEG, WebP, and GIF data
  images render in Remote.
- Adds Protocol v1 conformance fixtures and enforces bounded Control, Relay,
  WebRTC, and encrypted transport frames before payload decoding.
- Advances the Plugin and Android app to `0.4.3` (`versionCode 23`).

## 0.4.2

- Adds DeepSeek Harness `dsh-v0.1.2-alpha.2` compatibility while retaining the
  `dsh-v0.1.2-alpha.1` Typert Remote and `dsh-v0.1.1-rc.2` ApiProxy paths.
- Stops importing the `settingsNamespace` helper removed by Harness alpha.2;
  Settings registration now uses a literal that remains type-compatible with
  rc.2 and alpha.1.
- Preserves alpha.2 `RemoteError` identity across the encrypted Desktop stream
  bridge so Host failure codes are not collapsed to `gateway/internal` by the
  local Harness mux.
- Moves the compatibility build matrix to the alpha.2 Gateway, Client, Settings,
  locale, sidebar, slot, and settings UI packages and adds a Bundle regression
  check for the removed Settings export.
- Corrects prerelease peer ranges so strict npm resolution accepts both the
  claimed `0.1.1-rc.2` and `0.1.2-alpha.x` package families, without asking
  alpha installs to resolve the retired rc.2-only ApiProxy package.
- Advances the Plugin and Android app to `0.4.2` (`versionCode 22`).

## 0.4.1

- Replaces the withdrawn `v0.4.0` Release and tag so the alpha.1 Remote Client,
  Host support, and follow-up transport fixes ship as one supported version.
- Adds DeepSeek Harness `dsh-v0.1.2-alpha.1` Desktop support through the
  official Typert Remote Gateway carrier while retaining the
  `dsh-v0.1.1-rc.2` ApiProxy path.
- Adds encrypted Host capability discovery, alpha unary/stream/event routing,
  bounded large-envelope transfers, and a fixed fail-closed endpoint allowlist.
- Keeps an rc.2 Client compatible with older rc.2 Hosts through the legacy
  capability fallback, while rejecting mixed alpha.1/rc.2 Desktop generations
  before native UI switching or Workspace mutation.
- Fixes Host transport selection ordering so `transport.selected` cannot race
  the Noise handshake and bind the two peers to different WebRTC/Relay paths.
- Restores native `@roamhq/wrtc` loading from pnpm-linked DSH profiles on
  Windows, macOS, and Linux, with additional connection diagnostics.
- Correctly identifies private, address-hidden `host`/`prflx` candidate pairs
  as LAN while retaining public peer-reflexive paths as P2P.
- Keeps alpha.1 `dynamicCordisRunner/*` calls local instead of forwarding local
  UI/runtime loading to the selected Host.
- Refreshes Android connection progress, selected-route highlighting, compiled
  workspace verification, and client version metadata.
- Advances the Plugin and Android app to `0.4.1` (`versionCode 21`).

## 0.3.36

- Replaces `v0.3.35`; the previous Release and tag were withdrawn so recent
  connection-progress, login, Android, and remote File Viewer updates ship
  together.
- Fixes desktop and Android Remote connection progress so direct-path probing
  shows `LAN -> P2P` and finishes with the actual selected transport.
- Fixes the plugin QR login completion race and adds a refresh action for
  desktop Remote Hosts.
- Raises remote File Viewer Save As to 1 GiB on LAN/P2P while keeping TURN,
  Relay, disconnected, and unknown routes at 100 MiB.
- Refreshes Android connection transport labels and advances the Plugin and
  Android app to `0.3.36` (`versionCode 19`).

## 0.3.35

- Fixes desktop Remote connection progress so it only shows the first active
  probe group. Automatic connections now show `LAN -> P2P` while probing direct
  paths and finish with the actual selected transport, such as `Using P2P`,
  instead of advancing to TURN on a timer.
- Applies the same progress-route fix to the Android connection screen while
  keeping the full transport preference order for real negotiation and Host
  control-plane metadata.
- Advances the Plugin and Android app to `0.3.35` (`versionCode 18`).

## 0.3.34

- Fixes DSH Desktop startup after upgrading from legacy `dsh-remote` installs
  by moving the browser locale namespace to the canonical
  `ds-harness-remote` id.
- Adds startup migration for legacy loader entries named `dsh-remote` or
  `@dsh-remote/plugin`, disabling them once the canonical plugin is running.
- Adds a client singleton guard so duplicate loader entries cannot register
  duplicate browser contributions in one window.
- Advances the Plugin and Android app to `0.3.34` (`versionCode 17`).

## 0.3.33

- Uses an isolated native WebRTC helper under Electron so DSH Desktop can use
  the native Node RTC backend without loading the addon inside the signed app
  process.
- Prefers direct ICE before TURN/Relay and keeps selected candidate-pair
  telemetry in the desktop connection details.
- Fixes desktop Remote progress so the final route reflects the actual
  connected transport, such as `P2P`, instead of always ending on Relay.
- Advances the Plugin to `0.3.33`; Android remains at `0.3.32`
  (`versionCode 16`).

## 0.3.32

- Keeps the desktop Remote Host list showing the Harness version by sending
  `harnessVersion` during Host device registration as well as the control
  `hello` frame.
- Moves the Remote account sign-out action next to the current device name in
  the desktop Remote workspace window.
- Unifies the DSH plugin package, Cordis instance, settings namespace, and
  client module ids on `ds-harness-remote`.
- Advances the Plugin and Android app to `0.3.32` (`versionCode 16`).

## 0.3.31

- Shows the Remote Client connection probe order during Host connection, including LAN, P2P, TURN, and Relay steps in the desktop progress UI.
- Adds the preferred transport order to the desktop connection details panel with localized labels.
- Shows the same probe order on Android connection progress and device connection information screens.
- Gates remote File Viewer browser-side Save As by route: LAN, P2P, and TURN are allowed, while Relay and disconnected routes stay disabled.
- Advances the Plugin and Android app to `0.3.31` (`versionCode 15`).

## 0.3.30

- Lets authenticated Remote clients configure every settings namespace
  currently registered by the Host through the official Harness ApiProxy,
  including plugin settings and global credential references.
- Keeps configuration writes bounded and fail-closed: unknown namespaces are
  rejected, credential values remain write-only, and Host-local
  `settings.openDocument` stays unavailable remotely.
- Adds remote model-provider configuration and draft endpoint discovery while
  sanitizing discovery failures so submitted keys and endpoints cannot be
  echoed back through adapter errors.
- Adds a lightweight Chrome/Edge MV3 launcher that exchanges existing Web
  authorization for isolated Browser credentials, lists online Hosts, and
  opens the selected Host in Remote Web.
- Hardens VS Code disconnect and sign-out state, including serialized auth
  transitions and revocation with the latest rotated device credentials.
- Makes pull-request file inspection fail closed and limits Android APK builds
  to relevant changes.
- Advances the Plugin and Android app to `0.3.30` (`versionCode 14`).

## 0.3.29

- Keeps the Android conversation smooth while a reply streams: scrolling now
  follows streaming text at a throttled, non-animated cadence, and memoized
  chat rows stop unchanged messages from re-rendering on every delta, so back
  navigation and the keyboard stay responsive during long replies.
- Makes the Android workspace folder picker scrollable so deep project
  directories can be browsed, and removes the workspace subtitle for a
  cleaner header.
- Shows the Harness and plugin versions next to each Android device row
  (platform + DSH version + plugin version) and shortens the Windows label to
  `Win`.
- Advances the Android app to `0.3.29` (`versionCode 13`).

## 0.3.28

- Redesigns the Android device flow with a dedicated connection-progress page,
  clearer device/workspace navigation, a refreshed startup screen, and separate
  More, Settings, and About destinations.
- Adds in-app update checks with APK download/install handoff and progress
  feedback from the Android More screen.
- Renders reasoning as a compact, collapsed disclosure while it streams and
  after completion, tightens tool activity spacing, and fixes composer sizing
  when the Android keyboard opens or closes.
- Adds an offline refresh action to the conversation header. It reconnects the
  secure channel, reloads the current session baseline, and resumes in place
  without leaving the conversation.
- Aligns the Android app version with the GitHub Release at `0.3.28` while
  advancing its Android install sequence to `versionCode 12`, so in-app update
  comparisons remain accurate.

## 0.3.27

- Adds English and Simplified Chinese Android interfaces with a persistent
  in-app language selector and an option to follow Android's current locale.
- Localizes Android screens, status labels, dates, validation, and client-side
  connection errors, and declares both locales to Android's native app settings.
- Adds current Android device-list and image-prompt screenshots.
- Updates the Android app to `0.3.11` (`versionCode 11`).

`v0.3.27` supersedes `v0.3.26`; the previous Release and tag were withdrawn so
the Android localization and preceding fixes ship in one consolidated release.

## 0.3.26

- Adds an Android About & Updates section with the installed app/build version,
  the full open-source repository URL, and the latest GitHub Release URL.
- Keeps plugin-injected instructions and other model-facing context out of the
  Android transcript by requiring the authoritative human `source.kind = user`
  marker for both historical and live `user/message` events.
- Updates the Android app to `0.3.10` (`versionCode 10`).

`0.3.25` was withdrawn before `0.3.26` because
Android could display plugin-injected model context as user conversation rows.

## 0.3.25

- Adds Android photo-picker image prompts with previews, Host-projected image
  limit checks, and bounded ApiProxy transfer for large encrypted requests.
- Keeps image-only prompts visible in Android chat history and preserves local
  previews while the native user event reconciles.
- Splits the Android adaptive icon into a transparent foreground mark and a
  system-masked background, removing the nested border on launcher icons.

## 0.3.24

- Adapts the Remote ApiProxy bridge to DeepSeek Harness `dsh-v0.1.1-rc.2`
  image prompts and Host-side image preprocessing / Files API reuse.
- Allows the native read-only `session.attachment` lookup so sent and
  historical session images can render on the Remote Client.
- Adds bounded, ordered, per-connection chunk transport for large native
  ApiProxy requests and responses without raising the 4 MiB secure-message
  limit or exposing a separate upload/filesystem API.

## 0.3.23

- Adds progress details while the DSH Client connects to a remote Host and
  opens a remote workspace.
- Verifies installation and plugin loading against DeepSeek Harness
  `dsh-v0.1.1-rc.1`.
- Updates local DSH development peers to `0.1.1-rc.1` while keeping the
  published peer range compatible with older DSH builds.

## 0.3.22

- Adds provider-aware GitHub and Zhihu QR sign-in while keeping password
  sign-in available.
- Uses version tags as GitHub Release titles.

## 0.3.21

- Opens the workspace selected in the Remote picker instead of leaving the
  local workspace active.
- Includes the latest Android connection and chat stability fixes and
  deterministic client RPC termination errors.

## 0.3.19

- Namespaces the plugin's loopback Web RPC route as `/ds-harness-remote` so it can run
  alongside Remote Web UI plugins that own the public `/remote` route.

## 0.3.18

- Restores compatibility with legacy `0.3.15` Hosts: Remote workspaces and
  sessions continue to load, while the unsupported remote command catalog
  degrades to an empty compatibility catalog.
- Enables remote file viewing only when the selected Host version supports
  `fileviewer.read.v1`; legacy and unknown Hosts keep the provider disabled.
- Adds bounded, read-only remote file preview through `dsh-file-viewer` for
  compatible Hosts. Writes, uploads, execution, and `openExternal` remain
  unavailable.
- Adds detailed LAN/P2P/TURN/Relay connection-path diagnostics to the Remote
  header.

`0.3.17` was withdrawn because its Client could forward `commands.list` and
register the remote file provider against older Hosts without a compatibility
fallback.
