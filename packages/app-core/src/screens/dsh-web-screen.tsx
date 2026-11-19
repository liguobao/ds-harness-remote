import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Platform, StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import WebView from 'react-native-webview'
import { dshWebGrantSchema, type DshWebGrant } from '@dsh-remote/protocol'
import { useAppStore } from '../state/store'
import { ErrorBanner, TopBar } from '../ui/components'
import { useTheme } from '../ui/theme-context'

type Rpc = (method: string, params: unknown, signal?: AbortSignal) => Promise<unknown>

export function DshWebScreen({ rpc, onClose }: { rpc: Rpc; onClose: () => void }) {
  const chinese = useAppStore(state => state.language)?.startsWith('zh')
  const { colors } = useTheme()
  const [grant, setGrant] = useState<DshWebGrant>()
  const [failed, setFailed] = useState(false)
  const [membership, setMembership] = useState(false)

  useEffect(() => {
    const abort = new AbortController()
    void rpc('dsh.web.open', {}, abort.signal).then(result => {
      if (abort.signal.aborted) return
      const parsed = dshWebGrantSchema.parse(result)
      if (parsed.expiresAt <= Date.now()) { setFailed(true); return }
      setGrant(parsed)
    }).catch(error => {
      if (abort.signal.aborted) return
      setMembership(error?.code === 'WEB_ENTITLEMENT_REQUIRED')
      setFailed(true)
    })
    return () => {
      abort.abort()
      void rpc('dsh.web.close', {}, AbortSignal.timeout(4_000)).catch(() => undefined)
    }
  }, [rpc])

  const source = useMemo(() => grant && ({
    uri: new URL('/__remote/session', grant.url).href,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'browserGrant=' + encodeURIComponent(grant.browserGrant),
  }), [grant])
  const title = chinese ? '打开 DSH Web' : 'Open DSH Web'
  return (
    <Modal visible onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
        <TopBar title={title} onBack={onClose} />
        {failed ? <ErrorBanner message={membership
          ? (chinese ? '此功能需要有效会员。' : 'An active membership is required.')
          : (chinese ? '无法打开 DSH Web，请关闭后重试。' : 'Could not open DSH Web. Close and try again.')} />
          : !source || !grant ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
            : <WebView
                source={source}
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={({ url }) => {
                  try { return new URL(url).origin === new URL(grant.url).origin } catch { return false }
                }}
                onError={() => setFailed(true)}
                onHttpError={({ nativeEvent }) => {
                  if (nativeEvent.url === source.uri || nativeEvent.url === grant.url) setFailed(true)
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
