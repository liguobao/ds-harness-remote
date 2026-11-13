import { applyTuiHost, Config } from 'ds-harness-remote'

export { Config }
export const name = 'ds-harness-remote-tui'

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
]

export function apply(ctx, entry) {
  const loader = ctx.get('loader')
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
  applyTuiHost(ctx, entry)
}
