export type SyntaxTokenKind =
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'type'
  | 'function'
  | 'property'
  | 'operator'
  | 'plain'

export interface SyntaxToken {
  kind: SyntaxTokenKind
  text: string
}

export interface SyntaxPalette {
  background: string
  headerBackground: string
  border: string
  headerText: string
  plain: string
  comment: string
  string: string
  keyword: string
  number: string
  type: string
  function: string
  property: string
  operator: string
}

export const LIGHT_CODE_PALETTE: SyntaxPalette = {
  background: '#F6F8FB',
  headerBackground: '#EDF1F7',
  border: '#E3E8F0',
  headerText: '#59606D',
  plain: '#1F2328',
  comment: '#6E7781',
  string: '#0A7B4F',
  keyword: '#9333EA',
  number: '#B45309',
  type: '#0284C7',
  function: '#3B5BDB',
  property: '#0F766E',
  operator: '#57606A',
}

export const DARK_CODE_PALETTE: SyntaxPalette = {
  background: '#131720',
  headerBackground: '#1B212E',
  border: '#273041',
  headerText: '#9AA3B5',
  plain: '#E6EDF3',
  comment: '#7B8496',
  string: '#7EE787',
  keyword: '#C792EA',
  number: '#F78C6C',
  type: '#79C0FF',
  function: '#82AAFF',
  property: '#7FDBCA',
  operator: '#9AA3B5',
}

const MAX_HIGHLIGHT_CHARS = 16_000
const MAX_HIGHLIGHT_LINES = 400

const COMMON_KEYWORDS = new Set([
  'abstract', 'and', 'as', 'async', 'await', 'break', 'case', 'catch', 'class',
  'const', 'continue', 'debugger', 'def', 'default', 'defer', 'delete', 'do',
  'elif', 'else', 'enum', 'except', 'export', 'extends', 'extern', 'finally',
  'fn', 'for', 'from', 'fun', 'func', 'function', 'go', 'goto', 'if', 'impl',
  'import', 'in', 'instanceof', 'interface', 'is', 'lambda', 'let', 'loop',
  'match', 'mod', 'mut', 'namespace', 'new', 'not', 'of', 'or', 'override',
  'package', 'pass', 'private', 'protected', 'pub', 'public', 'raise', 'readonly',
  'return', 'select', 'self', 'static', 'struct', 'super', 'switch', 'this',
  'throw', 'throws', 'trait', 'try', 'type', 'typedef', 'typeof', 'use', 'using',
  'val', 'var', 'void', 'where', 'while', 'with', 'yield',
  // SQL & shell keywords
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'GROUP',
  'BY', 'ORDER', 'LIMIT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'DISTINCT',
  'echo', 'export', 'local', 'fi', 'then', 'done', 'esac', 'cd', 'grep', 'git',
])

const LITERAL_CONSTANTS = new Set([
  'true', 'false', 'null', 'undefined', 'nil', 'None', 'True', 'False', 'NaN', 'Infinity',
])

const BUILTIN_TYPES = new Set([
  'string', 'number', 'boolean', 'unknown', 'never', 'any', 'object', 'symbol', 'bigint',
  'int', 'float', 'double', 'char', 'bool', 'str', 'bytes', 'list', 'dict', 'set', 'tuple',
  'u8', 'u16', 'u32', 'u64', 'usize', 'i8', 'i16', 'i32', 'i64', 'isize', 'f32', 'f64',
  'Promise', 'Array', 'Record', 'Map', 'Set', 'Error', 'Date', 'RegExp', 'View', 'Text', 'ReactNode',
])

function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57)
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57
}

function isHexDigit(ch: number): boolean {
  return isDigit(ch) || (ch >= 65 && ch <= 70) || (ch >= 97 && ch <= 102) || ch === 95
}

function isWhitespace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === 10 || ch === 13
}

function isOperatorChar(ch: number): boolean {
  return ch === 61 || ch === 43 || ch === 45 || ch === 42 || ch === 47 || ch === 37
    || ch === 60 || ch === 62 || ch === 33 || ch === 38 || ch === 124 || ch === 94
    || ch === 126 || ch === 63 || ch === 58
}

function pushToken(out: SyntaxToken[], kind: SyntaxTokenKind, text: string) {
  if (!text) return
  const prev = out[out.length - 1]
  if (prev && prev.kind === kind) {
    prev.text += text
  } else {
    out.push({ kind, text })
  }
}

function normalizeLang(language?: string): string {
  return (language || '').trim().toLowerCase()
}

function supportsHashComments(lang: string): boolean {
  return lang === 'py' || lang === 'python' || lang === 'sh' || lang === 'bash'
    || lang === 'zsh' || lang === 'shell' || lang === 'yaml' || lang === 'yml'
    || lang === 'toml' || lang === 'ruby' || lang === 'rb' || lang === 'dockerfile'
    || lang === 'makefile' || lang === 'ini' || lang === 'env'
}

/**
 * Single-pass linear tokenizer for code blocks.
 * Guaranteed O(n) with no regex backtracking; falls back to plain text on huge blocks.
 */
export function highlightCode(code: string, language?: string): SyntaxToken[] {
  if (!code) return []
  if (code.length > MAX_HIGHLIGHT_CHARS) return [{ kind: 'plain', text: code }]
  let lines = 1
  for (let i = 0; i < code.length; i += 1) {
    if (code.charCodeAt(i) === 10 && ++lines > MAX_HIGHLIGHT_LINES) {
      return [{ kind: 'plain', text: code }]
    }
  }

  const lang = normalizeLang(language)
  const isJson = lang === 'json' || lang === 'jsonc' || lang === 'json5'
  const allowHashComment = supportsHashComments(lang) || lang === ''
  const allowSlashComment = !isJson || lang === 'jsonc' || lang === 'json5'
  const tokens: SyntaxToken[] = []
  const len = code.length
  let i = 0

  while (i < len) {
    const ch = code.charCodeAt(i)
    const next = i + 1 < len ? code.charCodeAt(i + 1) : 0

    // Line comments: // ... or -- ... (SQL) or # ...
    if ((allowSlashComment && ch === 47 && next === 47)
      || ((lang === 'sql' || lang === 'lua' || lang === 'haskell') && ch === 45 && next === 45)
      || (allowHashComment && ch === 35)) {
      let end = i + 1
      while (end < len && code.charCodeAt(end) !== 10) end += 1
      pushToken(tokens, 'comment', code.slice(i, end))
      i = end
      continue
    }

    // Block comments: /* ... */
    if (allowSlashComment && ch === 47 && next === 42) {
      let end = i + 2
      while (end + 1 < len && !(code.charCodeAt(end) === 42 && code.charCodeAt(end + 1) === 47)) {
        end += 1
      }
      end = end + 1 < len ? end + 2 : len
      pushToken(tokens, 'comment', code.slice(i, end))
      i = end
      continue
    }

    // Strings: ', ", `
    if (ch === 34 || ch === 39 || ch === 96) {
      const quote = ch
      let end = i + 1
      while (end < len) {
        const c = code.charCodeAt(end)
        if (c === 92) {
          end += 2
          continue
        }
        if (c === quote) {
          end += 1
          break
        }
        if (c === 10 && quote !== 96) {
          break
        }
        end += 1
      }
      const raw = code.slice(i, end)
      // Check if JSON / object property key followed by ':'
      let k = end
      while (k < len && (code.charCodeAt(k) === 32 || code.charCodeAt(k) === 9)) k += 1
      const isKey = isJson && code.charCodeAt(k) === 58
      pushToken(tokens, isKey ? 'property' : 'string', raw)
      i = end
      continue
    }

    // Numbers (only at token boundaries)
    if (isDigit(ch) || (ch === 46 && isDigit(next))) {
      let end = i
      if (ch === 48 && (next === 120 || next === 88 || next === 98 || next === 66 || next === 111 || next === 79)) {
        end += 2
        while (end < len && isHexDigit(code.charCodeAt(end))) end += 1
      } else {
        while (end < len && (isDigit(code.charCodeAt(end)) || code.charCodeAt(end) === 95)) end += 1
        if (end < len && code.charCodeAt(end) === 46 && end + 1 < len && isDigit(code.charCodeAt(end + 1))) {
          end += 1
          while (end < len && (isDigit(code.charCodeAt(end)) || code.charCodeAt(end) === 95)) end += 1
        }
        if (end < len && (code.charCodeAt(end) === 101 || code.charCodeAt(end) === 69)) {
          let exp = end + 1
          if (exp < len && (code.charCodeAt(exp) === 43 || code.charCodeAt(exp) === 45)) exp += 1
          if (exp < len && isDigit(code.charCodeAt(exp))) {
            end = exp
            while (end < len && isDigit(code.charCodeAt(end))) end += 1
          }
        }
      }
      pushToken(tokens, 'number', code.slice(i, end))
      i = end
      continue
    }

    // Identifiers, keywords, types, functions, properties
    if (isIdentStart(ch)) {
      let end = i + 1
      while (end < len && isIdentPart(code.charCodeAt(end))) end += 1
      const word = code.slice(i, end)

      let lookahead = end
      while (lookahead < len && (code.charCodeAt(lookahead) === 32 || code.charCodeAt(lookahead) === 9)) {
        lookahead += 1
      }
      const nextNonWs = lookahead < len ? code.charCodeAt(lookahead) : 0
      const prevChar = i > 0 ? code.charCodeAt(i - 1) : 0

      if (LITERAL_CONSTANTS.has(word)) {
        pushToken(tokens, 'number', word)
      } else if (COMMON_KEYWORDS.has(word)) {
        pushToken(tokens, 'keyword', word)
      } else if (BUILTIN_TYPES.has(word) || (ch >= 65 && ch <= 90 && word.length > 1 && word !== word.toUpperCase())) {
        pushToken(tokens, 'type', word)
      } else if (nextNonWs === 40) {
        // Followed by '(' -> function call or declaration
        pushToken(tokens, 'function', word)
      } else if (prevChar === 46 || (nextNonWs === 58 && !isJson)) {
        // Preceded by '.' or followed by ':' -> property / key
        pushToken(tokens, 'property', word)
      } else {
        pushToken(tokens, 'plain', word)
      }
      i = end
      continue
    }

    // Operators
    if (isOperatorChar(ch)) {
      let end = i + 1
      while (end < len && isOperatorChar(code.charCodeAt(end)) && end - i < 3) end += 1
      pushToken(tokens, 'operator', code.slice(i, end))
      i = end
      continue
    }

    // Whitespace or punctuation
    let end = i + 1
    if (isWhitespace(ch)) {
      while (end < len && isWhitespace(code.charCodeAt(end))) end += 1
    }
    pushToken(tokens, 'plain', code.slice(i, end))
    i = end
  }

  return tokens
}
