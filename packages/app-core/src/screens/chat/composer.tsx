import { DuotoneIcons, MotionPressable } from '../../ui/duotone-icons'
import { useMemo, useState, type ReactNode, type RefObject } from 'react'
import { ActivityIndicator, Text, TextInput, View } from 'react-native'
import { strings } from '../../locales/i18n'
import type { RemoteSession } from '../../types'
import { MentionPopover, splitDraftSegments, type MentionGroup } from '../../ui/mention-popover'
import { formatQuoteDraftSnippet } from '../../ui/quote-helpers'
import { QuoteMarkIcon } from '../../ui/quote-preview'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ExpandCornerIcon } from '../../ui/composer-expand-icons'
import { triggerLightHaptic } from '../../ui/haptics'
import { nextStackedOverflowLength, shouldShowExpandCorner, shouldUseStackedComposer } from './composer-gate'
import { createStyles } from './styles'

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

/** Shared input adapter so both Agent chat and DS-Bot reuse the same composer shell. */
export type ComposerInputBridge = {
  composerInputRef?: RefObject<TextInput | null>
  mentionType: string | null
  mentionGroups: MentionGroup[]
  selection?: { start: number; end: number }
  closeMention: () => void
  onChangeText: (value: string) => void
  onSelectionChange: (event: { nativeEvent: { selection: { start: number; end: number } } }) => void
}

type Props = {
  backend?: RemoteSession['backend']
  draft: string
  quotes?: string[]
  onRemoveQuote?: (index: number) => void
  /** Optional unified top tray content (images, files, upload status, referenced chats) mounted inside composerCard. */
  headerSlot?: ReactNode
  input: ComposerInputBridge
  accessibilityLabel?: string
  placeholder?: string
  highlightMentionTokens?: boolean
  replyActive: boolean
  stopping: boolean
  sending?: boolean
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

export function ChatComposer({ backend, draft, quotes, onRemoveQuote, headerSlot, input, accessibilityLabel, placeholder,
  highlightMentionTokens = true, replyActive, stopping, sending = false, commandRunning,
  hasComposerContent, connected, editable, composerDisabled, sendDisabled, compactComposer,
  composerInputMaxHeight, onOpenExpand, onOpenActions, onOpenPrompts, onSubmit, onStop }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { composerInputRef, mentionType, mentionGroups, selection, closeMention, onChangeText, onSelectionChange } = input
  const draftSegments = useMemo(() => (highlightMentionTokens ? splitDraftSegments(draft) : []), [draft, highlightMentionTokens])
  const hasTokens = useMemo(
    () => highlightMentionTokens && draftSegments.some(segment => segment.token),
    [draftSegments, highlightMentionTokens],
  )
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
  const resolvedLabel = accessibilityLabel ?? strings.chat[backendTextKeys.messageLabel]
  const resolvedPlaceholder = placeholder ?? strings.chat[backendTextKeys.placeholder]
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
  const showStopAndSend = (replyActive || commandRunning) && hasComposerContent
  const showPromptsButton = onOpenPrompts !== undefined && !showStopAndSend
  const hasHeaderSlot = headerSlot !== undefined && headerSlot !== null && headerSlot !== false
  const rightInlineReserve = 40
    + (showPromptsButton ? 40 : 0)
    + (showStopAndSend ? 40 : 0)
  return <>
    <View style={{ position: 'relative', zIndex: 20 }}>
      {mentionType !== null && (
        <MentionPopover groups={mentionGroups} onDismiss={closeMention} emptyText={strings.mention.noMatches} />
      )}
      <View style={[styles.composerCard, (hasQuotes || hasHeaderSlot) && styles.composerCardWithQuotes]}>
        {(hasHeaderSlot || hasQuotes) && (
          <View style={styles.composerTray}>
            {headerSlot}
            {hasQuotes && (
              <View style={styles.composerQuotesWrap}>
                {quotes.map((quoteText, index) => (
                  <MotionPressable
                    key={`inline-quote-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${strings.chat.removeQuote ?? '删除引用'}: ${quoteText}`}
                    onPress={() => onRemoveQuote?.(index)}
                    hitSlop={4}
                    scaleTo={0.94}
                    surfaceColor={colors.surfaceStrong}
                    style={styles.composerQuotePill}
                  >
                    <QuoteMarkIcon size={12} color={colors.ink} />
                    <Text numberOfLines={1} style={styles.composerQuotePillText}>
                      “{formatQuoteDraftSnippet(quoteText, 18)}”
                    </Text>
                    <DuotoneIcons.X size={12} color={colors.ink} surfaceColor={colors.surfaceStrong} />
                  </MotionPressable>
                ))}
              </View>
            )}
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
              accessibilityLabel={resolvedLabel}
              style={[
                styles.composerInput,
                isStacked && styles.composerInputStacked,
                draft.length === 0 && styles.composerInputEmpty,
                compactComposer && { maxHeight: composerInputMaxHeight },
              ]}
              value={!hasTokens ? draft : undefined}
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
              placeholder={resolvedPlaceholder}
              placeholderTextColor={colors.muted}
              multiline
              editable={editable}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
              children={inputChildren}
            />
          </View>
          <View pointerEvents="box-none" style={isStacked ? styles.composerActionsRow : styles.composerActionsOverlay}>
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.moreActions}
              accessibilityState={{ disabled: composerDisabled }}
              disabled={composerDisabled}
              onPress={() => {
                triggerLightHaptic()
                onOpenActions()
              }}
              hitSlop={6}
              scaleTo={0.9}
              surfaceColor={colors.elevated}
              style={({ pressed }) => [styles.plusButton, pressed && !composerDisabled && styles.plusPressed]}
            >
              <DuotoneIcons.Plus size={20} color={!composerDisabled ? colors.ink : colors.disabled} surfaceColor={colors.elevated} />
            </MotionPressable>
            <View style={styles.composerTrailing}>
              {showPromptsButton && (
                <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.chat.quickPrompts}
                  accessibilityState={{ disabled: composerDisabled }}
                  disabled={composerDisabled}
                  onPress={() => {
                    triggerLightHaptic()
                    onOpenPrompts()
                  }}
                  hitSlop={6}
                  scaleTo={0.9}
                  surfaceColor={colors.elevated}
                  style={({ pressed }) => [styles.composerShortcutButton, pressed && !composerDisabled && styles.plusPressed]}
                >
                  <DuotoneIcons.Zap size={19} color={!composerDisabled ? colors.ink : colors.disabled} surfaceColor={colors.elevated} />
                </MotionPressable>
              )}
              {(replyActive || commandRunning) && !hasComposerContent
                ? <MotionPressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.chat.stop}
                  accessibilityState={{ disabled: stopping, busy: stopping }}
                  disabled={stopping}
                  onPress={() => {
                    triggerLightHaptic()
                    onStop()
                  }}
                  hitSlop={6}
                  inverse
                  surfaceColor={colors.inverse}
                  scaleTo={0.9}
                  style={({ pressed }) => [styles.stopButton, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
                >
                  {stopping
                    ? <ActivityIndicator size="small" color={colors.onInverse} />
                    : <DuotoneIcons.CircleStop size={18} color={colors.onInverse} inverse surfaceColor={colors.inverse} />}
                </MotionPressable>
                : <>
                  {/* With text in the composer the primary action is the send
                    (queueing) button — tapping where Send lives must never stop
                    the running task (official InputBar behaviour). Stop stays
                    available as its own secondary button. */}
                  {(replyActive || commandRunning) && (
                    <MotionPressable
                      accessibilityRole="button"
                      accessibilityLabel={strings.chat.stop}
                      accessibilityState={{ disabled: stopping, busy: stopping }}
                      disabled={stopping}
                      onPress={() => {
                        triggerLightHaptic()
                        onStop()
                      }}
                      hitSlop={6}
                      inverse
                      surfaceColor={colors.inverse}
                      scaleTo={0.9}
                      style={({ pressed }) => [styles.stopButtonSmall, pressed && !stopping && styles.stopPressed, stopping && styles.sendDisabled]}
                    >
                      {stopping
                        ? <ActivityIndicator size="small" color={colors.onInverse} />
                        : <DuotoneIcons.CircleStop size={16} color={colors.onInverse} inverse surfaceColor={colors.inverse} />}
                    </MotionPressable>
                  )}
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel={strings.chat.send}
                    accessibilityState={{ disabled: sendDisabled, busy: sending }}
                    disabled={sendDisabled}
                    onPress={onSubmit}
                    hitSlop={6}
                    inverse={!sendDisabled}
                    surfaceColor={sendDisabled ? colors.surfaceStrong : colors.inverse}
                    scaleTo={0.9}
                    style={({ pressed }) => [styles.sendButton, pressed && styles.sendPressed, !sending && sendDisabled && styles.sendDisabled]}
                  >
                    {sending
                      ? <ActivityIndicator size="small" color={colors.onInverse ?? colors.white} />
                      : <DuotoneIcons.ArrowUp size={18} color={sendDisabled ? colors.subtle : (colors.onInverse ?? colors.white)} inverse={!sendDisabled} surfaceColor={sendDisabled ? colors.surfaceStrong : colors.inverse} />}
                  </MotionPressable>
                </>}
            </View>
          </View>
          {showExpand && (
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.expandComposer}
              onPress={onOpenExpand}
              hitSlop={6}
              scaleTo={0.9}
              style={({ pressed }) => [styles.composerExpandCorner, pressed && styles.plusPressed]}
            >
              <ExpandCornerIcon size={15} color={colors.muted} />
            </MotionPressable>
          )}
        </View>
      </View>
    </View>
    {draft.length > LONG_DRAFT_HINT && (
      <Text style={styles.composerHint}>{strings.chat.draftLong(draft.length)}</Text>
    )}
    {/* The draft survives a carrier drop; say so instead of silently
        swallowing an offline send tap (the primary action stays disabled). */}
    {!connected && (draft.length > 0 || hasComposerContent) && (
      <Text accessibilityLiveRegion="polite" style={[styles.composerHint, styles.composerHintWarning]}>{strings.chat.offlineSendBlocked}</Text>
    )}
  </>
}
