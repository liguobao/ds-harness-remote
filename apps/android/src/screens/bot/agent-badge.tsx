import { View } from 'react-native'
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg'
import { useTheme } from '../../ui/theme-context'
import assets from './assets/characters.json'

// DS-Bot 0.3.0 local-agent route badges and vector marks (Apache-2.0 / Simple Icons CC0-1.0).
export const AGENT_BADGES: Record<string, readonly [string, string]> = {
  'devin-cli': ['DV', 'violet'],
  'claude-code': ['CC', 'tangerine'],
  'codex-cli': ['CX', 'green'],
  'opencode': ['OC', 'blue'],
  'cursor-cli': ['CU', 'magenta'],
  'gemini-cli': ['GM', 'yellow'],
  'grok-cli': ['GX', 'graphite'],
  'cline': ['CL', 'cyan'],
  'qwen-code': ['QW', 'cobalt'],
  'goose': ['GS', 'brown'],
}

const CUSTOM_BADGE: readonly [string, string] = ['AC', 'rose']

export interface AgentPathLogo {
  d: string
  hex: string
  title: string
}

export const AGENT_LOGOS: Record<string, AgentPathLogo> = {
  'claude-code': {
    d: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    hex: 'D97757',
    title: 'Claude',
  },
  'cursor-cli': {
    d: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23',
    hex: '000000',
    title: 'Cursor',
  },
  'gemini-cli': {
    d: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
    hex: '8E75B2',
    title: 'Google Gemini',
  },
  'opencode': {
    d: 'M22 24H2V0h20zM17 4.8H7v14.4h10z',
    hex: '000000',
    title: 'OpenCode',
  },
  'cline': {
    d: 'm23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.067 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.535 9.6a2.267 2.267 0 0 1 2.261 2.274z',
    hex: '18181B',
    title: 'Cline',
  },
  'qwen-code': {
    d: 'M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z',
    hex: '6950EF',
    title: 'QWen',
  },
}

export function badgeOf(engine?: string): readonly [string, string] | undefined {
  if (!engine) return undefined
  return AGENT_BADGES[engine] ?? (engine.startsWith('acp-') ? CUSTOM_BADGE : undefined)
}

export function logoOf(engine?: string): AgentPathLogo | undefined {
  if (!engine) return undefined
  return AGENT_LOGOS[engine]
}

export function engineOfModel(ref?: string): string | undefined {
  if (!ref) return undefined
  const provider = String(ref).split('/')[0] ?? ''
  return badgeOf(provider) !== undefined ? provider : undefined
}

export function isLocalRoute(ref?: string): boolean {
  return engineOfModel(ref) !== undefined
}

function resolveInkHex(inkName: string, scheme: 'light' | 'dark'): string {
  const table = assets.inks as Record<string, string[]>
  const entry = table[inkName] ?? table.deepseek
  return entry?.[scheme === 'dark' ? 1 : 0] ?? '#4D6BFE'
}

export function BotAgentBadge({ engine, size = 15 }: { engine?: string; size?: number }) {
  const { scheme, colors } = useTheme()
  if (!engine) return null
  const logo = logoOf(engine)
  if (logo !== undefined) {
    const isDarkMonochrome = logo.hex === '000000' || logo.hex === '18181B'
    const fill = scheme === 'dark' && isDarkMonochrome ? colors.ink : `#${logo.hex}`
    return (
      <View accessibilityLabel={logo.title} style={{ width: size, height: size, flexShrink: 0 }}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d={logo.d} fill={fill} />
        </Svg>
      </View>
    )
  }
  const badge = badgeOf(engine)
  if (badge === undefined) return null
  const [glyph, ink] = badge
  const stroke = resolveInkHex(ink, scheme)
  return (
    <View accessibilityLabel={engine} style={{ width: size, height: size, flexShrink: 0 }}>
      <Svg width={size} height={size} viewBox="0 0 20 20">
        <Rect
          x={1}
          y={1}
          width={18}
          height={18}
          rx={5}
          fill={stroke}
          fillOpacity={0.16}
          stroke={stroke}
          strokeWidth={1.4}
        />
        <SvgText
          x={10}
          y={13.6}
          textAnchor="middle"
          fontSize={7.5}
          fontWeight="700"
          fill={stroke}
        >
          {glyph}
        </SvgText>
      </Svg>
    </View>
  )
}

export function BotAgentAvatar({ engine, size = 40 }: { engine: string; size?: number }) {
  const logo = logoOf(engine)
  const badge = badgeOf(engine) ?? CUSTOM_BADGE
  const [glyph, ink] = badge
  const inkHex = resolveInkHex(ink, 'light')
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessible={false}>
      {logo !== undefined ? (
        <>
          <Rect width={64} height={64} rx={16} fill="#FFFFFF" stroke="#E5E7EB" strokeWidth={1.5} />
          <G transform="translate(14 14) scale(1.5)">
            <Path d={logo.d} fill={`#${logo.hex}`} />
          </G>
        </>
      ) : (
        <>
          <Rect width={64} height={64} rx={16} fill={inkHex} />
          <SvgText
            x={32}
            y={41}
            textAnchor="middle"
            fontSize={24}
            fontWeight="700"
            fill="#FFFFFF"
          >
            {glyph}
          </SvgText>
        </>
      )}
    </Svg>
  )
}
