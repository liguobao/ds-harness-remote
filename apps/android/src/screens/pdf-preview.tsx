import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { pdfHtml } from '../generated/pdf-html'
import { strings as t } from '../locales/i18n'
import { Button } from '../ui/components'
import { useTheme } from '../ui/theme-context'
import { spacing, type } from '../ui/theme'

const SOURCE = { html: pdfHtml, baseUrl: 'about:blank' }
const MAX_BASE64_CHARS = Math.ceil((8 * 1024 * 1024) / 3) * 4
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

  return <View style={styles.container}>
    <ScrollView horizontal keyboardShouldPersistTaps="always" style={styles.controls} contentContainerStyle={styles.row}>
      <Button label={t.tools.previous} variant="secondary" disabled={busy || error !== undefined || page <= 1} onPress={() => send(`window.showPage(${page - 1})`)} />
      <Text style={[styles.caption, { color: colors.muted }]}>{pages > 0 ? t.tools.pdfPage(page, pages) : ''}</Text>
      <Button label={t.tools.next} variant="secondary" disabled={busy || error !== undefined || page >= pages} onPress={() => send(`window.showPage(${page + 1})`)} />
      <Button label={t.tools.zoomOut} variant="secondary" disabled={busy || error !== undefined || pages === 0} onPress={() => send(`window.zoomPdf(${-ZOOM_STEP})`)} />
      <Button label={t.tools.zoomIn} variant="secondary" disabled={busy || error !== undefined || pages === 0} onPress={() => send(`window.zoomPdf(${ZOOM_STEP})`)} />
    </ScrollView>
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
  controls: { flexGrow: 0 },
  row: { gap: spacing.sm, padding: spacing.sm, alignItems: 'center' },
  caption: { ...type.caption },
  stage: { flex: 1 },
  viewer: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.md },
})
