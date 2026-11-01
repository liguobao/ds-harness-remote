import { useState } from 'react'
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import Svg, { G, Path } from 'react-native-svg'
import { X } from 'lucide-react-native'
import { useTheme } from './theme-context'
import { strings } from '../locales/i18n'
import {
  formatQuoteDraftSnippet,
  formatQuoteText,
  formatTokens,
  messageQuoteRanges,
  parseMessageQuotes,
  quoteTextOf,
  type MessageQuoteRange,
  type ParsedMessageQuotes,
} from './quote-helpers'

export {
  formatQuoteDraftSnippet,
  formatQuoteText,
  formatTokens,
  messageQuoteRanges,
  parseMessageQuotes,
  quoteTextOf,
  type MessageQuoteRange,
  type ParsedMessageQuotes,
}

/** Exact upstream double-quote icon geometry from deepseek-harness QuotePreview. */
export function QuoteMarkIcon({ size = 14, color }: { readonly size?: number; readonly color?: string }) {
  const { colors } = useTheme()
  const iconColor = color ?? colors.primary
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <G transform="translate(4, 2)">
        <Path
          d="M2.8125 0.583008L3.2002 1.16602C2.43912 1.6713 1.88491 2.41238 1.60547 3.25684H2.98926V6.70605H0V4.52148C1.96593e-05 2.70313 0.9109 1.00575 2.42578 0L2.8125 0.583008Z"
          fill={iconColor}
        />
        <Path
          d="M7.50781 0.583008L7.89551 1.16602C7.13443 1.6713 6.58022 2.41238 6.30078 3.25684H7.68457V6.70605H4.69531V4.52148C4.69533 2.70313 5.60621 1.00575 7.12109 0L7.50781 0.583008Z"
          fill={iconColor}
        />
      </G>
    </Svg>
  )
}

export interface QuotePreviewRemoval {
  readonly label: string
  readonly onRemove: () => void
}

export interface QuotePreviewProps {
  readonly text: string
  readonly removal?: QuotePreviewRemoval
  readonly compact?: boolean
  readonly style?: StyleProp<ViewStyle>
}

/**
 * Shared compact presentation for draft and sent text quotes.
 * Upstream deepseek-harness: packages/client/ui-primitives/src/QuotePreview.tsx
 */
export function QuotePreview({ text, removal, compact = true, style }: QuotePreviewProps) {
  const { colors } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const isCompact = compact && !expanded

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceStrong, borderColor: colors.border }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityState={{ expanded }}
        accessibilityHint={isCompact ? '点击展开引用原文' : '点击收起引用原文'}
        style={styles.contentPressable}
        onPress={() => setExpanded(prev => !prev)}
      >
        <View style={styles.marker} aria-hidden>
          <QuoteMarkIcon size={14} color={colors.primary} />
        </View>
        <Text
          numberOfLines={isCompact ? 1 : undefined}
          ellipsizeMode="tail"
          style={[styles.text, { color: colors.ink }]}
        >
          {text}
        </Text>
      </Pressable>
      {removal !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removal.label}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.removeButton}
          onPress={removal.onRemove}
        >
          <X size={14} color={colors.muted} />
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginVertical: 3,
    maxWidth: '100%',
  },
  contentPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 24,
  },
  marker: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: 16,
    height: 16,
  },
  text: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  removeButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginLeft: 4,
    flexShrink: 0,
  },
})

/**
 * Figure 3: In-composer inline quote preview.
 * Displays inline at the top of the composer card with quote marks,
 * truncated text in primary/brand color, and a quick remove button.
 */
export function InlineQuotePreview({
  text,
  onRemove,
  removalLabel,
  style,
}: {
  readonly key?: string | number
  readonly text: string
  readonly onRemove?: () => void
  readonly removalLabel?: string
  readonly style?: StyleProp<ViewStyle>
}) {
  const { colors } = useTheme()
  const snippet = formatQuoteDraftSnippet(text)

  return (
    <View style={[inlineStyles.container, style]}>
      <View style={inlineStyles.quoteRow}>
        <QuoteMarkIcon size={13} color={colors.primary} />
        <Text style={[inlineStyles.quoteText, { color: colors.primary }]} numberOfLines={1}>
          “{snippet}”
        </Text>
      </View>
      {onRemove !== undefined && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removalLabel ?? strings.chat.removeQuote}
          hitSlop={8}
          onPress={onRemove}
          style={inlineStyles.closeButton}
        >
          <X size={13} color={colors.primary} />
        </Pressable>
      )}
    </View>
  )
}

const inlineStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 2,
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  quoteText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  closeButton: {
    padding: 4,
  },
})
