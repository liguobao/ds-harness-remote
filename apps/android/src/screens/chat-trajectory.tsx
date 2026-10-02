import { useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { ChatItem } from '../types'
import { strings } from '../locales/i18n'
import { useTheme } from '../ui/theme-context'
import { messageClock } from './message-actions'

type Category = 'all' | 'system' | 'user' | 'context' | 'assistant' | 'tool'
function category(item: ChatItem): Category {
  if (item.kind !== 'message') return 'tool'
  return item.context ? 'context' : item.role
}
function content(item: ChatItem): string {
  if (item.kind === 'message') return `${item.text}\n${item.reasoning ?? ''}`
  if (item.kind === 'tool') return `${item.toolName}\n${item.arguments ?? ''}\n${item.summary ?? ''}\n${item.callDetail?.text ?? ''}\n${item.resultDetail?.text ?? ''}`
  if (item.kind === 'approval') return `${item.toolName}\n${item.reason ?? ''}`
  return item.questions.map(question => question.question).join('\n')
}

/** Uses the unmerged real ChatItem timeline, not the compact-chat preference. */
export function ChatTrajectory({ items, renderItem, hasMore, loading, loadOlder }: {
  items: ChatItem[]; renderItem: (item: ChatItem) => ReactNode; hasMore: boolean; loading: boolean; loadOlder: () => void
}) {
  const { colors } = useTheme()
  const [filter, setFilter] = useState<Category>('all')
  const [query, setQuery] = useState('')
  const rows = useMemo(() => items.filter(item => (filter === 'all' || category(item) === filter)
    && `${content(item)}\n${item.turn ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [items, filter, query])
  return <View style={styles.root}>
    <Text style={[styles.hint, { color: colors.muted }]}>{strings.trajectory.loadedOnly}</Text>
    <TextInput accessibilityLabel={strings.trajectory.search} placeholder={strings.trajectory.search} placeholderTextColor={colors.muted} value={query} onChangeText={setQuery} style={[styles.search, { color: colors.ink, borderColor: colors.border }]} />
    <View><ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.filters}>
      {(['all', 'system', 'user', 'context', 'assistant', 'tool'] as const).map(key => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: key === filter }} onPress={() => setFilter(key)} style={[styles.filter, { backgroundColor: key === filter ? colors.primarySoft : colors.surface }]}><Text style={{ color: key === filter ? colors.primary : colors.muted }}>{strings.trajectory[key]}</Text></Pressable>)}
    </ScrollView></View>
    <FlatList data={rows} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScrollBeginDrag={() => Keyboard.dismiss()} initialNumToRender={6} maxToRenderPerBatch={6}
      ListHeaderComponent={hasMore ? <Pressable accessibilityRole="button" accessibilityLabel={strings.chat.older} disabled={loading} onPress={loadOlder} style={styles.filter}>{loading ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary }}>{strings.chat.older}</Text>}</Pressable> : null}
      ListEmptyComponent={<Text style={[styles.hint, { color: colors.muted }]}>{strings.trajectory.empty}</Text>}
      contentContainerStyle={styles.list} renderItem={({ item }) => <View style={[styles.entry, { borderColor: colors.border }]}>
        <View style={styles.meta}><Text style={{ color: colors.primary, fontSize: 12 }}>{strings.trajectory[category(item)]}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{strings.trajectory.turn} {item.turn ?? '—'} · {messageClock(item.nativeTime)}</Text></View>
        {renderItem(item)}
      </View>} />
  </View>
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }, hint: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 },
  search: { marginHorizontal: 16, paddingHorizontal: 12, minHeight: 44, borderWidth: 1, borderRadius: 8 },
  filters: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 }, filter: { minHeight: 44, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 }, entry: { borderWidth: 1, borderRadius: 10, padding: 10 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, marginBottom: 6 },
})
