import { ArrowUp, CircleStop } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { strings } from '../../locales/i18n'
import type { RemoteSession } from '../../types'
import { CollapseCornerIcon } from '../../ui/composer-expand-icons'
import { triggerLightHaptic } from '../../ui/haptics'
import { splitDraftSegments } from '../../ui/mention-popover'
import { formatQuoteDraftSnippet } from '../../ui/quote-helpers'
import { QuoteMarkIcon } from '../../ui/quote-preview'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { easingCurve } from '../../ui/motion'
import { useReduceMotion } from '../../ui/use-reduce-motion'
import { type ComposerInputBridge } from './composer'
import { createStyles } from './styles'

type BackendChatTextKeys = Record<
  'generating' | 'messageLabel' | 'placeholder' | 'policyHint',
  { [Key in keyof typeof strings.chat]: typeof strings.chat[Key] extends string ? Key : never }[keyof typeof strings.chat]
>

const BACKEND_CHAT_TEXT_KEYS: Partial<Record<string, BackendChatTextKeys>> & { harness: BackendChatTextKeys } = {
  harness: { generating: 'generating', messageLabel: 'messageLabel', placeholder: 'placeholder', policyHint: 'policyHint' },
  codex: { generating: 'codexGenerating', messageLabel: 'codexMessageLabel', placeholder: 'codexPlaceholder', policyHint: 'codexPolicyHint' },
  cursor: { generating: 'cursorGenerating', messageLabel: 'cursorMessageLabel', placeholder: 'cursorPlaceholder', policyHint: 'cursorPolicyHint' },
  claude: { generating: 'claudeGenerating', messageLabel: 'claudeMessageLabel', placeholder: 'claudePlaceholder', policyHint: 'claudePolicyHint' },
  hermes: { generating: 'hermesGenerating', messageLabel: 'hermesMessageLabel', placeholder: 'hermesPlaceholder', policyHint: 'hermesPolicyHint' },
  opencode: { generating: 'opencodeGenerating', messageLabel: 'opencodeMessageLabel', placeholder: 'opencodePlaceholder', policyHint: 'opencodePolicyHint' },
  pi: { generating: 'piGenerating', messageLabel: 'piMessageLabel', placeholder: 'piPlaceholder', policyHint: 'piPolicyHint' },
  antigravity: { generating: 'antigravityGenerating', messageLabel: 'antigravityMessageLabel', placeholder: 'antigravityPlaceholder', policyHint: 'antigravityPolicyHint' },
}

export type ExpandedComposerProps = {
  visible: boolean
  onClose: () => void
  backend?: RemoteSession['backend']
  draft: string
  quotes?: string[]
  onRemoveQuote?: (index: number) => void
  input: Pick<ComposerInputBridge, 'selection' | 'onChangeText' | 'onSelectionChange'>
  accessibilityLabel?: string
  placeholder?: string
  highlightMentionTokens?: boolean
  replyActive: boolean
  stopping: boolean
  sending?: boolean
  sendDisabled: boolean
  onSubmit: () => void
  onStop: () => void
}

export function ExpandedComposer({
  visible,
  onClose,
  backend,
  draft,
  quotes,
  onRemoveQuote,
  input,
  accessibilityLabel,
  placeholder,
  highlightMentionTokens = true,
  replyActive,
  stopping,
  sending = false,
  sendDisabled,
  onSubmit,
  onStop,
}: ExpandedComposerProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { selection, onChangeText, onSelectionChange } = input
  const showTokenHighlight = highlightMentionTokens !== false
  const draftSegments = useMemo(() => (showTokenHighlight ? splitDraftSegments(draft) : []), [draft, showTokenHighlight])
  const backendTextKeys = BACKEND_CHAT_TEXT_KEYS[backend ?? 'harness'] ?? BACKEND_CHAT_TEXT_KEYS.harness
  const resolvedLabel = accessibilityLabel ?? strings.chat[backendTextKeys.messageLabel]
  const resolvedPlaceholder = placeholder ?? strings.chat[backendTextKeys.placeholder]
  const reduceMotion = useReduceMotion()
  const [mounted, setMounted] = useState(visible)
  const entrance = useRef(new Animated.Value(visible ? 1 : 0)).current

  useEffect(() => {
    if (visible) {
      setMounted(true)
      entrance.stopAnimation()
      entrance.setValue(0)
      const animation = Animated.timing(entrance, {
        toValue: 1,
        duration: reduceMotion ? 110 : 240,
        easing: Easing.bezier(...easingCurve('expand')),
        useNativeDriver: true,
      })
      animation.start()
      return () => animation.stop()
    }
    if (!mounted) return
    entrance.stopAnimation()
    const animation = Animated.timing(entrance, {
      toValue: 0,
      duration: reduceMotion ? 90 : 170,
      easing: Easing.bezier(...easingCurve('retreat')),
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (finished) setMounted(false)
    })
    return () => animation.stop()
  }, [visible, mounted, entrance, reduceMotion])

  if (!mounted) {
    return null
  }

  return (
    <View style={styles.expandedComposerOverlay} pointerEvents="box-none">
      <Animated.View style={[styles.expandedComposerBackdrop, { opacity: entrance }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.chat.collapseComposer}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Animated.View
        style={[styles.expandedComposerCard, {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [reduceMotion ? 0 : 28, 0],
              }),
            },
          ],
        }]}
      >
        <View style={styles.expandedComposerHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.collapseComposer}
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [styles.expandedCollapseButton, pressed && styles.plusPressed]}
          >
            <CollapseCornerIcon size={18} color={colors.ink} />
          </Pressable>
        </View>

        {quotes && quotes.length > 0 && (
          <View style={styles.expandedQuotesWrap}>
            {quotes.map((quoteText, index) => (
              <Pressable
                key={`expanded-quote-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`${strings.chat.removeQuote ?? '删除引用'}: ${quoteText}`}
                onPress={() => onRemoveQuote?.(index)}
                style={styles.composerInlineQuoteBadge}
              >
                <QuoteMarkIcon size={14} color={colors.primary} />
                <Text numberOfLines={1} style={[styles.composerInlineQuoteText, { color: colors.primary, maxWidth: 220 }]}>
                  “{formatQuoteDraftSnippet(quoteText, 18)}”
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.expandedInputContainer}>
          <TextInput
            accessibilityLabel={resolvedLabel}
            style={styles.expandedTextInput}
            value={showTokenHighlight ? undefined : draft}
            onChangeText={onChangeText}
            onSelectionChange={onSelectionChange}
            selection={selection}
            placeholder={resolvedPlaceholder}
            placeholderTextColor={colors.muted}
            multiline
            autoFocus
            selectionColor={colors.accent}
            cursorColor={colors.accent}
          >
            {showTokenHighlight ? (
              <Text>
                {draftSegments.map((segment, index) => (
                  <Text key={index} style={{ color: segment.token ? colors.primary : colors.ink }}>
                    {segment.text}
                  </Text>
                ))}
              </Text>
            ) : undefined}
          </TextInput>
        </View>

        <View style={styles.expandedFooter}>
          {replyActive && draft.trim().length === 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.stop}
              accessibilityState={{ disabled: stopping, busy: stopping }}
              disabled={stopping}
              onPress={() => {
                triggerLightHaptic()
                onStop()
              }}
              style={({ pressed }) => [styles.stopButton, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
            >
              {stopping ? (
                <ActivityIndicator size="small" color={colors.onInverse} />
              ) : (
                <CircleStop size={20} color={colors.onInverse} />
              )}
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.send}
              accessibilityState={{ disabled: sendDisabled, busy: sending }}
              disabled={sendDisabled}
              onPress={() => {
                onSubmit()
                onClose()
              }}
              style={({ pressed }) => [styles.sendButton, pressed && styles.sendPressed, !sending && sendDisabled && styles.sendDisabled]}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.onInverse ?? colors.white} />
              ) : (
                <ArrowUp size={20} color={sendDisabled ? colors.subtle : (colors.onInverse ?? colors.white)} strokeWidth={2.4} />
              )}
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  )
}
