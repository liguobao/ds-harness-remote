import Svg, { Path } from 'react-native-svg'

type IconProps = {
  size?: number
  color: string
}

/**
 * Expand icon with two corner marks pointing outward (upper-right and lower-left).
 * Matches the reference design in IMG_1554.
 */
export function ExpandCornerIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M13 3.5h3.5V7M7 16.5H3.5V13"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

/**
 * Collapse icon with two corner marks pointing inward toward the center.
 * Matches the reference design in IMG_1557.
 */
export function CollapseCornerIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M16.5 7h-3.5V3.5M3.5 13H7v3.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
