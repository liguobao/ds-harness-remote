// Adapted from DeepSeek Harness (MIT). Full license: docs/official-menu-icons.md.
import type { ComponentType } from 'react'
import Svg, { Path } from 'react-native-svg'
import { OFFICIAL_MENU_ARTWORK, type OfficialMenuIconKind } from './official-menu-icon-data'

type MenuIconProps = { size?: number; color?: string }
type ArtworkPath = {
  d: string
  stroke?: string
  fill?: string
  opacity?: string
  strokeLinejoin?: 'round' | 'miter' | 'bevel'
  strokeMiterlimit?: string
}

function officialIcon(kind: OfficialMenuIconKind): ComponentType<MenuIconProps> {
  return function OfficialMenuIcon({ size = 16, color = 'currentColor' }: MenuIconProps) {
    const artwork = OFFICIAL_MENU_ARTWORK[kind]
    return (
      <Svg width={size} height={size} viewBox={artwork.viewBox} fill="none" strokeWidth={artwork.strokeWidth}>
        {(artwork.paths as readonly ArtworkPath[]).map((path, index) => (
          <Path key={index} d={path.d}
            stroke={path.stroke === 'currentColor' ? color : path.stroke}
            fill={path.fill === 'currentColor' ? color : path.fill}
            opacity={path.opacity === undefined ? undefined : Number(path.opacity)}
            strokeLinejoin={path.strokeLinejoin}
            strokeMiterlimit={path.strokeMiterlimit === undefined ? undefined : Number(path.strokeMiterlimit)}
          />
        ))}
      </Svg>
    )
  }
}

export const OfficialMenuIcons = {
  referenceFile: officialIcon('referenceFile'),
  referenceFolder: officialIcon('referenceFolder'),
  referenceSession: officialIcon('referenceSession'),
  file: officialIcon('file'),
  goal: officialIcon('goal'),
  plan: officialIcon('plan'),
  feedback: officialIcon('feedback'),
  compact: officialIcon('compact'),
  permission: officialIcon('permission'),
  model: officialIcon('model'),
  export: officialIcon('export'),
  skill: officialIcon('skill'),
  newChat: officialIcon('newChat'),
  sliders: officialIcon('sliders'),
  edit: officialIcon('edit'),
} satisfies Record<OfficialMenuIconKind, ComponentType<MenuIconProps>>
