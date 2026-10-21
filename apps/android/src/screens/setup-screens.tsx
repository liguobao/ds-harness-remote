import { useEffect, useRef, useState } from 'react'
import { useBrowseMemory, browsePreference, clearBrowseMemory } from '../services/browse-memory'
import * as Application from 'expo-application'
import { File, Paths } from 'expo-file-system'
import { getContentUriAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Check, ChevronRight, Download, ExternalLink, Info, KeyRound, Laptop, LockKeyhole, QrCode as QrCodeIcon, RotateCcw, Settings, type LucideIcon } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import type { QrLoginStart } from '../state/store-state'
import { SOURCE_CODE_URL } from '../lib/links'
import type { OAuthProviderInfo } from '../services/api'
import { BlurHeaderFrame, Button, Field, KeyValue, Screen, TopBar } from '../ui/components'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { transportPreferenceOptions } from '../types'
import type { DefaultPermissionPreset, LoginMethod } from '../types'
import { QrCode } from '../ui/qr-code'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useResponsiveLayout } from '../ui/responsive'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings as zhCN, type LanguagePreference } from '../locales/i18n'
import type { ThemePreference } from '../ui/theme'

/** Default DSH Remote Server; a build can override it via EXPO_PUBLIC_DSH_REMOTE_SERVER. */
const defaultServerUrl = 'https://dsh.r2049.cn'
const updateUrl = 'https://github.com/liguobao/ds-harness-remote/releases/latest'
const releaseApiUrl = 'https://api.github.com/repos/liguobao/ds-harness-remote/releases/latest'
const developerUrl = 'https://www.zhihu.com/people/codelover'

type SetupLoginMethod = Extract<LoginMethod, 'oauth' | 'github-oauth' | 'password'> | 'qr'

function loginMethodLabel(method?: LoginMethod): string {
  if (method === 'oauth') return zhCN.setup.oauth
  if (method === 'github-oauth') return zhCN.setup.githubOAuth
  if (method === 'password') return zhCN.setup.passwordMethod
  return zhCN.common.unknown
}

export function ServerSetupScreen({ onComplete, onBack }: { onComplete: () => void; onBack?: () => void }) {
  const config = useAppStore(state => state.config)
  const busy = useAppStore(state => state.busyAction === 'server')
  const oauthBusy = useAppStore(state => state.busyAction === 'oauth')
  const configure = useAppStore(state => state.configureServer)
  const startOAuth = useAppStore(state => state.startOAuth)
  const startGithubOAuth = useAppStore(state => state.startGithubOAuth)
  const listQrProviders = useAppStore(state => state.listQrProviders)
  const startQrLogin = useAppStore(state => state.startQrLogin)
  const pollQrLogin = useAppStore(state => state.pollQrLogin)
  const completeQrLogin = useAppStore(state => state.completeQrLogin)
  const [serverUrl, setServerUrl] = useState(config?.baseUrl ?? process.env.EXPO_PUBLIC_DSH_REMOTE_SERVER ?? defaultServerUrl)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginMethod, setLoginMethod] = useState<SetupLoginMethod>('oauth')
  const [qrProviders, setQrProviders] = useState<OAuthProviderInfo[]>([])
  const [qrProviderId, setQrProviderId] = useState<string>()
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
  const { width, height } = useResponsiveLayout()
  // Tablets and other large screens sign in from their own display while the
  // user scans with a phone; phones keep the browser OAuth tabs by default.
  const largeScreen = Math.min(width, height) >= 600
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

  const submit = async () => {
    if (await configure(serverUrl, email, password)) onComplete()
  }

  const signInWithZhihu = async () => {
    const url = await startOAuth(serverUrl)
    if (url !== undefined) await Linking.openURL(url)
  }

  const signInWithGithub = async () => {
    const url = await startGithubOAuth(serverUrl)
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
    setQrProviderId(started.provider.id)
    setQrPhase('waiting')
  }

  const refreshQr = async () => {
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
    setQrProviders(result.providers)
    if (result.providers.length === 0) {
      setQrPhase('unsupported')
      return
    }
    const preferred = result.providers.find(provider => provider.id === qrProviderId)
      ?? result.providers.find(provider => provider.id === 'zhihu')
      ?? result.providers[0]!
    setQrProviderId(preferred.id)
    await startQrFor(preferred, run)
  }

  // Changing the Server invalidates every provider and QR session on screen.
  useEffect(() => {
    if (lastServerUrl.current === serverUrl) return
    lastServerUrl.current = serverUrl
    qrRun.current += 1
    qrCompleted.current = false
    setQrProviders([])
    setQrProviderId(undefined)
    setQrLogin(undefined)
    setQrPhase('idle')
  }, [serverUrl])

  // Poll only while the QR tab is visible. Leaving the tab keeps the session
  // but stops timers; returning resumes polling the same session.
  useEffect(() => {
    if (loginMethod !== 'qr' || qrLogin === undefined || qrCompleted.current) return
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
        const method = qrLogin.provider.id === 'github' ? 'github-oauth' : 'oauth'
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
  }, [completeQrLogin, loginMethod, pollQrLogin, qrLogin])

  const openQrTab = () => {
    setLoginMethod('qr')
    if (qrLogin === undefined && qrPhase !== 'loading') void refreshQr()
  }

  const chooseQrProvider = (provider: OAuthProviderInfo) => {
    if (provider.id === qrProviderId && qrLogin !== undefined && (qrPhase === 'waiting' || qrPhase === 'loading')) return
    const run = ++qrRun.current
    setQrProviderId(provider.id)
    void startQrFor(provider, run)
  }

  const qrContent = loginMethod !== 'qr' ? null : (
    <View style={styles.qrPanel}>
      <Text style={styles.qrTitle}>{zhCN.setup.qrScanTitle}</Text>
      {qrProviders.length > 1 && (
        <View style={styles.qrProviders}>
          {qrProviders.map(provider => {
            const selected = provider.id === qrProviderId
            return (
              <Pressable
                key={provider.id}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: qrPhase === 'loading' }}
                disabled={qrPhase === 'loading'}
                onPress={() => chooseQrProvider(provider)}
                style={[styles.qrProvider, selected && styles.qrProviderSelected]}
              >
                <Text style={[styles.qrProviderText, selected && styles.qrProviderTextSelected]}>{provider.displayName}</Text>
              </Pressable>
            )
          })}
        </View>
      )}
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
      />
    </View>
  )

  const credentialContent = loginMethod === 'oauth'
    ? <>
        <Button label={zhCN.setup.zhihu} onPress={() => void signInWithZhihu()} loading={oauthBusy} />
        <Text style={styles.oauthHint}>{zhCN.setup.oauthHint}</Text>
      </>
    : loginMethod === 'github-oauth'
      ? <>
          <Button label={zhCN.setup.github} onPress={() => void signInWithGithub()} loading={oauthBusy} />
          <Text style={styles.oauthHint}>{zhCN.setup.oauthHint}</Text>
        </>
      : <>
          <Field label={zhCN.setup.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username" placeholder={zhCN.setup.emailPlaceholder} />
          <Field label={zhCN.setup.password} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" returnKeyType="go" onSubmitEditing={() => { if (canSubmit) void submit() }} placeholder={zhCN.setup.passwordPlaceholder} hint={zhCN.setup.passwordHint} />
          <Button label={zhCN.setup.title} onPress={() => void submit()} loading={busy} disabled={!canSubmit} />
        </>

  return (
    <View style={styles.flex}>
      <BlurHeaderFrame header={<TopBar title={zhCN.setup.title} onBack={onBack} />}>
        <Screen>
          <Text style={styles.productName}>DeepSeek Harness Remote</Text>
          <Text style={styles.title}>{config === undefined ? zhCN.setup.signIn : zhCN.setup.signInAgain}</Text>
          <Text style={styles.lead}>{zhCN.setup.lead}</Text>

          <View style={[styles.form, largeScreen && styles.formLarge]}>
            <View style={styles.methodTabs}>
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: loginMethod === 'oauth' }} onPress={() => setLoginMethod('oauth')} style={[styles.methodTab, loginMethod === 'oauth' && styles.methodTabActive]}>
                <Text style={[styles.methodTabText, loginMethod === 'oauth' && styles.methodTabTextActive]} numberOfLines={1}>{zhCN.setup.oauth}</Text>
              </Pressable>
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: loginMethod === 'github-oauth' }} onPress={() => setLoginMethod('github-oauth')} style={[styles.methodTab, loginMethod === 'github-oauth' && styles.methodTabActive]}>
                <Text style={[styles.methodTabText, loginMethod === 'github-oauth' && styles.methodTabTextActive]} numberOfLines={1}>{zhCN.setup.githubOAuth}</Text>
              </Pressable>
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: loginMethod === 'password' }} onPress={() => setLoginMethod('password')} style={[styles.methodTab, loginMethod === 'password' && styles.methodTabActive]}>
                <Text style={[styles.methodTabText, loginMethod === 'password' && styles.methodTabTextActive]} numberOfLines={1}>{zhCN.setup.passwordMethod}</Text>
              </Pressable>
            </View>

            {loginMethod !== 'qr' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={zhCN.setup.qr}
                accessibilityState={{ expanded: qrContent !== null }}
                onPress={openQrTab}
                style={({ pressed }) => [styles.qrEntry, pressed && styles.qrEntryPressed]}
              >
                <QrCodeIcon size={22} color={colors.primary} />
                <View style={styles.qrEntryCopy}>
                  <Text style={styles.qrEntryText}>{zhCN.setup.qr}</Text>
                  <Text style={styles.qrEntryHint}>{zhCN.setup.qrEntryHint}</Text>
                </View>
                <ChevronRight size={16} color={colors.muted} />
              </Pressable>
            )}

            {qrContent ?? credentialContent}

            <View style={styles.serverSection}>
              <Field label={zhCN.setup.server} value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint={zhCN.setup.serverHint} placeholder="https://remote.example.com" />
            </View>
          </View>

          <View style={[styles.securityNote, largeScreen && styles.securityNoteLarge]}>
            <LockKeyhole size={20} color={colors.primary} />
            <View style={styles.securityCopy}>
              <Text style={styles.securityTitle}>{zhCN.setup.trustTitle}</Text>
              <Text style={styles.securityBody}>{zhCN.setup.trustBody}</Text>
            </View>
          </View>
        </Screen>
      </BlurHeaderFrame>
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
  const themePreference = useAppStore(state => state.themePreference)
  const setThemePreference = useAppStore(state => state.setThemePreference)
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
            <View style={styles.settingsHeader}>
              <View style={styles.settingsIcon}><Settings size={25} color={colors.primary} /></View>
              <View style={styles.securityCopy}><Text style={styles.settingsTitle}>{zhCN.settings.thisPhone}</Text><Text style={styles.settingsSubtitle}>{identity?.name ?? zhCN.settings.androidDevice}</Text></View>
            </View>

            <Text style={styles.groupLabel}>{zhCN.comfort.continueWork}</Text>
            <View style={styles.preferenceList}>
              <Button label={comfort.resume ? zhCN.comfort.resumeOn : zhCN.comfort.resumeOff} variant="secondary" onPress={() => browsePreference({resume: !comfort.resume})} />
              <Button label={comfort.notifications ? zhCN.comfort.notificationsOn : zhCN.comfort.notificationsOff} variant="secondary" onPress={() => browsePreference({notifications: !comfort.notifications})} />
              <Button label={zhCN.comfort.systemNotifications} variant="secondary" onPress={() => void Linking.openSettings()} />
              <Text style={styles.preferenceNote}>{zhCN.comfort.cacheNote}</Text>
              <Button label={zhCN.comfort.clearCache} variant="secondary" onPress={() => void clearBrowseMemory()} />
              {comfort.error !== undefined && <Text accessibilityRole="alert">{comfort.error}</Text>}
            </View>
            <Text style={styles.groupLabel}>{zhCN.settings.language}</Text>
            <View style={styles.preferenceList}>
              {languageOptions().map(option => {
                const chosen = option.value === languagePreference
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chosen }}
                    onPress={() => void setLanguagePreference(option.value)}
                    style={[styles.preferenceOption, chosen && styles.preferenceOptionChosen]}
                  >
                    <Text style={[styles.preferenceName, styles.languageName]}>{option.name}</Text>
                    {chosen && <Check size={17} color={colors.primary} />}
                  </Pressable>
                )
              })}
              <Text style={styles.preferenceNote}>{zhCN.settings.languageNote}</Text>
            </View>

            <Text style={styles.groupLabel}>{zhCN.settings.theme}</Text>
            <View style={styles.segmentRow} accessibilityRole="tablist">
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
                <Text style={[styles.preferenceName, styles.languageName]}>{zhCN.settings.statusBar}</Text>
                <Switch
                  accessibilityLabel={zhCN.settings.statusBar}
                  value={statusBarVisible}
                  disabled={statusBarSaving}
                  onValueChange={visible => void toggleStatusBar(visible)}
                  trackColor={{ true: colors.primary }}
                />
              </View>
              <Text style={styles.preferenceNote}>{zhCN.settings.statusBarNote}</Text>
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

export function HomeActionsMenu({ visible, onClose, onSettings, onAbout, onDevices }: {
  visible: boolean
  onClose: () => void
  onSettings: () => void
  onAbout: () => void
  onDevices?: () => void
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
            <Text style={styles.aboutProductName}>DeepSeek Harness Remote</Text>
            <Text style={styles.aboutVersion}>{versionLabel}</Text>
          </View>

          <View style={styles.group}>
            <SettingsLink label={zhCN.settings.developer} value={zhCN.settings.developerValue} url={developerUrl} />
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
  productName: { ...type.smallStrong, color: colors.primary, marginTop: spacing.xxl, marginBottom: spacing.md },
  title: { ...type.hero, color: colors.ink, maxWidth: 340 },
  lead: { ...type.body, color: colors.muted, marginTop: spacing.sm, maxWidth: 520 },
  form: { marginTop: spacing.xxl, gap: spacing.md },
  methodTabs: { flexDirection: 'row', padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceStrong },
  methodTab: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  methodTabActive: { backgroundColor: colors.surface },
  methodTabText: { ...type.smallStrong, color: colors.muted },
  methodTabTextActive: { color: colors.primary },
  serverSection: { gap: spacing.sm, marginTop: spacing.sm, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
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
  qrProviders: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs },
  qrProvider: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qrProviderSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  qrProviderText: { ...type.smallStrong, color: colors.muted },
  qrProviderTextSelected: { color: colors.primary },
  qrPlaceholder: { minHeight: 200, alignItems: 'center', justifyContent: 'center' },
  qrHint: { ...type.caption, color: colors.muted, textAlign: 'center', maxWidth: 420 },
  qrMessage: { ...type.small, color: colors.muted, textAlign: 'center', maxWidth: 420 },
  securityNoteLarge: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  securityNote: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, marginTop: spacing.xxxl },
  securityCopy: { flex: 1 },
  securityTitle: { ...type.smallStrong, color: colors.ink },
  securityBody: { ...type.small, color: colors.muted, marginTop: 2 },
  settingsHeader: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: spacing.xl },
  settingsIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  settingsTitle: { ...type.heading, color: colors.ink },
  settingsSubtitle: { ...type.small, color: colors.muted },
  groupLabel: { ...type.smallStrong, color: colors.muted, marginTop: spacing.xl, marginBottom: spacing.xs },
  group: { borderRadius: radius.lg, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  preferenceList: { gap: spacing.xs },
  preferenceOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  preferenceOptionChosen: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  permissionOption: { minHeight: 48 },
  preferenceCopy: { flex: 1 },
  preferenceName: { ...type.smallStrong, color: colors.ink },
  languageName: { flex: 1 },
  preferenceDescription: { ...type.caption, color: colors.muted, marginTop: 2 },
  preferenceNote: { ...type.caption, color: colors.muted, marginTop: spacing.xs },
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
