import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { randomUUID } from 'expo-crypto'
import { File as LocalFile, FileMode, Paths } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import { ChevronLeft, Copy, Download, ExternalLink, MoreHorizontal, RefreshCw, Share as ShareIcon, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { strings as t } from '../locales/i18n'
import { isMessageFilePath, formatSubmittedFileSize } from './chat/submitted-files'
import { sessionToolsError } from './session-tools-error'
import { PdfPreview } from './pdf-preview'
import type { WorkspaceText } from '../services/session-tools'
import {
  classifyWorkspaceFile,
  loadWorkspaceDownload,
  loadWorkspacePreview,
  MAX_DOWNLOAD_BYTES,
  PREVIEW_CHUNK_BYTES,
  safeOpenMimeType,
  sanitizeOpenFileName,
} from '../services/workspace-file-preview'

export { safeOpenMimeType, sanitizeOpenFileName }
import { requireSessionTools } from '../state/store'
import { Alert } from '../ui/alert'
import { BlurHeaderFrame, Button, IconButton, TopBar } from '../ui/components'
import { DshFileTypeIcon } from '../ui/dsh-icons'
import { MarkdownLinkProvider, NativeMarkdown } from '../ui/markdown'
import { continuousRadius, elevationStyle, monoFontFamily } from '../ui/platform-style'
import { floatingShadow, radius, spacing, type } from '../ui/theme'
import { useTheme } from '../ui/theme-context'

const downloads = NativeModules.DshRemoteDownloads as {
  supported: boolean
  prepare(source: string, name: string): Promise<string>
  finish(uri: string, publish: boolean): Promise<void>
} | undefined

const NOTICE_DISMISS_MS = 2500
const OPEN_CACHE_PREFIX = 'workspace-open-'
const STALE_OPEN_CACHE_MS = 10 * 60_000

function fileBasename(path: string): string {
  const clean = path.replace(/[\\/]+$/u, '')
  return clean.split(/[\\/]/u).pop() || clean || 'file'
}

async function sweepStaleOpenTempFiles(maxAgeMs = STALE_OPEN_CACHE_MS): Promise<void> {
  try {
    const cacheDirUri = Paths.cache.uri
    if (!cacheDirUri) return
    const entries = await FileSystem.readDirectoryAsync(cacheDirUri)
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.startsWith(OPEN_CACHE_PREFIX)) continue
      const targetUri = `${cacheDirUri.replace(/\/+$/u, '')}/${entry}`
      const info = await FileSystem.getInfoAsync(targetUri).catch(() => undefined)
      const modifiedMs = info && 'modificationTime' in info && typeof info.modificationTime === 'number'
        ? info.modificationTime * 1000
        : undefined
      if (maxAgeMs === 0 || modifiedMs === undefined || now - modifiedMs >= maxAgeMs) {
        await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {})
      }
    }
  } catch {
    // Best-effort cache cleanup only.
  }
}

export function WorkspaceFileViewer({
  sessionId,
  file,
  leadingMode,
  onLeadingPress,
  onOpenDirectory,
  menuOpen: controlledMenuOpen,
  onMenuOpenChange,
  railOpen: controlledRailOpen,
  onRailOpenChange,
}: {
  sessionId: string
  file: string
  leadingMode: 'close' | 'back'
  onLeadingPress: () => void
  onOpenDirectory?: (dirPath: string) => void
  menuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
  railOpen?: boolean
  onRailOpenChange?: (open: boolean) => void
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { width: windowWidth } = useWindowDimensions()
  const [offset, setOffset] = useState(1)
  const [page, setPage] = useState<WorkspaceText>()
  const [binary, setBinary] = useState<Awaited<ReturnType<typeof loadWorkspacePreview>>>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [fileBytes, setFileBytes] = useState<number>()
  const [downloading, setDownloading] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [uncontrolledMenuOpen, setUncontrolledMenuOpen] = useState(false)
  const [uncontrolledRailOpen, setUncontrolledRailOpen] = useState(false)
  const preview = useRef<ScrollView>(null)
  const downloadController = useRef<AbortController | undefined>(undefined)
  const shareController = useRef<AbortController | undefined>(undefined)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onOpenDirectoryRef = useRef(onOpenDirectory)
  onOpenDirectoryRef.current = onOpenDirectory
  const onMenuOpenChangeRef = useRef(onMenuOpenChange)
  onMenuOpenChangeRef.current = onMenuOpenChange
  const onRailOpenChangeRef = useRef(onRailOpenChange)
  onRailOpenChangeRef.current = onRailOpenChange

  const isControlledMenuOpen = controlledMenuOpen !== undefined
  const isControlledRailOpen = controlledRailOpen !== undefined

  const menuOpen = controlledMenuOpen ?? uncontrolledMenuOpen
  const setMenuOpen = useCallback((next: boolean) => {
    if (!isControlledMenuOpen) setUncontrolledMenuOpen(next)
    onMenuOpenChangeRef.current?.(next)
  }, [isControlledMenuOpen])

  const railOpen = controlledRailOpen ?? uncontrolledRailOpen
  const setRailOpen = useCallback((next: boolean) => {
    if (!isControlledRailOpen) setUncontrolledRailOpen(next)
    onRailOpenChangeRef.current?.(next)
  }, [isControlledRailOpen])

  const filename = fileBasename(file)
  const kind = classifyWorkspaceFile(file)
  const markdown = /\.(?:md|markdown|mdown)$/i.test(file)
  const tooLargeToSave = fileBytes !== undefined && fileBytes > MAX_DOWNLOAD_BYTES
  const messageAttachment = isMessageFilePath(file)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimerRef.current !== undefined) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = undefined
      setNotice(undefined)
    }, NOTICE_DISMISS_MS)
  }, [])

  useEffect(() => {
    void sweepStaleOpenTempFiles()
    return () => {
      if (noticeTimerRef.current !== undefined) {
        clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = undefined
      }
    }
  }, [])

  useEffect(() => {
    setOffset(1)
    setMenuOpen(false)
    setRailOpen(false)
    setDownloading(false)
    setSharing(false)
    return () => {
      downloadController.current?.abort()
      downloadController.current = undefined
      shareController.current?.abort()
      shareController.current = undefined
    }
  }, [sessionId, file, setMenuOpen, setRailOpen])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    setPage(undefined)
    setBinary(undefined)
    const run = async () => {
      const tools = requireSessionTools(sessionId)
      if (kind === 'text') {
        const result = await tools.readFile(sessionId, file, offset, controller.signal)
        if (!controller.signal.aborted) {
          setPage(result)
          preview.current?.scrollTo({ y: 0, animated: false })
        }
      } else if (kind === 'image' || kind === 'pdf' || kind === 'office') {
        const result = await loadWorkspacePreview(tools, sessionId, file, kind, controller.signal)
        if (!controller.signal.aborted) setBinary(result)
      } else if (kind === 'unsupported' && onOpenDirectoryRef.current !== undefined) {
        // Linked paths can be folders; the stat endpoint does not report the
        // type, so an unclassifiable path checks directory listing first.
        try {
          const result = await tools.listFiles(sessionId, file, controller.signal)
          if (!controller.signal.aborted && result !== undefined) {
            onOpenDirectoryRef.current?.(file.replace(/\/+$/u, ''))
          }
        } catch {
          // Non-directory unsupported files fall through to the unsupported view.
        }
      }
    }
    void run()
      .catch(e => {
        if (!controller.signal.aborted) setError(sessionToolsError(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [sessionId, file, kind, offset, revision])

  useEffect(() => {
    const controller = new AbortController()
    setFileBytes(undefined)
    void Promise.resolve()
      .then(() => requireSessionTools(sessionId).statFile(sessionId, file, controller.signal))
      .then(stat => {
        if (!controller.signal.aborted) setFileBytes(stat.bytes)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [sessionId, file, revision])

  const writeDownloadedTempFile = async (prefix: string, tempName: string, signal: AbortSignal): Promise<LocalFile> => {
    const temporary = new LocalFile(Paths.cache, `${prefix}${randomUUID()}-${tempName}`)
    temporary.create()
    const handle = temporary.open()
    try {
      await loadWorkspaceDownload(requireSessionTools(sessionId), sessionId, file, bytes => handle.writeBytes(bytes), signal)
      return temporary
    } catch (error) {
      try {
        if (temporary.exists) temporary.delete()
      } catch {}
      throw error
    } finally {
      handle.close()
    }
  }

  const download = async () => {
    if (tooLargeToSave || downloadController.current || sharing) return
    const controller = new AbortController()
    downloadController.current = controller
    setDownloading(true)
    let uri: string | undefined
    let temporary: LocalFile | undefined
    try {
      const directory = downloads?.supported || Platform.OS !== 'android'
        ? undefined
        : await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
      if (controller.signal.aborted || (directory !== undefined && !directory.granted)) return
      temporary = await writeDownloadedTempFile('workspace-download-', sanitizeOpenFileName(filename), controller.signal)
      if (controller.signal.aborted) return
      if (downloads?.supported) {
        const pending = await downloads.prepare(temporary.uri, filename)
        await downloads.finish(pending, !controller.signal.aborted)
        if (!controller.signal.aborted) showNotice(t.tools.savedToDownloads)
        return
      }
      const safeSaveName = sanitizeOpenFileName(filename)
      if (Platform.OS !== 'android') {
        const saved = new LocalFile(Paths.document, safeSaveName)
        await temporary.move(saved, { overwrite: true })
        temporary = undefined
        if (!controller.signal.aborted) showNotice(t.tools.downloaded)
        return
      }
      if (directory === undefined || !directory.granted) return
      uri = await FileSystem.StorageAccessFramework.createFileAsync(directory.directoryUri, safeSaveName, 'application/octet-stream')
      if (controller.signal.aborted) return
      const source = temporary.open(FileMode.ReadOnly)
      try {
        const destination = new LocalFile(uri).open(FileMode.Truncate)
        try {
          let remaining = source.size ?? temporary.size
          while (remaining > 0 && !controller.signal.aborted) {
            const bytes = source.readBytes(Math.min(PREVIEW_CHUNK_BYTES, remaining))
            if (bytes.byteLength === 0) throw new Error('Unexpected end of temporary download')
            destination.writeBytes(bytes)
            remaining -= bytes.byteLength
            await new Promise(resolve => setTimeout(resolve, 0))
          }
        } finally {
          destination.close()
        }
      } finally {
        source.close()
      }
      if (controller.signal.aborted) return
      uri = undefined
      if (!controller.signal.aborted) showNotice(t.tools.downloaded)
    } catch (e) {
      if (!controller.signal.aborted) {
        Alert.alert(
          t.tools.download,
          typeof e === 'object' && e !== null && 'code' in e && e.code === 'workspace-preview/too-large'
            ? t.tools.downloadTooLarge
            : sessionToolsError(e),
        )
      }
    } finally {
      try {
        if (temporary?.exists) temporary.delete()
      } catch (e) {
        if (!controller.signal.aborted) Alert.alert(t.tools.download, sessionToolsError(e))
      }
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
      if (downloadController.current === controller) {
        downloadController.current = undefined
        setDownloading(false)
      }
    }
  }

  const openExternalOrShare = async () => {
    if (tooLargeToSave || shareController.current || downloading) return
    setMenuOpen(false)
    const controller = new AbortController()
    shareController.current = controller
    setSharing(true)
    let temporary: LocalFile | undefined
    try {
      await sweepStaleOpenTempFiles()
      const safeName = sanitizeOpenFileName(filename)
      temporary = await writeDownloadedTempFile(OPEN_CACHE_PREFIX, safeName, controller.signal)
      if (controller.signal.aborted) return
      if (Platform.OS === 'android') {
        const IntentLauncher = await import('expo-intent-launcher')
        const contentUri = await FileSystem.getContentUriAsync(temporary.uri)
        if (controller.signal.aborted) return
        try {
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            // Read-only grant (`FLAG_GRANT_READ_URI_PERMISSION`); never pass write flags.
            flags: 1,
            type: safeOpenMimeType(safeName),
          })
          // External Android apps read `content://` asynchronously; leave cleanup to stale sweep.
          temporary = undefined
        } catch {
          Alert.alert(t.tools.openExternal, t.tools.openExternalUnavailable)
        }
        return
      }
      await Share.share({ url: temporary.uri, title: safeName })
    } catch (e) {
      if (!controller.signal.aborted) {
        Alert.alert(
          Platform.OS === 'ios' ? t.tools.shareFile : t.tools.openExternal,
          typeof e === 'object' && e !== null && 'code' in e && e.code === 'workspace-preview/too-large'
            ? t.tools.downloadTooLarge
            : sessionToolsError(e),
        )
      }
    } finally {
      try {
        if (temporary?.exists) temporary.delete()
      } catch {}
      if (shareController.current === controller) {
        shareController.current = undefined
        setSharing(false)
      }
    }
  }

  const copyPath = async () => {
    setMenuOpen(false)
    if (messageAttachment) return
    await Clipboard.setStringAsync(file)
    showNotice(t.tools.pathCopied)
  }

  const formattedSize = fileBytes !== undefined ? formatSubmittedFileSize(fileBytes) : undefined
  const headerBar = (
    <TopBar
      title={filename}
      centered
      titleAlign="center"
      onBack={onLeadingPress}
      backIcon={leadingMode === 'close' ? X : ChevronLeft}
      backLabel={leadingMode === 'close' ? t.common.close : t.common.back}
      action={
        <IconButton
          label={t.tools.moreFileActions}
          icon={MoreHorizontal}
          onPress={() => setMenuOpen(true)}
        />
      }
    />
  )

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <BlurHeaderFrame header={headerBar}>
        {headerHeight => (
          <View style={styles.body}>
            {loading && (
              <View style={[styles.centerState, { paddingTop: headerHeight }]}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.muted }}>
                  {kind === 'office' ? t.tools.officeLoading : t.tools.previewLoading}
                </Text>
              </View>
            )}

            {!loading && error !== undefined && (
              <View style={[styles.centerState, { paddingTop: headerHeight }]}>
                <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.danger }]}>
                  {error}
                </Text>
                <Button label={t.tools.retry} onPress={() => setRevision(v => v + 1)} />
              </View>
            )}

            {!loading && error === undefined && kind === 'unsupported' && (
              <View style={[styles.centerState, { paddingTop: headerHeight }]}>
                <DshFileTypeIcon path={file} size={42} />
                <Text style={[styles.unsupportedTitle, { color: colors.ink }]} numberOfLines={2}>
                  {filename}
                </Text>
                <Text style={[styles.unsupportedBody, { color: colors.muted }]}>
                  {tooLargeToSave ? t.tools.downloadTooLarge : t.tools.previewUnsupported}
                </Text>
                <Button
                  label={Platform.OS === 'ios' ? t.tools.shareFile : t.tools.openExternal}
                  variant="secondary"
                  disabled={tooLargeToSave || sharing || downloading}
                  loading={sharing}
                  onPress={() => void openExternalOrShare()}
                />
              </View>
            )}

            {!loading && error === undefined && page !== undefined && (
              <View style={[styles.textContainer, { paddingTop: headerHeight + spacing.xs }]}>
                <Text style={[styles.caption, { color: colors.muted }]}>
                  {t.tools.readOnly} · {page.offset}–{page.offset + Math.max(0, page.lines - 1)}
                </Text>
                <ScrollView
                  ref={preview}
                  style={styles.flex}
                  contentContainerStyle={[
                    markdown ? styles.markdown : undefined,
                    { paddingBottom: Math.max(spacing.md, insets.bottom) },
                  ]}
                >
                  {markdown ? (
                    <MarkdownLinkProvider>
                      <NativeMarkdown text={page.text} sourceFile={file} />
                    </MarkdownLinkProvider>
                  ) : (
                    <ScrollView horizontal>
                      <Text selectable style={[styles.code, { color: colors.ink }]}>{page.text}</Text>
                    </ScrollView>
                  )}
                </ScrollView>
                <View style={[styles.pagerBar, { borderTopColor: colors.separator, paddingBottom: Math.max(spacing.sm, insets.bottom) }]}>
                  <Button
                    label={t.tools.previous}
                    variant="secondary"
                    disabled={loading || offset <= 1}
                    onPress={() => setOffset(Math.max(1, offset - 200))}
                  />
                  <Button
                    label={t.tools.next}
                    variant="secondary"
                    disabled={loading || page.eof || page.lines === 0}
                    onPress={() => setOffset(page.offset + page.lines)}
                  />
                </View>
              </View>
            )}

            {!loading && error === undefined && binary !== undefined && (
              <View style={styles.flex}>
                {binary.missingFonts.length > 0 && (
                  <Text style={[styles.caption, { color: colors.muted, paddingTop: headerHeight + spacing.xs }]}>
                    {t.tools.missingFonts(binary.missingFonts.join(', '))}
                  </Text>
                )}
                {binary.mimeType === 'application/pdf' ? (
                  <PdfPreview
                    key={`${file}:${revision}`}
                    data={binary.data}
                    label={filename}
                    topInset={binary.missingFonts.length > 0 ? 12 : headerHeight}
                    railOpen={railOpen}
                    onRailOpenChange={setRailOpen}
                  />
                ) : (
                  <View style={[styles.imageStage, { paddingTop: headerHeight + spacing.sm, paddingBottom: Math.max(spacing.md, insets.bottom) }]}>
                    <Image
                      accessibilityLabel={filename}
                      source={{ uri: `data:${binary.mimeType};base64,${binary.data}` }}
                      style={styles.image}
                      resizeMode="contain"
                      onError={() => setError(t.tools.previewFailed)}
                    />
                  </View>
                )}
              </View>
            )}
          </View>
        )}
      </BlurHeaderFrame>

      {menuOpen && (
        <View style={styles.menuLayer} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            style={[styles.menuBackdrop, { backgroundColor: colors.menuDismiss }]}
            onPress={() => setMenuOpen(false)}
          />
          <View
            style={[
              styles.menuCard,
              floatingShadow(colors, 'high'),
              {
                top: insets.top + 58,
                right: spacing.md,
                width: Math.min(286, windowWidth - spacing.md * 2),
                backgroundColor: colors.elevated,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.menuFileHeader}>
              <View style={[styles.menuFileIconBox, { backgroundColor: colors.surfaceMuted ?? colors.surfaceStrong }]}>
                <DshFileTypeIcon path={file} size={24} />
              </View>
              <View style={styles.menuFileCopy}>
                <Text numberOfLines={2} style={[styles.menuFileName, { color: colors.ink }]}>
                  {filename}
                </Text>
                {(!messageAttachment && file !== filename) || formattedSize !== undefined ? (
                  <Text numberOfLines={2} style={[styles.menuFileSub, { color: colors.muted }]}>
                    {[!messageAttachment && file !== filename ? file : undefined, formattedSize]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={[styles.menuDivider, { backgroundColor: colors.separator }]} />

            <Pressable
              accessibilityRole="button"
              disabled={tooLargeToSave || downloading || sharing}
              onPress={() => {
                setMenuOpen(false)
                void download()
              }}
              style={({ pressed }) => [
                styles.menuRow,
                pressed && { backgroundColor: colors.surfaceStrong },
                (tooLargeToSave || downloading || sharing) && styles.menuRowDisabled,
              ]}
            >
              {downloading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Download size={18} color={colors.ink} strokeWidth={1.9} />
              )}
              <Text style={[styles.menuRowText, { color: colors.ink }]}>
                {downloading ? t.tools.downloading : t.tools.download}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={tooLargeToSave || sharing || downloading}
              onPress={() => void openExternalOrShare()}
              style={({ pressed }) => [
                styles.menuRow,
                pressed && { backgroundColor: colors.surfaceStrong },
                (tooLargeToSave || sharing || downloading) && styles.menuRowDisabled,
              ]}
            >
              {sharing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : Platform.OS === 'ios' ? (
                <ShareIcon size={18} color={colors.ink} strokeWidth={1.9} />
              ) : (
                <ExternalLink size={18} color={colors.ink} strokeWidth={1.9} />
              )}
              <Text style={[styles.menuRowText, { color: colors.ink }]}>
                {Platform.OS === 'ios' ? t.tools.shareFile : t.tools.openExternal}
              </Text>
            </Pressable>

            {!messageAttachment && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void copyPath()}
                style={({ pressed }) => [
                  styles.menuRow,
                  pressed && { backgroundColor: colors.surfaceStrong },
                ]}
              >
                <Copy size={18} color={colors.ink} strokeWidth={1.9} />
                <Text style={[styles.menuRowText, { color: colors.ink }]}>{t.tools.copyPath}</Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={loading || downloading || sharing}
              onPress={() => {
                setMenuOpen(false)
                setRevision(v => v + 1)
              }}
              style={({ pressed }) => [
                styles.menuRow,
                pressed && { backgroundColor: colors.surfaceStrong },
                (loading || downloading || sharing) && styles.menuRowDisabled,
              ]}
            >
              <RefreshCw size={18} color={colors.ink} strokeWidth={1.9} />
              <Text style={[styles.menuRowText, { color: colors.ink }]}>{t.tools.refresh}</Text>
            </Pressable>
          </View>
        </View>
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
    </View>
  )
}

export function FileViewerModal({
  visible,
  sessionId,
  file,
  onClose,
  onDismiss,
  onOpenDirectory,
}: {
  visible: boolean
  sessionId: string
  file: string
  onClose: () => void
  onDismiss?: () => void
  onOpenDirectory?: (dirPath: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(false)

  useEffect(() => {
    if (!visible) {
      setMenuOpen(false)
      setRailOpen(false)
    }
  }, [visible, file])

  const showing = visible && Boolean(file)
  const hadShownRef = useRef(false)
  if (showing) hadShownRef.current = true
  if (!showing && !hadShownRef.current) return null

  const handleRequestClose = () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    if (railOpen) {
      setRailOpen(false)
      return
    }
    onClose()
  }

  return (
    <Modal
      visible={showing}
      onRequestClose={handleRequestClose}
      onDismiss={onDismiss}
      animationType="slide"
      statusBarTranslucent
    >
      {showing ? (
        <WorkspaceFileViewer
          sessionId={sessionId}
          file={file}
          leadingMode="close"
          onLeadingPress={onClose}
          onOpenDirectory={onOpenDirectory}
          menuOpen={menuOpen}
          onMenuOpenChange={setMenuOpen}
          railOpen={railOpen}
          onRailOpenChange={setRailOpen}
        />
      ) : null}
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { flex: 1 },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  errorText: {
    ...type.body,
    textAlign: 'center',
  },
  unsupportedTitle: {
    ...type.bodyStrong,
    textAlign: 'center',
  },
  unsupportedBody: {
    ...type.small,
    textAlign: 'center',
  },
  textContainer: { flex: 1 },
  caption: {
    ...type.caption,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  markdown: { padding: spacing.md },
  code: { fontFamily: monoFontFamily, fontSize: 14, lineHeight: 21, padding: spacing.md },
  pagerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  imageStage: {
    flex: 1,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    flex: 1,
    width: '100%',
    minHeight: 120,
  },
  menuLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  menuCard: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    ...continuousRadius(18),
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  menuFileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuFileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuFileCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  menuFileName: {
    ...type.smallStrong,
  },
  menuFileSub: {
    ...type.caption,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xxs,
  },
  menuRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  menuRowDisabled: {
    opacity: 0.45,
  },
  menuRowText: {
    ...type.body,
    fontSize: 15,
    flex: 1,
  },
  toastPill: {
    position: 'absolute',
    zIndex: 60,
    alignSelf: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  toastText: {
    ...type.small,
    fontWeight: '500',
  },
})
