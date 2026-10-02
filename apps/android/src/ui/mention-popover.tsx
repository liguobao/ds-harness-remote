import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { radius, spacing, type } from './theme'
import { useTheme, type ThemeColors } from './theme-context'
import { useThemedStyles } from './use-themed-styles'

export * from './mention-helpers'

export interface MentionItem {
  id: string
  icon: ComponentType<{ size?: number; color?: string }>
  title: string
  description?: string
  /** Right-aligned trailing meta, e.g. a relative update time. */
  meta?: string
  /** Keyboard-highlighted row (the web marks the active candidate). */
  highlighted?: boolean
  onPress: () => void
}

export interface MentionGroup {
  key: string
  title: string
  items: MentionItem[]
}

/** Suggestion surface for the `/` and `@` triggers, mounted above the composer card. */
export function MentionPopover({ groups, onDismiss, emptyText }: {
  groups: MentionGroup[]
  onDismiss: () => void
  emptyText: string
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  // Android Back closes the popover first instead of leaving the chat screen.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss()
      return true
    })
    return () => subscription.remove()
  }, [onDismiss])

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const { height } = useWindowDimensions()
  const [keyboardTop, setKeyboardTop] = useState<number>()
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', event => setKeyboardTop(event.endCoordinates.screenY))
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(undefined))
    setKeyboardTop(Keyboard.metrics()?.screenY)
    return () => { shown.remove(); hidden.remove() }
  }, [])
  const availableHeight = Math.min(height, keyboardTop ?? height)
  const maxHeight = Math.max(80, Math.min(240, availableHeight * 0.32))
  return (
    <View style={[styles.popover, { maxHeight }]} accessibilityRole="list">
      <ScrollView
        style={[styles.scroll, { maxHeight }]}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {total === 0
          ? <Text style={styles.empty}>{emptyText}</Text>
          : groups.map(group => group.items.length === 0 ? null : (
              <View key={group.key}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupTitle}>{group.title}</Text>
                </View>
                {group.items.map(item => {
                  const Icon = item.icon
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      onPress={item.onPress}
                      style={({ pressed }) => [styles.row, item.highlighted === true && styles.rowActive, pressed && styles.rowActive]}
                    >
                      <View style={styles.iconWrap}>
                        <Icon size={16} color={colors.primary} />
                      </View>
                      <View style={styles.rowCopy}>
                        <View style={styles.rowLine}>
                          <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                          {item.meta !== undefined && <Text style={styles.rowMeta} numberOfLines={1}>{item.meta}</Text>}
                        </View>
                        {item.description !== undefined && (
                          <Text style={styles.rowDescription} numberOfLines={1}>{item.description}</Text>
                        )}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            ))}
      </ScrollView>
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    popover: {
      // Keep the native hit rectangle inside its parent. An absolute child
      // above the short composer is visible but not touchable on Android.
      position: 'relative',
      marginBottom: spacing.xs,
      maxHeight: 260,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      overflow: 'hidden',
      shadowColor: colors.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    scroll: { maxHeight: 260 },
    scrollContent: { paddingBottom: spacing.xxs },
    groupHeader: { backgroundColor: colors.background, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs },
    groupTitle: { ...type.caption, color: colors.muted },
    iconWrap: {
      width: 28,
      height: 28,
      borderRadius: 4,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, minHeight: 46, paddingVertical: spacing.xxs },
    rowActive: { backgroundColor: colors.background, opacity: 0.8 },
    rowCopy: { flex: 1, minWidth: 0 },
    rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    rowTitle: { ...type.small, color: colors.ink, flexShrink: 1 },
    rowMeta: { ...type.caption, color: colors.muted, marginLeft: 'auto', flexShrink: 1 },
    rowDescription: { ...type.caption, color: colors.muted, marginTop: 1 },
    empty: { ...type.small, color: colors.muted, padding: spacing.md, textAlign: 'center' },
  })
}
