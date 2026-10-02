# Official Harness menu icons

The Android `@` reference and `/` command/skill menus use original SVG geometry from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), source revision `4878cdabd87d4041bdaff61d04c966883b9fd07a`.

## Source mapping

All paths and path attributes are copied unchanged into `apps/android/src/ui/official-menu-icon-data.ts`. `official-menu-icons.tsx` adapts them to react-native-svg, replacing SVG currentColor with the supplied menu color. Display size is 16; Regular stroke width is 1. Original viewBoxes are preserved (skill: 17 × 17; other glyphs: 16 × 16), as are fill-only geometry, compact opacity and join/miter attributes.

Paths below are relative to the upstream repository:

| Menu entry | Official artwork | Geometry source |
| --- | --- | --- |
| @ file (all extensions) | BrowseOutlineArtwork | packages/client/ui-primitives/src/icons/shared-artwork.tsx |
| @ folder | FolderCloseArtwork | packages/client/ui-primitives/src/icons/shared-artwork.tsx |
| @ session | ChatLinesOutlineArtwork | packages/client/ui-primitives/src/icons/shared-artwork.tsx |
| /file | IconPaperclipOutlineRegular | packages/client/ui-primitives/src/icons/index.tsx |
| /goal | IconGoalOutlineRegular | packages/client/ui-primitives/src/icons/index.tsx |
| /plan | IconPlanOutlineRegular (delegates to IconListPenOutlineArtwork) | packages/client/ui-primitives/src/icons/index.tsx |
| /feedback | IconPaperPlaneOutlineRegular | packages/client/ui-primitives/src/icons/index.tsx |
| /compact | IconCompactOutlineRegular | packages/client/ui-primitives/src/icons/index.tsx |
| /permission | PermissionIconFullAccessRegular / FullAccessArtwork | packages/client/ui-primitives/src/PermissionIcon.tsx |
| /model | IconDataOutlineRegular | packages/client/ui-primitives/src/icons/index.tsx |
| /export | IconDownloadOutlineRegular | packages/client/ui-primitives/src/icons/index.tsx |
| /skill rows | IconSkillOutlineRegular | packages/client/ui-primitives/src/icons/index.tsx |

Official menu bindings are in `packages/client/ui-input-trigger/src/client/MenuView.tsx`, `packages/client/ui-primitives/src/ReferenceIcon.tsx`, `packages/client/ui-commands/src/client/presentation.ts`, `packages/client/ui-conversation/src/client/apply.ts`, and `packages/client/ui-model-selection/src/client/index.ts`.

`apps/android/tests/official-menu-icons.test.ts` contains immutable SHA-256 golden values extracted from the original SVG viewBoxes, Regular weights, paths and attributes, plus menu mapping and adapter assertions. Tests do not load React Native native modules or require an upstream checkout.

## Upstream license (complete)

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
