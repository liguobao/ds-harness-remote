import { useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { AlignJustify, Check, Code2, MessageSquare, MoveHorizontal, Palette, RotateCcw, Type as TypeIcon, X } from 'lucide-react-native'
import { strings as zhCN } from '../locales/i18n'
import { useAppStore } from '../state/store'
import { BlurHeaderFrame, GroupCard, GroupRow, IconButton, TopBar } from '../ui/components'
import { NativeMarkdown } from '../ui/markdown'
import { androidRipple, continuousRadius } from '../ui/platform-style'
import { useResponsiveLayout } from '../ui/responsive'
import { SheetModal } from '../ui/sheet'
import {
  CHAT_ACCENT_SWATCHES,
  DEFAULT_CHAT_APPEARANCE,
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

type AppearancePickerKey = 'accent' | 'bubble' | 'codeTheme' | 'fontSize' | 'lineSpacing' | 'letterSpacing'

export function ChatAppearanceScreen({ active = true, onBack }: { active?: boolean; onBack: () => void }) {
  const { colors, scheme, appearance } = useTheme()
  const setChatAppearance = useAppStore(state => state.setChatAppearance)
  const resetChatAppearance = useAppStore(state => state.resetChatAppearance)
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const { contentMaxWidth, landscape, compactHeight, sheetMaxHeight } = useResponsiveLayout()
  const [activePicker, setActivePicker] = useState<AppearancePickerKey | undefined>(undefined)
  const [scrolled, setScrolled] = useState(false)
  const scrolledRef = useRef(false)
  const backStateRef = useRef({ active, activePicker, onBack })
  backStateRef.current = { active, activePicker, onBack }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!backStateRef.current.active) return false
      if (backStateRef.current.activePicker !== undefined) {
        setActivePicker(undefined)
        return true
      }
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

  const activeAccentSwatch = CHAT_ACCENT_SWATCHES[appearance.accent][scheme]
  const activeAccentLabel = accentOptions.find(o => o.value === appearance.accent)?.label ?? zhCN.settings.accentDeepseek
  const activeBubbleLabel = bubbleOptions.find(o => o.value === appearance.bubbleStyle)?.label ?? zhCN.settings.bubbleSoft
  const activeCodeThemeLabel = codeThemeOptions.find(o => o.value === appearance.codeTheme)?.label ?? zhCN.settings.codeThemeAuto
  const activeFontSizeLabel = fontSizeOptions.find(o => o.value === appearance.fontScale)?.label ?? zhCN.settings.fontSizeMd
  const activeLineSpacingLabel = lineSpacingOptions.find(o => o.value === appearance.spacingScale)?.label ?? zhCN.settings.lineSpacingBalanced
  const activeLetterSpacingLabel = letterSpacingOptions.find(o => o.value === appearance.letterSpacing)?.label ?? zhCN.settings.letterSpacingNormal

  const update = (patch: Partial<ChatAppearance>) => {
    void setChatAppearance(patch)
  }

  const closePicker = () => setActivePicker(undefined)

  const pickerTitle =
    activePicker === 'accent' ? zhCN.settings.accentColor
      : activePicker === 'bubble' ? zhCN.settings.bubbleStyle
        : activePicker === 'codeTheme' ? zhCN.settings.codeTheme
          : activePicker === 'fontSize' ? zhCN.settings.fontSize
            : activePicker === 'lineSpacing' ? zhCN.settings.lineSpacing
              : activePicker === 'letterSpacing' ? zhCN.settings.letterSpacing
                : ''

  const pickerListOptions: readonly { value: string; label: string; chosen: boolean; onSelect: () => void }[] =
    activePicker === 'bubble'
      ? bubbleOptions.map(o => ({
          value: o.value,
          label: o.label,
          chosen: o.value === appearance.bubbleStyle,
          onSelect: () => {
            closePicker()
            update({ bubbleStyle: o.value })
          },
        }))
      : activePicker === 'codeTheme'
        ? codeThemeOptions.map(o => ({
            value: o.value,
            label: o.label,
            chosen: o.value === appearance.codeTheme,
            onSelect: () => {
              closePicker()
              update({ codeTheme: o.value })
            },
          }))
        : activePicker === 'fontSize'
          ? fontSizeOptions.map(o => ({
              value: o.value,
              label: o.label,
              chosen: o.value === appearance.fontScale,
              onSelect: () => {
                closePicker()
                update({ fontScale: o.value })
              },
            }))
          : activePicker === 'lineSpacing'
            ? lineSpacingOptions.map(o => ({
                value: o.value,
                label: o.label,
                chosen: o.value === appearance.spacingScale,
                onSelect: () => {
                  closePicker()
                  update({ spacingScale: o.value })
                },
              }))
            : activePicker === 'letterSpacing'
              ? letterSpacingOptions.map(o => ({
                  value: o.value,
                  label: o.label,
                  chosen: o.value === appearance.letterSpacing,
                  onSelect: () => {
                    closePicker()
                    update({ letterSpacing: o.value })
                  },
                }))
              : []

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
            { paddingTop: 4, paddingBottom: spacing.xxxl + insets.bottom },
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
            <GroupCard>
              <GroupRow
                first
                icon={Palette}
                label={zhCN.settings.accentColor}
                accessory={(
                  <View style={styles.accentValueRow}>
                    <View style={[styles.accentValueDot, { backgroundColor: activeAccentSwatch.primary }]} />
                    <Text style={styles.accentValueText} numberOfLines={1}>{activeAccentLabel}</Text>
                  </View>
                )}
                chevron
                onPress={() => setActivePicker('accent')}
              />
              <GroupRow
                icon={MessageSquare}
                label={zhCN.settings.bubbleStyle}
                value={activeBubbleLabel}
                chevron
                onPress={() => setActivePicker('bubble')}
              />
              <GroupRow
                icon={Code2}
                label={zhCN.settings.codeTheme}
                value={activeCodeThemeLabel}
                chevron
                onPress={() => setActivePicker('codeTheme')}
              />
            </GroupCard>

            <Text style={styles.sectionLabel}>{zhCN.bots.layoutLabel}</Text>
            <GroupCard>
              <GroupRow
                first
                icon={TypeIcon}
                label={zhCN.settings.fontSize}
                value={activeFontSizeLabel}
                chevron
                onPress={() => setActivePicker('fontSize')}
              />
              <GroupRow
                icon={AlignJustify}
                label={zhCN.settings.lineSpacing}
                value={activeLineSpacingLabel}
                chevron
                onPress={() => setActivePicker('lineSpacing')}
              />
              <GroupRow
                icon={MoveHorizontal}
                label={zhCN.settings.letterSpacing}
                value={activeLetterSpacingLabel}
                chevron
                onPress={() => setActivePicker('letterSpacing')}
              />
            </GroupCard>
          </View>
        </ScrollView>
      </BlurHeaderFrame>

      <SheetModal
        visible={activePicker !== undefined}
        onClose={closePicker}
        sheetStyle={[styles.pickerDialog, { maxHeight: sheetMaxHeight }]}
      >
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle} accessibilityRole="header">{pickerTitle}</Text>
          <IconButton label={zhCN.common.close} icon={X} onPress={closePicker} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.pickerList}>
          <GroupCard>
            {activePicker === 'accent'
              ? accentOptions.map((option, index) => {
                  const chosen = option.value === appearance.accent
                  const swatch = CHAT_ACCENT_SWATCHES[option.value][scheme]
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: chosen }}
                      accessibilityLabel={option.label}
                      android_ripple={androidRipple(colors)}
                      onPress={() => {
                        closePicker()
                        update({ accent: option.value })
                      }}
                      style={({ pressed }) => [styles.accentOptionRow, pressed && styles.accentOptionRowPressed]}
                    >
                      <View style={styles.accentOptionIconSlot}>
                        <View style={[styles.accentOptionDot, { backgroundColor: swatch.primary }]} />
                      </View>
                      <View style={[styles.accentOptionBody, index > 0 && styles.accentOptionDivider]}>
                        <Text
                          style={[styles.accentOptionLabel, chosen && { color: colors.primary }]}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                        {chosen && <Check size={19} color={colors.primary} strokeWidth={2.2} />}
                      </View>
                    </Pressable>
                  )
                })
              : pickerListOptions.map((option, index) => (
                  <GroupRow
                    key={option.value}
                    first={index === 0}
                    label={option.label}
                    selected={option.chosen}
                    chevron={false}
                    accessory={option.chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                    onPress={option.onSelect}
                  />
                ))}
          </GroupCard>
        </ScrollView>
      </SheetModal>
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
      paddingBottom: 10,
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
      ...type.small,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
      color: colors.muted,
      marginTop: 6,
      marginBottom: spacing.xs,
      paddingLeft: spacing.md,
    },
    sectionLabel: {
      ...type.small,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '600',
      color: colors.muted,
      marginTop: spacing.xl,
      marginBottom: spacing.xs,
      paddingLeft: spacing.md,
    },
    accentValueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      maxWidth: '50%',
    },
    accentValueDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    accentValueText: {
      ...type.small,
      fontSize: 15,
      color: colors.muted,
      flexShrink: 1,
    },
    pickerDialog: {
      paddingHorizontal: spacing.lg,
      paddingTop: 0,
      gap: spacing.md,
    },
    pickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: spacing.xs,
    },
    pickerTitle: {
      ...type.heading,
      fontSize: 18,
      color: colors.ink,
      fontWeight: '700',
    },
    pickerList: {
      paddingBottom: spacing.md,
    },
    accentOptionRow: {
      minHeight: 58,
      paddingLeft: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
    },
    accentOptionRowPressed: {
      backgroundColor: colors.surfaceStrong,
    },
    accentOptionIconSlot: {
      width: 28,
      marginRight: spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    accentOptionDot: {
      width: 18,
      height: 18,
      borderRadius: 9,
    },
    accentOptionBody: {
      flex: 1,
      minWidth: 0,
      minHeight: 58,
      paddingRight: spacing.md,
      paddingVertical: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
    },
    accentOptionDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    accentOptionLabel: {
      ...type.body,
      fontSize: 16,
      color: colors.ink,
      flex: 1,
    },
  })
}
