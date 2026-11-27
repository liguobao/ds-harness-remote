import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File as LocalFile } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { File, Folder, RefreshCw, Upload } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings as t } from '../locales/i18n'
import type { WorkspaceDirectory } from '../services/session-tools'
import { requireConnectionRpc, requireSessionTools, useAppStore } from '../state/store'
import { Alert } from '../ui/alert'
import { BlurHeaderFrame, Button, IconButton, TopBar } from '../ui/components'
import { elevationStyle } from '../ui/platform-style'
import { radius, spacing, type } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import {
  formatUploadLimit,
  isDirectTransportMode,
  sanitizeUploadFileName,
  uploadStagedFilesToWorkspace,
  workspaceUploadMaxBytes,
  type StagedFile,
} from './chat-files'
import { sessionToolsError } from './session-tools-error'
import { WorkspaceFileViewer } from './workspace-file-viewer'

const NOTICE_DISMISS_MS = 2500

export function WorkspaceFilesPanel({
  sessionId,
  initialFile,
  initialPath = '',
  onClose,
  onRegisterBackHandler,
  headerAccessory,
}: {
  sessionId: string
  initialFile?: string
  initialPath?: string
  onClose: () => void
  onRegisterBackHandler?: (handler: (() => boolean) | undefined) => void
  headerAccessory?: ReactNode
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const [path, setPath] = useState(initialPath)
  const [file, setFile] = useState<string | undefined>(initialFile)
  const [enteredFromList, setEnteredFromList] = useState(false)
  const [viewerMenuOpen, setViewerMenuOpen] = useState(false)
  const [viewerRailOpen, setViewerRailOpen] = useState(false)
  const [listing, setListing] = useState<WorkspaceDirectory>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [uploading, setUploading] = useState(false)
  const uploadController = useRef<AbortController | undefined>(undefined)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const toast = (message: string) => {
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.SHORT)
      return
    }
    setNotice(message)
    if (noticeTimerRef.current !== undefined) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = undefined
      setNotice(undefined)
    }, NOTICE_DISMISS_MS)
  }

  useEffect(() => () => {
    if (noticeTimerRef.current !== undefined) {
      clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = undefined
    }
  }, [])

  useEffect(() => () => {
    uploadController.current?.abort()
    uploadController.current = undefined
  }, [sessionId])

  const upload = async () => {
    if (file !== undefined || path !== '' || uploading || uploadController.current) return
    const controller = new AbortController()
    uploadController.current = controller
    setUploading(true)
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      })
      if (controller.signal.aborted || picked.canceled || !picked.assets || picked.assets.length === 0) return
      const { mode: transportMode, memberRelayUpload } = useAppStore.getState().connection.stats
      const maxUploadBytes = workspaceUploadMaxBytes(transportMode, memberRelayUpload)
      const direct = isDirectTransportMode(transportMode)
      const files: StagedFile[] = []
      for (const asset of picked.assets) {
        const name = sanitizeUploadFileName(asset.name, asset.mimeType, asset.uri)
        let size = 0
        try {
          const statSize = new LocalFile(asset.uri).size
          if (typeof statSize === 'number' && Number.isFinite(statSize) && statSize > 0) size = statSize
        } catch {
          size = 0
        }
        if (size <= 0 && typeof asset.size === 'number' && Number.isFinite(asset.size) && asset.size > 0) {
          size = asset.size
        }
        if (size <= 0) {
          Alert.alert(t.tools.upload, t.chat.fileSizeUnavailable(name))
          continue
        }
        if (size > maxUploadBytes) {
          Alert.alert(t.tools.upload, t.chat.fileTooLargeForTransport(name, formatUploadLimit(maxUploadBytes), direct))
          continue
        }
        files.push({
          id: randomUUID(),
          name,
          size,
          ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
          uri: asset.uri,
        })
      }
      if (files.length === 0 || controller.signal.aborted) return
      const uploaded = await uploadStagedFilesToWorkspace(requireConnectionRpc(), sessionId, files, controller.signal)
      if (!controller.signal.aborted) {
        toast(t.tools.uploadedToWorkspace(uploaded.length))
        setRevision(v => v + 1)
      }
    } catch (e) {
      if (!controller.signal.aborted && (e as Error | undefined)?.name !== 'AbortError') {
        const code = (e as { code?: string })?.code
        const msg = code === 'FEATURE_NOT_SUPPORTED' || code === 'UPLOAD_WORKSPACE_UNAVAILABLE'
          ? t.chat.uploadUnavailable
          : sessionToolsError(e)
        Alert.alert(t.tools.upload, msg)
      }
    } finally {
      if (uploadController.current === controller) {
        uploadController.current = undefined
        setUploading(false)
      }
    }
  }

  useEffect(() => {
    if (file !== undefined) return
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    setListing(undefined)
    void requireSessionTools(sessionId)
      .listFiles(sessionId, path, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setListing(result)
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(sessionToolsError(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [sessionId, path, file, revision])

  useEffect(() => {
    setViewerMenuOpen(false)
    setViewerRailOpen(false)
  }, [file])

  useEffect(() => {
    if (onRegisterBackHandler === undefined) return
    onRegisterBackHandler(() => {
      if (file !== undefined) {
        if (viewerMenuOpen) {
          setViewerMenuOpen(false)
          return true
        }
        if (viewerRailOpen) {
          setViewerRailOpen(false)
          return true
        }
        if (enteredFromList) {
          setFile(undefined)
          return true
        }
        return false
      }
      if (path !== '') {
        setPath(path.split('/').slice(0, -1).join('/'))
        return true
      }
      return false
    })
    return () => onRegisterBackHandler(undefined)
  }, [enteredFromList, file, onRegisterBackHandler, path, viewerMenuOpen, viewerRailOpen])

  if (file !== undefined) {
    return (
      <WorkspaceFileViewer
        sessionId={sessionId}
        file={file}
        leadingMode={enteredFromList ? 'back' : 'close'}
        onLeadingPress={() => {
          if (enteredFromList) {
            setFile(undefined)
          } else {
            onClose()
          }
        }}
        onOpenDirectory={dir => {
          setFile(undefined)
          setPath(dir)
        }}
        menuOpen={viewerMenuOpen}
        onMenuOpenChange={setViewerMenuOpen}
        railOpen={viewerRailOpen}
        onRailOpenChange={setViewerRailOpen}
      />
    )
  }

  const back = () => {
    if (path !== '') setPath(path.split('/').slice(0, -1).join('/'))
    else onClose()
  }

  return (
    <BlurHeaderFrame
      inset
      header={
        <View>
          <TopBar
            title={t.tools.files}
            onBack={back}
            action={
              <>
                {path === '' && (
                  uploading
                    ? <ActivityIndicator accessibilityLabel={t.tools.uploading} color={colors.primary} />
                    : <IconButton label={t.tools.upload} icon={Upload} onPress={() => void upload()} disabled={loading} />
                )}
                <IconButton label={t.tools.refresh} icon={RefreshCw} onPress={() => setRevision(v => v + 1)} disabled={loading || uploading} />
              </>
            }
          />
          {headerAccessory}
        </View>
      }
    >
      <View style={styles.toolbar}>
        <ScrollView style={styles.pathScroll} nestedScrollEnabled>
          <Text selectable style={[styles.pathLabel, { color: colors.ink }]}>{path || t.tools.root}</Text>
        </ScrollView>
      </View>
      {loading && (
        <View style={styles.notice}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted }}>{t.tools.previewLoading}</Text>
        </View>
      )}
      {error && (
        <View style={styles.notice}>
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>
          <Button label={t.tools.retry} onPress={() => setRevision(v => v + 1)} />
        </View>
      )}
      {listing && (
        <FlatList
          data={[...listing.entries].sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))}
          keyExtractor={item => item.name}
          ListEmptyComponent={<Text style={[styles.notice, { color: colors.muted }]}>{t.tools.empty}</Text>}
          ListFooterComponent={listing.truncated ? <Text style={[styles.notice, { color: colors.muted }]}>{t.tools.truncated}</Text> : null}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              disabled={item.type === 'other'}
              style={[styles.row, { borderBottomColor: colors.separator }]}
              onPress={() => {
                const next = [listing.path, item.name].filter(Boolean).join('/')
                if (item.type === 'directory') {
                  setPath(next)
                } else {
                  setEnteredFromList(true)
                  setFile(next)
                }
              }}
            >
              {item.type === 'directory' ? <Folder color={colors.primary} size={22} /> : <File color={colors.muted} size={22} />}
              <Text style={[styles.path, { color: colors.ink }]}>{item.name}</Text>
            </Pressable>
          )}
        />
      )}
      {notice !== undefined && (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.toastPill,
            elevationStyle(colors, 2),
            { backgroundColor: colors.inverse, bottom: Math.max(spacing.lg, insets.bottom + spacing.sm) },
          ]}
        >
          <Text style={[styles.toastText, { color: colors.onInverse }]}>{notice}</Text>
        </View>
      )}
    </BlurHeaderFrame>
  )
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.sm },
  pathScroll: { flex: 1, maxHeight: 120 },
  pathLabel: { ...type.body },
  listContent: { paddingBottom: spacing.lg },
  path: { ...type.body, flex: 1 },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  notice: { padding: spacing.md, gap: spacing.md },
  toastPill: { position: 'absolute', alignSelf: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill },
  toastText: { ...type.small, fontWeight: '500' },
})
