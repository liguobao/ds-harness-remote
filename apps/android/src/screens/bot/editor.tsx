import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Alert } from '../../ui/alert'
import { strings as s } from '../../locales/i18n'
import { canDeleteBot, object, objects, text, type BotEntry, type BotRoom, type BotState, type BotOperation, type BotObject, type BotRemoteClient } from '../../services/bot-catalog'
import { ChevronDown, ChevronUp, RotateCcw, Trash2, X } from 'lucide-react-native'
import { Button, IconButton } from '../../ui/components'
import { radius, spacing, type } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { SheetModal } from '../../ui/sheet'
import { useResponsiveLayout } from '../../ui/responsive'
import { Toggle } from '../../ui/toggle'
import { BotAgentBadge, engineOfModel } from './agent-badge'
import { BotChoice } from './controls'
import { BotFolderPickerModal, folderBasename } from './shared-panels'
import { createBotStyles } from './styles'

export type BotPerform = (operation: BotOperation, payload?: BotObject) => Promise<{ ok: boolean; value?: unknown }>

function groupBotModels(models: BotObject[]): { provider: string; label: string; items: BotObject[] }[] {
  const groups = new Map<string, BotObject[]>()
  for (const model of models) {
    const ref = text(model.ref)
    const provider = text(model.provider) || text(model.providerName) || ref.split('/')[0] || 'default'
    const existing = groups.get(provider)
    if (existing) existing.push(model)
    else groups.set(provider, [model])
  }
  const counts = new Map<string, number>()
  for (const [provider, list] of groups) {
    const name = text(list[0]?.providerName) || provider
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...groups].map(([provider, items]) => {
    const name = text(items[0]?.providerName) || provider
    const label = (counts.get(name) ?? 0) > 1 ? `${name} (${provider})` : name
    return { provider, label, items }
  })
}

export function BotEffortBar({
  efforts,
  defaultEffort,
  current,
  disabled,
  onPick,
}: {
  efforts: BotObject[]
  defaultEffort?: string
  current: string
  disabled?: boolean
  onPick: (effort: string) => void
}) {
  const localStyles = useThemedStyles(createEditorStyles)
  const { colors } = useTheme()

  const stops = useMemo(() => {
    const parsed = efforts
      .map(entry => {
        const id = text(entry.id) || text(entry.value)
        const label = text(entry.name) || text(entry.label) || id
        return { id, label }
      })
      .filter(entry => entry.id !== '')
    if (parsed.length === 0) return []
    const hasDefault = defaultEffort !== undefined && defaultEffort !== '' && parsed.some(item => item.id === defaultEffort)
    return hasDefault ? parsed : [{ id: '', label: s.bots.defaultEffort }, ...parsed]
  }, [efforts, defaultEffort])

  if (stops.length === 0) return null

  const hasDefault = defaultEffort !== undefined && defaultEffort !== '' && stops.some(item => item.id === defaultEffort)
  const activeEffortId = current || (hasDefault ? defaultEffort! : '')
  const activeIndex = Math.max(0, stops.findIndex(stop => stop.id === activeEffortId))
  const activeStop = stops[activeIndex] ?? stops[0]!
  const canReset = current !== ''

  return (
    <View style={localStyles.effortCard} accessibilityRole="adjustable" accessibilityLabel={s.bots.effort}>
      <View style={localStyles.effortHeader}>
        <Text style={localStyles.effortTitle}>{s.bots.effort}</Text>
        <View style={localStyles.effortMeta}>
          {current === '' && hasDefault && (
            <View style={localStyles.defaultTag}>
              <Text style={localStyles.defaultTagText}>{s.bots.defaultEffort}</Text>
            </View>
          )}
          <Text style={localStyles.effortValue}>{activeStop.label}</Text>
          {(canReset || !hasDefault) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={s.bots.resetEffort}
              disabled={disabled || !canReset}
              onPress={() => onPick('')}
              hitSlop={8}
              style={({ pressed }) => [
                localStyles.resetBtn,
                (!canReset || disabled) && { opacity: 0.35 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <RotateCcw size={13} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <View style={localStyles.effortTrackWrap}>
        <View style={localStyles.effortTrackLine} />
        <View style={localStyles.effortStopsRow}>
          {stops.map((stop, index) => {
            const filled = index <= activeIndex
            const selected = index === activeIndex
            return (
              <Pressable
                key={stop.id || 'default'}
                accessibilityRole="button"
                accessibilityLabel={`${s.bots.effort}: ${stop.label}`}
                accessibilityState={{ selected }}
                disabled={disabled}
                onPress={() => onPick(stop.id)}
                style={({ pressed }) => [localStyles.effortStopTouch, pressed && { opacity: 0.75 }]}
              >
                <View
                  style={[
                    localStyles.effortDot,
                    filled && localStyles.effortDotFilled,
                    selected && localStyles.effortKnob,
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={[localStyles.effortStopLabel, selected && localStyles.effortStopLabelActive]}
                >
                  {stop.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

export function BotEditor({ kind, bot, room, state, client, busy, error, perform, onClose }: {
  kind: 'bot' | 'room'; bot?: BotEntry; room?: BotRoom; state: BotState; client: BotRemoteClient
  busy: boolean; error?: string; perform: BotPerform; onClose: () => void
}) {
  const styles = useThemedStyles(createBotStyles)
  const localStyles = useThemedStyles(createEditorStyles)
  const { colors } = useTheme()
  const { compactHeight } = useResponsiveLayout()
  const insets = useSafeAreaInsets()
  const editing = bot !== undefined || room !== undefined
  const [modelPicker, setModelPicker] = useState(false)
  const [name, setName] = useState(bot?.name ?? room?.name ?? '')
  const [role, setRole] = useState(bot?.role ?? '')
  const [instructions, setInstructions] = useState(bot?.instructions ?? '')
  const [notice, setNotice] = useState(room?.notice ?? '')
  const [members, setMembers] = useState(room?.members ?? [])
  const [admin, setAdmin] = useState(room?.admin ?? '')
  const [model, setModel] = useState(bot?.model ?? '')
  const [effort, setEffort] = useState(bot?.effort ?? '')
  const [workDir, setWorkDir] = useState(bot?.workDir ?? room?.workDir ?? '')
  const [permission, setPermission] = useState(bot?.permission ?? text(state.permissions?.defaultPreset) ?? 'workspace-write')
  const [isPrivate, setIsPrivate] = useState(Boolean(bot?.private))
  const [pinned, setPinned] = useState(Boolean(bot?.pinned ?? room?.pinned))
  const [hidden, setHidden] = useState(Boolean(bot?.hidden ?? room?.hidden))
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [efforts, setEfforts] = useState<BotObject[]>([])
  const [defaultEffort, setDefaultEffort] = useState<string | undefined>(undefined)
  useEffect(() => {
    const control = new AbortController()
    setEfforts([])
    setDefaultEffort(undefined)
    if (!model) return () => control.abort()
    const served = state.models.find(entry => text(entry.ref) === model)
    const servedReasoning = object(served?.reasoning)
    if (Array.isArray(servedReasoning.efforts) && servedReasoning.efforts.length > 0) {
      setEfforts(objects(servedReasoning.efforts))
      setDefaultEffort(text(servedReasoning.defaultEffort) || undefined)
      return () => control.abort()
    }
    void client.call('efforts', { ref: model }, control.signal).then(value => {
      if (!control.signal.aborted) {
        const obj = object(value)
        setEfforts(objects(obj.efforts).length > 0 ? objects(obj.efforts) : (Array.isArray(obj.efforts) ? obj.efforts as unknown[] : []).filter(item => typeof item === 'string').map(id => ({ id })))
        setDefaultEffort(text(obj.defaultEffort) || undefined)
      }
    }).catch(() => {})
    return () => control.abort()
  }, [client, model, state.models])
  const groupedModels = useMemo(() => groupBotModels(state.models), [state.models])
  const selectedModelEntry = state.models.find(entry => text(entry.ref) === model)
  const selectedModelEngine = engineOfModel(model)
  const field = (label: string, value: string, change: (value: string) => void, multiline = false) => <View style={styles.field}><Text style={styles.heading}>{label}</Text><TextInput accessibilityLabel={label} style={[styles.input, multiline && styles.multiline]} value={value} onChangeText={change} editable={!busy} multiline={multiline} placeholderTextColor={colors.muted} maxLength={multiline ? 12000 : label === s.bots.name && kind === 'bot' ? 40 : 200} /></View>
  const inRooms = useMemo(
    () => (bot ? state.rooms.filter(r => r.members.includes(bot.id)) : []),
    [bot, state.rooms],
  )
  const canBePrivate = Boolean(bot && !bot.main && inRooms.length === 0 && workDir.trim() !== '')
  const canDelete = Boolean(
    editing && !state.readOnly && (room !== undefined || canDeleteBot(state, bot)),
  )
  const confirmDelete = () => {
    const targetId = bot?.id ?? room?.id
    if (!targetId || !canDelete) return
    Alert.alert(s.bots.delete, s.bots.deleteHint, [
      { text: s.bots.cancel, style: 'cancel' },
      {
        text: s.bots.delete,
        style: 'destructive',
        onPress: () => {
          void perform(bot ? 'delete-bot' : 'delete-room', { id: targetId }).then(res => {
            if (res.ok) onClose()
          })
        },
      },
    ])
  }
  const save = async () => {
    const operation = kind === 'bot' ? bot ? 'update-bot' : 'create-bot' : room ? 'update-room' : 'create-room'
    const payload = kind === 'bot'
      ? {
          ...(bot ? { id: bot.id } : {}),
          name: name.trim(),
          ...(bot ? { role, instructions, workDir, permission, private: canBePrivate ? isPrivate : false } : {}),
          ...(bot || model ? { model: model || null } : {}),
          ...(bot || effort ? { effort } : {}),
        }
      : {
          ...(room ? { id: room.id, notice, workDir, admin: members.includes(admin) ? admin : members[0] } : {}),
          name: name.trim(),
          members,
        }
    const res = await perform(operation, payload)
    if (res.ok) {
      if (bot && (pinned !== Boolean(bot.pinned) || (!bot.main && hidden !== Boolean(bot.hidden)))) {
        await perform('set-flags', { id: bot.id, pinned, ...(!bot.main ? { hidden } : {}) })
      } else if (room && (pinned !== Boolean(room.pinned) || hidden !== Boolean(room.hidden))) {
        await perform('set-flags', { id: room.id, pinned, hidden })
      }
      onClose()
    }
  }
  const header = <View style={styles.row}><Text style={[styles.heading, styles.grow]}>{editing ? s.bots.edit : kind === 'bot' ? s.bots.newBot : s.bots.newGroup}</Text><IconButton label={s.common.close} icon={X} disabled={busy} onPress={onClose} /></View>
  const actions = <View style={styles.actions}>
    {canDelete && <Button variant="danger" icon={Trash2} label={s.bots.delete} disabled={busy} onPress={confirmDelete} />}
    <View style={styles.grow} />
    <Button variant="quiet" label={s.bots.cancel} disabled={busy} onPress={onClose} />
    <Button loading={busy} label={bot || room ? s.bots.save : s.bots.create} disabled={busy || !name.trim() || (kind === 'room' && members.length < 2)} onPress={() => void save()} />
  </View>
  return <SheetModal visible avoidKeyboard onClose={() => { if (!busy) onClose() }}
    sheetStyle={compactHeight ? localStyles.compactSheet : undefined}>
      {!compactHeight && header}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[
        styles.sheetContent,
        // A landscape IME can leave less room than the fixed header/actions.
        // Let the whole form (including its padding) scroll in that window.
        compactHeight && {
          paddingTop: spacing.lg,
          paddingLeft: spacing.lg + insets.left,
          paddingRight: spacing.lg + insets.right,
          paddingBottom: Math.max(spacing.xxl, insets.bottom + spacing.sm),
        },
      ]}>
        {compactHeight && header}

        {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        {field(s.bots.name, name, setName)}
        {kind === 'bot' ? <>
          {editing && <>{field(s.bots.role, role, setRole)}{field(s.bots.instructions, instructions, setInstructions, true)}</>}
          <Text style={styles.heading}>{s.bots.model}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={s.bots.model} accessibilityState={{ expanded: modelPicker }} style={[styles.input, styles.row]} disabled={busy} onPress={() => setModelPicker(value => !value)}>{selectedModelEngine !== undefined && <BotAgentBadge engine={selectedModelEngine} size={16} />}<Text style={[styles.body, styles.grow]} numberOfLines={1}>{model ? text(selectedModelEntry?.name) || text(selectedModelEntry?.label) || model : s.bots.defaultModel}</Text>{modelPicker ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}</Pressable>
          {modelPicker && <View style={styles.field}><BotChoice label={s.bots.defaultModel} checked={model === ''} disabled={busy} onPress={() => { setModel(''); setEffort(''); setModelPicker(false) }} />{groupedModels.map(group => <View key={group.provider} style={localStyles.providerGroup}><View style={localStyles.providerHeader}><BotAgentBadge engine={group.provider} size={14} /><Text style={localStyles.providerTitle}>{group.label}</Text></View>{group.items.map((entry, i) => { const ref = text(entry.ref); const isDefault = state.defaultModel !== undefined && ref === state.defaultModel; const labelText = text(entry.name) || text(entry.label) || ref; return <BotChoice key={ref || i} label={isDefault ? `${labelText} (${s.bots.defaultEffort})` : labelText} checked={model === ref} disabled={busy || ref === ''} onPress={() => { setModel(ref); setEffort(''); setModelPicker(false) }} /> })}</View>)}</View>}
          {state.models.length === 0 && <Text style={styles.muted}>{s.bots.noModel}</Text>}
          {efforts.length > 0 && <BotEffortBar efforts={efforts} defaultEffort={defaultEffort} current={effort} disabled={busy} onPick={setEffort} />}
          {editing && bot && <>
            <Text style={styles.heading}>{s.bots.workingFolder}</Text>
            <Pressable accessibilityRole="button" style={[styles.input, styles.row]} disabled={busy} onPress={() => setFolderPickerOpen(true)}>
              <Text style={[styles.body, styles.grow]} numberOfLines={1}>{workDir ? folderBasename(workDir) : s.bots.teamWorkspace}</Text>
              <ChevronDown size={18} color={colors.muted} />
            </Pressable>
            <Text style={styles.heading}>{s.bots.permissions}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([
                ['read-only', s.bots.permReadOnly],
                ['workspace-write', s.bots.permWorkspace],
                ['danger-full-access', s.bots.permFullAccess],
              ] as const).map(([val, label]) => (
                <BotChoice key={val} label={label} checked={permission === val} disabled={busy} onPress={() => setPermission(val)} />
              ))}
            </View>
            <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.heading}>{s.bots.privateBot}</Text>
                <Text style={styles.muted}>
                  {bot.main
                    ? s.bots.privateMainDisabled
                    : inRooms.length > 0
                      ? s.bots.privateGroupDisabled
                      : !workDir.trim()
                        ? s.bots.privateFolderDisabled
                        : s.bots.privateBotDesc}
                </Text>
              </View>
              <Toggle value={canBePrivate && isPrivate} disabled={busy || !canBePrivate} onValueChange={setIsPrivate} accessibilityLabel={s.bots.privateBot} />
            </View>
            <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
              <Text style={styles.heading}>{s.bots.pinChat}</Text>
              <Toggle value={pinned} disabled={busy} onValueChange={setPinned} accessibilityLabel={s.bots.pinChat} />
            </View>
            {!bot.main && (
              <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                <Text style={styles.heading}>{s.bots.hideFromSidebar}</Text>
                <Toggle value={hidden} disabled={busy} onValueChange={setHidden} accessibilityLabel={s.bots.hideFromSidebar} />
              </View>
            )}
          </>}
        </> : <>
          {room && field(s.bots.notice, notice, setNotice, true)}
          <Text style={styles.heading}>{s.bots.members}</Text><Text style={styles.muted}>{s.bots.membersHint}</Text>
          <View style={styles.field}>{state.bots.map(entry => <BotChoice key={entry.id} label={entry.name} multiple checked={members.includes(entry.id)} disabled={busy} onPress={() => setMembers(current => current.includes(entry.id) ? current.filter(id => id !== entry.id) : [...current, entry.id])} />)}</View>
          {editing && <View style={styles.field}><Text style={styles.heading}>{s.bots.admin}</Text>{state.bots.filter(entry => members.includes(entry.id)).map(entry => <BotChoice key={entry.id} label={entry.name} checked={(members.includes(admin) ? admin : members[0]) === entry.id} disabled={busy} onPress={() => setAdmin(entry.id)} />)}</View>}
          {editing && room && <>
            <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
              <Text style={styles.heading}>{s.bots.pinChat}</Text>
              <Toggle value={pinned} disabled={busy} onValueChange={setPinned} accessibilityLabel={s.bots.pinChat} />
            </View>
            <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
              <Text style={styles.heading}>{s.bots.hideFromSidebar}</Text>
              <Toggle value={hidden} disabled={busy} onValueChange={setHidden} accessibilityLabel={s.bots.hideFromSidebar} />
            </View>
          </>}
        </>}

        {compactHeight && actions}
      </ScrollView>
      {!compactHeight && actions}
      <BotFolderPickerModal visible={folderPickerOpen} value={workDir} client={client} onClose={() => setFolderPickerOpen(false)} onPick={setWorkDir} />
  </SheetModal>
}

const createEditorStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    compactSheet: { padding: 0, paddingLeft: 0, paddingRight: 0, paddingBottom: 0 },
    providerGroup: { gap: 4, marginTop: 4 },
    providerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 6,
      paddingTop: 4,
      paddingBottom: 2,
    },
    providerTitle: { ...type.caption, fontSize: 12, fontWeight: '600', color: colors.muted },
    effortCard: {
      paddingHorizontal: spacing.md,
      paddingVertical: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.grouped,
      gap: 10,
    },
    effortHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
    },
    effortTitle: { ...type.smallStrong, color: colors.ink },
    effortMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    defaultTag: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    defaultTagText: { ...type.caption, fontSize: 11, color: colors.muted },
    effortValue: { ...type.small, fontWeight: '600', color: colors.primary },
    resetBtn: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    effortTrackWrap: { position: 'relative', justifyContent: 'center', paddingTop: 4 },
    effortTrackLine: {
      position: 'absolute',
      left: 16,
      right: 16,
      top: 13,
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.separator,
    },
    effortStopsRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    effortStopTouch: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 2 },
    effortDot: {
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: colors.separator,
    },
    effortDotFilled: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    effortKnob: {
      width: 16,
      height: 16,
      borderRadius: 8,
      marginTop: -2,
      backgroundColor: colors.primary,
      borderColor: colors.surface,
      borderWidth: 2,
    },
    effortStopLabel: { ...type.caption, fontSize: 11, color: colors.muted, textAlign: 'center' },
    effortStopLabelActive: { color: colors.ink, fontWeight: '600' },
  })
