import { useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, RotateCcw } from 'lucide-react-native'
import { strings as zhCN } from '../locales/i18n'
import { useAppStore } from '../state/store'
import { BlurHeaderFrame, GroupCard, IconButton, TopBar } from '../ui/components'
import { NativeMarkdown } from '../ui/markdown'
import { androidRipple, continuousRadius } from '../ui/platform-style'
import { useResponsiveLayout } from '../ui/responsive'
import {
  CHAT_ACCENT_SWATCHES,
  DEFAULT_CHAT_APPEARANCE,
  floatingShadow,
  radius,
  resolveChatMetrics,
  spacing,
  type,
  type ChatAccentPreset,
  type ChatAppearance,
  type ChatBubbleStyle,
  type ChatCodeTheme,
  type ChatFontScale,
  type ChatLetterSpacing,
  type ChatSpacingScale,
} from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function OptionSegments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
}) {
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(createStyles)
  const dark = scheme === 'dark'
  return (
    <View style={[styles.segmentRow, dark && styles.segmentRowDark]} accessibilityRole="radiogroup">
      {options.map(option => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            android_ripple={androidRipple(colors)}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segmentBtn,
              active && (dark ? styles.segmentBtnActiveDark : styles.segmentBtnActive),
              pressed && !active && styles.segmentBtnPressed,
            ]}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
              style={[styles.segmentText, active && styles.segmentTextActive]}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function ChatAppearanceScreen({ active = true, onBack }: { active?: boolean; onBack: () => void }) {
  const { colors, scheme, appearance } = useTheme()
  const setChatAppearance = useAppStore(state => state.setChatAppearance)
  const resetChatAppearance = useAppStore(state => state.resetChatAppearance)
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const { contentMaxWidth, landscape, compactHeight } = useResponsiveLayout()
  const backStateRef = useRef({ active, onBack })
  backStateRef.current = { active, onBack }
  const [scrolled, setScrolled] = useState(false)
  const scrolledRef = useRef(false)

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!backStateRef.current.active) return false
      backStateRef.current.onBack()
      return true
    })
    return () => subscription.remove()
  }, [])

  const isDefault =
    appearance.fontScale === DEFAULT_CHAT_APPEARANCE.fontScale
    && appearance.spacingScale === DEFAULT_CHAT_APPEARANCE.spacingScale
    && appearance.letterSpacing === DEFAULT_CHAT_APPEARANCE.letterSpacing
    && appearance.accent === DEFAULT_CHAT_APPEARANCE.accent
    && appearance.bubbleStyle === DEFAULT_CHAT_APPEARANCE.bubbleStyle
    && appearance.codeTheme === DEFAULT_CHAT_APPEARANCE.codeTheme

  const metrics = resolveChatMetrics(appearance)
  const solidText = colors.onPrimary ?? colors.white
  const isSolid = appearance.bubbleStyle === 'solid'
  const bubbleContainerStyle =
    appearance.bubbleStyle === 'tinted'
      ? styles.previewBubbleTinted
      : appearance.bubbleStyle === 'solid'
        ? styles.previewBubbleSolid
        : appearance.bubbleStyle === 'minimal'
          ? styles.previewBubbleMinimal
          : styles.previewBubbleSoft
  const bubblePalette = isSolid
    ? { ...colors, ink: solidText, muted: solidText, subtle: solidText, primary: solidText, surfaceStrong: 'rgba(255,255,255,0.18)' }
    : { ...colors, surfaceStrong: colors.border }

  const accentOptions: { value: ChatAccentPreset; label: string }[] = [
    { value: 'deepseek', label: zhCN.settings.accentDeepseek },
    { value: 'emerald', label: zhCN.settings.accentEmerald },
    { value: 'violet', label: zhCN.settings.accentViolet },
    { value: 'amber', label: zhCN.settings.accentAmber },
    { value: 'graphite', label: zhCN.settings.accentGraphite },
  ]

  const bubbleOptions: { value: ChatBubbleStyle; label: string }[] = [
    { value: 'soft', label: zhCN.settings.bubbleSoft },
    { value: 'tinted', label: zhCN.settings.bubbleTinted },
    { value: 'solid', label: zhCN.settings.bubbleSolid },
    { value: 'minimal', label: zhCN.settings.bubbleMinimal },
  ]

  const fontSizeOptions: { value: ChatFontScale; label: string }[] = [
    { value: 'sm', label: zhCN.settings.fontSizeSm },
    { value: 'md', label: zhCN.settings.fontSizeMd },
    { value: 'lg', label: zhCN.settings.fontSizeLg },
    { value: 'xl', label: zhCN.settings.fontSizeXl },
  ]

  const lineSpacingOptions: { value: ChatSpacingScale; label: string }[] = [
    { value: 'tight', label: zhCN.settings.lineSpacingTight },
    { value: 'balanced', label: zhCN.settings.lineSpacingBalanced },
    { value: 'relaxed', label: zhCN.settings.lineSpacingRelaxed },
  ]

  const letterSpacingOptions: { value: ChatLetterSpacing; label: string }[] = [
    { value: 'normal', label: zhCN.settings.letterSpacingNormal },
    { value: 'wide', label: zhCN.settings.letterSpacingWide },
    { value: 'wider', label: zhCN.settings.letterSpacingWider },
  ]

  const codeThemeOptions: { value: ChatCodeTheme; label: string }[] = [
    { value: 'auto', label: zhCN.settings.codeThemeAuto },
    { value: 'dark', label: zhCN.settings.codeThemeDark },
    { value: 'light', label: zhCN.settings.codeThemeLight },
  ]

  const activeAccentLabel = accentOptions.find(option => option.value === appearance.accent)?.label ?? zhCN.settings.accentDeepseek

  const update = (patch: Partial<ChatAppearance>) => {
    void setChatAppearance(patch)
  }

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame
        inset
        header={(
          <TopBar
            title={zhCN.settings.chatAppearance}
            centered={48}
            onBack={onBack}
            action={(
              <IconButton
                label={zhCN.settings.chatAppearanceReset}
                icon={RotateCcw}
                dense
                disabled={isDefault}
                onPress={() => void resetChatAppearance()}
              />
            )}
          />
        )}
      >
        <View style={[styles.stickyPreviewArea, scrolled && styles.stickyPreviewAreaScrolled]}>
          <View style={[styles.column, landscape && { maxWidth: contentMaxWidth }]}>
            <View style={styles.previewCanvas}>
              <ScrollView
                style={(landscape || compactHeight) ? styles.previewScrollCompact : styles.previewScroll}
                contentContainerStyle={styles.previewScrollContent}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                <View pointerEvents="none">
                  <View style={[styles.previewUserWrap, { marginBottom: Math.max(8, metrics.turnBottomGap - 2) }]}>
                    <View style={[styles.previewUserBubble, bubbleContainerStyle]}>
                      <View style={{ marginBottom: -metrics.paragraphGap }}>
                        <NativeMarkdown text={zhCN.settings.chatAppearancePreviewUser} colors={bubblePalette} />
                      </View>
                    </View>
                  </View>
                  <View style={[styles.previewAssistantWrap, { marginBottom: -metrics.paragraphGap }]}>
                    <NativeMarkdown text={zhCN.settings.chatAppearancePreviewAssistant} />
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: 4, paddingBottom: spacing.xl + insets.bottom },
          ]}
          scrollEventThrottle={16}
          onScroll={event => {
            const next = event.nativeEvent.contentOffset.y > 2
            if (next !== scrolledRef.current) {
              scrolledRef.current = next
              setScrolled(next)
            }
          }}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.column, landscape && { maxWidth: contentMaxWidth }]}>
            <Text style={styles.sectionLabelFirst}>{zhCN.settings.appearance}</Text>
            <GroupCard style={styles.cardBody}>
              <View style={styles.controlBlock}>
                <View style={styles.controlHeader}>
                  <Text style={styles.controlLabel}>{zhCN.settings.accentColor}</Text>
                  <Text style={styles.controlValue} numberOfLines={1}>{activeAccentLabel}</Text>
                </View>
                <View style={styles.swatchRow} accessibilityRole="radiogroup">
                  {accentOptions.map(option => {
                    const chosen = appearance.accent === option.value
                    const swatch = CHAT_ACCENT_SWATCHES[option.value][scheme]
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: chosen }}
                        accessibilityLabel={option.label}
                        android_ripple={androidRipple(colors, true)}
                        onPress={() => update({ accent: option.value })}
                        style={({ pressed }) => [styles.swatchItem, pressed && styles.swatchItemPressed]}
                      >
                        <View style={[styles.swatchRing, chosen && { borderColor: swatch.primary }]}>
                          <View style={[styles.swatchDot, { backgroundColor: swatch.primary }]}>
                            {chosen && <Check size={14} color={swatch.onPrimary} strokeWidth={2.7} />}
                          </View>
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>{zhCN.settings.bubbleStyle}</Text>
                <OptionSegments
                  options={bubbleOptions}
                  value={appearance.bubbleStyle}
                  onChange={bubbleStyle => update({ bubbleStyle })}
                />
              </View>

              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>{zhCN.settings.codeTheme}</Text>
                <OptionSegments
                  options={codeThemeOptions}
                  value={appearance.codeTheme}
                  onChange={codeTheme => update({ codeTheme })}
                />
              </View>
            </GroupCard>

            <Text style={styles.sectionLabel}>{zhCN.bots.layoutLabel}</Text>
            <GroupCard style={styles.cardBody}>
              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>{zhCN.settings.fontSize}</Text>
                <OptionSegments
                  options={fontSizeOptions}
                  value={appearance.fontScale}
                  onChange={fontScale => update({ fontScale })}
                />
              </View>

              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>{zhCN.settings.lineSpacing}</Text>
                <OptionSegments
                  options={lineSpacingOptions}
                  value={appearance.spacingScale}
                  onChange={spacingScale => update({ spacingScale })}
                />
              </View>

              <View style={styles.controlBlock}>
                <Text style={styles.controlLabel}>{zhCN.settings.letterSpacing}</Text>
                <OptionSegments
                  options={letterSpacingOptions}
                  value={appearance.letterSpacing}
                  onChange={letterSpacing => update({ letterSpacing })}
                />
              </View>
            </GroupCard>
          </View>
        </ScrollView>
      </BlurHeaderFrame>
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingHorizontal: spacing.lg },
    column: { width: '100%', alignSelf: 'center' },
    stickyPreviewArea: {
      backgroundColor: colors.background,
      paddingHorizontal: spacing.lg,
      paddingTop: 2,
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'transparent',
    },
    stickyPreviewAreaScrolled: {
      borderBottomColor: colors.separator,
    },
    previewCanvas: {
      ...continuousRadius(radius.xl),
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      overflow: 'hidden',
    },
    previewScroll: {
      maxHeight: 268,
    },
    previewScrollCompact: {
      maxHeight: 164,
    },
    previewScrollContent: {
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    previewUserWrap: {
      alignSelf: 'flex-end',
      maxWidth: '88%',
    },
    previewUserBubble: {
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 17,
      borderTopRightRadius: 6,
    },
    previewBubbleSoft: {
      backgroundColor: colors.userBubble ?? colors.surfaceStrong,
    },
    previewBubbleTinted: {
      backgroundColor: colors.primarySoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    previewBubbleSolid: {
      backgroundColor: colors.primary,
    },
    previewBubbleMinimal: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.border,
    },
    previewAssistantWrap: {
      alignSelf: 'stretch',
    },
    sectionLabelFirst: {
      ...type.caption,
      fontSize: 13,
      fontWeight: '600',
      color: colors.muted,
      marginTop: 2,
      marginBottom: 6,
      paddingLeft: 4,
    },
    sectionLabel: {
      ...type.caption,
      fontSize: 13,
      fontWeight: '600',
      color: colors.muted,
      marginTop: 14,
      marginBottom: 6,
      paddingLeft: 4,
    },
    cardBody: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 13,
    },
    controlBlock: {
      gap: 7,
    },
    controlHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    controlLabel: {
      ...type.smallStrong,
      fontSize: 13.5,
      fontWeight: '500',
      color: colors.ink,
    },
    controlValue: {
      ...type.caption,
      fontSize: 12.5,
      fontWeight: '500',
      color: colors.muted,
    },
    swatchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 6,
      paddingTop: 2,
    },
    swatchItem: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatchItemPressed: {
      transform: [{ scale: 0.92 }],
      opacity: 0.85,
    },
    swatchRing: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 2,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatchDot: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentRow: {
      flexDirection: 'row',
      padding: 3,
      gap: 2,
      ...continuousRadius(12),
      backgroundColor: colors.surfaceStrong,
    },
    segmentRowDark: {
      backgroundColor: colors.background,
    },
    segmentBtn: {
      flex: 1,
      minHeight: 33,
      ...continuousRadius(9),
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 4,
    },
    segmentBtnActive: {
      backgroundColor: colors.surface,
      ...floatingShadow(colors, 'low'),
    },
    segmentBtnActiveDark: {
      backgroundColor: colors.surfaceStrong,
    },
    segmentBtnPressed: {
      opacity: 0.65,
    },
    segmentText: {
      ...type.small,
      fontSize: 13,
      fontWeight: '500',
      color: colors.muted,
      textAlign: 'center',
    },
    segmentTextActive: {
      color: colors.ink,
      fontWeight: '600',
    },
  })
}
