import { memo, useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Bot, ChevronDown, ChevronRight, Layers, Search, Settings2, User, Wrench, X } from 'lucide-react-native'
import type { ChatImage, ChatItem, ChatMessage } from '../types'
import { strings } from '../locales/i18n'
import { IconButton } from '../ui/components'
import { NativeMarkdown } from '../ui/markdown'
import { radius, spacing, type, type ThemeColors } from '../ui/theme'
import { useResponsiveLayout } from '../ui/responsive'
import { useTheme } from '../ui/theme-context'
import { useThemedStyles } from '../ui/use-themed-styles'
import { MessageActions, messageClock, messageTime } from './message-actions'

type Category = 'all' | 'system' | 'user' | 'context' | 'assistant' | 'tool'
const CATEGORIES = ['all', 'system', 'user', 'context', 'assistant', 'tool'] as const
const CATEGORY_ICONS = { system: Settings2, user: User, context: Layers, assistant: Bot, tool: Wrench }
function category(item: ChatItem): Exclude<Category, 'all'> {
  if (item.kind !== 'message') return 'tool'
  return item.context ? 'context' : item.role
}
function content(item: ChatItem): string {
  if (item.kind === 'message') return `${item.text}\n${item.reasoning ?? ''}`
  if (item.kind === 'tool') return `${item.toolName}\n${item.arguments ?? ''}\n${item.summary ?? ''}\n${item.callDetail?.text ?? ''}\n${item.resultDetail?.text ?? ''}`
  if (item.kind === 'approval') return `${item.toolName}\n${item.reason ?? ''}`
  return item.questions.map(question => question.question).join('\n')
}

/** Keeps the real message order; only the disclosure changes what is rendered. */
export function ChatTrajectory({ items, renderItem, renderImages, hasMore, loading, loadOlder }: {
  items: ChatItem[]
  renderItem: (item: ChatItem) => ReactNode
  renderImages: (images: ChatImage[]) => ReactNode
  hasMore: boolean
  loading: boolean
  loadOlder: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const { contentMaxWidth } = useResponsiveLayout()
  const [filter, setFilter] = useState<Category>('all')
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return items.filter(item => (filter === 'all' || category(item) === filter)
      && `${content(item)}\n${item.turn ?? ''}`.toLocaleLowerCase().includes(search))
  }, [items, filter, query])
  return <View style={[styles.root, { width: '100%', maxWidth: contentMaxWidth, alignSelf: 'center' }]}>
    <View style={styles.search}>
      <Search size={18} color={colors.muted} />
      <TextInput accessibilityLabel={strings.trajectory.search} placeholder={strings.trajectory.search}
        placeholderTextColor={colors.muted} selectionColor={colors.primary} value={query} onChangeText={setQuery}
        autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} style={styles.searchInput} />
      {query.length > 0 && <IconButton label={strings.trajectory.clearSearch} icon={X} dense onPress={() => setQuery('')} />}
    </View>
    <View style={styles.filterBar} accessibilityRole="tablist">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
        {CATEGORIES.map(key => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: key === filter }}
          onPress={() => setFilter(key)} style={({ pressed }) => [styles.filter, key === filter && styles.filterSelected, pressed && styles.pressed]}>
          <Text style={[styles.filterText, key === filter && styles.filterTextSelected]}>{strings.trajectory[key]}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    <FlatList data={rows} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      onScrollBeginDrag={() => Keyboard.dismiss()} initialNumToRender={6} maxToRenderPerBatch={6}
      ListHeaderComponent={<View style={styles.listHeader}>
        <Text style={styles.hint}>{strings.trajectory.loadedOnly}</Text>
        {hasMore && <Pressable accessibilityRole="button" accessibilityLabel={strings.chat.older}
          accessibilityState={{ disabled: loading, busy: loading }} disabled={loading} onPress={loadOlder}
          style={({ pressed }) => [styles.loadOlder, pressed && styles.pressed]}>
          {loading ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.loadOlderText}>{strings.chat.older}</Text>}
        </Pressable>}
      </View>}
      ListEmptyComponent={<View style={styles.empty}><Search size={24} color={colors.muted} /><Text style={styles.emptyText}>{strings.trajectory.empty}</Text></View>}
      contentContainerStyle={styles.list} renderItem={({ item }) => <TrajectoryEntry item={item} renderItem={renderItem} renderImages={renderImages} />} />
  </View>
}

const TrajectoryEntry = memo(function TrajectoryEntry({ item, renderItem, renderImages }: {
  item: ChatItem; renderItem: (item: ChatItem) => ReactNode; renderImages: (images: ChatImage[]) => ReactNode
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(createStyles)
  const [expanded, setExpanded] = useState(false)
  const kind = category(item)
  const Icon = CATEGORY_ICONS[kind]
  const message = item.kind === 'message' ? item : undefined
  const time = messageTime(item)
  const label = strings.trajectory[kind]
  const preview = message === undefined ? '' : (message.text.trim() || message.reasoning?.trim()
    || ((message.images?.length ?? 0) > 0 ? strings.chat.unnamedImage : strings.trajectory.noText))
    .replace(/^#{1,6}\s+/gm, '').replace(/\*\*|`/g, '').trim()
  const meta = <View style={styles.meta}>
    <Icon size={14} color={colors.muted} />
    <Text style={styles.role}>{label}</Text>
    {item.turn !== undefined && <Text numberOfLines={1} style={styles.turn}>{strings.trajectory.turn} {item.turn}</Text>}
    {time !== undefined && <Text style={styles.time}>{messageClock(time)}</Text>}
    {message !== undefined && (expanded ? <ChevronDown size={16} color={colors.muted} /> : <ChevronRight size={16} color={colors.muted} />)}
  </View>
  return <View style={styles.entry}>
    {message === undefined ? <>{meta}{renderItem(item)}</> : <>
      <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? strings.trajectory.collapse : strings.trajectory.expand} · ${label} · ${preview.slice(0, 120)}`}
        accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.messageHeader, pressed && styles.pressed]}>
        {meta}
        {!expanded && <Text style={styles.preview} numberOfLines={4}>{preview}</Text>}
        {!expanded && (message.images?.length ?? 0) > 0 && <Text style={styles.attachmentHint}>{strings.trajectory.attachments(message.images!.length)}</Text>}
      </Pressable>
      {expanded && <TrajectoryMessage item={message} renderImages={renderImages} />}
    </>}
  </View>
})

function TrajectoryMessage({ item, renderImages }: { item: ChatMessage; renderImages: (images: ChatImage[]) => ReactNode }) {
  const styles = useThemedStyles(createStyles)
  return <View style={styles.messageBody}>
    {(item.reasoning?.trim().length ?? 0) > 0 && <View style={styles.reasoning}>
      <Text style={styles.role}>{strings.chat.reasoning}</Text>
      <NativeMarkdown text={item.reasoning!} />
    </View>}
    {(item.images?.length ?? 0) > 0 && renderImages(item.images!)}
    {item.text.trim().length > 0 && <NativeMarkdown text={item.text} />}
    {!item.context && item.role !== 'system' && !item.streaming && item.text.length > 0 && <MessageActions item={item} />}
  </View>
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginHorizontal: spacing.lg, marginTop: spacing.sm,
    paddingLeft: spacing.sm, paddingRight: spacing.xxs, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.surfaceStrong },
  searchInput: { ...type.small, flex: 1, minWidth: 0, minHeight: 48, paddingVertical: spacing.sm, color: colors.ink },
  filterBar: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  filters: { paddingHorizontal: spacing.lg, gap: spacing.md },
  filter: { minHeight: 48, paddingHorizontal: spacing.xxs, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  filterSelected: { borderBottomColor: colors.primary },
  filterText: { ...type.small, color: colors.muted },
  filterTextSelected: { color: colors.primary, fontWeight: '600' },
  pressed: { backgroundColor: colors.surfaceStrong },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  listHeader: { paddingTop: spacing.sm, paddingBottom: spacing.xxs },
  hint: { ...type.caption, color: colors.muted },
  loadOlder: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  loadOlderText: { ...type.small, color: colors.primary },
  entry: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 24, marginBottom: spacing.xs },
  role: { ...type.caption, color: colors.muted },
  turn: { ...type.caption, color: colors.muted, flexShrink: 1 },
  time: { ...type.caption, color: colors.muted, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  messageHeader: { minHeight: 48 },
  preview: { ...type.small, color: colors.ink },
  attachmentHint: { ...type.caption, color: colors.muted, marginTop: spacing.xs },
  messageBody: { gap: spacing.sm },
  reasoning: { gap: spacing.xs },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { ...type.small, color: colors.muted, textAlign: 'center' },
})
