import { Camera, ChevronRight, FileText, Folder, Images, Layers, ShieldAlert, Terminal, X } from 'lucide-react-native'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { strings } from '../../locales/i18n'
import { IconButton } from '../../ui/components'
import { QuoteMarkIcon } from '../../ui/quote-preview'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface, usePickerListMaxHeight } from './modal'
import { createStyles } from './styles'

type Props = {
  visible: boolean
  onClose: () => void
  canAttachImages: boolean
  attachmentPicking: boolean
  takePhoto: () => Promise<void>
  pickImages: () => Promise<void>
  pickFiles: () => Promise<void>
  onQuoteClipboard?: () => void
  workspaceLabel: string
  modeLabel: string
  supportsModeSelection: boolean
  agentPresetSelecting: boolean
  toolsAvailable: boolean
  permissionsAvailable: boolean
  permissionSelecting: boolean
  permissionDisabled: boolean
  permissionLabel: string | undefined
  onOpenWorkspace: () => void
  onOpenMode: () => void
  onOpenTools: () => void
  onOpenPermissions: () => void
}

export function ChatActionMenu({ visible, onClose, canAttachImages, attachmentPicking,
  takePhoto, pickImages, pickFiles, onQuoteClipboard, workspaceLabel, modeLabel, supportsModeSelection,
  agentPresetSelecting, toolsAvailable, permissionsAvailable, permissionSelecting,
  permissionDisabled, permissionLabel, onOpenWorkspace, onOpenMode, onOpenTools, onOpenPermissions }: Props) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const plusMenuListMaxHeight = usePickerListMaxHeight()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <ModalSurface onClose={onClose}>
        <View style={styles.modalHeader}><Text style={styles.modalTitle}>{strings.chat.moreActions}</Text><IconButton label={strings.common.close} icon={X} onPress={onClose} /></View>
        <ScrollView
          style={{ maxHeight: plusMenuListMaxHeight }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <View style={styles.plusCardRow}>
            {canAttachImages && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={strings.chat.takePhoto}
                  accessibilityState={{ disabled: attachmentPicking }}
                  disabled={attachmentPicking}
                  onPress={() => { onClose(); void takePhoto() }}
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
                  onPress={() => { onClose(); void pickImages() }}
                  style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
                >
                  <Images size={22} color={colors.primary} />
                  <Text style={styles.plusCardText}>{strings.chat.photos}</Text>
                </Pressable>
              </>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.chat.files}
              accessibilityState={{ disabled: attachmentPicking }}
              disabled={attachmentPicking}
              onPress={() => { onClose(); void pickFiles() }}
              style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed, attachmentPicking && styles.plusMenuOptionDisabled]}
            >
              <FileText size={22} color={colors.primary} />
              <Text style={styles.plusCardText}>{strings.chat.files}</Text>
            </Pressable>
            {onQuoteClipboard && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.messageActions.quote ?? '引用'}
                onPress={() => { onClose(); onQuoteClipboard() }}
                style={({ pressed }) => [styles.plusCard, pressed && styles.plusMenuOptionPressed]}
              >
                <QuoteMarkIcon size={22} color={colors.primary} />
                <Text style={styles.plusCardText}>{strings.messageActions.quote ?? '引用'}</Text>
              </Pressable>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.chat.openWorkspaces}
            onPress={() => { onClose(); onOpenWorkspace() }}
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
              onPress={() => { onClose(); onOpenMode() }}
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
              onPress={() => { onClose(); onOpenTools() }}
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
              onPress={() => { onClose(); onOpenPermissions() }}
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
      </ModalSurface>
    </Modal>

  )
}
