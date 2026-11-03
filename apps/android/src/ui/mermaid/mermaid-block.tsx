import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Code, Maximize2, Shapes, X } from 'lucide-react-native'
import { SvgXml } from 'react-native-svg'
import { WebView } from 'react-native-webview'
import { SafeAreaView } from 'react-native-safe-area-context'
import { strings as t } from '../../locales/i18n'
import { CodeBlockView } from '../code-block'
import { IconCheckOutline, IconCopyOutline } from '../dsh-icons'
import { useTheme } from '../theme-context'
import { MAX_MERMAID_SOURCE_CHARS, mermaidThemeFor, useMermaidDiagram, type MermaidDiagram } from './mermaid-renderer'

/** Streaming replies grow a fence chunk by chunk; render only once the source stops changing. */
const SETTLE_MS = 700
const COPY_RESET_MS = 2000
const PLACEHOLDER_HEIGHT = 120
const BODY_PADDING = 10

function useSettled(value: string): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (value === settled) return
    const timer = setTimeout(() => setSettled(value), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [value, settled])
  return settled
}

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const { colors, scheme } = useTheme()
  const source = (code || '').replace(/\n+$/u, '')
  const settled = useSettled(source)
  const streaming = settled !== source
  const tooLarge = source.length > MAX_MERMAID_SOURCE_CHARS
  const theme = useMemo(() => mermaidThemeFor(colors, scheme === 'dark'), [colors, scheme])
  const requested = !streaming && !tooLarge && source.trim() !== ''
  const state = useMermaidDiagram(requested ? source : undefined, theme)
  const [showSource, setShowSource] = useState(false)
  const [viewer, setViewer] = useState(false)
  const [copied, setCopied] = useState(false)
  const [width, setWidth] = useState(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const copy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(source)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), COPY_RESET_MS)
    } catch {
      // Clipboard can be unavailable; the source stays selectable in source view.
    }
  }, [source])

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.max(0, event.nativeEvent.layout.width - BODY_PADDING * 2))
  }, [])

  // While streaming, while hidden behind the source toggle, and on failure the plain code block
  // is the content; a failure adds a one-line note above it.
  if (!requested || state?.status === 'error') {
    const note = tooLarge ? t.diagram.tooLarge : !streaming && state?.status === 'error' ? t.diagram.failed : undefined
    return <View>
      {note !== undefined && <Text style={[styles.note, { color: colors.muted }]}>{note}</Text>}
      <CodeBlockView code={code} language="mermaid" />
    </View>
  }
  if (showSource) {
    return <View>
      <CodeBlockView code={code} language="mermaid" />
      <Pressable accessibilityRole="button" onPress={() => setShowSource(false)} hitSlop={6} style={styles.backToDiagram}>
        <Shapes size={14} color={colors.primary} />
        <Text style={[styles.link, { color: colors.primary }]}>{t.diagram.showDiagram}</Text>
      </Pressable>
    </View>
  }

  const diagram = state?.status === 'ready' ? state.diagram : undefined
  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.surfaceStrong }]}>
        <Text numberOfLines={1} style={[styles.language, { color: colors.muted }]}>mermaid</Text>
        <View style={styles.actions}>
          <HeaderButton label={t.diagram.showSource} onPress={() => setShowSource(true)}>
            <Code size={14} color={colors.muted} />
          </HeaderButton>
          <HeaderButton label={copied ? t.diagram.copied : t.diagram.copySource} onPress={copy}>
            {copied ? <IconCheckOutline size={14} color="#10B981" /> : <IconCopyOutline size={14} color={colors.muted} />}
          </HeaderButton>
          {diagram !== undefined && <HeaderButton label={t.diagram.openFullScreen} onPress={() => setViewer(true)}>
            <Maximize2 size={14} color={colors.muted} />
          </HeaderButton>}
        </View>
      </View>
      <View onLayout={onLayout} style={styles.body}>
        {diagram === undefined
          ? <View style={styles.placeholder}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ color: colors.muted }}>{t.diagram.rendering}</Text>
          </View>
          : <Pressable accessibilityRole="imagebutton" accessibilityLabel={`${t.diagram.label}. ${t.diagram.openFullScreen}`}
            accessibilityHint={t.diagram.openFullScreen} onPress={() => setViewer(true)} onLongPress={copy} delayLongPress={400}>
            {diagram.inline !== undefined && width > 0
              ? <InlineDiagram diagram={diagram} xml={diagram.inline} width={width} />
              : diagram.inline !== undefined
                ? <View style={styles.placeholder} />
                : <View style={[styles.fullScreenCard, { backgroundColor: colors.primarySoft }]}>
                  <Maximize2 size={18} color={colors.primary} />
                  <Text style={[styles.cardTitle, { color: colors.ink }]}>{t.diagram.fullScreenOnly}</Text>
                  <Text style={{ color: colors.muted }}>{t.diagram.tapToOpen}</Text>
                </View>}
          </Pressable>}
      </View>
      {diagram !== undefined && viewer && <DiagramViewer diagram={diagram} onClose={() => setViewer(false)} onCopy={copy} copied={copied} />}
    </View>
  )
})

function HeaderButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
    style={({ pressed }) => [styles.actionButton, { opacity: pressed ? 0.6 : 1 }]}>
    {children}
  </Pressable>
}

function InlineDiagram({ diagram, xml, width }: { diagram: MermaidDiagram; xml: string; width: number }) {
  // Shrink wide diagrams to the bubble; never enlarge small ones past their natural size.
  const scale = Math.min(1, width / diagram.width)
  return <View style={styles.inline}>
    <SvgXml xml={xml} width={diagram.width * scale} height={diagram.height * scale} />
  </View>
}

/**
 * The untouched SVG is shown as an <img>, which never runs scripts, so the page needs no
 * JavaScript at all; the WebView's own pinch zoom handles scaling. Diagrams with HTML labels,
 * which react-native-svg cannot draw, are always shown here.
 */
function DiagramViewer({ diagram, onClose, onCopy, copied }: { diagram: MermaidDiagram; onClose: () => void; onCopy: () => void; copied: boolean }) {
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const html = useMemo(() => viewerHtml(diagram, colors.background, width), [diagram, colors.background, width])
  return <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <SafeAreaView style={[styles.viewer, { backgroundColor: colors.background }]}>
      <View style={[styles.viewerBar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t.diagram.close} hitSlop={8} style={styles.viewerButton}>
          <X size={22} color={colors.ink} />
        </Pressable>
        <Text style={[styles.viewerTitle, { color: colors.ink }]}>{t.diagram.label}</Text>
        <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={copied ? t.diagram.copied : t.diagram.copySource} hitSlop={8} style={styles.viewerButton}>
          {copied ? <IconCheckOutline size={20} color="#10B981" /> : <IconCopyOutline size={20} color={colors.ink} />}
        </Pressable>
      </View>
      <WebView source={{ html, baseUrl: 'about:blank' }} style={{ flex: 1, backgroundColor: colors.background }}
        accessibilityLabel={t.diagram.label}
        originWhitelist={['*']} javaScriptEnabled={false} incognito cacheEnabled={false} domStorageEnabled={false}
        thirdPartyCookiesEnabled={false} allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never" setSupportMultipleWindows
        setBuiltInZoomControls setDisplayZoomControls={false} onOpenWindow={() => undefined}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'} />
    </SafeAreaView>
  </Modal>
}

function viewerHtml(diagram: MermaidDiagram, background: string, screenWidth: number): string {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagram.svg)}`
  // Start fitted to the screen; pinch zoom goes up to eight times that.
  const fit = Math.min(1, (screenWidth - 24) / diagram.width)
  const widthPx = Math.max(1, Math.round(diagram.width * fit))
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=0.5,maximum-scale=8,user-scalable=yes">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>html,body{margin:0;background:${background}}body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}img{display:block;width:${widthPx}px;height:auto}</style>
</head><body><img alt="" src="${src}"></body></html>`
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginVertical: 6, alignSelf: 'stretch' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth },
  language: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionButton: { width: 26, height: 26, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  body: { padding: BODY_PADDING },
  placeholder: { minHeight: PLACEHOLDER_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 8 },
  inline: { alignItems: 'center' },
  fullScreenCard: { minHeight: PLACEHOLDER_HEIGHT, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 },
  cardTitle: { fontWeight: '600' },
  note: { fontSize: 12, marginTop: 6 },
  backToDiagram: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  link: { fontSize: 13, fontWeight: '600' },
  viewer: { flex: 1 },
  viewerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, height: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  viewerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  viewerTitle: { fontSize: 16, fontWeight: '600' },
})
