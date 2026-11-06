import { useEffect, useRef, useState } from 'react'
import { useBrowseMemory, browsePreference } from '../services/browse-memory'
import * as Application from 'expo-application'
import { File, Paths } from 'expo-file-system'
import { getContentUriAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Toggle } from '../ui/toggle'
import { BatteryCharging, Bell, BellRing, Cable, Check, ChevronRight, Download, ExternalLink, Fingerprint, FolderPen, Globe, Hash, History, Info, KeyRound, Languages, Laptop, ListCollapse, LockKeyhole, LogOut, Mail, MoreVertical, PanelTop, QrCode as QrCodeIcon, RotateCcw, Route, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal, Smartphone, Type, UserRound, X, type LucideIcon } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import type { QrLoginStart } from '../state/store-state'
import { SOURCE_CODE_URL } from '../lib/links'
import { foregroundService } from '../services/foreground-service'
import type { OAuthProviderInfo } from '../services/api'
import { BlurHeaderFrame, Button, Field, GroupCard, GroupRow, IconButton, KeyValue, Screen, SectionTitle, TopBar } from '../ui/components'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { transportPreferenceOptions } from '../types'
import type { DefaultPermissionPreset, LoginMethod } from '../types'
import { QrCode } from '../ui/qr-code'
import Svg, { Path, Polygon } from 'react-native-svg'
import { FISH_LOGO_PATH, FISH_LOGO_VIEWBOX } from '../ui/fish-logo'
import { GithubIcon, GoogleIcon, ZhihuIcon } from '../ui/brand-icons'
import { darkColors, floatingShadow, lightColors, radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useResponsiveLayout } from '../ui/responsive'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings as zhCN, type LanguagePreference } from '../locales/i18n'
import type { ThemePreference, TypographyDensity } from '../ui/theme'

/** Default DSH Remote Server; a build can override it via EXPO_PUBLIC_DSH_REMOTE_SERVER. */
const defaultServerUrl = 'https://dsh.r2049.cn'
const updateUrl = 'https://github.com/liguobao/ds-harness-remote/releases/latest'
const releaseApiUrl = 'https://api.github.com/repos/liguobao/ds-harness-remote/releases/latest'
const developerUrl = 'https://www.zhihu.com/people/codelover'
const twitterUrl = 'https://x.com/liguobao2077'

type SetupLoginMethod = LoginMethod

function qrProviderFor(method: SetupLoginMethod): string | undefined {
  if (method === 'oauth') return 'zhihu'
  if (method === 'github-oauth') return 'github'
  if (method === 'google-oauth') return 'google'
  return undefined
}

function loginMethodLabel(method?: LoginMethod): string {
  if (method === 'oauth') return zhCN.setup.oauth
  if (method === 'github-oauth') return zhCN.setup.githubOAuth
  if (method === 'google-oauth') return 'Google'
  if (method === 'password') return zhCN.setup.passwordMethod
  return zhCN.common.unknown
}

export function ServerSetupScreen({ onComplete, onBack, onMore, serverExpanded, setServerExpanded }: { onComplete: () => void; onBack?: () => void; onMore: () => void; serverExpanded: boolean; setServerExpanded: (expanded: boolean) => void }) {
  const config = useAppStore(state => state.config)
  const busy = useAppStore(state => state.busyAction === 'server')
  const language = useAppStore(state => state.language)
  const oauthBusy = useAppStore(state => state.busyAction === 'oauth')
  const pendingOAuthLoginMethod = useAppStore(state => state.pendingOAuthLoginMethod)
  const oauthFlowBusy = oauthBusy || pendingOAuthLoginMethod !== undefined
  const selectServer = useAppStore(state => state.selectServer)
  const configure = useAppStore(state => state.configureServer)
  const startOAuth = useAppStore(state => state.startOAuth)
  const startGithubOAuth = useAppStore(state => state.startGithubOAuth)
  const startGoogleOAuth = useAppStore(state => state.startGoogleOAuth)
  const listLoginProviders = useAppStore(state => state.listLoginProviders)
  const listQrProviders = useAppStore(state => state.listQrProviders)
  const startQrLogin = useAppStore(state => state.startQrLogin)
  const pollQrLogin = useAppStore(state => state.pollQrLogin)
  const completeQrLogin = useAppStore(state => state.completeQrLogin)
  const [serverUrl, setServerUrl] = useState(config?.baseUrl ?? process.env.EXPO_PUBLIC_DSH_REMOTE_SERVER ?? defaultServerUrl)
  const [serverDraft, setServerDraft] = useState(serverUrl)
  const [serverError, setServerError] = useState<string>()
  const serverDirty = serverDraft.trim() !== serverUrl
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const preferredLoginMethod: SetupLoginMethod = language.startsWith('zh-') ? 'oauth' : 'google-oauth'
  const [loginMethod, setLoginMethod] = useState<SetupLoginMethod>(preferredLoginMethod)
  const [showQr, setShowQr] = useState(false)
  const [loginProviders, setLoginProviders] = useState<OAuthProviderInfo[]>([])
  const [providersPhase, setProvidersPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [providerReload, setProviderReload] = useState(0)
  const availableMethods: SetupLoginMethod[] = ([preferredLoginMethod, 'oauth', 'github-oauth', 'google-oauth'] as const)
    .filter((method, index, methods) => methods.indexOf(method) === index)
    .filter(method => loginProviders.some(provider => provider.id === qrProviderFor(method)))
  availableMethods.push('password')
  const supportsQrAny = loginProviders.some(provider => provider.qrStartUrl !== undefined && availableMethods.some(method => qrProviderFor(method) === provider.id))

  const [qrLogin, setQrLogin] = useState<QrLoginStart>()
  const [qrPhase, setQrPhase] = useState<'idle' | 'loading' | 'waiting' | 'expired' | 'unsupported' | 'failed'>('idle')
  const qrRun = useRef(0)
  const lastServerUrl = useRef(serverUrl)
  // Keep navigation out of the polling effect dependencies: completing QR
  // sign-in updates the store (and re-renders the app), which must not cancel
  // the in-flight registration and re-poll an already-consumed one-time token.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const qrCompleted = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const { width, height, sheetMaxHeight } = useResponsiveLayout()
  // Give tablets a larger code while keeping the same login tabs on all screens.
  const largeScreen = Math.min(width, height) >= 600
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  useEffect(() => {
    let cancelled = false
    qrRun.current += 1
    setQrLogin(undefined)
    setShowQr(false)
    setLoginProviders([])
    setProvidersPhase('loading')
    void listLoginProviders(serverUrl).then(result => {
      if (cancelled) return
      if (result === undefined) {
        qrRun.current += 1
        setProvidersPhase('failed')
        setLoginMethod('password')
        setShowPassword(false)
        setShowQr(false)
        setQrLogin(undefined)
        setQrPhase('idle')
        return
      }
      setLoginProviders(result.providers)
      setProvidersPhase('ready')
      const nextMethod = ([preferredLoginMethod, 'oauth', 'github-oauth', 'google-oauth'] as const)
        .find(method => result.providers.some(provider => provider.id === qrProviderFor(method))) ?? 'password'
      setLoginMethod(nextMethod)
      setShowPassword(nextMethod === 'password')
      setShowQr(false)
    }).catch(() => {
      if (cancelled) return
      qrRun.current += 1
      setProvidersPhase('failed')
      setLoginMethod('password')
      setShowPassword(false)
      setShowQr(false)
      setQrLogin(undefined)
      setQrPhase('idle')
    })
    return () => { cancelled = true }
  }, [serverUrl, providerReload, listLoginProviders, preferredLoginMethod, largeScreen])

  const closeServerEditor = () => {
    if (busy) return
    setServerDraft(serverUrl)
    setServerError(undefined)
    setServerExpanded(false)
  }

  const saveServer = async () => {
    setServerError(undefined)
    const saved = await selectServer(serverDraft)
    if (saved === undefined) {
      setServerError(useAppStore.getState().error ?? zhCN.tools.failed)
      return
    }
    setServerUrl(saved)
    setServerDraft(saved)
    setProviderReload(value => value + 1)
    setPassword('')
    setServerExpanded(false)
  }

  const submit = async () => {
    if (serverDirty) return
    if (await configure(serverUrl, email, password)) onComplete()
  }

  const signInWithZhihu = async () => {
    if (serverDirty) return
    const url = await startOAuth(serverUrl)
    if (url === undefined) return
    if (Platform.OS === 'android') {
      try {
        // Zhihu's hybrid route takes zh_url; an unknown route only opens its home screen.
        // Keep the server OAuth entry and nested return_to intact.
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: `zhihu://hybrid?zh_url=${encodeURIComponent(url)}`,
          packageName: 'com.zhihu.android',
        })
        return
      } catch {
        // Zhihu may be missing or unable to handle this link; use the browser.
      }
    }
    await Linking.openURL(url)
  }

  const signInWithGithub = async () => {
    if (serverDirty) return
    const url = await startGithubOAuth(serverUrl)
    if (url !== undefined) await Linking.openURL(url)
  }

  const signInWithGoogle = async () => {
    if (serverDirty) return
    const url = await startGoogleOAuth(serverUrl)
    if (url !== undefined) await Linking.openURL(url)
  }

  const canSubmit = email.trim().length > 0 && password.length > 0

  const startQrFor = async (provider: OAuthProviderInfo, run: number) => {
    qrCompleted.current = false
    setQrPhase('loading')
    setQrLogin(undefined)
    const started = await startQrLogin(serverUrl, provider.id)
    if (run !== qrRun.current) return
    if (started === undefined) {
      setQrPhase('failed')
      return
    }
    setQrLogin(started)
    setQrPhase('waiting')
  }

  const refreshQr = async (method = loginMethod) => {
    if (serverDirty) return
    const run = ++qrRun.current
    qrCompleted.current = false
    setQrPhase('loading')
    setQrLogin(undefined)
    const result = await listQrProviders(serverUrl)
    if (run !== qrRun.current) return
    if (result === undefined) {
      setQrPhase('failed')
      return
    }
    const preferred = result.providers.find(provider => provider.id === qrProviderFor(method))
    if (preferred === undefined) {
      setQrPhase('unsupported')
      return
    }
    await startQrFor(preferred, run)
  }

  // Changing the Server invalidates every provider and QR session on screen.
  useEffect(() => {
    if (lastServerUrl.current === serverUrl) return
    lastServerUrl.current = serverUrl
    qrRun.current += 1
    qrCompleted.current = false
    setShowQr(false)
    setQrLogin(undefined)
    setQrPhase('idle')
  }, [serverUrl])

  // Poll only the selected provider while its QR panel is visible.
  useEffect(() => {
    if (serverDirty || !showQr || qrLogin === undefined || qrLogin.provider.id !== qrProviderFor(loginMethod) || qrCompleted.current) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const poll = async () => {
      if (cancelled || qrCompleted.current) return
      const result = await pollQrLogin(qrLogin.baseUrl, qrLogin.session.qrId)
      if (cancelled || qrCompleted.current) return
      if (result === undefined) {
        failures += 1
        if (failures >= 5) {
          setQrPhase('failed')
          return
        }
        timer = setTimeout(() => void poll(), 3000)
        return
      }
      failures = 0
      if (result.status === 'expired') {
        setQrPhase('expired')
        return
      }
      if (result.status === 'complete') {
        // The one-time token can only be claimed once. From here on the app
        // must not poll again while device registration is in flight; the
        // registration also re-renders the app, so navigation is read from a
        // ref instead of being an effect dependency.
        qrCompleted.current = true
        const method = loginMethod
        if (method === 'password') return
        const ok = await completeQrLogin(qrLogin.baseUrl, result.token, method)
        if (ok) {
          // Finish navigation even if this render's tab was switched while the
          // registration was in flight; the account is already signed in.
          if (mounted.current) onCompleteRef.current()
        } else {
          qrCompleted.current = false
          if (mounted.current && !cancelled) setQrPhase('failed')
        }
        return
      }
      timer = setTimeout(() => void poll(), 2000)
    }
    timer = setTimeout(() => void poll(), 1200)
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [completeQrLogin, loginMethod, pollQrLogin, qrLogin, showQr, serverDirty])

  const chooseLoginMethod = (method: SetupLoginMethod) => {
    if (method === loginMethod) return
    qrRun.current += 1
    setLoginMethod(method)
    setQrLogin(undefined)
    setQrPhase('idle')
    if (method === 'password') {
      setShowQr(false)
      setShowPassword(true)
    }
    else if (showQr) void refreshQr(method)
  }

  const qrMethods = availableMethods.filter(method => loginProviders.some(provider => provider.id === qrProviderFor(method) && provider.qrStartUrl !== undefined))
  const oauthMethods = availableMethods.filter(method => method !== 'password')

  const signInWithProvider = (method: SetupLoginMethod) => {
    if (showQr) {
      qrRun.current += 1
      setShowQr(false)
      setQrLogin(undefined)
      setQrPhase('idle')
    }
    setLoginMethod(method)
    setShowPassword(false)
    if (method === 'oauth') void signInWithZhihu()
    else if (method === 'github-oauth') void signInWithGithub()
    else if (method === 'google-oauth') void signInWithGoogle()
  }

  const closeQr = () => {
    qrRun.current += 1
    setShowQr(false)
    setQrLogin(undefined)
    setQrPhase('idle')
  }

  const openQr = () => {
    const method = qrMethods.includes(loginMethod) ? loginMethod : qrMethods[0]
    if (method === undefined) return
    setLoginMethod(method)
    setShowPassword(false)
    setShowQr(true)
    void refreshQr(method)
  }

  // Third-party sign-in is the primary path; email is a collapsed fallback
  // (the Server has no email sign-up). QR is offered on large screens only.
  const qrVisible = largeScreen && showQr
  const emailVisible = showPassword || (providersPhase === 'ready' && oauthMethods.length === 0)
  const controlsDisabled = busy || oauthBusy || serverDirty

  const providerIcon = (method: SetupLoginMethod, size = 22) => method === 'oauth'
    ? <ZhihuIcon size={size} color="#1772F6" />
    : method === 'github-oauth'
      ? <GithubIcon size={size} color={colors.ink} />
      : <GoogleIcon size={size} />

  const providerLabel = (method: SetupLoginMethod) => method === 'oauth'
    ? zhCN.setup.zhihu
    : method === 'github-oauth' ? zhCN.setup.github : zhCN.setup.google

  const providerShortName = (method: SetupLoginMethod) => method === 'oauth'
    ? zhCN.setup.oauth
    : method === 'github-oauth' ? zhCN.setup.githubOAuth : 'Google'

  const qrContent = !qrVisible ? null : (
    <View style={styles.qrPanel}>
      <Text style={styles.qrTitle} accessibilityRole="header">{zhCN.setup.qrScanTitle}</Text>
      {qrMethods.length > 1 && (
        <View style={styles.segmentRow} accessibilityRole="tablist">
          {qrMethods.map(method => (
            <Pressable
              key={method}
              accessibilityRole="tab"
              accessibilityState={{ selected: loginMethod === method }}
              onPress={() => chooseLoginMethod(method)}
              style={[styles.qrSegment, loginMethod === method && styles.segmentButtonActive]}
            >
              {providerIcon(method, 16)}
              <Text style={[styles.segmentButtonText, loginMethod === method && styles.segmentButtonTextActive]}>{providerShortName(method)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.qrFrame}>
        {qrPhase === 'waiting' && qrLogin !== undefined
          ? <QrCode value={qrLogin.session.scanUrl} size={232} label={`${zhCN.setup.qrScanTitle}. ${zhCN.setup.qrScanHint}`} />
          : qrPhase === 'loading' || qrPhase === 'idle'
            ? <ActivityIndicator color={colors.primary} accessibilityLabel={zhCN.setup.qrWaiting} />
            : <Text style={styles.qrMessage}>{qrPhase === 'unsupported' ? zhCN.setup.qrUnsupported : qrPhase === 'expired' ? zhCN.setup.qrExpired : zhCN.setup.qrFailed}</Text>}
      </View>
      <Text style={styles.qrHint}>{zhCN.setup.qrScanHint}</Text>
      <View style={styles.qrActions}>
        <Pressable accessibilityRole="button" onPress={closeQr} style={styles.textLink}>
          <Text style={styles.textLinkLabel}>{zhCN.common.back}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={busy || serverDirty || qrPhase === 'loading'}
          onPress={() => void refreshQr()}
          style={styles.textLink}
        >
          <Text style={[styles.textLinkLabel, qrPhase === 'loading' && styles.textLinkDisabled]}>{zhCN.setup.qrRefresh}</Text>
        </Pressable>
      </View>
    </View>
  )

  const emailContent = (
    <View style={styles.emailForm}>
      <TextInput
        style={styles.loginInput}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        placeholder={zhCN.setup.emailPlaceholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={zhCN.setup.email}
      />
      <TextInput
        style={styles.loginInput}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => { if (canSubmit) void submit() }}
        placeholder={zhCN.setup.passwordPlaceholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={zhCN.setup.password}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={zhCN.setup.title}
        accessibilityState={{ disabled: !canSubmit || serverDirty || busy, busy }}
        disabled={!canSubmit || serverDirty || busy}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.emailSubmit, canSubmit && styles.emailSubmitReady, pressed && styles.providerButtonPressed]}
      >
        {busy
          ? <ActivityIndicator color={colors.white} />
          : <Text style={[styles.emailSubmitText, canSubmit && styles.emailSubmitTextReady]}>{zhCN.setup.title}</Text>}
      </Pressable>
      <Text style={styles.passwordHint}>{zhCN.setup.passwordHint}</Text>
    </View>
  )

  const whaleWidth = largeScreen ? 168 : 128

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame header={<TopBar title="" onBack={onBack} action={<IconButton label={zhCN.settings.more} icon={MoreVertical} onPress={onMore} />} />}>
        <Screen fill refreshing={providersPhase === 'loading'} onRefresh={() => setProviderReload(value => value + 1)}>
          <View style={styles.hero}>
            <Svg
              width={whaleWidth}
              height={(whaleWidth * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
              viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
              accessible={false}
            >
              <Path d={FISH_LOGO_PATH} fill={colors.ink} />
            </Svg>
            <View style={styles.wordmarkRow} accessible accessibilityRole="header" accessibilityLabel="DS Harness Remote">
              <Text style={styles.wordmark}>DSH REMOTE</Text>
            </View>
            <Text style={styles.heroLead}>{zhCN.setup.lead}</Text>
          </View>

          <View style={styles.loginCard}>
            {providersPhase === 'loading'
              ? <View style={styles.loginLoading}><ActivityIndicator color={colors.primary} /></View>
              : qrVisible
                ? qrContent
                : <>
                    {providersPhase === 'ready' && oauthMethods.map(method => {
                      const preparing = oauthBusy && loginMethod === method
                      return (
                        <Pressable
                          key={method}
                          accessibilityRole="button"
                          accessibilityLabel={providerLabel(method)}
                          accessibilityState={{ disabled: controlsDisabled, busy: preparing }}
                          disabled={controlsDisabled}
                          onPress={() => signInWithProvider(method)}
                          style={({ pressed }) => [styles.providerButton, pressed && styles.providerButtonPressed, controlsDisabled && !preparing && styles.providerButtonDisabled]}
                        >
                          <View style={styles.providerIcon}>
                            {preparing ? <ActivityIndicator size="small" color={colors.muted} /> : providerIcon(method)}
                          </View>
                          <Text style={styles.providerButtonText} numberOfLines={1}>{providerLabel(method)}</Text>
                        </Pressable>
                      )
                    })}
                    {providersPhase === 'ready' && oauthMethods.length > 0 && (
                      <Text style={styles.oauthHint}>{zhCN.setup.oauthHint}</Text>
                    )}
                    {providersPhase === 'failed' && (
                      <View style={styles.retryRow}><Button label={zhCN.common.retry} variant="secondary" onPress={() => setProviderReload(value => value + 1)} /></View>
                    )}
                    {(providersPhase === 'failed' || oauthMethods.length > 0) && (
                      <View style={styles.orDivider}>
                        <View style={styles.orLine} />
                        <Text style={styles.orText}>{zhCN.setup.or}</Text>
                        <View style={styles.orLine} />
                      </View>
                    )}
                    {emailVisible && emailContent}
                    {((largeScreen && qrMethods.length > 0) || providersPhase === 'failed' || oauthMethods.length > 0) && (
                      <View style={styles.altRow}>
                        {largeScreen && qrMethods.length > 0 && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={zhCN.setup.qr}
                            accessibilityHint={zhCN.setup.qrEntryHint}
                            disabled={controlsDisabled}
                            onPress={openQr}
                            style={({ pressed }) => [styles.altButton, pressed && styles.providerButtonPressed]}
                          >
                            <QrCodeIcon size={18} color={colors.ink} />
                            <Text style={styles.altButtonText}>{zhCN.setup.qr}</Text>
                          </Pressable>
                        )}
                        {(providersPhase === 'failed' || oauthMethods.length > 0) && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={emailVisible ? zhCN.setup.emailSignInCollapse : zhCN.setup.emailSignIn}
                            disabled={busy}
                            onPress={() => {
                              if (emailVisible) {
                                setShowPassword(false)
                              } else {
                                setShowPassword(true)
                                setLoginMethod('password')
                              }
                            }}
                            style={({ pressed }) => [styles.altButton, pressed && styles.providerButtonPressed]}
                          >
                            <Mail size={18} color={colors.ink} />
                            <Text style={styles.altButtonText}>
                              {emailVisible ? zhCN.setup.emailSignInCollapse : zhCN.setup.emailSignIn}
                            </Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </>}
          </View>


          <View style={styles.loginFooter}>
            <Pressable accessibilityRole="link" accessibilityLabel="GitHub/liguobao"
              onPress={() => void Linking.openURL('https://github.com/liguobao').catch(() => {
                Alert.alert(zhCN.settings.linkFailedTitle, zhCN.settings.linkFailedBody)
              })} style={styles.loginCreditLink}>
              <Text style={styles.loginCredit}>Power by <Text style={styles.loginCreditName}>GitHub/liguobao</Text></Text>
            </Pressable>
          </View>
        </Screen>
      </BlurHeaderFrame>
      <Modal visible={serverExpanded} transparent animationType="fade" onRequestClose={closeServerEditor} statusBarTranslucent>
        <KeyboardAvoidingView behavior="padding" style={styles.serverBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={zhCN.common.close} onPress={closeServerEditor} />
          <View style={[styles.serverDialog, { maxHeight: sheetMaxHeight }]} accessibilityViewIsModal>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.serverDialogContent}>
              <Text style={styles.serverDialogTitle} accessibilityRole="header">{zhCN.setup.switchServer}</Text>
                <Field label={zhCN.setup.server} value={serverDraft} onChangeText={value => {
                  qrRun.current += 1
                  setQrLogin(undefined)
                  setQrPhase('idle')
                  setShowQr(false)
                  setServerDraft(value)
                  setServerError(undefined)
                }} editable={!busy && !oauthFlowBusy} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint={zhCN.setup.switchServerHint} placeholder="https://remote.example.com" />
                {serverError !== undefined && <Text accessibilityRole="alert" style={styles.preferenceError}>{serverError}</Text>}
                <View style={styles.serverActions}>
                  <View style={styles.flex}>
                    <Button label={zhCN.setup.saveServer} onPress={() => void saveServer()} loading={busy} disabled={oauthFlowBusy || !serverDirty || serverDraft.trim() === ''} />
                  </View>
                  <View style={styles.flex}>
                    <Button label={zhCN.common.cancel} variant="secondary" disabled={busy} onPress={closeServerEditor} />
                  </View>
                </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

export function SettingsScreen({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const config = useAppStore(state => state.config)
  const identity = useAppStore(state => state.identity)
  const account = useAppStore(state => state.account)
  const comfort = useBrowseMemory()
  const preference = useAppStore(state => state.transportPreference)
  const setPreference = useAppStore(state => state.setTransportPreference)
  const languagePreference = useAppStore(state => state.languagePreference)
  const setLanguagePreference = useAppStore(state => state.setLanguagePreference)
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false)
  const currentLanguageLabel = languageOptions().find(o => o.value === languagePreference)?.name ?? zhCN.settings.languageSystem
  const themePreference = useAppStore(state => state.themePreference)
  const setThemePreference = useAppStore(state => state.setThemePreference)
  const typographyDensity = useAppStore(state => state.typographyDensity)
  const setTypographyDensity = useAppStore(state => state.setTypographyDensity)
  const [densitySaving, setDensitySaving] = useState(false)
  const [densityPickerOpen, setDensityPickerOpen] = useState(false)
  const currentDensityLabel = typographyDensity === 'compact' ? zhCN.settings.densityCompact : zhCN.settings.densityStandard
  const compactHistory = useAppStore(state => state.compactHistory)
  const setCompactHistory = useAppStore(state => state.setCompactHistory)
  const [compactSaving, setCompactSaving] = useState(false)
  const statusBarVisible = useAppStore(state => state.statusBarVisible)
  const setStatusBarVisible = useAppStore(state => state.setStatusBarVisible)
  const [statusBarSaving, setStatusBarSaving] = useState(false)
  const defaultPermission = useAppStore(state => state.defaultPermissionPreset)
  const setDefaultPermission = useAppStore(state => state.setDefaultPermissionPreset)
  const [permissionSaving, setPermissionSaving] = useState(false)
  const reset = useAppStore(state => state.resetLocalData)
  const signOut = useAppStore(state => state.signOut)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  // Cap the read-only info column on wide landscape tablets; phone portrait
  // already fits inside contentMaxWidth, so nothing changes there.
  const { contentMaxWidth, landscape, sheetMaxHeight } = useResponsiveLayout()

  const openNotificationSettings = async () => {
    if (Platform.OS === 'android' && Application.applicationId) {
      try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
          extra: { 'android.provider.extra.APP_PACKAGE': Application.applicationId },
        })
        return
      } catch { /* Some Android variants only expose the app details page. */ }
    }
    await Linking.openSettings()
  }

  const toggleCompactHistory = async (value: boolean) => {
    if (compactSaving) return
    setCompactSaving(true)
    try { await setCompactHistory(value) }
    catch { Alert.alert(zhCN.settings.compactHistorySaveFailed, zhCN.settings.statusBarSaveFailedBody) }
    finally { setCompactSaving(false) }
  }

  const toggleTypographyDensity = async (value: TypographyDensity) => {
    if (densitySaving || value === typographyDensity) return
    setDensitySaving(true)
    try { await setTypographyDensity(value) }
    catch { Alert.alert(zhCN.settings.typographyDensitySaveFailed, zhCN.settings.statusBarSaveFailedBody) }
    finally { setDensitySaving(false) }
  }

  const toggleStatusBar = async (visible: boolean) => {
    if (statusBarSaving) return
    setStatusBarSaving(true)
    try {
      await setStatusBarVisible(visible)
    } catch {
      Alert.alert(zhCN.settings.statusBarSaveFailed, zhCN.settings.statusBarSaveFailedBody)
    } finally {
      setStatusBarSaving(false)
    }
  }

  const pickDefaultPermission = (preset: DefaultPermissionPreset) => {
    if (permissionSaving || preset === defaultPermission) return
    const save = async () => {
      setPermissionSaving(true)
      try {
        await setDefaultPermission(preset)
      } catch {
        Alert.alert(zhCN.settings.defaultPermissionSaveFailed, zhCN.settings.defaultPermissionSaveFailedBody)
      } finally {
        setPermissionSaving(false)
      }
    }
    if (preset === 'danger-full-access') {
      Alert.alert(zhCN.settings.defaultPermissionFullAccessTitle, zhCN.settings.defaultPermissionFullAccessBody, [
        { text: zhCN.common.cancel, style: 'cancel' },
        { text: zhCN.chat.enable, style: 'destructive', onPress: () => void save() },
      ])
    } else void save()
  }

  const confirmReset = () => Alert.alert(
    zhCN.settings.resetTitle,
    zhCN.settings.resetBody,
    [
      { text: zhCN.common.cancel, style: 'cancel' },
      { text: zhCN.settings.reset, style: 'destructive', onPress: () => void reset().then(onReset) },
    ],
  )

  const confirmSignOut = () => Alert.alert(
    zhCN.settings.signOutTitle,
    zhCN.settings.signOutBody,
    [
      { text: zhCN.common.cancel, style: 'cancel' },
      { text: zhCN.settings.signOut, style: 'destructive', onPress: () => void signOut().then(onReset) },
    ],
  )

  const switchColors = { trackColor: { false: colors.disabled, true: colors.primary }, thumbColor: colors.white } as const

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame header={<TopBar title={zhCN.settings.title} onBack={onBack} />}>
        <Screen>
          <View style={[styles.contentColumn, landscape && { maxWidth: contentMaxWidth }]}>
            <View style={styles.accountPill}>
              <Text style={styles.accountPillTitle} numberOfLines={1}>{account ?? zhCN.settings.notSignedIn}</Text>
              <Text style={styles.accountPillMeta} numberOfLines={1}>{[loginMethodLabel(config?.loginMethod), config?.baseUrl?.replace(/^https?:\/\//, '')].filter(Boolean).join(' · ')}</Text>
            </View>

            <SectionTitle>{zhCN.settings.appearance}</SectionTitle>
            <GroupCard style={styles.themeCard}>
              <View style={styles.themeTiles} accessibilityRole="radiogroup">
                {themeOptions().map(option => (
                  <ThemeTile
                    key={option.value}
                    value={option.value}
                    label={option.name}
                    selected={option.value === themePreference}
                    onPress={() => void setThemePreference(option.value)}
                  />
                ))}
              </View>
            </GroupCard>
            <GroupCard style={styles.settingsGap}>
              <GroupRow
                first
                icon={Type}
                label={zhCN.settings.typographyDensity}
                value={currentDensityLabel}
                chevron
                onPress={() => setDensityPickerOpen(true)}
              />
              <GroupRow
                icon={PanelTop}
                label={zhCN.settings.statusBar}
                accessory={<Toggle accessibilityLabel={zhCN.settings.statusBar} value={statusBarVisible} disabled={statusBarSaving}
                  onValueChange={visible => void toggleStatusBar(visible)} {...switchColors} />}
              />
            </GroupCard>

            <SectionTitle>{zhCN.settings.language}</SectionTitle>
            <GroupCard>
              <GroupRow
                first
                icon={Languages}
                label={zhCN.settings.language}
                value={currentLanguageLabel}
                chevron
                onPress={() => setLanguagePickerOpen(true)}
              />
            </GroupCard>

            <SectionTitle>{zhCN.comfort.continueWork}</SectionTitle>
            <GroupCard>
              <GroupRow
                first
                icon={History}
                label={zhCN.comfort.resume}
                accessory={<Toggle accessibilityLabel={zhCN.comfort.resume} value={comfort.resume}
                  onValueChange={resume => browsePreference({ resume })} {...switchColors} />}
              />
              <GroupRow
                icon={ListCollapse}
                label={zhCN.settings.compactHistory}
                detail={zhCN.settings.compactHistoryNote}
                accessory={<Toggle accessibilityLabel={zhCN.settings.compactHistory} value={compactHistory}
                  disabled={compactSaving} onValueChange={value => void toggleCompactHistory(value)} {...switchColors} />}
              />
              <GroupRow
                icon={Bell}
                label={zhCN.comfort.notifications}
                detail={zhCN.comfort.notificationsNote}
                accessory={<Toggle accessibilityLabel={zhCN.comfort.notifications} value={comfort.notifications}
                  onValueChange={notifications => browsePreference({ notifications })} {...switchColors} />}
              />
              <GroupRow
                icon={BellRing}
                label={zhCN.comfort.systemNotifications}
                accessory={<ExternalLink size={17} color={colors.subtle} />}
                onPress={() => void openNotificationSettings()}
              />
              {Platform.OS === 'android' && (
                <GroupRow
                  icon={BatteryCharging}
                  label={zhCN.comfort.batteryOptimization}
                  detail={zhCN.comfort.batteryOptimizationDescription}
                  accessory={<ExternalLink size={17} color={colors.subtle} />}
                  onPress={async () => {
                    const ok = await foregroundService.requestIgnoreBatteryOptimizations()
                    if (!ok) {
                      Alert.alert(
                        zhCN.comfort.batteryOptimization,
                        zhCN.comfort.batteryOptimizationFailed,
                      )
                    }
                  }}
                />
              )}
            </GroupCard>
            {comfort.error !== undefined && <Text style={styles.preferenceError} accessibilityRole="alert">{comfort.error}</Text>}

            <SectionTitle>{zhCN.settings.defaultPermission}</SectionTitle>
            <GroupCard>
              <View accessibilityRole="radiogroup">
                {([
                  { value: 'default', name: zhCN.settings.defaultPermissionHost, description: zhCN.settings.defaultPermissionHostDescription, icon: ShieldCheck },
                  { value: 'workspace-write', name: zhCN.chat.permissionWorkspaceWrite, description: zhCN.chat.permissionWorkspaceWriteDescription, icon: FolderPen },
                  { value: 'danger-full-access', name: zhCN.chat.permissionFullAccess, description: zhCN.chat.permissionFullAccessDescription, icon: ShieldAlert },
                ] satisfies Array<{ value: DefaultPermissionPreset; name: string; description: string; icon: LucideIcon }>).map((option, index) => {
                  const chosen = option.value === defaultPermission
                  return (
                    <GroupRow
                      key={option.value}
                      first={index === 0}
                      icon={option.icon}
                      label={option.name}
                      detail={option.description}
                      selected={chosen}
                      chevron={false}
                      disabled={permissionSaving}
                      accessory={chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                      onPress={() => pickDefaultPermission(option.value)}
                    />
                  )
                })}
              </View>
            </GroupCard>
            <Text style={styles.preferenceNote}>{zhCN.settings.defaultPermissionNote}</Text>

            <SectionTitle>{zhCN.settings.connection}</SectionTitle>
            <GroupCard>
              <GroupRow first icon={Globe} label={zhCN.settings.server} value={config?.baseUrl?.replace(/^https?:\/\//, '') ?? zhCN.settings.notConfigured} />
              <GroupRow icon={UserRound} label={zhCN.settings.account} value={account ?? zhCN.settings.notSignedIn} />
              <GroupRow icon={KeyRound} label={zhCN.settings.loginMethod} value={loginMethodLabel(config?.loginMethod)} />
              <GroupRow icon={Cable} label={zhCN.settings.protocol} value="DSH Remote v1" />
            </GroupCard>

            <SectionTitle>{zhCN.settings.transport}</SectionTitle>
            <GroupCard>
              {transportPreferenceOptions().map((option, index) => {
                const chosen = option.value === preference
                return (
                  <GroupRow
                    key={option.value}
                    first={index === 0}
                    icon={index === 0 ? Route : undefined}
                    iconSpace
                    label={option.name}
                    detail={option.description}
                    selected={chosen}
                    chevron={false}
                    accessory={chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                    onPress={() => void setPreference(option.value)}
                  />
                )
              })}
            </GroupCard>
            <Text style={styles.preferenceNote}>{zhCN.settings.transportNote}</Text>

            <SectionTitle>{zhCN.settings.identity}</SectionTitle>
            <GroupCard>
              <GroupRow first icon={Smartphone} label={zhCN.settings.thisPhone} value={identity?.name ?? zhCN.settings.androidDevice} />
              <GroupRow icon={Hash} label={zhCN.settings.deviceId} value={shorten(identity?.deviceId)} />
              <GroupRow icon={Fingerprint} label={zhCN.settings.publicKey} value={fingerprint(identity?.publicKey)} />
            </GroupCard>
            <Text style={styles.preferenceNote}>{zhCN.settings.keyNote}</Text>

            <GroupCard style={styles.signOutCard}>
              <GroupRow first icon={LogOut} label={zhCN.settings.signOut} danger chevron={false} onPress={confirmSignOut} />
              <GroupRow icon={RotateCcw} label={zhCN.settings.resetLocal} danger chevron={false} onPress={confirmReset} />
            </GroupCard>
          </View>
        </Screen>
      </BlurHeaderFrame>
      <Modal visible={languagePickerOpen} transparent animationType="fade" onRequestClose={() => setLanguagePickerOpen(false)} statusBarTranslucent>
        <View style={styles.languageBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={zhCN.common.close} onPress={() => setLanguagePickerOpen(false)} />
          <View style={[styles.languageDialog, { maxHeight: sheetMaxHeight }]} accessibilityViewIsModal>
            <View style={styles.languageHeader}>
              <Text style={styles.languageTitle} accessibilityRole="header">{zhCN.settings.language}</Text>
              <IconButton label={zhCN.common.close} icon={X} onPress={() => setLanguagePickerOpen(false)} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.languageList}>
              <GroupCard>
                {languageOptions().map((option, index) => {
                  const chosen = option.value === languagePreference
                  return (
                    <GroupRow
                      key={option.value}
                      first={index === 0}
                      label={option.name}
                      selected={chosen}
                      chevron={false}
                      accessory={chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                      onPress={() => {
                        setLanguagePickerOpen(false)
                        void setLanguagePreference(option.value)
                      }}
                    />
                  )
                })}
              </GroupCard>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={densityPickerOpen} transparent animationType="fade" onRequestClose={() => setDensityPickerOpen(false)} statusBarTranslucent>
        <View style={styles.languageBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={zhCN.common.close} onPress={() => setDensityPickerOpen(false)} />
          <View style={[styles.languageDialog, { maxHeight: sheetMaxHeight }]} accessibilityViewIsModal>
            <View style={styles.languageHeader}>
              <Text style={styles.languageTitle} accessibilityRole="header">{zhCN.settings.typographyDensity}</Text>
              <IconButton label={zhCN.common.close} icon={X} onPress={() => setDensityPickerOpen(false)} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.languageList}>
              <GroupCard>
                {([
                  { value: 'standard' as const, name: zhCN.settings.densityStandard },
                  { value: 'compact' as const, name: zhCN.settings.densityCompact },
                ]).map((option, index) => {
                  const chosen = option.value === typographyDensity
                  return (
                    <GroupRow
                      key={option.value}
                      first={index === 0}
                      label={option.name}
                      selected={chosen}
                      chevron={false}
                      accessory={chosen ? <Check size={19} color={colors.primary} strokeWidth={2.2} /> : undefined}
                      onPress={() => {
                        setDensityPickerOpen(false)
                        void toggleTypographyDensity(option.value)
                      }}
                    />
                  )
                })}
              </GroupCard>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

/** Appearance choice drawn as a miniature page, as in the reference settings. */
function ThemeTile({ value, label, selected, onPress }: { value: ThemePreference; label: string; selected: boolean; onPress: () => void }) {
  const styles = useThemedStyles(createStyles)
  const light = lightColors
  const dark = darkColors
  const page = (palette: typeof lightColors) => (
    <View style={[StyleSheet.absoluteFill, styles.themeTilePage]}>
      <View style={[styles.themeTileLine, { width: '58%', backgroundColor: palette.subtle }]} />
      <View style={[styles.themeTileLine, { width: '38%', backgroundColor: palette.subtle, opacity: 0.6 }]} />
      <View style={[styles.themeTileDot, { backgroundColor: palette.primary }]} />
    </View>
  )
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.themeTile, pressed && { opacity: 0.8 }]}
    >
      <View style={[styles.themeTileFrame, selected && styles.themeTileFrameSelected]}>
        <View style={[styles.themeTileScreen, { backgroundColor: value === 'dark' ? dark.surface : light.surface }]}>
          {value !== 'system' && page(value === 'dark' ? dark : light)}
          {value === 'system' && <>
            {page(light)}
            <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 64" preserveAspectRatio="none">
              <Polygon points="100,0 100,64 0,64" fill={dark.surface} />
            </Svg>
            <View style={[styles.themeTileDot, { backgroundColor: dark.primary }]} />
          </>}
        </View>
      </View>
      <Text style={[styles.themeTileLabel, selected && styles.themeTileLabelSelected]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

export function HomeActionsMenu({ visible, onClose, onSettings, onAbout, onDevices, onRemoteHosts, onSwitchServer }: {
  visible: boolean
  onClose: () => void
  onSettings: () => void
  onAbout: () => void
  onDevices?: () => void
  onRemoteHosts?: () => void
  onSwitchServer?: () => void
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { phase, progress, checkForUpdates } = useUpdateCheck()
  const { height: windowHeight, landscape, compactHeight } = useResponsiveLayout()

  if (!visible) return null

  // Landscape phones are short: keep the fixed-position menu below the bar but
  // inside the window, and let its rows scroll if they still cannot all fit.
  const shortWindow = landscape || compactHeight
  const menuTop = insets.top + (shortWindow ? 48 : 56)
  const menuMaxHeight = Math.max(120, windowHeight - menuTop - insets.bottom - spacing.xs)

  return (
    <View style={styles.homeMenuLayer} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={zhCN.common.close}
        onPress={onClose}
        pointerEvents="box-only"
        style={styles.homeMenuDismiss}
      />
      <View accessibilityRole="menu" style={[styles.homeMenuCard, { top: menuTop, maxHeight: menuMaxHeight }]} pointerEvents="box-none">
        <ScrollView style={styles.homeMenuScroll} bounces={false} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {onDevices !== undefined && (
            <HomeMenuRow icon={Laptop} label={zhCN.devices.myDevices} onPress={onDevices} />
          )}
          {onRemoteHosts !== undefined && (
            <HomeMenuRow icon={SlidersHorizontal} label={zhCN.remoteHosts.title} onPress={onRemoteHosts} />
          )}
          {onSwitchServer !== undefined && <HomeMenuRow icon={RotateCcw} label={zhCN.setup.switchServer} onPress={onSwitchServer} />}
          <HomeMenuRow icon={Settings} label={zhCN.settings.title} onPress={onSettings} />
          <HomeMenuRow icon={Info} label={zhCN.settings.about} onPress={onAbout} />
          <HomeMenuRow
            icon={Download}
            label={zhCN.settings.checkUpdates}
            subtitle={phase === 'checking'
              ? zhCN.settings.checkingUpdates
              : phase === 'downloading'
                ? progress === null ? zhCN.settings.downloadingUpdate : `${zhCN.settings.downloadingUpdate} ${progress}%`
                : undefined}
            onPress={() => void checkForUpdates()}
            disabled={phase !== 'idle'}
            last
          />
        </ScrollView>
      </View>
    </View>
  )
}

function useUpdateCheck() {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'downloading'>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const appVersion = Application.nativeApplicationVersion ?? ''

  const checkForUpdates = async () => {
    if (phase !== 'idle') return
    setPhase('checking')
    try {
      const response = await fetch(releaseApiUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const release = await response.json() as {
        tag_name?: unknown
        assets?: Array<{ name?: unknown; browser_download_url?: unknown }>
      }
      const latest = String(release.tag_name ?? '').replace(/^v/i, '')
      const apkAsset = Array.isArray(release.assets)
        ? release.assets.find(asset => typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.apk'))
        : undefined
      const downloadUrl = typeof apkAsset?.browser_download_url === 'string' ? apkAsset.browser_download_url : undefined
      setPhase('idle')
      if (latest !== '' && isNewerVersion(latest, appVersion)) {
        Alert.alert(
          zhCN.settings.updateFoundTitle,
          zhCN.settings.updateFoundBody(latest, appVersion),
          [
            { text: zhCN.common.cancel, style: 'cancel' },
            downloadUrl !== undefined
              ? { text: zhCN.settings.downloadUpdate, onPress: () => void downloadAndInstall(downloadUrl) }
              : { text: zhCN.settings.openUpdates, onPress: () => void Linking.openURL(updateUrl) },
          ],
        )
      } else {
        Alert.alert(zhCN.settings.upToDateTitle, zhCN.settings.upToDateBody)
      }
    } catch {
      setPhase('idle')
      Alert.alert(zhCN.settings.checkFailedTitle, zhCN.settings.checkFailedBody)
    }
  }

  const downloadAndInstall = async (url: string) => {
    setPhase('downloading')
    setProgress(null)
    try {
      const destination = new File(Paths.cache, 'dsh-remote-latest.apk')
      const file = await File.downloadFileAsync(url, destination, {
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) setProgress(Math.round((bytesWritten / totalBytes) * 100))
        },
      })
      try {
        const contentUri = await getContentUriAsync(file.uri)
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          type: 'application/vnd.android.package-archive',
          flags: 1 | 2, // FLAG_ACTIVITY_NEW_TASK | FLAG_GRANT_READ_URI_PERMISSION
        })
      } catch {
        const applicationId = Application.applicationId
        Alert.alert(
          zhCN.settings.installFailedTitle,
          zhCN.settings.installFailedBody,
          applicationId === null
            ? [{ text: zhCN.common.close }]
            : [
                { text: zhCN.common.cancel, style: 'cancel' },
                {
                  text: zhCN.settings.openInstallSettings,
                  onPress: () => void IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
                    data: `package:${applicationId}`,
                  }),
                },
              ],
        )
      }
    } catch {
      Alert.alert(zhCN.settings.downloadFailedTitle, zhCN.settings.downloadFailedBody)
    } finally {
      setPhase('idle')
      setProgress(null)
    }
  }

  return { phase, progress, checkForUpdates }
}

function HomeMenuRow({ icon: Icon, label, subtitle, onPress, disabled = false, last = false }: {
  icon: LucideIcon
  label: string
  subtitle?: string
  onPress: () => void
  disabled?: boolean
  last?: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.homeMenuRow,
        !last && styles.homeMenuRowBorder,
        pressed && !disabled && styles.homeMenuRowPressed,
        disabled && styles.homeMenuRowDisabled,
      ]}
    >
      <View style={styles.homeMenuRowIcon}><Icon size={20} color={colors.ink} strokeWidth={1.8} /></View>
      <View style={styles.homeMenuRowCopy}>
        <Text style={styles.homeMenuRowLabel}>{label}</Text>
        {subtitle !== undefined && <Text style={styles.homeMenuRowSubtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {disabled
        ? <ActivityIndicator size="small" color={colors.primary} />
        : null}
    </Pressable>
  )
}

function isNewerVersion(latest: string, current: string): boolean {
  const parse = (value: string): number[] => value.split('.').map(Number)
  const parseable = (parts: number[]) => parts.length > 0 && parts.every(part => Number.isFinite(part))
  const a = parse(latest)
  const b = parse(current)
  if (!parseable(a)) return false
  if (!parseable(b)) return true // installed version is unknown; assume an update is available
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export function AboutScreen({ onBack }: { onBack: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const appVersion = Application.nativeApplicationVersion ?? zhCN.common.unavailable
  const buildVersion = Application.nativeBuildVersion
  const versionLabel = buildVersion === null ? appVersion : `${appVersion} (${buildVersion})`

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame header={<TopBar title={zhCN.settings.about} onBack={onBack} />}>
        <Screen>
          <View style={styles.aboutHero}>
            <Image source={require('../../assets/icon.png')} style={styles.aboutLogo} resizeMode="contain" />
            <Text style={styles.aboutProductName}>DS Harness Remote</Text>
            <Text style={styles.aboutVersion}>{versionLabel}</Text>
          </View>

          <View style={styles.group}>
            <SettingsLink label={zhCN.settings.developer} value={zhCN.settings.developerValue} url={developerUrl} />
            <SettingsLink label={zhCN.settings.twitter} url={twitterUrl} />
            <SettingsLink label={zhCN.settings.sourceCodeUrl} url={SOURCE_CODE_URL} />
            <SettingsLink label={zhCN.settings.updateUrl} url={updateUrl} />
          </View>
        </Screen>
      </BlurHeaderFrame>
    </View>
  )
}

function SettingsLink({ label, url, value }: { label: string; url: string; value?: string }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const open = async () => {
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(zhCN.settings.linkFailedTitle, zhCN.settings.linkFailedBody)
    }
  }

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}：${value ?? url}`}
      onPress={() => void open()}
      style={({ pressed }) => [styles.settingsLink, pressed && styles.settingsLinkPressed]}
    >
      <View style={styles.settingsLinkCopy}>
        <Text style={styles.settingsLinkLabel}>{label}</Text>
        <Text style={styles.settingsLinkUrl}>{value ?? url}</Text>
      </View>
      <ExternalLink size={18} color={colors.primary} />
    </Pressable>
  )
}

function shorten(value?: string): string {
  if (value === undefined) return zhCN.common.unavailable
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value
}

function fingerprint(value?: string): string {
  if (value === undefined || value.length === 0) return zhCN.common.unavailable
  return value.slice(0, 24).toUpperCase().match(/.{1,4}/g)?.join(' ') ?? value
}

function languageOptions(): Array<{ value: LanguagePreference; name: string }> {
  return [
    { value: 'system', name: zhCN.settings.languageSystem },
    { value: 'zh-CN', name: zhCN.settings.languageChinese },
    { value: 'en-US', name: zhCN.settings.languageEnglish },
    { value: 'ja-JP', name: '日本語' },
    { value: 'zh-TW', name: '繁體中文' },
    { value: 'es-ES', name: 'Español' },
    { value: 'de-DE', name: 'Deutsch' },
    { value: 'fr-FR', name: 'Français' },
  ]
}

function themeOptions(): Array<{ value: ThemePreference; name: string }> {
  return [
    { value: 'light', name: zhCN.settings.themeLight },
    { value: 'dark', name: zhCN.settings.themeDark },
    { value: 'system', name: zhCN.settings.themeSystem },
  ]
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  // Reading cap for wide landscape tablets; the live width style is applied by
  // the screens that opt in (portrait phones never exceed the cap).
  contentColumn: { width: '100%', alignSelf: 'center' },
  hero: { width: '100%', maxWidth: 400, alignSelf: 'center', alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.lg },
  wordmarkRow: { alignItems: 'center', marginTop: spacing.md },
  wordmark: { fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.6, color: colors.ink },
  wordmarkSub: { ...type.caption, color: colors.muted, letterSpacing: 2, marginTop: 2, fontWeight: '600' },
  heroLead: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: spacing.xs, maxWidth: 340 },
  loginCard: { width: '100%', maxWidth: 400, alignSelf: 'center', marginTop: spacing.xxl, gap: spacing.sm, paddingHorizontal: spacing.lg },
  loginLoading: { minHeight: 172, alignItems: 'center', justifyContent: 'center' },
  providerButton: { minHeight: 52, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 52, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  providerIcon: { position: 'absolute', left: spacing.md + 2, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  providerButtonText: { ...type.smallStrong, fontSize: 16, color: colors.ink },
  providerButtonPressed: { opacity: 0.7 },
  providerButtonDisabled: { opacity: 0.5 },
  oauthHint: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: spacing.xxs },
  passwordHint: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: spacing.xs },
  retryRow: { alignSelf: 'stretch' },
  orDivider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  orText: { ...type.caption, color: colors.muted },
  altRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xxs },
  altButton: { flexGrow: 1, flexBasis: 'auto', minHeight: 44, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, backgroundColor: colors.surfaceStrong },
  altButtonText: { ...type.smallStrong, color: colors.ink },
  emailForm: { gap: spacing.sm },
  loginInput: { minHeight: 50, borderRadius: radius.md, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceStrong, color: colors.ink, fontSize: 16 },
  emailSubmit: { minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xxs, backgroundColor: colors.surfaceStrong },
  emailSubmitReady: { backgroundColor: colors.primary },
  emailSubmitText: { ...type.smallStrong, fontSize: 16, color: colors.muted },
  emailSubmitTextReady: { color: colors.white },
  textLink: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
  textLinkLabel: { ...type.smallStrong, color: colors.primary },
  textLinkDisabled: { opacity: 0.5 },
  loginFooter: { marginTop: 'auto', paddingTop: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  loginCredit: { ...type.caption, color: colors.muted },
  loginCreditLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  loginCreditName: { ...type.caption, color: colors.primary, textDecorationLine: 'underline' },
  lead: { ...type.body, color: colors.muted, marginTop: spacing.sm },
  form: { marginTop: spacing.xxl, gap: spacing.md },
  methodTabs: { flexDirection: 'row', padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceStrong },
  methodTab: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  methodTabActive: { backgroundColor: colors.surface },
  methodTabText: { ...type.smallStrong, color: colors.muted },
  methodTabTextActive: { color: colors.primary },
  serverActions: { flexDirection: 'row', gap: spacing.sm },
  serverBackdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.modalBackdrop },
  serverDialog: { width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  serverDialogContent: { gap: spacing.md },
  serverDialogTitle: { ...type.heading, color: colors.ink },
  serverLabel: { ...type.smallStrong, color: colors.muted },
  formLarge: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  qrPanel: { alignItems: 'center', gap: spacing.md },
  qrTitle: { ...type.heading, fontSize: 18, color: colors.ink, textAlign: 'center' },
  qrSegment: { flex: 1, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.sm, paddingHorizontal: spacing.sm },
  qrFrame: { width: 264, height: 264, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', padding: spacing.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border },
  qrActions: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  qrHint: { ...type.caption, color: colors.muted, textAlign: 'center', maxWidth: 420 },
  qrMessage: { ...type.small, color: colors.muted, textAlign: 'center', maxWidth: 420 },
  securityNoteLarge: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  securityNote: { gap: spacing.xs, paddingVertical: spacing.md, marginTop: spacing.xxxl },
  securityHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  securityTitle: { ...type.smallStrong, color: colors.ink },
  securityBody: { ...type.small, color: colors.muted, marginTop: 2 },
  groupLabel: { ...type.small, fontSize: 15, color: colors.muted, marginTop: spacing.xl, marginBottom: spacing.xs, paddingLeft: spacing.md },
  group: { borderRadius: radius.xl, backgroundColor: colors.grouped, paddingHorizontal: spacing.md },
  preferenceList: { gap: spacing.xs },
  preferenceOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  preferenceAction: { minHeight: 48 },
  preferenceActionPressed: { backgroundColor: colors.surfaceStrong },
  preferenceError: { ...type.caption, color: colors.danger },
  preferenceOptionChosen: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  permissionOption: { minHeight: 48 },
  preferenceCopy: { flex: 1 },
  preferenceName: { ...type.smallStrong, color: colors.ink },
  languageName: { flex: 1 },
  preferenceDescription: { ...type.caption, color: colors.muted, marginTop: 2 },
  preferenceNote: { ...type.caption, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: spacing.xs, paddingHorizontal: spacing.md },
  appearanceSegments: { marginBottom: spacing.xs },
  segmentRow: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceStrong },
  segmentButton: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, paddingHorizontal: spacing.xs },
  segmentButtonActive: { backgroundColor: colors.surface, ...floatingShadow(colors) },
  segmentButtonText: { ...type.small, fontSize: 15, color: colors.muted, textAlign: 'center' },
  segmentButtonTextActive: { color: colors.ink, fontWeight: '600' },
  keyNote: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.md },
  accountPill: { marginTop: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.xl, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, gap: 3 },
  accountPillTitle: { ...type.bodyStrong, fontSize: 17, color: colors.ink },
  accountPillMeta: { ...type.small, fontSize: 13, color: colors.muted },
  settingsGap: { marginTop: spacing.sm },
  themeCard: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md },
  themeTiles: { flexDirection: 'row', gap: spacing.sm },
  themeTile: { flex: 1, alignItems: 'center', gap: spacing.xs },
  themeTileFrame: { alignSelf: 'stretch', padding: 3, borderRadius: radius.lg + 2, borderWidth: 2, borderColor: 'transparent' },
  themeTileFrameSelected: { borderColor: colors.primary },
  themeTileScreen: { aspectRatio: 1.55, borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  themeTilePage: { padding: 10, gap: 5 },
  themeTileLine: { height: 4, borderRadius: 2 },
  themeTileDot: { position: 'absolute', right: 10, bottom: 10, width: 12, height: 12, borderRadius: 6 },
  themeTileLabel: { ...type.small, fontSize: 15, color: colors.ink },
  themeTileLabelSelected: { color: colors.primary, fontWeight: '600' },
  densityRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md, paddingRight: spacing.md, paddingTop: spacing.md },
  densityIcon: { width: 28, marginRight: spacing.sm, alignItems: 'center' },
  densityCopy: { flex: 1, gap: 2 },
  densityLabel: { ...type.body, fontSize: 16, color: colors.ink },
  densityNote: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted },
  densitySegments: { marginRight: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md, marginLeft: 56 },
  signOutCard: { marginTop: spacing.xxl },
  keyNoteText: { ...type.small, color: colors.muted, flex: 1 },
  settingsLink: { minHeight: 68, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  settingsLinkPressed: { opacity: 0.68 },
  settingsLinkCopy: { flex: 1, gap: 3 },
  settingsLinkLabel: { ...type.smallStrong, color: colors.ink },
  settingsLinkUrl: { ...type.caption, color: colors.primary },
  homeMenuLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
  homeMenuDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.menuDismiss },
  homeMenuCard: { position: 'absolute', right: spacing.md, width: 260, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, zIndex: 1, ...floatingShadow(colors, 'high') },
  // flexGrow 0 keeps the card content-sized in portrait; flexShrink lets the
  // capped landscape card scroll instead of clipping its last row.
  homeMenuScroll: { flexGrow: 0, flexShrink: 1 },
  homeMenuRow: { minHeight: 52, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg },
  homeMenuRowBorder: {},
  homeMenuRowPressed: { backgroundColor: colors.surfaceStrong },
  homeMenuRowDisabled: { opacity: 0.6 },
  homeMenuRowIcon: { width: 24, alignItems: 'center', justifyContent: 'center' },
  homeMenuRowCopy: { flex: 1 },
  homeMenuRowLabel: { ...type.body, color: colors.ink },
  homeMenuRowSubtitle: { ...type.caption, color: colors.muted, marginTop: 1 },
  aboutHero: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.xs },
  aboutLogo: { width: 84, height: 84, borderRadius: radius.xl, marginBottom: spacing.sm },
  aboutProductName: { ...type.title, color: colors.ink, textAlign: 'center' },
  aboutVersion: { ...type.small, color: colors.muted, textAlign: 'center' },
  resetArea: { marginTop: spacing.xxxl },
  resetGap: { height: spacing.sm },
  languageBackdrop: { flex: 1, backgroundColor: colors.modalBackdrop, justifyContent: 'flex-end' },
  languageDialog: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
    ...floatingShadow(colors, 'high'),
  },
  languageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.xs },
  languageTitle: { ...type.heading, fontSize: 18, color: colors.ink, fontWeight: '700' },
  languageList: { paddingBottom: spacing.md },
  })
}
