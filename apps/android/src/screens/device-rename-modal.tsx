import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { X } from 'lucide-react-native'
import { MAX_DEVICE_NAME_LENGTH } from '@dsh-remote/protocol'
import { strings } from '../locales/i18n'
import { useAppStore } from '../state/store'
import type { RemoteDevice } from '../types'
import { Button, IconButton } from '../ui/components'
import { radius, spacing, type, type ThemeColors } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export function DeviceRenameModal({ device, onClose }: { device: RemoteDevice; onClose: () => void }) {
  const [name, setName] = useState(device.name)
  const [error, setError] = useState<string>()
  const pending = useRef(false)
  const rename = useAppStore(state => state.renameDevice)
  const busyAction = useAppStore(state => state.busyAction)
  const busy = busyAction === `rename-device:${device.deviceId}`
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const trimmed = name.trim()
  const valid = trimmed.length > 0 && trimmed.length <= MAX_DEVICE_NAME_LENGTH
  const close = () => { if (!pending.current) onClose() }
  const save = async () => {
    if (!valid || pending.current || busyAction !== undefined) return
    pending.current = true
    setError(undefined)
    try {
      if (await rename(device.deviceId, trimmed)) onClose()
      else setError(useAppStore.getState().error ?? strings.tools.failed)
    } finally {
      pending.current = false
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={close} />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title}>{strings.devices.renameTitle}</Text>
            <IconButton label={strings.common.close} icon={X} onPress={close} disabled={busy} />
          </View>
          <TextInput
            style={styles.input}
            accessibilityLabel={strings.devices.namePlaceholder}
            value={name}
            onChangeText={value => { setName(value); setError(undefined) }}
            placeholder={strings.devices.namePlaceholder}
            placeholderTextColor={colors.muted}
            autoFocus
            selectTextOnFocus
            maxLength={MAX_DEVICE_NAME_LENGTH}
            editable={busyAction === undefined}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
          />
          <Text style={styles.hint}>{strings.devices.renameHint}</Text>
          {error !== undefined && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
          <Button label={strings.devices.saveName} onPress={() => void save()} loading={busy} disabled={!valid || busyAction !== undefined} />
          <Button label={strings.common.cancel} variant="quiet" onPress={close} disabled={busy} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.modalBackdrop },
    sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, zIndex: 1, elevation: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    title: { ...type.heading, flex: 1, color: colors.ink },
    input: { ...type.body, color: colors.ink, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, minHeight: 48 },
    hint: { ...type.small, color: colors.muted },
    error: { ...type.small, color: colors.danger },
  })
}
