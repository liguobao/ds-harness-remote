import { ArrowUp, CircleStop } from 'lucide-react-native'
import { useEffect, useMemo, useRef } from 'react'
import { ActivityIndicator, Animated, Easing, Pressable, Text, TextInput, View } from 'react-native'
import { strings } from '../../locales/i18n'
import type { RemoteSession } from '../../types'
import { CollapseCornerIcon } from '../../ui/composer-expand-icons'
import { splitDraftSegments } from '../../ui/mention-popover'
import { formatQuoteDraftSnippet } from '../../ui/quote-helpers'
import { QuoteMarkIcon } from '../../ui/quote-preview'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { easingCurve, resolveMotion } from '../../ui/motion'
import { useReduceMotion } from '../../ui/use-reduce-motion'
import { createStyles } from './styles'
import type { useChatMentions } from './use-chat-mentions'

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

type Props = {
  visible: boolean
  onClose: () => void
  backend: RemoteSession['backend']
  draft: string
  quotes?: string[]
  onRemoveQuote?: (index: number) => void
  input: ReturnType<typeof useChatMentions>
  replyActive: boolean
  stopping: boolean
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
  replyActive,
  stopping,
  sendDisabled,
  onSubmit,
  onStop,
}: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { selection, onChangeText, onSelectionChange } = input
  const draftSegments = useMemo(() => splitDraftSegments(draft), [draft])
  const backendTextKeys = BACKEND_CHAT_TEXT_KEYS[backend ?? 'harness'] ?? BACKEND_CHAT_TEXT_KEYS.harness
  const reduceMotion = useReduceMotion()
  // The composer expands in place; it is the same surface growing, not a new
  // screen arriving from an edge.
  const entrance = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (!visible) return
    entrance.setValue(0)
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: resolveMotion('fullscreen', reduceMotion).duration,
      easing: Easing.bezier(...easingCurve('expand')),
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [visible, entrance, reduceMotion])

  if (!visible) {
    return null
  }

  return (
    <View style={styles.expandedComposerOverlay} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.chat.collapseComposer}
        onPress={onClose}
        style={styles.expandedComposerBackdrop}
      />
      <Animated.View
        style={[styles.expandedComposerCard, {
          opacity: entrance,
          transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }],
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
            accessibilityLabel={strings.chat[backendTextKeys.messageLabel]}
            style={styles.expandedTextInput}
            onChangeText={onChangeText}
            onSelectionChange={onSelectionChange}
            selection={selection}
            placeholder={strings.chat[backendTextKeys.placeholder]}
            placeholderTextColor={colors.muted}
            multiline
            autoFocus
            selectionColor={colors.accent}
            cursorColor={colors.accent}
          >
            <Text>
              {draftSegments.map((segment, index) => (
                <Text key={index} style={{ color: segment.token ? colors.primary : colors.ink }}>
                  {segment.text}
                </Text>
              ))}
            </Text>
          </TextInput>
        </View>

        <View style={styles.expandedFooter}>
          {replyActive && draft.trim().length === 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.stop}
              accessibilityState={{ disabled: stopping, busy: stopping }}
              disabled={stopping}
              onPress={onStop}
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
              accessibilityState={{ disabled: sendDisabled }}
              disabled={sendDisabled}
              onPress={() => {
                onSubmit()
                onClose()
              }}
              style={({ pressed }) => [styles.sendButton, pressed && styles.sendPressed, sendDisabled && styles.sendDisabled]}
            >
              <ArrowUp size={20} color={sendDisabled ? colors.subtle : colors.white} strokeWidth={2.4} />
            </Pressable>
          )}
        </View>
      </Animated.View>
    </View>
  )
}
