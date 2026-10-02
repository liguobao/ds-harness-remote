import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const golden = {
  "referenceFile": "37a560e6239edb6e04676f77c92b05f951af44adec186e16e0b119362b4d9ed1",
  "referenceFolder": "cd49cae25e9c06e13cdd8a8ade1ff6fce6d73c5376556eb55a6c6c8885beb471",
  "referenceSession": "8cb3315f15936e1a8533fe97274db50239b2c58084d151a0273b96699885afa1",
  "file": "ea67c745dbabfd0bb3b4476b84fd95fbc9390801220b2ca6632a2532530cd8b1",
  "goal": "48259cc649be4de99e870edc40b5936d0e8d1aa0882f3c1a29e019fedc426527",
  "plan": "6f22d05cf775a417899eec4504cd2243466d7ad03094a095e9cf0ea12099a72a",
  "feedback": "dceb2479ef6f67446d69c7a974f354c0b5f8257b0ba770ba1dfb44ad1e338411",
  "compact": "47da5695848c04402e953cec27c45d26fcc647d4e74565a03de6b25ff9d5e8bf",
  "permission": "65da5da1cc377ccc158dd1477fad2607b3dd6553c4a0ce3e978316e2147e1a98",
  "model": "514c99db92575cc46fe7828dbfbd07875f42c7f1d6e46487d0e115b628f5868a",
  "export": "c4ee234c9a5baaf593a5867e2c4f4cc9cee9be7f1e409031c8593a2b90447215",
  "skill": "6741fc76907275604887c447a6af503119b5d14296a15bdacdcc8f1434442f92",
  "newChat": "bbc3cb51c7d7dbb55f30ff296890a8c87bb486776bda45f208c3fefa0de21876",
  "sliders": "0301d4825dacc3d99897f73ad27884c480413bd94cf5edbd8b2e72deb23eef37",
  "edit": "e2e92d452a5a9d50fd624fd5eb341cf8df6a3e4e56a5b601846e7d71de450650"
} as const
const specUrl = new URL('../src/ui/official-menu-icon-data.ts', import.meta.url)

describe('official Harness menu artwork', () => {
  it('uses official glyphs for all slash, skill and reference rows without extension guesses', () => {
    const screen = readFileSync(new URL('../src/screens/chat-screen.tsx', import.meta.url), 'utf8')
    for (const key of ['file', 'goal', 'plan', 'feedback', 'compact', 'permission', 'model', 'export']) {
      expect(screen).toContain(`id: '${key}', icon: OfficialMenuIcons.${key}`)
    }
    expect(screen).toContain('icon: OfficialMenuIcons.skill')
    expect(screen).toContain('icon: OfficialMenuIcons.referenceSession')
    expect(screen).toContain('isDir ? OfficialMenuIcons.referenceFolder : OfficialMenuIcons.referenceFile')
    expect(screen).not.toContain('fileIconFor(')
  })

  it('adapts SVG sizes and color without replacing geometry or opacity', () => {
    const adapterUrl = new URL('../src/ui/official-menu-icons.tsx', import.meta.url)
    expect(existsSync(adapterUrl), 'native SVG adapter must exist').toBe(true)
    const adapter = readFileSync(adapterUrl, 'utf8')
    expect(adapter).toContain('size = 16')
    expect(adapter).toContain('viewBox={artwork.viewBox}')
    expect(adapter).toContain('strokeWidth={artwork.strokeWidth}')
    expect(adapter).toContain("path.stroke === 'currentColor' ? color : path.stroke")
    expect(adapter).toContain("path.fill === 'currentColor' ? color : path.fill")
    expect(adapter).toContain('opacity={path.opacity')
    expect(adapter).not.toContain('lucide')
  })
  it('preserves all upstream SVG paths, viewBoxes and Regular weights exactly', async () => {
    expect(existsSync(specUrl), 'official geometry module must exist').toBe(true)
    const { OFFICIAL_MENU_ARTWORK } = await import('../src/ui/official-menu-icon-data')
    expect(Object.keys(OFFICIAL_MENU_ARTWORK).sort()).toEqual(Object.keys(golden).sort())
    for (const [key, hash] of Object.entries(golden)) {
      const artwork = OFFICIAL_MENU_ARTWORK[key as keyof typeof OFFICIAL_MENU_ARTWORK]
      expect(createHash('sha256').update(JSON.stringify(artwork)).digest('hex'), key).toBe(hash)
    }
  })
})
