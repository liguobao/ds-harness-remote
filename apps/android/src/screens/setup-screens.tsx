import { useEffect, useRef, useState } from 'react'
import { useBrowseMemory, browsePreference } from '../services/browse-memory'
import * as Application from 'expo-application'
import { File, Paths } from 'expo-file-system'
import { getContentUriAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Check, ChevronRight, Download, ExternalLink, Info, KeyRound, Laptop, LockKeyhole, MoreVertical, QrCode as QrCodeIcon, RotateCcw, Settings, type LucideIcon } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import type { QrLoginStart } from '../state/store-state'
import { SOURCE_CODE_URL } from '../lib/links'
import { foregroundService } from '../services/foreground-service'
import type { OAuthProviderInfo } from '../services/api'
import { BlurHeaderFrame, Button, Field, IconButton, KeyValue, Screen, TopBar } from '../ui/components'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { transportPreferenceOptions } from '../types'
import type { DefaultPermissionPreset, LoginMethod } from '../types'
import { QrCode } from '../ui/qr-code'
import { radius, spacing, type } from '../ui/theme'
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
  const oauthBusy = useAppStore(state => state.busyAction === 'oauth')
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
  const [loginMethod, setLoginMethod] = useState<SetupLoginMethod>('oauth')
  const [showQr, setShowQr] = useState(false)
  const [loginProviders, setLoginProviders] = useState<OAuthProviderInfo[]>([])
  const [providersPhase, setProvidersPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [providerReload, setProviderReload] = useState(0)
  const availableMethods: SetupLoginMethod[] = (['oauth', 'github-oauth', 'google-oauth'] as const)
    .filter(method => loginProviders.some(provider => provider.id === qrProviderFor(method)))
  availableMethods.push('password')
  const supportsQr = loginProviders.some(provider => provider.id === qrProviderFor(loginMethod) && provider.qrStartUrl !== undefined)

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
        setProvidersPhase('failed')
        setLoginMethod('password')
        return
      }
      setLoginProviders(result.providers)
      setProvidersPhase('ready')
      setLoginMethod(current => current === 'password' || result.providers.some(provider => provider.id === qrProviderFor(current))
        ? current
        : (['oauth', 'github-oauth', 'google-oauth'] as const).find(method => result.providers.some(provider => provider.id === qrProviderFor(method))) ?? 'password')
    })
    return () => { cancelled = true }
  }, [serverUrl, providerReload, listLoginProviders])

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
    if (method === 'password') setShowQr(false)
    else if (showQr) void refreshQr(method)
  }

  const toggleQr = () => {
    qrRun.current += 1
    setShowQr(!showQr)
    setQrLogin(undefined)
    setQrPhase('idle')
    if (!showQr) void refreshQr()
  }

  const qrContent = !showQr ? null : (
    <View style={styles.qrPanel}>
      <Text style={styles.qrTitle}>{loginMethodLabel(loginMethod)} · {zhCN.setup.qrScanTitle}</Text>
      {qrPhase === 'loading'
        ? <View style={styles.qrPlaceholder}><ActivityIndicator color={colors.primary} accessibilityLabel={zhCN.setup.qrWaiting} /></View>
        : qrPhase === 'unsupported'
          ? <Text style={styles.qrMessage}>{zhCN.setup.qrUnsupported}</Text>
          : qrPhase === 'failed'
            ? <Text style={styles.qrMessage}>{zhCN.setup.qrFailed}</Text>
            : qrPhase === 'expired'
              ? <Text style={styles.qrMessage}>{zhCN.setup.qrExpired}</Text>
              : qrLogin !== undefined
                ? <QrCode
                    value={qrLogin.session.scanUrl}
                    size={largeScreen ? 260 : 200}
                    label={`${zhCN.setup.qrScanTitle}. ${zhCN.setup.qrScanHint}`}
                  />
                : null}
      {qrPhase === 'waiting' && <Text style={styles.qrHint}>{zhCN.setup.qrScanHint}</Text>}
      {qrPhase === 'expired' && <Text style={styles.qrHint}>{zhCN.setup.qrScanHint}</Text>}
      <Button
        label={zhCN.setup.qrRefresh}
        variant="secondary"
        onPress={() => void refreshQr()}
        loading={qrPhase === 'loading'}
        disabled={busy || serverDirty}
      />
    </View>
  )

  const credentialContent = loginMethod === 'oauth'
    ? <>
        <Button label={zhCN.setup.zhihu} onPress={() => void signInWithZhihu()} loading={oauthBusy} disabled={busy || serverDirty} />
        <Text style={styles.oauthHint}>{zhCN.setup.oauthHint}</Text>
      </>
    : loginMethod === 'github-oauth'
      ? <>
          <Button label={zhCN.setup.github} onPress={() => void signInWithGithub()} loading={oauthBusy} disabled={busy || serverDirty} />
          <Text style={styles.oauthHint}>{zhCN.setup.oauthHint}</Text>
        </>
      : loginMethod === 'google-oauth'
        ? <>
            <Button label={zhCN.setup.google} onPress={() => void signInWithGoogle()} loading={oauthBusy} disabled={busy || serverDirty} />
            <Text style={styles.oauthHint}>{zhCN.setup.oauthHint}</Text>
          </>
      : <>
          <Field label={zhCN.setup.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" placeholder={zhCN.setup.emailPlaceholder} />
          <Field label={zhCN.setup.password} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" returnKeyType="go" onSubmitEditing={() => { if (canSubmit) void submit() }} placeholder={zhCN.setup.passwordPlaceholder} hint={zhCN.setup.passwordHint} />
          <Button label={zhCN.setup.title} onPress={() => void submit()} loading={busy} disabled={!canSubmit || serverDirty} />
        </>

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame header={<TopBar title="DSH Remote" onBack={onBack} action={<IconButton label={zhCN.settings.more} icon={MoreVertical} onPress={onMore} />} />}>
        <Screen fill>
          <View style={styles.loginIntro}>
            <Text style={styles.lead}>{zhCN.setup.lead}</Text>
          </View>

          <View style={[styles.form, largeScreen && styles.formLarge]}>
            <View style={styles.methodTabs}>
              {availableMethods.map(method => (
                <Pressable key={method} accessibilityRole="tab" accessibilityState={{ selected: loginMethod === method, disabled: busy }} disabled={busy} onPress={() => chooseLoginMethod(method)} style={[styles.methodTab, loginMethod === method && styles.methodTabActive]}>
                  <Text style={[styles.methodTabText, loginMethod === method && styles.methodTabTextActive]} numberOfLines={1}>{loginMethodLabel(method)}</Text>
                </Pressable>
              ))}
            </View>

            {supportsQr && !serverDirty && providersPhase === 'ready' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showQr ? loginMethodLabel(loginMethod) : zhCN.setup.qr}
                accessibilityState={{ expanded: showQr, disabled: busy || serverDirty }}
                disabled={busy || serverDirty}
                onPress={toggleQr}
                style={({ pressed }) => [styles.qrEntry, pressed && styles.qrEntryPressed]}
              >
                <QrCodeIcon size={22} color={colors.primary} />
                <View style={styles.qrEntryCopy}>
                  <Text style={styles.qrEntryText}>{showQr ? (loginMethod === 'oauth' ? zhCN.setup.zhihu : loginMethod === 'github-oauth' ? zhCN.setup.github : zhCN.setup.google) : zhCN.setup.qr}</Text>
                  <Text style={styles.qrEntryHint}>{showQr ? zhCN.setup.oauthHint : zhCN.setup.qrEntryHint}</Text>
                </View>
                <ChevronRight size={16} color={colors.muted} />
              </Pressable>
            )}

            {providersPhase === 'loading'
              ? <ActivityIndicator color={colors.primary} />
              : <>
                  {providersPhase === 'failed' && <Button label={zhCN.common.retry} variant="secondary" onPress={() => setProviderReload(value => value + 1)} />}
                  {qrContent ?? credentialContent}
                </>}


          </View>

          <View style={[styles.securityNote, largeScreen && styles.securityNoteLarge]}>
            <View style={styles.securityHeading}>
              <LockKeyhole size={20} color={colors.primary} />
              <Text style={styles.securityTitle}>{zhCN.setup.trustTitle}</Text>
            </View>
            <Text style={styles.securityBody}>{zhCN.setup.trustBody}</Text>
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
                }} editable={!busy && !oauthBusy} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint={zhCN.setup.switchServerHint} placeholder="https://remote.example.com" />
                {serverError !== undefined && <Text accessibilityRole="alert" style={styles.preferenceError}>{serverError}</Text>}
                <View style={styles.serverActions}>
                  <View style={styles.flex}>
                    <Button label={zhCN.setup.saveServer} onPress={() => void saveServer()} loading={busy} disabled={oauthBusy || !serverDirty || serverDraft.trim() === ''} />
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
  const [allLanguagesVisible, setAllLanguagesVisible] = useState(false)
  const showAllLanguages = allLanguagesVisible || !['system', 'zh-CN', 'en-US'].includes(languagePreference)
  const themePreference = useAppStore(state => state.themePreference)
  const setThemePreference = useAppStore(state => state.setThemePreference)
  const typographyDensity = useAppStore(state => state.typographyDensity)
  const setTypographyDensity = useAppStore(state => state.setTypographyDensity)
  const [densitySaving, setDensitySaving] = useState(false)
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
  const { contentMaxWidth, landscape } = useResponsiveLayout()

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

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame header={<TopBar title={zhCN.settings.title} onBack={onBack} />}>
        <Screen>
          <View style={[styles.contentColumn, landscape && { maxWidth: contentMaxWidth }]}>
            <Text style={styles.groupLabel}>{zhCN.settings.language}</Text>
            <View style={styles.preferenceList}>
              {languageOptions().filter((_, index) => showAllLanguages || index < 3).map(option => {
                const chosen = option.value === languagePreference
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    onPress={() => void setLanguagePreference(option.value)}
                    style={[styles.preferenceOption, styles.preferenceAction, chosen && styles.preferenceOptionChosen]}
                  >
                    <Text style={[styles.preferenceName, styles.languageName]}>{option.name}</Text>
                    {chosen && <Check size={17} color={colors.primary} />}
                  </Pressable>
                )
              })}
              {!showAllLanguages && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={zhCN.settings.languageShowAll}
                  accessibilityState={{ expanded: false }}
                  onPress={() => setAllLanguagesVisible(true)}
                  style={[styles.preferenceOption, styles.preferenceAction]}
                >
                  <Text style={styles.preferenceName}>More ...</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.groupLabel}>{zhCN.settings.appearance}</Text>
            <View style={[styles.segmentRow, styles.appearanceSegments]} accessibilityRole="tablist">
              {themeOptions().map(option => {
                const chosen = option.value === themePreference
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: chosen }}
                    onPress={() => void setThemePreference(option.value)}
                    style={[styles.segmentButton, chosen && styles.segmentButtonActive]}
                  >
                    <Text style={[styles.segmentButtonText, chosen && styles.segmentButtonTextActive]} numberOfLines={1}>
                      {option.name}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={styles.preferenceList}>
              <View style={styles.preferenceOption}>
                <View style={styles.preferenceCopy}>
                  <Text style={styles.preferenceName}>{zhCN.settings.typographyDensity}</Text>
                  <Text style={styles.preferenceDescription}>{zhCN.settings.typographyDensityNote}</Text>
                </View>
              </View>
            </View>
            <View style={[styles.segmentRow, styles.appearanceSegments]} accessibilityRole="tablist">
              {([
                { value: 'standard' as const, name: zhCN.settings.densityStandard },
                { value: 'compact' as const, name: zhCN.settings.densityCompact },
              ]).map(option => {
                const chosen = option.value === typographyDensity
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: chosen }}
                    onPress={() => void toggleTypographyDensity(option.value)}
                    style={[styles.segmentButton, chosen && styles.segmentButtonActive]}
                  >
                    <Text style={[styles.segmentButtonText, chosen && styles.segmentButtonTextActive]} numberOfLines={1}>
                      {option.name}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={styles.preferenceList}>
              <View style={styles.preferenceOption}>
                <Text style={[styles.preferenceName, styles.languageName]}>{zhCN.settings.statusBar}</Text>
                <Switch
                  accessibilityLabel={zhCN.settings.statusBar}
                  value={statusBarVisible}
                  disabled={statusBarSaving}
                  onValueChange={visible => void toggleStatusBar(visible)}
                  trackColor={{ false: colors.disabled, true: colors.primary }} thumbColor={colors.white}
                />
              </View>
            </View>

            <Text style={styles.groupLabel}>{zhCN.comfort.continueWork}</Text>
            <View style={styles.preferenceList}>
              <View style={styles.preferenceOption}>
                <Text style={[styles.preferenceName, styles.languageName]}>{zhCN.comfort.resume}</Text>
                <Switch accessibilityLabel={zhCN.comfort.resume} value={comfort.resume}
                  onValueChange={resume => browsePreference({ resume })} trackColor={{ false: colors.disabled, true: colors.primary }} thumbColor={colors.white} />
              </View>
              <View style={styles.preferenceOption}>
                <View style={styles.preferenceCopy}>
                  <Text style={styles.preferenceName}>{zhCN.settings.compactHistory}</Text>
                  <Text style={styles.preferenceDescription}>{zhCN.settings.compactHistoryNote}</Text>
                </View>
                <Switch accessibilityLabel={zhCN.settings.compactHistory} value={compactHistory}
                  disabled={compactSaving} onValueChange={value => void toggleCompactHistory(value)}
                  trackColor={{ false: colors.disabled, true: colors.primary }} thumbColor={colors.white} />
              </View>
              <View style={styles.preferenceOption}>
                <View style={styles.preferenceCopy}>
                  <Text style={styles.preferenceName}>{zhCN.comfort.notifications}</Text>
                  <Text style={styles.preferenceDescription}>{zhCN.comfort.notificationsNote}</Text>
                </View>
                <Switch accessibilityLabel={zhCN.comfort.notifications} value={comfort.notifications}
                  onValueChange={notifications => browsePreference({ notifications })} trackColor={{ false: colors.disabled, true: colors.primary }} thumbColor={colors.white} />
              </View>
              <Pressable accessibilityRole="button" onPress={() => void openNotificationSettings()}
                style={({ pressed }) => [styles.preferenceOption, styles.preferenceAction, pressed && styles.preferenceActionPressed]}>
                <Text style={[styles.preferenceName, styles.languageName]}>{zhCN.comfort.systemNotifications}</Text>
                <ExternalLink size={17} color={colors.muted} />
              </Pressable>
              {Platform.OS === 'android' && (
                <Pressable
                  accessibilityRole="button"
                  onPress={async () => {
                    const ok = await foregroundService.requestIgnoreBatteryOptimizations()
                    if (!ok) {
                      Alert.alert(
                        zhCN.comfort.batteryOptimization,
                        zhCN.comfort.batteryOptimizationFailed,
                      )
                    }
                  }}
                  style={({ pressed }) => [styles.preferenceOption, styles.preferenceAction, pressed && styles.preferenceActionPressed]}
                >
                  <View style={styles.preferenceCopy}>
                    <Text style={[styles.preferenceName, styles.languageName]}>{zhCN.comfort.batteryOptimization}</Text>
                    <Text style={styles.preferenceDescription}>{zhCN.comfort.batteryOptimizationDescription}</Text>
                  </View>
                  <ExternalLink size={17} color={colors.muted} />
                </Pressable>
              )}
              {comfort.error !== undefined && <Text style={styles.preferenceError} accessibilityRole="alert">{comfort.error}</Text>}
            </View>

            <Text style={styles.groupLabel}>{zhCN.settings.defaultPermission}</Text>
            <View style={styles.preferenceList} accessibilityRole="radiogroup">
              {([
                { value: 'default', name: zhCN.settings.defaultPermissionHost, description: zhCN.settings.defaultPermissionHostDescription },
                { value: 'workspace-write', name: zhCN.chat.permissionWorkspaceWrite, description: zhCN.chat.permissionWorkspaceWriteDescription },
                { value: 'danger-full-access', name: zhCN.chat.permissionFullAccess, description: zhCN.chat.permissionFullAccessDescription },
              ] satisfies Array<{ value: DefaultPermissionPreset; name: string; description: string }>).map(option => {
                const chosen = option.value === defaultPermission
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: chosen, disabled: permissionSaving }}
                    disabled={permissionSaving}
                    onPress={() => pickDefaultPermission(option.value)}
                    style={[styles.preferenceOption, styles.permissionOption, chosen && styles.preferenceOptionChosen]}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={styles.preferenceName}>{option.name}</Text>
                      <Text style={styles.preferenceDescription}>{option.description}</Text>
                    </View>
                    {chosen && <Check size={17} color={colors.primary} />}
                  </Pressable>
                )
              })}
              <Text style={styles.preferenceNote}>{zhCN.settings.defaultPermissionNote}</Text>
            </View>

            <Text style={styles.groupLabel}>{zhCN.settings.connection}</Text>
            <View style={styles.group}>
              <KeyValue label={zhCN.settings.server} value={config?.baseUrl ?? zhCN.settings.notConfigured} />
              <KeyValue label={zhCN.settings.account} value={account ?? zhCN.settings.notSignedIn} />
              <KeyValue label={zhCN.settings.loginMethod} value={loginMethodLabel(config?.loginMethod)} />
              <KeyValue label={zhCN.settings.protocol} value="DSH Remote v1" />
            </View>

            <Text style={styles.groupLabel}>{zhCN.settings.transport}</Text>
            <View style={styles.preferenceList}>
              {transportPreferenceOptions().map(option => {
                const chosen = option.value === preference
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    onPress={() => void setPreference(option.value)}
                    style={[styles.preferenceOption, chosen && styles.preferenceOptionChosen]}
                  >
                    <View style={styles.preferenceCopy}>
                      <Text style={styles.preferenceName}>{option.name}</Text>
                      <Text style={styles.preferenceDescription}>{option.description}</Text>
                    </View>
                    {chosen && <Check size={17} color={colors.primary} />}
                  </Pressable>
                )
              })}
              <Text style={styles.preferenceNote}>{zhCN.settings.transportNote}</Text>
            </View>

            <Text style={styles.groupLabel}>{zhCN.settings.identity}</Text>
            <View style={styles.group}>
              <KeyValue label={zhCN.settings.thisPhone} value={identity?.name ?? zhCN.settings.androidDevice} />
              <KeyValue label={zhCN.settings.deviceId} value={shorten(identity?.deviceId)} mono />
              <KeyValue label={zhCN.settings.publicKey} value={fingerprint(identity?.publicKey)} mono />
              <View style={styles.keyNote}><KeyRound size={17} color={colors.muted} /><Text style={styles.keyNoteText}>{zhCN.settings.keyNote}</Text></View>
            </View>

            <View style={styles.resetArea}>
              <Button label={zhCN.settings.signOut} variant="secondary" onPress={confirmSignOut} />
              <View style={styles.resetGap} />
              <Button label={zhCN.settings.resetLocal} icon={RotateCcw} variant="danger" onPress={confirmReset} />
            </View>
          </View>
        </Screen>
      </BlurHeaderFrame>
    </View>
  )
}

export function HomeActionsMenu({ visible, onClose, onSettings, onAbout, onDevices, onSwitchServer }: {
  visible: boolean
  onClose: () => void
  onSettings: () => void
  onAbout: () => void
  onDevices?: () => void
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
      <View style={styles.homeMenuRowIcon}><Icon size={19} color={colors.primary} /></View>
      <View style={styles.homeMenuRowCopy}>
        <Text style={styles.homeMenuRowLabel}>{label}</Text>
        {subtitle !== undefined && <Text style={styles.homeMenuRowSubtitle} numberOfLines={1}>{subtitle}</Text>}
      </View>
      {disabled
        ? <ActivityIndicator size="small" color={colors.primary} />
        : <ChevronRight size={20} color={colors.subtle} />}
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
  loginIntro: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingTop: spacing.xl },
  loginFooter: { marginTop: 'auto', paddingTop: spacing.xxl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
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
  oauthHint: { ...type.caption, color: colors.muted, textAlign: 'center' },
  formLarge: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  qrEntry: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  qrEntryPressed: { backgroundColor: colors.surfaceStrong },
  qrEntryCopy: { flex: 1, gap: 2 },
  qrEntryText: { ...type.smallStrong, color: colors.ink },
  qrEntryHint: { ...type.caption, color: colors.muted },
  qrPanel: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  qrTitle: { ...type.heading, color: colors.ink, textAlign: 'center' },
  qrPlaceholder: { minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  qrHint: { ...type.caption, color: colors.muted, textAlign: 'center', maxWidth: 420 },
  qrMessage: { ...type.small, color: colors.muted, textAlign: 'center', maxWidth: 420 },
  securityNoteLarge: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  securityNote: { gap: spacing.xs, paddingVertical: spacing.md, marginTop: spacing.xxxl },
  securityHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  securityTitle: { ...type.smallStrong, color: colors.ink },
  securityBody: { ...type.small, color: colors.muted, marginTop: 2 },
  groupLabel: { ...type.smallStrong, color: colors.muted, marginTop: spacing.xl, marginBottom: spacing.xs },
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
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
  preferenceNote: { ...type.caption, color: colors.muted, marginTop: spacing.xs },
  appearanceSegments: { marginBottom: spacing.xs },
  segmentRow: { flexDirection: 'row', padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceStrong },
  segmentButton: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: spacing.xs },
  segmentButtonActive: { backgroundColor: colors.surface },
  segmentButtonText: { ...type.smallStrong, color: colors.muted, textAlign: 'center' },
  segmentButtonTextActive: { color: colors.primary },
  keyNote: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.md },
  keyNoteText: { ...type.small, color: colors.muted, flex: 1 },
  settingsLink: { minHeight: 68, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  settingsLinkPressed: { opacity: 0.68 },
  settingsLinkCopy: { flex: 1, gap: 3 },
  settingsLinkLabel: { ...type.smallStrong, color: colors.ink },
  settingsLinkUrl: { ...type.caption, color: colors.primary },
  homeMenuLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
  homeMenuDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.menuDismiss },
  homeMenuCard: { position: 'absolute', right: spacing.sm, width: 236, paddingHorizontal: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surface, zIndex: 1, elevation: 8, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.14, shadowRadius: 14 },
  // flexGrow 0 keeps the card content-sized in portrait; flexShrink lets the
  // capped landscape card scroll instead of clipping its last row.
  homeMenuScroll: { flexGrow: 0, flexShrink: 1 },
  homeMenuRow: { minHeight: 56, paddingHorizontal: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  homeMenuRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  homeMenuRowPressed: { opacity: 0.68 },
  homeMenuRowDisabled: { opacity: 0.6 },
  homeMenuRowIcon: { width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  homeMenuRowCopy: { flex: 1 },
  homeMenuRowLabel: { ...type.smallStrong, color: colors.ink },
  homeMenuRowSubtitle: { ...type.caption, color: colors.muted, marginTop: 1 },
  aboutHero: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.xs },
  aboutLogo: { width: 84, height: 84, borderRadius: radius.lg, marginBottom: spacing.sm },
  aboutProductName: { ...type.title, color: colors.ink, textAlign: 'center' },
  aboutVersion: { ...type.small, color: colors.muted, textAlign: 'center' },
  resetArea: { marginTop: spacing.xxxl },
  resetGap: { height: spacing.sm },
  })
}
