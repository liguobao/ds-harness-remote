import { useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { Pressable, ScrollView, Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg'
import { strings as s } from '../../locales/i18n'
import { objects, text, type BotObject } from '../../services/bot-catalog'
import { Button } from '../../ui/components'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { asText, resolve, type Scope } from '../../vendor/ds-bot/views.js'
import { createBotStyles } from './styles'

/** Geometry from validated numbers only. Exact values remain available as a table. */
export function BotChart({ node, scope }: { node: BotObject; scope: Scope }) {
  const styles = useThemedStyles(createBotStyles)
  const { colors } = useTheme()
  const [table, setTable] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>(undefined)
  const categories = (node.categories as unknown[]).map(asText)
  const series = objects(node.series).map(entry => {
    const rawValues = Array.isArray(entry.values) ? entry.values : Array.isArray(entry.data) ? entry.data : []
    return {
      label: text(entry.name),
      values: rawValues.map(value => {
        const number = Number(resolve(value, scope, NaN))
        return Number.isFinite(number) ? number : NaN
      }),
    }
  })
  const palette = [colors.primary, colors.accent, colors.success, colors.warning]
  const unit = text(node.unit)
  const caption = text(node.caption)
  const kind = text(node.kind) || 'bar'
  const numbers = series.flatMap(entry => entry.values)
  const valid = numbers.every(Number.isFinite)
  const magnitude = Math.max(1, ...numbers.filter(Number.isFinite).map(Math.abs))
  const low = Math.min(0, ...numbers.filter(Number.isFinite).map(n => n / magnitude))
  const high = Math.max(0, ...numbers.filter(Number.isFinite).map(n => n / magnitude))
  const span = high - low || 1
  const x = (index: number) => 48 + (index + 0.5) * 284 / categories.length
  const y = (value: number) => 164 - (value / magnitude - low) / span * 140
  const baseline = y(0)
  const point = (index: number, value: number) => `${x(index)},${y(value)}`
  const donut = series[0]?.values ?? []
  const total = donut.reduce((sum, value) => sum + Math.max(0, value / magnitude), 0)
  let offset = 0
  return <View style={styles.section}>
    {!!caption && <Text style={styles.body}>{caption}</Text>}
    {valid && <Svg width="100%" height={200} viewBox="0 0 360 200" accessible accessibilityRole="image" accessibilityLabel={`${caption || s.bots.chartData}. ${categories.join(', ')}`}>
      {kind === 'donut' ? <>
        <Circle cx={180} cy={95} r={65} fill="none" stroke={colors.border} strokeWidth={26} />
        {donut.map((value, index) => {
          const length = total > 0 ? Math.max(0, value / magnitude) / total * 2 * Math.PI * 65 : 0
          const at = offset; offset += length
          return <Circle key={index} cx={180} cy={95} r={65} fill="none" stroke={palette[index % palette.length]} strokeWidth={26} strokeDasharray={`${length} ${2 * Math.PI * 65 - length}`} strokeDashoffset={-at} rotation={-90} origin="180, 95" />
        })}
      </> : kind === 'hbar' ? <>
        <Line x1={48 + (0 - low) / span * 284} x2={48 + (0 - low) / span * 284} y1={20} y2={170} stroke={colors.border} />
        {series.flatMap((entry, group) => entry.values.map((value, index) => {
          const zero = 48 + (0 - low) / span * 284
          const end = 48 + (value / magnitude - low) / span * 284
          return <Rect key={`${group}:${index}`} x={Math.min(zero, end)} y={24 + index * 140 / categories.length + group * 112 / categories.length / series.length} width={Math.abs(end - zero)} height={Math.max(0.5, 100 / categories.length / series.length)} fill={palette[group % palette.length]} />
        }))}
        {categories.map((label, index) => <SvgText key={index} x={44} y={30 + index * 140 / categories.length} textAnchor="end" fontSize={10} fill={colors.muted}>{label.slice(0, 6)}</SvgText>)}
      </> : <>
        <Line x1={48} x2={332} y1={baseline} y2={baseline} stroke={colors.border} />
        <SvgText x={44} y={24} textAnchor="end" fontSize={10} fill={colors.muted}>{Number((high * magnitude).toPrecision(3))}</SvgText>
        <SvgText x={44} y={164} textAnchor="end" fontSize={10} fill={colors.muted}>{Number((low * magnitude).toPrecision(3))}</SvgText>
        {series.map((entry, group) => kind === 'line' || kind === 'area'
          ? <Path key={group} d={`M ${entry.values.map((value, index) => point(index, value)).join(' L ')}${kind === 'area' ? ` L ${x(categories.length - 1)},${baseline} L ${x(0)},${baseline} Z` : ''}`} stroke={palette[group % palette.length]} strokeWidth={2} fill={kind === 'area' ? palette[group % palette.length] : 'none'} fillOpacity={0.15} />
          : entry.values.map((value, index) => <Rect key={`${group}:${index}`} x={48 + index * 284 / categories.length + group * 228 / categories.length / series.length} y={Math.min(y(value), baseline)} width={Math.max(0.5, 210 / categories.length / series.length)} height={Math.abs(y(value) - baseline)} fill={palette[group % palette.length]} />))}
        {categories.map((label, index) => <SvgText key={index} x={x(index)} y={184} textAnchor="middle" fontSize={10} fill={colors.muted}>{label.slice(0, Math.max(2, Math.floor(36 / categories.length)))}</SvgText>)}
      </>}
    </Svg>}
    <View style={styles.wrap}>{(kind === 'donut' ? categories : series.map(entry => entry.label)).map((label, i) => <View key={i} style={styles.row}><View style={{ width: 10, height: 10, backgroundColor: palette[i % palette.length] }} /><Text style={styles.muted}>{label}</Text></View>)}</View>
    {categories.length > 0 && (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 6 }}>
        {categories.map((cat, idx) => (
          <Pressable
            key={`${idx}:${cat}`}
            onPress={() => setSelectedIndex(current => (current === idx ? undefined : idx))}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 12,
              backgroundColor: selectedIndex === idx ? colors.primarySoft : colors.surfaceStrong,
            }}
          >
            <Text style={[styles.muted, selectedIndex === idx && { color: colors.primary, fontWeight: '600' }]}>{cat}</Text>
          </Pressable>
        ))}
      </ScrollView>
    )}
    {selectedIndex !== undefined && selectedIndex >= 0 && selectedIndex < categories.length && (
      <Text style={styles.muted}>
        {categories[selectedIndex]}: {series.map(entry => `${entry.label ? `${entry.label}=` : ''}${Number.isFinite(entry.values[selectedIndex]) ? asText(entry.values[selectedIndex]) : '—'}${unit ? ` ${unit}` : ''}`).join(', ')}
      </Text>
    )}
    <View style={styles.actions}>
      <Button
        variant="quiet"
        label={s.bots.copyCsv}
        onPress={() => {
          const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)
          const header = [unit || 'Category', ...series.map(entry => entry.label)].map(escape).join(',')
          const lines = categories.map((label, idx) =>
            [label, ...series.map(entry => (Number.isFinite(entry.values[idx]) ? asText(entry.values[idx]) : ''))].map(escape).join(','),
          )
          void Clipboard.setStringAsync([header, ...lines].join('\n'))
        }}
      />
      <Button variant="quiet" label={s.bots.chartData} onPress={() => setTable(current => !current)} />
    </View>
    {(table || !valid) && <ScrollView horizontal><View>
      <View style={styles.tableRow}><Text style={styles.cell}>{unit}</Text>{series.map((entry, i) => <Text key={i} style={styles.cell}>{entry.label}</Text>)}</View>
      {categories.map((label, index) => <View key={index} style={styles.tableRow}><Text style={styles.cell}>{label}</Text>{series.map((entry, i) => <Text selectable key={i} style={styles.cell}>{Number.isFinite(entry.values[index]) ? asText(entry.values[index]) : '—'}{unit ? ` ${unit}` : ''}</Text>)}</View>)}
    </View></ScrollView>}
  </View>
}
