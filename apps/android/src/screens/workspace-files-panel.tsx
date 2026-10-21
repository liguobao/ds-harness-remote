import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import { File as LocalFile, FileMode, Paths } from 'expo-file-system'
import { randomUUID } from 'expo-crypto'
import { ChevronLeft, File, Folder, RefreshCw } from 'lucide-react-native'
import { requireSessionTools } from '../state/store'
import type { WorkspaceDirectory, WorkspaceText } from '../services/session-tools'
import { classifyWorkspaceFile, loadWorkspaceDownload, loadWorkspacePreview, MAX_DOWNLOAD_BYTES, PREVIEW_CHUNK_BYTES } from '../services/workspace-file-preview'
import { strings as t } from '../locales/i18n'
import { BlurHeaderFrame, Button, IconButton, TopBar } from '../ui/components'
import { useTheme } from '../ui/theme-context'
import { spacing, type } from '../ui/theme'
import { sessionToolsError } from './session-tools-error'
import { PdfPreview } from './pdf-preview'

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
  const downloadController = useRef<AbortController | undefined>(undefined)
  useEffect(() => {
    setDownloading(false)
    return () => { downloadController.current?.abort(); downloadController.current = undefined }
  }, [sessionId, file])
  const download = async () => {
    if (file === undefined || tooLargeToSave || downloadController.current) return
    const controller = new AbortController()
    downloadController.current = controller
    setDownloading(true)
    let uri: string | undefined
    let temporary: LocalFile | undefined
    try {
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync()
      if (!permission.granted || controller.signal.aborted) return
      temporary = new LocalFile(Paths.cache, `workspace-download-${randomUUID()}`)
      temporary.create()
      const handle = temporary.open()
      try {
        await loadWorkspaceDownload(requireSessionTools(sessionId), sessionId, file, bytes => handle.writeBytes(bytes), controller.signal)
      } finally {
        handle.close()
      }
      if (controller.signal.aborted) return
      uri = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, file.split('/').pop() || 'download', 'application/octet-stream')
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
      if (!controller.signal.aborted) Alert.alert(t.tools.downloaded)
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
    action={<IconButton label={t.tools.refresh} icon={RefreshCw} onPress={() => setRevision(v => v + 1)} disabled={loading} />}
  />}>
    <View style={styles.toolbar}>
      <ScrollView style={styles.pathScroll} nestedScrollEnabled><Text selectable style={[styles.pathLabel, { color: colors.ink }]}>{file ?? (path || t.tools.root)}</Text></ScrollView>
    </View>
    {file !== undefined && <View style={styles.downloadRow}>
      {kind === 'unsupported' && <Text style={[styles.pathLabel, { color: colors.muted }]}>{t.tools.previewUnsupported}</Text>}
      <Button label={downloading ? t.tools.downloading : t.tools.download} variant="secondary" disabled={downloading || tooLargeToSave} onPress={() => void download()} />
      <Text style={[styles.downloadHint, { color: colors.muted }]}>{tooLargeToSave ? t.tools.downloadTooLarge : t.tools.downloadHint}</Text>
    </View>}
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
      <ScrollView ref={preview} style={styles.container}><ScrollView horizontal><Text selectable style={[styles.code, { color: colors.ink }]}>{page.text}</Text></ScrollView></ScrollView>
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
  downloadRow: { gap: spacing.sm, padding: spacing.md },
  downloadHint: { ...type.caption },
  listContent: { paddingBottom: spacing.lg },
  path: { ...type.body, flex: 1 }, row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  notice: { padding: spacing.md, gap: spacing.md }, caption: { ...type.caption, paddingHorizontal: spacing.md },
  code: { fontFamily: 'monospace', fontSize: 14, lineHeight: 21, padding: spacing.md },
  image: { flex: 1, width: '100%', minHeight: 120 },
})
