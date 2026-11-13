import { useEffect } from 'react'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Check, RotateCcw } from 'lucide-react-native'
import { strings as zhCN } from '../locales/i18n'
import { useAppStore } from '../state/store'
import { BlurHeaderFrame, GroupCard, IconButton, SectionTitle, TopBar, useHeaderInset } from '../ui/components'
import { NativeMarkdown } from '../ui/markdown'
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
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.segmentRow} accessibilityRole="radiogroup">
      {options.map(option => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
          >
            <Text
              numberOfLines={1}
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

export function ChatAppearanceScreen({ onBack }: { onBack: () => void }) {
  const { colors, scheme, density, appearance } = useTheme()
  const setChatAppearance = useAppStore(state => state.setChatAppearance)
  const resetChatAppearance = useAppStore(state => state.resetChatAppearance)
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const { contentMaxWidth, landscape } = useResponsiveLayout()

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack()
      return true
    })
    return () => subscription.remove()
  }, [onBack])

  const isDefault =
    appearance.fontScale === DEFAULT_CHAT_APPEARANCE.fontScale
    && appearance.spacingScale === DEFAULT_CHAT_APPEARANCE.spacingScale
    && appearance.letterSpacing === DEFAULT_CHAT_APPEARANCE.letterSpacing
    && appearance.accent === DEFAULT_CHAT_APPEARANCE.accent
    && appearance.bubbleStyle === DEFAULT_CHAT_APPEARANCE.bubbleStyle
    && appearance.codeTheme === DEFAULT_CHAT_APPEARANCE.codeTheme

  const metrics = resolveChatMetrics(density, appearance)
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

  const update = (patch: Partial<ChatAppearance>) => {
    void setChatAppearance(patch)
  }

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame
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
        <AppearanceBody
          landscape={landscape}
          contentMaxWidth={contentMaxWidth}
          bottomInset={insets.bottom}
        >
          <SectionTitle>{zhCN.settings.chatAppearancePreviewTitle}</SectionTitle>
          <View style={styles.previewCanvas}>
            <View style={[styles.previewUserWrap, { marginBottom: metrics.turnBottomGap }]}>
              <View style={[styles.previewUserBubble, bubbleContainerStyle]}>
                <View style={{ marginBottom: -metrics.paragraphGap }}>
                  <NativeMarkdown text={zhCN.settings.chatAppearancePreviewUser} colors={bubblePalette} />
                </View>
              </View>
            </View>
            <View style={styles.previewAssistantWrap}>
              <NativeMarkdown text={zhCN.settings.chatAppearancePreviewAssistant} />
            </View>
          </View>

          <SectionTitle>{zhCN.settings.accentColor}</SectionTitle>
          <GroupCard style={styles.groupPadding}>
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
                    onPress={() => update({ accent: option.value })}
                    style={styles.swatchItem}
                  >
                    <View style={[styles.swatchRing, chosen && { borderColor: swatch.primary }]}>
                      <View style={[styles.swatchDot, { backgroundColor: swatch.primary }]}>
                        {chosen && <Check size={15} color={swatch.onPrimary} strokeWidth={2.6} />}
                      </View>
                    </View>
                    <Text
                      numberOfLines={1}
                      style={[styles.swatchLabel, chosen && { color: colors.ink, fontWeight: '600' }]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </GroupCard>

          <SectionTitle>{zhCN.settings.bubbleStyle}</SectionTitle>
          <GroupCard style={styles.groupPadding}>
            <OptionSegments
              options={bubbleOptions}
              value={appearance.bubbleStyle}
              onChange={bubbleStyle => update({ bubbleStyle })}
            />
          </GroupCard>

          <SectionTitle>{zhCN.settings.fontSize}</SectionTitle>
          <GroupCard style={styles.groupPadding}>
            <OptionSegments
              options={fontSizeOptions}
              value={appearance.fontScale}
              onChange={fontScale => update({ fontScale })}
            />
          </GroupCard>

          <SectionTitle>{zhCN.settings.lineSpacing}</SectionTitle>
          <GroupCard style={styles.groupPadding}>
            <OptionSegments
              options={lineSpacingOptions}
              value={appearance.spacingScale}
              onChange={spacingScale => update({ spacingScale })}
            />
          </GroupCard>

          <SectionTitle>{zhCN.settings.letterSpacing}</SectionTitle>
          <GroupCard style={styles.groupPadding}>
            <OptionSegments
              options={letterSpacingOptions}
              value={appearance.letterSpacing}
              onChange={letterSpacing => update({ letterSpacing })}
            />
          </GroupCard>

          <SectionTitle>{zhCN.settings.codeTheme}</SectionTitle>
          <GroupCard style={styles.groupPadding}>
            <OptionSegments
              options={codeThemeOptions}
              value={appearance.codeTheme}
              onChange={codeTheme => update({ codeTheme })}
            />
          </GroupCard>
        </AppearanceBody>
      </BlurHeaderFrame>
    </View>
  )
}

function AppearanceBody({
  landscape,
  contentMaxWidth,
  bottomInset,
  children,
}: {
  landscape: boolean
  contentMaxWidth: number
  bottomInset: number
  children: React.ReactNode
}) {
  const headerInset = useHeaderInset()
  const styles = useThemedStyles(createStyles)
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingTop: headerInset + spacing.xs, paddingBottom: spacing.xxxl + bottomInset },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.column, landscape && { maxWidth: contentMaxWidth }]}>
        {children}
      </View>
    </ScrollView>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingHorizontal: spacing.lg },
    column: { width: '100%', alignSelf: 'center' },
    previewCanvas: {
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      padding: spacing.md,
      ...floatingShadow(colors, 'low'),
    },
    previewUserWrap: {
      alignSelf: 'flex-end',
      maxWidth: '88%',
    },
    previewUserBubble: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 18,
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
    groupPadding: {
      padding: spacing.sm,
    },
    swatchRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.xs,
    },
    swatchItem: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
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
    swatchLabel: {
      ...type.caption,
      fontSize: 11,
      color: colors.muted,
      textAlign: 'center',
    },
    segmentRow: {
      flexDirection: 'row',
      padding: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    segmentBtn: {
      flex: 1,
      minHeight: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    segmentBtnActive: {
      backgroundColor: colors.surface,
      ...floatingShadow(colors, 'low'),
    },
    segmentText: {
      ...type.small,
      fontSize: 13.5,
      color: colors.muted,
      textAlign: 'center',
    },
    segmentTextActive: {
      color: colors.ink,
      fontWeight: '600',
    },
  })
}
