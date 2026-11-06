import type { Context } from '@deepseek-ai/cordis'
import { applyTuiHost, Config } from '../../plugin/src/index.js'
import type { Config as ConfigShape, EntryConfig } from '../../plugin/src/config.js'

export const name = 'ds-harness-remote-tui'
export { Config }

/** Keep the terminal entry separate from the browser and Desktop Host entry. */
export function apply(ctx: Context, entry: EntryConfig | ConfigShape | undefined = undefined): void {
  // The shared Host builds against Cordis 4.0.5. The TUI uses Cordis 4.1.0.
  applyTuiHost(ctx as unknown as Parameters<typeof applyTuiHost>[0], entry)
}
