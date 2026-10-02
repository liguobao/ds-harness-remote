# DSH Remote Design System

## Intent

The physical scene is a developer checking a long-running agent from a phone in a dim train carriage: information must be legible, controls must be deliberate, and connectivity must never be ambiguous. The color strategy is restrained; a dark moss primary carries trust and continuity, while blue is reserved for live connection and action state.

## Color

The source tokens use OKLCH values. React Native runtime colors are generated sRGB equivalents of these committed tokens.

| Role | Token | Use |
| --- | --- | --- |
| Background | `oklch(1 0 0)` | Primary canvas |
| Surface | `oklch(0.972 0.004 120)` | Grouped rows and secondary controls |
| Ink | `oklch(0.20 0.025 120)` | Primary text; at least 7:1 on background |
| Muted | `oklch(0.47 0.022 120)` | Secondary text; at least 4.5:1 on background |
| Primary | `oklch(0.30 0.071 120)` | Main actions, selected navigation, brand mark |
| Accent | `oklch(0.61 0.15 245)` | Connected state, links, streaming state |
| Success | `oklch(0.53 0.13 145)` | Online and allowed states |
| Warning | `oklch(0.72 0.15 75)` | Permission attention and degraded transport |
| Danger | `oklch(0.55 0.18 25)` | Deny, destructive actions, hard failures |

Color never carries status alone. Every status includes a label and, where useful, an icon or shape.

## Typography

Use the Android system sans family. The compact scale is 12, 14, 16, 18, 24, and 32sp with weights 400, 500, 600, and 700. Body copy defaults to 16sp with a 24sp line height. Code, commands, and fingerprints use the platform monospace family. Text respects system font scaling.

## Shape and Spacing

Use a 4dp base grid. Screen gutters are 20dp; common vertical spacing is 8, 12, 16, 24, and 32dp. Controls have a minimum 48dp hit area. Inputs and primary buttons use 12dp corners; grouped surfaces use 16dp; status chips are pill-shaped. Depth comes from surface contrast, not decorative shadows.

## Components

- Top bar: back affordance, concise title, and labeled trailing actions; allow a two-line title when trailing actions leave little width on narrow screens.
- Device row: identity, status label, last-seen context, and transport; the entire row is one target.
- Session row: title, workspace, running state, updated time; no nested cards.
- Composer: multiline input, explicit send/stop action, and keyboard-safe bottom inset.
- Permission sheet: command or tool detail first, scope explanation second, then Allow once and Deny. Deny remains visually distinct and no option is preselected. A session-wide grant must not appear unless a future negotiated protocol capability maps to an explicit Harness permission outcome.
- Status banner: inline connection feedback with a concrete next action for errors.
- Skeleton: stable content-shaped placeholders for initial loading; spinner only for an action already initiated by the user.

### Android session tools

Harness chat exposes Files and Terminal as labeled icon actions in the conversation top bar; they are disabled while offline and absent from CodeX sessions. Each opens a full-screen modal with its own top bar (back plus the tool's primary action), safe-area insets, and the shared keyboard inset. Keep tool actions within the existing 48dp minimum touch-target pattern and retain the surrounding theme.

Files uses directory-first rows, a visible path, and explicit back and refresh actions in the panel header; back returns from a file to its directory and closes the panel only at the workspace root. Text previews are selectable, monospace, read-only, and paginated, with line ranges and disabled pagination at the boundaries. Images are contained within the available viewport. PDF and Host-converted Office documents use a local isolated renderer with page and zoom controls; missing fonts, unsupported formats, and mobile size limits are explicit states. Empty, truncated, loading, and retry states belong beside the affected content. PDF canvas text selection is not available; the bounded accessibility text overlay still needs TalkBack verification.

Terminal keeps native controls around a locally bundled xterm WebView and creates a new terminal only from the labeled ＋ action in its header; opening the panel lists existing terminals without creating one. Label the WebView, enable xterm screen-reader mode, and provide labeled keyboard and special-key controls. Show connecting, exited, and unavailable-input states in text; disable input controls without input ownership and confirm terminal closure. The terminal canvas has its own dark palette without changing the app theme.

The permission preset picker keeps the current selection visible, pairs its selected state with a checkmark, and shows loading or retry feedback when fetching available presets. Keep this selector distinct from individual Allow once / Deny decisions.

These patterns describe the source implementation; native-device appearance, keyboard behavior, and screen-reader operation still require verification.

## Layout and Navigation

The Android MVP uses a shallow stack: Setup → Devices → Device → Sessions → Chat, with Settings reachable from Devices. Pairing is a focused flow opened from Devices. Preserve the selected device and session on reconnect. Avoid bottom navigation until there are multiple durable top-level destinations.

## Motion

State transitions last 150–220ms and use ease-out. Streaming uses a static cursor plus content updates rather than looping decoration. Respect reduced-motion settings; navigation and banners remain understandable with motion disabled.

## Voice

Use short, concrete labels: “Connect”, “Pair device”, “Allow once”, “Try again”. Explain failures in user terms and include a recovery step. Never expose raw `undefined`, HTTP status text, or implementation exception messages as the primary copy.
