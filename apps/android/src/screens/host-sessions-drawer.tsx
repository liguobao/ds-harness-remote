import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, TextInput, ScrollView, SectionList, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Activity, ArrowLeft, Check, ChevronDown, ChevronRight, Code2, Folder, FolderOpen, MessageSquare, Sparkles, RefreshCw, Star, Search } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAppStore } from '../state/store'
import type { AgentBackend, RemoteSession } from '../types'
import { strings } from '../locales/i18n'
import { IconButton } from '../ui/components'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { resolveSessionDisplayTitle } from './session-title'
import { backendGroups, browseStatus } from '../lib/backend-groups'
import { loadHostSessionsDrawerGroups, saveHostSessionsDrawerGroup, loadWorkspaceBackend, saveWorkspaceBackend } from '../services/storage'

import { browseKey, browseScope, useBrowseMemory, updateBrowseEntry } from '../services/browse-memory'
const SESSION_PAGE_SIZE = 3

export function HostSessionsDrawer({ onBack, onClose, onSelect, inline = false }: {
  onBack: () => void
  onClose: () => void
  onSelect: (session: RemoteSession) => Promise<void>
  /** Render as a persistent tablet sidebar instead of a modal drawer. */
  inline?: boolean
}) {
  // The store's catalog is scoped to selectedDevice and reset when changing hosts.
  const device = useAppStore(state => state.selectedDevice)
  const sessions = useAppStore(state => state.sessions)
  const currentWorkSessionIds = useAppStore(state => state.currentWorkSessionIds)
  const lifecycles = useAppStore(state => state.sessionLifecycles)
  const selected = useAppStore(state => state.selectedSession)
  const archivedIds = useAppStore(state => state.archivedSessionIds)
  const workspaces = useAppStore(state => state.workspaces)
  const busy = useAppStore(state => state.busyAction)
  const error = useAppStore(state => state.error)
  const connected = useAppStore(state => state.connection.phase === 'connected')
  const refreshWorkspaces = useAppStore(state => state.refreshWorkspaces)
  const [refreshing, setRefreshing] = useState(false)
  const [query, setQuery] = useState('')
  const memoryScope = browseScope(useAppStore.getState())
  const entries = useBrowseMemory(state => state.entries)
  const [visibleSessionCounts, setVisibleSessionCounts] = useState<Record<string, number>>({})
  const [backend, setBackend] = useState<AgentBackend>(selected?.backend ?? 'codex')
  const tabTouched = useRef(false)
  const available = useAppStore(state => [
    'harness', state.codexAvailable && 'codex', state.cursorAvailable && 'cursor',
    state.antigravityAvailable && 'antigravity', state.piAvailable && 'pi',
    state.opencodeAvailable && 'opencode', state.claudeAvailable && 'claude',
  ].filter(Boolean).join(','))
  const backends = [...new Set<AgentBackend>([...available.split(',') as AgentBackend[], ...workspaces.map(w => w.backend ?? 'harness')])]
  const selectBackend = (value: AgentBackend) => {
    tabTouched.current = true
    setBackend(value)
    if (device?.deviceId !== undefined) void saveWorkspaceBackend(device.deviceId, value).catch(() => undefined)
  }
  const deviceId = device?.deviceId
  const [groupsByDevice, setGroupsByDevice] = useState<Record<string, Record<string, boolean>>>({})
  const [storageErrors, setStorageErrors] = useState<Record<string, boolean>>({})
  const [loadedDeviceId, setLoadedDeviceId] = useState<string>()
  const groupsReady = deviceId === undefined || loadedDeviceId === deviceId
  const expandedGroups = deviceId === undefined ? {} : groupsByDevice[deviceId] ?? {}
  useEffect(() => {
    if (connected && groupsReady) void refreshWorkspaces(backend)
  }, [backend, connected, groupsReady, deviceId, refreshWorkspaces])
  useEffect(() => {
    if (deviceId === undefined) return
    setLoadedDeviceId(undefined)
    tabTouched.current = false
    void loadWorkspaceBackend(deviceId).then(value => {
      if (!cancelled && !tabTouched.current && value !== undefined) setBackend(value)
    }).catch(() => undefined)
    let cancelled = false
    void loadHostSessionsDrawerGroups(deviceId).then(saved => {
      if (cancelled) return
      // Explicit user choices made while reading take precedence over hydration.
      setGroupsByDevice(current => ({ ...current, [deviceId]: { ...saved, ...current[deviceId] } }))
    }).catch(() => {
      if (!cancelled) setStorageErrors(current => ({ ...current, [deviceId]: true }))
    }).finally(() => {
      if (!cancelled) setLoadedDeviceId(deviceId)
    })
    return () => { cancelled = true }
  }, [deviceId])
  const toggleGroup = (key: string, expanded: boolean) => {
    if (deviceId === undefined) return
    setGroupsByDevice(current => ({ ...current, [deviceId]: { ...current[deviceId], [key]: expanded } }))
    // Keep a failure visible for this open drawer: later successful writes to
    // another group do not imply the failed choice was persisted.
    void saveHostSessionsDrawerGroup(deviceId, key, expanded).catch(() => {
      setStorageErrors(current => ({ ...current, [deviceId]: true }))
    })
  }
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const groups = useMemo(() => backendGroups({ backend, workspaces, sessions,
    archived: archivedIds, recent: currentWorkSessionIds, selected, lifecycles }),
    [backend, workspaces, sessions, archivedIds, currentWorkSessionIds, selected, lifecycles])
  const stars = sessions.filter(s => (s.backend ?? 'harness') === backend && !archivedIds.includes(s.sessionId) && entries[browseKey(memoryScope, s.sessionId)]?.starred)
  const visibleGroups = [...(stars.length ? [{key: `starred:${backend}`, title: strings.comfort.starred, backend, sessions: stars}] : []), ...groups]
  const search = query.trim().toLocaleLowerCase()
  const sections = visibleGroups.map(group => ({...group, sessions: !search || group.title.toLocaleLowerCase().includes(search) ? group.sessions
    : group.sessions.filter(s => (resolveSessionDisplayTitle(s) ?? '').toLocaleLowerCase().includes(search))})).filter(g => !search || g.sessions.length > 0).map(group => {
    const isWorkspace = group.key.startsWith('workspace:')
    const expanded = search ? true : expandedGroups[group.key] ?? (isWorkspace || group.key.startsWith('starred:') || group.key.startsWith('active:') || group.key.startsWith('recent:') || group.sessions.some(session => session.sessionId === selected?.sessionId))
    const visibleSessions = isWorkspace && !search ? group.sessions.slice(0, visibleSessionCounts[group.key] ?? SESSION_PAGE_SIZE) : group.sessions
    return { ...group, expanded, data: expanded ? visibleSessions : [] }
  })
  const refresh = async () => {
    if (refreshing || busy !== undefined || !connected) return
    setRefreshing(true)
    try { await refreshWorkspaces(backend) } finally { setRefreshing(false) }
  }

  const pane = <>
        <View style={styles.header}>
          {inline ? <View style={styles.headerSpacer} /> : <IconButton label={strings.app.backToDevices} icon={ArrowLeft} onPress={onBack} />}
          <Text style={styles.title} numberOfLines={1}>{device?.name}</Text>
          <IconButton label={strings.common.refresh} icon={RefreshCw} onPress={() => void refresh()} disabled={refreshing || busy !== undefined || !connected} />
        </View>
        {error !== undefined && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
        {deviceId !== undefined && storageErrors[deviceId] && <Text style={styles.error} accessibilityRole="alert">{strings.app.secureStorageUnavailable}</Text>}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabContent} accessibilityRole="tablist">
          {backends.map(value => <Pressable key={value} accessibilityRole="tab"
            accessibilityState={{selected: backend === value}} onPress={() => selectBackend(value)}
            style={[styles.tab, backend === value && styles.activeRow]}>
            <Text style={[styles.sessionTitle, backend === value && styles.activeTitle]}>{value === 'harness' ? 'DSH' : value === 'codex' ? 'Codex' : value}</Text>
          </Pressable>)}
        </ScrollView>
        <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8}}>
          <Search size={18} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={strings.comfort.search}
            placeholderTextColor={colors.muted} accessibilityLabel={strings.comfort.searchLabel} style={{flex: 1, minHeight: 44, color: colors.ink}} />
        </View>
        <SectionList
          sections={groupsReady ? sections : []}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={groupsReady ? null : <ActivityIndicator style={styles.loading} color={colors.muted} accessibilityLabel={strings.workspaces.loading} />}
          stickySectionHeadersEnabled={false}
          keyExtractor={session => `${backend}:${session.sessionId}`}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => void refresh()}
          renderSectionFooter={({ section }) => {
            if (!section.expanded) return null
            if (section.key.startsWith('active:') && section.sessions.length === 0) {
              return <Text style={styles.emptyRunning}>{strings.comfort.noRunning}</Text>
            }
            if (section.data.length === section.sessions.length) return null
            return <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${section.title} · ${strings.workspaces.showMoreSessions}`}
              accessibilityState={{ expanded: false }}
              onPress={() => setVisibleSessionCounts(current => ({ ...current, [section.key]: (current[section.key] ?? SESSION_PAGE_SIZE) + SESSION_PAGE_SIZE }))}
              style={({ pressed }) => [styles.showMoreSessions, pressed && styles.pressedRow]}
            >
              <Text style={styles.showMoreSessionsText}>{strings.workspaces.showMoreSessions}</Text>
              <ChevronDown size={16} color={colors.muted} />
            </Pressable>
          }}
          renderSectionHeader={({ section }) => <Pressable
            accessibilityRole="button"
            accessibilityLabel={section.expanded ? strings.workspaces.collapseWorkspace(section.title) : strings.workspaces.expandWorkspace(section.title)}
            accessibilityState={{ expanded: section.expanded }}
            onPress={() => toggleGroup(section.key, !section.expanded)}
            style={({ pressed }) => [styles.group, !section.expanded && styles.collapsedGroup, pressed && styles.pressedRow]}
          >
            <View style={styles.workspaceIcon}>
              {section.key.startsWith('active:')
                ? <Activity size={18} color={colors.muted} />
                : section.backend === 'codex'
                ? <Code2 size={18} color={colors.muted} />
                : section.backend !== 'harness'
                  ? <Sparkles size={18} color={colors.muted} />
                  : section.expanded ? <FolderOpen size={18} color={colors.muted} /> : <Folder size={18} color={colors.muted} />}
            </View>
            <View style={styles.copy}>
              <View style={styles.groupTitleRow}>
                <Text style={styles.groupTitle} numberOfLines={1}>{section.title}</Text>
                <Text style={styles.count}>{section.key.startsWith('workspace:') ? `${strings.workspaces[section.backend === 'harness' ? 'dsh' : section.backend]} · ` : ''}{section.sessions.length}</Text>
              </View>
            </View>
            {section.expanded ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />}
          </Pressable>}
          renderItem={({ item }) => {
            const active = item.sessionId === selected?.sessionId
            const status = browseStatus(item, lifecycles[item.sessionId])
            const running = status === 'running'
            const disabled = (busy !== undefined && !busy.startsWith('session:')) || !connected
            return <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              disabled={disabled}
              onPress={() => { if (active) onClose(); else void onSelect(item) }}
              style={({ pressed }) => [styles.row, active && styles.activeRow, pressed && styles.pressedRow]}
            >
              <View style={styles.sessionIcon}>
                {running
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <MessageSquare size={16} color={active ? colors.ink : colors.muted} />}
              </View>
              <View style={styles.copy}>
                <Text style={[styles.sessionTitle, active && styles.activeTitle]} numberOfLines={1}>{resolveSessionDisplayTitle(item) ?? strings.sessions.untitled}</Text>
              </View>
              {entries[browseKey(memoryScope, item.sessionId)]?.seenAt !== undefined && item.updatedAt > entries[browseKey(memoryScope, item.sessionId)]!.seenAt! && !active && <Text style={{color: colors.primary}}>{strings.comfort.new}</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel={entries[browseKey(memoryScope, item.sessionId)]?.starred ? strings.comfort.unstar : strings.comfort.starred}
                onPress={event => {event.stopPropagation(); updateBrowseEntry(memoryScope, item.sessionId, {starred: !entries[browseKey(memoryScope, item.sessionId)]?.starred})}}
                style={{padding: 10}}>
                <Star size={17} color={colors.muted} fill={entries[browseKey(memoryScope, item.sessionId)]?.starred ? colors.primary : 'transparent'} />
              </Pressable>
              {status === 'unknown' && <Text style={styles.count}>{strings.comfort.unknownStatus}</Text>}
              {running && <Text style={styles.runningStatus} numberOfLines={1}>{strings.status.running}</Text>}
              {busy === `session:${item.sessionId}`
                ? <ActivityIndicator size="small" color={colors.primary} />
                : active ? <Check size={16} color={colors.muted} /> : null}
            </Pressable>
          }}
        />
  </>
  if (inline) {
    return <View style={[styles.drawer, styles.inlineDrawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{pane}</View>
  }
  return <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={strings.common.close} onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.drawer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>{pane}</View>
    </View>
  </Modal>
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.scrim },
  drawer: { flex: 1, width: '88%', maxWidth: 420, backgroundColor: colors.surface },
  inlineDrawer: { width: '100%', maxWidth: '100%', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.separator },
  headerSpacer: { width: 40 },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  title: { ...type.heading, color: colors.ink, flex: 1, minWidth: 0, textAlign: 'center', paddingHorizontal: spacing.xs },
  tabs: { flexGrow: 0, maxHeight: 48 },
  tabContent: { paddingHorizontal: spacing.sm, gap: spacing.sm },
  tab: { minHeight: 44, minWidth: 92, padding: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  list: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
  loading: { paddingVertical: spacing.xl },
  group: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, minHeight: 48, marginTop: spacing.xs, borderRadius: radius.sm },
  collapsedGroup: { marginTop: 0 },
  workspaceIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  groupTitle: { ...type.smallStrong, color: colors.ink, flex: 1 },
  count: { ...type.caption, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, marginLeft: spacing.lg, minHeight: 48, borderRadius: radius.sm },
  showMoreSessions: { minHeight: 48, marginLeft: spacing.lg, paddingVertical: spacing.sm, paddingLeft: spacing.xs + 20 + spacing.xs, paddingRight: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderRadius: radius.sm },
  showMoreSessionsText: { ...type.small, color: colors.muted },
  sessionIcon: { width: 20, alignItems: 'center', justifyContent: 'center' },
  activeRow: { backgroundColor: colors.surfaceStrong },
  pressedRow: { backgroundColor: colors.surfaceStrong },
  copy: { flex: 1, minWidth: 0 },
  sessionTitle: { ...type.small, color: colors.ink },
  activeTitle: { fontWeight: '600' },
  runningStatus: { ...type.caption, color: colors.primary },
  emptyRunning: { ...type.caption, color: colors.muted, paddingVertical: spacing.sm, paddingLeft: spacing.lg + spacing.xs + 20 + spacing.xs, paddingRight: spacing.xs },
  error: { ...type.small, color: colors.danger, padding: spacing.sm },
})
