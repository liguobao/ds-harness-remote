import { strings } from '../locales/i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import WebView from 'react-native-webview'
import { dshWebGrantSchema, type DshWebGrant } from '@dsh-remote/protocol'
import { useAppStore } from '../state/store'
import { ErrorBanner, TopBar } from '../ui/components'
import { useTheme } from '../ui/theme-context'

type LanWebSession = DshWebGrant & { close(): Promise<void> }

type Rpc = ((method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>) & {
  openLanWeb?: (onFailure: () => void) => Promise<LanWebSession> | undefined
  supportsDshWebTunnel?: boolean
}

const FATAL_SAME_ORIGIN_HTTP_STATUSES = new Set([401, 502, 503, 504])
export const DSH_WEB_GRANT_CLOCK_SKEW_MS = 60_000

export function isDshWebGrantUsable(grant: DshWebGrant, now = Date.now()): boolean {
  return grant.expiresAt + DSH_WEB_GRANT_CLOCK_SKEW_MS > now
}

export function isFatalDshWebHttpError(
  event: { url?: string; statusCode?: number },
  grantUrl: string,
  sessionUri: string,
): boolean {
  const url = event.url
  if (!url) return false
  if (url === sessionUri || url === grantUrl) return true
  if (event.statusCode === undefined || !FATAL_SAME_ORIGIN_HTTP_STATUSES.has(event.statusCode)) return false
  try {
    return new URL(url).origin === new URL(grantUrl).origin
  } catch {
    return false
  }
}

export function DshWebScreen({ rpc, hostName, onClose }: {
  rpc: Rpc
  hostName: string
  onClose: () => void
}) {
  const chinese = useAppStore(state => state.language)?.startsWith('zh')
  const { colors } = useTheme()
  const [grant, setGrant] = useState<DshWebGrant>()
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const pendingCloseRef = useRef<Promise<unknown> | undefined>(undefined)

  useEffect(() => {
    const abort = new AbortController()
    let local: Promise<LanWebSession> | undefined
    let shouldClose = false
    setFailed(false)
    setLoaded(false)
    setGrant(undefined)

    const openTunnel = () => {
      if (abort.signal.aborted) return
      shouldClose = true
      void rpc('dsh.web.open', {}, abort.signal).then(
        result => {
          if (abort.signal.aborted) return
          try {
            const parsed = dshWebGrantSchema.parse(result)
            if (!isDshWebGrantUsable(parsed)) {
              setFailed(true)
              return
            }
            setGrant(parsed)
          } catch {
            setFailed(true)
          }
        },
        () => {
          if (abort.signal.aborted) return
          shouldClose = false
          setFailed(true)
        },
      )
    }

    const startOpen = () => {
      if (abort.signal.aborted) return
      try {
        local = rpc.openLanWeb?.(() => { if (!abort.signal.aborted) setFailed(true) })
      } catch { setFailed(true); return }
      if (!local) {
        if (rpc.supportsDshWebTunnel === false) setFailed(true)
        else openTunnel()
        return
      }
      void local.then(session => {
        if (!abort.signal.aborted) setGrant(session)
      }, (error: unknown) => {
        if (abort.signal.aborted) return
        if (rpc.supportsDshWebTunnel && error instanceof Error &&
            'code' in error && error.code === 'FEATURE_NOT_SUPPORTED') {
          local = undefined
          openTunnel()
        } else {
          setFailed(true)
        }
      })
    }

    const pendingClose = pendingCloseRef.current
    if (pendingClose) {
      void pendingClose.finally(startOpen)
    } else {
      startOpen()
    }

    return () => {
      abort.abort()
      if (local) pendingCloseRef.current = local.then(session => session.close()).catch(() => undefined)
      if (shouldClose) {
        const previous = pendingCloseRef.current
        const closeCall = () => {
          const close = new AbortController()
          const deadline = setTimeout(() => close.abort(), 4_000)
          return rpc('dsh.web.close', {}, close.signal)
            .catch(() => undefined)
            .finally(() => clearTimeout(deadline))
        }
        const closePromise = previous ? previous.then(closeCall, closeCall) : closeCall()
        const tracked = closePromise.finally(() => {
          if (pendingCloseRef.current === tracked) {
            pendingCloseRef.current = undefined
          }
        })
        pendingCloseRef.current = tracked
      }
    }
  }, [rpc, attempt])

  const retry = () => {
    setFailed(false)
    setLoaded(false)
    setGrant(undefined)
    setAttempt(current => current + 1)
  }

  const grantUrl = grant && new URL(grant.url).href
  const sessionUri = grantUrl && new URL('/__remote/session', grantUrl).href
  const source = useMemo(() => {
    if (!grant || !grantUrl) return undefined
    if ('close' in grant) return {
      uri: new URL('/__remote/session-bootstrap', grantUrl).href,
      headers: { 'X-DSH-Web-Grant': grant.browserGrant },
    }
    // Native POST can send an opaque Origin. Submit from the tunnel origin.
    return {
      baseUrl: new URL('/__remote/session-bootstrap', grantUrl).href,
      html: `<!doctype html><meta name="referrer" content="same-origin">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; form-action 'self'">
        <form method="post" action="/__remote/session">
          <input type="hidden" name="browserGrant" value="${encodeURIComponent(grant.browserGrant)}">
        </form><script>document.forms[0].submit()</script>`,
    }
  }, [grant, grantUrl])
  const openTitle = strings.dshWeb.open
  const title = loaded && !failed && grant
    ? `${hostName} · ${'close' in grant ? 'LAN' : 'CF Worker'}`
    : openTitle
  const loadingMessage = grant
    ? strings.dshWeb.verifying
    : strings.dshWeb.connecting
  return (
    <Modal visible onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <TopBar title={title} onBack={onClose} />
        {failed ? <ErrorBanner
          message={chinese ? '无法打开 DSH Web，请重试。' : 'Could not open DSH Web. Please try again.'}
          onRetry={retry}
        />
          : <View style={styles.fill}>
              {source && grantUrl && sessionUri && <WebView
                source={source}
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={({ url }) => {
                  try { return new URL(url).origin === new URL(grantUrl).origin } catch { return false }
                }}
                onLoad={({ nativeEvent }) => {
                  if (nativeEvent.url === grantUrl) setLoaded(true)
                }}
                onError={() => setFailed(true)}
                onHttpError={({ nativeEvent }) => {
                  if (isFatalDshWebHttpError(nativeEvent, grantUrl, sessionUri)) setFailed(true)
                }}
                onContentProcessDidTerminate={() => setFailed(true)}
                incognito={Platform.OS === 'ios'}
                sharedCookiesEnabled={false}
                thirdPartyCookiesEnabled={false}
                setSupportMultipleWindows={false}
                allowFileAccess={false}
                mixedContentMode="never"
              />}
              {!loaded && <View style={[StyleSheet.absoluteFill, styles.loading, { backgroundColor: colors.background }]}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.muted }} accessibilityLiveRegion="polite">{loadingMessage}</Text>
              </View>}
            </View>}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
})
