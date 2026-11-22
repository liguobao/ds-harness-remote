import { Camera, ChevronRight, FileText, Folder, Images, Layers, MessageSquare, ShieldAlert, Terminal, X, type LucideIcon } from 'lucide-react-native'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { strings } from '../../locales/i18n'
import { GroupCard, IconButton } from '../../ui/components'
import { androidRipple } from '../../ui/platform-style'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { usePickerListMaxHeight } from './modal'
import { SheetModal } from '../../ui/sheet'
import type { Rect } from '../../ui/motion'
import { createStyles } from './styles'

type Props = {
  visible: boolean
  onClose: () => void
  /** iOS-only: the sheet's native modal finished dismissing. */
  onDismiss?: () => void
  /** Defers an action until the sheet has really gone (iOS picker timing). */
  runAfterClose?: (action: () => void) => void
  /** Window rect of the composer the sheet grows out of. */
  anchor?: Rect
  attachmentPicking: boolean
  takePhoto: () => Promise<void>
  pickImages: () => Promise<void>
  pickFiles: () => Promise<void>
  workspaceLabel: string
  modeLabel: string
  supportsModeSelection: boolean
  agentPresetSelecting: boolean
  toolsAvailable: boolean
  permissionsAvailable: boolean
  permissionSelecting: boolean
  permissionDisabled: boolean
  permissionLabel: string | undefined
  onReferenceChat?: () => void
  onOpenWorkspace: () => void
  onOpenMode: () => void
  onOpenTools: () => void
  onOpenPermissions: () => void
}

export function ChatActionMenu({ visible, onClose, anchor, attachmentPicking,
  takePhoto, pickImages, pickFiles, workspaceLabel, modeLabel, supportsModeSelection,
  agentPresetSelecting, toolsAvailable, permissionsAvailable, permissionSelecting,
  permissionDisabled, permissionLabel, onReferenceChat, onOpenWorkspace, onOpenMode, onOpenTools, onOpenPermissions,
  onDismiss, runAfterClose }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const plusMenuListMaxHeight = usePickerListMaxHeight()
  const runAction = (action: () => void) => {
    if (runAfterClose !== undefined) runAfterClose(action)
    else {
      onClose()
      action()
    }
  }
  const menuRows: Array<{
    key: string
    icon: LucideIcon
    label: string
    accessibilityLabel: string
    value?: string
    loading?: boolean
    disabled?: boolean
    onPress: () => void
  }> = []
  if (onReferenceChat !== undefined) {
    menuRows.push({
      key: 'reference-chat',
      icon: MessageSquare,
      label: strings.chat.referenceChat,
      accessibilityLabel: strings.chat.referenceChat,
      onPress: () => runAction(onReferenceChat),
    })
  }
  menuRows.push({
    key: 'workspace',
    icon: Folder,
    label: strings.chat.openWorkspaces,
    accessibilityLabel: strings.chat.openWorkspaces,
    value: workspaceLabel,
    onPress: () => runAction(onOpenWorkspace),
  })
  if (supportsModeSelection) {
    menuRows.push({
      key: 'mode',
      icon: Layers,
      label: strings.chat.mode,
      accessibilityLabel: strings.chat.selectMode,
      value: modeLabel,
      loading: agentPresetSelecting,
      disabled: agentPresetSelecting,
      onPress: () => runAction(onOpenMode),
    })
  }
  if (toolsAvailable) {
    menuRows.push({
      key: 'tools',
      icon: Terminal,
      label: strings.chat.toolAccess,
      accessibilityLabel: strings.chat.toolAccess,
      onPress: () => runAction(onOpenTools),
    })
  }
  if (permissionsAvailable) {
    menuRows.push({
      key: 'permissions',
      icon: ShieldAlert,
      label: strings.chat.approvalMode,
      accessibilityLabel: strings.chat.approvalMode,
      value: permissionLabel,
      loading: permissionSelecting,
      disabled: permissionDisabled,
      onPress: () => runAction(onOpenPermissions),
    })
  }
  const ripple = androidRipple(colors)
  return (
    // `sheet` keeps one form on wide windows: `anchor` is deliberately cleared
    // while the IME settles (chat-screen.tsx), and an adaptive promotion would
    // make this menu jump between a full-width sheet and a centered card.
    <SheetModal visible={visible} onClose={onClose} onDismiss={onDismiss} anchor={anchor} presentation="sheet">
      <View style={styles.modalHeader}><Text style={styles.modalTitle}>{strings.chat.moreActions}</Text><IconButton label={strings.common.close} icon={X} dense onPress={onClose} /></View>
      <ScrollView
        style={{ maxHeight: plusMenuListMaxHeight }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View style={styles.plusCardRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.takePhoto}
            accessibilityState={{ disabled: attachmentPicking }}
            disabled={attachmentPicking}
            android_ripple={ripple}
            onPress={() => runAction(() => { void takePhoto() })}
            style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
          >
            <Camera size={22} color={colors.ink} strokeWidth={1.8} />
            <Text style={styles.plusCardText}>{strings.chat.takePhoto}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.photos}
            accessibilityState={{ disabled: attachmentPicking }}
            disabled={attachmentPicking}
            android_ripple={ripple}
            onPress={() => runAction(() => { void pickImages() })}
            style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
          >
            <Images size={22} color={colors.ink} strokeWidth={1.8} />
            <Text style={styles.plusCardText}>{strings.chat.photos}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.files}
            accessibilityState={{ disabled: attachmentPicking }}
            disabled={attachmentPicking}
            android_ripple={ripple}
            onPress={() => runAction(() => { void pickFiles() })}
            style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
          >
            <FileText size={22} color={colors.ink} strokeWidth={1.8} />
            <Text style={styles.plusCardText}>{strings.chat.files}</Text>
          </Pressable>
        </View>
        <GroupCard>
          {menuRows.map((row, index) => {
            const Icon = row.icon
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={row.accessibilityLabel}
                accessibilityState={row.disabled ? { disabled: true } : undefined}
                disabled={row.disabled}
                android_ripple={ripple}
                onPress={row.onPress}
                style={({ pressed }) => [
                  styles.plusMenuOption,
                  pressed && styles.plusMenuOptionPressed,
                  row.disabled && styles.plusMenuOptionDisabled,
                ]}
              >
                <View style={styles.plusMenuOptionIcon}>
                  <Icon size={19} color={colors.ink} strokeWidth={1.8} />
                </View>
                <View style={[styles.plusMenuOptionBody, index > 0 && styles.plusMenuOptionDivider]}>
                  <Text style={styles.plusMenuOptionText}>{row.label}</Text>
                  <View style={styles.plusMenuOptionValue}>
                    {row.loading
                      ? <ActivityIndicator size="small" color={colors.muted} />
                      : row.value !== undefined && <Text style={styles.plusMenuOptionValueText} numberOfLines={1}>{row.value}</Text>}
                    <ChevronRight size={16} color={colors.subtle} />
                  </View>
                </View>
              </Pressable>
            )
          })}
        </GroupCard>
      </ScrollView>
    </SheetModal>
  )
}
