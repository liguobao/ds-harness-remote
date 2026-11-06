import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native'
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react-native'
import { useAppStore } from '../state/store'
import type { AgentBackend, DirectoryListing, WorkspaceView } from '../types'
import { Button, GroupCard, GroupRow, IconButton } from '../ui/components'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useResponsiveLayout } from '../ui/responsive'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings } from '../locales/i18n'

const DIRECTORY_SHEET_COMPACT_RATIO = 0.92
const DIRECTORY_SHEET_RATIO = 0.75

export function WorkspaceActionsModal({
  target,
  favorited = false,
  canMoveUp,
  canMoveDown,
  busy,
  onClose,
  onNewSession,
  onToggleFavorite,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  target?: WorkspaceView
  favorited?: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  busy: boolean
  onClose: () => void
  onNewSession?: () => void
  onToggleFavorite?: () => void
  onRename: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}) {
  const styles = useThemedStyles(createStyles)
  const { sheetMaxHeight } = useResponsiveLayout()
  const canManage = target !== undefined && (target.backend === undefined || target.backend === 'harness')

  return (
    <Modal visible={target !== undefined} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <WorkspaceModalSurface onClose={onClose} backdropStyle={styles.backdrop} sheetStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <View style={styles.workspaceActionHeading}>
            <Text style={styles.sheetTitle}>{strings.workspaces.options}</Text>
            {target !== undefined && <Text style={styles.workspaceActionName} numberOfLines={1}>{target.title}</Text>}
          </View>
          <IconButton label={strings.common.close} icon={X} onPress={onClose} />
        </View>
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetScrollContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {target !== undefined && Boolean(target.path) && (
            <Text style={styles.workspaceActionPath} numberOfLines={2}>{target.path}</Text>
          )}
          {target !== undefined && (
            <GroupCard>
              {onNewSession !== undefined && (
                <GroupRow
                  first
                  icon={Plus}
                  label={strings.sessions.newSession}
                  detail={strings.workspaces.newSessionIn(target.title)}
                  disabled={busy}
                  onPress={onNewSession}
                />
              )}
              {onToggleFavorite !== undefined && (
                <GroupRow
                  first={onNewSession === undefined}
                  icon={Star}
                  label={favorited ? strings.comfort.unstar : strings.devices.favorites}
                  detail={favorited ? strings.workspaces.removeFavorite(target.title) : strings.workspaces.addFavorite(target.title)}
                  disabled={busy}
                  onPress={onToggleFavorite}
                />
              )}
              {canManage && (
                <GroupRow
                  first={onNewSession === undefined && onToggleFavorite === undefined}
                  icon={Pencil}
                  label={strings.workspaces.rename}
                  disabled={busy}
                  onPress={onRename}
                />
              )}
              {canManage && (
                <GroupRow
                  icon={ArrowUp}
                  label={strings.workspaces.moveUp}
                  disabled={busy || !canMoveUp}
                  onPress={onMoveUp}
                />
              )}
              {canManage && (
                <GroupRow
                  icon={ArrowDown}
                  label={strings.workspaces.moveDown}
                  disabled={busy || !canMoveDown}
                  onPress={onMoveDown}
                />
              )}
            </GroupCard>
          )}
          {canManage && (
            <GroupCard>
              <GroupRow
                first
                icon={Trash2}
                label={strings.workspaces.delete}
                danger
                chevron={false}
                disabled={busy}
                onPress={onDelete}
              />
            </GroupCard>
          )}
        </ScrollView>
      </WorkspaceModalSurface>
    </Modal>
  )
}

export function CreateWorkspaceModal({
  visible,
  codexAvailable,
  cursorAvailable,
  antigravityAvailable,
  piAvailable,
  opencodeAvailable,
  claudeAvailable,
  hermesAvailable,
  initialBackend,
  busy,
  onClose,
  onCreate,
  onCreated,
}: {
  visible: boolean
  codexAvailable: boolean
  cursorAvailable: boolean
  antigravityAvailable: boolean
  piAvailable: boolean
  opencodeAvailable: boolean
  claudeAvailable: boolean
  hermesAvailable: boolean
  initialBackend: AgentBackend
  busy: boolean
  onClose: () => void
  onCreate: (path: string, backend: AgentBackend) => Promise<WorkspaceView | undefined>
  onCreated: (workspace: WorkspaceView) => void
}) {
  const [backend, setBackend] = useState<AgentBackend>('harness')
  const [path, setPath] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { sheetMaxHeight } = useResponsiveLayout()
  const sheetScrollRef = useRef<ScrollView>(null)

  useEffect(() => {
    if (visible) sheetScrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [visible])

  useEffect(() => {
    if (!visible) return
    if (initialBackend === 'codex' && codexAvailable) setBackend('codex')
    else if (initialBackend === 'cursor' && cursorAvailable) setBackend('cursor')
    else if (initialBackend === 'pi' && piAvailable) setBackend('pi')
    else if (initialBackend === 'antigravity' && antigravityAvailable) setBackend('antigravity')
    else if (initialBackend === 'opencode' && opencodeAvailable) setBackend('opencode')
    else if (initialBackend === 'claude' && claudeAvailable) setBackend('claude')
    else if (initialBackend === 'hermes' && hermesAvailable) setBackend('hermes')
    else setBackend('harness')
  }, [codexAvailable, cursorAvailable, antigravityAvailable, piAvailable, opencodeAvailable, claudeAvailable, hermesAvailable, initialBackend, visible])

  const create = async () => {
    const trimmed = path.trim()
    if (trimmed.length === 0) return
    const workspace = await onCreate(trimmed, backend)
    if (workspace === undefined) return
    setPath('')
    onClose()
    onCreated(workspace)
  }

  const openBrowser = () => {
    Keyboard.dismiss()
    setBrowseOpen(true)
  }

  const allBackendItems: Array<{ value: AgentBackend; label: string; available: boolean }> = [
    { value: 'harness', label: strings.workspaces.dsh, available: true },
    { value: 'codex', label: strings.workspaces.codex, available: codexAvailable },
    { value: 'claude', label: strings.workspaces.claude, available: claudeAvailable },
    { value: 'hermes', label: strings.workspaces.hermes, available: hermesAvailable },
    { value: 'cursor', label: strings.workspaces.cursor, available: cursorAvailable },
    { value: 'antigravity', label: strings.workspaces.antigravity, available: antigravityAvailable },
    { value: 'opencode', label: strings.workspaces.opencode, available: opencodeAvailable },
    { value: 'pi', label: strings.workspaces.pi, available: piAvailable },
  ]
  const backendItems = allBackendItems.filter(item => item.available)

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <WorkspaceModalSurface onClose={onClose} backdropStyle={styles.backdrop} sheetStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
          <View style={styles.grabber} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{strings.workspaces.create}</Text>
            <IconButton label={strings.common.close} icon={X} onPress={onClose} />
          </View>
          <ScrollView
            ref={sheetScrollRef}
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.fieldLabel}>{strings.workspaces.type}</Text>
            <View style={styles.backendOptions}>
              {backendItems.map(item => {
                const selected = backend === item.value
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: busy }}
                    disabled={busy}
                    onPress={() => setBackend(item.value)}
                    style={({ pressed }) => [
                      styles.backendOption,
                      selected && styles.backendOptionSelected,
                      pressed && !busy && styles.workspaceRowPressed,
                      busy && styles.disabled,
                    ]}
                  >
                    <View style={[styles.radioIndicator, selected && styles.radioIndicatorSelected]}>
                      {selected && <View style={styles.radioIndicatorDot} />}
                    </View>
                    <Text style={[styles.backendOptionText, selected && styles.backendOptionTextSelected]}>
                      {item.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={styles.fieldLabel}>{strings.workspaces.deviceDirectory}</Text>
            <View style={styles.pathRow}>
              <TextInput
                style={styles.pathInput}
                value={path}
                onChangeText={setPath}
                placeholder="/home/user/project"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
              />
              <Button label={strings.workspaces.browse} variant="secondary" onPress={openBrowser} disabled={busy} />
            </View>
            <Text style={styles.fieldHint}>
              {backend === 'codex'
                ? strings.workspaces.codexDirectoryHint
                : backend === 'cursor'
                  ? strings.workspaces.cursorDirectoryHint
                  : backend === 'pi'
                    ? strings.workspaces.piDirectoryHint
                    : backend === 'antigravity'
                      ? strings.workspaces.antigravityDirectoryHint
                      : backend === 'opencode'
                        ? strings.workspaces.opencodeDirectoryHint
                        : backend === 'claude'
                          ? strings.workspaces.claudeDirectoryHint
                          : backend === 'hermes'
                            ? strings.workspaces.hermesDirectoryHint
                            : strings.workspaces.directoryHint}
            </Text>
            <Button label={strings.workspaces.create} onPress={() => void create()} loading={busy} disabled={path.trim().length === 0} />
          </ScrollView>
        </WorkspaceModalSurface>
      </Modal>
      <DirectoryBrowserModal
        visible={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onChoose={picked => { setPath(picked); setBrowseOpen(false) }}
      />
    </>
  )
}

export function RenameWorkspaceModal({
  target,
  busy,
  onClose,
  onRename,
}: {
  target?: WorkspaceView
  busy: boolean
  onClose: () => void
  onRename: (workspaceId: string, title: string) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { sheetMaxHeight } = useResponsiveLayout()

  useEffect(() => {
    if (target !== undefined) setTitle(target.title)
  }, [target])

  const rename = async () => {
    const trimmed = title.trim()
    if (target === undefined || trimmed.length === 0) return
    if (await onRename(target.workspaceId, trimmed)) onClose()
  }

  return (
    <Modal visible={target !== undefined} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <WorkspaceModalSurface onClose={onClose} backdropStyle={styles.backdrop} sheetStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{strings.workspaces.renameTitle}</Text>
          <IconButton label={strings.common.close} icon={X} onPress={onClose} />
        </View>
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetScrollContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder={strings.workspaces.namePlaceholder}
            placeholderTextColor={colors.muted}
            autoFocus
            editable={!busy}
          />
          <Button label={strings.workspaces.saveName} onPress={() => void rename()} loading={busy} disabled={title.trim().length === 0} />
        </ScrollView>
      </WorkspaceModalSurface>
    </Modal>
  )
}

export function DirectoryBrowserModal({
  visible,
  onClose,
  onChoose,
}: {
  visible: boolean
  onClose: () => void
  onChoose: (path: string) => void
}) {
  const listDirectory = useAppStore(state => state.hostListDirectory)
  const [listing, setListing] = useState<DirectoryListing | undefined>(undefined)
  const [showHidden, setShowHidden] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { height: windowHeight, landscape, compactHeight } = useResponsiveLayout()
  const browserSheetHeight = Math.round(windowHeight * (landscape || compactHeight ? DIRECTORY_SHEET_COMPACT_RATIO : DIRECTORY_SHEET_RATIO))

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    setError(undefined)
    void listDirectory(undefined).then(result => {
      if (cancelled) return
      if (result === undefined) { setLoading(false); return }
      setListing(result)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [visible, listDirectory])

  const open = async (path: string) => {
    setLoading(true)
    setError(undefined)
    const result = await listDirectory(path)
    if (result !== undefined) setListing(result)
    setLoading(false)
  }

  const entries = listing === undefined ? [] : listing.entries.filter(entry => showHidden || !entry.hidden)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <WorkspaceModalSurface onClose={onClose} backdropStyle={styles.backdrop} sheetStyle={[styles.browserSheet, { height: browserSheetHeight }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{strings.workspaces.chooseFolder}</Text>
          <IconButton label={strings.common.close} icon={X} onPress={onClose} />
        </View>
        <View style={styles.browserPath}>
          <Text style={styles.browserPathText} numberOfLines={1}>{listing?.path ?? strings.workspaces.loading}</Text>
        </View>
        <View style={styles.crumbRow}>
          {(listing?.crumbs ?? []).map((crumb, index, all) => (
            <Pressable key={`${crumb.path}-${index}`} onPress={() => void open(crumb.path)}>
              <Text style={styles.crumbText}>
                {crumb.name}{index < all.length - 1 ? ' / ' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
        {error !== undefined && <Text style={styles.errorText}>{error}</Text>}
        <ScrollView keyboardShouldPersistTaps="always" style={styles.browserList}>
          {loading
            ? <Text style={styles.loadingText}>{strings.workspaces.loadingDirectory}</Text>
            : entries.length === 0
              ? <Text style={styles.emptyText}>{strings.workspaces.noFolders}</Text>
              : (
                <GroupCard>
                  {entries.map((entry, index) => (
                    <Pressable
                      key={entry.path}
                      accessibilityRole="button"
                      onPress={() => void open(entry.path)}
                      style={({ pressed }) => [
                        styles.entryRow,
                        index > 0 && styles.entryDivider,
                        pressed && styles.workspaceRowPressed,
                      ]}
                    >
                      <Folder size={18} color={colors.primary} strokeWidth={1.8} />
                      <Text style={styles.entryName} numberOfLines={1}>{entry.name}</Text>
                      <ChevronRight size={16} color={colors.subtle} />
                    </Pressable>
                  ))}
                </GroupCard>
              )}
        </ScrollView>
        <View style={styles.browserFooter}>
          <Button
            label={showHidden ? strings.workspaces.hideHidden : strings.workspaces.showHidden}
            icon={showHidden ? EyeOff : Eye}
            variant="quiet"
            onPress={() => setShowHidden(current => !current)}
          />
          <Button
            label={strings.workspaces.chooseThisFolder}
            disabled={listing === undefined || loading}
            onPress={() => { if (listing !== undefined) onChoose(listing.path) }}
          />
        </View>
      </WorkspaceModalSurface>
    </Modal>
  )
}

function WorkspaceModalSurface({
  onClose,
  backdropStyle,
  sheetStyle,
  children,
}: {
  onClose: () => void
  backdropStyle: StyleProp<ViewStyle>
  sheetStyle: StyleProp<ViewStyle>
  children: ReactNode
}) {
  return (
    <View style={backdropStyle} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.common.close}
        onPress={onClose}
        pointerEvents="box-only"
        style={StyleSheet.absoluteFill}
      />
      <View style={[sheetStyle, { zIndex: 1, elevation: 1 }]} pointerEvents="box-none">{children}</View>
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
    grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.subtle, opacity: 0.45, alignSelf: 'center', marginBottom: spacing.xxs },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
    },
    sheetScroll: { flexGrow: 0, flexShrink: 1 },
    sheetScrollContent: { gap: spacing.md },
    browserSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.lg,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sheetTitle: { ...type.heading, fontSize: 18, fontWeight: '700', color: colors.ink },
    workspaceActionHeading: { flex: 1, minWidth: 0 },
    workspaceActionName: { ...type.smallStrong, color: colors.muted, marginTop: 2 },
    workspaceActionPath: { ...type.caption, color: colors.muted, fontFamily: 'monospace', paddingHorizontal: spacing.xxs },
    workspaceRowPressed: { opacity: 0.7 },
    disabled: { opacity: 0.55 },
    fieldLabel: { ...type.smallStrong, color: colors.ink },
    fieldHint: { ...type.caption, color: colors.muted },
    backendOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    backendOption: {
      minHeight: 42,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    backendOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    backendOptionText: { ...type.smallStrong, color: colors.muted },
    backendOptionTextSelected: { color: colors.primary },
    radioIndicator: {
      width: 18,
      height: 18,
      borderWidth: 2,
      borderColor: colors.border,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioIndicatorSelected: { borderColor: colors.primary },
    radioIndicatorDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
    pathRow: { flexDirection: 'row', gap: spacing.sm },
    pathInput: {
      flex: 1,
      ...type.body,
      color: colors.ink,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    titleInput: {
      ...type.body,
      color: colors.ink,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    browserPath: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.sm, marginTop: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator },
    browserPathText: { ...type.small, color: colors.ink, fontFamily: 'monospace' },
    crumbRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: spacing.xs },
    crumbText: { ...type.small, color: colors.primary },
    browserList: { flex: 1, marginTop: spacing.xs },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    entryDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    entryName: { ...type.body, color: colors.ink, flex: 1 },
    loadingText: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
    emptyText: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
    errorText: { ...type.small, color: colors.danger },
    browserFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  })
}
