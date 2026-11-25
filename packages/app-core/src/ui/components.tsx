import { createContext, useContext, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react'
import {
  ActivityIndicator,
  Platform,
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
import { AlertCircle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, RefreshCw, WifiOff, type LucideIcon } from 'lucide-react-native'
import { floatingShadow, radius, spacing, type } from './theme'
import { androidRipple, continuousRadius, elevationStyle, monoFontFamily } from './platform-style'
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
/** Set inside the TopBar's floating chips so icon buttons size themselves to the chip. */
const FloatingChipContext = createContext(false)

/** Frosted backdrop shared by overlaid headers inside `BlurHeaderFrame`. */
export function HeaderBlurBackdrop() {
  const { scheme } = useTheme()
  const blurTarget = useContext(HeaderBlurTargetContext)
  if (blurTarget === undefined) return null
  return (
    <>
      <BlurView
        blurTarget={blurTarget}
        blurMethod="dimezisBlurViewSdk31Plus"
        intensity={50}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
        pointerEvents="none"
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: scheme === 'dark' ? 'rgba(11, 13, 17, 0.72)' : 'rgba(248, 248, 248, 0.85)' },
        ]}
        pointerEvents="none"
      />
    </>
  )
}

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

export function TopBar({
  title,
  subtitle,
  subtitleLabel,
  subtitleAccessory,
  onSubtitlePress,
  onTitlePress,
  onBack,
  backIcon,
  backLabel,
  action,
  titleLines = 1,
  titleAccessory,
  titleAlign = 'center',
  centered = false,
}: {
  title: string
  titleAccessory?: ReactNode
  titleAlign?: 'center' | 'left' | 'between'
  centered?: boolean | number
  subtitle?: string
  subtitleLabel?: string
  subtitleAccessory?: ReactNode
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
  const leftAligned = titleAlign === 'left'
  const betweenAligned = titleAlign === 'between'
  const compactHeader = leftAligned || betweenAligned
  const tallerBar = (!compactHeader && hasSubtitle) || titleLines > 1
  const showLeadingSide = !compactHeader || onBack !== undefined
  const showTrailingSide = !compactHeader || (action !== undefined && action !== null)
  const titleRowHitSlop = compactHeader && hasSubtitle ? { top: 10, bottom: 2, left: 6, right: 6 } : 4
  const subtitleRowHitSlop = compactHeader ? { top: 2, bottom: 10, left: 6, right: 6 } : 4
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
            { backgroundColor: scheme === 'dark' ? 'rgba(11, 13, 17, 0.72)' : 'rgba(248, 248, 248, 0.85)' }
          ]}
          pointerEvents="none"
        />
      )}
      {showLeadingSide && (
        <View style={[styles.topBarSide, !compactHeader && !!centered && { width: typeof centered === 'number' ? centered : 48 }]}>
          {onBack !== undefined && (
            <View style={styles.floatingChip}>
              <FloatingChipContext.Provider value>
                <IconButton label={backLabel ?? zhCN.common.back} icon={backIcon ?? (Platform.OS === 'ios' ? ChevronLeft : ArrowLeft)} onPress={onBack} hitSlop={8} />
              </FloatingChipContext.Provider>
            </View>
          )}
        </View>
      )}
      <View
        style={[
          styles.topBarTitles,
          compactHeader && styles.topBarTitlesCompact,
          leftAligned && styles.topBarTitlesLeft,
          leftAligned && !showLeadingSide && { paddingLeft: 0 },
          betweenAligned && styles.topBarTitlesBetween,
        ]}
      >
        {onTitlePress === undefined
          ? (
            titleAccessory === undefined
              ? <Text style={[styles.topBarTitle, compactHeader && styles.topBarTitleCompact, leftAligned && styles.topBarTitleLeft]} numberOfLines={titleLines} ellipsizeMode="tail">{title}</Text>
              : (
                <View
                  style={[
                    compactHeader ? styles.topBarTitleRowCompact : styles.topBarTitleRow,
                    betweenAligned && styles.topBarTitleRowBetween,
                    compactHeader && !hasSubtitle && styles.topBarTitleRowCompactSingle,
                  ]}
                >
                  <Text style={[styles.topBarTitle, compactHeader && styles.topBarTitleCompact, leftAligned && styles.topBarTitleLeft, { flexShrink: 1 }]} numberOfLines={titleLines} ellipsizeMode="tail">{title}</Text>
                  {titleAccessory}
                </View>
              )
          )
          : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={title}
              onPress={onTitlePress}
              hitSlop={titleRowHitSlop}
              style={({ pressed }) => [
                compactHeader ? styles.topBarTitleRowCompact : styles.topBarTitleRow,
                betweenAligned && styles.topBarTitleRowBetween,
                compactHeader && !hasSubtitle && styles.topBarTitleRowCompactSingle,
                pressed && styles.iconButtonPressed,
              ]}
            >
              <Text style={[styles.topBarTitle, compactHeader && styles.topBarTitleCompact, leftAligned && styles.topBarTitleLeft, titleAccessory === undefined && styles.topBarTitleLink, { flexShrink: 1 }]} numberOfLines={titleLines} ellipsizeMode="tail">{title}</Text>
              {titleAccessory}
            </Pressable>
          )}
        {hasSubtitle && (
          onSubtitlePress === undefined
            ? <Text style={[styles.topBarSubtitle, compactHeader && styles.topBarSubtitleCompact, leftAligned && styles.topBarSubtitleLeft]} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
            : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={subtitleLabel ?? subtitle}
                onPress={onSubtitlePress}
                hitSlop={subtitleRowHitSlop}
                style={({ pressed }) => [
                  compactHeader ? styles.topBarSubtitleRowCompact : styles.topBarSubtitleRow,
                  betweenAligned && styles.topBarSubtitleRowBetween,
                  pressed && styles.iconButtonPressed,
                ]}
              >
                <Text style={[styles.topBarSubtitle, compactHeader && styles.topBarSubtitleCompact, leftAligned && styles.topBarSubtitleLeft]} numberOfLines={1} ellipsizeMode="tail">{subtitle}</Text>
                {subtitleAccessory ?? (compactHeader ? <ChevronDown size={13} color={colors.muted} /> : <ChevronRight size={14} color={colors.subtle} />)}
              </Pressable>
            )
        )}
      </View>
      {showTrailingSide && (
        <View style={[styles.topBarSide, styles.topBarTrailing, !compactHeader && !!centered && { width: typeof centered === 'number' ? centered : 48 }]}>
          {action !== undefined && action !== null && (
            <View style={[styles.floatingChip, styles.topBarActions]}>
              <FloatingChipContext.Provider value>{action}</FloatingChipContext.Provider>
            </View>
          )}
        </View>
      )}
    </View>
  )
}

export function IconButton({ label, icon: Icon, onPress, disabled = false, tint, fill, dense = false, hitSlop, filled = false, large = false }: {
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
  /** Larger 56dp controls for touch-first toolbars. */
  large?: boolean
  /** Optional larger touch expansion for controls placed at screen edges. */
  hitSlop?: number
  /** Solid DeepSeek-blue disc for the screen's primary action (e.g. create). */
  filled?: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const inChip = useContext(FloatingChipContext)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={hitSlop ?? (dense ? 4 : 8)}
      android_ripple={androidRipple(colors, true)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        dense && styles.iconButtonDense,
        inChip && styles.iconButtonInChip,
        large && styles.iconButtonLarge,
        filled && styles.iconButtonFilled,
        pressed && (filled ? styles.iconButtonFilledPressed : styles.iconButtonPressed),
        disabled && styles.disabled,
      ]}
    >
      <Icon size={large ? 25 : dense || inChip ? 20 : 21} color={filled ? (colors.onPrimary ?? colors.white) : tint ?? colors.ink} fill={fill ?? 'none'} strokeWidth={filled ? 2.2 : 1.9} />
    </Pressable>
  )
}

export function Button({ label, onPress, icon: Icon, variant = 'primary', loading = false, disabled = false }: {
  label: string
  onPress: () => void
  icon?: LucideIcon
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet' | 'inverse'
  loading?: boolean
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const isDisabled = disabled || loading
  const variantStyle =
    variant === 'primary' ? styles.buttonPrimary
      : variant === 'secondary' ? styles.buttonSecondary
        : variant === 'danger' ? styles.buttonDanger
          : variant === 'inverse' ? styles.buttonInverse
            : styles.buttonQuiet
  const foregroundColor =
    variant === 'inverse' ? colors.onInverse
      : variant === 'primary' ? (colors.onPrimary ?? colors.white)
        : variant === 'danger' ? colors.white
          : colors.ink
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      android_ripple={androidRipple(colors)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variantStyle,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.disabled,
      ]}
    >
      {loading
        ? <ActivityIndicator size="small" color={foregroundColor} />
        : Icon !== undefined && <Icon size={19} color={foregroundColor} />}
      <Text style={[styles.buttonText, variant === 'primary' && styles.buttonTextPrimary, variant === 'danger' && styles.buttonTextOnColor, variant === 'inverse' && { color: colors.onInverse }]}>{label}</Text>
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
      android_ripple={androidRipple(colors)}
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

/** Rounded inset section, the settings-style container used across screens. */
export function GroupCard({ children, style, raised = false }: { children: ReactNode; style?: StyleProp<ViewStyle>; raised?: boolean }) {
  const styles = useThemedStyles(createStyles)
  // A raised card casts its shadow from an unclipped shell and clips rows in an inner layer.
  if (raised) return <View style={[styles.groupCardRaised, style]}><View style={styles.groupCardClip}>{children}</View></View>
  return <View style={[styles.groupCard, style]}>{children}</View>
}

/**
 * One row of a `GroupCard`: leading line icon, label, optional trailing value
 * or accessory and a chevron when pressable. Rows after the first draw an
 * inset separator aligned with the label.
 */
export function GroupRow({ icon: Icon, iconSpace = false, label, detail, value, accessory, onPress, first = false, danger = false, chevron, selected = false, accessibilityLabel, disabled = false }: {
  icon?: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
  /** Keep the icon column empty so the label lines up with iconed sibling rows. */
  iconSpace?: boolean
  label: string
  detail?: string
  value?: string
  accessory?: ReactNode
  onPress?: () => void
  first?: boolean
  danger?: boolean
  chevron?: boolean
  selected?: boolean
  accessibilityLabel?: string
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const showChevron = chevron ?? (onPress !== undefined && accessory === undefined)
  const content = ({ pressed }: { pressed: boolean }) => (
    <View style={[styles.groupRow, pressed && styles.groupRowPressed]}>
      {Icon !== undefined
        ? <View style={styles.groupRowIcon}><Icon size={21} color={danger ? colors.danger : selected ? colors.primary : colors.ink} strokeWidth={1.8} /></View>
        : iconSpace && <View style={styles.groupRowIcon} />}
      <View style={[styles.groupRowBody, !first && styles.groupRowDivider]}>
        <View style={styles.groupRowCopy}>
          <Text style={[styles.groupRowLabel, danger && { color: colors.danger }, selected && { color: colors.primary }]} numberOfLines={1}>{label}</Text>
          {detail !== undefined && <Text style={styles.groupRowDetail} numberOfLines={3}>{detail}</Text>}
        </View>
        {value !== undefined && <Text style={styles.groupRowValue} numberOfLines={1}>{value}</Text>}
        {accessory}
        {showChevron && <ChevronRight size={19} color={colors.subtle} />}
      </View>
    </View>
  )
  if (onPress === undefined) return content({ pressed: false })
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      android_ripple={androidRipple(colors)}
      onPress={onPress}
      style={disabled ? styles.disabled : undefined}
    >
      {content}
    </Pressable>
  )
}

/** Rounded filter pill with an optional count, as in "全部 3 · 已归档 1". */
export function FilterChip({ label, count, selected, onPress, icon: Icon }: {
  label: string
  count?: number
  selected: boolean
  onPress: () => void
  icon?: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label} ${count}`}
      accessibilityState={{ selected }}
      android_ripple={androidRipple(colors)}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.filterChip, selected && styles.filterChipSelected, pressed && styles.buttonPressed]}
    >
      {Icon !== undefined && <Icon size={15} color={selected ? colors.ink : colors.muted} strokeWidth={2} />}
      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]} numberOfLines={1}>{label}</Text>
      {count !== undefined && <Text style={styles.filterChipCount}>{count}</Text>}
    </Pressable>
  )
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
  const raisedLight = colors.card === colors.cardOpaque
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    screenContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
    topBar: { minHeight: 60, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background },
    frameContent: { flex: 1 },
    frameHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
    topBarBlurred: { backgroundColor: 'transparent', borderBottomWidth: 0 },
    topBarWithSubtitle: { minHeight: 68, paddingVertical: spacing.sm },
    topBarSide: { minWidth: 44, flexDirection: 'row', alignItems: 'center' },
    // Floating chip: a white disc for one control, a capsule for several.
    floatingChip: { minWidth: 44, height: 44, ...continuousRadius(radius.pill), backgroundColor: colors.elevated, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...floatingShadow(colors) },
    topBarTrailing: { justifyContent: 'flex-end' },
    topBarActions: { paddingHorizontal: 2, gap: 0 },
    topBarTitles: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, gap: 1 },
    topBarTitlesCompact: { gap: 2 },
    topBarTitlesLeft: { alignItems: 'flex-start', paddingLeft: spacing.sm, paddingRight: spacing.xs },
    topBarTitlesBetween: { alignItems: 'center', paddingHorizontal: spacing.sm },
    topBarTitle: {
      ...type.heading,
      fontSize: 17,
      lineHeight: 22,
      textAlign: 'center',
      color: colors.ink,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    topBarTitleCompact: { fontSize: 15.5, lineHeight: 20 },
    topBarTitleLeft: { textAlign: 'left' },
    topBarTitleLink: { flexShrink: 1 },
    topBarTitleRow: { alignSelf: 'stretch', minHeight: 48, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: spacing.xs, borderRadius: radius.pill },
    topBarTitleRowCompact: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6, borderRadius: radius.sm },
    topBarTitleRowBetween: { alignSelf: 'center', justifyContent: 'center' },
    topBarTitleRowCompactSingle: { minHeight: 40 },
    topBarSubtitleRow: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, paddingHorizontal: spacing.xs, borderRadius: radius.pill },
    topBarSubtitleRowCompact: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 3, borderRadius: radius.sm },
    topBarSubtitleRowBetween: { alignSelf: 'center', justifyContent: 'center', paddingLeft: 13 },
    topBarSubtitle: { ...type.caption, color: colors.muted, textAlign: 'center', flexShrink: 1 },
    topBarSubtitleCompact: { fontSize: 12, lineHeight: 16 },
    topBarSubtitleLeft: { textAlign: 'left' },
    iconButton: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
    iconButtonDense: { width: 40, height: 40 },
    iconButtonInChip: { width: 40, height: 40 },
    iconButtonLarge: { width: 56, height: 56 },
    iconButtonPressed: { backgroundColor: colors.surfaceStrong },
    iconButtonFilled: { backgroundColor: colors.primary },
    iconButtonFilledPressed: { backgroundColor: colors.primaryPressed },
    button: { minHeight: 50, paddingHorizontal: spacing.xl, ...continuousRadius(radius.pill), flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center' },
    buttonPrimary: { backgroundColor: colors.primary },
    buttonSecondary: { backgroundColor: colors.surfaceStrong },
    buttonDanger: { backgroundColor: colors.danger },
    buttonQuiet: { backgroundColor: 'transparent' },
    buttonInverse: { backgroundColor: colors.inverse },
    buttonPressed: { opacity: 0.82 },
    buttonText: { ...type.bodyStrong, color: colors.ink },
    buttonTextPrimary: { color: colors.onPrimary ?? colors.white },
    buttonTextOnColor: { color: colors.white },
    disabled: { opacity: 0.52 },
    field: { gap: 7 },
    fieldLabel: { ...type.smallStrong, color: colors.ink },
    input: { minHeight: 52, ...continuousRadius(radius.lg), borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, backgroundColor: colors.surface, ...type.body, color: colors.ink },
    inputMultiline: { minHeight: 104, paddingTop: spacing.sm, textAlignVertical: 'top' },
    inputError: { borderColor: colors.danger },
    fieldHint: { ...type.small, color: colors.muted },
    fieldError: { ...type.small, color: colors.danger },
    badge: { height: 28, paddingHorizontal: 10, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6 },
    badgeDot: { width: 7, height: 7, borderRadius: radius.pill },
    badgeText: { ...type.caption },
    errorBanner: { marginHorizontal: spacing.lg, marginTop: spacing.sm, ...continuousRadius(radius.lg), padding: spacing.sm, backgroundColor: colors.dangerSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    errorBannerText: { ...type.small, color: colors.ink, flex: 1, minWidth: 0 },
    errorButton: { minWidth: 44, minHeight: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
    errorAction: { ...type.smallStrong, color: colors.danger, paddingVertical: 2 },
    emptyState: { paddingVertical: 56, alignItems: 'center', paddingHorizontal: spacing.xl },
    emptyIcon: { width: 56, height: 56, borderRadius: radius.xl, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
    emptyTitle: { ...type.heading, color: colors.ink, textAlign: 'center' },
    emptyBody: { ...type.body, color: colors.muted, textAlign: 'center', marginTop: spacing.xs, maxWidth: 320 },
    emptyAction: { marginTop: spacing.xl, alignSelf: 'stretch' },
    listRow: { minHeight: 82, paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    listRowPressed: { backgroundColor: colors.surfaceStrong },
    rowIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, gap: 3 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
    rowTitle: { ...type.bodyStrong, color: colors.ink, flex: 1 },
    rowDetailLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    rowSubtitle: { ...type.small, color: colors.muted },
    rowInlineSubtitle: { flex: 1 },
    rowMeta: { ...type.caption, color: colors.muted },
    sectionTitleRow: { minHeight: 36, marginTop: spacing.xl, marginBottom: spacing.xs, paddingLeft: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { ...type.small, fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.muted },
    keyValue: { paddingVertical: spacing.sm, flexDirection: 'row', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    keyLabel: { ...type.small, color: colors.muted, maxWidth: '40%' },
    keyValueText: { ...type.smallStrong, color: colors.ink, flex: 1, textAlign: 'right' },
    keyValueLinkTarget: { flex: 1 },
    keyValueLink: { color: colors.primary },
    keyValueLinkPressed: { opacity: 0.65 },
    mono: { fontFamily: monoFontFamily, fontWeight: '500' },
    skeletonRow: { height: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
    skeletonIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.surfaceStrong },
    skeletonCopy: { flex: 1, gap: spacing.xs },
    skeletonTitle: { width: '54%', height: 14, borderRadius: 4, backgroundColor: colors.surfaceStrong },
    skeletonText: { width: '78%', height: 11, borderRadius: 4, backgroundColor: colors.surface },
    successNotice: { padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.successSoft, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    successNoticeText: { ...type.small, color: colors.ink, flex: 1 },
    groupCard: { ...continuousRadius(radius.xl), backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, overflow: 'hidden' },
    groupCardRaised: { ...continuousRadius(radius.xl), backgroundColor: colors.cardOpaque, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...(raisedLight ? elevationStyle(colors, 1) : elevationStyle(colors, 0)) },
    groupCardClip: { ...continuousRadius(radius.xl), overflow: 'hidden' },
    groupRow: { minHeight: 58, paddingLeft: spacing.md, flexDirection: 'row', alignItems: 'center' },
    groupRowPressed: { backgroundColor: colors.surfaceStrong },
    groupRowIcon: { width: 28, marginRight: spacing.sm, alignItems: 'center', justifyContent: 'center' },
    groupRowBody: { flex: 1, minWidth: 0, minHeight: 58, paddingRight: spacing.md, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    groupRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    groupRowCopy: { flex: 1, minWidth: 0, gap: 2 },
    groupRowLabel: { ...type.body, fontSize: 16, color: colors.ink },
    groupRowDetail: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted },
    groupRowValue: { ...type.small, fontSize: 15, color: colors.muted, maxWidth: '45%' },
    filterChip: { height: 36, paddingHorizontal: 14, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'transparent' },
    filterChipSelected: { backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...floatingShadow(colors) },
    filterChipText: { ...type.small, fontSize: 15, color: colors.muted },
    filterChipTextSelected: { color: colors.ink, fontWeight: '600' },
    filterChipCount: { ...type.small, fontSize: 15, color: colors.subtle },
  })
}
