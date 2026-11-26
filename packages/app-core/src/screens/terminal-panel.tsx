import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { requireSessionTools } from '../state/store'
import { createNativeRpcId } from '../services/rpc-id'
import { TerminalAttachment } from '../services/terminal-attachment'
import type { TerminalInfo } from '../services/session-tools'
import { terminalHtml } from '../generated/terminal-html'
import { strings as t } from '../locales/i18n'
import { BlurHeaderFrame, IconButton, TopBar } from '../ui/components'
import { DuotoneIcons, MotionPressable } from '../ui/duotone-icons'
import { androidRipple, continuousRadius } from '../ui/platform-style'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { radius, spacing, type } from '../ui/theme'
import { useThemedStyles } from '../ui/use-themed-styles'
import { sessionToolsError } from './session-tools-error'

const SOURCE = { html: terminalHtml, baseUrl: 'about:blank' }

function TerminalChip({
  label,
  variant = 'key',
  disabled = false,
  selected = false,
  onPress,
}: {
  label: string
  variant?: 'primary' | 'quiet' | 'danger' | 'key'
  disabled?: boolean
  selected?: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <MotionPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      android_ripple={androidRipple(colors)}
      onPress={onPress}
      scaleTo={0.96}
      inverse={variant === 'primary'}
      surfaceColor={
        variant === 'primary'
          ? colors.inverse
          : variant === 'danger'
            ? colors.dangerSoft
            : colors.surfaceStrong
      }
      style={({ pressed }) => [
        styles.chip,
        variant === 'primary' && styles.chipPrimary,
        variant === 'quiet' && styles.chipQuiet,
        variant === 'danger' && styles.chipDanger,
        variant === 'key' && styles.chipKey,
        pressed && !disabled && styles.chipPressed,
        disabled && styles.chipDisabled,
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.chipText,
          variant === 'primary' && styles.chipTextPrimary,
          variant === 'danger' && styles.chipTextDanger,
        ]}
      >
        {label}
      </Text>
    </MotionPressable>
  )
}

export function TerminalPanel({ sessionId, onClose, headerAccessory }: { sessionId: string; onClose: () => void; headerAccessory?: ReactNode }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const web = useRef<WebView>(null)
  const attachment = useRef<TerminalAttachment | undefined>(undefined)
  const pendingAck = useRef<{ id: number; resolve: () => void; reject: () => void } | undefined>(undefined)
  const ackId = useRef(0)
  const creating = useRef(false)
  const dimensions = useRef({ cols: 80, rows: 24 })
  const limits = useRef({ maxCols: 240, maxRows: 100 })
  const [ready, setReady] = useState(false)
  const [items, setItems] = useState<TerminalInfo[]>([])
  const [active, setActive] = useState<string>()
  const [info, setInfo] = useState<TerminalInfo>()
  const [writable, setWritable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; attachment.current?.dispose(); pendingAck.current?.reject() } }, [])
  const send = (value: unknown) => web.current?.injectJavaScript(`window.receive(${JSON.stringify(value)});true;`)

  const render = (data: string, reset: boolean) => new Promise<void>((resolve, reject) => {
    const id = ++ackId.current
    const timer = setTimeout(() => { if (pendingAck.current?.id === id) pendingAck.current = undefined; reject(new Error('Terminal render timeout')) }, 10000)
    pendingAck.current = { id, resolve: () => { clearTimeout(timer); resolve() }, reject: () => { clearTimeout(timer); reject(new Error('Terminal detached')) } }
    send({ type: 'write', data, reset, id })
  })

  useEffect(() => {
    let cancelled = false
    setBusy(true); setError(undefined)
    void Promise.resolve().then(() => requireSessionTools(sessionId).listTerminals(sessionId))
      .then(async result => {
        if (cancelled) return
        setItems(result)
        setActive(value => result.some(item => item.id === value) ? value : result[0]?.id)
        // Opening the panel on a Session without terminals starts one, the way a
        // terminal tab behaves. Closing the last terminal is left alone.
        if (result.length === 0) await create()
      })
      .catch(e => { if (!cancelled) setError(sessionToolsError(e)) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [sessionId, revision])

  useEffect(() => {
    if (!ready || active === undefined) return
    let cancelled = false
    setError(undefined)
    const run = async () => {
      const tools = requireSessionTools(sessionId)
      const environment = await tools.terminalEnvironment(sessionId)
      if (cancelled) return
      limits.current = environment
      let applied = false
      // Switching terminals deliberately keeps the previous `info`/`writable`
      // until the new attachment reports, so the tab strip and the key row do
      // not flash back through their disabled state.
      const current = new TerminalAttachment(tools, sessionId, active, environment.maxInputBytes, render, (next, canWrite) => {
        if (cancelled) return
        setInfo(next); setWritable(canWrite); send({ type: 'enabled', value: canWrite })
        // The renderer size must follow the attachment, not a writability flip.
        if (canWrite && !applied) {
          applied = true
          void current.resize(Math.min(dimensions.current.cols, environment.maxCols), Math.min(dimensions.current.rows, environment.maxRows))
            .catch(e => { if (!cancelled) setError(sessionToolsError(e)) })
        }
        if (!canWrite) applied = false
      })
      attachment.current = current
      await current.follow()
    }
    void run().catch(e => { if (!cancelled) { setError(sessionToolsError(e)); setWritable(false); send({ type: 'enabled', value: false }) } })
    return () => {
      cancelled = true
      attachment.current?.dispose(); attachment.current = undefined
      pendingAck.current?.reject(); pendingAck.current = undefined
      send({ type: 'enabled', value: false })
    }
  }, [active, ready, sessionId, revision])

  const input = (data: string) => {
    const current = attachment.current
    // A switch leaves the local writability untouched until the new attachment
    // reports; input still requires a live attachment.
    if (!writable || current === undefined) return
    void current.write(data).catch(() => {
      if (!mounted.current || attachment.current !== current) return
      setWritable(false); setError(t.tools.disconnected); send({ type: 'enabled', value: false })
    })
  }
  const create = async () => {
    if (creating.current) return
    creating.current = true
    setBusy(true); setPending(true); setError(undefined)
    try {
      const tools = requireSessionTools(sessionId)
      const env = await tools.terminalEnvironment(sessionId)
      const result = await tools.createTerminal(sessionId, createNativeRpcId(), Math.min(dimensions.current.cols, env.maxCols), Math.min(dimensions.current.rows, env.maxRows))
      // Drop the previous terminal's state so the overlay reports the new
      // attachment instead of showing a stale writable terminal.
      if (mounted.current) { setItems(old => [...old, result]); setInfo(undefined); setActive(result.id) }
    } catch (e) { if (mounted.current) setError(sessionToolsError(e)) }
    finally { creating.current = false; if (mounted.current) { setPending(false); setBusy(false) } }
  }
  const close = () => {
    const id = active
    if (!id) return
    // Ending a terminal is immediate: drop it locally and let the Host kill the
    // process in the background instead of blocking the panel on that round trip.
    attachment.current?.dispose(); attachment.current = undefined
    pendingAck.current?.reject(); pendingAck.current = undefined
    send({ type: 'enabled', value: false })
    const remaining = items.filter(item => item.id !== id)
    setItems(remaining)
    setActive(remaining[0]?.id)
    setInfo(undefined)
    void requireSessionTools(sessionId).closeTerminal(sessionId, id).catch(e => { if (mounted.current) setError(sessionToolsError(e)) })
    // Nothing left to attach to, so leave the panel instead of showing a dead one.
    if (remaining.length === 0) { setWritable(false); onClose(); return }
    // Another terminal takes over with the previous writability on purpose: its
    // own attachment reports the state, so the key row does not dim on the way.
  }
  // Rendered as an overlay over the terminal, so progress and settlement never
  // resize the renderer or move the key row.
  let status = ''
  if (error === undefined) {
    if (pending) status = t.tools.creating
    else if (active === undefined) status = ''
    else if (info === undefined) status = t.tools.connecting
    else if (!writable) status = info.state === 'running' ? t.tools.controlDenied : t.tools.exited
  }
  const statusBusy = pending || (error === undefined && active !== undefined && info === undefined)
  return <BlurHeaderFrame inset header={<View><TopBar
    title={t.tools.terminal}
    onBack={onClose}
    action={<IconButton label={t.tools.newTerminal} icon={DuotoneIcons.CirclePlus} onPress={() => void create()} disabled={busy || !ready} />}
  />{headerAccessory}</View>}>
    {(items.length > 0 || active !== undefined) && (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={[styles.controls, styles.controlsTop]}
        contentContainerStyle={styles.row}
      >
        {items.map(item => (
          <TerminalChip
            key={item.id}
            label={terminalLabel(item)}
            variant={active === item.id ? 'primary' : 'quiet'}
            selected={active === item.id}
            onPress={() => setActive(item.id)}
            disabled={busy}
          />
        ))}
        {active && <TerminalChip label={t.tools.closeTerminal} variant="danger" disabled={busy} onPress={close} />}
      </ScrollView>
    )}
    {error && (
      <View style={styles.notice}>
        <Text accessibilityRole="alert" style={styles.noticeText}>{error}</Text>
        <TerminalChip label={t.tools.retry} variant="key" disabled={busy} onPress={() => setRevision(v => v + 1)} />
      </View>
    )}
    <View style={styles.terminal}>
      <WebView accessibilityLabel={t.tools.terminal} ref={web} source={SOURCE} style={styles.container} originWhitelist={['*']} javaScriptEnabled
        allowFileAccess={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never" setSupportMultipleWindows
        onOpenWindow={() => undefined} onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        onError={() => { attachment.current?.dispose(); setWritable(false); setReady(false); setError(t.tools.failed) }}
        onMessage={event => {
          try {
            const value = JSON.parse(event.nativeEvent.data)
            if (value.type === 'ready') setReady(true)
            if ((value.type === 'ready' || value.type === 'resize') && Number.isInteger(value.cols) && value.cols > 0 && Number.isInteger(value.rows) && value.rows > 0) {
              dimensions.current = { cols: value.cols, rows: value.rows }
              void attachment.current?.resize(Math.min(value.cols, limits.current.maxCols), Math.min(value.rows, limits.current.maxRows)).catch(e => { if (mounted.current) setError(sessionToolsError(e)) })
            }
            if (value.type === 'ack') {
              const ack = pendingAck.current
              if (ack !== undefined && ack.id === value.id) { ack.resolve(); pendingAck.current = undefined }
            }
            if (value.type === 'data' && typeof value.data === 'string') input(value.data)
          } catch { /* Ignore malformed renderer messages. */ }
        }} />
      {status.length > 0 && <View pointerEvents="none" style={styles.status}>
        {statusBusy && <ActivityIndicator size="small" color="#F2F4F7" />}
        <Text numberOfLines={1} style={styles.statusText}>{status}</Text>
      </View>}
    </View>
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      style={[styles.controls, styles.controlsBottom]}
      contentContainerStyle={styles.row}
    >
      <TerminalChip label={t.tools.keyboard} variant="key" disabled={!writable} onPress={() => send({ type: 'focus' })} />
      {([[t.tools.interrupt, '\x03'], [t.tools.tab, '\t'], [t.tools.escape, '\x1b'], [t.tools.up, '\x1b[A'], [t.tools.down, '\x1b[B'], [t.tools.left, '\x1b[D'], [t.tools.right, '\x1b[C'], [t.tools.backspace, '\x7f'], [t.tools.enter, '\r']] as const).map(([label, data]) => (
        <TerminalChip key={label} label={label} variant="key" disabled={!writable} onPress={() => input(data)} />
      ))}
    </ScrollView>
  </BlurHeaderFrame>
}
/** A tab labelled with its working directory says nothing on a phone-width strip; the shell name does. */
function terminalLabel(item: TerminalInfo): string {
  const shell = item.shell?.name
  const folder = folderName(item.cwd)
  if (typeof shell === 'string' && shell.length > 0 && folder.length > 0 && item.title.includes(folder)) return shell
  return item.title
}
function folderName(cwd: unknown): string {
  if (typeof cwd !== 'string') return ''
  const trimmed = cwd.replace(/[\\/]+$/u, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
}
function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1 },
    terminal: { flex: 1 },
    // Overlaid on the terminal background, so a status never adds layout height.
    status: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      backgroundColor: 'rgba(16, 20, 24, 0.92)',
    },
    statusText: { ...type.caption, color: 'rgba(242, 244, 247, 0.82)', flexShrink: 1 },
    controls: { flexGrow: 0, backgroundColor: colors.background },
    controlsTop: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    controlsBottom: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    row: { gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, alignItems: 'center' },
    chip: {
      height: 34,
      minWidth: 40,
      paddingHorizontal: 12,
      ...continuousRadius(radius.sm),
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipPrimary: { backgroundColor: colors.inverse },
    chipQuiet: { backgroundColor: colors.surfaceStrong },
    chipDanger: { backgroundColor: colors.dangerSoft },
    chipKey: {
      backgroundColor: colors.surfaceStrong,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    chipPressed: { opacity: 0.72 },
    chipDisabled: { opacity: 0.45 },
    chipText: { ...type.small, fontSize: 13, fontWeight: '500', color: colors.ink },
    chipTextPrimary: { color: colors.onInverse, fontWeight: '600' },
    chipTextDanger: { color: colors.danger, fontWeight: '600' },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      gap: spacing.sm,
      backgroundColor: colors.dangerSoft,
    },
    noticeText: { ...type.small, color: colors.danger, flex: 1 },
  })
}
