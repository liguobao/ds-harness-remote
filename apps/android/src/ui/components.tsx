import { createContext, useContext, useId, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type StyleProp,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native'
import { BlurTargetView, BlurView } from 'expo-blur'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { AlertCircle, ArrowLeft, ChevronRight, CircleCheck, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react-native'
import { radius, spacing, type } from './theme'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme, type ThemeColors } from './theme-context'
import { useThemedStyles } from './use-themed-styles'
import { strings as zhCN } from '../locales/i18n'

export function Screen({ children, scroll = true, refreshing = false, onRefresh, scrollRef, fill = false }: {
  children: ReactNode
  scroll?: boolean
  fill?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  scrollRef?: RefObject<ScrollView | null>
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const styles = useThemedStyles(createStyles)
  const inset = useHeaderInset()
  if (!scroll) return <View style={[styles.screen, { paddingTop: inset, paddingBottom: insets.bottom }]}>{children}</View>
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={[
        styles.screenContent,
        fill && { flexGrow: 1 },
        { paddingTop: inset, paddingBottom: styles.screenContent.paddingBottom + insets.bottom },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh === undefined
        ? undefined
        : (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            progressViewOffset={inset}
            colors={[colors.primary]}
            progressBackgroundColor={colors.surface}
            tintColor={colors.primary}
          />
        )}
    >
      {children}
    </ScrollView>
  )
}

const HeaderBlurTargetContext = createContext<RefObject<View | null> | undefined>(undefined)
const HeaderInsetContext = createContext(0)

/** Height of the overlaid header that scrollable content must pad its top by; 0 outside a `BlurHeaderFrame`. */
export function useHeaderInset(): number {
  return useContext(HeaderInsetContext)
}

/**
 * Overlays `header` (normally a `TopBar`) on `children`, which scroll beneath
 * it and show through frosted. Scrollable children pad their content by
 * `useHeaderInset()` (or the render-prop argument); with `inset`, fixed
 * content is pushed below the header instead.
 */
export function BlurHeaderFrame({ header, children, inset = false }: {
  header: ReactNode
  children: ReactNode | ((headerHeight: number) => ReactNode)
  inset?: boolean
}) {
  const insets = useSafeAreaInsets()
  const styles = useThemedStyles(createStyles)
  const blurTarget = useRef<View>(null)
  // Seeded with the single-line TopBar minimum until the header measures.
  const [height, setHeight] = useState(56 + insets.top)
  const contentInset = inset ? 0 : height
  return (
    <View style={styles.screen}>
      <BlurTargetView ref={blurTarget} style={styles.frameContent}>
        {/* The blur records the target's inner native view, so the opaque background must live inside it. */}
        <View style={[styles.screen, inset && { paddingTop: height }]}>
          <HeaderInsetContext.Provider value={contentInset}>
            {typeof children === 'function' ? children(contentInset) : children}
          </HeaderInsetContext.Provider>
        </View>
      </BlurTargetView>
      <View style={styles.frameHeader} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
        <HeaderBlurTargetContext.Provider value={blurTarget}>{header}</HeaderBlurTargetContext.Provider>
      </View>
    </View>
  )
}

/** Background-colored overlay whose opacity runs from `from` (top) to `to` (bottom). */
function VerticalFade({ from, to, style }: { from: number; to: number; style: StyleProp<ViewStyle> }) {
  const { colors } = useTheme()
  const id = `fade${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <Svg style={style} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.background} stopOpacity={from} />
          <Stop offset="1" stopColor={colors.background} stopOpacity={to} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  )
}

export function TopBar({
  title,
  subtitle,
  onSubtitlePress,
  onTitlePress,
  onBack,
  backIcon,
  backLabel,
  action,
  titleLines = 1,
  titleAccessory,
  centered = false,
}: {
  title: string
  titleAccessory?: ReactNode
  centered?: boolean | number
  subtitle?: string
  onSubtitlePress?: () => void
  onTitlePress?: () => void
  onBack?: () => void
  backIcon?: ComponentType<{ size?: number; color?: string; fill?: string; strokeWidth?: number }>
  backLabel?: string
  action?: ReactNode
  /** Set above 1 when the title carries structured text that may not fit one line. */
  titleLines?: number
}) {
  const insets = useSafeAreaInsets()
  const { colors, scheme } = useTheme()
  // Inside a BlurHeaderFrame the bar frosts the content beneath it instead of painting a surface.
  const blurTarget = useContext(HeaderBlurTargetContext)
  const styles = useThemedStyles(createStyles)
  const hasSubtitle = subtitle !== undefined && subtitle.length > 0
  const tallerBar = hasSubtitle || titleLines > 1
  return (
    <View
      style={[
        styles.topBar,
        { paddingTop: insets.top + spacing.xs, minHeight: 56 + insets.top },
        tallerBar && styles.topBarWithSubtitle,
        blurTarget !== undefined && styles.topBarBlurred,
      ]}
    >
      {blurTarget !== undefined && (
        <BlurView
          blurTarget={blurTarget}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={50}
          tint={scheme === 'dark' ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
          pointerEvents="none"
        />
      )}
      {/* Frosted translucent backdrop (~60% opacity) matching modern iOS/assistant styling */}
      {blurTarget !== undefined && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: scheme === 'dark' ? 'rgba(20, 20, 24, 0.65)' : 'rgba(255, 255, 255, 0.60)' }
          ]}
          pointerEvents="none"
        />
      )}
      <View style={[styles.topBarSide, !!centered && { width: typeof centered === 'number' ? centered : 48 }]}>
        {onBack !== undefined && (
          <IconButton label={backLabel ?? zhCN.common.back} icon={backIcon ?? ArrowLeft} onPress={onBack} hitSlop={8} />
        )}
      </View>
      <View style={styles.topBarTitles}>
        {onTitlePress === undefined
          ? <Text style={styles.topBarTitle} numberOfLines={titleLines} ellipsizeMode="tail">{title}</Text>
          : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={onTitlePress}
              hitSlop={4}
              style={({ pressed }) => [styles.topBarTitleRow, pressed && styles.iconButtonPressed]}
            >
              <Text style={[styles.topBarTitle, titleAccessory === undefined && styles.topBarTitleLink, { flexShrink: 1 }]} numberOfLines={titleLines} ellipsizeMode="tail">{title}</Text>
              {titleAccessory}
            </Pressable>
          )}
        {hasSubtitle && (
          onSubtitlePress === undefined
            ? <Text style={styles.topBarSubtitle} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
            : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={subtitle}
                onPress={onSubtitlePress}
                hitSlop={4}
                style={({ pressed }) => [styles.topBarSubtitleRow, pressed && styles.iconButtonPressed]}
              >
                <Text style={styles.topBarSubtitle} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
                <ChevronRight size={14} color={colors.subtle} />
              </Pressable>
            )
        )}
      </View>
      <View style={[styles.topBarSide, styles.topBarTrailing, !!centered && { width: typeof centered === 'number' ? centered : 48 }]}>
        {action !== undefined && action !== null && (
          <View style={styles.topBarActions}>{action}</View>
        )}
      </View>
    </View>
  )
}

export function IconButton({ label, icon: Icon, onPress, disabled = false, tint, fill, dense = false, hitSlop }: {
  label: string
  icon: ComponentType<{ size?: number; color?: string; fill?: string; strokeWidth?: number }>
  onPress: () => void
  disabled?: boolean
  /** Overrides the default `ink` glyph color, e.g. to mark an active toggle. */
  tint?: string
  /**
   * Fills closed icon paths; defaults to `none`. Passing an undefined `fill`
   * through to lucide would clobber its `fill: none` default, and
   * `react-native-svg` then falls back to the SVG spec default of black, which
   * paints solid interiors in the light theme.
   */
  fill?: string
  /** Tighter 40dp box for rows with several trailing actions; hitSlop keeps a 48dp target. */
  dense?: boolean
  /** Optional larger touch expansion for controls placed at screen edges. */
  hitSlop?: number
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={hitSlop ?? (dense ? 4 : 8)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        dense && styles.iconButtonDense,
        pressed && styles.iconButtonPressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon size={dense ? 20 : 21} color={tint ?? colors.ink} fill={fill ?? 'none'} strokeWidth={2} />
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
      {onRetry !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={zhCN.common.retry} style={styles.errorButton} onPress={onRetry}><Text style={styles.errorAction}>{zhCN.common.retry}</Text></Pressable>}
      {onDismiss !== undefined && <Pressable accessibilityRole="button" accessibilityLabel={zhCN.common.close} style={styles.errorButton} onPress={onDismiss}><Text style={styles.errorAction}>{zhCN.common.close}</Text></Pressable>}
    </View>
  )
}

export function EmptyState({ icon: Icon = WifiOff, title, body, action }: {
  icon?: LucideIcon
  title: ReactNode
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

export function KeyValue({ label, value, mono = false, onPress, expanded }: { label: string; value: string; mono?: boolean; onPress?: () => void; expanded?: boolean }) {
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.keyValue}>
      <Text style={styles.keyLabel}>{label}</Text>
      {onPress === undefined
        ? <Text style={[styles.keyValueText, mono && styles.mono]} selectable={mono}>{value}</Text>
        : <Pressable accessibilityRole="link" accessibilityLabel={`${label}: ${value}`} accessibilityState={expanded === undefined ? undefined : { expanded }} onPress={onPress} hitSlop={8} style={styles.keyValueLinkTarget}>
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
    topBar: { minHeight: 60, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator, backgroundColor: colors.surface },
    frameContent: { flex: 1 },
    frameFade: { position: 'absolute', top: '100%', left: 0, right: 0, height: spacing.lg },
    frameHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
    topBarBlurred: { backgroundColor: 'transparent', borderBottomWidth: 0 },
    topBarWithSubtitle: { minHeight: 68, paddingVertical: spacing.sm },
    topBarSide: { minWidth: 48, flexDirection: 'row', alignItems: 'center' },
    topBarTrailing: { justifyContent: 'flex-end' },
    topBarActions: { flexDirection: 'row', alignItems: 'center' },
    topBarTitles: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, gap: 1 },
    topBarTitle: {
      ...type.heading,
      fontSize: 16,
      lineHeight: 22,
      textAlign: 'center',
      color: colors.ink,
      fontWeight: '700',
    },
    topBarTitleLink: { flexShrink: 1 },
    topBarTitleRow: { alignSelf: 'stretch', minHeight: 48, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, borderRadius: radius.pill },
    topBarSubtitleRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, paddingHorizontal: spacing.xs, borderRadius: radius.pill },
    topBarSubtitle: { ...type.caption, color: colors.muted, textAlign: 'center', flexShrink: 1 },
    iconButton: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    iconButtonDense: { width: 40, height: 40 },
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
    errorBanner: { marginHorizontal: spacing.lg, marginTop: spacing.sm, borderRadius: radius.md, padding: spacing.sm, backgroundColor: colors.dangerSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    errorBannerText: { ...type.small, color: colors.ink, flex: 1, minWidth: 0 },
    errorButton: { minWidth: 44, minHeight: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
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
    keyLabel: { ...type.small, color: colors.muted, maxWidth: '40%' },
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
