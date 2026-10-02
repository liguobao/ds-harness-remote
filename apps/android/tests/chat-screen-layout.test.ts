import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('removes the three composer quick actions and their send handler', () => {
  const source = readFileSync(new URL('../src/screens/chat-screen.tsx', import.meta.url), 'utf8')
  for (const obsolete of ['quickCheckChanges', 'quickCommit', 'quickViewScreenshot', 'runQuickPrompt', 'styles.quickAction']) {
    expect(source).not.toContain(obsolete)
  }
})
