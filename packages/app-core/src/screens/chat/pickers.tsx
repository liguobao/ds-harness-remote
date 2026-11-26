import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native'
import { strings as zhCN } from '../../locales/i18n'
import type { CustomPrompt, QuickPromptActionMode } from '../../services/storage'
import type {
  AgentPresetOption,
  ModelCatalogModel,
  ModelProviderGroup,
  PermissionSelect,
} from '../../types'
import { Button, IconButton, type UiIconComponent } from '../../ui/components'
import { DuotoneIcons, MotionPressable } from '../../ui/duotone-icons'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { usePickerListMaxHeight } from './modal'
import { SheetModal } from '../../ui/sheet'
import type { SessionToolsMode } from '../session-tools-panel'
import { createStyles } from './styles'

export function ModePicker({ visible, options, current, loading, selecting, onClose, onPick }: {
  visible: boolean
  options?: AgentPresetOption[]
  current?: string
  loading?: boolean
  selecting?: boolean
  onClose: () => void
  onPick: (preset: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  return (
    <SheetModal visible={visible} onClose={onClose}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.selectMode}</Text><IconButton label={zhCN.common.close} icon={DuotoneIcons.X} onPress={onClose} /></View>
        <ScrollView
          style={{ flexShrink: 1, maxHeight: listMaxHeight }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {options === undefined || options.length === 0 ? (
            loading
              ? <View style={styles.modeLoading}><ActivityIndicator color={colors.primary} /></View>
              : <Text style={styles.modelFailures}>{zhCN.chat.modeLoadFailed}</Text>
          ) : options.map(option => {
            const isCurrent = option.id === current
            const broken = option.broken !== undefined
            const description = agentPresetDescription(option)
            return (
              <MotionPressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent, disabled: selecting || broken }}
                disabled={selecting || broken}
                onPress={() => onPick(option.id)}
                scaleTo={0.98}
                surfaceColor={isCurrent ? colors.surfaceStrong : colors.grouped}
                style={[styles.permissionOption, isCurrent && { borderWidth: 1, borderColor: colors.ink, backgroundColor: colors.surfaceStrong }, (selecting || broken) && styles.plusMenuOptionDisabled]}
              >
                <View style={styles.permissionOptionCopy}>
                  <Text style={styles.permissionOptionName}>{agentPresetName(option)}</Text>
                  {description !== undefined && <Text style={styles.permissionOptionDescription}>{description}</Text>}
                </View>
                {isCurrent && <DuotoneIcons.Check size={16} color={colors.ink} />}
              </MotionPressable>
            )
          })}
        </ScrollView>
    </SheetModal>
  )
}

export function PermissionPicker({ visible, permissions, onClose, onPick, loading, error, onRetry }: {
  loading: boolean
  error?: string
  onRetry: () => void
  visible: boolean
  permissions?: PermissionSelect
  onClose: () => void
  onPick: (preset: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  if (permissions === undefined) return null
  return (
    <SheetModal visible={visible} onClose={onClose}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.approvalMode}</Text><IconButton label={zhCN.common.close} icon={DuotoneIcons.X} onPress={onClose} /></View>
        <ScrollView
          style={{ flexShrink: 1, maxHeight: listMaxHeight }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {loading && <ActivityIndicator color={colors.primary} />}
          {error && <View><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><Button label={zhCN.tools.retry} onPress={onRetry} /></View>}
          {permissions.options.filter(option => option.value !== 'custom').map(option => {
            const current = option.value === permissions.currentValue
            return (
              <MotionPressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                onPress={() => onPick(option.value)}
                scaleTo={0.98}
                surfaceColor={current ? colors.surfaceStrong : colors.grouped}
                style={[styles.permissionOption, current && { borderWidth: 1, borderColor: colors.ink, backgroundColor: colors.surfaceStrong }]}
              >
                <View style={styles.permissionOptionCopy}><Text style={styles.permissionOptionName}>{permissionDisplayName(option.value, option.name)}</Text>{permissionDisplayDescription(option.value, option.description) !== undefined && <Text style={styles.permissionOptionDescription}>{permissionDisplayDescription(option.value, option.description)}</Text>}</View>
                {current && <DuotoneIcons.Check size={16} color={colors.ink} />}
              </MotionPressable>
            )
          })}
        </ScrollView>
    </SheetModal>
  )
}

export function ToolAccessPicker({ visible, supportsChanges = true, onClose, onPick }: {
  visible: boolean
  supportsChanges?: boolean
  onClose: () => void
  onPick: (mode: SessionToolsMode) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const options: Array<{ id: SessionToolsMode; icon: UiIconComponent; name: string; description: string }> = [
    { id: 'files', icon: DuotoneIcons.Folder, name: zhCN.tools.files, description: zhCN.chat.toolFilesDescription },
    ...(supportsChanges
      ? [{ id: 'changes' as const, icon: DuotoneIcons.GitCompareArrows, name: zhCN.tools.changes, description: zhCN.chat.toolChangesDescription }]
      : []),
    { id: 'terminal', icon: DuotoneIcons.Terminal, name: zhCN.tools.terminal, description: zhCN.chat.toolTerminalDescription },
  ]
  return (
    <SheetModal visible={visible} onClose={onClose}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{zhCN.chat.toolAccess}</Text><IconButton label={zhCN.common.close} icon={DuotoneIcons.X} onPress={onClose} /></View>
        <ScrollView
          style={{ flexShrink: 1, maxHeight: listMaxHeight }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {options.map(option => {
            const Icon = option.icon
            return (
              <MotionPressable
                key={option.id}
                accessibilityRole="button"
                onPress={() => onPick(option.id)}
                scaleTo={0.98}
                surfaceColor={colors.grouped}
                style={({ pressed }) => [styles.permissionOption, pressed && styles.plusMenuOptionPressed]}
              >
                <Icon size={20} color={colors.ink} />
                <View style={styles.permissionOptionCopy}>
                  <Text style={styles.permissionOptionName}>{option.name}</Text>
                  <Text style={styles.permissionOptionDescription}>{option.description}</Text>
                </View>
                <DuotoneIcons.ChevronRight size={16} color={colors.muted} />
              </MotionPressable>
            )
          })}
        </ScrollView>
    </SheetModal>
  )
}

export function PromptsPicker({ visible, prompts, actionMode = 'fill', onToggleActionMode, onClose, onPick, onManage }: {
  visible: boolean
  prompts: readonly CustomPrompt[]
  actionMode?: QuickPromptActionMode
  onToggleActionMode?: (nextMode: QuickPromptActionMode) => void
  onClose: () => void
  onPick: (prompt: CustomPrompt) => void
  onManage: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const nextMode: QuickPromptActionMode = actionMode === 'send' ? 'fill' : 'send'
  const modeLabel = actionMode === 'send' ? zhCN.settings.quickPromptActionSend : zhCN.settings.quickPromptActionFill
  return (
    <SheetModal visible={visible} onClose={onClose}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{zhCN.chat.toolPrompts}</Text>
          <IconButton label={zhCN.common.close} icon={DuotoneIcons.X} onPress={onClose} />
        </View>
        <ScrollView
          style={{ flexShrink: 1, maxHeight: Math.max(140, listMaxHeight - (onToggleActionMode ? 112 : 56)) }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {prompts.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Text style={styles.permissionOptionName}>{zhCN.chat.toolPromptEmptyTitle}</Text>
              <Text style={styles.permissionOptionDescription}>{zhCN.chat.toolPromptEmptyBody}</Text>
            </View>
          ) : prompts.map(prompt => (
            <MotionPressable
              key={prompt.id}
              accessibilityRole="button"
              accessibilityLabel={prompt.title}
              onPress={() => onPick(prompt)}
              scaleTo={0.98}
              surfaceColor={colors.grouped}
              style={({ pressed }) => [styles.permissionOption, pressed && styles.plusMenuOptionPressed]}
            >
              <View style={styles.permissionOptionCopy}>
                <Text style={styles.permissionOptionName}>{prompt.title}</Text>
                <Text style={styles.permissionOptionDescription} numberOfLines={2}>{prompt.text}</Text>
              </View>
              <DuotoneIcons.ChevronRight size={16} color={colors.muted} />
            </MotionPressable>
          ))}
        </ScrollView>
        {onToggleActionMode !== undefined && (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={zhCN.settings.quickPromptActionMode}
            onPress={() => onToggleActionMode(nextMode)}
            scaleTo={0.98}
            surfaceColor={colors.card}
            style={({ pressed }) => [styles.effortRow, pressed && styles.plusMenuOptionPressed]}
          >
            <View style={styles.plusMenuOptionValue}>
              <DuotoneIcons.Zap size={15} color={colors.ink} />
              <Text style={styles.effortRowLabel}>{zhCN.settings.quickPromptActionMode}</Text>
            </View>
            <View style={styles.plusMenuOptionValue}>
              <Text style={styles.effortRowValue}>{modeLabel}</Text>
              <DuotoneIcons.ChevronRight size={16} color={colors.muted} />
            </View>
          </MotionPressable>
        )}
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={zhCN.chat.toolPromptEdit}
          onPress={onManage}
          scaleTo={0.98}
          surfaceColor={colors.card}
          style={({ pressed }) => [styles.effortRow, pressed && styles.plusMenuOptionPressed]}
        >
          <Text style={styles.effortRowLabel}>{zhCN.chat.toolPromptEdit}</Text>
          <View style={styles.plusMenuOptionValue}>
            <DuotoneIcons.ChevronRight size={16} color={colors.muted} />
          </View>
        </MotionPressable>
    </SheetModal>
  )
}

export function PromptsManager({ visible, prompts, promptsLoading, onBack, onClose, onAdd, onEdit, onDelete }: {
  visible: boolean
  prompts: readonly CustomPrompt[]
  promptsLoading?: boolean
  onBack: () => void
  onClose: () => void
  onAdd: () => void
  onEdit: (prompt: CustomPrompt) => void
  onDelete: (prompt: CustomPrompt) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  return (
    <SheetModal visible={visible} onClose={onClose} onRequestClose={onBack}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderCopy}>
            <IconButton label={zhCN.common.back} icon={DuotoneIcons.ChevronLeft} onPress={onBack} />
            <Text style={styles.modalTitle} numberOfLines={1}>{zhCN.chat.toolPromptEdit}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton label={zhCN.chat.toolPromptAdd} icon={DuotoneIcons.Plus} tint={colors.ink} onPress={onAdd} disabled={promptsLoading} />
            <IconButton label={zhCN.common.close} icon={DuotoneIcons.X} onPress={onClose} />
          </View>
        </View>
        <ScrollView
          style={{ flexShrink: 1, maxHeight: listMaxHeight }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {prompts.length === 0 ? (
            <View style={styles.pickerEmpty}>
              <Text style={styles.permissionOptionName}>{zhCN.chat.toolPromptEmptyTitle}</Text>
              <Text style={styles.permissionOptionDescription}>{zhCN.chat.toolPromptEmptyBody}</Text>
            </View>
          ) : prompts.map(prompt => (
            <View key={prompt.id} style={[styles.permissionOption, { paddingRight: 4 }]}>
              <View style={styles.permissionOptionCopy}>
                <Text style={styles.permissionOptionName}>{prompt.title}</Text>
                <Text style={styles.permissionOptionDescription} numberOfLines={2}>{prompt.text}</Text>
              </View>
              <IconButton label={zhCN.chat.toolPromptEditTitle(prompt.title)} icon={DuotoneIcons.Pencil} onPress={() => onEdit(prompt)} dense disabled={promptsLoading} />
              <IconButton label={zhCN.common.delete} icon={DuotoneIcons.Trash2} onPress={() => onDelete(prompt)} dense disabled={promptsLoading} />
            </View>
          ))}
        </ScrollView>
    </SheetModal>
  )
}

export function PromptEditor({ visible, prompt, promptsLoading, onBack, onClose, onSave }: {
  visible: boolean
  prompt?: CustomPrompt
  promptsLoading?: boolean
  onBack: () => void
  onClose: () => void
  onSave: (title: string, text: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  useEffect(() => {
    if (!visible) return
    setTitle(prompt?.title ?? '')
    setText(prompt?.text ?? '')
  }, [visible, prompt?.id])
  const canSave = title.trim().length > 0 && text.trim().length > 0 && !promptsLoading
  return (
    <SheetModal visible={visible} onClose={onClose} onRequestClose={onBack}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderCopy}>
            <IconButton label={zhCN.common.back} icon={DuotoneIcons.ChevronLeft} onPress={onBack} />
            <Text style={styles.modalTitle} numberOfLines={1}>
              {prompt === undefined ? zhCN.chat.toolPromptAdd : zhCN.chat.toolPromptEditTitle(prompt.title)}
            </Text>
          </View>
          <IconButton label={zhCN.common.close} icon={DuotoneIcons.X} onPress={onClose} />
        </View>
        <ScrollView style={{ flexShrink: 1, maxHeight: listMaxHeight }} keyboardShouldPersistTaps="handled">
          <Text style={styles.promptInputLabel}>{zhCN.chat.toolPromptTitlePlaceholder}</Text>
          <TextInput
            accessibilityLabel={zhCN.chat.toolPromptTitlePlaceholder}
            placeholder={zhCN.chat.toolPromptTitlePlaceholder}
            placeholderTextColor={colors.muted}
            value={title}
            onChangeText={setTitle}
            style={styles.promptInput}
          />
          <Text style={[styles.promptInputLabel, { marginTop: 12 }]}>{zhCN.chat.toolPromptTextPlaceholder}</Text>
          <TextInput
            accessibilityLabel={zhCN.chat.toolPromptTextPlaceholder}
            placeholder={zhCN.chat.toolPromptTextPlaceholder}
            placeholderTextColor={colors.muted}
            value={text}
            onChangeText={setText}
            multiline
            style={[styles.promptInput, styles.promptTextArea]}
          />
        </ScrollView>
        <MotionPressable
          accessibilityRole="button"
          accessibilityLabel={zhCN.chat.toolPromptSave}
          disabled={!canSave}
          inverse={canSave}
          surfaceColor={canSave ? colors.inverse : colors.surface}
          scaleTo={0.97}
          onPress={() => onSave(title, text)}
          style={({ pressed }) => [styles.effortRow, { justifyContent: 'center', backgroundColor: canSave ? colors.inverse : colors.surface, marginTop: 12 }, pressed && canSave && { opacity: 0.8 }]}
        >
          <DuotoneIcons.Check size={16} color={canSave ? colors.onInverse : colors.disabled} />
          <Text style={[styles.effortRowLabel, { color: canSave ? colors.onInverse : colors.disabled, marginLeft: 6 }]}>{zhCN.chat.toolPromptSave}</Text>
        </MotionPressable>
    </SheetModal>
  )
}

export function ModelPicker({ visible, models, onClose, onPick }: {
  visible: boolean
  models?: import('../../types').SessionModels
  onClose: () => void
  onPick: (group: ModelProviderGroup, model: ModelCatalogModel, reasoningEffort?: string) => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const listMaxHeight = usePickerListMaxHeight()
  const [effortView, setEffortView] = useState(false)
  useEffect(() => {
    if (!visible) setEffortView(false)
  }, [visible])
  if (models === undefined) return null
  const currentGroup = models.groups.find(group => group.id === models.current.provider)
  const currentModel = currentGroup?.models.find(model => model.id === models.current.model)
  const efforts = currentModel?.reasoning?.efforts ?? []
  const activeEffortId = models.current.reasoningEffort ?? currentModel?.reasoning?.defaultEffort
  const activeEffort = efforts.find(effort => effort.id === activeEffortId)
  const showEffortRow = !effortView && efforts.length > 0
  return (
    <SheetModal visible={visible} onClose={onClose}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderCopy}>
            {effortView && (
              <IconButton label={zhCN.common.back} icon={DuotoneIcons.ChevronLeft} onPress={() => setEffortView(false)} />
            )}
            <Text style={styles.modalTitle} numberOfLines={1}>
              {effortView ? zhCN.chat.reasoningEffort : zhCN.chat.selectModel}
            </Text>
          </View>
          <IconButton label={zhCN.common.close} icon={DuotoneIcons.X} onPress={onClose} />
        </View>
        <ScrollView
          style={{ flexShrink: 1, maxHeight: showEffortRow ? Math.max(140, listMaxHeight - 56) : listMaxHeight }}
          contentContainerStyle={styles.modalListContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {!effortView ? (
            <>
              {models.groups.map(group => (
                <View key={group.id} style={styles.modelGroupBlock}>
                  <Text style={styles.modelGroupTitle}>{group.name}</Text>
                  {group.models.map(model => {
                    const current = models.current.provider === group.id && models.current.model === model.id
                    return (
                      <MotionPressable
                        key={model.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: current }}
                        scaleTo={0.98}
                        surfaceColor={current ? colors.surfaceStrong : colors.grouped}
                        onPress={() => {
                          if (current) onPick(group, model, models.current.reasoningEffort)
                          else onPick(group, model)
                        }}
                        style={[styles.modelOption, current && { borderColor: colors.ink, backgroundColor: colors.surfaceStrong }]}
                      >
                        <View style={styles.modelOptionCopy}>
                          <Text style={styles.modelOptionName} numberOfLines={1}>{model.name}</Text>
                        </View>
                        {current && <DuotoneIcons.Check size={16} color={colors.ink} />}
                      </MotionPressable>
                    )
                  })}
                </View>
              ))}
              {models.failures.length > 0 && (
                <Text style={styles.modelFailures}>{models.failures.map(failure => failure.message).join('; ')}</Text>
              )}
            </>
          ) : (
            <>
              {efforts.map(effort => {
                const current = activeEffortId === effort.id
                return (
                  <MotionPressable
                    key={effort.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: current }}
                    accessibilityLabel={zhCN.chat.reasoningEffortLabel(effort.name)}
                    scaleTo={0.98}
                    surfaceColor={current ? colors.surfaceStrong : colors.grouped}
                    onPress={() => {
                      if (currentGroup !== undefined && currentModel !== undefined) {
                        onPick(currentGroup, currentModel, effort.id)
                      }
                    }}
                    style={[styles.modelOption, current && { borderColor: colors.ink, backgroundColor: colors.surfaceStrong }]}
                  >
                    <View style={styles.modelOptionCopy}>
                      <Text style={styles.modelOptionName} numberOfLines={1}>{effort.name}</Text>
                    </View>
                    {current && <DuotoneIcons.Check size={16} color={colors.ink} />}
                  </MotionPressable>
                )
              })}
            </>
          )}
        </ScrollView>
        {showEffortRow && (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={zhCN.chat.reasoningEffort}
            scaleTo={0.98}
            surfaceColor={colors.card}
            onPress={() => setEffortView(true)}
            style={({ pressed }) => [styles.effortRow, pressed && styles.plusMenuOptionPressed]}
          >
            <Text style={styles.effortRowLabel}>{zhCN.chat.reasoningEffort}</Text>
            <View style={styles.plusMenuOptionValue}>
              <Text style={styles.effortRowValue} numberOfLines={1}>{activeEffort?.name ?? zhCN.chat.reasoningEffortDefault}</Text>
              <DuotoneIcons.ChevronRight size={16} color={colors.muted} />
            </View>
          </MotionPressable>
        )}
    </SheetModal>
  )
}

/** Official built-in mode copy, mirroring the DSH client "ui-agent-preset" locales. */
export function builtinPresetName(id: string): string | undefined {
  switch (id) {
    case 'standard': return zhCN.chat.presetStandardName
    case 'ptc': return zhCN.chat.presetPtcName
    case 'minimal': return zhCN.chat.presetMinimalName
    case 'cordis': return zhCN.chat.presetCordisName
    default: return undefined
  }
}

function builtinPresetDescription(id: string): string | undefined {
  switch (id) {
    case 'standard': return zhCN.chat.presetStandardDescription
    case 'ptc': return zhCN.chat.presetPtcDescription
    case 'minimal': return zhCN.chat.presetMinimalDescription
    case 'cordis': return zhCN.chat.presetCordisDescription
    default: return undefined
  }
}

/** Host roster name, with official Chinese copy for the built-in presets. */
export function agentPresetName(option: AgentPresetOption): string {
  return builtinPresetName(option.id) ?? option.name ?? option.id
}

function agentPresetDescription(option: AgentPresetOption): string | undefined {
  return builtinPresetDescription(option.id) ?? option.description
}

/** Official Chinese copy for the permission presets (DSH "ui-permission-presets"). */
export function permissionDisplayName(value: string, fallback?: string): string {
  switch (value) {
    case 'read-only': return zhCN.chat.permissionReadOnly
    case 'workspace-write': return zhCN.chat.permissionWorkspaceWrite
    case 'danger-full-access': return zhCN.chat.permissionFullAccess
    default: return fallback ?? value
  }
}

function permissionDisplayDescription(value: string, fallback?: string): string | undefined {
  switch (value) {
    case 'read-only': return zhCN.chat.permissionReadOnlyDescription
    case 'workspace-write': return zhCN.chat.permissionWorkspaceWriteDescription
    case 'danger-full-access': return zhCN.chat.permissionFullAccessDescription
    default: return fallback
  }
}
