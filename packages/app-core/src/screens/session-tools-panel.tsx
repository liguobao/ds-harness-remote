import { Modal, StyleSheet, View } from 'react-native'
import { useTheme } from '../ui/theme-context'
import { KeyboardInset } from '../ui/keyboard-inset'
import { WorkspaceFilesPanel } from './workspace-files-panel'
import { TerminalPanel } from './terminal-panel'

export function SessionToolsPanel({ mode, sessionId, initialFile, onClose }: { mode: 'files' | 'terminal'; sessionId: string; initialFile?: string; onClose: () => void }) {
  const { colors } = useTheme()
  return <Modal visible onRequestClose={onClose} animationType="slide" statusBarTranslucent>
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardInset>
      {mode === 'files'
        ? <WorkspaceFilesPanel sessionId={sessionId} initialFile={initialFile} onClose={onClose} />
        : <TerminalPanel sessionId={sessionId} onClose={onClose} />}
      </KeyboardInset>
    </View>
  </Modal>
}
const styles = StyleSheet.create({ container: { flex: 1 } })
