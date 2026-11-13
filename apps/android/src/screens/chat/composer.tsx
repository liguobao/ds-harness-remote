import { ArrowUp, ChevronDown, CircleStop, Plus, X, Zap } from 'lucide-react-native'
import { useMemo } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { strings } from '../../locales/i18n'
import type { RemoteSession } from '../../types'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../../ui/fish-logo'
import { MentionPopover, splitDraftSegments } from '../../ui/mention-popover'
import { formatQuoteDraftSnippet } from '../../ui/quote-helpers'
import { QuoteMarkIcon } from '../../ui/quote-preview'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ReplyStatusDots } from './messages'
import { ExpandCornerIcon } from '../../ui/composer-expand-icons'
import { createStyles } from './styles'
import type { useChatMentions } from './use-chat-mentions'

type BackendChatTextKeys = Record<
  'generating' | 'messageLabel' | 'placeholder' | 'policyHint',
  { [Key in keyof typeof strings.chat]: typeof strings.chat[Key] extends string ? Key : never }[keyof typeof strings.chat]
>

// Resolve these keys during rendering so language changes use the current catalog.
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
  compactRunning: boolean
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
  model: { available: boolean; label: string | undefined; selecting: boolean; onOpen: () => void }
  promptsPickerOpen: boolean
  onExpand: () => void
  onOpenExpand?: () => void
  onOpenActions: () => void
  onOpenPrompts: () => void
  onSubmit: () => void
  onStop: () => void
}

export function ChatComposer({ backend, draft, quotes, onRemoveQuote, input, replyActive, stopping, compactRunning, commandRunning,
  hasComposerContent, connected, editable, composerDisabled, sendDisabled, compactComposer,
  composerInputMaxHeight, model, promptsPickerOpen, onExpand, onOpenExpand, onOpenActions, onOpenPrompts, onSubmit, onStop }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { composerInputRef, mentionType, mentionGroups, selection, closeMention, onChangeText, onSelectionChange } = input
  const draftSegments = useMemo(() => splitDraftSegments(draft), [draft])
  const backendTextKeys = BACKEND_CHAT_TEXT_KEYS[backend ?? 'harness'] ?? BACKEND_CHAT_TEXT_KEYS.harness
  const replyStatusLabel = stopping ? strings.chat.stopping : strings.chat[backendTextKeys.generating]
  const showExpand = draft.length > 0 && !compactRunning && onOpenExpand !== undefined
  const hasQuotes = quotes !== undefined && quotes.length > 0
  return <>
    {replyActive && (
      <View
        accessible
        accessibilityLabel={replyStatusLabel}
        accessibilityLiveRegion="polite"
        style={styles.replyStatus}
      >
        <Svg width={15} height={15} viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`} accessible={false}><Path d={FISH_LOGO_PATH} fill={colors.accent} /></Svg>
        <Text style={styles.replyStatusText}>{replyStatusLabel}</Text>
        {!stopping && <ReplyStatusDots />}
      </View>
    )}
    <View style={{ position: 'relative', zIndex: 20, elevation: 20 }}>
      {mentionType !== null && (
        <MentionPopover groups={mentionGroups} onDismiss={closeMention} emptyText={strings.mention.noMatches} />
      )}
      {compactRunning ? <View style={[styles.composerCard, styles.runningComposer]}>
        <Pressable accessibilityRole="button" accessibilityLabel={strings.chat.moreActions} onPress={onOpenActions}
          hitSlop={6}
          style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed]}>
          <Plus size={19} color={colors.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={strings.sessionActivity.composeRunning}
          onPress={onExpand} style={styles.runningComposerPrompt}>
          <Text style={styles.runningComposerText} numberOfLines={1}>{strings.sessionActivity.composeRunning}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={strings.chat.stop} disabled={stopping}
          accessibilityState={{ disabled: stopping, busy: stopping }} onPress={onStop}
          hitSlop={6}
          style={({ pressed }) => [styles.stopButton, pressed && !stopping && styles.stopPressed]}>
          {stopping ? <ActivityIndicator size="small" color={colors.onInverse} /> : <CircleStop size={18} color={colors.onInverse} />}
        </Pressable>
      </View> : <View style={styles.composerCard}>
        {showExpand && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.expandComposer}
            onPress={onOpenExpand}
            hitSlop={8}
            style={({ pressed }) => [styles.composerExpandButton, pressed && styles.plusPressed]}
          >
            <ExpandCornerIcon size={16} color={colors.muted} />
          </Pressable>
        )}
        {hasQuotes && (
          <View style={[styles.composerQuotesWrap, showExpand && { paddingRight: 36 }]}>
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
        <View style={styles.composerInputWrap}>
          {/* Native attributed text keeps references blue without an opaque Android value layer. */}
          <TextInput
            ref={composerInputRef}
            accessibilityLabel={strings.chat[backendTextKeys.messageLabel]}
            style={[styles.composerInput, compactComposer && { maxHeight: composerInputMaxHeight }, showExpand && !hasQuotes && { paddingRight: 32 }]}
            onChangeText={onChangeText}
            onSelectionChange={onSelectionChange}
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
          >
            <Text>{draftSegments.map((segment, index) => <Text key={index} style={{ color: segment.token ? colors.primary : colors.ink }}>{segment.text}</Text>)}</Text>
          </TextInput>
        </View>
        <View style={styles.composerControls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.moreActions}
            accessibilityState={{ disabled: composerDisabled }}
            disabled={composerDisabled}
            onPress={onOpenActions}
            hitSlop={6}
            style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed, composerDisabled && styles.plusDisabled]}
          >
            <Plus size={19} color={connected ? colors.ink : colors.disabled} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.quickPrompts}
            accessibilityState={{ disabled: composerDisabled, expanded: promptsPickerOpen }}
            disabled={composerDisabled}
            onPress={onOpenPrompts}
            hitSlop={6}
            style={({ pressed }) => [styles.plusButton, pressed && styles.plusPressed, composerDisabled && styles.plusDisabled]}
          >
            <Zap size={17} color={connected ? colors.ink : colors.disabled} strokeWidth={1.9} />
          </Pressable>
          <View style={styles.composerSpacer} />
          {model.available && (
            <Pressable accessibilityRole="button" accessibilityLabel={strings.chat.selectModel} onPress={model.onOpen} hitSlop={4} style={styles.modelChip}>
              <Text style={styles.modelChipText} numberOfLines={1}>{model.label}</Text>
              {model.selecting ? <ActivityIndicator size="small" color={colors.muted} /> : <ChevronDown size={14} color={colors.muted} />}
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
                <ArrowUp size={18} color={sendDisabled ? colors.subtle : colors.white} strokeWidth={2.4} />
              </Pressable>
            </>}
        </View>
      </View>}
    </View>
    {draft.length > LONG_DRAFT_HINT && (
      <Text style={styles.composerHint}>{strings.chat.draftLong(draft.length)}</Text>
    )}
    {/* The draft survives a carrier drop; say so instead of silently
        swallowing an offline send tap (the primary action stays disabled). */}
    {!connected && draft.length > 0 && (
      <Text accessibilityLiveRegion="polite" style={[styles.composerHint, styles.composerHintWarning]}>{strings.chat.offlineSendBlocked}</Text>
    )}
    {/* Landscape phones leave almost no space above the IME once the
        composer is visible; keep the privacy note for roomier windows. */}
    {!compactComposer && (
      <Text style={styles.composerHint}>
        {strings.chat[backendTextKeys.policyHint]}
      </Text>
    )}
  </>
}
