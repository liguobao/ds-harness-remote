import { useId, useState } from 'react'
import { Image } from 'react-native'
import Svg, { Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg'
import type { BotEntry } from '../../services/bot-catalog'
import { useTheme } from '../../ui/theme-context'
import { badgeOf, BotAgentAvatar, engineOfModel } from './agent-badge'
import assets from './assets/characters.json'

// Static native rendering of DeepSeek-Bot v0.2.0+ characters and v0.3.0 local-agent marks (Apache-2.0).
// Attribution and upstream license are retained in assets/.
const shapes = ['star', 'moon', 'gumdrop', 'peanut', 'bunny', 'kitty', 'acorn']
const inks = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta']
function hash(id: string) {
  let value = 2166136261
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619)
  return value >>> 0
}
interface Character { body: string; shade: string; light: string; paints?: (string | number)[][]; eyes: [number, number, number, number, number][] }
export function BotAvatar({ bot, size = 40 }: { bot: Pick<BotEntry, 'id' | 'avatar' | 'color' | 'engine' | 'model' | 'appliedModel'>; size?: number }) {
  const { scheme } = useTheme()
  const uid = useId().replace(/:/g, '')
  const [brokenImage, setBrokenImage] = useState('')
  const rawImage = bot.avatar?.image && bot.avatar.image !== brokenImage ? bot.avatar.image : undefined
  const engine = bot.engine ?? engineOfModel(bot.model || bot.appliedModel)
  if (rawImage?.startsWith('data:image/svg+xml') && engine !== undefined && badgeOf(engine) !== undefined) {
    return <BotAgentAvatar engine={engine} size={size} />
  }
  if (rawImage !== undefined && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(rawImage)) {
    return (
      <Image
        source={{ uri: rawImage }}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
        onError={() => setBrokenImage(rawImage)}
      />
    )
  }
  const seed = hash(bot.id)
  let shapeHash = Math.imul(seed ^ (seed >>> 16), 73244475)
  shapeHash = Math.imul(shapeHash ^ (shapeHash >>> 13), 3266489909)
  const shape = bot.avatar?.shape || shapes[((shapeHash ^ (shapeHash >>> 16)) >>> 0) % shapes.length] || 'gumdrop'
  const character = ((assets.characters as unknown as Record<string, Character>)[shape] ?? assets.characters.gumdrop) as Character
  const t = (seed + 1831565813) | 0
  let n = Math.imul(t ^ (t >>> 15), 1 | t)
  n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n
  const color = bot.color || inks[Math.floor((((n ^ (n >>> 14)) >>> 0) / 4294967296) * inks.length)] || 'deepseek'
  const fill = /^#[0-9a-f]{6}$/i.test(color) ? color : (assets.inks as Record<string, string[]>)[color]?.[scheme === 'dark' ? 1 : 0] ?? assets.inks.deepseek[0]
  return <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
    <Defs>
      <LinearGradient id={`${uid}paint`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#A4FFB0" /><Stop offset=".42" stopColor="#00F0E4" /><Stop offset="1" stopColor="#2E9EF7" /></LinearGradient>
      <Mask id={`${uid}eyes`} x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse">
        <Rect width="100" height="100" fill="white" />
        {character.eyes.map(([x, y, w, h, tilt], i) => <Rect key={i} x={x - w / 2} y={y - h / 2} width={w} height={h} rx={w / 2} fill="black" rotation={tilt} origin={`${x}, ${y}`} />)}
      </Mask>
    </Defs>
    <G mask={`url(#${uid}eyes)`}>
      <Path d={character.body} fill={color === 'aurora' ? `url(#${uid}paint)` : fill} />
      {character.paints?.map(([d, paint, opacity], i) => <Path key={i} d={String(d)} fill={String(paint)} opacity={Number(opacity)} />)}
      <Path d={character.shade} fill="#000" opacity={.14} /><Path d={character.light} fill="#fff" opacity={.16} />
    </G>
  </Svg>
}
