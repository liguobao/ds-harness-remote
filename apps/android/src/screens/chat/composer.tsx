import { ArrowUp, CircleStop, Plus, X, Zap } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { strings } from '../../locales/i18n'
import type { RemoteSession } from '../../types'
import { MentionPopover, splitDraftSegments } from '../../ui/mention-popover'
import { formatQuoteDraftSnippet } from '../../ui/quote-helpers'
import { QuoteMarkIcon } from '../../ui/quote-preview'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ExpandCornerIcon } from '../../ui/composer-expand-icons'
import { nextStackedOverflowLength, shouldShowExpandCorner, shouldUseStackedComposer } from './composer-gate'
import { createStyles } from './styles'
import type { useChatMentions } from './use-chat-mentions'

type BackendChatTextKeys = Record<
  'generating' | 'messageLabel' | 'placeholder' | 'policyHint',
  { [Key in keyof typeof strings.chat]: typeof strings.chat[Key] extends string ? Key : never }[keyof typeof strings.chat]
>

// Resolve these keys during rendering so language changes use the current catalog.
export const BACKEND_CHAT_TEXT_KEYS: Partial<Record<string, BackendChatTextKeys>> & { harness: BackendChatTextKeys } = {
  harness: { generating: 'generating', messageLabel: 'messageLabel', placeholder: 'placeholder', policyHint: 'policyHint' },
  codex: { generating: 'codexGenerating', messageLabel: 'codexMessageLabel', placeholder: 'codexPlaceholder', policyHint: 'codexPolicyHint' },
  cursor: { generating: 'cursorGenerating', messageLabel: 'cursorMessageLabel', placeholder: 'cursorPlaceholder', policyHint: 'cursorPolicyHint' },
  claude: { generating: 'claudeGenerating', messageLabel: 'claudeMessageLabel', placeholder: 'claudePlaceholder', policyHint: 'claudePolicyHint' },
  hermes: { generating: 'hermesGenerating', messageLabel: 'hermesMessageLabel', placeholder: 'hermesPlaceholder', policyHint: 'hermesPolicyHint' },
  opencode: { generating: 'opencodeGenerating', messageLabel: 'opencodeMessageLabel', placeholder: 'opencodePlaceholder', policyHint: 'opencodePolicyHint' },
  pi: { generating: 'piGenerating', messageLabel: 'piMessageLabel', placeholder: 'piPlaceholder', policyHint: 'piPolicyHint' },
  antigravity: { generating: 'antigravityGenerating', messageLabel: 'antigravityMessageLabel', placeholder: 'antigravityPlaceholder', policyHint: 'antigravityPolicyHint' },
}

/** Soft hint threshold; the composer accepts longer input instead of silently truncating. */
const LONG_DRAFT_HINT = 12_000

type Props = {
  backend: RemoteSession['backend']
  draft: string
  quotes?: string[]
  onRemoveQuote?: (index: number) => void
  input: ReturnType<typeof useChatMentions>
  replyActive: boolean
  stopping: boolean
  /** A tracked Host command (for example `/compact`) is running. */
  commandRunning?: boolean
  hasComposerContent: boolean
  connected: boolean
  /** Text editing is local, so a dropped carrier must not lock this field. */
  editable: boolean
  composerDisabled: boolean
  sendDisabled: boolean
  compactComposer: boolean
  composerInputMaxHeight: number
  onOpenExpand?: () => void
  onOpenActions: () => void
  onOpenPrompts?: () => void
  onSubmit: () => void
  onStop: () => void
}

export function ChatComposer({ backend, draft, quotes, onRemoveQuote, input, replyActive, stopping, commandRunning,
  hasComposerContent, connected, editable, composerDisabled, sendDisabled, compactComposer,
  composerInputMaxHeight, onOpenExpand, onOpenActions, onOpenPrompts, onSubmit, onStop }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { composerInputRef, mentionType, mentionGroups, selection, closeMention, onChangeText, onSelectionChange } = input
  const draftSegments = useMemo(() => splitDraftSegments(draft), [draft])
  const hasTokens = useMemo(() => draftSegments.some(segment => segment.token), [draftSegments])
  const inputChildren = useMemo(
    () => (hasTokens
      ? (
        <Text style={{ fontSize: 16, lineHeight: 22 }}>
          {draftSegments.map((segment, index) => (
            <Text key={index} style={{ color: segment.token ? colors.primary : colors.ink }}>{segment.text}</Text>
          ))}
        </Text>
      )
      : undefined),
    [colors.ink, colors.primary, draftSegments, hasTokens],
  )
  const backendTextKeys = BACKEND_CHAT_TEXT_KEYS[backend ?? 'harness'] ?? BACKEND_CHAT_TEXT_KEYS.harness
  const [contentHeight, setContentHeight] = useState(0)
  const [stackedOverflowLength, setStackedOverflowLength] = useState<number | null>(null)
  const hasQuotes = quotes !== undefined && quotes.length > 0
  const effectiveContentHeight = draft.length === 0 ? 0 : contentHeight
  const effectiveOverflowLength = draft.length === 0 ? null : stackedOverflowLength
  const isStacked = shouldUseStackedComposer({
    draft,
    hasQuotes,
    overflowLength: effectiveOverflowLength,
  })
  const showExpand = isStacked && onOpenExpand !== undefined && shouldShowExpandCorner({
    draft,
    contentHeight: effectiveContentHeight,
  })
  const rightInlineReserve = 40
    + (onOpenPrompts !== undefined ? 40 : 0)
    + ((replyActive || commandRunning) && hasComposerContent ? 34 : 0)
  return <>
    <View style={{ position: 'relative', zIndex: 20, elevation: 20 }}>
      {mentionType !== null && (
        <MentionPopover groups={mentionGroups} onDismiss={closeMention} emptyText={strings.mention.noMatches} />
      )}
      <View style={[styles.composerCard, hasQuotes && styles.composerCardWithQuotes]}>
        {hasQuotes && (
          <View style={styles.composerQuotesWrap}>
            {quotes.map((quoteText, index) => (
              <Pressable
                key={`inline-quote-${index}`}
                accessibilityRole="button"
                accessibilityLabel={`${strings.chat.removeQuote ?? '删除引用'}: ${quoteText}`}
                onPress={() => onRemoveQuote?.(index)}
                hitSlop={4}
                style={styles.composerQuotePill}
              >
                <QuoteMarkIcon size={12} color={colors.primary} />
                <Text numberOfLines={1} style={styles.composerQuotePillText}>
                  “{formatQuoteDraftSnippet(quoteText, 18)}”
                </Text>
                <X size={12} color={colors.primary} />
              </Pressable>
            ))}
          </View>
        )}
        {/* Keep Child 0 (TextInput) and Child 1 (action bar) in fixed React tree positions so inline <-> stacked promotion never unmounts the input or drops IME focus. */}
        <View style={styles.composerBody}>
          <View
            style={[
              isStacked ? styles.composerInputSlotStacked : [styles.composerInputSlotInline, { marginLeft: 40, marginRight: rightInlineReserve }],
              showExpand && styles.composerInputSlotExpandPad,
            ]}
          >
            <TextInput
              ref={composerInputRef}
              accessibilityLabel={strings.chat[backendTextKeys.messageLabel]}
              style={[
                styles.composerInput,
                isStacked && styles.composerInputStacked,
                draft.length === 0 && styles.composerInputEmpty,
                compactComposer && { maxHeight: composerInputMaxHeight },
              ]}
              value={hasTokens ? undefined : draft}
              onChangeText={onChangeText}
              onSelectionChange={onSelectionChange}
              onContentSizeChange={(event) => {
                const nextHeight = event.nativeEvent.contentSize.height
                setContentHeight(nextHeight)
                setStackedOverflowLength(prev => nextStackedOverflowLength({
                  draft,
                  contentHeight: nextHeight,
                  currentOverflowLength: prev,
                }))
              }}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === 'Backspace' && draft.length === 0 && quotes && quotes.length > 0) {
                  onRemoveQuote?.(quotes.length - 1)
                }
              }}
              selection={selection}
              placeholder={strings.chat[backendTextKeys.placeholder]}
              placeholderTextColor={colors.muted}
              multiline
              editable={editable}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
              children={inputChildren}
            />
          </View>
          <View pointerEvents="box-none" style={isStacked ? styles.composerActionsRow : styles.composerActionsOverlay}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.moreActions}
              accessibilityState={{ disabled: composerDisabled }}
              disabled={composerDisabled}
              onPress={onOpenActions}
              hitSlop={6}
              style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed, composerDisabled && styles.plusDisabled]}
            >
              <Plus size={20} color={connected ? colors.ink : colors.disabled} />
            </Pressable>
            <View style={styles.composerTrailing}>
              {onOpenPrompts !== undefined && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.chat.quickPrompts}
                  accessibilityState={{ disabled: composerDisabled }}
                  disabled={composerDisabled}
                  onPress={onOpenPrompts}
                  hitSlop={6}
                  style={({ pressed }) => [styles.composerShortcutButton, pressed && styles.plusPressed, composerDisabled && styles.plusDisabled]}
                >
                  <Zap size={19} color={connected ? colors.ink : colors.disabled} />
                </Pressable>
              )}
              {(replyActive || commandRunning) && !hasComposerContent
                ? <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.chat.stop}
                  accessibilityState={{ disabled: stopping, busy: stopping }}
                  disabled={stopping}
                  onPress={onStop}
                  hitSlop={6}
                  style={({ pressed }) => [styles.stopButton, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
                >
                  {stopping
                    ? <ActivityIndicator size="small" color={colors.onInverse} />
                    : <CircleStop size={18} color={colors.onInverse} />}
                </Pressable>
                : <>
                  {/* With text in the composer the primary action is the send
                    (queueing) button — tapping where Send lives must never stop
                    the running task (official InputBar behaviour). Stop stays
                    available as its own secondary button. */}
                  {(replyActive || commandRunning) && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={strings.chat.stop}
                      accessibilityState={{ disabled: stopping, busy: stopping }}
                      disabled={stopping}
                      onPress={onStop}
                      hitSlop={6}
                      style={({ pressed }) => [styles.stopButtonSmall, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
                    >
                      {stopping
                        ? <ActivityIndicator size="small" color={colors.onInverse} />
                        : <CircleStop size={16} color={colors.onInverse} />}
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.chat.send}
                    accessibilityState={{ disabled: sendDisabled }}
                    disabled={sendDisabled}
                    onPress={onSubmit}
                    hitSlop={6}
                    style={({ pressed }) => [styles.sendButton, pressed && styles.sendPressed, sendDisabled && styles.sendDisabled]}
                  >
                    <ArrowUp size={18} color={sendDisabled ? colors.subtle : (colors.onInverse ?? colors.white)} strokeWidth={2.4} />
                  </Pressable>
                </>}
            </View>
          </View>
          {showExpand && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.expandComposer}
              onPress={onOpenExpand}
              hitSlop={6}
              style={({ pressed }) => [styles.composerExpandCorner, pressed && styles.plusPressed]}
            >
              <ExpandCornerIcon size={15} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
    {draft.length > LONG_DRAFT_HINT && (
      <Text style={styles.composerHint}>{strings.chat.draftLong(draft.length)}</Text>
    )}
    {/* The draft survives a carrier drop; say so instead of silently
        swallowing an offline send tap (the primary action stays disabled). */}
    {!connected && draft.length > 0 && (
      <Text accessibilityLiveRegion="polite" style={[styles.composerHint, styles.composerHintWarning]}>{strings.chat.offlineSendBlocked}</Text>
    )}
  </>
}
