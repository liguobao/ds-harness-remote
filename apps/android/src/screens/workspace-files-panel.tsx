import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ChevronLeft, File, Folder, RefreshCw } from 'lucide-react-native'
import { requireSessionTools } from '../state/store'
import type { WorkspaceDirectory, WorkspaceText } from '../services/session-tools'
import { classifyWorkspaceFile, loadWorkspacePreview } from '../services/workspace-file-preview'
import { strings as t } from '../locales/i18n'
import { Button, IconButton, TopBar } from '../ui/components'
import { useTheme } from '../ui/theme-context'
import { spacing, type } from '../ui/theme'
import { sessionToolsError } from './session-tools-error'
import { PdfPreview } from './pdf-preview'

export function WorkspaceFilesPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { colors } = useTheme()
  const [path, setPath] = useState('')
  const [file, setFile] = useState<string>()
  const [offset, setOffset] = useState(1)
  const [listing, setListing] = useState<WorkspaceDirectory>()
  const [page, setPage] = useState<WorkspaceText>()
  const [binary, setBinary] = useState<Awaited<ReturnType<typeof loadWorkspacePreview>>>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
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
      const tools = requireSessionTools()
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

  const back = () => {
    if (file !== undefined) setFile(undefined)
    else if (path !== '') setPath(path.split('/').slice(0, -1).join('/'))
    else onClose()
  }
  return <View style={styles.container}>
    <TopBar
      title={t.tools.files}
      onBack={back}
      action={<IconButton label={t.tools.refresh} icon={RefreshCw} onPress={() => setRevision(v => v + 1)} disabled={loading} />}
    />
    <View style={styles.toolbar}>
      <Text style={[styles.path, { color: colors.ink }]} numberOfLines={2}>{file ?? (path || t.tools.root)}</Text>
    </View>
    {loading && <View style={styles.notice}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.muted }}>{kind === 'office' ? t.tools.officeLoading : t.tools.previewLoading}</Text></View>}
    {error && <View style={styles.notice}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text><Button label={t.tools.retry} onPress={() => setRevision(v => v + 1)} /></View>}
    {!loading && !error && kind === 'unsupported' && <Text style={[styles.notice, { color: colors.muted }]}>{t.tools.previewUnsupported}</Text>}
    {listing && <FlatList data={[...listing.entries].sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name))}
      keyExtractor={item => item.name} ListEmptyComponent={<Text style={[styles.notice, { color: colors.muted }]}>{t.tools.empty}</Text>}
      ListFooterComponent={listing.truncated ? <Text style={[styles.notice, { color: colors.muted }]}>{t.tools.truncated}</Text> : null}
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
  </View>
}
const styles = StyleSheet.create({
  container: { flex: 1 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.sm },
  path: { ...type.body, flex: 1 }, row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  notice: { padding: spacing.md, gap: spacing.md }, caption: { ...type.caption, paddingHorizontal: spacing.md },
  code: { fontFamily: 'monospace', fontSize: 14, lineHeight: 21, padding: spacing.md },
  image: { flex: 1, width: '100%', minHeight: 120 },
})
