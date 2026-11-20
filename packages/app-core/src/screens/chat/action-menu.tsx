import { Camera, ChevronRight, FileText, Folder, Images, Layers, MessageSquare, ShieldAlert, Terminal, X } from 'lucide-react-native'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { strings } from '../../locales/i18n'
import { IconButton } from '../../ui/components'
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
  return (
    // `sheet` keeps one form on wide windows: `anchor` is deliberately cleared
    // while the IME settles (chat-screen.tsx), and an adaptive promotion would
    // make this menu jump between a full-width sheet and a centered card.
    <SheetModal visible={visible} onClose={onClose} onDismiss={onDismiss} anchor={anchor} presentation="sheet">
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{strings.chat.moreActions}</Text><IconButton label={strings.common.close} icon={X} onPress={onClose} /></View>
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
              onPress={() => runAction(() => { void takePhoto() })}
              style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
            >
              <Camera size={22} color={colors.primary} />
              <Text style={styles.plusCardText}>{strings.chat.takePhoto}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.photos}
              accessibilityState={{ disabled: attachmentPicking }}
              disabled={attachmentPicking}
              onPress={() => runAction(() => { void pickImages() })}
              style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
            >
              <Images size={22} color={colors.primary} />
              <Text style={styles.plusCardText}>{strings.chat.photos}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.files}
              accessibilityState={{ disabled: attachmentPicking }}
              disabled={attachmentPicking}
              onPress={() => runAction(() => { void pickFiles() })}
              style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
            >
              <FileText size={22} color={colors.primary} />
              <Text style={styles.plusCardText}>{strings.chat.files}</Text>
            </Pressable>
          </View>
          {onReferenceChat !== undefined && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.referenceChat}
              onPress={() => runAction(onReferenceChat)}
              style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed]}
            >
              <MessageSquare size={20} color={colors.primary} />
              <Text style={styles.plusMenuOptionText}>{strings.chat.referenceChat}</Text>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.openWorkspaces}
            onPress={() => runAction(onOpenWorkspace)}
            style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed]}
          >
            <Folder size={20} color={colors.primary} />
            <Text style={styles.plusMenuOptionText}>{strings.chat.openWorkspaces}</Text>
            <View style={styles.plusMenuOptionValue}>
              <Text style={styles.plusMenuOptionValueText} numberOfLines={1}>{workspaceLabel}</Text>
              <ChevronRight size={16} color={colors.muted} />
            </View>
          </Pressable>
          {supportsModeSelection && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.selectMode}
              accessibilityState={{ disabled: agentPresetSelecting }}
              disabled={agentPresetSelecting}
              onPress={() => runAction(onOpenMode)}
              style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed, agentPresetSelecting && styles.plusMenuOptionDisabled]}
            >
              <Layers size={20} color={colors.primary} />
              <Text style={styles.plusMenuOptionText}>{strings.chat.mode}</Text>
              <View style={styles.plusMenuOptionValue}>
                {agentPresetSelecting
                  ? <ActivityIndicator size="small" color={colors.muted} />
                  : <Text style={styles.plusMenuOptionValueText} numberOfLines={1}>{modeLabel}</Text>}
                <ChevronRight size={16} color={colors.muted} />
              </View>
            </Pressable>
          )}
          {toolsAvailable && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.toolAccess}
              onPress={() => runAction(onOpenTools)}
              style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed]}
            >
              <Terminal size={20} color={colors.primary} />
              <Text style={styles.plusMenuOptionText}>{strings.chat.toolAccess}</Text>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>
          )}
          {permissionsAvailable && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.approvalMode}
              accessibilityState={{ disabled: permissionDisabled }}
              disabled={permissionDisabled}
              onPress={() => runAction(onOpenPermissions)}
              style={({ pressed }) => [styles.plusMenuOption, pressed && styles.plusMenuOptionPressed, permissionDisabled && styles.plusMenuOptionDisabled]}
            >
              <ShieldAlert size={20} color={colors.primary} />
              <Text style={styles.plusMenuOptionText}>{strings.chat.approvalMode}</Text>
              <View style={styles.plusMenuOptionValue}>
                {permissionSelecting
                  ? <ActivityIndicator size="small" color={colors.muted} />
                  : <Text style={styles.plusMenuOptionValueText} numberOfLines={1}>{permissionLabel}</Text>}
                <ChevronRight size={16} color={colors.muted} />
              </View>
            </Pressable>
          )}
        </ScrollView>
    </SheetModal>

  )
}
