import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTheme } from './theme-context'
import { IconWrapFill, IconNowrapFill, IconCopyOutline, IconCheckOutline } from './dsh-icons'

export interface CodeBlockProps {
  code: string
  language?: string
  style?: StyleProp<ViewStyle>
}

const MONOSPACE_FONT = 'monospace'
const COPY_RESET_MS = 2000

export const CodeBlockView = memo(function CodeBlockView({ code, language, style }: CodeBlockProps) {
  const { colors, density } = useTheme()
  const isCompact = density === 'compact'
  const [wrap, setWrap] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanCode = (code || '').replace(/\n+$/u, '')
  const label = (language || 'code').toLowerCase()

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleToggleWrap = useCallback(() => {
    setWrap(prev => !prev)
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(cleanCode)
      setCopied(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS)
    } catch {
      // Ignore clipboard error on devices without permission
    }
  }, [cleanCode])

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surfaceStrong }]}>
        <Text numberOfLines={1} style={[styles.language, { color: colors.muted }]}>
          {label}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={handleToggleWrap}
            accessibilityRole="button"
            accessibilityLabel={wrap ? 'Switch to scroll mode' : 'Switch to wrap mode'}
            hitSlop={8}
            style={({ pressed }) => [
              styles.actionButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            {wrap ? (
              <IconNowrapFill size={14} color={colors.ink} />
            ) : (
              <IconWrapFill size={14} color={colors.muted} />
            )}
          </Pressable>
          <Pressable
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy code'}
            hitSlop={8}
            style={({ pressed }) => [
              styles.actionButton,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            {copied ? (
              <IconCheckOutline size={14} color="#10B981" />
            ) : (
              <IconCopyOutline size={14} color={colors.muted} />
            )}
          </Pressable>
        </View>
      </View>

      {wrap ? (
        <View style={[styles.wrapBody, { padding: isCompact ? 8 : 10 }]}>
          <Text
            selectable
            style={[
              styles.codeText,
              {
                color: colors.ink,
                fontSize: isCompact ? 12 : 13,
                lineHeight: isCompact ? 17 : 18.5,
                flexShrink: 1,
              },
            ]}
          >
            {cleanCode}
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          contentContainerStyle={[styles.scrollContent, { padding: isCompact ? 8 : 10 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            selectable
            style={[
              styles.codeText,
              {
                color: colors.ink,
                fontSize: isCompact ? 12 : 13,
                lineHeight: isCompact ? 17 : 18.5,
                flexShrink: 0,
              },
            ]}
          >
            {cleanCode}
          </Text>
        </ScrollView>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 6,
    alignSelf: 'stretch',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  language: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionButton: {
    width: 26,
    height: 26,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    minWidth: '100%',
  },
  wrapBody: {},
  codeText: {
    fontFamily: MONOSPACE_FONT,
    includeFontPadding: false,
  },
})
