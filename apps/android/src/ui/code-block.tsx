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
import { resolveChatMetrics } from './theme'
import { DARK_CODE_PALETTE, highlightCode, LIGHT_CODE_PALETTE } from './syntax-highlight'
import { IconWrapFill, IconNowrapFill, IconCopyOutline, IconCheckOutline } from './dsh-icons'

export interface CodeBlockProps {
  code: string
  language?: string
  style?: StyleProp<ViewStyle>
}

const MONOSPACE_FONT = 'monospace'
const COPY_RESET_MS = 2000

export const CodeBlockView = memo(function CodeBlockView({ code, language, style }: CodeBlockProps) {
  const { colors, scheme, density, appearance } = useTheme()
  const isCompact = density === 'compact'
  const metrics = resolveChatMetrics(density, appearance)
  const useDarkCode = appearance.codeTheme === 'dark' || (appearance.codeTheme === 'auto' && scheme === 'dark')
  const palette = useDarkCode ? DARK_CODE_PALETTE : LIGHT_CODE_PALETTE
  const [wrap, setWrap] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanCode = (code || '').replace(/\n+$/u, '')
  const label = (language || 'code').toLowerCase()
  const tokens = React.useMemo(() => highlightCode(cleanCode, language), [cleanCode, language])

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

  const renderedTokens = (
    <Text
      selectable
      style={[
        styles.codeText,
        {
          color: palette.plain,
          fontSize: metrics.codeFontSize,
          lineHeight: metrics.codeLineHeight,
          flexShrink: wrap ? 1 : 0,
        },
      ]}
    >
      {tokens.map((token, index) => (
        token.kind === 'plain'
          ? token.text
          : (
            <Text
              key={index}
              style={[
                { color: palette[token.kind] },
                token.kind === 'comment' && styles.commentToken,
                token.kind === 'keyword' && styles.keywordToken,
              ]}
            >
              {token.text}
            </Text>
          )
      ))}
    </Text>
  )

  return (
    <View style={[styles.container, { backgroundColor: palette.background, borderColor: palette.border }, style]}>
      <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.headerBackground }]}>
        <Text numberOfLines={1} style={[styles.language, { color: palette.headerText }]}>
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
              <IconNowrapFill size={14} color={palette.plain} />
            ) : (
              <IconWrapFill size={14} color={palette.headerText} />
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
              <IconCheckOutline size={14} color={colors.success} />
            ) : (
              <IconCopyOutline size={14} color={palette.headerText} />
            )}
          </Pressable>
        </View>
      </View>

      {wrap ? (
        <View style={[styles.wrapBody, { padding: isCompact ? 10 : 12 }]}>
          {renderedTokens}
        </View>
      ) : (
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          contentContainerStyle={[styles.scrollContent, { padding: isCompact ? 10 : 12 }]}
          keyboardShouldPersistTaps="handled"
        >
          {renderedTokens}
        </ScrollView>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
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
  commentToken: {
    fontStyle: 'italic',
  },
  keywordToken: {
    fontWeight: '600',
  },
})
