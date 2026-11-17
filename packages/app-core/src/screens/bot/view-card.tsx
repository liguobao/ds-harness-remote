import { useMemo, useRef, useState } from 'react'
import { PanResponder, ScrollView, Text, TextInput, View } from 'react-native'
import { Toggle } from '../../ui/toggle'
import { Minus, Plus } from 'lucide-react-native'
import { strings as s } from '../../locales/i18n'
import { object, objects, text, type BotObject } from '../../services/bot-catalog'
import { checkedBotView } from '../../services/bot-view'
import { Button, IconButton } from '../../ui/components'
import { NativeMarkdown } from '../../ui/markdown'
import { useTheme } from '../../ui/theme-context'
import { useThemedStyles } from '../../ui/use-themed-styles'
import { asText, choiceValue, inputDefault, resolve, validateViewAnswer, viewInputs, viewScope, type Scope } from '../../vendor/ds-bot/views.js'
import { BotChoice } from './controls'
import { createBotStyles } from './styles'
import { BotChart } from './view-chart'

type Reply = (action: string, values: BotObject) => void

/** Native components and a bounded expression interpreter; HTML never executes. */
export function BotViewCard({ pending, busy, reply }: { pending: BotObject; busy: boolean; reply: Reply }) {
  const styles = useThemedStyles(createBotStyles)
  const blueprint = useMemo(() => checkedBotView(pending), [pending.view, pending.title])
  return <View style={styles.card}>
    {!!text(pending.title) && <Text style={styles.heading}>{text(pending.title)}</Text>}
    {blueprint ? <ViewContent key={JSON.stringify(blueprint)} view={blueprint} busy={busy} reply={reply} /> : <Text style={styles.muted}>{s.bots.unknownCard}</Text>}
  </View>
}
function ViewContent({ view, busy, reply }: { view: BotObject; busy: boolean; reply: Reply }) {
  const styles = useThemedStyles(createBotStyles)
  const [inputs, setInputs] = useState<BotObject>({})
  const [error, setError] = useState(false)
  const scope = viewScope(view, inputs)
  const answer: Reply = (action, own) => {
    if (busy) return
    const values = viewInputs(view).length ? { ...own, inputs } : own
    if (validateViewAnswer(view, action, values).error) { setError(true); return }
    setError(false)
    reply(action, values)
  }
  return <View style={styles.section}>
    <ViewNode node={view} busy={busy} reply={answer} scope={scope} inputs={inputs} change={(id, value) => { setInputs(current => ({ ...current, [id]: value })); setError(false) }} />
    {error && <Text accessibilityRole="alert" style={styles.error}>{s.bots.invalidViewAnswer}</Text>}
  </View>
}
type NodeProps = { node: BotObject; busy: boolean; reply: Reply; scope: Scope; inputs: BotObject; change: (id: string, value: unknown) => void }
function ViewNode(props: NodeProps) {
  const { node, busy, reply, scope, inputs, change } = props
  const styles = useThemedStyles(createBotStyles)
  const { colors } = useTheme()
  const [selected, setSelected] = useState<string[]>([])
  const [fields, setFields] = useState<Record<string, string>>({})
  const id = text(node.id)
  const value = (item: unknown) => resolve(item, scope, '')
  const display = (item: unknown) => asText(value(item))
  const input = Object.hasOwn(inputs, id) ? inputs[id] : inputDefault(node)
  const resolvedTone = value(node.tone)
  const tone = resolvedTone === 'bad' ? colors.danger : resolvedTone === 'warn' ? colors.warning : resolvedTone === 'good' ? colors.success : resolvedTone === 'muted' ? colors.muted : colors.ink
  switch (node.type) {
    // Rows wrap on narrow screens instead of compressing labels and controls.
    case 'stack': case 'row': return <View style={node.type === 'row' ? styles.wrap : styles.section}>{objects(node.children).map((child, index) => <View key={index} style={node.type === 'row' ? { flexGrow: 1, flexBasis: 140 } : undefined}><ViewNode {...props} node={child} /></View>)}</View>
    case 'text': case 'callout': return <Text selectable style={[styles.body, { color: tone }]}>{display(node.text)}</Text>
    case 'metric': return <View><Text style={styles.muted}>{text(node.label)}</Text><Text selectable style={[styles.title, { color: tone }]}>{display(node.value)}</Text>{!!node.caption && <Text style={styles.muted}>{display(node.caption)}</Text>}</View>
    case 'progress': {
      const percent = node.percent !== undefined ? Number(value(node.percent)) : Number(value(node.max)) > 0 ? Number(value(node.value)) / Number(value(node.max)) * 100 : 0
      const bounded = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
      return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: bounded }}><Text style={styles.body}>{text(node.label)} · {Math.round(bounded)}%{node.valueLabel ? ` · ${display(node.valueLabel)}` : ''}</Text></View>
    }
    case 'table': return <ScrollView horizontal><View>
      <View style={styles.tableRow}>{objects(node.columns).map((column, i) => <Text key={i} style={styles.cell}>{text(column.label) || text(column.key)}</Text>)}</View>
      {(node.rows as unknown[][]).map((row, i) => <View key={i} style={styles.tableRow}>{row.map((cell, j) => <Text selectable key={j} style={styles.cell}>{display(cell)}</Text>)}</View>)}
    </View></ScrollView>
    case 'chart': return <BotChart node={node} scope={scope} />
    case 'sources': return <View style={styles.section}>{objects(node.items).map((item, i) => <View key={i}><Text style={styles.body}>{text(item.label)}</Text><NativeMarkdown text={`<${text(item.url)}>`} /></View>)}</View>
    case 'html': return <View style={styles.section}>{!!text(node.summary) && <Text selectable style={styles.body}>{text(node.summary)}</Text>}<Text style={styles.muted}>{s.bots.htmlFallback}</Text></View>
    case 'slider': case 'number': return <NumberInput node={node} value={input} change={value => change(id, value)} />
    case 'toggle': return <View style={styles.row}><Text style={[styles.body, styles.grow]}>{text(node.label)}</Text><Toggle accessibilityLabel={text(node.label)} value={input === true} onValueChange={value => change(id, value)} trackColor={{ true: colors.primary }} /></View>
    case 'choice': return <View style={styles.section}><Text style={styles.body}>{text(node.label)}</Text>{objects(node.options).map((option, i) => <BotChoice key={i} label={text(option.label)} checked={input === choiceValue(option)} disabled={false} onPress={() => change(id, choiceValue(option))} />)}</View>
    case 'options': return <View style={styles.section}>
      {objects(node.options).map((option, i) => {
        const label = text(option.label)
        return <BotChoice key={i} label={label} description={text(option.description)} multiple={node.multi === true} checked={selected.includes(label)} disabled={busy} onPress={() => setSelected(current => node.multi === true ? current.includes(label) ? current.filter(item => item !== label) : [...current, label] : [label])} />
      })}
      <View style={styles.actions}><Button label={s.bots.submit} disabled={busy || selected.length === 0} onPress={() => reply(id, { selected })} /></View>
    </View>
    case 'confirm': return <View style={styles.actions}>
      <Button variant="secondary" label={text(node.cancelLabel) || s.bots.reject} disabled={busy} onPress={() => reply(id, { confirmed: false })} />
      <Button label={text(node.confirmLabel) || s.bots.confirm} disabled={busy} onPress={() => reply(id, { confirmed: true })} />
    </View>
    case 'form': return <View style={styles.section}>
      {objects(node.fields).map((field, i) => <View style={styles.field} key={i}>
        <Text style={styles.body}>{text(field.label)}</Text><TextInput accessibilityLabel={text(field.label)} placeholder={text(field.placeholder)} placeholderTextColor={colors.muted} style={styles.input} maxLength={2000} editable={!busy} value={fields[text(field.id)] ?? ''} onChangeText={value => setFields(current => ({ ...current, [text(field.id)]: value }))} />
      </View>)}
      <View style={styles.actions}><Button label={text(node.submitLabel) || s.bots.submit} disabled={busy} onPress={() => reply(id, { fields })} /></View>
    </View>
    case 'submit': return <View style={styles.actions}><Button label={text(node.label) || s.bots.submit} disabled={busy} onPress={() => reply(id, {})} /></View>
    default: return <Text style={styles.muted}>{s.bots.unknownCard}</Text>
  }
}
function NumberInput({ node, value, change }: { node: BotObject; value: unknown; change: (value: number) => void }) {
  const styles = useThemedStyles(createBotStyles)
  const { colors } = useTheme()
  const [draft, setDraft] = useState(String(value ?? ''))
  const min = typeof node.min === 'number' ? node.min : undefined
  const max = typeof node.max === 'number' ? node.max : undefined
  const step = typeof node.step === 'number' ? node.step : 1
  const number = Number(value)
  const valid = Number.isFinite(number) && (min === undefined || number >= min) && (max === undefined || number <= max)
  const update = (next: number) => { setDraft(String(next)); change(next) }
  const increment = (direction: number) => update(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Number(((Number.isFinite(number) ? number : min ?? 0) + direction * step).toPrecision(12)))))
  const label = text(node.label)
  return <View style={styles.field}>
    <Text style={styles.body}>{label}{node.unit ? ` (${text(node.unit)})` : ''}</Text>
    <View style={styles.row}><IconButton label={`${s.bots.decrease}: ${label}`} icon={Minus} disabled={min !== undefined && number <= min} onPress={() => increment(-1)} />
      <TextInput accessibilityLabel={label} style={[styles.input, styles.grow]} keyboardType="numbers-and-punctuation" value={draft} maxLength={40} onChangeText={text => { setDraft(text); change(text.trim() ? Number(text) : NaN) }} />
      <IconButton label={`${s.bots.increase}: ${label}`} icon={Plus} disabled={max !== undefined && number >= max} onPress={() => increment(1)} />
    </View>
    {node.type === 'slider' && min !== undefined && max !== undefined && max > min && <LocalSlider label={label} min={min} max={max} step={step} value={Number.isFinite(number) ? number : min} change={update} />}
    {(min !== undefined || max !== undefined) && <Text style={styles.muted}>{min ?? '−∞'} – {max ?? '∞'}</Text>}
    {!valid && <Text style={[styles.muted, { color: colors.danger }]}>{s.bots.invalidNumber}</Text>}
  </View>
}
function LocalSlider({ label, min, max, step, value, change }: { label: string; min: number; max: number; step: number; value: number; change: (value: number) => void }) {
  const { colors } = useTheme()
  const width = useRef(1)
  const start = useRef(0)
  const latest = useRef({ min, max, step, change })
  latest.current = { min, max, step, change }
  const fromX = (x: number) => {
    const { min, max, step, change } = latest.current
    const ratio = Math.max(0, Math.min(1, x / width.current))
    change(Math.max(min, Math.min(max, Number((min + Math.round(ratio * (max - min) / step) * step).toPrecision(12)))))
  }
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => { start.current = event.nativeEvent.locationX; fromX(start.current) },
    onPanResponderMove: (_event, gesture) => fromX(start.current + gesture.dx),
  }), [])
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return <View {...responder.panHandlers} onLayout={event => { width.current = Math.max(1, event.nativeEvent.layout.width) }}
    accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: Math.max(min, Math.min(max, value)) }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={event => change(Math.max(min, Math.min(max, value + (event.nativeEvent.actionName === 'increment' ? step : -step))))}
    style={{ height: 48, justifyContent: 'center', paddingHorizontal: 0 }}>
    <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: colors.border }}><View style={{ width: `${ratio * 100}%`, height: 4, backgroundColor: colors.primary }} /></View>
    <View pointerEvents="none" style={{ position: 'absolute', left: `${ratio * 100}%`, marginLeft: -10, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary }} />
  </View>
}
