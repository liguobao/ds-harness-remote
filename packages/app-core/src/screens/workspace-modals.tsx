import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CirclePlus,
  Code2,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import { deviceVersionSubtitle, platformIcon } from '../lib/device-display'
import { useAppStore } from '../state/store'
import type { AgentBackend, DirectoryListing, WorkspaceView } from '../types'
import { BlurHeaderFrame, Button, GroupCard, GroupRow, IconButton, Screen, SectionTitle, TopBar } from '../ui/components'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useResponsiveLayout } from '../ui/responsive'
import { useThemedStyles } from '../ui/use-themed-styles'
import { SheetModal } from '../ui/sheet'
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
    <SheetModal visible={target !== undefined} onClose={onClose} backdropStyle={styles.backdrop} sheetStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
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
    </SheetModal>
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
  useAppStore(state => state.language)
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const connectionPhase = useAppStore(state => state.connection.phase)
  const [backend, setBackend] = useState<AgentBackend>('harness')
  const [path, setPath] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { contentMaxWidth, landscape } = useResponsiveLayout()
  const sheetScrollRef = useRef<ScrollView>(null)
  const requestEpochRef = useRef(0)

  useEffect(() => {
    requestEpochRef.current += 1
    if (visible) sheetScrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [visible, selectedDevice?.deviceId])

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

  const dismissModal = () => {
    requestEpochRef.current += 1
    setBrowseOpen(false)
    onClose()
  }

  const create = async () => {
    const trimmed = path.trim()
    if (trimmed.length === 0) return
    const epoch = requestEpochRef.current
    const targetDeviceId = selectedDevice?.deviceId
    const workspace = await onCreate(trimmed, backend)
    if (
      workspace === undefined
      || requestEpochRef.current !== epoch
      || useAppStore.getState().selectedDevice?.deviceId !== targetDeviceId
    ) {
      return
    }
    setPath('')
    dismissModal()
    onCreated(workspace)
  }

  const openBrowser = () => {
    Keyboard.dismiss()
    setBrowseOpen(true)
  }

  const backendItems: Array<{ value: AgentBackend; label: string; detail: string; icon: LucideIcon }> = [
    { value: 'harness', label: strings.workspaces.dsh, detail: strings.devices.harness, icon: FolderOpen },
    ...(codexAvailable ? [{ value: 'codex' as const, label: strings.workspaces.codex, detail: 'OpenAI Codex', icon: Code2 }] : []),
    ...(claudeAvailable ? [{ value: 'claude' as const, label: strings.workspaces.claude, detail: 'Anthropic Claude', icon: Sparkles }] : []),
    ...(hermesAvailable ? [{ value: 'hermes' as const, label: strings.workspaces.hermes, detail: 'Nous Research Hermes', icon: Sparkles }] : []),
    ...(cursorAvailable ? [{ value: 'cursor' as const, label: strings.workspaces.cursor, detail: 'Cursor ACP', icon: Sparkles }] : []),
    ...(antigravityAvailable ? [{ value: 'antigravity' as const, label: strings.workspaces.antigravity, detail: 'Antigravity ACP', icon: Sparkles }] : []),
    ...(opencodeAvailable ? [{ value: 'opencode' as const, label: strings.workspaces.opencode, detail: 'OpenCode ACP', icon: Sparkles }] : []),
    ...(piAvailable ? [{ value: 'pi' as const, label: strings.workspaces.pi, detail: 'Pi ACP', icon: Sparkles }] : []),
  ]

  const directoryHint = backend === 'codex'
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
                : strings.workspaces.directoryHint

  const HostIcon = selectedDevice ? platformIcon(selectedDevice.platform) : FolderOpen
  const hostOnline = connectionPhase === 'connected'
  const hostConnecting = connectionPhase === 'connecting' || connectionPhase === 'reconnecting'
  const hostStatusDot = hostOnline ? colors.success : hostConnecting ? colors.warning : colors.disabled
  const hostStatusLabel = hostOnline ? strings.status.online : hostConnecting ? strings.status.waiting : strings.status.offline

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={dismissModal} statusBarTranslucent>
      <View style={styles.flex}>
        <BlurHeaderFrame
          header={
            <TopBar
              title={strings.workspaces.create}
              subtitle={selectedDevice?.name}
              onBack={dismissModal}
              centered
            />
          }
        >
          <Screen scrollRef={sheetScrollRef}>
            <View style={[styles.createContentColumn, landscape && { maxWidth: contentMaxWidth }]}>
              {selectedDevice !== undefined && (
                <>
                  <SectionTitle>{strings.sessionInfo.host}</SectionTitle>
                  <GroupCard>
                    <GroupRow
                      first
                      icon={HostIcon}
                      label={selectedDevice.name}
                      detail={deviceVersionSubtitle(selectedDevice)}
                      chevron={false}
                      accessory={
                        <View style={styles.createStatusInline}>
                          <View style={[styles.createStatusDot, { backgroundColor: hostStatusDot }]} />
                          <Text style={styles.createStatusText}>{hostStatusLabel}</Text>
                        </View>
                      }
                    />
                  </GroupCard>
                </>
              )}

              <SectionTitle>{strings.workspaces.deviceDirectory}</SectionTitle>
              <GroupCard>
                <View style={styles.createPathRow}>
                  <View style={styles.createPathIcon}>
                    <FolderOpen size={21} color={colors.primary} strokeWidth={1.8} />
                  </View>
                  <View style={styles.createPathBody}>
                    <TextInput
                      accessibilityLabel={strings.workspaces.deviceDirectory}
                      style={styles.createPathInput}
                      value={path}
                      onChangeText={setPath}
                      placeholder="/workspace/project"
                      placeholderTextColor={colors.muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!busy}
                      returnKeyType="done"
                    />
                    {path.length > 0 && !busy && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={strings.workspaces.clearSearch}
                        hitSlop={8}
                        onPress={() => setPath('')}
                        style={({ pressed }) => [styles.clearSearch, pressed && styles.workspaceRowPressed]}
                      >
                        <X size={17} color={colors.muted} />
                      </Pressable>
                    )}
                  </View>
                </View>
                <GroupRow
                  icon={Folder}
                  label={strings.workspaces.browse}
                  detail={strings.workspaces.chooseFolder}
                  disabled={busy}
                  onPress={openBrowser}
                />
              </GroupCard>
              <Text style={styles.createSectionNote}>{directoryHint}</Text>

              <SectionTitle>{strings.workspaces.type}</SectionTitle>
              <GroupCard>
                <View accessibilityRole="radiogroup">
                  {backendItems.map((option, index) => {
                    const chosen = backend === option.value
                    return (
                      <GroupRow
                        key={option.value}
                        first={index === 0}
                        icon={option.icon}
                        label={option.label}
                        detail={option.detail}
                        selected={chosen}
                        chevron={false}
                        disabled={busy}
                        onPress={() => setBackend(option.value)}
                        accessory={
                          <View style={styles.createCheckSlot}>
                            {chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : null}
                          </View>
                        }
                      />
                    )
                  })}
                </View>
              </GroupCard>

              <View style={styles.createPrimaryArea}>
                <Button
                  label={strings.workspaces.create}
                  icon={CirclePlus}
                  onPress={() => void create()}
                  loading={busy}
                  disabled={path.trim().length === 0}
                />
              </View>
            </View>
          </Screen>
        </BlurHeaderFrame>
        <DirectoryBrowserModal
          visible={browseOpen}
          onClose={() => setBrowseOpen(false)}
          onChoose={picked => { setPath(picked); setBrowseOpen(false) }}
        />
      </View>
    </Modal>
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
    <SheetModal visible={target !== undefined} onClose={onClose} backdropStyle={styles.backdrop} sheetStyle={[styles.sheet, { maxHeight: sheetMaxHeight }]}>
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
    </SheetModal>
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
    <SheetModal visible={visible} onClose={onClose} backdropStyle={styles.backdrop} sheetStyle={[styles.browserSheet, { height: browserSheetHeight, maxHeight: browserSheetHeight }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{strings.workspaces.chooseFolder}</Text>
          <IconButton label={strings.common.close} icon={X} onPress={onClose} />
        </View>
        <GroupCard style={styles.browserPathCard}>
          <View style={styles.browserPath}>
            <FolderOpen size={18} color={colors.primary} strokeWidth={1.8} />
            <Text style={styles.browserPathText} numberOfLines={1}>{listing?.path ?? strings.workspaces.loading}</Text>
          </View>
        </GroupCard>
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
        <ScrollView keyboardShouldPersistTaps="always" style={styles.browserList} showsVerticalScrollIndicator={false}>
          {loading
            ? <Text style={styles.loadingText}>{strings.workspaces.loadingDirectory}</Text>
            : entries.length === 0
              ? <Text style={styles.emptyText}>{strings.workspaces.noFolders}</Text>
              : (
                <GroupCard>
                  {entries.map((entry, index) => (
                    <GroupRow
                      key={entry.path}
                      first={index === 0}
                      icon={Folder}
                      label={entry.name}
                      onPress={() => void open(entry.path)}
                    />
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
    </SheetModal>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.background },
    backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
    grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.subtle, opacity: 0.45, alignSelf: 'center', marginBottom: spacing.xxs },
    createContentColumn: { width: '100%', alignSelf: 'center' },
    createStatusInline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    createStatusDot: { width: 7, height: 7, borderRadius: 4 },
    createStatusText: { ...type.caption, color: colors.muted },
    createPathRow: { minHeight: 58, paddingLeft: spacing.md, flexDirection: 'row', alignItems: 'center' },
    createPathIcon: { width: 28, marginRight: spacing.sm, alignItems: 'center', justifyContent: 'center' },
    createPathBody: { flex: 1, minWidth: 0, minHeight: 58, paddingRight: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    createPathInput: { flex: 1, ...type.body, fontSize: 16, color: colors.ink, paddingVertical: spacing.sm },
    clearSearch: { padding: spacing.xxs, alignItems: 'center', justifyContent: 'center' },
    createSectionNote: { ...type.caption, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: spacing.xs, paddingHorizontal: spacing.md },
    createCheckSlot: { width: 20, alignItems: 'center', justifyContent: 'center' },
    createPrimaryArea: { marginTop: spacing.xl },
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
    browserPathCard: { marginTop: spacing.xs },
    browserPath: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    browserPathText: { flex: 1, ...type.small, color: colors.ink, fontFamily: 'monospace' },
    crumbRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: spacing.xs, paddingHorizontal: spacing.xxs },
    crumbText: { ...type.small, color: colors.primary },
    browserList: { flex: 1, marginTop: spacing.xs },
    loadingText: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
    emptyText: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
    errorText: { ...type.small, color: colors.danger },
    browserFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  })
}
