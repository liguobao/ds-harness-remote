import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import Svg, { Path, Rect } from 'react-native-svg'
import { Check, Lock, X } from 'lucide-react-native'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../ui/fish-logo'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { useReduceMotion } from '../ui/use-reduce-motion'

// DeepSeek brand blue, matching the splash mark.
const BRAND = '#4D6BFE'

const TILE = 104
const LAPTOP_WIDTH = 72
const LAPTOP_HEIGHT = 50
// Screen opening inside the laptop line art (in LAPTOP_* units).
const SCREEN = { x: 12, y: 5, width: 48, height: 32 }
const WHALE_WIDTH = 26
const WHALE_HEIGHT = (WHALE_WIDTH * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width
const LAPTOP_LEFT = (TILE - LAPTOP_WIDTH) / 2
const LAPTOP_TOP = (TILE - LAPTOP_HEIGHT) / 2 + 2

/**
 * The remote computer as a quiet line-art laptop with the DeepSeek whale on
 * its screen. A single soft halo breathes while connecting; a small lock
 * marks the secure stage and a check confirms the computer once ready.
 */
export function ConnectionHero({ secured, ready, failed }: {
  secured: boolean
  ready: boolean
  failed: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const reduceMotion = useReduceMotion()
  const halo = useRef(new Animated.Value(0)).current
  const bob = useRef(new Animated.Value(0.5)).current
  const lock = useRef(new Animated.Value(secured ? 1 : 0)).current
  const done = useRef(new Animated.Value(ready ? 1 : 0)).current

  const breathing = !ready && !failed && !reduceMotion

  useEffect(() => {
    if (!breathing) {
      halo.stopAnimation()
      halo.setValue(0)
      bob.setValue(0.5)
      return
    }
    const haloLoop = Animated.loop(Animated.timing(halo, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }))
    const bobLoop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]))
    haloLoop.start()
    bobLoop.start()
    return () => {
      haloLoop.stop()
      bobLoop.stop()
    }
  }, [bob, breathing, halo])

  useEffect(() => {
    Animated.timing(lock, { toValue: secured && !ready ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
  }, [lock, ready, secured])

  useEffect(() => {
    Animated.timing(done, { toValue: ready ? 1 : 0, duration: 240, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start()
  }, [done, ready])

  const line = failed ? colors.danger : colors.ink
  const whale = failed ? colors.subtle : BRAND

  return (
    <View style={styles.stage} accessible={false} importantForAccessibility="no-hide-descendants">
      {breathing && (
        <Animated.View style={[styles.halo, {
          opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
          transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.32] }) }],
        }]} />
      )}
      <View style={[styles.tile, failed && styles.tileFailed]}>
        <Svg width={LAPTOP_WIDTH} height={LAPTOP_HEIGHT} viewBox={`0 0 ${LAPTOP_WIDTH} ${LAPTOP_HEIGHT}`} style={styles.laptop}>
          <Rect x={9} y={2} width={54} height={38} rx={5} fill="none" stroke={line} strokeWidth={2.2} />
          <Path d="M2 44 H70" stroke={line} strokeWidth={2.4} strokeLinecap="round" />
          <Path d="M30 44 H42" stroke={colors.surface} strokeWidth={1} strokeLinecap="round" />
        </Svg>
        <View style={styles.screen}>
          <Animated.View style={{
            transform: [
              { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [1.5, -1.5] }) },
              // The brand mark faces left; mirror it to face into the screen.
              { scaleX: -1 },
            ],
          }}>
            <Svg width={WHALE_WIDTH} height={WHALE_HEIGHT} viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}>
              <Path d={FISH_LOGO_PATH} fill={whale} />
            </Svg>
          </Animated.View>
        </View>
      </View>

      <Animated.View style={[styles.badge, styles.badgeLock, { opacity: lock, transform: [{ scale: lock }] }]}>
        <Lock size={10} strokeWidth={2.6} color={colors.white} />
      </Animated.View>
      <Animated.View style={[styles.badge, styles.badgeReady, { opacity: done, transform: [{ scale: done }] }]}>
        <Check size={11} strokeWidth={3} color={colors.white} />
      </Animated.View>
      {failed && (
        <View style={[styles.badge, styles.badgeFailed]}>
          <X size={11} strokeWidth={3} color={colors.white} />
        </View>
      )}
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    stage: { width: TILE, height: TILE, alignSelf: 'center' },
    halo: { position: 'absolute', left: 0, top: 0, width: TILE, height: TILE, borderRadius: 30, backgroundColor: colors.primarySoft },
    tile: { width: TILE, height: TILE, borderRadius: 30, backgroundColor: colors.primarySoft },
    tileFailed: { backgroundColor: colors.dangerSoft },
    laptop: { position: 'absolute', left: LAPTOP_LEFT, top: LAPTOP_TOP },
    screen: { position: 'absolute', left: LAPTOP_LEFT + SCREEN.x, top: LAPTOP_TOP + SCREEN.y, width: SCREEN.width, height: SCREEN.height, alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', right: -4, bottom: -4, width: 24, height: 24, borderRadius: 12, borderWidth: 2.5, borderColor: colors.background, alignItems: 'center', justifyContent: 'center' },
    badgeLock: { backgroundColor: colors.primary },
    badgeReady: { backgroundColor: colors.success },
    badgeFailed: { backgroundColor: colors.danger },
  })
}
