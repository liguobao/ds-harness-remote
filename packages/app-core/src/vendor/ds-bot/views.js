// View cards: the blueprint a Bot may show, and the answer a user may send back.
// Pure, so the host can validate a card before it is stored and the client can
// later render the same blueprint. No component runs model-written code: formulas
// go through formula.js, and an html component only ever runs in a sandboxed frame.

import { compileFormula, createScope, evaluate, isName, show } from './formula.js'

const LAYOUT = ['stack', 'row']
const DISPLAY = ['text', 'metric', 'table', 'chart', 'progress', 'callout', 'sources', 'html']
const INPUT_TYPES = ['slider', 'choice', 'toggle', 'number']
const ANSWERS = ['options', 'confirm', 'form', 'submit']
const COMPONENTS = [...LAYOUT, ...DISPLAY, ...INPUT_TYPES, ...ANSWERS]
const TONES = ['good', 'warn', 'bad']
const TEXT_TONES = ['muted']
const CALLOUT_TONES = ['info', 'good', 'warn', 'bad']
export const CHART_KINDS = ['bar', 'hbar', 'line', 'area', 'donut']
const INTERACTIVE = new Set(ANSWERS)
const INPUTS = new Set(INPUT_TYPES)
const PROPS = {
  stack: ['children', 'let'],
  row: ['children', 'let'],
  text: ['text', 'tone'],
  metric: ['label', 'value', 'tone', 'caption'],
  table: ['columns', 'rows'],
  chart: ['kind', 'categories', 'series', 'unit', 'caption'],
  progress: ['label', 'percent', 'value', 'max', 'valueLabel', 'tone'],
  callout: ['text', 'tone'],
  sources: ['items'],
  html: ['html', 'summary', 'height'],
  slider: ['id', 'label', 'min', 'max', 'step', 'value', 'unit'],
  choice: ['id', 'label', 'options', 'value'],
  toggle: ['id', 'label', 'value'],
  number: ['id', 'label', 'min', 'max', 'step', 'value', 'unit'],
  options: ['id', 'options', 'multi'],
  confirm: ['id', 'confirmLabel', 'cancelLabel'],
  form: ['id', 'fields', 'submitLabel'],
  submit: ['id', 'label'],
}
const MAX_DEPTH = 8
const MAX_NODES = 64
const MAX_CHILDREN = 16
const MAX_TEXT = 2000
const MAX_CELL = 200
const MAX_COLUMNS = 8
const MAX_ROWS = 50
const MAX_OPTIONS = 8
const MAX_FIELDS = 6
const SUMMARY_PART = 40
const SUMMARY_COUNT = 8
const RESERVED = new Set(['true', 'false'])
// UTF-8 bytes of the blueprint JSON plus the title. Not a wrapped document:
// the tool rejects a show_view whose viewBytes() is over this before it
// normalizes or validates, so the number has to be the bytes the model sent.
export const VIEW_BYTE_LIMIT = 8192

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const quoted = value => JSON.stringify(value)
const allowed = list => list.join(', ')
const isNumber = value => typeof value === 'number' && Number.isFinite(value)
const isScalar = value => typeof value === 'string' || typeof value === 'boolean' || isNumber(value)

// `{ "=": "a * b" }`: a value worked out from the view's inputs.
export const isFormula = value => isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, '=')

export function viewBytes(title, view) {
  return new TextEncoder().encode(`${JSON.stringify(view) ?? ''}${title ?? ''}`).length
}

const NUMERIC = ['value', 'percent', 'min', 'max', 'step', 'height']
const numeric = value => (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value)

// Some providers serialize nested arrays as `{ item: [...] }` (XML-style) and
// numbers as strings. Normalize the blueprint before validation so a model is
// not asked to retry a call whose only fault is the provider's encoding.
// Arrays are unwrapped; numeric fields and chart values accept a numeric string.
// Returns a new object; the input is not mutated.
export function normalizeView(value) {
  if (Array.isArray(value)) return value.map(normalizeView)
  if (!isRecord(value)) return value
  const keys = Object.keys(value)
  // Unwrap recursively: a provider may nest the wrapper, as { item: { item: [...] } }.
  if (keys.length === 1 && keys[0] === 'item') {
    const inner = normalizeView(value.item)
    if (Array.isArray(inner)) return inner
  }
  // Define own properties: an incoming "__proto__" key must become data the
  // validator can reject, not hit the prototype setter and vanish from the JSON.
  const out = {}
  for (const key of keys) Object.defineProperty(out, key, { value: normalizeView(value[key]), writable: true, enumerable: true, configurable: true })
  for (const field of NUMERIC) if (Object.hasOwn(out, field)) out[field] = numeric(out[field])
  if (Array.isArray(out.values)) out.values = out.values.map(numeric)
  return out
}

export function validateView(view) {
  const ctx = { ids: new Set(), nodes: 0, interactive: false, inputs: new Map(), lets: new Map(), formulas: [] }
  const error = checkNode(view, 'view', 1, ctx) ?? checkFormulas(ctx)
  return error === undefined ? { ok: true, interactive: ctx.interactive } : { ok: false, error }
}

// What show_view checks before it shows a view: the same answer on the host and
// in the client. The bytes are measured as sent, before normalizeView unwraps the
// provider's encoding, or a wrapped view could shrink under the byte limit. The
// normalized view and the trimmed title come back; the title may be empty.
export function checkShownView(title, sent) {
  let bytes
  try { bytes = viewBytes(title, sent) } catch { return { error: 'The view is not JSON data.' } }
  if (bytes > VIEW_BYTE_LIMIT) return { error: `The view is ${bytes} bytes; the limit is ${VIEW_BYTE_LIMIT}.` }
  if (title !== undefined && title !== null && typeof title !== 'string') return { error: 'title: expected a string' }
  const named = String(title ?? '').trim()
  const view = normalizeView(sent)
  const checked = validateView(view)
  if (!checked.ok) return { error: checked.error }
  return { title: named, view, interactive: checked.interactive }
}

function checkNode(node, path, depth, ctx) {
  if (!isRecord(node)) return `${path}: expected a component object`
  if (depth > MAX_DEPTH) return `${path}: ${depth} levels exceeds the limit of ${MAX_DEPTH}`
  ctx.nodes += 1
  if (ctx.nodes > MAX_NODES) return `${path}: ${ctx.nodes} components exceeds the limit of ${MAX_NODES}`
  const type = node.type
  if (!COMPONENTS.includes(type)) return `${path}.type: unknown component ${quoted(type)}; allowed: ${allowed(COMPONENTS)}`
  const props = PROPS[type]
  for (const key of Object.keys(node)) {
    if (key === 'type' || props.includes(key)) continue
    return `${path}.${key}: unknown property ${quoted(key)}; allowed: ${allowed(props)}`
  }
  if (INTERACTIVE.has(type)) ctx.interactive = true
  switch (type) {
    case 'stack': case 'row': return checkLayout(node, path, depth, ctx)
    case 'text': return checkText(node, path, ctx)
    case 'metric': return checkMetric(node, path, ctx)
    case 'table': return checkTable(node, path, ctx)
    case 'chart': return checkChart(node, path, ctx)
    case 'progress': return checkProgress(node, path, ctx)
    case 'callout': return checkCallout(node, path, ctx)
    case 'sources': return checkSources(node, path)
    case 'html': return checkHtml(node, path)
    case 'slider': case 'number': return checkNumberInput(node, path, ctx)
    case 'choice': return checkChoice(node, path, ctx)
    case 'toggle': return checkToggle(node, path, ctx)
    case 'options': return checkOptions(node, path, ctx)
    case 'confirm': return checkConfirm(node, path, ctx)
    case 'form': return checkForm(node, path, ctx)
    default: return checkSubmit(node, path, ctx)
  }
}

function checkLayout(node, path, depth, ctx) {
  if (node.let !== undefined) {
    if (depth !== 1) return `${path}.let: only the outermost component can define names`
    if (!isRecord(node.let)) return `${path}.let: expected an object of names to formulas`
    for (const [name, source] of Object.entries(node.let)) {
      if (!isName(name) || RESERVED.has(name)) return `${path}.let.${name}: a name is letters, digits and _, and starts with a letter or _`
      if (typeof source !== 'string') return `${path}.let.${name}: expected a formula string`
      ctx.lets.set(name, { source, path: `${path}.let.${name}` })
    }
  }
  if (!Array.isArray(node.children)) return `${path}.children: expected an array of 1 to ${MAX_CHILDREN} components`
  if (node.children.length < 1 || node.children.length > MAX_CHILDREN) return `${path}.children: expected 1 to ${MAX_CHILDREN} children; got ${node.children.length}`
  for (let index = 0; index < node.children.length; index += 1) {
    const error = checkNode(node.children[index], `${path}.children[${index}]`, depth + 1, ctx)
    if (error !== undefined) return error
  }
  return undefined
}

// A property that may be a literal of `kind` or a formula giving one. Formulas are
// checked once the whole tree, with every input and name, is known.
function checkValue(node, key, path, ctx, kind, { required = false, max = MAX_TEXT } = {}) {
  const value = node[key]
  const at = `${path}.${key}`
  if (value === undefined) return required ? `${at}: ${expected(kind)}` : undefined
  if (isFormula(value)) {
    ctx.formulas.push({ source: value['='], path: at, kind })
    return undefined
  }
  if (kind === 'number') return isNumber(value) ? undefined : `${at}: ${expected(kind)}`
  if (Array.isArray(kind)) return kind.includes(value) ? undefined : `${at}: unknown tone ${quoted(value)}; allowed: ${allowed(kind)}`
  if (kind === 'string') {
    if (typeof value !== 'string') return `${at}: ${expected(kind)}`
    return value.length > max ? `${at}: ${value.length} characters exceeds the limit of ${max}` : undefined
  }
  if (!isScalar(value)) return `${at}: ${expected(kind)}`
  return undefined
}
const expected = kind => (kind === 'number' ? 'expected a number' : kind === 'string' ? 'expected a string' : Array.isArray(kind) ? `expected one of ${allowed(kind)}` : 'expected a string or a number')

function checkText(node, path, ctx) {
  return checkValue(node, 'text', path, ctx, 'string', { required: true })
    ?? checkValue(node, 'tone', path, ctx, TEXT_TONES)
}

function checkMetric(node, path, ctx) {
  if (typeof node.label !== 'string') return `${path}.label: expected a string`
  if (node.value === undefined) return `${path}.value: expected a string or a number`
  if (typeof node.value === 'number' && !Number.isFinite(node.value)) return `${path}.value: expected a finite number`
  return checkValue(node, 'value', path, ctx, 'scalar')
    ?? checkValue(node, 'tone', path, ctx, TONES)
    ?? checkValue(node, 'caption', path, ctx, 'string')
}

function checkTable(node, path, ctx) {
  if (!Array.isArray(node.columns)) return `${path}.columns: expected an array of at most ${MAX_COLUMNS} columns`
  if (node.columns.length > MAX_COLUMNS) return `${path}.columns: ${node.columns.length} columns exceeds the limit of ${MAX_COLUMNS}`
  for (let index = 0; index < node.columns.length; index += 1) {
    const column = node.columns[index]
    const at = `${path}.columns[${index}]`
    if (!isRecord(column)) return `${at}: expected a column object`
    for (const key of Object.keys(column)) {
      if (key !== 'key' && key !== 'label') return `${at}.${key}: unknown property ${quoted(key)}; allowed: key, label`
    }
    if (typeof column.key !== 'string' || column.key === '') return `${at}.key: expected a non-empty string`
    if (typeof column.label !== 'string') return `${at}.label: expected a string`
  }
  if (!Array.isArray(node.rows)) return `${path}.rows: expected an array of at most ${MAX_ROWS} rows`
  if (node.rows.length > MAX_ROWS) return `${path}.rows: ${node.rows.length} rows exceeds the limit of ${MAX_ROWS}`
  for (let row = 0; row < node.rows.length; row += 1) {
    const cells = node.rows[row]
    if (!Array.isArray(cells)) return `${path}.rows[${row}]: expected an array of cells`
    for (let column = 0; column < cells.length; column += 1) {
      const at = `${path}.rows[${row}][${column}]`
      if (isFormula(cells[column])) { ctx.formulas.push({ source: cells[column]['='], path: at, kind: 'scalar' }); continue }
      const text = cellText(cells[column])
      if (text.length > MAX_CELL) return `${at}: ${text.length} characters exceeds the limit of ${MAX_CELL}`
    }
  }
  return undefined
}

function checkChart(node, path, ctx) {
  if (node.kind !== undefined && !CHART_KINDS.includes(node.kind)) return `${path}.kind: unknown chart ${quoted(node.kind)}; allowed: ${allowed(CHART_KINDS)}`
  if (!Array.isArray(node.categories) || node.categories.length === 0) return `${path}.categories: expected a non-empty array of labels`
  for (let index = 0; index < node.categories.length; index += 1) {
    const label = node.categories[index]
    if (typeof label !== 'string' && !isNumber(label)) return `${path}.categories[${index}]: expected a string`
  }
  if (!Array.isArray(node.series) || node.series.length === 0) return `${path}.series: expected a non-empty array of { name?, values }`
  if (node.kind === 'donut' && node.series.length > 1) return `${path}.series: a donut takes one series; got ${node.series.length}`
  for (let index = 0; index < node.series.length; index += 1) {
    const series = node.series[index]
    const at = `${path}.series[${index}]`
    if (!isRecord(series)) return `${at}: expected a series object`
    for (const key of Object.keys(series)) {
      if (key !== 'name' && key !== 'values') return `${at}.${key}: unknown property ${quoted(key)}; allowed: name, values`
    }
    if (series.name !== undefined && typeof series.name !== 'string') return `${at}.name: expected a string`
    if (!Array.isArray(series.values)) return `${at}.values: expected an array of numbers`
    if (series.values.length !== node.categories.length) return `${at}.values: ${series.values.length} values for ${node.categories.length} categories`
    for (let item = 0; item < series.values.length; item += 1) {
      const value = series.values[item]
      if (isFormula(value)) ctx.formulas.push({ source: value['='], path: `${at}.values[${item}]`, kind: 'number' })
      else if (!isNumber(value)) return `${at}.values[${item}]: expected a number`
    }
  }
  if (node.unit !== undefined && typeof node.unit !== 'string') return `${path}.unit: expected a string`
  if (node.caption !== undefined && typeof node.caption !== 'string') return `${path}.caption: expected a string`
  return undefined
}

function checkProgress(node, path, ctx) {
  if (node.label !== undefined && typeof node.label !== 'string') return `${path}.label: expected a string`
  if ((node.percent === undefined) === (node.value === undefined)) return `${path}: give percent (0 to 100), or value with max`
  if (node.percent !== undefined && !isFormula(node.percent)) {
    if (typeof node.percent !== 'number' || !Number.isFinite(node.percent) || node.percent < 0 || node.percent > 100) return `${path}.percent: expected a number from 0 to 100`
  }
  if (node.value !== undefined && node.max === undefined) return `${path}.max: expected a number with value`
  if (node.value === undefined && node.max !== undefined) return `${path}.value: expected a number with max`
  return checkValue(node, 'percent', path, ctx, 'number')
    ?? checkValue(node, 'value', path, ctx, 'number')
    ?? checkValue(node, 'max', path, ctx, 'number')
    ?? checkValue(node, 'valueLabel', path, ctx, 'scalar')
    ?? checkValue(node, 'tone', path, ctx, TONES)
}

function checkCallout(node, path, ctx) {
  return checkValue(node, 'text', path, ctx, 'string', { required: true })
    ?? checkValue(node, 'tone', path, ctx, CALLOUT_TONES)
}

function checkSources(node, path) {
  if (!Array.isArray(node.items) || node.items.length === 0) return `${path}.items: expected a non-empty array of { label, url }`
  for (let index = 0; index < node.items.length; index += 1) {
    const item = node.items[index]
    const at = `${path}.items[${index}]`
    if (!isRecord(item)) return `${at}: expected a { label, url } object`
    for (const key of Object.keys(item)) {
      if (key !== 'label' && key !== 'url') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, url`
    }
    if (typeof item.label !== 'string' || item.label.trim() === '') return `${at}.label: expected a non-empty string`
    if (typeof item.url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(item.url)) return `${at}.url: expected an http(s) address`
  }
  return undefined
}

function checkHtml(node, path) {
  if (typeof node.html !== 'string' || node.html.trim() === '') return `${path}.html: expected a non-empty string`
  if (typeof node.summary !== 'string' || node.summary.trim() === '') return `${path}.summary: expected one line that says what the view shows`
  if (node.height !== undefined && (!isNumber(node.height) || node.height <= 0)) return `${path}.height: expected a positive number of pixels`
  return undefined
}

function checkInputId(node, path, ctx) {
  if (!isName(node.id) || RESERVED.has(node.id)) return `${path}.id: an input id is letters, digits and _, and starts with a letter or _, so formulas can use it`
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`
  ctx.ids.add(node.id)
  if (typeof node.label !== 'string') return `${path}.label: expected a string`
  return undefined
}

function checkNumberInput(node, path, ctx) {
  const idError = checkInputId(node, path, ctx)
  if (idError !== undefined) return idError
  for (const key of ['min', 'max', 'step']) {
    if (node[key] !== undefined && !isNumber(node[key])) return `${path}.${key}: expected a number`
  }
  if (node.type === 'slider' && (node.min === undefined || node.max === undefined)) return `${path}: a slider needs min and max`
  if (node.min !== undefined && node.max !== undefined && node.max <= node.min) return `${path}.max: expected more than min (${node.min})`
  if (node.step !== undefined && node.step <= 0) return `${path}.step: expected more than 0`
  if (!isNumber(node.value)) return `${path}.value: expected a number`
  if ((node.min !== undefined && node.value < node.min) || (node.max !== undefined && node.value > node.max)) return `${path}.value: expected a number from ${node.min ?? '-∞'} to ${node.max ?? '∞'}`
  if (node.unit !== undefined && typeof node.unit !== 'string') return `${path}.unit: expected a string`
  ctx.inputs.set(node.id, node.value)
  return undefined
}

function checkChoice(node, path, ctx) {
  const idError = checkInputId(node, path, ctx)
  if (idError !== undefined) return idError
  if (!Array.isArray(node.options) || node.options.length === 0) return `${path}.options: expected a non-empty array of { label, value }`
  const labels = new Set()
  const values = new Set()
  for (let index = 0; index < node.options.length; index += 1) {
    const option = node.options[index]
    const at = `${path}.options[${index}]`
    if (!isRecord(option)) return `${at}: expected a { label, value } object`
    for (const key of Object.keys(option)) {
      if (key !== 'label' && key !== 'value') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, value`
    }
    if (typeof option.label !== 'string' || option.label.trim() === '') return `${at}.label: expected a non-empty string`
    if (labels.has(option.label)) return `${at}.label: duplicate label ${quoted(option.label)}`
    labels.add(option.label)
    const value = option.value ?? option.label
    if (!isScalar(value)) return `${at}.value: expected a string, a number or true/false`
    if (values.has(value)) return `${at}.value: duplicate value ${quoted(value)}`
    values.add(value)
  }
  const chosen = node.value ?? choiceValue(node.options[0])
  if (!values.has(chosen)) return `${path}.value: expected one of the options' values`
  ctx.inputs.set(node.id, chosen)
  return undefined
}

function checkToggle(node, path, ctx) {
  const idError = checkInputId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.value !== undefined && typeof node.value !== 'boolean') return `${path}.value: expected true or false`
  ctx.inputs.set(node.id, node.value === true)
  return undefined
}

function checkOptions(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.multi !== undefined && typeof node.multi !== 'boolean') return `${path}.multi: expected a boolean`
  if (!Array.isArray(node.options)) return `${path}.options: expected an array of 1 to ${MAX_OPTIONS} options`
  if (node.options.length < 1 || node.options.length > MAX_OPTIONS) return `${path}.options: expected 1 to ${MAX_OPTIONS} options; got ${node.options.length}`
  const labels = new Set()
  for (let index = 0; index < node.options.length; index += 1) {
    const option = node.options[index]
    const at = `${path}.options[${index}]`
    if (!isRecord(option)) return `${at}: expected an option object`
    for (const key of Object.keys(option)) {
      if (key !== 'label' && key !== 'description') return `${at}.${key}: unknown property ${quoted(key)}; allowed: label, description`
    }
    if (typeof option.label !== 'string' || option.label.trim() === '') return `${at}.label: expected a non-empty string`
    if (labels.has(option.label)) return `${at}.label: duplicate label ${quoted(option.label)}`
    labels.add(option.label)
    if (option.description !== undefined && typeof option.description !== 'string') return `${at}.description: expected a string`
  }
  return undefined
}

function checkConfirm(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.confirmLabel !== undefined && typeof node.confirmLabel !== 'string') return `${path}.confirmLabel: expected a string`
  if (node.cancelLabel !== undefined && typeof node.cancelLabel !== 'string') return `${path}.cancelLabel: expected a string`
  return undefined
}

function checkForm(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.submitLabel !== undefined && typeof node.submitLabel !== 'string') return `${path}.submitLabel: expected a string`
  if (!Array.isArray(node.fields)) return `${path}.fields: expected an array of at most ${MAX_FIELDS} fields`
  if (node.fields.length > MAX_FIELDS) return `${path}.fields: ${node.fields.length} fields exceeds the limit of ${MAX_FIELDS}`
  const seen = new Set()
  for (let index = 0; index < node.fields.length; index += 1) {
    const field = node.fields[index]
    const at = `${path}.fields[${index}]`
    if (!isRecord(field)) return `${at}: expected a field object`
    for (const key of Object.keys(field)) {
      if (key !== 'id' && key !== 'label' && key !== 'placeholder') return `${at}.${key}: unknown property ${quoted(key)}; allowed: id, label, placeholder`
    }
    if (typeof field.id !== 'string' || field.id === '') return `${at}.id: expected a non-empty string`
    if (field.id === '__proto__') return `${at}.id: "__proto__" cannot be an id`
    if (seen.has(field.id)) return `${at}.id: duplicate field id ${quoted(field.id)}`
    seen.add(field.id)
    if (typeof field.label !== 'string') return `${at}.label: expected a string`
    if (field.placeholder !== undefined && typeof field.placeholder !== 'string') return `${at}.placeholder: expected a string`
  }
  return undefined
}

function checkSubmit(node, path, ctx) {
  const idError = checkId(node, path, ctx)
  if (idError !== undefined) return idError
  if (node.label !== undefined && typeof node.label !== 'string') return `${path}.label: expected a string`
  return undefined
}

function checkId(node, path, ctx) {
  if (typeof node.id !== 'string' || node.id === '') return `${path}.id: expected a non-empty string`
  // A `__proto__` id would write through to a plain object's prototype where the
  // answer is kept, losing it silently.
  if (node.id === '__proto__') return `${path}.id: "__proto__" cannot be an id`
  if (ctx.ids.has(node.id)) return `${path}.id: duplicate id ${quoted(node.id)}`
  ctx.ids.add(node.id)
  return undefined
}

// Every formula parses, reads only inputs and names the view defines, and gives the
// right kind of value with the inputs as the Bot set them.
function checkFormulas(ctx) {
  const known = new Set([...ctx.inputs.keys(), ...ctx.lets.keys()])
  const lets = new Map()
  for (const [name, entry] of ctx.lets) {
    if (ctx.inputs.has(name)) return `${entry.path}: ${quoted(name)} is already an input id`
    const compiled = compileFormula(entry.source)
    if (compiled.error !== undefined) return `${entry.path}: ${compiled.error}`
    const unknown = compiled.names.find(item => !known.has(item))
    if (unknown !== undefined) return `${entry.path}: unknown name ${quoted(unknown)}; known: ${allowed([...known]) || '(none)'}`
    lets.set(name, compiled.tree)
  }
  const lookup = createScope(ctx.inputs, lets)
  for (const [name, entry] of ctx.lets) {
    const result = evaluate(lets.get(name), lookup)
    if (result.error !== undefined) return `${entry.path}: ${result.error}`
  }
  for (const formula of ctx.formulas) {
    const compiled = compileFormula(formula.source)
    if (compiled.error !== undefined) return `${formula.path}: ${compiled.error}`
    const unknown = compiled.names.find(item => !known.has(item))
    if (unknown !== undefined) return `${formula.path}: unknown name ${quoted(unknown)}; known: ${allowed([...known]) || '(none)'}`
    const result = evaluate(compiled.tree, lookup)
    if (result.error !== undefined) return `${formula.path}: ${result.error}`
    const problem = kindProblem(result.value, formula.kind)
    if (problem !== undefined) return `${formula.path}: the formula gives ${quoted(result.value)}; ${problem}`
  }
  return undefined
}

function kindProblem(value, kind) {
  if (kind === 'number') return isNumber(value) ? undefined : 'expected a number'
  if (Array.isArray(kind)) return kind.includes(value) ? undefined : `expected one of ${allowed(kind)}`
  if (kind === 'string') return isScalar(value) ? undefined : 'expected text'
  return isScalar(value) ? undefined : 'expected a string or a number'
}

function cellText(value) {
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return typeof text === 'string' ? text : ''
}

// -------------------------------------------------------------------------
// Working a blueprint out: the client draws with these, the summary reads them.

const compiled = new WeakMap()
const treeOf = (formula) => {
  let entry = compiled.get(formula)
  if (entry === undefined) {
    entry = compileFormula(formula['='])
    compiled.set(formula, entry)
  }
  return entry
}

export const choiceValue = option => option?.value ?? option?.label

function walk(node, visit) {
  if (!isRecord(node)) return
  visit(node)
  if (LAYOUT.includes(node.type) && Array.isArray(node.children)) for (const child of node.children) walk(child, visit)
}

export function viewInputs(view) {
  const found = []
  walk(view, (node) => { if (INPUTS.has(node.type)) found.push(node) })
  return found
}

export function inputDefault(node) {
  if (node.type === 'toggle') return node.value === true
  if (node.type === 'choice') return node.value ?? choiceValue(Array.isArray(node.options) ? node.options[0] : undefined)
  return node.value
}

export const hasInputs = view => viewInputs(view).length > 0

// The values a view's formulas read: each input's default unless `values` sets it.
export function viewScope(view, values = {}) {
  const inputs = new Map()
  for (const node of viewInputs(view)) inputs.set(node.id, Object.hasOwn(values, node.id) ? values[node.id] : inputDefault(node))
  const lets = new Map()
  for (const [name, source] of Object.entries(isRecord(view?.let) ? view.let : {})) {
    const entry = compileFormula(source)
    if (entry.tree !== undefined) lets.set(name, entry.tree)
  }
  return createScope(inputs, lets)
}

// A property's value: the literal, or the formula worked out. A formula that fails
// with these inputs gives `fallback`.
export function resolve(value, lookup, fallback = undefined) {
  if (!isFormula(value)) return value
  const entry = treeOf(value)
  if (entry.tree === undefined) return fallback
  const result = evaluate(entry.tree, lookup)
  return result.error === undefined ? result.value : fallback
}

export const asText = value => (value === undefined || value === null ? '' : show(value))

// -------------------------------------------------------------------------
// Summaries

function clip(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length <= SUMMARY_PART ? flat : flat.slice(0, SUMMARY_PART)
}

const choiceLabel = (node, value) => (Array.isArray(node.options) ? node.options : []).find(option => choiceValue(option) === value)?.label ?? asText(value)

function inputText(node, value) {
  if (node.type === 'toggle') return value === true ? 'on' : 'off'
  if (node.type === 'choice') return choiceLabel(node, value)
  return `${asText(value)}${node.unit ? ` ${node.unit}` : ''}`
}

function progressPercent(node, lookup) {
  if (node.percent !== undefined) return Number(resolve(node.percent, lookup, 0))
  const max = Number(resolve(node.max, lookup, 0))
  return max > 0 ? (Number(resolve(node.value, lookup, 0)) / max) * 100 : 0
}

function componentSummary(node, lookup) {
  const value = item => asText(resolve(item, lookup, ''))
  switch (node.type) {
    case 'text': return `text: ${value(node.text)}`
    case 'metric': return `metric: ${node.label}=${value(node.value)}`
    case 'table': return `table: ${(Array.isArray(node.columns) ? node.columns : []).map(column => column?.label ?? column?.key ?? '').filter(Boolean).join('/')}`
    case 'chart': {
      const series = Array.isArray(node.series) ? node.series[0] : undefined
      const values = Array.isArray(series?.values) ? series.values : []
      const unit = node.unit ? ` ${node.unit}` : ''
      return `chart: ${(Array.isArray(node.categories) ? node.categories : []).map((label, index) => `${label}=${value(values[index])}${unit}`).join(', ')}`
    }
    case 'progress': return `progress: ${node.label ? `${node.label} ` : ''}${Math.round(progressPercent(node, lookup))}%`
    case 'callout': return `callout: ${value(node.text)}`
    case 'sources': return `sources: ${(Array.isArray(node.items) ? node.items : []).map(item => item?.label).filter(Boolean).join('/')}`
    case 'html': return `html: ${node.summary ?? ''}`
    case 'slider': case 'number': case 'choice': case 'toggle': return `${node.type}: ${node.label}=${inputText(node, inputDefault(node))}`
    case 'options': return `options: ${(Array.isArray(node.options) ? node.options : []).map(option => option?.label).filter(Boolean).join('/')}`
    case 'confirm': return 'confirm'
    case 'form': return `form: ${(Array.isArray(node.fields) ? node.fields : []).map(field => field?.label ?? field?.id).filter(Boolean).join('/')}`
    case 'submit': return `submit: ${node.label ?? 'Send'}`
    default: return undefined
  }
}

// One line for a handoff or a checkpoint. Containers add nothing of their own;
// each component keeps one short phrase, and the line stops after a few. Formulas
// show what they give with the inputs as the Bot set them.
export function viewSummary(view) {
  const parts = []
  const lookup = viewScope(view)
  const visit = (node) => {
    if (parts.length >= SUMMARY_COUNT || !isRecord(node)) return
    const line = componentSummary(node, lookup)
    if (line !== undefined) parts.push(clip(line))
    if (parts.length >= SUMMARY_COUNT || !LAYOUT.includes(node.type) || !Array.isArray(node.children)) return
    for (const child of node.children) visit(child)
  }
  visit(view)
  return parts.join('; ')
}

// The inputs of an answer as `Label=value` pairs, for the Bot's history.
export function inputsSummary(view, inputs) {
  if (!isRecord(inputs)) return ''
  return viewInputs(view)
    .filter(node => Object.hasOwn(inputs, node.id))
    .map(node => `${node.label || node.id}=${inputText(node, inputs[node.id])}`)
    .join('; ')
}

// -------------------------------------------------------------------------
// Answers

function interactiveNodes(node, found = []) {
  walk(node, (item) => { if (INTERACTIVE.has(item.type)) found.push(item) })
  return found
}

// `action` is the id of the component the user submitted. One submit settles
// the whole card, so only that component's values are kept, plus the inputs'
// values when the view has inputs.
export function validateViewAnswer(view, action, values) {
  const nodes = interactiveNodes(view)
  if (typeof action !== 'string' || action === '') return { error: `action: expected an interactive component id; allowed: ${allowed(nodes.map(node => node.id))}` }
  const node = nodes.find(item => item.id === action)
  if (node === undefined) return { error: `action: no interactive component with id ${quoted(action)}; allowed: ${allowed(nodes.map(item => item.id))}` }
  if (!isRecord(values)) return { error: 'values: expected an object' }
  const inputs = validateInputs(view, values.inputs)
  if (inputs.error !== undefined) return inputs
  const extra = inputs.inputs === undefined ? {} : { inputs: inputs.inputs }
  if (node.type === 'submit') return { ...extra }
  const own = node.type === 'options' ? validateOptions(node, values) : node.type === 'confirm' ? validateConfirm(values) : validateForm(node, values)
  return own.error === undefined ? { ...own, ...extra } : own
}

// Every input of the view, as sent or else as the Bot set it.
function validateInputs(view, sent) {
  const nodes = viewInputs(view)
  if (nodes.length === 0) return sent === undefined ? {} : { error: 'values.inputs: this view has no inputs' }
  if (sent !== undefined && !isRecord(sent)) return { error: 'values.inputs: expected an object of input ids to values' }
  const given = sent ?? {}
  const ids = nodes.map(node => node.id)
  const unknown = Object.keys(given).find(key => !ids.includes(key))
  if (unknown !== undefined) return { error: `values.inputs.${unknown}: unknown input; allowed: ${allowed(ids)}` }
  const inputs = {}
  for (const node of nodes) {
    const value = Object.hasOwn(given, node.id) ? given[node.id] : inputDefault(node)
    const at = `values.inputs.${node.id}`
    if (node.type === 'toggle' && typeof value !== 'boolean') return { error: `${at}: expected true or false` }
    if (node.type === 'choice' && !(Array.isArray(node.options) ? node.options : []).some(option => choiceValue(option) === value)) return { error: `${at}: expected one of the options' values` }
    if (node.type === 'slider' || node.type === 'number') {
      if (!isNumber(value)) return { error: `${at}: expected a number` }
      if ((node.min !== undefined && value < node.min) || (node.max !== undefined && value > node.max)) return { error: `${at}: expected a number from ${node.min ?? '-∞'} to ${node.max ?? '∞'}` }
    }
    inputs[node.id] = value
  }
  return { inputs }
}

function validateOptions(node, values) {
  if (!Array.isArray(values.selected)) return { error: 'values.selected: expected an array of option labels' }
  const labels = new Set((node.options ?? []).map(option => option?.label))
  const picked = values.selected.filter(label => typeof label === 'string' && labels.has(label))
  const selected = node.multi === true ? [...new Set(picked)] : picked.slice(0, 1)
  if (selected.length === 0) return { error: 'values.selected: select at least one option' }
  return { selected }
}

function validateConfirm(values) {
  if (typeof values.confirmed !== 'boolean') return { error: 'values.confirmed: expected a boolean' }
  return { confirmed: values.confirmed }
}

function validateForm(node, values) {
  if (!isRecord(values.fields)) return { error: 'values.fields: expected an object of field ids to strings' }
  const declared = (node.fields ?? []).map(field => field?.id).filter(id => typeof id === 'string')
  const allowedIds = new Set(declared)
  const fields = {}
  for (const [key, value] of Object.entries(values.fields)) {
    if (!allowedIds.has(key)) return { error: `values.fields.${key}: unknown field; allowed: ${allowed(declared)}` }
    if (typeof value !== 'string') return { error: `values.fields.${key}: expected a string` }
    if (value.length > MAX_TEXT) return { error: `values.fields.${key}: ${value.length} characters exceeds the limit of ${MAX_TEXT}` }
    fields[key] = value
  }
  return { fields }
}
