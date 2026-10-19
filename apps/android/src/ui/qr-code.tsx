import { useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import qrcode from 'qrcode-generator'

const QUIET_ZONE_MODULES = 2

/**
 * Render a QR code as vector modules. The code is drawn in fixed black on
 * white regardless of the app theme so camera scanners keep a high-contrast
 * target; the surrounding panel supplies the themed background.
 */
export function QrCode({ value, size, label, color = '#000000', backgroundColor = '#FFFFFF' }: {
  value: string
  size: number
  label: string
  color?: string
  backgroundColor?: string
}) {
  const { path, modules } = useMemo(() => {
    const generator = qrcode(0, 'M')
    generator.addData(value)
    generator.make()
    const count = generator.getModuleCount()
    let path = ''
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (generator.isDark(row, column)) {
          path += `M${column + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`
        }
      }
    }
    return { path, modules: count + QUIET_ZONE_MODULES * 2 }
  }, [value])

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: 12, overflow: 'hidden' }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${modules} ${modules}`}>
        <Rect width={modules} height={modules} fill={backgroundColor} />
        <Path d={path} fill={color} />
      </Svg>
    </View>
  )
}
