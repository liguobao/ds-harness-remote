/**
 * Android's OPTIONAL UI surface. The trusted top-level HTML only hosts an
 * audited local bundle; arbitrary model-generated HTML runs inside the
 * bundle's sandboxed widget iframe, never as this page's document.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Share, StyleSheet, Text, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import WebView from 'react-native-webview'
import type { WebViewMessageEvent } from 'react-native-webview'
import { useAppStore } from '../state/store'
import type { UiArtifact } from '../state/ui-artifacts'
import { parseUiBridgeMessage, UiActionGuard } from '../state/ui-action-guard'
import { useTheme } from '../ui/theme-context'
import { INTELLIGENT_UI_RENDERER_CODE } from '../generated/intelligent-ui-renderer-code'

const MAX_PROMPT = 4000
const MAX_FRAME_HEIGHT = 2800

function documentFor(token: string): string {
  // This is a trusted local bootstrap, not Host-supplied markup. Never place
  // the artifact itself in HTML: it enters via a JSON argument after load.
  const code = INTELLIGENT_UI_RENDERER_CODE.replace(/<\/script/gi, '<\\/script')
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; frame-src about: data: blob:; form-action \'none\'; base-uri \'none\'">'
    + '<style>html,body{padding:0;margin:0;overflow-x:hidden;background:transparent}</style></head><body><main id="ui"></main>'
    + '<script>' + code + '</script>'
    + '<script>(function(){'
    + 'var token=' + JSON.stringify(token) + ';var seq=0;var pending=new Map();'
    + 'function send(type,payload){window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({token:token,type:type},payload||{})))}'
    + 'window.__diuiReply=function(id,ok,error){var p=pending.get(id);if(!p)return;pending.delete(id);if(ok)p.resolve();else p.reject(new Error(error||"Prompt rejected"))};'
    + 'try {'
    + 'var host={sendPrompt:function(text){return new Promise(function(resolve,reject){var id=++seq;pending.set(id,{resolve:resolve,reject:reject});send("prompt",{id:id,text:text})})},'
    + 'onHeight:function(height){send("resize",{height:height})}};'
    + 'var renderer=window.DshIntelligentUiRenderer.mount(document.getElementById("ui"),host);'
    + 'document.addEventListener("click",function(e){'
    + 'var a=e.target&&e.target.closest?e.target.closest("a[download]"):null;'
    + 'if(a&&a.href&&a.href.indexOf("blob:")===0){'
    + 'e.preventDefault();'
    + 'fetch(a.href).then(function(r){return r.text()}).then(function(t){send("download",{name:a.download||"data.txt",text:t})}).catch(function(){});'
    + '}'
    + '},true);'
    + 'window.__diuiSetArtifact=function(value){try{renderer.render(value)}catch(e){send("error",{message:String(e&&e.message||e)})}};'
    + 'window.__diuiSetTheme=function(value){renderer.setTheme(value)};'
    + 'send("ready",{});'
    + '}catch(e){send("error",{message:String(e&&e.message||e)})}'
    + '})();</script></body></html>'
}

export function IntelligentUiCard({ artifact }: { artifact: UiArtifact }) {
  const { colors, scheme } = useTheme()
  const token = useMemo(() => Crypto.randomUUID(), [artifact.hostId, artifact.sessionId, artifact.uiId])
  const html = useMemo(() => documentFor(token), [token])
  const source = useMemo(() => ({ html }), [html])
  const ref = useRef<WebView>(null)
  const ready = useRef(false)
  const actions = useRef(new UiActionGuard())
  const mounted = useRef(false)
  const [height, setHeight] = useState(180)
  const [error, setError] = useState<string>()
  const current = useRef(artifact)
  current.current = artifact
  const scopeIsActive = () => {
    const state = useAppStore.getState()
    return state.selectedDevice?.deviceId === current.current.hostId
      && state.selectedSession?.sessionId === current.current.sessionId
      && (state.selectedSession?.backend === undefined || state.selectedSession.backend === 'harness')
      && state.connection.phase === 'connected'
  }
  useEffect(() => {
    mounted.current = true
    const unsubscribe = useAppStore.subscribe(() => {
      if (!scopeIsActive()) {
        const revoked = actions.current.invalidate()
        if (revoked && ready.current) {
          reply(revoked.id, false, 'Session changed or disconnected; delivery unconfirmed. Inspect the session before retrying')
        }
      }
    })
    return () => {
      mounted.current = false
      ready.current = false
      actions.current.invalidate()
      unsubscribe()
    }
  }, [])
  const postArtifact = useCallback(() => {
    // Android's offline policy is stricter than an optional Host CDN policy.
    const value = current.current
    const data = JSON.stringify({ ...value, policy: {
      ...value.policy, allowNetwork: false, cdn: [], openLinkOrigins: [],
    } }).replace(/</g, '\\u003c')
    ref.current?.injectJavaScript('window.__diuiSetArtifact && window.__diuiSetArtifact(' + data + '); true;')
  }, [])
  useEffect(() => { if (ready.current) postArtifact() }, [artifact, postArtifact])
  useEffect(() => {
    if (ready.current) ref.current?.injectJavaScript('window.__diuiSetTheme && window.__diuiSetTheme(' + JSON.stringify(scheme) + ');true;')
  }, [scheme])
  const reply = (id: number, ok: boolean, error?: string) => {
    ref.current?.injectJavaScript('window.__diuiReply && window.__diuiReply('
      + JSON.stringify(id) + ',' + JSON.stringify(ok) + ',' + JSON.stringify(error ?? '') + ');true;')
  }
  const handle = (event: WebViewMessageEvent) => {
    if (!mounted.current) return
    const msg = parseUiBridgeMessage(event.nativeEvent.data, token)
    if (!msg) return
    if (msg.type === 'ready') {
      ready.current = true
      postArtifact()
      ref.current?.injectJavaScript('window.__diuiSetTheme && window.__diuiSetTheme(' + JSON.stringify(scheme) + ');true;')
      return
    }
    if (msg.type === 'error' && typeof msg.message === 'string') {
      setError(msg.message.slice(0, 240))
      return
    }
    if (msg.type === 'download' && typeof msg.text === 'string') {
      const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim() : 'data.txt'
      void Share.share({ title: name, message: msg.text })
      return
    }
    if (msg.type === 'resize' && typeof msg.height === 'number' && Number.isFinite(msg.height)) {
      setHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(100, Math.ceil(msg.height) + 8)))
      return
    }
    if (msg.type !== 'prompt' || !Number.isSafeInteger(msg.id) || typeof msg.text !== 'string') return
    const id = msg.id as number
    const text = msg.text.trim()
    if (text.length === 0 || text.length > MAX_PROMPT
      || !ready.current || !scopeIsActive()) {
      reply(id, false, 'UI action is unavailable, invalid or rate-limited')
      return
    }
    const ticket = actions.current.admit(id, Date.now())
    if (!ticket) {
      reply(id, false, 'UI action is unavailable, invalid or rate-limited')
      return
    }
    // A widget's arbitrary JS cannot prove a real gesture. Require a native
    // confirmation even for declarative actions; never auto-prompt on load.
    // Show the exact text we will submit. Android's native message dialog
    // scrolls long content; never hide a suffix of a model-directed action.
    Alert.alert('Send UI action?', text, [
      { text: 'Cancel', style: 'cancel', onPress: () => {
        if (!actions.current.isCurrent(ticket)) return
        actions.current.finish(ticket)
        reply(id, false, 'Cancelled')
      } },
      { text: 'Send', onPress: () => {
        if (!mounted.current || !actions.current.isCurrent(ticket)) return
        if (!scopeIsActive()) {
          actions.current.finish(ticket)
          reply(id, false, 'Session changed or disconnected')
          return
        }
        // The native button callback is one-shot as well. Keep the gate busy
        // until delivery settles, but a second callback cannot send again.
        const now = useAppStore.getState()
        if (!actions.current.submit(ticket)) return
        void now.sendMessage(text).then(outcome => {
          if (!mounted.current || !actions.current.isCurrent(ticket)) return
          reply(id, outcome === 'sent', outcome === 'kept'
            ? 'Delivery unconfirmed; inspect the session before retrying'
            : 'Prompt was not accepted')
        }).catch(e => {
          if (!mounted.current || !actions.current.isCurrent(ticket)) return
          reply(id, false, e instanceof Error ? e.message : 'Prompt failed')
        }).finally(() => { actions.current.finish(ticket) })
      } },
    ], { cancelable: false })
  }

  if (!INTELLIGENT_UI_RENDERER_CODE) return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.ink }]}>{artifact.title || 'Intelligent UI'}</Text>
      <Text style={{ color: colors.muted }}>Interactive UI requires the optional offline renderer package. The Host content was not executed.</Text>
    </View>
  )
  return <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <Text style={[styles.title, { color: colors.ink }]}>{artifact.title || 'Intelligent UI'}</Text>
    {error !== undefined
      ? <Text style={{ color: colors.danger }}>Could not display UI: {error}</Text>
      : <WebView
          ref={ref}
          // Let our navigation callback reject all external URLs before the
          // default origin-whitelist handler can hand them to Android Linking.
          originWhitelist={['*']}
          source={source}
          style={{ height, backgroundColor: 'transparent' }}
          scrollEnabled={false}
          nestedScrollEnabled={false}
          javaScriptEnabled
          domStorageEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          onShouldStartLoadWithRequest={request =>
            request.url === 'about:blank' || request.url === 'about:srcdoc'}
          onMessage={handle}
          onLoadStart={() => { ready.current = false; actions.current.invalidate() }}
          onLoadEnd={() => { if (!ready.current) postArtifact() }}
          onError={() => {
            ready.current = false
            actions.current.invalidate()
            setError('WebView failed to load')
          }}
          onRenderProcessGone={() => {
            ready.current = false
            actions.current.invalidate()
            setError('WebView process stopped')
          }}
        />}
  </View>
}
const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 8, marginVertical: 8, overflow: 'hidden' },
  title: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
})
