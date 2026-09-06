import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native'
import { AlertCircle, ArrowLeft, ChevronRight, CircleCheck, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react-native'
import { radius, spacing, type } from './theme'
import { useTheme, type ThemeColors } from './theme-context'
import { useThemedStyles } from './use-themed-styles'
import { strings as zhCN } from '../locales/i18n'

export function Screen({ children, scroll = true, refreshing = false, onRefresh }: {
  children: ReactNode
  scroll?: boolean
  refreshing?: boolean
  onRefresh?: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  if (!scroll) return <View style={styles.screen}>{children}</View>
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh === undefined
        ? undefined
        : <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
            tintColor={colors.primary}
          />}
    >
      {children}
    </ScrollView>
  )
}

export function TopBar({ title, onBack, action }: { title: string; onBack?: () => void; action?: ReactNode }) {
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.topBar}>
      <View style={styles.topBarSide}>
        {onBack !== undefined && (
          <IconButton label={zhCN.common.back} icon={ArrowLeft} onPress={onBack} />
        )}
      </View>
      <Text style={styles.topBarTitle} numberOfLines={1}>{title}</Text>
      <View style={[styles.topBarSide, styles.topBarTrailing]}>{action}</View>
    </View>
  )
}

export function IconButton({ label, icon: Icon, onPress, disabled = false }: {
  label: string
  icon: LucideIcon
  onPress: () => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed, disabled && styles.disabled]}
    >
      <Icon size={21} color={colors.ink} strokeWidth={2} />
    </Pressable>
  )
}

export function Button({ label, onPress, icon: Icon, variant = 'primary', loading = false, disabled = false }: {
  label: string
  onPress: () => void
  icon?: LucideIcon
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
  loading?: boolean
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const buttonStyles = createButtonStyles(colors)
  const isDisabled = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        buttonStyles[variant],
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.disabled,
      ]}
    >
      {loading
        ? <ActivityIndicator size="small" color={variant === 'primary' || variant === 'danger' ? colors.white : colors.ink} />
        : Icon !== undefined && <Icon size={19} color={variant === 'primary' || variant === 'danger' ? colors.white : colors.ink} />}
      <Text style={[styles.buttonText, (variant === 'primary' || variant === 'danger') && styles.buttonTextOnColor]}>{label}</Text>
    </Pressable>
  )
}

export function Field({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        style={[styles.input, props.multiline && styles.inputMultiline, error !== undefined && styles.inputError, props.style]}
      />
      {error !== undefined
        ? <Text style={styles.fieldError}>{error}</Text>
        : hint !== undefined && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  )
}

export function StatusBadge({ status, label }: {
  status: 'online' | 'offline' | 'lan' | 'relay' | 'p2p' | 'turn' | 'waiting' | 'running'
  label?: string
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const badge = statusBadgeStyles(colors)[status]
  return (
    <View style={[styles.badge, { backgroundColor: badge.background }]} accessibilityLabel={label ?? badge.label}>
      <View style={[styles.badgeDot, { backgroundColor: badge.foreground }]} />
      <Text style={[styles.badgeText, { color: badge.foreground }]}>{label ?? badge.label}</Text>
    </View>
  )
}

export function ErrorBanner({ message, onDismiss, onRetry }: { message: string; onDismiss?: () => void; onRetry?: () => void }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View accessibilityRole="alert" style={styles.errorBanner}>
      <AlertCircle size={20} color={colors.danger} />
      <Text style={styles.errorBannerText}>{message}</Text>
      {onRetry !== undefined && <Pressable accessibilityRole="button" onPress={onRetry}><Text style={styles.errorAction}>{zhCN.common.retry}</Text></Pressable>}
      {onDismiss !== undefined && <Pressable accessibilityRole="button" onPress={onDismiss}><Text style={styles.errorAction}>{zhCN.common.close}</Text></Pressable>}
    </View>
  )
}

export function EmptyState({ icon: Icon = WifiOff, title, body, action }: {
  icon?: LucideIcon
  title: string
  body: string
  action?: ReactNode
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}><Icon size={25} color={colors.primary} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action !== undefined && <View style={styles.emptyAction}>{action}</View>}
    </View>
  )
}

export function ListRow({ title, subtitle, meta, metaInline = false, icon: Icon, onPress, status }: {
  title: string
  subtitle?: string
  meta?: string
  metaInline?: boolean
  icon?: LucideIcon
  onPress: () => void
  status?: ReactNode
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}
    >
      {Icon !== undefined && <View style={styles.rowIcon}><Icon size={21} color={colors.primary} /></View>}
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
          {status}
        </View>
        {metaInline
          ? (subtitle !== undefined || meta !== undefined) && (
              <View style={styles.rowDetailLine}>
                {subtitle !== undefined && <Text style={[styles.rowSubtitle, styles.rowInlineSubtitle]} numberOfLines={1}>{subtitle}</Text>}
                {meta !== undefined && <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>}
              </View>
            )
          : <>
              {subtitle !== undefined && <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text>}
              {meta !== undefined && <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>}
            </>}
      </View>
      <ChevronRight size={20} color={colors.subtle} />
    </Pressable>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const styles = useThemedStyles(createStyles)
  return <View style={styles.sectionTitleRow}><Text style={styles.sectionTitle}>{children}</Text>{action}</View>
}

export function KeyValue({ label, value, mono = false, onPress }: { label: string; value: string; mono?: boolean; onPress?: () => void }) {
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.keyValue}>
      <Text style={styles.keyLabel}>{label}</Text>
      {onPress === undefined
        ? <Text style={[styles.keyValueText, mono && styles.mono]} selectable={mono}>{value}</Text>
        : <Pressable accessibilityRole="link" accessibilityLabel={`${label}: ${value}`} onPress={onPress} hitSlop={8} style={styles.keyValueLinkTarget}>
            {({ pressed }) => <Text style={[styles.keyValueText, styles.keyValueLink, pressed && styles.keyValueLinkPressed]}>{value}</Text>}
          </Pressable>}
    </View>
  )
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  const styles = useThemedStyles(createStyles)
  return <View>{Array.from({ length: count }, (_, index) => <View key={index} style={styles.skeletonRow}><View style={styles.skeletonIcon} /><View style={styles.skeletonCopy}><View style={styles.skeletonTitle} /><View style={styles.skeletonText} /></View></View>)}</View>
}

export function RefreshAction({ refreshing, onPress }: { refreshing: boolean; onPress: () => void }) {
  return <IconButton label={zhCN.common.refresh} icon={RefreshCw} onPress={onPress} disabled={refreshing} />
}

export function SuccessNotice({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return <View style={styles.successNotice}><CircleCheck size={19} color={colors.success} /><Text style={styles.successNoticeText}>{children}</Text></View>
}

function createButtonStyles(colors: ThemeColors) {
  return StyleSheet.create({
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surfaceStrong },
    danger: { backgroundColor: colors.danger },
    quiet: { backgroundColor: 'transparent' },
  })
}

function statusBadgeStyles(colors: ThemeColors) {
  return {
    online: { label: zhCN.status.online, background: colors.successSoft, foreground: colors.success },
    offline: { label: zhCN.status.offline, background: colors.surfaceStrong, foreground: colors.muted },
    lan: { label: zhCN.status.lan, background: colors.successSoft, foreground: colors.success },
    relay: { label: zhCN.status.relay, background: colors.warningSoft, foreground: colors.warning },
    p2p: { label: zhCN.status.p2p, background: colors.accentSoft, foreground: colors.accent },
    turn: { label: zhCN.status.turn, background: colors.warningSoft, foreground: colors.warning },
    waiting: { label: zhCN.status.waiting, background: colors.warningSoft, foreground: colors.warning },
    running: { label: zhCN.status.running, background: colors.accentSoft, foreground: colors.accent },
  } as const
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    screenContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
    topBar: { height: 60, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.surface },
    topBarSide: { width: 52, alignItems: 'flex-start' },
    topBarTrailing: { alignItems: 'flex-end' },
    topBarTitle: { ...type.heading, flex: 1, textAlign: 'center', color: colors.ink },
    iconButton: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    iconButtonPressed: { backgroundColor: colors.surfaceStrong },
    button: { minHeight: 50, paddingHorizontal: spacing.lg, borderRadius: radius.md, flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center' },
    buttonPressed: { opacity: 0.82 },
    buttonText: { ...type.bodyStrong, color: colors.ink },
    buttonTextOnColor: { color: colors.white },
    disabled: { opacity: 0.52 },
    field: { gap: 7 },
    fieldLabel: { ...type.smallStrong, color: colors.ink },
    input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, backgroundColor: colors.background, ...type.body, color: colors.ink },
    inputMultiline: { minHeight: 104, paddingTop: spacing.sm, textAlignVertical: 'top' },
    inputError: { borderColor: colors.danger },
    fieldHint: { ...type.small, color: colors.muted },
    fieldError: { ...type.small, color: colors.danger },
    badge: { height: 28, paddingHorizontal: 10, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6 },
    badgeDot: { width: 7, height: 7, borderRadius: radius.pill },
    badgeText: { ...type.caption },
    errorBanner: { marginHorizontal: spacing.lg, marginTop: spacing.sm, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.dangerSoft, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
    errorBannerText: { ...type.small, color: colors.ink, flex: 1 },
    errorAction: { ...type.smallStrong, color: colors.danger, paddingVertical: 2 },
    emptyState: { paddingVertical: 56, alignItems: 'center', paddingHorizontal: spacing.xl },
    emptyIcon: { width: 52, height: 52, borderRadius: radius.lg, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
    emptyTitle: { ...type.heading, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: spacing.xs, maxWidth: 320 },
    emptyAction: { marginTop: spacing.xl, alignSelf: 'stretch' },
    listRow: { minHeight: 82, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    listRowPressed: { backgroundColor: colors.surface },
    rowIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, gap: 3 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    rowTitle: { ...type.bodyStrong, color: colors.ink, flex: 1 },
    rowDetailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    rowSubtitle: { ...type.small, color: colors.muted },
    rowInlineSubtitle: { flex: 1 },
    rowMeta: { ...type.caption, color: colors.subtle },
    sectionTitleRow: { marginTop: spacing.xxl, marginBottom: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { ...type.smallStrong, color: colors.muted },
    keyValue: { paddingVertical: spacing.sm, flexDirection: 'row', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    keyLabel: { ...type.small, color: colors.muted, width: 116 },
    keyValueText: { ...type.smallStrong, color: colors.ink, flex: 1, textAlign: 'right' },
    keyValueLinkTarget: { flex: 1 },
    keyValueLink: { color: colors.primary },
    keyValueLinkPressed: { opacity: 0.65 },
    mono: { fontFamily: 'monospace', fontWeight: '500' },
    skeletonRow: { height: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    skeletonIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.surfaceStrong },
    skeletonCopy: { flex: 1, gap: spacing.xs },
    skeletonTitle: { width: '54%', height: 14, borderRadius: 4, backgroundColor: colors.surfaceStrong },
    skeletonText: { width: '78%', height: 11, borderRadius: 4, backgroundColor: colors.surface },
    successNotice: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.successSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    successNoticeText: { ...type.small, color: colors.ink, flex: 1 },
  })
}
