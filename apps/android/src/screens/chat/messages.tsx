import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  Images,
  ListTree,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Terminal,
  User,
  X,
} from 'lucide-react-native'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { strings as zhCN } from '../../locales/i18n'
import { hasVisibleMessageText } from '../../state/event-reducer'
import { useAppStore } from '../../state/store'
import type { UiArtifact } from '../../state/ui-artifacts'
import type {
  ApprovalActivity,
  ChatImage,
  ChatItem,
  ChatMessage,
  QuestionActivity,
  ToolActivity,
  ToolDisplayDetail,
} from '../../types'
import { Button, IconButton } from '../../ui/components'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../../ui/fish-logo'
import { NativeMarkdown } from '../../ui/markdown'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import type { ProcessActivity } from '../chat-process'
import { completedProcessTitle, processDetail, processSegments, toolActivity, toolDisplayName } from '../chat-process'
import { MessageActions } from '../message-actions'
import { IntelligentUiCard } from '../intelligent-ui-card'
import { createStyles } from './styles'

/** Only activity ranges fold; completing a turn must never hide spoken replies. */
export const ChatProcessGroup = memo(function ChatProcessGroup({ items, artifacts, updatedArtifacts, availableUiIds, busyAction, onApproval, onQuestion }: {
  items: ChatItem[]
  artifacts: UiArtifact[]
  updatedArtifacts: UiArtifact[]
  availableUiIds: ReadonlySet<string>
  busyAction?: string
  onApproval: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
  onQuestion: (itemId: string, selected: Record<string, string[]>, custom?: Record<string, string>) => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const backend = useAppStore(state => state.selectedSession?.backend)
  const last = items.at(-1)
  const codexClosed = backend === 'codex' && !items.some(isActiveChatItem)
    && last?.kind === 'message' && last.role === 'assistant'
  const end = items.find(item => item.turnEnd !== undefined)?.turnEnd
    ?? (codexClosed ? { reason: 'completed' as const, time: 0 } : undefined)
  const segments = useMemo(() => processSegments(items), [items])
  const unavailableUi = items.filter(item => item.kind === 'tool' && item.state === 'finished'
    && (item.toolKey === 'ui_render' || item.toolKey === 'ui_render_widget')
    && !availableUiIds.has(item.id)
    && (typeof item.uiResultMeta !== 'object' || item.uiResultMeta === null
      || (item.uiResultMeta as { ok?: unknown }).ok !== false))
  const label = end?.reason === 'stopped' ? zhCN.chatProcess.stopped
    : end?.reason === 'failed' ? zhCN.chat.failed : zhCN.chat.completed
  return <View style={styles.processGroup}>
    {end !== undefined && <View style={styles.turnProcessHeader}>
      <Text style={styles.turnProcessLabel}>{label}{end.reason !== 'completed' && end.detail !== undefined ? ` · ${end.detail}` : ''}</Text>
    </View>}
    {segments.map((segment, index) => segment.kind === 'response'
      ? <MessageBubble key={segment.key} item={segment.item} compact />
      : <ChatActivityGroup key={segment.key} items={segment.items} closed={end !== undefined || index < segments.length - 1}
        busyAction={busyAction} onApproval={onApproval} onQuestion={onQuestion} />)}
    {artifacts.map(ui => <IntelligentUiCard key={ui.hostId + ':' + ui.sessionId + ':' + ui.uiId} artifact={ui} />)}
    {updatedArtifacts.map(ui => <Text key={'updated:' + ui.uiId} style={[styles.pickerHint, { marginTop: 6 }]}>{ui.title || 'Interactive UI'} updated to version {ui.version}; see its original card above.</Text>)}
    {unavailableUi.map(item => <Text key={'ui-missing:' + item.id} style={[styles.pickerHint, { color: colors.danger, marginTop: 6 }]}>Interactive UI could not be restored from this Host result. Check the original tool output and history metadata.</Text>)}
  </View>
}, (prev, next) => {
  // Every field below is a reference that streaming rebuilds, so compare their
  // contents: a group whose text did not change keeps its rendered subtree.
  if (prev.busyAction !== next.busyAction) return false
  if (prev.onApproval !== next.onApproval || prev.onQuestion !== next.onQuestion) return false
  if (prev.items !== next.items) {
    if (prev.items.length !== next.items.length) return false
    for (let index = 0; index < prev.items.length; index += 1) {
      if (prev.items[index] !== next.items[index]) return false
    }
  }
  if (prev.artifacts !== next.artifacts) return false
  if (prev.updatedArtifacts !== next.updatedArtifacts) return false
  const before = prev.availableUiIds
  const after = next.availableUiIds
  if (before !== after) {
    if (before.size !== after.size) return false
    for (const id of before) {
      if (!after.has(id)) return false
    }
  }
  return true
})

const ChatActivityGroup = memo(function ChatActivityGroup({ items, closed, busyAction, onApproval, onQuestion }: {
  items: ChatItem[]
  closed: boolean
  busyAction?: string
  onApproval: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
  onQuestion: (itemId: string, selected: Record<string, string[]>, custom?: Record<string, string>) => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { height } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const body = useRef<ScrollView>(null)
  const pending = items.some(item => (item.kind === 'approval' || item.kind === 'question') && item.outcome === undefined)
  const expanded = pending || open
  const tools = items.filter((item): item is ToolActivity => item.kind === 'tool')
  const activeTool = closed ? undefined : tools.findLast(item => item.state === 'running')
  const runningReasoning = closed ? undefined : items.findLast(item => item.kind === 'message' && item.streamingPhase === 'reasoning')
  const running = activeTool !== undefined || runningReasoning !== undefined
  const counts = new Map<ProcessActivity, number>()
  for (const tool of tools) counts.set(toolActivity(tool), (counts.get(toolActivity(tool)) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([kind]) => kind)
  const labels = zhCN.chatProcess.processActivity
  const label = pending ? labels.questions.running
    : running ? labels[activeTool === undefined ? 'thinking' : toolActivity(activeTool)].running
      : completedProcessTitle(ranked)
  const detail = activeTool !== undefined ? processDetail(activeTool)
    : runningReasoning && runningReasoning.kind === 'message' ? compactActivityText(runningReasoning.reasoning)?.slice(-160) : undefined
  return <View style={styles.processGroup}>
    <Pressable accessibilityRole="button" accessibilityLabel={detail === undefined ? label : `${label} · ${detail}`}
      accessibilityState={{ expanded, disabled: pending }} disabled={pending}
      onPress={() => setOpen(value => !value)}
      style={({ pressed }) => [styles.processHeader, pressed && styles.reasoningHeaderPressed]}>
      {expanded ? <ChevronUp size={17} color={colors.muted} /> : <ChevronDown size={17} color={colors.muted} />}
      <Text style={styles.processLabel} numberOfLines={1}>{label}{detail === undefined ? '' : ` · ${detail}`}</Text>
    </Pressable>
    {expanded && <ScrollView ref={body} style={{ maxHeight: Math.min(400, height / 2) }} nestedScrollEnabled
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onLayout={() => { if (running) body.current?.scrollToEnd({ animated: false }) }}
      contentContainerStyle={styles.processBody}>
      {items.map(item => item.kind === 'message' && item.role === 'assistant' && !hasVisibleMessageText(item.text)
        ? <View key={item.id} style={styles.activityReasoning}><NativeMarkdown text={item.reasoning ?? ''} /></View>
        : <ChatItemView key={item.id} item={item} compact={false} busyAction={busyAction} onApproval={onApproval} onQuestion={onQuestion} />)}
    </ScrollView>}
  </View>
})

export const ChatItemView = memo(function ChatItemView({ item, busyAction, compact, onApproval, onQuestion }: {
  item: ChatItem
  busyAction?: string
  compact: boolean
  onApproval: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
  onQuestion: (itemId: string, selected: Record<string, string[]>, custom?: Record<string, string>) => Promise<void>
}) {
  if (item.kind === 'approval') return <ApprovalCard item={item} busy={busyAction === `approval:${item.id}`} onRespond={onApproval} />
  if (item.kind === 'question') return <QuestionCard item={item} busy={busyAction === `question:${item.id}`} onRespond={onQuestion} />
  if (item.kind === 'tool') return <ToolRow item={item} compact={compact} />
  if (!compact && item.role === 'assistant'
    && !hasVisibleMessageText(item.text)
    && hasVisibleMessageText(item.reasoning ?? '')) return <ReasoningDisclosure item={item} />
  return <MessageBubble item={item} compact={compact} />
})

/** Retry affordance for a kept failed/unconfirmed row, with guarded resend. */
function UserRowResend({ item, status }: { item: ChatMessage; status: string }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const busyAction = useAppStore(state => state.busyAction)
  const missingImages = (item.images?.length ?? 0) > 0 && (item.promptImages?.length ?? 0) === 0
  const disabled = busyAction !== undefined || missingImages
  const retry = () => {
    const state = useAppStore.getState()
    const backend = state.sessions.find(row => row.sessionId === item.sessionId)?.backend ?? state.selectedSession?.backend
    const resend = () => { void state.retrySendMessage(item.id) }
    // Harness dedupes by request rpcId (official hasPromptRequest), so only
    // the carriers without request ids need the double-execution warning.
    if (item.sendState === 'unconfirmed' && backend !== undefined && backend !== 'harness') {
      Alert.alert(zhCN.chat.sendUnconfirmed, zhCN.chat.resendConfirm, [
        { text: zhCN.common.cancel, style: 'cancel' },
        { text: zhCN.chat.resend, onPress: resend },
      ])
    } else resend()
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${status} · ${zhCN.chat.resend}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={retry}
      style={({ pressed }) => [styles.resendRow, pressed && !disabled && styles.resendRowPressed, disabled && styles.resendRowDisabled]}
    >
      <RefreshCw size={13} color={disabled ? colors.muted : colors.danger} />
      <Text style={[styles.resendText, disabled && styles.resendTextMuted, !disabled && styles.resendTextFailed]}>
        {missingImages ? zhCN.chat.resendImageMissing : `${status} · ${zhCN.chat.resend}`}
      </Text>
    </Pressable>
  )
}

function MessageBubble({ item, compact }: { item: ChatMessage; compact: boolean }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const user = item.role === 'user'
  const remote = item.role === 'assistant'
  const showReasoning = !compact && remote && hasVisibleMessageText(item.reasoning ?? '')
  const showText = hasVisibleMessageText(item.text)
  const showImages = item.images !== undefined && item.images.length > 0
  const showStreaming = item.streaming === true && item.streamingPhase !== 'reasoning'

  // Harness renders assistant prose directly on the conversation canvas.
  if (remote) {
    return (
      <View style={styles.assistantBlock}>
        {showReasoning && <ReasoningDisclosure item={item} />}
        {showImages && <ChatImages images={item.images!} />}
        {showText && (
          <View style={styles.assistantText}>
            <NativeMarkdown text={item.text} />
          </View>
        )}
        {showStreaming && (
          <View style={styles.assistantText}>
            <StreamingCursor />
          </View>
        )}
        {!item.streaming && showText && <MessageActions item={item} />}
      </View>
    )
  }

  if (user) {
    const undelivered = item.sendState === 'failed' || item.sendState === 'unconfirmed'
    const status = item.sendError ?? (item.sendState === 'failed' ? zhCN.chat.sendFailed : zhCN.chat.sendUnconfirmed)
    return <View style={styles.userBlock}>
      <View style={styles.userBubble}>
        {showImages && <ChatImages images={item.images!} alignEnd />}
        {showText && <NativeMarkdown text={item.text} />}
      </View>
      {item.sendState === 'canceled'
        ? <Text style={styles.canceledText}>{zhCN.chat.sendCanceled}</Text>
        : undelivered
          ? <UserRowResend item={item} status={status} />
          : <MessageActions item={item} />}
      {/* Failed rows keep their actions: losing copy would be a regression. */}
      {undelivered && item.sendState !== 'canceled' && <MessageActions item={item} />}
    </View>
  }

  return (
    <View style={[styles.messageRow, user && styles.messageRowUser]}>
      <View style={[styles.avatar, user ? styles.avatarUser : styles.avatarAssistant]}>
        {user ? (
          <User size={16} color={colors.white} />
        ) : (
          <Bot size={17} color={colors.primary} />
        )}
      </View>
      <View style={[styles.messageBody, user && styles.messageBodyUser]}>
        <Text style={styles.messageLabel}>{user ? zhCN.chat.you : zhCN.chat.system}</Text>
        {showImages && <ChatImages images={item.images!} alignEnd={user} />}
        {showText && <NativeMarkdown text={item.text} />}
        {showStreaming && <StreamingCursor />}
      </View>
    </View>
  )
}

function ReasoningDisclosure({ item }: { item: ChatMessage }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [expanded, setExpanded] = useState(false)
  const active = item.streamingPhase === 'reasoning'
  const label = active ? zhCN.chat.reasoningActive : zhCN.chat.reasoning
  const preview = compactActivityText(item.reasoning) ?? ''
  const actionLabel = expanded ? zhCN.chat.reasoningCollapse : zhCN.chat.reasoningExpand
  return (
    <View style={styles.reasoningCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${actionLabel}。${preview}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.reasoningHeader, pressed && styles.reasoningHeaderPressed]}
      >
        <Sparkles size={16} color={active ? colors.accent : colors.muted} />
        <Text style={[styles.reasoningLabel, active && styles.reasoningLabelActive]}>{label}</Text>
        <Text style={styles.activitySeparator}>·</Text>
        <Text style={styles.reasoningPreview} numberOfLines={1}>{preview}</Text>
        {expanded
          ? <ChevronDown size={17} color={colors.muted} />
          : <ChevronRight size={17} color={colors.muted} />}
      </Pressable>
      {expanded && <View style={styles.reasoningBody}><NativeMarkdown text={item.reasoning ?? ''} /></View>}
    </View>
  )
}

function ToolRow({ item, compact }: { item: ToolActivity; compact: boolean }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [expanded, setExpanded] = useState(false)
  const stateText = item.state === 'running' ? zhCN.status.running : item.state === 'failed' ? zhCN.chat.failed : zhCN.chat.completed
  const detail = processDetail(item)
  const name = toolDisplayName(item)
  const hasDetail = !compact && (item.callDetail !== undefined || item.resultDetail !== undefined)
  return (
    <View style={[styles.toolCard, expanded && styles.toolCardExpanded]}>
      <Pressable
        accessibilityRole={hasDetail ? 'button' : undefined}
        accessibilityLabel={hasDetail ? (expanded ? zhCN.chat.toolCollapse(name) : zhCN.chat.toolExpand(name)) : undefined}
        accessibilityState={hasDetail ? { expanded } : undefined}
        disabled={!hasDetail}
        onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.toolRow, pressed && hasDetail && styles.toolRowPressed]}
      >
        <View style={styles.toolIcon}>{/command|bash|shell|命令|终端/i.test(item.toolName)
          ? <Terminal size={16} color={colors.muted} /> : <Code2 size={16} color={colors.muted} />}</View>
        <View style={styles.toolCopy}>
          <Text style={styles.toolName} numberOfLines={1}>{name}</Text>
          {detail !== undefined && <Text style={styles.activitySeparator}>·</Text>}
          {detail !== undefined && <Text style={styles.toolSummary} numberOfLines={1}>{detail}</Text>}
        </View>
        {item.state === 'failed' && <Text style={styles.toolFailed}>{stateText}</Text>}
        {hasDetail && (expanded
          ? <ChevronDown size={17} color={colors.muted} />
          : <ChevronRight size={17} color={colors.muted} />)}
      </Pressable>
      {item.images !== undefined && item.images.length > 0 && <ChatImages images={item.images} tool />}
      {expanded && hasDetail && (
        <View style={styles.toolDetails}>
          {item.callDetail !== undefined && <ToolDetailView label={zhCN.chat.toolCall} detail={item.callDetail} />}
          {item.resultDetail !== undefined && <ToolDetailView label={zhCN.chat.toolResult} detail={item.resultDetail} />}
        </View>
      )}
    </View>
  )
}

export function ChatImages({ images, alignEnd = false, tool = false }: { images: ChatImage[]; alignEnd?: boolean; tool?: boolean }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={[styles.messageImages, alignEnd && styles.messageImagesUser, tool && styles.toolImages]}>
      {images.map((image, index) => image.uri !== undefined
        ? <Image key={`${image.uri}:${index}`} source={{ uri: image.uri }} style={styles.messageImage} resizeMode="cover" />
        : (
          <View key={`${image.name ?? 'image'}:${index}`} style={styles.messageImagePlaceholder}>
            <Images size={20} color={colors.primary} />
            <Text style={styles.messageImageName} numberOfLines={1}>{image.name ?? zhCN.chat.unnamedImage}</Text>
          </View>
        ))}
    </View>
  )
}

function ToolDetailView({ label, detail }: { label: string; detail: ToolDisplayDetail }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.toolDetailBlock}>
      <Text style={styles.toolDetailLabel}>{label}</Text>
      {detail.format === 'markdown'
        ? <NativeMarkdown text={detail.text} />
        : <Text selectable style={styles.toolDetailCode}>{detail.text}</Text>}
      {detail.truncated && <Text style={styles.toolDetailTruncated}>{zhCN.chat.toolTruncated}</Text>}
    </View>
  )
}

function compactActivityText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const compact = value.replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim()
  return compact.length === 0 ? undefined : compact
}

function ApprovalCard({ item, busy, onRespond }: {
  item: ApprovalActivity
  busy: boolean
  onRespond: (itemId: string, outcome: 'allowed-once' | 'rejected') => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  if (item.outcome !== undefined) {
    const denied = item.outcome === 'rejected' || item.outcome === 'cancelled' || item.outcome === 'unavailable'
    const handledElsewhere = item.outcome === 'unavailable'
    return (
      <View style={styles.permissionResolved}>
        {denied && !handledElsewhere ? <X size={18} color={colors.danger} /> : <Check size={18} color={colors.success} />}
        <Text style={styles.permissionResolvedText}>{handledElsewhere ? zhCN.chat.approvalHandled : denied ? zhCN.chat.denied : zhCN.chat.allowedOnce}</Text>
      </View>
    )
  }
  return (
    <View style={styles.permissionCard} accessibilityRole="alert">
      <View style={styles.permissionHeader}>
        <View style={styles.permissionIcon}><ShieldAlert size={20} color={colors.warning} /></View>
        <View style={styles.permissionHeaderCopy}>
          <Text style={styles.permissionTitle}>{zhCN.chat.permissionTitle}</Text>
          <Text style={styles.permissionKind}>{zhCN.chat.hostOperation(item.toolName)}</Text>
        </View>
      </View>
      {item.reason !== undefined && (
        <View style={styles.permissionDetail}>
          <Text selectable style={styles.permissionText}>{item.reason}</Text>
        </View>
      )}
      <Text style={styles.permissionScope}>{zhCN.chat.permissionScope}</Text>
      <View style={styles.permissionActions}>
        <Button label={zhCN.chat.allowOnce} onPress={() => void onRespond(item.id, 'allowed-once')} loading={busy} />
        <Button label={zhCN.chat.deny} variant="quiet" onPress={() => void onRespond(item.id, 'rejected')} disabled={busy} />
      </View>
    </View>
  )
}

function QuestionCard({ item, busy, onRespond }: {
  item: QuestionActivity
  busy: boolean
  onRespond: (itemId: string, selected: Record<string, string[]>, custom?: Record<string, string>) => Promise<void>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (item.deadline === undefined || item.outcome !== undefined) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [item.deadline, item.outcome])
  const remaining = item.deadline === undefined ? undefined : Math.max(0, Math.ceil((item.deadline - now) / 1000))

  if (item.outcome !== undefined) {
    return (
      <View style={styles.permissionResolved}>
        <Check size={18} color={colors.success} />
        <Text style={styles.permissionResolvedText}>{item.outcome === 'answered' ? zhCN.chat.answered : item.outcome === 'queued' ? zhCN.chat.questionQueued : zhCN.chat.questionCancelled}</Text>
      </View>
    )
  }

  const toggle = (questionId: string, label: string, multi: boolean) => {
    const values = selected[questionId] ?? []
    const next = multi
      ? (values.includes(label) ? values.filter(value => value !== label) : [...values, label])
      : values.includes(label) ? [] : [label]
    // Custom text is mutually exclusive with a selection: clear it only when an
    // option becomes selected, never when the user merely deselects.
    if (!multi && next.length > 0) {
      setCustom(current => (current[questionId] ?? '') === '' ? current : { ...current, [questionId]: '' })
    }
    setSelected(current => ({ ...current, [questionId]: next }))
  }

  const allAnswered = item.questions.every(question => (selected[question.id] ?? []).length > 0
    || (custom[question.id] ?? '').trim().length > 0)

  return (
    <View style={styles.questionCard} accessibilityRole="alert">
      <View style={styles.permissionHeader}>
        <View style={styles.permissionIcon}><ShieldAlert size={20} color={colors.accent} /></View>
        <View style={styles.permissionHeaderCopy}>
          <Text style={styles.permissionTitle}>{zhCN.chat.questionTitle}</Text>
          <Text style={styles.permissionKind}>{item.questionState === 'continued' ? zhCN.chat.questionContinued : remaining === undefined ? zhCN.chat.answerToContinue : zhCN.chat.questionRemaining(remaining)}</Text>
        </View>
      </View>
      {item.questions.map(question => (
        <View key={question.id} style={styles.questionBlock}>
          <Text style={styles.questionText}>{question.question}</Text>
          {question.detail !== undefined && <Text selectable style={styles.questionDetail}>{question.detail}</Text>}
          {(question.options ?? []).map(option => {
            const chosen = (selected[question.id] ?? []).includes(option.label)
            return (
              <Pressable
                key={option.label}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
                onPress={() => toggle(question.id, option.label, question.multiSelect === true)}
                style={[styles.optionRow, chosen && styles.optionChosen]}
              >
                <View style={[styles.optionDot, chosen && styles.optionDotChosen]}>{chosen && <Check size={12} color={colors.white} />}</View>
                <Text style={styles.optionLabel}>{option.label}</Text>
              </Pressable>
            )
          })}
          <TextInput
            style={styles.questionCustom}
            accessibilityLabel={zhCN.chat.questionCustomPlaceholder}
            placeholder={zhCN.chat.questionCustomPlaceholder}
            placeholderTextColor={colors.muted}
            value={custom[question.id] ?? ''}
            onChangeText={text => {
              // Official semantics: a single-select question keeps selection and
              // custom text mutually exclusive; multi-select allows both.
              if (question.multiSelect !== true && text.trim().length > 0) {
                setSelected(current => ({ ...current, [question.id]: [] }))
              }
              setCustom(current => ({ ...current, [question.id]: text }))
            }}
            multiline
          />
        </View>
      ))}
      <Button label={zhCN.chat.submitAnswer} onPress={() => void onRespond(item.id, selected, custom)} loading={busy} disabled={!allAnswered || (item.questionState === 'open' && remaining === 0)} />
    </View>
  )
}

/** Compact DSH QueueDock mirror: queued prompts waiting for the next turn. */
export function QueueDock({ items }: { items: { id?: string; rpcId?: string; preview: string }[] }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.queueDock} accessibilityRole="summary" accessibilityLabel={zhCN.chat.queueTitle(items.length)}>
      <View style={styles.queueDockHeader}>
        <ListTree size={14} color={colors.primary} />
        <Text style={styles.queueDockTitle}>{zhCN.chat.queueTitle(items.length)}</Text>
      </View>
      {items.map((item, index) => (
        <View key={item.id ?? `local:${index}`} style={styles.queueDockRow}>
          <Text style={styles.queueDockText} numberOfLines={1}>{item.preview.trim().length > 0 ? item.preview.trim() : zhCN.chat.queuePending}</Text>
          {item.id !== undefined && <>
            {/* The stop-loss path: without remove/steer a mis-queued prompt can
                only be stopped by killing the running task (official QueueDock
                offers edit/remove/steer per row). */}
            <IconButton label={zhCN.chat.queueSteer} icon={ArrowUp} dense
              onPress={() => void useAppStore.getState().updateQueueItem(item.id!, 'steer', item.rpcId)} />
            <IconButton label={zhCN.chat.queueRemove} icon={X} dense
              onPress={() => void useAppStore.getState().updateQueueItem(item.id!, 'remove', item.rpcId)} />
          </>}
        </View>
      ))}
    </View>
  )
}

export function WelcomeMessage() {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.welcome}>
      <Svg
        width={76}
        height={(76 * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
        viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      >
        <Path d={FISH_LOGO_PATH} fill={colors.ink} />
      </Svg>
      <View style={styles.welcomeRow}>
        <Text style={styles.welcomeSlogan}>{zhCN.chat.welcomeSlogan}</Text>
        <View style={styles.welcomeBadge}>
          <Text style={styles.welcomeBadgeText}>{zhCN.chat.welcomeBadge}</Text>
        </View>
      </View>
    </View>
  )
}

function StreamingCursor() {
  const opacity = useRef(new Animated.Value(1)).current
  const styles = useThemedStyles(createStyles)

  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.2, duration: 450, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]))
    animation.start()
    return () => animation.stop()
  }, [opacity])

  return <Animated.View style={[styles.streamingCursor, { opacity }]} accessibilityLabel={zhCN.chat.generating} />
}

export function ReplyStatusDots() {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const progress = useRef(new Animated.Value(0)).current
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (mounted) setReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  useEffect(() => {
    if (reduceMotion) return
    const animation = Animated.loop(Animated.timing(progress, {
      toValue: 3,
      duration: 900,
      useNativeDriver: true,
    }))
    animation.start()
    return () => animation.stop()
  }, [progress, reduceMotion])

  return (
    <View style={styles.replyDots} importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map(index => (
        <Animated.Text
          key={index}
          style={[styles.replyDot, {
            color: colors.accent, opacity: reduceMotion ? 1 : progress.interpolate({
              inputRange: [index, index + 0.5, index + 1],
              outputRange: [0.25, 1, 0.25],
              extrapolate: 'clamp',
            })
          }]}
        >·</Animated.Text>
      ))}
    </View>
  )
}

export function isActiveChatItem(item: ChatItem): boolean {
  if (item.turnEnd !== undefined) return false
  if (item.kind === 'message') return item.streaming === true
  if (item.kind === 'tool') return item.state === 'running'
  if (item.kind === 'approval' || item.kind === 'question') return item.outcome === undefined
  return false
}
