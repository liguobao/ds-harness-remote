// Formulas in a view blueprint: `{ "=": "price * qty" }`. A small expression language
// the page works out each time an input moves, so a Bot writes a calculation once and
// no model call follows. It reads names and calls a fixed set of functions; it has no
// property access, no assignment and no loops, so it cannot reach the page or run on.

const FUNCTIONS = {
  min: { args: [1, Infinity], run: (...values) => Math.min(...values.map(num)) },
  max: { args: [1, Infinity], run: (...values) => Math.max(...values.map(num)) },
  abs: { args: [1, 1], run: value => Math.abs(num(value)) },
  floor: { args: [1, 1], run: value => Math.floor(num(value)) },
  ceil: { args: [1, 1], run: value => Math.ceil(num(value)) },
  sqrt: { args: [1, 1], run: value => Math.sqrt(num(value)) },
  pow: { args: [2, 2], run: (base, power) => num(base) ** num(power) },
  round: { args: [1, 2], run: (value, digits = 0) => roundTo(num(value), digitsOf(digits)) },
  clamp: { args: [3, 3], run: (value, low, high) => Math.min(Math.max(num(value), num(low)), num(high)) },
  fixed: { args: [1, 2], run: (value, digits = 0) => roundTo(num(value), digitsOf(digits)).toFixed(digitsOf(digits)) },
  format: { args: [1, 2], run: (value, digits = 0) => grouped(num(value), digitsOf(digits)) },
  percent: { args: [1, 2], run: (value, digits = 0) => `${grouped(num(value) * 100, digitsOf(digits))}%` },
}
export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS)
const CONSTANTS = new Map([['true', true], ['false', false]])
// Nesting deeper than this is no calculation a view needs; the parser recurses per level.
const MAX_NESTING = 64

class FormulaError extends Error {}
const fail = (message) => { throw new FormulaError(message) }

function num(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  const parsed = Number(value)
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(parsed)) return parsed
  return fail(`${JSON.stringify(value)} is not a number`)
}
const digitsOf = (digits) => {
  const value = num(digits)
  if (!Number.isInteger(value) || value < 0 || value > 10) fail('digits must be a whole number from 0 to 10')
  return value
}
const roundTo = (value, digits) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
function grouped(value, digits) {
  if (!Number.isFinite(value)) return String(value)
  const [whole, part] = Math.abs(roundTo(value, digits)).toFixed(digits).split('.')
  const sign = value < 0 && Number(whole + (part ?? '')) !== 0 ? '-' : ''
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${part ? `.${part}` : ''}`
}

// -------------------------------------------------------------------------
// Tokens and parsing

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
export const isName = value => typeof value === 'string' && IDENT.test(value)
const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', ',']

function tokenize(source) {
  const tokens = []
  let at = 0
  while (at < source.length) {
    const char = source[at]
    if (/\s/.test(char)) { at += 1; continue }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(at))
    if (number) { tokens.push({ kind: 'number', value: Number(number[0]), at }); at += number[0].length; continue }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(at))
    if (name) { tokens.push({ kind: 'name', value: name[0], at }); at += name[0].length; continue }
    if (char === '"' || char === '\'') {
      let end = at + 1
      let text = ''
      while (end < source.length && source[end] !== char) {
        if (source[end] === '\\' && end + 1 < source.length) { text += source[end + 1]; end += 2; continue }
        text += source[end]
        end += 1
      }
      if (end >= source.length) fail(`unclosed string at ${at + 1}`)
      tokens.push({ kind: 'string', value: text, at })
      at = end + 1
      continue
    }
    const operator = OPERATORS.find(op => source.startsWith(op, at))
    if (operator === undefined) fail(`unexpected ${JSON.stringify(char)} at ${at + 1}`)
    tokens.push({ kind: 'op', value: operator, at })
    at += operator.length
  }
  return tokens
}

const BINARY = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']]

function parse(source) {
  const tokens = tokenize(source)
  let index = 0
  let depth = 0
  const peek = () => tokens[index]
  const isOp = value => peek()?.kind === 'op' && peek().value === value
  const expect = (value) => {
    if (!isOp(value)) fail(peek() ? `expected "${value}" at ${peek().at + 1}` : `expected "${value}" at the end`)
    index += 1
  }
  const nest = (read) => {
    depth += 1
    if (depth > MAX_NESTING) fail(`nested more than ${MAX_NESTING} levels`)
    const node = read()
    depth -= 1
    return node
  }
  const ternary = () => nest(() => {
    const test = binary(0)
    if (!isOp('?')) return test
    index += 1
    const yes = ternary()
    expect(':')
    return { type: 'if', test, yes, no: ternary() }
  })
  const binary = (level) => {
    if (level === BINARY.length) return unary()
    let left = binary(level + 1)
    while (peek()?.kind === 'op' && BINARY[level].includes(peek().value)) {
      const op = peek().value
      index += 1
      left = { type: 'binary', op, left, right: binary(level + 1) }
    }
    return left
  }
  const unary = () => {
    if (isOp('-') || isOp('!') || isOp('+')) {
      const op = peek().value
      index += 1
      return nest(() => ({ type: 'unary', op, value: unary() }))
    }
    return primary()
  }
  const primary = () => {
    const token = peek()
    if (token === undefined) fail('the formula ends too early')
    index += 1
    if (token.kind === 'number' || token.kind === 'string') return { type: 'value', value: token.value }
    if (token.kind === 'op' && token.value === '(') {
      const inner = ternary()
      expect(')')
      return inner
    }
    if (token.kind !== 'name') fail(`unexpected "${token.value}" at ${token.at + 1}`)
    if (!isOp('(')) return CONSTANTS.has(token.value) ? { type: 'value', value: CONSTANTS.get(token.value) } : { type: 'name', name: token.value }
    const fn = Object.hasOwn(FUNCTIONS, token.value) ? FUNCTIONS[token.value] : undefined
    if (fn === undefined) fail(`unknown function "${token.value}"; allowed: ${FORMULA_FUNCTIONS.join(', ')}`)
    index += 1
    const args = []
    if (!isOp(')')) {
      args.push(ternary())
      while (isOp(',')) { index += 1; args.push(ternary()) }
    }
    expect(')')
    if (args.length < fn.args[0] || args.length > fn.args[1]) {
      fail(`${token.value}() takes ${fn.args[0] === fn.args[1] ? fn.args[0] : fn.args[1] === Infinity ? `at least ${fn.args[0]}` : `${fn.args[0]} or ${fn.args[1]}`} argument${fn.args[1] === 1 ? '' : 's'}; got ${args.length}`)
    }
    return { type: 'call', name: token.value, args }
  }
  if (tokens.length === 0) fail('the formula is empty')
  const tree = ternary()
  if (index < tokens.length) fail(`unexpected "${peek().value}" at ${peek().at + 1}`)
  return tree
}

function namesIn(node, found = new Set()) {
  if (node.type === 'name') found.add(node.name)
  else if (node.type === 'unary') namesIn(node.value, found)
  else if (node.type === 'binary') { namesIn(node.left, found); namesIn(node.right, found) }
  else if (node.type === 'if') { namesIn(node.test, found); namesIn(node.yes, found); namesIn(node.no, found) }
  else if (node.type === 'call') for (const arg of node.args) namesIn(arg, found)
  return found
}

// { tree, names } or { error }. `names` are the names the formula reads.
export function compileFormula(source) {
  if (typeof source !== 'string') return { error: 'expected a formula string' }
  try {
    const tree = parse(source)
    return { tree, names: [...namesIn(tree)] }
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message }
    throw error
  }
}

// -------------------------------------------------------------------------
// Evaluation. `lookup(name)` returns a name's value or throws.

function run(node, lookup) {
  switch (node.type) {
    case 'value': return node.value
    case 'name': return lookup(node.name)
    case 'unary': {
      const value = run(node.value, lookup)
      if (node.op === '!') return !truthy(value)
      return node.op === '-' ? -num(value) : num(value)
    }
    case 'if': return truthy(run(node.test, lookup)) ? run(node.yes, lookup) : run(node.no, lookup)
    case 'call': return FUNCTIONS[node.name].run(...node.args.map(arg => run(arg, lookup)))
    default: return binary(node, lookup)
  }
}
const truthy = value => (typeof value === 'string' ? value !== '' : Boolean(value))

function binary(node, lookup) {
  if (node.op === '&&') return truthy(run(node.left, lookup)) ? run(node.right, lookup) : false
  if (node.op === '||') { const left = run(node.left, lookup); return truthy(left) ? left : run(node.right, lookup) }
  const left = run(node.left, lookup)
  const right = run(node.right, lookup)
  switch (node.op) {
    case '+': return typeof left === 'string' || typeof right === 'string' ? `${show(left)}${show(right)}` : num(left) + num(right)
    case '-': return num(left) - num(right)
    case '*': return num(left) * num(right)
    case '/': return num(left) / num(right)
    case '%': return num(left) % num(right)
    case '==': return left === right
    case '!=': return left !== right
    case '<': return num(left) < num(right)
    case '<=': return num(left) <= num(right)
    case '>': return num(left) > num(right)
    default: return num(left) >= num(right)
  }
}

// A value as text: numbers lose float noise (0.1 + 0.2 shows 0.3).
export function show(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : String(value)
  return String(value)
}

// A scope for one view: input values, plus `let` names worked out on demand. A cycle
// or a missing name fails the formula that reads it.
export function createScope(inputs, lets) {
  const done = new Map()
  const busy = new Set()
  const lookup = (name) => {
    if (inputs.has(name)) return inputs.get(name)
    if (done.has(name)) return done.get(name)
    const tree = lets.get(name)
    if (tree === undefined) fail(`unknown name "${name}"`)
    if (busy.has(name)) fail(`"${name}" refers to itself`)
    busy.add(name)
    try {
      const value = run(tree, lookup)
      done.set(name, value)
      return value
    } finally { busy.delete(name) }
  }
  return lookup
}

// { value } or { error }.
export function evaluate(tree, lookup) {
  try {
    return { value: run(tree, lookup) }
  } catch (error) {
    if (error instanceof FormulaError) return { error: error.message }
    if (error instanceof RangeError) return { error: 'the formula is too deep to work out' }
    throw error
  }
}
