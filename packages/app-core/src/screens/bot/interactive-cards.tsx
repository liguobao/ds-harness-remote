import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { strings as s } from '../../locales/i18n'
import { object, text, type BotEntry, type BotObject, type BotState } from '../../services/bot-catalog'
import { Button } from '../../ui/components'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import type { BotPerform } from './editor'

function reviewReasonText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  const obj = object(raw)
  const lang = s.time.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  return text(obj[lang]) || text(obj.en) || text(obj.zh)
}

export function BotApprovalCard({
  approval,
  bot,
  disabled,
  perform,
}: {
  approval: BotObject
  bot?: BotEntry
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const { colors } = useTheme()
  const detail = object(approval.detail)
  const review = object(approval.review)
  const reviewStatus = text(review.status)
  const reviewReason = text(review.reason)
  const codeText = text(detail.code)
  const noteText = text(detail.text)
  const displayReason = reviewReasonText(approval.displayReason) || text(approval.reason)
  const taskTitle = text(approval.taskTitle)

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.heading} numberOfLines={2}>
          {[bot?.name, text(approval.tool)].filter(Boolean).join(' · ')}
        </Text>
        {Boolean(taskTitle) && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>{taskTitle}</Text>
          </View>
        )}
      </View>

      {reviewStatus !== '' && (
        <View style={[styles.badge, { alignSelf: 'flex-start', backgroundColor: colors.primarySoft }]}>
          <Text style={[styles.badgeText, { color: colors.primary }]}>
            {s.bots.autoReviewStatus(reviewStatus)}
          </Text>
        </View>
      )}

      {Boolean(displayReason) && <Text style={styles.body}>{displayReason}</Text>}
      {Boolean(reviewReason) && <Text style={styles.muted}>{reviewReason}</Text>}

      {Boolean(codeText) && (
        <View style={styles.codeBox}>
          <Text style={styles.codeText} selectable>{codeText}</Text>
        </View>
      )}
      {Boolean(noteText) && noteText !== codeText && (
        <Text style={styles.muted} numberOfLines={4}>{noteText}</Text>
      )}

      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.reject}
          disabled={disabled}
          onPress={() => void perform('approval-answer', { id: approval.id, choice: 'reject' })}
        />
        <Button
          label={s.bots.allow}
          disabled={disabled}
          onPress={() => void perform('approval-answer', { id: approval.id, choice: 'allow' })}
        />
      </View>
    </View>
  )
}

export function BotLearningCard({
  proposal,
  disabled,
  perform,
}: {
  proposal: BotObject
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const kind = text(proposal.kind)
  const title = kind === 'agents'
    ? s.bots.learningAgentsRule(text(proposal.folder))
    : s.bots.learningSkillProposal(text(proposal.name))
  const desc = text(proposal.description)
  const why = text(proposal.why)
  const edits = Array.isArray(proposal.edits) ? proposal.edits : []

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.kicker}>{s.bots.learningProposalTitle}</Text>
        {Boolean(proposal.action) && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{text(proposal.action)}</Text>
          </View>
        )}
      </View>
      <Text style={styles.heading}>{title}</Text>
      {Boolean(desc) && <Text style={styles.body}>{desc}</Text>}
      {Boolean(why) && <Text style={styles.muted}>{why}</Text>}
      {edits.length > 0 && (
        <View style={styles.codeBox}>
          {edits.slice(0, 3).map((raw, idx) => {
            const e = object(raw)
            return (
              <Text key={idx} style={styles.codeText} numberOfLines={3}>
                {`${text(e.op) || 'edit'}: ${text(e.text) || text(e.old)}`}
              </Text>
            )
          })}
        </View>
      )}
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.learningDecline}
          disabled={disabled}
          onPress={() => void perform('learning-answer', { id: proposal.id, approve: false })}
        />
        <Button
          label={s.bots.learningApprove}
          disabled={disabled}
          onPress={() => void perform('learning-answer', { id: proposal.id, approve: true })}
        />
      </View>
    </View>
  )
}

export function BotSecretRequestCard({
  request,
  disabled,
  perform,
}: {
  request: BotObject
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const { colors } = useTheme()
  const [value, setValue] = useState('')
  const [scopeMode, setScopeMode] = useState<'all' | 'bot'>('all')
  const needsFill = text(request.kind) === 'fill'
  const delivery = text(request.delivery) || 'vault'

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{s.bots.secretRequestTitle}</Text>
      <Text style={styles.heading}>{text(request.name)}</Text>
      {Boolean(request.purpose) && <Text style={styles.body}>{text(request.purpose)}</Text>}

      {needsFill && (
        <>
          <TextInput
            value={value}
            onChangeText={setValue}
            editable={!disabled}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={s.bots.secretValuePlaceholder}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          {delivery === 'vault' && (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([
                ['all', s.bots.secretScopeAll],
                ['bot', s.bots.secretScopeThisBot],
              ] as const).map(([mode, label]) => {
                const active = scopeMode === mode
                return (
                  <Pressable
                    key={mode}
                    disabled={disabled}
                    onPress={() => setScopeMode(mode)}
                    style={[styles.pill, active && { backgroundColor: colors.primary }]}
                  >
                    <Text style={[styles.pillText, active && { color: colors.white }]}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>
          )}
        </>
      )}

      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.cancel}
          disabled={disabled}
          onPress={() => void perform('secret-cancel', { requestId: request.id })}
        />
        {needsFill ? (
          <Button
            label={s.bots.save}
            disabled={disabled || value.trim() === ''}
            onPress={() => {
              const submitted = value
              setValue('')
              void perform('secret-set', { requestId: request.id, value: submitted, scope: scopeMode })
            }}
          />
        ) : (
          <Button
            label={s.bots.secretAllowUse}
            disabled={disabled}
            onPress={() => void perform('secret-allow', { requestId: request.id })}
          />
        )}
      </View>
    </View>
  )
}

export function BotMailSendCard({
  request,
  disabled,
  perform,
}: {
  request: BotObject
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const attachments = Array.isArray(request.attachments) ? request.attachments.filter((x): x is string => typeof x === 'string') : []
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{s.bots.mailSendTitle}</Text>
      <Text style={styles.heading}>{text(request.subject) || s.bots.mailSendTitle}</Text>
      <Text style={styles.muted}>
        {[`To: ${text(request.to)}`, text(request.cc) ? `Cc: ${text(request.cc)}` : ''].filter(Boolean).join(' · ')}
      </Text>
      {Boolean(request.body) && (
        <View style={styles.codeBox}>
          <Text style={styles.body} numberOfLines={5}>{text(request.body)}</Text>
        </View>
      )}
      {attachments.length > 0 && (
        <Text style={styles.muted}>{attachments.join(', ')}</Text>
      )}
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.cancel}
          disabled={disabled}
          onPress={() => void perform('mail-send-answer', { requestId: request.id, choice: 'cancel' })}
        />
        <Button
          label={s.bots.mailSend}
          disabled={disabled}
          onPress={() => void perform('mail-send-answer', { requestId: request.id, choice: 'send' })}
        />
      </View>
    </View>
  )
}

export function BotComputerAskCard({
  ask,
  botName,
  disabled,
  perform,
}: {
  ask: BotObject
  botName?: string
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const appName = text(ask.appName) || 'App'
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{s.bots.computer}</Text>
      <Text style={styles.heading}>{s.bots.computerAppAskTitle(appName)}</Text>
      {Boolean(botName) && <Text style={styles.muted}>{botName}</Text>}
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.reject}
          disabled={disabled}
          onPress={() => void perform('computer-app-answer', { id: ask.id, answer: 'deny' })}
        />
        <Button
          label={s.bots.allow}
          disabled={disabled}
          onPress={() => void perform('computer-app-answer', { id: ask.id, answer: 'once' })}
        />
      </View>
    </View>
  )
}

export function BotConnectorRequestCard({
  request,
  disabled,
  perform,
}: {
  request: BotObject
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const label = text(request.name) || text(request.connectorId)
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{s.bots.connectorRequestTitle(label)}</Text>
      <Text style={styles.muted}>{s.bots.desktopActionRequired}</Text>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.dismiss}
          disabled={disabled}
          onPress={() => void perform('connector-request-cancel', { requestId: request.id })}
        />
      </View>
    </View>
  )
}

export function BotWorkPausedCard({
  work,
  state,
  disabled,
  perform,
}: {
  work: BotObject
  state: BotState
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const toBot = state.bots.find(b => b.id === text(work.to))?.name ?? text(work.to)
  const summary = text(work.question) || text(work.goal) || text(work.reason) || s.bots.workPausedTitle
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{s.bots.workPausedTitle}</Text>
      {Boolean(toBot) && <Text style={styles.heading}>{toBot}</Text>}
      <Text style={styles.body}>{summary}</Text>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.workCancel}
          disabled={disabled}
          onPress={() => void perform('cancel-work', { id: work.id })}
        />
        <Button
          label={s.bots.workResume}
          disabled={disabled}
          onPress={() => void perform('resume-work', { id: work.id })}
        />
      </View>
    </View>
  )
}

export function BotBlockedCard({
  bot,
  sessionId,
  disabled,
  perform,
}: {
  bot: BotEntry
  sessionId: string
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const blocked = object(bot.blocked)
  const sessionFailure = object(bot.failures?.[sessionId])
  const failureCode = text(sessionFailure.code)
  const code = text(blocked.code) || (Boolean(bot.sessionMissing) ? 'SESSION_MISSING' : failureCode) || 'error'
  const detail = [
    text(blocked.provider),
    text(blocked.message) || text(blocked.reason) || text(sessionFailure.message) || text(sessionFailure.reason),
  ].filter(Boolean).join(' · ')
  const isOverflow = failureCode === 'OVERFLOW' || /overflow|context_length/i.test(code)
  const isMissingSession = Boolean(bot.sessionMissing) || code === 'SESSION_MISSING' || code === 'SESSION_NOT_FOUND'

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{s.bots.botBlockedTitle(code)}</Text>
      {Boolean(detail) && <Text style={styles.muted}>{detail}</Text>}
      <View style={styles.actions}>
        {isOverflow && (
          <Button
            variant="secondary"
            label={s.bots.botNewPart}
            disabled={disabled}
            onPress={() => void perform('new-part', { botId: bot.id, sessionId })}
          />
        )}
        {isMissingSession && (
          <Button
            variant="secondary"
            label={s.bots.botRecoverSession}
            disabled={disabled}
            onPress={() => void perform('recover-session', { botId: bot.id })}
          />
        )}
        <Button
          label={s.bots.retry}
          disabled={disabled}
          onPress={() => void perform('resume', { botId: bot.id })}
        />
      </View>
    </View>
  )
}

export function BotBrowserHandoffCard({
  botId,
  hold,
  disabled,
  perform,
}: {
  botId: string
  hold: BotObject
  disabled: boolean
  perform: BotPerform
}) {
  const styles = useThemedStyles(createInteractiveStyles)
  const callId = text(hold.callId)
  const note = text(hold.note) || text(hold.reason)
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{s.bots.browserHandoffTitle}</Text>
      {Boolean(note) && <Text style={styles.body}>{note}</Text>}
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={s.bots.stop}
          disabled={disabled}
          onPress={() => void perform('browser-stop', { botId })}
        />
        {callId ? (
          <>
            <Button
              variant="secondary"
              label={s.bots.browserSkip}
              disabled={disabled}
              onPress={() => void perform('browser-give-back', { botId, outcome: 'skip', callId })}
            />
            <Button
              label={s.bots.browserDone}
              disabled={disabled}
              onPress={() => void perform('browser-give-back', { botId, outcome: 'done', callId })}
            />
          </>
        ) : (
          <Button
            label={s.bots.browserGiveBack}
            disabled={disabled}
            onPress={() => void perform('browser-give-back', { botId })}
          />
        )}
      </View>
    </View>
  )
}

const createInteractiveStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      padding: 16,
      borderRadius: 20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      backgroundColor: colors.surface,
      gap: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    kicker: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    heading: {
      ...type.bodyStrong,
      color: colors.ink,
      flexShrink: 1,
    },
    body: {
      ...type.body,
      fontSize: 14,
      color: colors.ink,
    },
    muted: {
      ...type.small,
      color: colors.muted,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      backgroundColor: colors.grouped,
    },
    badgeText: {
      fontSize: 11.5,
      fontWeight: '600',
      color: colors.muted,
    },
    codeBox: {
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.grouped,
    },
    codeText: {
      fontFamily: 'monospace',
      fontSize: 12.5,
      lineHeight: 18,
      color: colors.ink,
    },
    input: {
      ...type.body,
      color: colors.ink,
      backgroundColor: colors.grouped,
      borderColor: colors.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minHeight: 42,
    },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.grouped,
    },
    pillText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.ink,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      gap: spacing.xs,
      paddingTop: 2,
    },
  })
