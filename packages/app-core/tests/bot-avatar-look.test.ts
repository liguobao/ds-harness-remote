import { describe, expect, it } from 'vitest'
import {
  LEGACY_INKS,
  LEGACY_SHAPES,
  PICKER_SHAPES,
  SHAPE_ALIASES,
  avatarCharacterOf,
  resolveAvatarColor,
  resolveAvatarFill,
  resolveAvatarShape,
} from '../src/screens/bot/avatar-look'

describe('bot avatar-look', () => {
  it('exposes the 20 active DS-Bot v0.4 picker shapes and resolves legacy aliases', () => {
    expect(PICKER_SHAPES).toHaveLength(20)
    for (const legacy of LEGACY_SHAPES) {
      expect(PICKER_SHAPES).not.toContain(legacy)
    }
    expect(PICKER_SHAPES).toContain('cloud')
    expect(PICKER_SHAPES).toContain('spark')
    expect(PICKER_SHAPES).toContain('bear')
    expect(PICKER_SHAPES).toContain('puppy')
    expect(PICKER_SHAPES).toContain('octopus')
    expect(PICKER_SHAPES).toContain('sprout')
    expect(PICKER_SHAPES).toContain('bloom')

    for (const [alias, target] of Object.entries(SHAPE_ALIASES)) {
      expect(resolveAvatarShape(alias, 'bot-1')).toBe(target)
      expect(avatarCharacterOf(target).body.length).toBeGreaterThan(10)
    }

    expect(resolveAvatarShape('magnet', 'bot-1')).toBe('magnet')
    expect(resolveAvatarShape('ring', 'bot-1')).toBe('ring')
    expect(resolveAvatarShape('gem', 'bot-1')).toBe('gem')
    expect(resolveAvatarShape(undefined, 'bot-1')).toBe(resolveAvatarShape(undefined, 'bot-1'))
  })

  it('resolves v0.4 inks, legacy ink aliases, hex colors, and deterministic fallbacks', () => {
    for (const [legacy, target] of Object.entries(LEGACY_INKS)) {
      expect(resolveAvatarColor(legacy, 'bot-1')).toBe(target)
    }
    expect(resolveAvatarColor('#12ABEF', 'bot-1')).toBe('#12ABEF')
    expect(resolveAvatarFill('#12ABEF', 'light')).toBe('#12ABEF')
    expect(resolveAvatarFill('deepseek', 'light')).toBe('#4D6BFE')
    expect(resolveAvatarFill('deepseek', 'dark')).toBe('#6A84FF')
    expect(resolveAvatarFill('kimi', 'light')).toBe('#141416')
    expect(resolveAvatarColor(undefined, 'bot-abc')).toBe(resolveAvatarColor(undefined, 'bot-abc'))
  })
})
