import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { pdfHtml } from '../generated/pdf-html'
import { MAX_PDF_PREVIEW_BYTES } from '../services/workspace-file-preview'
import { strings as t } from '../locales/i18n'
import { Button, IconButton } from '../ui/components'
import { useTheme } from '../ui/theme-context'
import { spacing, type } from '../ui/theme'

const SOURCE = { html: pdfHtml, baseUrl: 'about:blank' }
const MAX_BASE64_CHARS = Math.ceil(MAX_PDF_PREVIEW_BYTES / 3) * 4
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
/** One evaluateJavascript call must stay small; the page acknowledges every chunk before the next. */
const CHUNK_CHARS = 64 * 1024
const READY_TIMEOUT_MS = 30000
const CHUNK_TIMEOUT_MS = 8000
const RENDER_TIMEOUT_MS = 60000
const ZOOM_STEP = 0.25

interface RendererMessage {
  type?: string
  id?: string
  index?: number
  page?: number
  pages?: number
  canZoomIn?: boolean
  canZoomOut?: boolean
  code?: string
}

interface Transfer {
  id: string
  sent: number
  total: number
  timer?: ReturnType<typeof setTimeout>
}

export function PdfPreview({ data, label }: { data: string; label: string }) {
  const { colors } = useTheme()
  const web = useRef<WebView>(null)
  const transfer = useRef<Transfer | undefined>(undefined)
  const session = useRef<string | undefined>(undefined)
  /** A failure the user must see: late renderer messages may not clear it. */
  const terminal = useRef(false)
  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [zoomLimits, setZoomLimits] = useState({ canZoomIn: false, canZoomOut: false })
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()

  const send = (script: string) => web.current?.injectJavaScript(`${script};true;`)
  const clearTimer = (active: Transfer) => {
    if (active.timer === undefined) return
    clearTimeout(active.timer)
    active.timer = undefined
  }
  const stop = (message: string) => {
    const active = transfer.current
    if (active !== undefined) clearTimer(active)
    transfer.current = undefined
    terminal.current = true
    setBusy(false)
    setError(message)
  }
  const arm = (active: Transfer, timeout: number) => {
    clearTimer(active)
    active.timer = setTimeout(() => stop(t.tools.previewFailed), timeout)
  }
  const start = () => {
    setBusy(true)
    setError(undefined)
    if (data.length === 0 || data.length > MAX_BASE64_CHARS || !BASE64.test(data)) { stop(t.tools.previewFailed); return }
    const id = String(revision)
    const active: Transfer = { id, sent: 0, total: Math.ceil(data.length / CHUNK_CHARS) }
    transfer.current = active
    session.current = id
    arm(active, CHUNK_TIMEOUT_MS)
    send(`window.beginPdf(${JSON.stringify(id)})`)
  }

  useEffect(() => {
    if (ready) return
    const timer = setTimeout(() => stop(t.tools.previewFailed), READY_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [ready, revision])

  useEffect(() => () => {
    const active = transfer.current
    if (active !== undefined) clearTimer(active)
    transfer.current = undefined
  }, [])

  const onMessage = (event: WebViewMessageEvent) => {
    let message: RendererMessage
    try { message = JSON.parse(event.nativeEvent.data) as RendererMessage } catch { return }
    if (terminal.current || typeof message !== 'object' || message === null) return
    if (message.type === 'ready') {
      // A running transfer already owns the file, so a restarted page never starts a second load.
      if (terminal.current || transfer.current !== undefined) return
      setReady(true)
      start()
      return
    }
    const active = transfer.current
    if (message.id === undefined || message.id !== session.current) return
    if (message.type === 'ack') {
      if (active === undefined || message.index !== active.sent) return
      clearTimer(active)
      if (active.sent >= active.total) {
        arm(active, RENDER_TIMEOUT_MS)
        send(`window.finishPdf(${JSON.stringify(active.id)})`)
        return
      }
      const chunk = data.slice(active.sent * CHUNK_CHARS, (active.sent + 1) * CHUNK_CHARS)
      active.sent += 1
      arm(active, CHUNK_TIMEOUT_MS)
      send(`window.appendPdfChunk(${JSON.stringify(active.id)},${JSON.stringify(chunk)})`)
      return
    }
    if (message.type === 'loading') { setBusy(true); return }
    if (message.type === 'rendered') {
      if (active !== undefined) clearTimer(active)
      transfer.current = undefined
      if (typeof message.page === 'number' && message.page > 0) setPage(message.page)
      if (typeof message.pages === 'number' && message.pages > 0) setPages(message.pages)
      setZoomLimits({ canZoomIn: message.canZoomIn === true, canZoomOut: message.canZoomOut === true })
      setBusy(false)
      setError(undefined)
      return
    }
    if (message.type === 'error') {
      stop(message.code === 'password' ? t.tools.pdfPassword : t.tools.previewFailed)
    }
  }

  const retry = () => {
    const active = transfer.current
    if (active !== undefined) clearTimer(active)
    transfer.current = undefined
    session.current = undefined
    terminal.current = false
    setReady(false)
    setPages(0)
    setPage(1)
    setBusy(true)
    setError(undefined)
    setRevision(value => value + 1)
  }

  const controlsDisabled = busy || error !== undefined || pages === 0

  return <View style={styles.container}>
    <View style={[styles.controls, { borderBottomColor: colors.separator }]}>
      <View style={styles.pagination}>
        <IconButton large hitSlop={0} label={t.tools.previous} icon={ChevronLeft} disabled={controlsDisabled || page <= 1} onPress={() => send(`window.showPage(${page - 1})`)} />
        <Text accessibilityLabel={pages > 0 ? t.tools.pdfPage(page, pages) : undefined}
          numberOfLines={1} adjustsFontSizeToFit style={[styles.caption, { color: colors.ink }]}>
          {pages > 0 ? `${page} / ${pages}` : ''}
        </Text>
        <IconButton large hitSlop={0} label={t.tools.next} icon={ChevronRight} disabled={controlsDisabled || page >= pages} onPress={() => send(`window.showPage(${page + 1})`)} />
      </View>
      <View style={[styles.zoom, { borderStartColor: colors.separator }]}>
        <IconButton large hitSlop={0} label={t.tools.zoomOut} icon={ZoomOut} disabled={controlsDisabled || !zoomLimits.canZoomOut} onPress={() => send(`window.zoomPdf(${-ZOOM_STEP})`)} />
        <IconButton large hitSlop={0} label={t.tools.zoomIn} icon={ZoomIn} disabled={controlsDisabled || !zoomLimits.canZoomIn} onPress={() => send(`window.zoomPdf(${ZOOM_STEP})`)} />
      </View>
    </View>
    <View style={styles.stage}>
      <WebView accessibilityLabel={label} ref={web} key={revision} source={SOURCE} style={[styles.viewer, { backgroundColor: colors.background }]}
        originWhitelist={['*']} javaScriptEnabled incognito cacheEnabled={false} domStorageEnabled={false}
        thirdPartyCookiesEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" setSupportMultipleWindows
        allowsBackForwardNavigationGestures={false} onOpenWindow={() => undefined}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        onError={() => stop(t.tools.previewFailed)} onRenderProcessGone={() => stop(t.tools.previewFailed)} onContentProcessDidTerminate={() => stop(t.tools.previewFailed)}
        onMessage={onMessage} />
      {(busy || error !== undefined) && <View style={[styles.overlay, { backgroundColor: colors.background }]}>
        {busy && <>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted }}>{t.tools.pdfLoading}</Text>
        </>}
        {error !== undefined && <>
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>
          <Button label={t.tools.retry} variant="secondary" onPress={retry} />
        </>}
      </View>}
    </View>
  </View>
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  pagination: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  zoom: { flexDirection: 'row', borderStartWidth: StyleSheet.hairlineWidth, marginStart: spacing.sm, paddingStart: spacing.sm },
  caption: { ...type.small, minWidth: 0, flexShrink: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stage: { flex: 1 },
  viewer: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.md },
})
