import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/ui/mention-popover.tsx', import.meta.url), 'utf8')

describe('consistent conversation-reference menu background', () => {
  it('uses the conversation heading background for the whole menu', () => {
    const heading = source.match(/groupHeader:\s*\{\s*backgroundColor:\s*([^,]+)/)?.[1]
    const surface = source.match(/popover:\s*\{[\s\S]*?backgroundColor:\s*([^,]+)/)?.[1]
    expect(heading).toBe('colors.background')
    expect(surface).toBe(heading)
  })
  it('does not give a highlighted file row a different background', () => {
    expect(source.match(/rowActive:\s*\{\s*backgroundColor:\s*([^,}]+)/)?.[1]?.trim()).toBe('colors.background')
  })
})
