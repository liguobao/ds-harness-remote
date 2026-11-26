import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { pdfHtml } from '../generated/pdf-html'
import { strings as t } from '../locales/i18n'
import { MAX_PDF_PREVIEW_BYTES } from '../services/workspace-file-preview'
import { Button } from '../ui/components'
import { DuotoneIcons, MotionPressable } from '../ui/duotone-icons'
import { continuousRadius } from '../ui/platform-style'
import { floatingShadow, spacing, type } from '../ui/theme'
import { useTheme } from '../ui/theme-context'
import { isValidThumbnailDataUrl, PDF_THUMBNAIL_MAX_CACHE, ThumbnailLruCache } from './pdf-viewer-model'

const SOURCE = { html: pdfHtml, baseUrl: 'about:blank' }
const MAX_BASE64_CHARS = Math.ceil(MAX_PDF_PREVIEW_BYTES / 3) * 4
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
/** One evaluateJavascript call must stay small; the page acknowledges every chunk before the next. */
const CHUNK_CHARS = 64 * 1024
const READY_TIMEOUT_MS = 30000
const CHUNK_TIMEOUT_MS = 8000
const RENDER_TIMEOUT_MS = 60000

const RAIL_LEFT = 12
const RAIL_WIDTH = 92
const THUMB_ITEM_HEIGHT = 112
const THUMB_PREFETCH_MARGIN = 3

interface RendererMessage {
  type?: string
  id?: string
  index?: number
  page?: number
  pages?: number
  dataUrl?: string
  code?: string
}

interface Transfer {
  id: string
  sent: number
  total: number
  timer?: ReturnType<typeof setTimeout>
}

export function PdfPreview({
  data,
  label,
  topInset = 0,
  railOpen: controlledRailOpen,
  onRailOpenChange,
}: {
  data: string
  label: string
  topInset?: number
  railOpen?: boolean
  onRailOpenChange?: (open: boolean) => void
}) {
  const { colors, scheme } = useTheme()
  const insets = useSafeAreaInsets()
  const web = useRef<WebView>(null)
  const railList = useRef<FlatList<number>>(null)
  const transfer = useRef<Transfer | undefined>(undefined)
  const session = useRef<string | undefined>(undefined)
  const thumbLru = useRef(new ThumbnailLruCache(PDF_THUMBNAIL_MAX_CACHE))
  /** A failure the user must see: late renderer messages may not clear it. */
  const terminal = useRef(false)
  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string>()
  const [uncontrolledRailOpen, setUncontrolledRailOpen] = useState(false)
  const [thumbs, setThumbs] = useState<Record<number, string>>({})

  const railOpen = controlledRailOpen ?? uncontrolledRailOpen
  const setRailOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(railOpen) : next
    if (controlledRailOpen === undefined) {
      setUncontrolledRailOpen(resolved)
    }
    onRailOpenChange?.(resolved)
  }, [controlledRailOpen, onRailOpenChange, railOpen])

  const send = useCallback((script: string) => {
    web.current?.injectJavaScript(`${script};true;`)
  }, [])

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
    if (data.length === 0 || data.length > MAX_BASE64_CHARS || !BASE64.test(data)) {
      stop(t.tools.previewFailed)
      return
    }
    send(`window.setPdfTheme(${JSON.stringify(scheme)});window.setPdfTopPadding(${JSON.stringify(Math.max(12, Math.round(topInset + 10)))})`)
    const id = String(revision)
    const active: Transfer = { id, sent: 0, total: Math.ceil(data.length / CHUNK_CHARS) }
    transfer.current = active
    session.current = id
    arm(active, CHUNK_TIMEOUT_MS)
    send(`window.beginPdf(${JSON.stringify(id)})`)
  }

  useEffect(() => {
    if (!ready) return
    send(`window.setPdfTheme(${JSON.stringify(scheme)})`)
  }, [ready, scheme, send])

  useEffect(() => {
    if (!ready) return
    send(`window.setPdfTopPadding(${JSON.stringify(Math.max(12, Math.round(topInset + 10)))})`)
  }, [ready, send, topInset])

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

  const requestMissingThumbnails = useCallback((startPage: number, endPage: number) => {
    if (pages <= 0) return
    const from = Math.max(1, startPage)
    const to = Math.min(pages, endPage)
    const missing: number[] = []
    for (let p = from; p <= to; p += 1) {
      if (!thumbLru.current.has(p)) missing.push(p)
    }
    if (missing.length > 0) {
      send(`window.requestThumbnails(${JSON.stringify(missing)})`)
    }
  }, [pages, send])

  useEffect(() => {
    if (pages <= 0) return
    if (!railOpen) {
      if (ready) {
        send('window.clearThumbQueue && window.clearThumbQueue()')
      }
      return
    }
    requestMissingThumbnails(page - THUMB_PREFETCH_MARGIN, page + THUMB_PREFETCH_MARGIN + 3)
    const timer = setTimeout(() => {
      try {
        railList.current?.scrollToIndex({
          index: Math.max(0, Math.min(pages - 1, page - 1)),
          viewPosition: 0.4,
          animated: false,
        })
      } catch {
        // Ignore initial layout race before FlatList measures.
      }
    }, 16)
    return () => clearTimeout(timer)
  }, [railOpen, pages, ready])

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length === 0) return
    let minPage = Number.POSITIVE_INFINITY
    let maxPage = 0
    for (const token of viewableItems) {
      const p = typeof token.item === 'number' ? token.item : undefined
      if (p === undefined) continue
      if (p < minPage) minPage = p
      if (p > maxPage) maxPage = p
    }
    if (Number.isFinite(minPage) && maxPage > 0) {
      requestThumbsRef.current(minPage - THUMB_PREFETCH_MARGIN, maxPage + THUMB_PREFETCH_MARGIN)
    }
  })

  const requestThumbsRef = useRef(requestMissingThumbnails)
  requestThumbsRef.current = requestMissingThumbnails

  const onMessage = (event: WebViewMessageEvent) => {
    let message: RendererMessage
    try { message = JSON.parse(event.nativeEvent.data) as RendererMessage } catch { return }
    if (terminal.current || typeof message !== 'object' || message === null) return
    if (message.type === 'ready') {
      if (terminal.current || transfer.current !== undefined) return
      setReady(true)
      start()
      return
    }
    if (message.id === undefined || message.id !== session.current) return
    const active = transfer.current
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
    if (message.type === 'loaded') {
      if (typeof message.pages === 'number' && message.pages > 0) setPages(message.pages)
      if (typeof message.page === 'number' && message.page > 0) setPage(message.page)
      return
    }
    if (message.type === 'page') {
      if (typeof message.page === 'number' && message.page > 0) setPage(message.page)
      if (typeof message.pages === 'number' && message.pages > 0) setPages(message.pages)
      return
    }
    if (message.type === 'rendered') {
      if (active !== undefined) clearTimer(active)
      transfer.current = undefined
      if (typeof message.page === 'number' && message.page > 0) setPage(message.page)
      if (typeof message.pages === 'number' && message.pages > 0) setPages(message.pages)
      setBusy(false)
      setError(undefined)
      return
    }
    if (message.type === 'thumb') {
      if (typeof message.page === 'number' && isValidThumbnailDataUrl(message.dataUrl)) {
        const pageNum = message.page
        const dataUrl = message.dataUrl
        if (thumbLru.current.set(pageNum, dataUrl)) {
          setThumbs(prev => {
            const next: Record<number, string> = { ...prev, [pageNum]: dataUrl }
            for (const key of Object.keys(next)) {
              const num = Number(key)
              if (!thumbLru.current.has(num)) delete next[num]
            }
            return next
          })
        }
      }
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
    thumbLru.current.clear()
    setThumbs({})
    setRailOpen(false)
    setReady(false)
    setPages(0)
    setPage(1)
    setBusy(true)
    setError(undefined)
    setRevision(value => value + 1)
  }

  const pageNumbers = useMemo(
    () => (pages > 0 ? Array.from({ length: pages }, (_, i) => i + 1) : []),
    [pages],
  )

  const overlayTop = Math.max(10, topInset + 10)
  const showOverlays = pages > 0 && !busy && error === undefined

  return (
    <View style={styles.container}>
      <View style={styles.stage}>
        {error === undefined && (
          <WebView
            accessibilityLabel={label}
            ref={web}
            key={revision}
            source={SOURCE}
            style={[styles.viewer, { backgroundColor: colors.background }]}
            originWhitelist={['*']}
            javaScriptEnabled
            incognito
            cacheEnabled={false}
            domStorageEnabled={false}
            thirdPartyCookiesEnabled={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            javaScriptCanOpenWindowsAutomatically={false}
            mixedContentMode="never"
            setSupportMultipleWindows
            allowsBackForwardNavigationGestures={false}
            onOpenWindow={() => undefined}
            onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
            onError={() => stop(t.tools.previewFailed)}
            onRenderProcessGone={() => stop(t.tools.previewFailed)}
            onContentProcessDidTerminate={() => stop(t.tools.previewFailed)}
            onMessage={onMessage}
          />
        )}

        {showOverlays && railOpen && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.common.close}
            style={styles.railBackdrop}
            onPress={() => setRailOpen(false)}
          />
        )}

        {showOverlays && railOpen && (
          <View
            style={[
              styles.rail,
              floatingShadow(colors),
              {
                top: overlayTop,
                bottom: Math.max(16, insets.bottom + 16),
                backgroundColor: scheme === 'dark' ? 'rgba(22, 26, 33, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                borderColor: colors.border,
              },
            ]}
          >
            <FlatList
              ref={railList}
              data={pageNumbers}
              keyExtractor={item => String(item)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.railContent}
              getItemLayout={(_data, index) => ({
                length: THUMB_ITEM_HEIGHT,
                offset: THUMB_ITEM_HEIGHT * index + 8,
                index,
              })}
              onViewableItemsChanged={onViewableItemsChanged.current}
              viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
              renderItem={({ item: pageNum }) => {
                const selected = pageNum === page
                const thumbUri = thumbs[pageNum]
                return (
                  <MotionPressable
                    accessibilityRole="button"
                    accessibilityLabel={t.tools.pdfPageNumber(pageNum)}
                    accessibilityState={{ selected }}
                    scaleTo={0.96}
                    onPress={() => {
                      setPage(pageNum)
                      send(`window.scrollToPage(${pageNum})`)
                    }}
                    style={({ pressed }) => [
                      styles.thumbSlot,
                      pressed && { opacity: 0.78 },
                    ]}
                  >
                    <View
                      style={[
                        styles.thumbCard,
                        {
                          borderColor: selected ? colors.ink : colors.border,
                          borderWidth: selected ? 2 : 1,
                        },
                      ]}
                    >
                      {thumbUri !== undefined ? (
                        <Image source={{ uri: thumbUri }} style={styles.thumbImage} resizeMode="contain" />
                      ) : (
                        <View style={[styles.thumbPlaceholder, { backgroundColor: colors.surfaceStrong }]}>
                          <Text style={[styles.thumbPlaceholderText, { color: colors.muted }]}>{pageNum}</Text>
                        </View>
                      )}
                      {selected && (
                        <View style={styles.thumbSelectedScrim}>
                          <View style={[styles.thumbBadge, { backgroundColor: 'rgba(15, 15, 15, 0.62)' }]}>
                            <Text style={styles.thumbBadgeText}>{pageNum}</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  </MotionPressable>
                )
              }}
            />
          </View>
        )}

        {showOverlays && (
          <MotionPressable
            accessibilityRole="button"
            accessibilityLabel={`${t.tools.pdfThumbnails} · ${t.tools.pdfPage(page, pages)}`}
            accessibilityState={{ expanded: railOpen }}
            scaleTo={0.96}
            surfaceColor={colors.elevated}
            onPress={() => setRailOpen(value => !value)}
            style={({ pressed }) => [
              styles.pagePill,
              floatingShadow(colors),
              {
                top: overlayTop,
                left: railOpen ? RAIL_LEFT + RAIL_WIDTH + 10 : 14,
                backgroundColor: colors.elevated,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <DuotoneIcons.PanelLeft size={16} color={colors.ink} strokeWidth={1.9} />
            <Text style={[styles.pagePillText, { color: colors.ink }]}>
              {`${page}/${pages}`}
            </Text>
          </MotionPressable>
        )}

        {(busy || error !== undefined) && (
          <View style={[styles.overlay, { backgroundColor: colors.background }]}>
            {busy && (
              <>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.muted }}>{t.tools.pdfLoading}</Text>
              </>
            )}
            {error !== undefined && (
              <>
                <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>
                <Button label={t.tools.retry} variant="secondary" onPress={retry} />
              </>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stage: { flex: 1 },
  viewer: { flex: 1 },
  pagePill: {
    position: 'absolute',
    zIndex: 25,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pagePillText: {
    ...type.smallStrong,
    fontSize: 13,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  railBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    backgroundColor: 'transparent',
  },
  rail: {
    position: 'absolute',
    left: RAIL_LEFT,
    width: RAIL_WIDTH,
    zIndex: 24,
    borderWidth: StyleSheet.hairlineWidth,
    ...continuousRadius(20),
    overflow: 'hidden',
  },
  railContent: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  thumbSlot: {
    height: THUMB_ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbCard: {
    width: 66,
    height: 96,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbPlaceholderText: {
    ...type.caption,
    fontVariant: ['tabular-nums'],
  },
  thumbSelectedScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 15, 15, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  thumbBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
})
