import assets from './assets/characters.json'

export interface AvatarCharacter {
  label?: string
  body: string
  shade?: string
  light?: string
  paints?: (string | number)[][]
  eyes: [number, number, number, number, number][]
}

const CHARACTERS = assets.characters as unknown as Record<string, AvatarCharacter>
const INKS = assets.inks as Record<string, string[]>

export const LEGACY_SHAPES = new Set(['magnet', 'ring', 'gem'])

export const SHAPE_ALIASES: Record<string, string> = {
  zed: 'bear',
  wave: 'octopus',
  hex: 'bloom',
  cushion: 'squircle',
  dolphin: 'whale',
  turtle: 'acorn',
  crab: 'octopus',
  puffer: 'cloud',
  jelly: 'octopus',
  starfish: 'star',
  seahorse: 'whale',
}

export const PICKER_SHAPES = Object.keys(assets.characters).filter(id => !LEGACY_SHAPES.has(id))
export const DEFAULT_SHAPES = [
  'star', 'moon', 'cloud', 'octopus', 'spark', 'bear', 'puppy', 'sprout',
  'bloom', 'squircle', 'gumdrop', 'peanut', 'bunny', 'kitty', 'acorn',
] as const
export const FALLBACK_SHAPE = 'gumdrop'

export const CHARACTER_COLORS = [
  'black', 'brown', 'red', 'orange', 'yellow', 'green',
  'cyan', 'blue', 'violet', 'magenta', 'gray', 'aurora',
] as const
export const DEFAULT_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta'] as const

export const LEGACY_INKS: Record<string, string> = {
  kimi: 'charcoal',
  zai: 'graphite',
  minimax: 'rose',
  stepfun: 'sky',
  mimo: 'tangerine',
  qwen: 'cobalt',
}

function fnv1a(id: string): number {
  let value = 2166136261
  for (let i = 0; i < id.length; i += 1) value = Math.imul(value ^ id.charCodeAt(i), 16777619)
  return value >>> 0
}

export function defaultAvatarShape(botId: string): string {
  let value = fnv1a(botId) | 0
  value = Math.imul(value ^ (value >>> 16), 73244475)
  value = Math.imul(value ^ (value >>> 13), 3266489909)
  return DEFAULT_SHAPES[((value ^ (value >>> 16)) >>> 0) % DEFAULT_SHAPES.length] ?? FALLBACK_SHAPE
}

export function defaultAvatarColor(botId: string): string {
  const t = (fnv1a(botId) + 1831565813) | 0
  let n = Math.imul(t ^ (t >>> 15), 1 | t)
  n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n
  return DEFAULT_COLORS[Math.floor((((n ^ (n >>> 14)) >>> 0) / 4294967296) * DEFAULT_COLORS.length)] ?? 'deepseek'
}

export function resolveAvatarShape(shape: string | undefined, botId: string): string {
  if (typeof shape === 'string' && shape !== '') {
    if (Object.hasOwn(CHARACTERS, shape)) return shape
    const aliased = Object.hasOwn(SHAPE_ALIASES, shape) ? SHAPE_ALIASES[shape] : undefined
    if (aliased && Object.hasOwn(CHARACTERS, aliased)) return aliased
  }
  return botId ? defaultAvatarShape(botId) : FALLBACK_SHAPE
}

export function resolveAvatarColor(color: string | undefined, botId: string): string {
  if (typeof color === 'string' && color !== '') {
    if (/^#[0-9a-f]{6}$/i.test(color)) return color
    if (Object.hasOwn(INKS, color)) return color
    const aliased = Object.hasOwn(LEGACY_INKS, color) ? LEGACY_INKS[color] : undefined
    if (aliased && Object.hasOwn(INKS, aliased)) return aliased
  }
  return botId ? defaultAvatarColor(botId) : 'black'
}

export function resolveAvatarFill(color: string, scheme: 'light' | 'dark'): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  const resolved = Object.hasOwn(INKS, color)
    ? color
    : Object.hasOwn(LEGACY_INKS, color)
      ? LEGACY_INKS[color]!
      : 'deepseek'
  return INKS[resolved]?.[scheme === 'dark' ? 1 : 0] ?? INKS.deepseek?.[0] ?? '#4D6BFE'
}

export function avatarCharacterOf(shapeId: string): AvatarCharacter {
  return CHARACTERS[shapeId] ?? CHARACTERS[FALLBACK_SHAPE]!
}
