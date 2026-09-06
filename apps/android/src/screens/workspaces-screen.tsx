import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CirclePlus, Code2, Eye, EyeOff, Folder, FolderOpen, Laptop, MessageSquareText, MoreVertical, Pencil, Search, Trash2, X } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import type { DirectoryListing, RemoteSession, WorkspaceView } from '../types'
import { Button, EmptyState, IconButton, Screen, TopBar } from '../ui/components'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings as zhCN } from '../locales/i18n'
import { loadCollapsedWorkspaceIds, loadWorkspaceBackend, saveCollapsedWorkspaceIds, saveWorkspaceBackend } from '../services/storage'
import { resolveSessionDisplayTitle } from './session-title'

export function WorkspacesScreen({ onBack, onSession, onDeviceInfo }: {
  onBack: () => void
  onSession: (session: RemoteSession) => void
  onDeviceInfo: () => void
}) {
  const selectedDevice = useAppStore(state => state.selectedDevice)
  const codexAvailable = useAppStore(state => state.codexAvailable)
  const workspaces = useAppStore(state => state.workspaces)
  const sessions = useAppStore(state => state.sessions)
  const busy = useAppStore(state => state.busyAction)
  const workspaceCreate = useAppStore(state => state.workspaceCreate)
  const workspaceRename = useAppStore(state => state.workspaceRename)
  const workspaceDelete = useAppStore(state => state.workspaceDelete)
  const workspaceMove = useAppStore(state => state.workspaceMove)
  const refreshWorkspaces = useAppStore(state => state.refreshWorkspaces)
  const createSession = useAppStore(state => state.createSession)
  const openSession = useAppStore(state => state.openSession)
  const [refreshing, setRefreshing] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [activeBackend, setActiveBackend] = useState<'harness' | 'codex'>(() => initialWorkspaceBackend(workspaces, codexAvailable))
  const [searchQuery, setSearchQuery] = useState('')
  const [renameTarget, setRenameTarget] = useState<WorkspaceView | undefined>(undefined)
  const [actionsTarget, setActionsTarget] = useState<WorkspaceView | undefined>(undefined)
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<ReadonlySet<string>>(() => new Set())
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  useEffect(() => {
    const deviceId = selectedDevice?.deviceId
    let cancelled = false
    setActiveBackend(initialWorkspaceBackend(workspaces, codexAvailable))
    setSearchQuery('')
    setCollapsedWorkspaceIds(new Set())
    if (deviceId === undefined) return () => { cancelled = true }
    void loadWorkspaceBackend(deviceId).then(backend => {
      if (!cancelled && backend !== undefined && (backend !== 'codex' || codexAvailable)) setActiveBackend(backend)
    })
    void loadCollapsedWorkspaceIds(deviceId).then(workspaceIds => {
      if (!cancelled) setCollapsedWorkspaceIds(new Set(workspaceIds))
    })
    return () => { cancelled = true }
  }, [selectedDevice?.deviceId])

  const selectBackend = (backend: 'harness' | 'codex') => {
    setActiveBackend(backend)
    const deviceId = selectedDevice?.deviceId
    if (deviceId !== undefined) void saveWorkspaceBackend(deviceId, backend)
  }

  useEffect(() => {
    if (!codexAvailable) setActiveBackend('harness')
  }, [codexAvailable])

  const toggleWorkspace = (workspace: WorkspaceView) => setCollapsedWorkspaceIds(current => {
    const next = new Set(current)
    const key = workspaceCollapseKey(workspace, selectedDevice?.platform)
    if (next.has(key) || next.has(workspace.workspaceId)) {
      next.delete(key)
      // Remove the pre-path-key value when migrating an existing install.
      next.delete(workspace.workspaceId)
    } else {
      next.add(key)
    }
    const deviceId = selectedDevice?.deviceId
    if (deviceId !== undefined) void saveCollapsedWorkspaceIds(deviceId, [...next])
    return next
  })

  const open = async (session: RemoteSession) => {
    if (await openSession(session)) onSession(session)
  }

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshWorkspaces()
    } finally {
      setRefreshing(false)
    }
  }

  const createInWorkspace = async (workspaceId: string) => {
    if (!await createSession(workspaceId)) return
    const created = useAppStore.getState().selectedSession
    if (created !== undefined) onSession(created)
  }

  const confirmDelete = (workspace: WorkspaceView) => Alert.alert(
    zhCN.workspaces.deleteTitle(workspace.title),
    zhCN.workspaces.deleteBody,
    [
      { text: zhCN.common.cancel, style: 'cancel' },
      { text: zhCN.workspaces.delete, style: 'destructive', onPress: () => void workspaceDelete(workspace.workspaceId) },
    ],
  )

  const manageableWorkspaces = workspaces.filter(workspace => workspace.backend !== 'codex')
  const backendWorkspaces = workspaces.filter(workspace => activeBackend === 'codex'
    ? workspace.backend === 'codex'
    : workspace.backend !== 'codex')
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
  const filteredWorkspaces = normalizedSearchQuery.length === 0
    ? backendWorkspaces
    : backendWorkspaces.filter(workspace => [
        workspace.title,
        workspace.path,
      ].some(value => value.toLocaleLowerCase().includes(normalizedSearchQuery)))
  const actionsIndex = actionsTarget === undefined
    ? -1
    : manageableWorkspaces.findIndex(item => item.workspaceId === actionsTarget.workspaceId)

  const moveSelectedWorkspace = (direction: 'up' | 'down') => {
    if (actionsTarget === undefined || actionsIndex < 0) return
    const beforeWorkspaceId = direction === 'up'
      ? manageableWorkspaces[actionsIndex - 1]?.workspaceId
      : manageableWorkspaces[actionsIndex + 2]?.workspaceId
    if (direction === 'up' && beforeWorkspaceId === undefined) return
    if (direction === 'down' && actionsIndex >= manageableWorkspaces.length - 1) return
    setActionsTarget(undefined)
    void workspaceMove(actionsTarget.workspaceId, beforeWorkspaceId)
  }

  return (
    <View style={styles.flex}>
      <TopBar
        title={zhCN.workspaces.title}
        onBack={onBack}
        action={<IconButton label={zhCN.workspaces.deviceInfo} icon={Laptop} onPress={onDeviceInfo} />}
      />
      <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
        <View style={styles.pageHeading}>
          <View style={styles.pageHeadingCopy}>
            <Text style={styles.title} numberOfLines={1} ellipsizeMode="middle">
              {selectedDevice === undefined ? zhCN.workspaces.title : zhCN.workspaces.deviceTitle(selectedDevice.name)}
            </Text>
          </View>
          <IconButton
            label={zhCN.workspaces.create}
            icon={CirclePlus}
            onPress={() => setCreateOpen(true)}
          />
        </View>
        {codexAvailable && <View style={styles.backendTabs} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeBackend === 'harness' }}
            onPress={() => selectBackend('harness')}
            style={({ pressed }) => [
              styles.backendTab,
              activeBackend === 'harness' && styles.backendTabActive,
              pressed && styles.workspaceRowPressed,
            ]}
          >
            <Text style={[styles.backendTabText, activeBackend === 'harness' && styles.backendTabTextActive]}>{zhCN.workspaces.dsh}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeBackend === 'codex' }}
            onPress={() => selectBackend('codex')}
            style={({ pressed }) => [
              styles.backendTab,
              activeBackend === 'codex' && styles.backendTabActive,
              pressed && styles.workspaceRowPressed,
            ]}
          >
            <Text style={[styles.backendTabText, activeBackend === 'codex' && styles.backendTabTextActive]}>{zhCN.workspaces.codex}</Text>
          </Pressable>
        </View>}
        {backendWorkspaces.length > 0 && <View style={styles.searchField}>
          <Search size={18} color={colors.muted} />
          <TextInput
            accessibilityLabel={zhCN.workspaces.search}
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={zhCN.workspaces.search}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && <Pressable
            accessibilityRole="button"
            accessibilityLabel={zhCN.workspaces.clearSearch}
            hitSlop={8}
            onPress={() => setSearchQuery('')}
            style={({ pressed }) => [styles.clearSearch, pressed && styles.workspaceRowPressed]}
          >
            <X size={17} color={colors.muted} />
          </Pressable>}
        </View>}
        {backendWorkspaces.length === 0
          ? <EmptyState
              icon={FolderOpen}
              title={zhCN.workspaces.emptyTitle}
              body={zhCN.workspaces.emptyBody}
              action={<Button label={zhCN.workspaces.create} icon={CirclePlus} onPress={() => setCreateOpen(true)} />}
            />
          : filteredWorkspaces.length === 0
            ? <EmptyState
                icon={Search}
                title={zhCN.workspaces.noSearchResults}
                body={zhCN.workspaces.noSearchResultsBody}
                action={<Button label={zhCN.workspaces.clearSearch} variant="secondary" onPress={() => setSearchQuery('')} />}
              />
            : <View>{filteredWorkspaces.map(workspace => {
              const workspaceSessions = workspace.sessionIds.flatMap(sessionId => {
                const session = sessions.find(item => item.sessionId === sessionId)
                return session === undefined ? [] : [session]
              })
              const collapseKey = workspaceCollapseKey(workspace, selectedDevice?.platform)
              const collapsed = collapsedWorkspaceIds.has(collapseKey) || collapsedWorkspaceIds.has(workspace.workspaceId)
              return (
                <View key={workspace.workspaceId} style={styles.workspaceGroup}>
                  <View style={styles.workspaceRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={collapsed ? zhCN.workspaces.expandWorkspace(workspace.title) : zhCN.workspaces.collapseWorkspace(workspace.title)}
                      accessibilityState={{ expanded: !collapsed }}
                      onPress={() => toggleWorkspace(workspace)}
                      style={({ pressed }) => [styles.workspaceToggle, pressed && styles.workspaceRowPressed]}
                    >
                      <View style={styles.workspaceIcon}>
                        {workspace.backend === 'codex'
                          ? <Code2 size={18} color={colors.primary} />
                          : collapsed
                            ? <Folder size={18} color={colors.primary} />
                            : <FolderOpen size={18} color={colors.primary} />}
                      </View>
                      <View style={styles.workspaceCopy}>
                        <Text style={styles.workspaceTitle} numberOfLines={1}>{workspace.title}</Text>
                        <Text style={styles.workspacePath} numberOfLines={1} ellipsizeMode="tail">
                          {workspaceParentPath(workspace.path)}
                        </Text>
                      </View>
                      {collapsed
                        ? <ChevronRight size={18} color={colors.subtle} />
                        : <ChevronDown size={18} color={colors.subtle} />}
                    </Pressable>
                    <IconButton label={zhCN.workspaces.newSessionIn(workspace.title)} icon={CirclePlus} onPress={() => void createInWorkspace(workspace.workspaceId)} />
                    {workspace.backend !== 'codex' && <IconButton label={zhCN.workspaces.options} icon={MoreVertical} onPress={() => setActionsTarget(workspace)} />}
                  </View>
                  {!collapsed && (workspaceSessions.length === 0
                    ? <Pressable onPress={() => void createInWorkspace(workspace.workspaceId)} style={styles.noSessions}><Text style={styles.noSessionsText}>{zhCN.workspaces.noSessions}</Text></Pressable>
                    : workspaceSessions.map(session => {
                        const opening = busy === `session:${session.sessionId}`
                        return <Pressable
                          key={session.sessionId}
                          accessibilityRole="button"
                          accessibilityState={{ busy: opening, disabled: busy !== undefined && !opening }}
                          disabled={busy !== undefined}
                          onPress={() => void open(session)}
                          style={({ pressed }) => [styles.sessionRow, pressed && styles.workspaceRowPressed, busy !== undefined && !opening && styles.disabled]}
                        >
                          {opening
                            ? <ActivityIndicator size="small" color={colors.primary} />
                            : session.backend === 'codex'
                              ? <Code2 size={17} color={colors.muted} />
                              : <MessageSquareText size={17} color={colors.muted} />}
                          <View style={styles.sessionCopy}>
                          <Text style={styles.sessionTitle} numberOfLines={1}>{resolveSessionTitle(session)}</Text>
                            <Text style={styles.sessionMeta}>{session.running ? zhCN.status.running : relativeTime(session.updatedAt)}</Text>
                          </View>
                          <ChevronRight size={17} color={colors.subtle} />
                        </Pressable>
                      }))}
                </View>
              )
            })}</View>}
      </Screen>

      <CreateWorkspaceModal
        visible={createOpen}
        codexAvailable={codexAvailable}
        initialBackend={activeBackend}
        busy={busy === 'create-workspace' || busy === 'create-codex-workspace'}
        onClose={() => setCreateOpen(false)}
        onCreate={workspaceCreate}
        onCreated={workspace => void createInWorkspace(workspace.workspaceId)}
      />
      <RenameWorkspaceModal
        target={renameTarget}
        busy={renameTarget !== undefined && busy === `rename-workspace:${renameTarget.workspaceId}`}
        onClose={() => setRenameTarget(undefined)}
        onRename={async (workspaceId, title) => workspaceRename(workspaceId, title)}
      />
      <WorkspaceActionsModal
        target={actionsTarget}
        canMoveUp={actionsIndex > 0}
        canMoveDown={actionsIndex >= 0 && actionsIndex < manageableWorkspaces.length - 1}
        busy={busy !== undefined}
        onClose={() => setActionsTarget(undefined)}
        onRename={() => {
          if (actionsTarget === undefined) return
          const target = actionsTarget
          setActionsTarget(undefined)
          setRenameTarget(target)
        }}
        onMoveUp={() => moveSelectedWorkspace('up')}
        onMoveDown={() => moveSelectedWorkspace('down')}
        onDelete={() => {
          if (actionsTarget === undefined) return
          const target = actionsTarget
          setActionsTarget(undefined)
          confirmDelete(target)
        }}
      />
    </View>
  )
}

function WorkspaceActionsModal({ target, canMoveUp, canMoveDown, busy, onClose, onRename, onMoveUp, onMoveDown, onDelete }: {
  target?: WorkspaceView
  canMoveUp: boolean
  canMoveDown: boolean
  busy: boolean
  onClose: () => void
  onRename: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <Modal visible={target !== undefined} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <View style={styles.workspaceActionHeading}>
              <Text style={styles.sheetTitle}>{zhCN.workspaces.options}</Text>
              {target !== undefined && <Text style={styles.workspaceActionName} numberOfLines={1}>{target.title}</Text>}
            </View>
            <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
          </View>
          {target !== undefined && <Text style={styles.workspaceActionPath} numberOfLines={2}>{target.path}</Text>}
          <View style={styles.workspaceActionButtons}>
            <Button label={zhCN.workspaces.rename} icon={Pencil} variant="secondary" onPress={onRename} disabled={busy} />
            <View style={styles.workspaceMoveActions}>
              <View style={styles.workspaceMoveButton}><Button label={zhCN.workspaces.moveUp} icon={ArrowUp} variant="secondary" onPress={onMoveUp} disabled={busy || !canMoveUp} /></View>
              <View style={styles.workspaceMoveButton}><Button label={zhCN.workspaces.moveDown} icon={ArrowDown} variant="secondary" onPress={onMoveDown} disabled={busy || !canMoveDown} /></View>
            </View>
            <Button label={zhCN.workspaces.delete} icon={Trash2} variant="danger" onPress={onDelete} disabled={busy} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function resolveSessionTitle(session: RemoteSession): string {
  const resolvedTitle = resolveSessionDisplayTitle(session)
  if (resolvedTitle !== undefined) return resolvedTitle
  if (session.blank && session.parentSessionId === undefined) return zhCN.sessions.untitled
  return session.parentSessionId === undefined ? zhCN.sessions.untitled : zhCN.sessions.child
}

function workspaceParentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  const parentSegments = segments.slice(0, -1)
  if (parentSegments.length === 0) return normalized.startsWith('/') ? '/' : path
  const rootPrefix = normalized.startsWith('/') ? '/' : ''
  return `${rootPrefix}${parentSegments.join('/')}`
}

/** CodeX project ids can change when its catalog falls back to thread cwd; the authority path remains stable. */
function workspaceCollapseKey(workspace: WorkspaceView, platform?: string): string {
  if (workspace.backend !== 'codex') return workspace.workspaceId
  const normalized = workspace.path.replace(/\\/gu, '/').replace(/\/+$/u, '') || '/'
  return `codex:path:${platform === 'win32' ? normalized.toLocaleLowerCase() : normalized}`
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp)
  if (delta < 60_000) return zhCN.time.justNow
  if (delta < 3_600_000) return zhCN.time.minutesAgo(Math.floor(delta / 60_000))
  if (delta < 86_400_000) return zhCN.time.hoursAgo(Math.floor(delta / 3_600_000))
  return new Date(timestamp).toLocaleDateString(zhCN.time.locale)
}

function initialWorkspaceBackend(workspaces: readonly WorkspaceView[], codexAvailable: boolean): 'harness' | 'codex' {
  if (!codexAvailable) return 'harness'
  const hasHarnessWorkspace = workspaces.some(workspace => workspace.backend !== 'codex')
  const hasCodexWorkspace = workspaces.some(workspace => workspace.backend === 'codex')
  return !hasHarnessWorkspace && hasCodexWorkspace ? 'codex' : 'harness'
}

function CreateWorkspaceModal({ visible, codexAvailable, initialBackend, busy, onClose, onCreate, onCreated }: {
  visible: boolean
  codexAvailable: boolean
  initialBackend: 'harness' | 'codex'
  busy: boolean
  onClose: () => void
  onCreate: (path: string, backend: 'harness' | 'codex') => Promise<WorkspaceView | undefined>
  onCreated: (workspace: WorkspaceView) => void
}) {
  const [backend, setBackend] = useState<'harness' | 'codex'>('harness')
  const [path, setPath] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  useEffect(() => {
    if (visible) setBackend(codexAvailable ? initialBackend : 'harness')
  }, [codexAvailable, initialBackend, visible])

  const create = async () => {
    const trimmed = path.trim()
    if (trimmed.length === 0) return
    const workspace = await onCreate(trimmed, backend)
    if (workspace === undefined) return
    setPath('')
    onClose()
    onCreated(workspace)
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{zhCN.workspaces.create}</Text>
              <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
            </View>
            <Text style={styles.fieldLabel}>{zhCN.workspaces.type}</Text>
            <View style={styles.backendOptions}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: backend === 'harness', disabled: busy }}
                disabled={busy}
                onPress={() => setBackend('harness')}
                style={({ pressed }) => [
                  styles.backendOption,
                  backend === 'harness' && styles.backendOptionSelected,
                  pressed && !busy && styles.workspaceRowPressed,
                  busy && styles.disabled,
                ]}
              >
                <View style={[styles.radioIndicator, backend === 'harness' && styles.radioIndicatorSelected]}>
                  {backend === 'harness' && <View style={styles.radioIndicatorDot} />}
                </View>
                <Text style={[styles.backendOptionText, backend === 'harness' && styles.backendOptionTextSelected]}>{zhCN.workspaces.dsh}</Text>
              </Pressable>
              {codexAvailable && <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: backend === 'codex', disabled: busy }}
                disabled={busy}
                onPress={() => setBackend('codex')}
                style={({ pressed }) => [
                  styles.backendOption,
                  backend === 'codex' && styles.backendOptionSelected,
                  pressed && !busy && styles.workspaceRowPressed,
                  busy && styles.disabled,
                ]}
              >
                <View style={[styles.radioIndicator, backend === 'codex' && styles.radioIndicatorSelected]}>
                  {backend === 'codex' && <View style={styles.radioIndicatorDot} />}
                </View>
                <Text style={[styles.backendOptionText, backend === 'codex' && styles.backendOptionTextSelected]}>{zhCN.workspaces.codex}</Text>
              </Pressable>}
            </View>
            <Text style={styles.fieldLabel}>{zhCN.workspaces.deviceDirectory}</Text>
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
              <Button label={zhCN.workspaces.browse} variant="secondary" onPress={() => setBrowseOpen(true)} disabled={busy} />
            </View>
            <Text style={styles.fieldHint}>{backend === 'codex' ? zhCN.workspaces.codexDirectoryHint : zhCN.workspaces.directoryHint}</Text>
            <Button label={zhCN.workspaces.create} onPress={() => void create()} loading={busy} disabled={path.trim().length === 0} />
          </Pressable>
        </Pressable>
      </Modal>
      <DirectoryBrowserModal
        visible={browseOpen}
        onClose={() => setBrowseOpen(false)}
        onChoose={picked => { setPath(picked); setBrowseOpen(false) }}
      />
    </>
  )
}

function RenameWorkspaceModal({ target, busy, onClose, onRename }: {
  target?: WorkspaceView
  busy: boolean
  onClose: () => void
  onRename: (workspaceId: string, title: string) => Promise<boolean>
}) {
  const [title, setTitle] = useState('')
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  useEffect(() => {
    if (target !== undefined) setTitle(target.title)
  }, [target])

  const rename = async () => {
    const trimmed = title.trim()
    if (target === undefined || trimmed.length === 0) return
    if (await onRename(target.workspaceId, trimmed)) onClose()
  }

  return (
    <Modal visible={target !== undefined} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={event => event.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{zhCN.workspaces.renameTitle}</Text>
            <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
          </View>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={setTitle}
            placeholder={zhCN.workspaces.namePlaceholder}
            placeholderTextColor={colors.muted}
            autoFocus
            editable={!busy}
          />
          <Button label={zhCN.workspaces.saveName} onPress={() => void rename()} loading={busy} disabled={title.trim().length === 0} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function DirectoryBrowserModal({ visible, onClose, onChoose }: {
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.browserSheet} onPress={event => event.stopPropagation()}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{zhCN.workspaces.chooseFolder}</Text>
            <IconButton label={zhCN.common.close} icon={X} onPress={onClose} />
          </View>
          <View style={styles.browserPath}>
            <Text style={styles.browserPathText} numberOfLines={1}>{listing?.path ?? zhCN.workspaces.loading}</Text>
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
          <ScrollView style={styles.browserList}>
            {loading
              ? <Text style={styles.loadingText}>{zhCN.workspaces.loadingDirectory}</Text>
              : entries.length === 0
                ? <Text style={styles.emptyText}>{zhCN.workspaces.noFolders}</Text>
                : entries.map(entry => (
                    <Pressable
                      key={entry.path}
                      accessibilityRole="button"
                      onPress={() => void open(entry.path)}
                      style={styles.entryRow}
                    >
                      <Folder size={16} color={colors.primary} />
                      <Text style={styles.entryName} numberOfLines={1}>{entry.name}</Text>
                      <ChevronRight size={14} color={colors.muted} />
                    </Pressable>
                  ))}
          </ScrollView>
          <View style={styles.browserFooter}>
            <Button
              label={showHidden ? zhCN.workspaces.hideHidden : zhCN.workspaces.showHidden}
              icon={showHidden ? EyeOff : Eye}
              variant="quiet"
              onPress={() => setShowHidden(current => !current)}
            />
            <Button
              label={zhCN.workspaces.chooseThisFolder}
              disabled={listing === undefined || loading}
              onPress={() => { if (listing !== undefined) onChoose(listing.path) }}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  pageHeading: { paddingTop: spacing.xxl, paddingBottom: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  pageHeadingCopy: { flex: 1 },
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.small, color: colors.muted, marginTop: 2 },
  backendTabs: { flexDirection: 'row', padding: spacing.xxs, borderRadius: radius.md, backgroundColor: colors.surfaceStrong, marginBottom: spacing.md },
  backendTab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: spacing.xs },
  backendTabActive: { backgroundColor: colors.surface },
  backendTabText: { ...type.smallStrong, color: colors.muted, textAlign: 'center' },
  backendTabTextActive: { color: colors.primary },
  searchField: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.lg },
  searchInput: { flex: 1, ...type.body, color: colors.ink, paddingVertical: spacing.sm },
  clearSearch: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  workspaceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  workspaceToggle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  workspaceRowPressed: { opacity: 0.7 },
  disabled: { opacity: 0.55 },
  workspaceIcon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  workspaceCopy: { flex: 1, gap: 2 },
  workspaceTitle: { ...type.bodyStrong, color: colors.ink },
  workspacePath: { ...type.caption, color: colors.muted, fontFamily: 'monospace', writingDirection: 'ltr' },
  workspaceMeta: { ...type.caption, color: colors.muted },
  workspaceGroup: { marginBottom: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.sm },
  sessionRow: { minHeight: 58, marginLeft: 50, paddingVertical: spacing.sm, paddingRight: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  sessionCopy: { flex: 1 },
  sessionTitle: { ...type.smallStrong, color: colors.ink },
  sessionMeta: { ...type.caption, color: colors.muted, marginTop: 2 },
  noSessions: { minHeight: 48, marginLeft: 50, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  noSessionsText: { ...type.small, color: colors.primary },
  primaryArea: { marginTop: spacing.xxl },
  backdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  browserSheet: { height: '75%', backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, paddingBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { ...type.heading, color: colors.ink },
  workspaceActionHeading: { flex: 1, minWidth: 0 },
  workspaceActionName: { ...type.smallStrong, color: colors.muted, marginTop: 2 },
  workspaceActionPath: { ...type.caption, color: colors.muted, fontFamily: 'monospace' },
  workspaceActionButtons: { gap: spacing.sm },
  workspaceMoveActions: { flexDirection: 'row', gap: spacing.sm },
  workspaceMoveButton: { flex: 1 },
  fieldLabel: { ...type.smallStrong, color: colors.ink },
  fieldHint: { ...type.caption, color: colors.muted },
  backendOptions: { flexDirection: 'row', gap: spacing.sm },
  backendOption: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backendOptionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  backendOptionText: { ...type.smallStrong, color: colors.muted },
  backendOptionTextSelected: { color: colors.primary },
  radioIndicator: { width: 20, height: 20, borderWidth: 2, borderColor: colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  radioIndicatorSelected: { borderColor: colors.primary },
  radioIndicatorDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  pathRow: { flexDirection: 'row', gap: spacing.sm },
  pathInput: { flex: 1, ...type.body, color: colors.ink, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  titleInput: { ...type.body, color: colors.ink, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  browserPath: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm },
  browserPathText: { ...type.small, color: colors.ink, fontFamily: 'monospace' },
  crumbRow: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: spacing.xs },
  crumbText: { ...type.small, color: colors.primary },
  browserList: { flex: 1, marginTop: spacing.xs },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  entryName: { ...type.body, color: colors.ink, flex: 1 },
  loadingText: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
  emptyText: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
  errorText: { ...type.small, color: colors.danger },
  browserFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md },
  })
}
