import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Image, NativeModules, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { Alert } from '../ui/alert'
import * as FileSystem from 'expo-file-system/legacy'
import { File as LocalFile, FileMode, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { ChevronLeft, Download, File, Folder, RefreshCw, Upload } from 'lucide-react-native'
import { requireConnectionRpc, requireSessionTools, useAppStore } from '../state/store'
import {
  formatFileBytes,
  isDirectTransportMode,
  sanitizeUploadFileName,
  uploadStagedFilesToWorkspace,
  workspaceUploadMaxBytes,
  type StagedFile,
} from './chat-files'
import type { WorkspaceDirectory, WorkspaceText } from '../services/session-tools'
import { classifyWorkspaceFile, loadWorkspaceDownload, loadWorkspacePreview, MAX_DOWNLOAD_BYTES, PREVIEW_CHUNK_BYTES } from '../services/workspace-file-preview'
import { strings as t } from '../locales/i18n'
import { BlurHeaderFrame, Button, IconButton, TopBar } from '../ui/components'
import { useTheme } from '../ui/theme-context'
import { MarkdownLinkProvider, NativeMarkdown } from '../ui/markdown'
import { spacing, type } from '../ui/theme'
import { sessionToolsError } from './session-tools-error'
import { PdfPreview } from './pdf-preview'

const downloads = NativeModules.DshRemoteDownloads as {
  supported: boolean
  prepare(source: string, name: string): Promise<string>
  finish(uri: string, publish: boolean): Promise<void>
} | undefined

export function WorkspaceFilesPanel({ sessionId, initialFile, onClose }: { sessionId: string; initialFile?: string; onClose: () => void }) {
  const { colors } = useTheme()
  const [path, setPath] = useState('')
  const [file, setFile] = useState<string | undefined>(initialFile)
  const [offset, setOffset] = useState(1)
  const [listing, setListing] = useState<WorkspaceDirectory>()
  const [page, setPage] = useState<WorkspaceText>()
  const [binary, setBinary] = useState<Awaited<ReturnType<typeof loadWorkspacePreview>>>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [fileBytes, setFileBytes] = useState<number>()
  const tooLargeToSave = fileBytes !== undefined && fileBytes > MAX_DOWNLOAD_BYTES
  const [downloading, setDownloading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const downloadController = useRef<AbortController | undefined>(undefined)
  const uploadController = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    setDownloading(false)
    return () => { downloadController.current?.abort(); downloadController.current = undefined }
  }, [sessionId, file])
  useEffect(() => () => { uploadController.current?.abort(); uploadController.current = undefined }, [sessionId])
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
      const transportMode = useAppStore.getState().connection.stats.mode
      const maxUploadBytes = workspaceUploadMaxBytes(transportMode)
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
          Alert.alert(t.tools.upload, t.chat.fileTooLargeForTransport(name, formatFileBytes(maxUploadBytes), direct))
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
        ToastAndroid.show(t.tools.uploadedToWorkspace(uploaded.length), ToastAndroid.SHORT)
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
  const download = async () => {
    if (file === undefined || tooLargeToSave || downloadController.current) return
    const controller = new AbortController()
    downloadController.current = controller
    setDownloading(true)
    let uri: string | undefined
    let temporary: LocalFile | undefined
    try {
      const directory = downloads?.supported ? undefined : await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
      if (controller.signal.aborted || (directory !== undefined && !directory.granted)) return
      temporary = new LocalFile(Paths.cache, `workspace-download-${randomUUID()}`)
      temporary.create()
      const handle = temporary.open()
      try {
        await loadWorkspaceDownload(requireSessionTools(sessionId), sessionId, file, bytes => handle.writeBytes(bytes), controller.signal)
      } finally {
        handle.close()
      }
      if (controller.signal.aborted) return
      const name = file.split(/[\\/]/).pop() || 'download'
      if (downloads?.supported) {
        const pending = await downloads.prepare(temporary.uri, name)
        await downloads.finish(pending, !controller.signal.aborted)
        if (!controller.signal.aborted) ToastAndroid.show(t.tools.savedToDownloads, ToastAndroid.SHORT)
        return
      }
      if (directory === undefined || !directory.granted) return
      uri = await FileSystem.StorageAccessFramework.createFileAsync(directory.directoryUri, name, 'application/octet-stream')
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
            // Yield between bounded writes so navigation can cancel local saving too.
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
      if (!controller.signal.aborted) ToastAndroid.show(t.tools.downloaded, ToastAndroid.SHORT)
    } catch (e) {
      if (!controller.signal.aborted) Alert.alert(t.tools.download, typeof e === 'object' && e !== null && 'code' in e && e.code === 'workspace-preview/too-large' ? t.tools.downloadTooLarge : sessionToolsError(e))
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
  const preview = useRef<ScrollView>(null)
  const kind = file === undefined ? undefined : classifyWorkspaceFile(file)
  const markdown = file !== undefined && /\.(?:md|markdown|mdown)$/i.test(file)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    setPage(undefined)
    setBinary(undefined)
    setListing(undefined)
    const run = async () => {
      const tools = requireSessionTools(sessionId)
      if (file === undefined) {
        const result = await tools.listFiles(sessionId, path, controller.signal)
        if (!controller.signal.aborted) setListing(result)
      } else if (kind === 'text') {
        const result = await tools.readFile(sessionId, file, offset, controller.signal)
        if (!controller.signal.aborted) { setPage(result); preview.current?.scrollTo({ y: 0, animated: false }) }
      } else if (kind === 'image' || kind === 'pdf' || kind === 'office') {
        const result = await loadWorkspacePreview(tools, sessionId, file, kind, controller.signal)
        if (!controller.signal.aborted) setBinary(result)
      } else if (kind === 'unsupported') {
        // Linked paths can be folders; the stat endpoint does not report the
        // type, so an unclassifiable path falls back to a directory listing.
        const result = await tools.listFiles(sessionId, file, controller.signal)
        // listFiles only succeeds for a directory; reopen it as the listing path.
        if (!controller.signal.aborted && result !== undefined) { setPath(file.replace(/\/+$/u, '')); setFile(undefined) }
      }
    }
    void run().catch(e => { if (!controller.signal.aborted) setError(sessionToolsError(e)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [sessionId, path, file, kind, offset, revision])

  useEffect(() => {
    const controller = new AbortController()
    setFileBytes(undefined)
    if (file !== undefined) {
      void Promise.resolve().then(() => requireSessionTools(sessionId).statFile(sessionId, file, controller.signal))
        .then(stat => { if (!controller.signal.aborted) setFileBytes(stat.bytes) }).catch(() => {})
    }
    return () => controller.abort()
  }, [sessionId, file, revision])

  const back = () => {
    if (file !== undefined) setFile(undefined)
    else if (path !== '') setPath(path.split('/').slice(0, -1).join('/'))
    else onClose()
  }
  return <BlurHeaderFrame inset header={<TopBar
    title={t.tools.files}
    onBack={back}
    action={<>
      {file === undefined && path === '' && (uploading
        ? <ActivityIndicator accessibilityLabel={t.tools.uploading} color={colors.primary} />
        : <IconButton label={t.tools.upload} icon={Upload} onPress={() => void upload()} disabled={loading || downloading} />)}
      {file !== undefined && (downloading
        ? <ActivityIndicator accessibilityLabel={t.tools.downloading} color={colors.primary} />
        : <IconButton label={t.tools.download} icon={Download} onPress={() => void download()} disabled={tooLargeToSave} />)}
      <IconButton label={t.tools.refresh} icon={RefreshCw} onPress={() => setRevision(v => v + 1)} disabled={loading || downloading || uploading} />
    </>}
  />}>
    <View style={styles.toolbar}>
      <ScrollView style={styles.pathScroll} nestedScrollEnabled><Text selectable style={[styles.pathLabel, { color: colors.ink }]}>{file ?? (path || t.tools.root)}</Text></ScrollView>
    </View>
    {file !== undefined && kind === 'unsupported' && <Text style={[styles.caption, { color: colors.muted }]}>{t.tools.previewUnsupported}</Text>}
    {file !== undefined && tooLargeToSave && <Text style={[styles.caption, { color: colors.muted }]}>{t.tools.downloadTooLarge}</Text>}
    {loading && <View style={styles.notice}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted }}>{kind === 'office' ? t.tools.officeLoading : t.tools.previewLoading}</Text></View>}
    {error && <View style={styles.notice}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><Button label={t.tools.retry} onPress={() => setRevision(v => v + 1)} /></View>}
    {listing && <FlatList data={[...listing.entries].sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))}
      keyExtractor={item => item.name} ListEmptyComponent={<Text style={[styles.notice, { color: colors.muted }]}>{t.tools.empty}</Text>}
      ListFooterComponent={listing.truncated ? <Text style={[styles.notice, { color: colors.muted }]}>{t.tools.truncated}</Text> : null}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => <Pressable accessibilityRole="button" disabled={item.type === 'other'} style={[styles.row, { borderBottomColor: colors.separator }]} onPress={() => {
        const next = [listing.path, item.name].filter(Boolean).join('/')
        if (item.type === 'directory') setPath(next)
        else { setOffset(1); setFile(next) }
      }}>
        {item.type === 'directory' ? <Folder color={colors.primary} size={22} /> : <File color={colors.muted} size={22} />}
        <Text style={[styles.path, { color: colors.ink }]}>{item.name}</Text>
      </Pressable>} />}
    {page && <>
      <Text style={[styles.caption, { color: colors.muted }]}>{t.tools.readOnly} · {page.offset}–{page.offset + Math.max(0, page.lines - 1)}</Text>
      <ScrollView ref={preview} style={styles.container} contentContainerStyle={markdown ? styles.markdown : undefined}>
        {markdown
          ? <MarkdownLinkProvider><NativeMarkdown text={page.text} /></MarkdownLinkProvider>
          : <ScrollView horizontal><Text selectable style={[styles.code, { color: colors.ink }]}>{page.text}</Text></ScrollView>}
      </ScrollView>
      <View style={styles.toolbar}>
        <Button label={t.tools.previous} variant="secondary" disabled={loading || offset <= 1} onPress={() => setOffset(Math.max(1, offset - 200))} />
        <Button label={t.tools.next} variant="secondary" disabled={loading || page.eof || page.lines === 0} onPress={() => setOffset(page.offset + page.lines)} />
      </View>
    </>}
    {binary && !error && <>
      <Text style={[styles.caption, { color: colors.muted }]}>{t.tools.readOnly}</Text>
      {binary.missingFonts.length > 0 && <Text style={[styles.caption, { color: colors.muted }]}>{t.tools.missingFonts(binary.missingFonts.join(', '))}</Text>}
      {binary.mimeType === 'application/pdf'
        ? <PdfPreview key={`${file}:${revision}`} data={binary.data} label={file ?? t.tools.files} />
        : <Image accessibilityLabel={file} source={{ uri: `data:${binary.mimeType};base64,${binary.data}` }} style={styles.image} resizeMode="contain" onError={() => setError(t.tools.previewFailed)} />}
    </>}
  </BlurHeaderFrame>
}
const styles = StyleSheet.create({
  container: { flex: 1 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.sm },
  pathScroll: { flex: 1, maxHeight: 120 }, pathLabel: { ...type.body },
  listContent: { paddingBottom: spacing.lg },
  path: { ...type.body, flex: 1 }, row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  notice: { padding: spacing.md, gap: spacing.md }, caption: { ...type.caption, paddingHorizontal: spacing.md },
  markdown: { padding: spacing.md },
  code: { fontFamily: 'monospace', fontSize: 14, lineHeight: 21, padding: spacing.md },
  image: { flex: 1, width: '100%', minHeight: 120 },
})
