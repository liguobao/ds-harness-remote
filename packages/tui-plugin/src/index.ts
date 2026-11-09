import type { Context } from '@deepseek-ai/cordis'
import { applyTuiHost, Config } from '../../plugin/src/index.js'
import type { Config as ConfigShape, EntryConfig } from '../../plugin/src/config.js'

export const name = 'ds-harness-remote-tui'
export { Config }

const requiredHostApiPackages = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-file-upload',
  '@deepseek-ai/dsh-session-log-export',
  '@deepseek-ai/dsh-session-reference',
  '@deepseek-ai/dsh-session-stats',
  '@deepseek-ai/dsh-session-turn-outline',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-api-job-controller',
  '@deepseek-ai/dsh-api-terminal-controller',
  '@deepseek-ai/dsh-api-workspace-files',
  '@deepseek-ai/dsh-api-account-controller',
  '@deepseek-ai/dsh-api-settings-controller',
  '@deepseek-ai/dsh-api-workspace-controller',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-workspace-changes',
] as const

/** Keep the terminal entry separate from the browser and Desktop Host entry. */
export function apply(ctx: Context, entry: EntryConfig | ConfigShape | undefined = undefined): void {
  const loader = ctx.get('loader') as {
    entries?: () => Iterable<{ options: { name?: string }; disabled: boolean }>
  } | undefined
  if (typeof loader?.entries !== 'function') {
    throw new Error('dsh-TUI Remote requires the official DSH profile loader.')
  }
  const available = new Set(Array.from(loader.entries())
    .filter(item => !item.disabled)
    .map(item => item.options.name))
  const missing = requiredHostApiPackages.filter(packageName => !available.has(packageName))
  if (missing.length > 0) {
    throw new Error(`dsh-TUI Remote Host API packages are missing or disabled: ${missing.join(', ')}`)
  }
  // The package builds can resolve separate Cordis type instances.
  applyTuiHost(ctx as unknown as Parameters<typeof applyTuiHost>[0], entry)
}
