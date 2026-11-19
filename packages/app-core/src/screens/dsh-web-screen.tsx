import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Platform, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import WebView from 'react-native-webview'
import { dshWebGrantSchema, type DshWebGrant } from '@dsh-remote/protocol'
import { useAppStore } from '../state/store'
import { ErrorBanner, TopBar } from '../ui/components'
import { useTheme } from '../ui/theme-context'

type Rpc = (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>

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

export function DshWebScreen({ rpc, onClose }: { rpc: Rpc; onClose: () => void }) {
  const chinese = useAppStore(state => state.language)?.startsWith('zh')
  const { colors } = useTheme()
  const [grant, setGrant] = useState<DshWebGrant>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const pendingCloseRef = useRef<Promise<unknown> | undefined>(undefined)

  useEffect(() => {
    const abort = new AbortController()
    let shouldClose = false
    setFailed(false)
    setGrant(undefined)

    const startOpen = () => {
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

    const pendingClose = pendingCloseRef.current
    if (pendingClose) {
      void pendingClose.finally(startOpen)
    } else {
      startOpen()
    }

    return () => {
      abort.abort()
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
    setGrant(undefined)
    setAttempt(current => current + 1)
  }

  const sessionUri = grant && new URL('/__remote/session', grant.url).href
  const source = useMemo(() => {
    if (!grant || !sessionUri) return undefined
    if (Platform.OS === 'android') {
      // postUrl can send an opaque Origin. Post a form from the tunnel origin instead.
      return {
        baseUrl: grant.url,
        html: `<!doctype html><meta name="referrer" content="same-origin">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; form-action 'self'">
          <form method="post" action="/__remote/session">
            <input type="hidden" name="browserGrant" value="${encodeURIComponent(grant.browserGrant)}">
          </form><script>document.forms[0].submit()</script>`,
      }
    }
    return {
      uri: sessionUri,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'browserGrant=' + encodeURIComponent(grant.browserGrant),
    }
  }, [grant, sessionUri])
  const title = chinese ? '打开 DSH Web' : 'Open DSH Web'
  return (
    <Modal visible onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <TopBar title={title} onBack={onClose} />
        {failed ? <ErrorBanner
          message={chinese ? '无法打开 DSH Web，请重试。' : 'Could not open DSH Web. Please try again.'}
          onRetry={retry}
        />
          : !source || !grant || !sessionUri ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
            : <WebView
                source={source}
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={({ url }) => {
                  try { return new URL(url).origin === new URL(grant.url).origin } catch { return false }
                }}
                onError={() => setFailed(true)}
                onHttpError={({ nativeEvent }) => {
                  if (isFatalDshWebHttpError(nativeEvent, grant.url, sessionUri)) setFailed(true)
                }}
                onContentProcessDidTerminate={() => setFailed(true)}
                incognito={Platform.OS === 'ios'}
                sharedCookiesEnabled={false}
                thirdPartyCookiesEnabled={false}
                setSupportMultipleWindows={false}
                allowFileAccess={false}
                mixedContentMode="never"
              />}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
