import { useState } from 'react'
import * as Application from 'expo-application'
import { File, Paths } from 'expo-file-system'
import { getContentUriAsync } from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Check, ChevronRight, Download, ExternalLink, Info, KeyRound, Laptop, LockKeyhole, RotateCcw, Settings, type LucideIcon } from 'lucide-react-native'
import { useAppStore } from '../state/store'
import { SOURCE_CODE_URL } from '../lib/links'
import { Button, Field, KeyValue, Screen, TopBar } from '../ui/components'
import { transportPreferenceOptions } from '../types'
import type { LoginMethod } from '../types'
import { radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { strings as zhCN, type LanguagePreference } from '../locales/i18n'
import type { ThemePreference } from '../ui/theme'

/** Default DSH Remote Server; a build can override it via EXPO_PUBLIC_DSH_REMOTE_SERVER. */
const defaultServerUrl = 'https://dsh.r2049.cn'
const updateUrl = 'https://github.com/liguobao/ds-harness-remote/releases/latest'
const releaseApiUrl = 'https://api.github.com/repos/liguobao/ds-harness-remote/releases/latest'
const developerUrl = 'https://www.zhihu.com/people/codelover'

type SetupLoginMethod = Extract<LoginMethod, 'oauth' | 'github-oauth' | 'password'>

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
  const [serverUrl, setServerUrl] = useState(config?.baseUrl ?? process.env.EXPO_PUBLIC_DSH_REMOTE_SERVER ?? defaultServerUrl)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginMethod, setLoginMethod] = useState<SetupLoginMethod>('oauth')
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

  return (
    <View style={styles.flex}>
      <TopBar title={zhCN.setup.title} onBack={onBack} />
      <Screen>
        <Text style={styles.productName}>DeepSeek Harness Remote</Text>
        <Text style={styles.title}>{config === undefined ? zhCN.setup.signIn : zhCN.setup.signInAgain}</Text>
        <Text style={styles.lead}>{zhCN.setup.lead}</Text>

        <View style={styles.form}>
          <View style={styles.methodTabs}>
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: loginMethod === 'oauth' }} onPress={() => setLoginMethod('oauth')} style={[styles.methodTab, loginMethod === 'oauth' && styles.methodTabActive]}>
              <Text style={[styles.methodTabText, loginMethod === 'oauth' && styles.methodTabTextActive]}>{zhCN.setup.oauth}</Text>
            </Pressable>
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: loginMethod === 'github-oauth' }} onPress={() => setLoginMethod('github-oauth')} style={[styles.methodTab, loginMethod === 'github-oauth' && styles.methodTabActive]}>
              <Text style={[styles.methodTabText, loginMethod === 'github-oauth' && styles.methodTabTextActive]}>{zhCN.setup.githubOAuth}</Text>
            </Pressable>
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: loginMethod === 'password' }} onPress={() => setLoginMethod('password')} style={[styles.methodTab, loginMethod === 'password' && styles.methodTabActive]}>
              <Text style={[styles.methodTabText, loginMethod === 'password' && styles.methodTabTextActive]}>{zhCN.setup.passwordMethod}</Text>
            </Pressable>
          </View>

          {loginMethod === 'oauth'
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
              </>}

          <View style={styles.serverSection}>
            <Field label={zhCN.setup.server} value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint={zhCN.setup.serverHint} placeholder="https://remote.example.com" />
          </View>
        </View>

        <View style={styles.securityNote}>
          <LockKeyhole size={20} color={colors.primary} />
          <View style={styles.securityCopy}>
            <Text style={styles.securityTitle}>{zhCN.setup.trustTitle}</Text>
            <Text style={styles.securityBody}>{zhCN.setup.trustBody}</Text>
          </View>
        </View>
      </Screen>
    </View>
  )
}

export function SettingsScreen({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const config = useAppStore(state => state.config)
  const identity = useAppStore(state => state.identity)
  const account = useAppStore(state => state.account)
  const preference = useAppStore(state => state.transportPreference)
  const setPreference = useAppStore(state => state.setTransportPreference)
  const languagePreference = useAppStore(state => state.languagePreference)
  const setLanguagePreference = useAppStore(state => state.setLanguagePreference)
  const themePreference = useAppStore(state => state.themePreference)
  const setThemePreference = useAppStore(state => state.setThemePreference)
  const reset = useAppStore(state => state.resetLocalData)
  const signOut = useAppStore(state => state.signOut)
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)

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
      <TopBar title={zhCN.settings.title} onBack={onBack} />
      <Screen>
        <View style={styles.settingsHeader}>
          <View style={styles.settingsIcon}><Settings size={25} color={colors.primary} /></View>
          <View style={styles.securityCopy}><Text style={styles.settingsTitle}>{zhCN.settings.thisPhone}</Text><Text style={styles.settingsSubtitle}>{identity?.name ?? zhCN.settings.androidDevice}</Text></View>
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
      </Screen>
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
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { phase, progress, checkForUpdates } = useUpdateCheck()

  if (!visible) return null

  return (
    <View style={styles.homeMenuLayer}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={zhCN.common.close}
        onPress={onClose}
        style={styles.homeMenuDismiss}
      />
      <View accessibilityRole="menu" style={styles.homeMenuCard}>
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
      <TopBar title={zhCN.settings.about} onBack={onBack} />
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
  homeMenuCard: { position: 'absolute', top: 56, right: spacing.sm, width: 236, paddingHorizontal: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.surface, elevation: 8, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.14, shadowRadius: 14 },
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
