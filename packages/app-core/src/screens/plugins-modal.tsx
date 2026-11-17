import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Alert } from '../ui/alert'
import { Toggle } from '../ui/toggle'
import { ArrowLeft, Check, ChevronRight, Copy, Download, Puzzle, RefreshCw, Smartphone, X } from 'lucide-react-native'
import { SvgXml } from 'react-native-svg'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { HarnessSettingsNamespace, HarnessSettingsPathOp } from '@dsh-remote/client-core'
import { strings } from '../locales/i18n'
import {
  loadPluginInventory,
  mutatePluginSettings,
  schemaFields,
  setPluginEnabled,
  type PluginBundleView,
  type PluginCategory,
  type PluginInventory,
  type PluginRowView,
  type SchemaField,
} from '../services/plugin-inventory'
import { sessionToolsError } from './session-tools-error'
import { floatingShadow, radius, spacing, type } from '../ui/theme'
import { useTheme, type ThemeColors } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'

export interface PluginsModalProps {
  visible: boolean
  onClose: () => void
}

/** Official Host plugin manager: switch bundles/components and edit their schema-derived settings. */
export function PluginsModal({ visible, onClose }: PluginsModalProps) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const insets = useSafeAreaInsets()
  const [inventory, setInventory] = useState<PluginInventory>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [busy, setBusy] = useState<string[]>([])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setInventory(await loadPluginInventory())
    } catch (cause) {
      // Older Hosts reject the plugin-manager endpoints with METHOD_NOT_ALLOWED.
      // Keep the page usable and show the same localized upgrade guidance as the
      // other Remote tools instead of exposing the raw gateway error.
      setError(sessionToolsError(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) void reload()
    else {
      setSelected(undefined)
      setInventory(undefined)
    }
  }, [visible, reload])

  const bundle = useMemo(() => inventory?.bundles.find(item => item.name === selected), [inventory, selected])

  const toggle = async (kind: 'bundle' | 'plugin', target: string, enabled: boolean) => {
    const key = `${kind}:${target}`
    if (busy.includes(key)) return
    setBusy(current => [...current, key])
    try {
      const application = await setPluginEnabled(kind, target, enabled)
      if (application === 'restart-required') Alert.alert(strings.plugins.title, strings.plugins.restartRequired)
      else if (application === 'overridden') Alert.alert(strings.plugins.title, strings.plugins.overridden)
      else if (application === 'cancelled') Alert.alert(strings.plugins.title, strings.plugins.cancelled)
    } catch (cause) {
      Alert.alert(strings.plugins.toggleFailed, cause instanceof Error ? cause.message : '')
    } finally {
      setBusy(current => current.filter(item => item !== key))
      await reload()
    }
  }

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={bundle === undefined ? strings.common.close : strings.common.back}
        onPress={() => bundle === undefined ? onClose() : setSelected(undefined)}
        hitSlop={8}
        style={styles.headerBtn}
      >
        {bundle === undefined ? <X size={20} color={colors.ink} /> : <ArrowLeft size={20} color={colors.ink} />}
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{bundle?.title ?? strings.plugins.title}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.plugins.retry}
        onPress={() => void reload()}
        disabled={loading}
        hitSlop={8}
        style={styles.headerBtn}
      >
        {loading ? <ActivityIndicator size="small" color={colors.muted} /> : <RefreshCw size={18} color={colors.ink} />}
      </Pressable>
    </View>
  )

  let body
  if (inventory === undefined) {
    body = (
      <View style={styles.center}>
        {error === undefined ? (
          <>
            <ActivityIndicator color={colors.muted} />
            <Text style={styles.muted}>{strings.plugins.loading}</Text>
          </>
        ) : (
          <>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void reload()} style={styles.outlineBtn}>
              <Text style={styles.outlineBtnText}>{strings.plugins.retry}</Text>
            </Pressable>
          </>
        )}
      </View>
    )
  } else if (bundle !== undefined) {
    body = (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <BundleCard bundle={bundle} first busy={busy.includes(`bundle:${bundle.name}`)} onToggle={value => void toggle('bundle', bundle.name, value)} />
        </View>
        {bundle.category === 'remote' && (!bundle.available || bundle.upgradeFor !== undefined) && <InstallHint bundle={bundle} />}
        {bundle.rows.length > 1 && <Text style={styles.sectionTitle}>{strings.plugins.components}</Text>}
        {bundle.rows.map(row => (
          <RowCard
            key={row.rowId}
            row={row}
            bundleEnabled={bundle.enabled}
            single={bundle.rows.length === 1}
            busy={row.entryId !== undefined && busy.includes(`plugin:${row.entryId}`)}
            writable={inventory.settingsWritable}
            onToggle={value => row.entryId !== undefined && void toggle('plugin', row.entryId, value)}
            onSaved={() => void reload()}
          />
        ))}
      </ScrollView>
    )
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>{strings.plugins.subtitle}</Text>
        {error !== undefined && <Text style={styles.errorText}>{error}</Text>}
        {inventory.bundles.length === 0 && <Text style={styles.muted}>{strings.plugins.empty}</Text>}
        {SECTIONS.map(section => {
          const items = inventory.bundles.filter(item => item.category === section.category)
          if (items.length === 0) return null
          return (
            <View key={section.category} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title()}</Text>
              {section.hint !== undefined && <Text style={styles.sectionHint}>{section.hint()}</Text>}
              <View style={styles.group}>
                {items.map((item, index) => (
                  <BundleCard
                    key={item.name}
                    bundle={item}
                    first={index === 0}
                    busy={busy.includes(`bundle:${item.name}`)}
                    onToggle={value => void toggle('bundle', item.name, value)}
                    onOpen={() => setSelected(item.name)}
                  />
                ))}
              </View>
            </View>
          )
        })}
      </ScrollView>
    )
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={() => bundle === undefined ? onClose() : setSelected(undefined)}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {header}
        {body}
      </View>
    </Modal>
  )
}

const SECTIONS: { category: PluginCategory; title: () => string; hint?: () => string }[] = [
  { category: 'remote', title: () => strings.plugins.categoryRemote, hint: () => strings.plugins.categoryRemoteHint },
  { category: 'installed', title: () => strings.plugins.categoryInstalled },
  { category: 'experimental', title: () => strings.plugins.categoryExperimental },
]

/** Manifest icon (SVG or raster data URL); falls back to a generic glyph. */
function PluginIcon({ icon, remote }: { icon?: string; remote: boolean }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const svg = useMemo(() => {
    const match = icon === undefined ? null : /^data:image\/svg\+xml;base64,(.+)$/.exec(icon)
    if (match === null || typeof globalThis.atob !== 'function') return undefined
    try {
      const binary = globalThis.atob(match[1] ?? '')
      // UTF-8 bytes from atob's Latin-1 string; plain ASCII SVG passes through unchanged.
      return decodeURIComponent(Array.from(binary, char => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
    } catch {
      return undefined
    }
  }, [icon])
  let glyph
  if (svg !== undefined) glyph = <SvgXml xml={svg} width={26} height={26} />
  else if (icon !== undefined && !icon.startsWith('data:image/svg')) glyph = <Image source={{ uri: icon }} style={styles.iconImage} />
  else glyph = remote ? <Smartphone size={20} color={colors.primary} /> : <Puzzle size={20} color={colors.primary} />
  return <View style={styles.icon}>{glyph}</View>
}

function BundleCard({ bundle, busy, first, onToggle, onOpen }: {
  bundle: PluginBundleView
  busy: boolean
  first?: boolean
  onToggle: (enabled: boolean) => void
  onOpen?: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const locked = bundle.readOnly || (!bundle.available && !bundle.enabled)
  const detail = onOpen === undefined
  const status = !bundle.available
    ? strings.plugins.installOnDesktop
    : bundle.readOnly ? strings.plugins.readOnly : undefined
  return (
    <View style={[styles.item, first !== true && styles.itemDivider]}>
      <Pressable
        accessibilityRole={detail ? undefined : 'button'}
        accessibilityLabel={bundle.title}
        onPress={onOpen}
        disabled={detail}
        style={({ pressed }) => [styles.itemMain, pressed && !detail && styles.pressed]}
      >
        <PluginIcon icon={bundle.icon} remote={bundle.category === 'remote'} />
        <View style={styles.cardText}>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{bundle.title}</Text>
            {bundle.category === 'experimental' && <Text style={styles.badge}>{strings.plugins.experimental}</Text>}
            {bundle.category === 'remote' && <Text style={[styles.badge, styles.badgeRemote]}>{strings.plugins.remoteBadge}</Text>}
          </View>
          {bundle.description !== undefined && (
            <Text style={styles.cardDescription} numberOfLines={detail ? undefined : 2}>{bundle.description}</Text>
          )}
          {detail && bundle.remoteFeature !== undefined && (
            <View style={styles.featureBox}>
              <Smartphone size={14} color={colors.primary} />
              <Text style={styles.featureText}>{bundle.remoteFeature}</Text>
            </View>
          )}
          {(detail || status !== undefined) && (
            <Text style={[styles.meta, !bundle.available && styles.metaWarning]} numberOfLines={2}>
              {[status, detail && bundle.version !== undefined ? `${strings.plugins.version} ${bundle.version}` : undefined,
                detail ? bundle.name : undefined].filter(Boolean).join(' · ')}
            </Text>
          )}
          {bundle.error !== undefined && <Text style={styles.errorText}>{bundle.error}</Text>}
        </View>
      </Pressable>
      <View style={styles.itemAction}>
        {busy ? <ActivityIndicator size="small" color={colors.muted} /> : (
          <Toggle
            accessibilityLabel={bundle.title}
            value={bundle.enabled}
            disabled={locked}
            onValueChange={onToggle}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.white}
          />
        )}
        {!detail && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={bundle.title}
            accessibilityElementsHidden
            importantForAccessibility="no"
            onPress={onOpen}
            hitSlop={8}
            style={({ pressed }) => [styles.itemChevron, pressed && styles.pressed]}
          >
            <ChevronRight size={16} color={colors.subtle} />
          </Pressable>
        )}
      </View>
    </View>
  )
}

/**
 * Plugins install on the computer only: show the exact commands for the profile
 * that runs Remote, ready to copy, instead of offering a remote install.
 */
function InstallHint({ bundle }: { bundle: PluginBundleView }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const upgrade = bundle.available && bundle.upgradeFor !== undefined
  const spec = upgrade ? `${bundle.name}@latest` : bundle.name
  const rows = [
    { label: strings.plugins.installDesktop, value: spec },
    { label: strings.plugins.installCli, value: `dsh plugin --profile web add -w ${spec}` },
  ]
  return (
    <View style={[styles.card, styles.hintCard]}>
      <View style={styles.titleRow}>
        <Download size={16} color={colors.primary} />
        <Text style={styles.cardTitle}>{upgrade ? strings.plugins.upgradeTitle : strings.plugins.installTitle}</Text>
      </View>
      <Text style={styles.cardDescription}>
        {upgrade ? strings.plugins.upgradeHint(bundle.upgradeFor ?? '') : strings.plugins.installHint}
      </Text>
      {rows.map(row => <CopyRow key={row.label} label={row.label} value={row.value} />)}
    </View>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <View style={styles.copyRow}>
      <Text style={styles.fieldHint}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${strings.plugins.copy}: ${value}`}
        onPress={() => void Clipboard.setStringAsync(value).then(() => setCopied(true)).catch(() => undefined)}
        style={({ pressed }) => [styles.codeBox, pressed && styles.pressed]}
      >
        <Text style={styles.codeText} selectable>{value}</Text>
        {copied ? <Check size={16} color={colors.success} /> : <Copy size={16} color={colors.muted} />}
      </Pressable>
    </View>
  )
}

function RowCard({ row, bundleEnabled, single, busy, writable, onToggle, onSaved }: {
  row: PluginRowView
  bundleEnabled: boolean
  single: boolean
  busy: boolean
  writable: boolean
  onToggle: (enabled: boolean) => void
  onSaved: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  return (
    <View style={styles.card}>
      {!single && <View style={styles.cardRow}>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle} numberOfLines={1}>{row.title}</Text>
          {row.description !== undefined && <Text style={styles.cardDescription}>{row.description}</Text>}
          <Text style={styles.meta} numberOfLines={1}>{row.moduleName}</Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={colors.muted} /> : (
          <Toggle
            accessibilityLabel={row.title}
            value={row.enabled}
            disabled={row.readOnly || !bundleEnabled}
            onValueChange={onToggle}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.white}
          />
        )}
      </View>}
      {row.enabled && row.settings !== undefined
        ? <SettingsForm key={`${row.settings.ns}:${row.settings.revision}`} settings={row.settings} writable={writable} onSaved={onSaved} />
        : single && <Text style={styles.muted}>{row.enabled ? strings.plugins.noSettings : strings.plugins.disabledLabel}</Text>}
    </View>
  )
}

type Draft = Record<string, string | boolean>

function initialDraft(fields: SchemaField[], value: unknown): Draft {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const draft: Draft = {}
  for (const field of fields) {
    const current = source[field.key] ?? field.defaultValue
    if (field.kind === 'boolean') draft[field.key] = current === true
    else if (field.kind === 'number') draft[field.key] = typeof current === 'number' ? String(current) : ''
    else if (field.kind === 'string') draft[field.key] = typeof current === 'string' ? current : ''
    else if (field.kind === 'string-list') draft[field.key] = Array.isArray(current) ? current.filter(item => typeof item === 'string').join('\n') : ''
  }
  return draft
}

function SettingsForm({ settings, writable, onSaved }: {
  settings: HarnessSettingsNamespace
  writable: boolean
  onSaved: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const fields = useMemo(() => schemaFields(settings.schema), [settings.schema])
  const initial = useMemo(() => initialDraft(fields, settings.value), [fields, settings.value])
  const [draft, setDraft] = useState<Draft>(initial)
  const [saving, setSaving] = useState(false)
  const [invalid, setInvalid] = useState<string>()

  const ops = (): HarnessSettingsPathOp[] | undefined => {
    const result: HarnessSettingsPathOp[] = []
    for (const field of fields) {
      const next = draft[field.key]
      if (next === undefined || next === initial[field.key]) continue
      if (field.kind === 'boolean') result.push({ op: 'set', path: [field.key], value: next === true })
      else if (field.kind === 'number') {
        const number = Number(String(next).trim())
        if (String(next).trim() === '' || !Number.isFinite(number)
          || (field.integer === true && !Number.isInteger(number))
          || (field.min !== undefined && number < field.min)
          || (field.max !== undefined && number > field.max)) {
          setInvalid(field.key)
          return undefined
        }
        result.push({ op: 'set', path: [field.key], value: number })
      } else if (field.kind === 'string') result.push({ op: 'set', path: [field.key], value: String(next) })
      else if (field.kind === 'string-list') {
        result.push({ op: 'set', path: [field.key], value: String(next).split('\n').map(line => line.trim()).filter(Boolean) })
      }
    }
    setInvalid(undefined)
    return result
  }

  const dirty = fields.some(field => draft[field.key] !== initial[field.key])

  const save = async () => {
    const changes = ops()
    if (changes === undefined || changes.length === 0) return
    setSaving(true)
    try {
      await mutatePluginSettings(settings.ns, changes, settings.revision)
      Alert.alert(strings.plugins.settings, strings.plugins.saved)
      onSaved()
    } catch (cause) {
      Alert.alert(strings.plugins.saveFailed, cause instanceof Error ? cause.message : '')
    } finally {
      setSaving(false)
    }
  }

  // Fields the person set over the composition defaults; unsetting them restores the defaults.
  const overridden = fields.filter(field => typeof settings.user === 'object' && settings.user !== null
    && Object.prototype.hasOwnProperty.call(settings.user, field.key)).map(field => field.key)

  const reset = () => {
    Alert.alert(strings.plugins.resetTitle, strings.plugins.resetConfirm, [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: strings.plugins.reset,
        style: 'destructive',
        onPress: async () => {
          setSaving(true)
          try {
            await mutatePluginSettings(settings.ns, overridden.map(key => ({ op: 'unset', path: [key] })), settings.revision)
            onSaved()
          } catch (cause) {
            Alert.alert(strings.plugins.saveFailed, cause instanceof Error ? cause.message : '')
          } finally {
            setSaving(false)
          }
        },
      },
    ])
  }

  const editable = writable && !saving
  return (
    <View style={styles.form}>
      <Text style={styles.sectionTitle}>{strings.plugins.settings}</Text>
      <Text style={styles.sectionHint}>{writable ? strings.plugins.liveHint : strings.plugins.settingsReadOnly}</Text>
      {fields.map(field => (
        <View key={field.key} style={styles.field}>
          <View style={styles.fieldHeader}>
            <View style={styles.cardText}>
              <Text style={styles.fieldLabel}>{field.description ?? field.key}</Text>
              <Text style={styles.fieldKey}>{field.key}</Text>
            </View>
            {field.kind === 'boolean' && (
              <Toggle
                accessibilityLabel={field.key}
                value={draft[field.key] === true}
                disabled={!editable}
                onValueChange={value => setDraft(current => ({ ...current, [field.key]: value }))}
                trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.white}
              />
            )}
          </View>
          {(field.kind === 'number' || field.kind === 'string' || field.kind === 'string-list') && (
            <TextInput
              accessibilityLabel={field.key}
              value={String(draft[field.key] ?? '')}
              editable={editable}
              onChangeText={text => {
                setDraft(current => ({ ...current, [field.key]: text }))
                if (invalid === field.key) setInvalid(undefined)
              }}
              keyboardType={field.kind === 'number' ? 'numeric' : 'default'}
              multiline={field.kind === 'string-list'}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={field.kind === 'string-list' ? strings.plugins.listHint : undefined}
              placeholderTextColor={colors.subtle}
              style={[styles.input, field.kind === 'string-list' && styles.inputMultiline, invalid === field.key && styles.inputInvalid]}
            />
          )}
          {field.kind === 'number' && (
            <Text style={[styles.fieldHint, invalid === field.key && styles.errorHint]}>
              {invalid === field.key ? `${strings.plugins.invalidNumber} ` : ''}
              {[field.min === undefined ? undefined : `≥ ${field.min}`, field.max === undefined ? undefined : `≤ ${field.max}`,
                field.defaultValue === undefined ? undefined : `${strings.plugins.defaultValue} ${String(field.defaultValue)}`]
                .filter(Boolean).join(' · ')}
            </Text>
          )}
          {(field.kind === 'unsupported' || field.secret === true) && <Text style={styles.fieldHint}>{strings.plugins.unsupportedField}</Text>}
        </View>
      ))}
      {writable && (
        <Pressable
          accessibilityRole="button"
          disabled={!dirty || saving}
          onPress={() => void save()}
          style={({ pressed }) => [styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled, pressed && styles.pressed]}
        >
          <Text style={styles.saveBtnText}>{saving ? strings.plugins.saving : strings.plugins.save}</Text>
        </Pressable>
      )}
      {writable && overridden.length > 0 && !dirty && (
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={reset}
          style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
        >
          <Text style={styles.resetBtnText}>{strings.plugins.reset}</Text>
        </Pressable>
      )}
    </View>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      height: 64,
      backgroundColor: colors.background,
    },
    headerBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.separator, ...floatingShadow(colors) },
    headerTitle: { ...type.heading, fontSize: 17, lineHeight: 22, fontWeight: '700', letterSpacing: -0.2, flex: 1, color: colors.ink, textAlign: 'center' },
    content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
    subtitle: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted, marginBottom: spacing.xs, paddingHorizontal: spacing.md },
    sectionTitle: { ...type.small, fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.muted, marginTop: spacing.md, paddingHorizontal: spacing.md },
    section: { gap: spacing.xs },
    sectionHint: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted, paddingHorizontal: spacing.md },
    group: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      overflow: 'hidden',
    },
    item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
    itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0, paddingRight: spacing.xs },
    itemAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 0 },
    itemChevron: { padding: spacing.xs, alignItems: 'center', justifyContent: 'center' },
    itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
    iconImage: { width: 26, height: 26 },
    badgeRemote: { color: colors.success, backgroundColor: colors.successSoft },
    featureBox: {
      flexDirection: 'row',
      gap: spacing.xs,
      alignItems: 'flex-start',
      backgroundColor: colors.primarySoft,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginTop: spacing.xs,
    },
    featureText: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.ink, flex: 1 },
    metaWarning: { color: colors.warning },
    fieldLabel: { ...type.smallStrong, fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.ink },
    resetBtn: { alignItems: 'center', paddingVertical: spacing.sm },
    hintCard: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
    copyRow: { gap: 4 },
    codeBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
    },
    codeText: { flex: 1, fontFamily: 'monospace', fontSize: 12, color: colors.ink },
    resetBtnText: { ...type.small, fontSize: 14, color: colors.muted },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
    muted: { ...type.body, color: colors.muted },
    errorText: { ...type.caption, color: colors.danger },
    outlineBtn: {
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    outlineBtnText: { ...type.bodyStrong, color: colors.ink },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      padding: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
      gap: spacing.sm,
    },
    pressed: { opacity: 0.7 },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    icon: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      backgroundColor: colors.primarySoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardText: { flex: 1, minWidth: 0, gap: 2 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    cardTitle: { ...type.bodyStrong, fontSize: 16, lineHeight: 22, color: colors.ink, flexShrink: 1 },
    badge: {
      ...type.caption,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      color: colors.primary,
      backgroundColor: colors.primarySoft,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    cardDescription: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted },
    meta: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.muted },
    form: { gap: spacing.sm },
    field: {
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
    },
    fieldHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    fieldKey: { fontFamily: 'monospace', fontSize: 12, color: colors.subtle },
    fieldDescription: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted },
    fieldHint: { ...type.small, fontSize: 13, lineHeight: 18, color: colors.muted },
    errorHint: { color: colors.danger },
    input: {
      ...type.body,
      color: colors.ink,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      backgroundColor: colors.surface,
    },
    inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
    inputInvalid: { borderColor: colors.danger },
    saveBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.pill,
      paddingVertical: spacing.sm + 2,
      alignItems: 'center',
      marginTop: spacing.xs,
    },
    saveBtnDisabled: { backgroundColor: colors.disabled },
    saveBtnText: { ...type.bodyStrong, color: colors.white },
  })
}
