import { Modal, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../ui/theme-context'
import { KeyboardInset } from '../ui/keyboard-inset'
import { WorkspaceFilesPanel } from './workspace-files-panel'
import { TerminalPanel } from './terminal-panel'

export function SessionToolsPanel({ mode, sessionId, onClose }: { mode: 'files' | 'terminal'; sessionId: string; onClose: () => void }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return <Modal visible onRequestClose={onClose} animationType="slide">
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <KeyboardInset>
      {mode === 'files'
        ? <WorkspaceFilesPanel sessionId={sessionId} onClose={onClose} />
        : <TerminalPanel sessionId={sessionId} onClose={onClose} />}
      </KeyboardInset>
    </View>
  </Modal>
}
const styles = StyleSheet.create({ container: { flex: 1 } })
