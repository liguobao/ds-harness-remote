import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

/**
 * System "remove animations" preference, kept live for the lifetime of the
 * caller. Shared by connection hero, chat motion and the sheet primitive so a
 * single implementation decides how motion degrades.
 */
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return reduceMotion
}
