import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import {
  ArrowUp,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Folder,
  Globe,
  Lock,
  Plus,
  RotateCw,
  Shield,
  Trash2,
  X,
} from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import {
  object,
  objects,
  text,
  type BotEntry,
  type BotObject,
  type BotOperation,
  type BotRemoteClient,
  type BotState,
} from '../../services/bot-catalog'
import { useAppStore } from '../../state/store'
import type { ScheduleCreateRequest } from '../../types'
import { Button } from '../../ui/components'
import { radius } from '../../ui/theme'
import { useTheme, type ThemeColors } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { ModalSurface } from '../chat/modal'
import { BotAvatar } from './avatar'

export type BotPerformFn = (
  operation: BotOperation,
  payload?: BotObject,
) => Promise<{ ok: boolean; value?: unknown }>

export function folderBasename(path?: string): string {
  const clean = String(path ?? '').replace(/[\\/]+$/, '')
  if (!clean) return ''
  return clean.split(/[\\/]/).pop() || clean
}

export function formatCompactTokens(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0'
  if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(1)}M`
  if (total >= 1_000) return `${(total / 1_000).toFixed(1)}K`
  return String(Math.round(total))
}

export function formatScheduleSummary(task: BotObject): string {
  const kind = text(task.kind) || text(object(task.schedule).kind)
  const time = (text(task.time) || text(object(task.schedule).time)).replace(/:00$/, '')
  if (kind === 'daily') return time ? `${s.bots.scheduleDaily} ${time}` : s.bots.scheduleDaily
  if (kind === 'weekly') return time ? `${s.bots.scheduleWeekly} ${time}` : s.bots.scheduleWeekly
  if (kind === 'every' || kind === 'interval') {
    const everySec = Number(task.everySeconds ?? Number(object(task.schedule).everyMs ?? 0) / 1000)
    if (everySec >= 86_400) return `${Math.round(everySec / 86_400)}d`
    if (everySec >= 3_600) return `${Math.round(everySec / 3_600)}h`
    if (everySec >= 60) return `${Math.max(1, Math.round(everySec / 60))}m`
    return s.bots.scheduleInterval
  }
  if (kind === 'at' || kind === 'once' || kind === 'after') {
    const scheduled = text(task.scheduledAt)
    if (scheduled) {
      const d = new Date(scheduled)
      if (!Number.isNaN(d.getTime())) {
        return `${s.bots.scheduleOnce} · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      }
    }
    return s.bots.scheduleOnce
  }
  return text(task.cadence) || text(task.expression) || s.bots.scheduledTasks
}

interface BrowserTabItem {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

function normalizeBrowserInput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === 'about:blank') return 'about:blank'
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`
}

function shortBrowserLabel(tab: BrowserTabItem): string {
  if (tab.title && tab.title !== 'about:blank') return tab.title
  if (!tab.url || tab.url === 'about:blank') return 'about:blank'
  return tab.url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
}

/**
 * Per-Bot embedded Browser pane modeled directly on DS-Bot's `browser-pane.js` (Figure 2):
 * - Top tab strip (`about:blank ×`)
 * - Bot automation banner (`Bot 正在控制此浏览器` · `接管` · `停止` / `你在控制此浏览器` · `交还`)
 * - Navigation bar (`<` `>` `↻` `[🌐 搜索或输入网址]` `+` `⤓/🛡`)
 * - Interactive WebView viewport (blank canvas on `about:blank`, live webview on http/https)
 */
export function BotBrowserPane({
  bot,
  perform,
}: {
  bot: BotEntry
  perform: BotPerformFn
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSharedStyles)
  const webViewRef = useRef<WebView | null>(null)

  const [tabs, setTabs] = useState<BrowserTabItem[]>([
    { id: 'tab-1', url: 'about:blank', title: 'about:blank', loading: false, canGoBack: false, canGoForward: false },
  ])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [addressDraft, setAddressDraft] = useState('')
  const [editingAddress, setEditingAddress] = useState(false)
  const [userHeld, setUserHeld] = useState(false)
  const [grantsOpen, setGrantsOpen] = useState(false)

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? tabs[0]!,
    [tabs, activeTabId],
  )

  const updateActiveTab = useCallback(
    (patch: Partial<BrowserTabItem>) => {
      setTabs(prev => prev.map(item => (item.id === activeTab.id ? { ...item, ...patch } : item)))
    },
    [activeTab.id],
  )

  const addNewTab = () => {
    const id = `tab-${Date.now()}`
    setTabs(prev => [
      ...prev,
      { id, url: 'about:blank', title: 'about:blank', loading: false, canGoBack: false, canGoForward: false },
    ])
    setActiveTabId(id)
    setAddressDraft('')
    setEditingAddress(false)
  }

  const closeTab = (id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) {
        return [{ id: 'tab-1', url: 'about:blank', title: 'about:blank', loading: false, canGoBack: false, canGoForward: false }]
      }
      const next = prev.filter(t => t.id !== id)
      if (activeTabId === id && next[0]) setActiveTabId(next[0].id)
      return next
    })
  }

  const submitAddress = () => {
    const nextUrl = normalizeBrowserInput(addressDraft)
    setEditingAddress(false)
    updateActiveTab({ url: nextUrl, title: nextUrl === 'about:blank' ? 'about:blank' : nextUrl })
  }

  const handleTakeover = async () => {
    setUserHeld(true)
    await perform('browser-takeover', { botId: bot.id }).catch(() => undefined)
  }

  const handleGiveBack = async () => {
    setUserHeld(false)
    await perform('browser-give-back', { botId: bot.id }).catch(() => undefined)
  }

  const handleStop = async () => {
    setUserHeld(true)
    webViewRef.current?.stopLoading()
    await perform('browser-stop', { botId: bot.id }).catch(() => undefined)
  }

  const isBlank = !activeTab.url || activeTab.url === 'about:blank'
  const isSecure = /^https:/i.test(activeTab.url)
  const grantCount = (bot.browserGrants ?? []).length

  return (
    <View style={styles.browserContainer}>
      {/* Browser Tab Strip */}
      <View style={styles.browserTabStrip}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.browserTabScroll}>
          {tabs.map(tab => {
            const active = tab.id === activeTab.id
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  setActiveTabId(tab.id)
                  setEditingAddress(false)
                }}
                style={[styles.browserTabChip, active && styles.browserTabChipActive]}
              >
                <Globe size={13} color={active ? colors.ink : colors.muted} />
                <Text numberOfLines={1} style={[styles.browserTabTitle, active && styles.browserTabTitleActive]}>
                  {shortBrowserLabel(tab)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => closeTab(tab.id)}
                  style={styles.browserTabClose}
                >
                  <X size={12} color={colors.muted} />
                </Pressable>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>

      {/* Bot Automation Control Banner (matches Figure 2) */}
      <View style={[styles.browserBanner, userHeld && styles.browserBannerHeld]}>
        <Text style={styles.browserBannerText} numberOfLines={1}>
          {userHeld ? s.bots.browserUserControls : s.bots.browserBotControls}
        </Text>
        <View style={styles.browserBannerActions}>
          {userHeld ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleGiveBack()}
              style={({ pressed }) => [styles.browserBannerBtn, pressed && { opacity: 0.75 }]}
            >
              <Text style={styles.browserBannerBtnText}>{s.bots.browserGiveBack}</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleTakeover()}
                style={({ pressed }) => [styles.browserBannerBtn, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.browserBannerBtnText}>{s.bots.browserTakeover}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void handleStop()}
                style={({ pressed }) => [styles.browserBannerBtn, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.browserBannerBtnText}>{s.bots.stop}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>

      {/* Navigation & Address Bar (matches Figure 2) */}
      <View style={styles.browserNavRow}>
        <Pressable
          accessibilityRole="button"
          disabled={!activeTab.canGoBack || isBlank}
          onPress={() => webViewRef.current?.goBack()}
          style={[styles.browserNavIconBtn, (!activeTab.canGoBack || isBlank) && { opacity: 0.35 }]}
        >
          <ChevronLeft size={18} color={colors.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!activeTab.canGoForward || isBlank}
          onPress={() => webViewRef.current?.goForward()}
          style={[styles.browserNavIconBtn, (!activeTab.canGoForward || isBlank) && { opacity: 0.35 }]}
        >
          <ChevronRight size={18} color={colors.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isBlank}
          onPress={() => (activeTab.loading ? webViewRef.current?.stopLoading() : webViewRef.current?.reload())}
          style={[styles.browserNavIconBtn, isBlank && { opacity: 0.45 }]}
        >
          {activeTab.loading ? <X size={16} color={colors.ink} /> : <RotateCw size={15} color={colors.ink} />}
        </Pressable>

        <View style={styles.browserAddressBox}>
          {isSecure ? <Lock size={13} color={colors.muted} /> : <Globe size={14} color={colors.muted} />}
          <TextInput
            value={editingAddress ? addressDraft : isBlank ? '' : activeTab.url}
            onFocus={() => {
              setAddressDraft(isBlank ? '' : activeTab.url)
              setEditingAddress(true)
            }}
            onBlur={() => setEditingAddress(false)}
            onChangeText={setAddressDraft}
            onSubmitEditing={submitAddress}
            placeholder={s.bots.browserAddressPlaceholder}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            style={styles.browserAddressInput}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.bots.browserNewTab}
          onPress={addNewTab}
          style={styles.browserNavIconBtn}
        >
          <Plus size={18} color={colors.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={s.bots.browserGrants}
          onPress={() => setGrantsOpen(true)}
          style={styles.browserNavIconBtn}
        >
          <Download size={16} color={grantCount > 0 ? colors.primary : colors.ink} />
        </Pressable>
      </View>

      {/* Viewport Area */}
      <View style={styles.browserViewport}>
        {isBlank ? (
          <View style={styles.browserBlankCanvas} />
        ) : (
          <WebView
            ref={webViewRef}
            source={{ uri: activeTab.url }}
            style={{ flex: 1 }}
            onNavigationStateChange={navState => {
              updateActiveTab({
                url: navState.url || activeTab.url,
                title: navState.title || navState.url || 'about:blank',
                loading: Boolean(navState.loading),
                canGoBack: Boolean(navState.canGoBack),
                canGoForward: Boolean(navState.canGoForward),
              })
            }}
          />
        )}
      </View>

      {/* Per-Bot Browser Site Permissions Sheet */}
      {grantsOpen && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setGrantsOpen(false)}>
          <ModalSurface onClose={() => setGrantsOpen(false)}>
            <View style={{ gap: 14 }}>
              <View style={styles.sheetHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Shield size={18} color={colors.primary} />
                  <Text style={styles.sheetTitle}>{s.bots.browserGrants}</Text>
                </View>
                <Pressable onPress={() => setGrantsOpen(false)} hitSlop={8}>
                  <X size={20} color={colors.muted} />
                </Pressable>
              </View>
              <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
                <BotBrowserGrantsSection bots={[bot]} fixedBot={bot} perform={perform} />
              </ScrollView>
            </View>
          </ModalSurface>
        </Modal>
      )}
    </View>
  )
}

/**
 * Browser site permissions editor modeled on `browser-settings.js`.
 */
export function BotBrowserGrantsSection({
  bots,
  fixedBot,
  perform,
}: {
  bots: BotEntry[]
  fixedBot?: BotEntry
  perform: BotPerformFn
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSharedStyles)
  const [adding, setAdding] = useState(false)
  const [pickedBotId, setPickedBotId] = useState(fixedBot?.id ?? bots[0]?.id ?? '')
  const [site, setSite] = useState('')
  const [actions, setActions] = useState<string[]>(['post'])
  const [duration, setDuration] = useState<'hour' | 'today' | 'week' | 'always'>('always')

  const rows = useMemo(
    () =>
      bots.flatMap(bot =>
        (bot.browserGrants ?? []).map((grant, idx) => ({
          key: `${bot.id}-${idx}-${text(grant.site)}`,
          bot,
          grant,
        })),
      ),
    [bots],
  )

  const toggleAction = (act: string) => {
    setActions(prev => (prev.includes(act) ? prev.filter(x => x !== act) : [...prev, act]))
  }

  const computeUntil = (): number | null => {
    const now = Date.now()
    if (duration === 'hour') return now + 3_600_000
    if (duration === 'today') {
      const end = new Date()
      end.setHours(23, 59, 59, 999)
      return end.getTime()
    }
    if (duration === 'week') return now + 7 * 86_400_000
    return null
  }

  const saveGrant = async () => {
    const targetBot = fixedBot ?? bots.find(b => b.id === pickedBotId) ?? bots[0]
    if (!targetBot || actions.length === 0) return
    const normalizedSite = site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || '*'
    const existing = (targetBot.browserGrants ?? []).filter(g => text(g.site) !== normalizedSite)
    const nextGrants = [...existing, { site: normalizedSite, actions, until: computeUntil() }]
    const res = await perform('update-bot', { id: targetBot.id, browserGrants: nextGrants })
    if (res.ok) {
      setAdding(false)
      setSite('')
    }
  }

  const removeGrant = async (bot: BotEntry, grantSite: string) => {
    const nextGrants = (bot.browserGrants ?? []).filter(g => text(g.site) !== grantSite)
    await perform('update-bot', { id: bot.id, browserGrants: nextGrants })
  }

  const actionLabels: Record<string, string> = {
    post: s.bots.browserActPost,
    upload: s.bots.browserActUpload,
    download: s.bots.browserActDownload,
    delete: s.bots.browserActDelete,
  }

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.helperNote}>{s.bots.browserGrantsDesc}</Text>

      <View style={styles.groupCard}>
        {rows.length === 0 ? (
          <View style={styles.emptyCardRow}>
            <Text style={styles.mutedText}>{s.bots.none}</Text>
          </View>
        ) : (
          rows.map((row, idx) => {
            const siteText = text(row.grant.site)
            const acts = Array.isArray(row.grant.actions) ? row.grant.actions.map(a => actionLabels[String(a)] ?? String(a)) : []
            return (
              <View key={row.key}>
                {idx > 0 && <View style={styles.divider} />}
                <View style={styles.listRow}>
                  {!fixedBot && <BotAvatar bot={row.bot} size={28} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {!fixedBot ? `${row.bot.name} · ` : ''}
                      {siteText === '*' || !siteText ? s.bots.browserAllSites : siteText}
                    </Text>
                    <Text style={styles.rowSub}>{acts.join(' · ')}</Text>
                  </View>
                  <Pressable onPress={() => void removeGrant(row.bot, siteText)} hitSlop={8} style={styles.iconHit}>
                    <Trash2 size={16} color={colors.danger} />
                  </Pressable>
                </View>
              </View>
            )
          })
        )}
      </View>

      {adding ? (
        <View style={[styles.groupCard, { padding: 14, gap: 12 }]}>
          {!fixedBot && bots.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {bots.map(b => {
                const on = b.id === pickedBotId
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => setPickedBotId(b.id)}
                    style={[styles.choicePill, on && styles.choicePillActive]}
                  >
                    <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{b.name}</Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          )}
          <TextInput
            value={site}
            onChangeText={setSite}
            placeholder={s.bots.browserSitePlaceholder}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['post', 'upload', 'download', 'delete'] as const).map(act => {
              const on = actions.includes(act)
              return (
                <Pressable
                  key={act}
                  onPress={() => toggleAction(act)}
                  style={[styles.choicePill, on && styles.choicePillActive]}
                >
                  <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{actionLabels[act]}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {([
              ['hour', s.bots.browserDurHour],
              ['today', s.bots.browserDurToday],
              ['week', s.bots.browserDurWeek],
              ['always', s.bots.browserDurAlways],
            ] as const).map(([id, label]) => {
              const on = duration === id
              return (
                <Pressable
                  key={id}
                  onPress={() => setDuration(id)}
                  style={[styles.choicePill, on && styles.choicePillActive]}
                >
                  <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <Button label={s.bots.cancel} variant="secondary" onPress={() => setAdding(false)} />
            <Button label={s.bots.save} disabled={actions.length === 0} onPress={() => void saveGrant()} />
          </View>
        </View>
      ) : (
        <View style={{ alignItems: 'flex-start' }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdding(true)}
            style={({ pressed }) => [styles.softActionBtn, pressed && { opacity: 0.8 }]}
          >
            <Plus size={15} color={colors.ink} />
            <Text style={styles.softActionBtnText}>{s.bots.browserAddGrant}</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

/**
 * DS-Bot Scheduled Tasks panel modeled on `schedules.js` (Figure 2 earlier: `+ 新建任务` + `还没有定时任务。`).
 * Synchronizes directly with DSH's device `scheduleTasks` so tasks created here immediately appear in `自动化任务`!
 */
export function BotSchedulesPanel({
  state,
  client,
  fixedBotId,
  fixedRoomId,
  initialCreating = false,
  onChanged,
}: {
  state: BotState
  client?: BotRemoteClient
  fixedBotId?: string
  fixedRoomId?: string
  initialCreating?: boolean
  onChanged?: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSharedStyles)
  const loadDeviceSchedules = useAppStore(store => store.loadScheduleTasks)
  const createDeviceSchedule = useAppStore(store => store.createScheduleTask)
  const deleteDeviceSchedule = useAppStore(store => store.deleteScheduleTask)

  const [tasks, setTasks] = useState<BotObject[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(initialCreating)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null)

  const defaultTargetId = fixedRoomId ?? fixedBotId ?? state.mainBotId ?? state.bots[0]?.id ?? ''
  const [targetId, setTargetId] = useState(defaultTargetId)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<'daily' | 'weekly' | 'every' | 'once'>('daily')
  const [timeText, setTimeText] = useState('09:00')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [everyMinutes, setEveryMinutes] = useState('60')

  const reload = useCallback(async () => {
    if (!client) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await client.call('schedules')
      const raw = objects(object(res).tasks)
      setTasks(raw)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    void reload()
  }, [reload])

  const filteredTasks = useMemo(() => {
    if (fixedBotId) {
      const bot = state.bots.find(b => b.id === fixedBotId)
      return tasks.filter(
        t =>
          text(t.botId) === fixedBotId
          || (bot && (text(t.sessionId) === bot.sessionId || (bot.parts ?? []).includes(text(t.sessionId)))),
      )
    }
    if (fixedRoomId) {
      const room = state.rooms.find(r => r.id === fixedRoomId)
      return tasks.filter(
        t =>
          text(t.roomId) === fixedRoomId
          || (room && (text(t.sessionId) === room.sessionId || (room.ownParts ?? []).includes(text(t.sessionId)))),
      )
    }
    return tasks
  }, [tasks, fixedBotId, fixedRoomId, state.bots, state.rooms])

  const ownerNameOf = (task: BotObject): string => {
    const botId = text(task.botId)
    if (botId) return state.bots.find(b => b.id === botId)?.name ?? text(task.botName) ?? botId
    const roomId = text(task.roomId)
    if (roomId) return state.rooms.find(r => r.id === roomId)?.name ?? text(task.roomName) ?? roomId
    const sid = text(task.sessionId)
    const bot = state.bots.find(b => b.sessionId === sid || (b.parts ?? []).includes(sid))
    if (bot) return bot.name
    const room = state.rooms.find(r => r.sessionId === sid || (r.ownParts ?? []).includes(sid))
    if (room) return room.name
    return ''
  }

  const handleCreate = async () => {
    if (!title.trim() || !prompt.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    const normalizedTime = /^\d{2}:\d{2}$/.test(timeText.trim()) ? timeText.trim() : '09:00'

    let whenPayload: BotObject
    let fallbackReq: ScheduleCreateRequest
    if (kind === 'daily') {
      whenPayload = { kind: 'daily', time: normalizedTime }
      fallbackReq = { title: title.trim(), prompt: prompt.trim(), daily: { time: `${normalizedTime}:00`, time_zone: timeZone } }
    } else if (kind === 'weekly') {
      const days = weekdays.length > 0 ? weekdays : [1]
      whenPayload = { kind: 'weekly', time: normalizedTime, weekdays: days }
      fallbackReq = { title: title.trim(), prompt: prompt.trim(), weekly: { time: `${normalizedTime}:00`, time_zone: timeZone, weekdays: days } }
    } else if (kind === 'every') {
      const mins = Math.max(1, Math.min(7 * 24 * 60, Number.parseInt(everyMinutes, 10) || 60))
      whenPayload = { kind: 'every', minutes: mins }
      fallbackReq = { title: title.trim(), prompt: prompt.trim(), every_seconds: mins * 60 }
    } else {
      const parts = normalizedTime.split(':')
      const hh = Number.parseInt(parts[0] ?? '9', 10) || 9
      const mm = Number.parseInt(parts[1] ?? '0', 10) || 0
      const next = new Date()
      next.setHours(hh, mm, 0, 0)
      if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1)
      const iso = next.toISOString()
      whenPayload = { kind: 'once', at: iso }
      fallbackReq = { title: title.trim(), prompt: prompt.trim(), at: iso }
    }

    try {
      let createdOk = false
      if (client) {
        try {
          await client.call('schedule-create', {
            target: targetId,
            title: title.trim(),
            prompt: prompt.trim(),
            timeZone,
            when: whenPayload,
          })
          createdOk = true
        } catch {
          const resolvedSessionId =
            state.bots.find(b => b.id === targetId)?.sessionId
            ?? state.rooms.find(r => r.id === targetId)?.sessionId
          if (resolvedSessionId) {
            const rec = await createDeviceSchedule(resolvedSessionId, fallbackReq)
            createdOk = Boolean(rec)
          }
        }
      }
      if (!createdOk) throw new Error(s.bots.unavailable)
      setTitle('')
      setPrompt('')
      setCreating(false)
      await Promise.all([reload(), loadDeviceSchedules()])
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (task: BotObject) => {
    const id = text(task.id)
    const sessionId = text(task.sessionId)
    const key = `${sessionId}:${id}`
    if (confirmDeleteKey !== key) {
      setConfirmDeleteKey(key)
      return
    }
    setConfirmDeleteKey(null)
    try {
      let deleted = false
      if (client) {
        try {
          await client.call('schedule-delete', { sessionId, id })
          deleted = true
        } catch {
          deleted = await deleteDeviceSchedule(sessionId, id)
        }
      }
      if (deleted) {
        await Promise.all([reload(), loadDeviceSchedules()])
        onChanged?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleDay = (d: number) => {
    setWeekdays(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()))
  }

  return (
    <View style={{ gap: 12 }}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {!creating && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setCreating(true)}
            style={({ pressed }) => [styles.softActionBtn, pressed && { opacity: 0.8 }]}
          >
            <Plus size={15} color={colors.ink} />
            <Text style={styles.softActionBtnText}>{s.bots.newScheduledTask}</Text>
          </Pressable>
        </View>
      )}

      {creating && (
        <View style={[styles.groupCard, { padding: 14, gap: 12 }]}>
          <Text style={styles.sectionSubHeader}>{s.bots.newScheduledTask}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={s.bots.name}
            placeholderTextColor={colors.muted}
            style={styles.input}
          />

          {!fixedBotId && !fixedRoomId && (
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>{s.bots.scheduleSendTo}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {state.bots.map(b => {
                  const on = targetId === b.id
                  return (
                    <Pressable key={b.id} onPress={() => setTargetId(b.id)} style={[styles.choicePill, on && styles.choicePillActive]}>
                      <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{b.name}</Text>
                    </Pressable>
                  )
                })}
                {state.rooms.map(r => {
                  const on = targetId === r.id
                  return (
                    <Pressable key={r.id} onPress={() => setTargetId(r.id)} style={[styles.choicePill, on && styles.choicePillActive]}>
                      <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{r.name}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
            </View>
          )}

          <View style={{ gap: 6 }}>
            <Text style={styles.fieldLabel}>{s.bots.scheduleWhatToDo}</Text>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder={s.bots.scheduleWhatToDo}
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
            />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>{s.bots.scheduleWhen}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {([
                ['daily', s.bots.scheduleDaily],
                ['weekly', s.bots.scheduleWeekly],
                ['every', s.bots.scheduleInterval],
                ['once', s.bots.scheduleOnce],
              ] as const).map(([id, label]) => {
                const on = kind === id
                return (
                  <Pressable key={id} onPress={() => setKind(id)} style={[styles.choicePill, on && styles.choicePillActive]}>
                    <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{label}</Text>
                  </Pressable>
                )
              })}
            </View>

            {kind === 'weekly' && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(
                  [
                    [1, '一'],
                    [2, '二'],
                    [3, '三'],
                    [4, '四'],
                    [5, '五'],
                    [6, '六'],
                    [7, '日'],
                  ] as [number, string][]
                ).map(([d, label]) => {
                  const on = weekdays.includes(d)
                  return (
                    <Pressable key={d} onPress={() => toggleDay(d)} style={[styles.choicePill, on && styles.choicePillActive]}>
                      <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            )}

            {kind === 'every' ? (
              <TextInput
                value={everyMinutes}
                onChangeText={setEveryMinutes}
                keyboardType="number-pad"
                placeholder="60 (min)"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            ) : (
              <TextInput
                value={timeText}
                onChangeText={setTimeText}
                placeholder="09:00"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            )}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
            <Button label={s.bots.cancel} variant="secondary" onPress={() => setCreating(false)} />
            <Button
              label={s.bots.createScheduledTask}
              loading={submitting}
              disabled={!title.trim() || !prompt.trim() || submitting}
              onPress={() => void handleCreate()}
            />
          </View>
        </View>
      )}

      <View style={styles.groupCard}>
        {loading ? (
          <View style={styles.emptyCardRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : filteredTasks.length === 0 ? (
          <View style={styles.emptyCardRow}>
            <Text style={styles.mutedText}>{s.bots.schedulesNone}</Text>
          </View>
        ) : (
          filteredTasks.map((task, idx) => {
            const id = text(task.id) || `sched-${idx}`
            const sessionId = text(task.sessionId)
            const key = `${sessionId}:${id}`
            const owner = !fixedBotId && !fixedRoomId ? ownerNameOf(task) : ''
            const confirming = confirmDeleteKey === key
            return (
              <View key={key}>
                {idx > 0 && <View style={styles.divider} />}
                <View style={styles.listRow}>
                  <CalendarClock size={18} color={colors.primary} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle}>
                      {text(task.title) || text(task.prompt) || id}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={2}>
                      {[owner, formatScheduleSummary(task), text(task.prompt)].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleDelete(task)}
                    style={[styles.iconHit, confirming && styles.dangerConfirmPill]}
                  >
                    {confirming ? (
                      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.danger }}>{s.bots.delete}</Text>
                    ) : (
                      <Trash2 size={16} color={colors.danger} />
                    )}
                  </Pressable>
                </View>
              </View>
            )
          })
        )}
      </View>
    </View>
  )
}

/**
 * Memory management view modeled on DS-Bot's `memory-panel.js`.
 */
export function BotMemoryPanel({
  ownerId,
  ownerName,
  isGroup,
  client,
}: {
  ownerId: string
  ownerName: string
  isGroup?: boolean
  client?: BotRemoteClient
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSharedStyles)
  const [view, setView] = useState<BotObject | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'summary' | 'entries'>('summary')
  const [askDraft, setAskDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const [replyText, setReplyText] = useState<string | null>(null)

  const loadMemory = useCallback(async () => {
    if (!client) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const res = await client.call('memory-view', { id: ownerId })
      setView(object(res))
    } catch {
      setView({ entries: [], sizes: {}, limits: { main: 2200 } })
    } finally {
      setLoading(false)
    }
  }, [client, ownerId])

  useEffect(() => {
    void loadMemory()
  }, [loadMemory])

  const entries = objects(view?.entries)
  const summaryObj = object(view?.summary)
  const summaryText = text(summaryObj.text)

  const submitAsk = async () => {
    if (!client || !askDraft.trim() || asking) return
    setAsking(true)
    setReplyText(null)
    try {
      const res = await client.call('memory-ask', { id: ownerId, text: askDraft.trim() })
      const out = object(res)
      setAskDraft('')
      if (text(out.answer)) setReplyText(text(out.answer))
      if (out.view) setView(object(out.view))
      else await loadMemory()
    } catch (err) {
      setReplyText(err instanceof Error ? err.message : String(err))
    } finally {
      setAsking(false)
    }
  }

  const removeEntry = async (entry: BotObject) => {
    if (!client) return
    try {
      const res = await client.call('memory-forget', {
        id: ownerId,
        scope: text(entry.scope) || (isGroup ? 'group' : 'own'),
        topic: entry.topic ?? null,
        text: text(entry.text),
      })
      const out = object(res)
      if (out.view) setView(object(out.view))
      else await loadMemory()
    } catch {
      // ignore
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([
            ['summary', s.bots.memorySummary],
            ['entries', `${s.bots.memoryAllEntries} (${entries.length})`],
          ] as const).map(([id, label]) => {
            const on = tab === id
            return (
              <Pressable key={id} onPress={() => setTab(id)} style={[styles.choicePill, on && styles.choicePillActive]}>
                <Text style={[styles.choicePillText, on && styles.choicePillTextActive]}>{label}</Text>
              </Pressable>
            )
          })}
        </View>

        {replyText ? (
          <View style={[styles.groupCard, { padding: 14 }]}>
            <Text style={styles.rowTitle}>{replyText}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={[styles.groupCard, styles.emptyCardRow]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : entries.length === 0 ? (
          <View style={[styles.groupCard, { padding: 22, alignItems: 'center', gap: 8 }]}>
            <FileText size={26} color={colors.muted} />
            <Text style={styles.rowTitle}>{s.bots.memoryEmpty}</Text>
            <Text style={[styles.rowSub, { textAlign: 'center' }]}>{ownerName}</Text>
          </View>
        ) : tab === 'summary' ? (
          <View style={[styles.groupCard, { padding: 16 }]}>
            <Text style={[styles.rowTitle, { lineHeight: 22, fontWeight: '400' }]}>
              {summaryText || entries.map(e => `• ${text(e.text)}`).join('\n\n')}
            </Text>
          </View>
        ) : (
          <View style={styles.groupCard}>
            {entries.map((entry, idx) => (
              <View key={`${idx}-${text(entry.text).slice(0, 24)}`}>
                {idx > 0 && <View style={styles.divider} />}
                <View style={styles.listRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle}>{text(entry.text)}</Text>
                    <Text style={styles.rowSub}>
                      {[text(entry.scope) === 'team' ? s.bots.memoryTeam : ownerName, text(entry.topic), text(entry.added)]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Pressable onPress={() => void removeEntry(entry)} hitSlop={8} style={styles.iconHit}>
                    <Trash2 size={16} color={colors.danger} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.memoryAskBar}>
        <TextInput
          value={askDraft}
          onChangeText={setAskDraft}
          placeholder={s.bots.memoryAskPlaceholder}
          placeholderTextColor={colors.muted}
          onSubmitEditing={() => void submitAsk()}
          style={[styles.input, { flex: 1, borderRadius: 999 }]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!askDraft.trim() || asking}
          onPress={() => void submitAsk()}
          style={[styles.sendCircleBtn, (!askDraft.trim() || asking) && { opacity: 0.4 }]}
        >
          {asking ? <ActivityIndicator size="small" color={colors.surface} /> : <ArrowUp size={18} color={colors.surface} />}
        </Pressable>
      </View>
    </View>
  )
}

/**
 * Folder picker modal modeled on DS-Bot's `folder-menu.js`.
 */
export function BotFolderPickerModal({
  visible,
  value,
  teamMode,
  client,
  onPick,
  onClose,
}: {
  visible: boolean
  value?: string
  teamMode?: boolean
  client?: BotRemoteClient
  onPick: (folder: string) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createSharedStyles)
  const [mode, setMode] = useState<'list' | 'browse' | 'type'>('list')
  const [knownFolders, setKnownFolders] = useState<{ path: string; title: string }[]>([])
  const [browsePath, setBrowsePath] = useState('')
  const [browseParent, setBrowseParent] = useState<string | null>(null)
  const [browseEntries, setBrowseEntries] = useState<{ name: string; path: string }[]>([])
  const [draftPath, setDraftPath] = useState(value ?? '')

  useEffect(() => {
    if (!visible || !client) return
    setMode('list')
    setDraftPath(value ?? '')
    void client
      .call('folders')
      .then(res => {
        const info = object(res)
        const list = objects(info.folders).map(f => ({
          path: text(f.path),
          title: text(f.title) || folderBasename(text(f.path)),
        })).filter(f => f.path !== '')
        setKnownFolders(list)
      })
      .catch(() => setKnownFolders([]))
  }, [visible, client, value])

  const loadBrowse = async (targetPath?: string) => {
    if (!client) return
    try {
      const res = await client.call('folder-list', targetPath ? { path: targetPath } : {})
      const info = object(res)
      const crumbs = objects(info.crumbs)
      setBrowsePath(text(info.path))
      setBrowseParent(crumbs.length > 1 ? text(crumbs[crumbs.length - 2]?.path) : null)
      setBrowseEntries(
        objects(info.entries)
          .filter(e => e.hidden !== true && nonemptyText(e.path))
          .map(e => ({ name: text(e.name) || folderBasename(text(e.path)), path: text(e.path) })),
      )
      setMode('browse')
    } catch {
      setMode('type')
    }
  }

  if (!visible) return null

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <ModalSurface onClose={onClose}>
        <View style={{ gap: 14 }}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{teamMode ? s.bots.teamWorkspace : s.bots.workingFolder}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.muted} />
            </Pressable>
          </View>

          {mode === 'list' && (
            <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 8 }}>
              {!teamMode && (
                <Pressable
                  onPress={() => {
                    onPick('')
                    onClose()
                  }}
                  style={styles.listRow}
                >
                  <Folder size={18} color={colors.primary} />
                  <Text style={[styles.rowTitle, { flex: 1 }]}>{s.bots.teamWorkspace}</Text>
                  {!value && <Check size={18} color={colors.primary} />}
                </Pressable>
              )}
              {knownFolders.map(folder => (
                <Pressable
                  key={folder.path}
                  onPress={() => {
                    onPick(folder.path)
                    onClose()
                  }}
                  style={styles.listRow}
                >
                  <Folder size={18} color={colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{folder.title}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{folder.path}</Text>
                  </View>
                  {value === folder.path && <Check size={18} color={colors.primary} />}
                </Pressable>
              ))}
              <View style={styles.divider} />
              <Pressable onPress={() => void loadBrowse(value)} style={styles.listRow}>
                <Folder size={18} color={colors.ink} />
                <Text style={[styles.rowTitle, { flex: 1 }]}>{s.bots.browseFolders}</Text>
                <ChevronRight size={16} color={colors.muted} />
              </Pressable>
              <Pressable onPress={() => setMode('type')} style={styles.listRow}>
                <FileText size={18} color={colors.ink} />
                <Text style={[styles.rowTitle, { flex: 1 }]}>{s.bots.enterPath}</Text>
                <ChevronRight size={16} color={colors.muted} />
              </Pressable>
            </ScrollView>
          )}

          {mode === 'browse' && (
            <View style={{ gap: 10, maxHeight: 420 }}>
              <Text style={styles.rowSub} numberOfLines={1}>{browsePath}</Text>
              <ScrollView style={{ maxHeight: 280 }}>
                {browseParent ? (
                  <Pressable onPress={() => void loadBrowse(browseParent)} style={styles.listRow}>
                    <ChevronLeft size={16} color={colors.muted} />
                    <Text style={styles.rowTitle}>..</Text>
                  </Pressable>
                ) : null}
                {browseEntries.map(entry => (
                  <Pressable key={entry.path} onPress={() => void loadBrowse(entry.path)} style={styles.listRow}>
                    <Folder size={17} color={colors.primary} />
                    <Text style={[styles.rowTitle, { flex: 1 }]}>{entry.name}</Text>
                    <ChevronRight size={16} color={colors.muted} />
                  </Pressable>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Button label={s.bots.cancel} variant="secondary" onPress={() => setMode('list')} />
                <Button
                  label={s.bots.useThisFolder}
                  disabled={!browsePath}
                  onPress={() => {
                    onPick(browsePath)
                    onClose()
                  }}
                />
              </View>
            </View>
          )}

          {mode === 'type' && (
            <View style={{ gap: 12 }}>
              <TextInput
                value={draftPath}
                onChangeText={setDraftPath}
                placeholder="/path/to/workspace"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Button label={s.bots.cancel} variant="secondary" onPress={() => setMode('list')} />
                <Button
                  label={s.bots.useThisFolder}
                  disabled={!draftPath.trim()}
                  onPress={() => {
                    onPick(draftPath.trim())
                    onClose()
                  }}
                />
              </View>
            </View>
          )}
        </View>
      </ModalSurface>
    </Modal>
  )
}

function nonemptyText(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

const createSharedStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    browserContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    browserTabStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.grouped,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    browserTabScroll: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    browserTabChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: 190,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      backgroundColor: 'transparent',
    },
    browserTabChipActive: {
      backgroundColor: colors.surface,
    },
    browserTabTitle: {
      fontSize: 13,
      color: colors.muted,
      maxWidth: 120,
    },
    browserTabTitleActive: {
      color: colors.ink,
      fontWeight: '500',
    },
    browserTabClose: {
      padding: 2,
    },
    browserBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: colors.grouped,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
      gap: 10,
    },
    browserBannerHeld: {
      backgroundColor: colors.primarySoft,
    },
    browserBannerText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '500',
      color: colors.ink,
    },
    browserBannerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    browserBannerBtn: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    browserBannerBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.ink,
    },
    browserNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 8,
      gap: 4,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.separator,
    },
    browserNavIconBtn: {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    browserAddressBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: 18,
      backgroundColor: colors.grouped,
    },
    browserAddressInput: {
      flex: 1,
      fontSize: 13,
      color: colors.ink,
      paddingVertical: 0,
    },
    browserViewport: {
      flex: 1,
      backgroundColor: colors.background,
    },
    browserBlankCanvas: {
      flex: 1,
      backgroundColor: colors.background,
    },
    groupCard: {
      backgroundColor: colors.cardOpaque,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    emptyCardRow: {
      paddingVertical: 22,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 15,
      paddingVertical: 13,
    },
    rowTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.ink,
    },
    rowSub: {
      fontSize: 12,
      color: colors.muted,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.separator,
      marginLeft: 15,
    },
    helperNote: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.muted,
      paddingHorizontal: 4,
    },
    mutedText: {
      fontSize: 14,
      color: colors.muted,
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
      paddingHorizontal: 4,
    },
    softActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.cardOpaque,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.separator,
    },
    softActionBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.ink,
    },
    choicePill: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.grouped,
    },
    choicePillActive: {
      backgroundColor: colors.primary,
    },
    choicePillText: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.ink,
    },
    choicePillTextActive: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    input: {
      backgroundColor: colors.grouped,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.ink,
    },
    fieldLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.muted,
    },
    sectionSubHeader: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.ink,
    },
    iconHit: {
      padding: 6,
    },
    dangerConfirmPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: 'rgba(239,68,68,0.12)',
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sheetTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.ink,
    },
    memoryAskBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.separator,
      backgroundColor: colors.background,
    },
    sendCircleBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
  })
