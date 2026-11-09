import { useEffect, useState } from 'react'
import { Text } from 'react-native'

/** Keep timer updates local to the suffix, rather than rerendering its screen. */
export function AnimatedEllipsis() {
  const [visible, setVisible] = useState(1)
  useEffect(() => {
    const timer = setInterval(() => setVisible(count => count % 3 + 1), 400)
    return () => clearInterval(timer)
  }, [])
  return (
    <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Keep the same glyphs in every frame so centered labels never shift. */}
      <Text>.</Text>
      <Text style={visible < 2 ? { color: 'transparent' } : undefined}>.</Text>
      <Text style={visible < 3 ? { color: 'transparent' } : undefined}>.</Text>
    </Text>
  )
}
