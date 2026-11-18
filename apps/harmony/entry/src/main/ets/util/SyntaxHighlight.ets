/** Syntax highlighting token types and palette aligned with Android syntax-highlight.ts. */
export class SyntaxToken {
  kind: string = 'plain';
  text: string = '';

  constructor(kind: string, text: string) {
    this.kind = kind;
    this.text = text;
  }
}

export class SyntaxPalette {
  background: string = '#131720';
  headerBackground: string = '#1B212E';
  border: string = '#273041';
  headerText: string = '#9AA3B5';
  plain: string = '#E6EDF3';
  comment: string = '#7B8496';
  string: string = '#7EE787';
  keyword: string = '#C792EA';
  number: string = '#F78C6C';
  type: string = '#79C0FF';
  functionColor: string = '#82AAFF';
  property: string = '#7FDBCA';
  operator: string = '#9AA3B5';
}

export function lightCodePalette(): SyntaxPalette {
  const p = new SyntaxPalette();
  p.background = '#F6F8FB';
  p.headerBackground = '#EDF1F7';
  p.border = '#E3E8F0';
  p.headerText = '#59606D';
  p.plain = '#1F2328';
  p.comment = '#6E7781';
  p.string = '#0A7B4F';
  p.keyword = '#9333EA';
  p.number = '#B45309';
  p.type = '#0284C7';
  p.functionColor = '#3B5BDB';
  p.property = '#0F766E';
  p.operator = '#57606A';
  return p;
}

export function darkCodePalette(): SyntaxPalette {
  return new SyntaxPalette();
}

export function syntaxColorFor(palette: SyntaxPalette, kind: string): string {
  if (kind === 'comment') return palette.comment;
  if (kind === 'string') return palette.string;
  if (kind === 'keyword') return palette.keyword;
  if (kind === 'number') return palette.number;
  if (kind === 'type') return palette.type;
  if (kind === 'function') return palette.functionColor;
  if (kind === 'property') return palette.property;
  if (kind === 'operator') return palette.operator;
  return palette.plain;
}

const MAX_HIGHLIGHT_CHARS = 16000;
const MAX_HIGHLIGHT_LINES = 400;

const COMMON_KEYWORDS: Set<string> = new Set([
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
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'GROUP',
  'BY', 'ORDER', 'LIMIT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'DISTINCT',
  'echo', 'local', 'fi', 'then', 'done', 'esac', 'cd', 'grep', 'git'
]);

const LITERAL_CONSTANTS: Set<string> = new Set([
  'true', 'false', 'null', 'undefined', 'nil', 'None', 'True', 'False', 'NaN', 'Infinity'
]);

const BUILTIN_TYPES: Set<string> = new Set([
  'string', 'number', 'boolean', 'object', 'symbol', 'bigint',
  'int', 'float', 'double', 'char', 'bool', 'str', 'bytes', 'list', 'dict', 'set', 'tuple',
  'u8', 'u16', 'u32', 'u64', 'usize', 'i8', 'i16', 'i32', 'i64', 'isize', 'f32', 'f64',
  'Promise', 'Array', 'Record', 'Map', 'Set', 'Error', 'Date', 'RegExp', 'Object', 'Text', 'View'
]);

function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36;
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57);
}

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}

function isHexDigit(ch: number): boolean {
  return isDigit(ch) || (ch >= 65 && ch <= 70) || (ch >= 97 && ch <= 102) || ch === 95;
}

function isWhitespace(ch: number): boolean {
  return ch === 32 || ch === 9 || ch === 10 || ch === 13;
}

function isOperatorChar(ch: number): boolean {
  return ch === 61 || ch === 43 || ch === 45 || ch === 42 || ch === 47 || ch === 37
    || ch === 60 || ch === 62 || ch === 33 || ch === 38 || ch === 124 || ch === 94
    || ch === 126 || ch === 63 || ch === 58;
}

function pushToken(out: SyntaxToken[], kind: string, text: string): void {
  if (text.length === 0) {
    return;
  }
  const prev: SyntaxToken | undefined = out.length > 0 ? out[out.length - 1] : undefined;
  if (prev !== undefined && prev.kind === kind) {
    prev.text += text;
  } else {
    out.push(new SyntaxToken(kind, text));
  }
}

function supportsHashComments(lang: string): boolean {
  return lang === 'py' || lang === 'python' || lang === 'sh' || lang === 'bash'
    || lang === 'zsh' || lang === 'shell' || lang === 'yaml' || lang === 'yml'
    || lang === 'toml' || lang === 'ruby' || lang === 'rb' || lang === 'dockerfile'
    || lang === 'makefile' || lang === 'ini' || lang === 'env';
}

/** Single-pass O(n) tokenizer for code blocks; splits result per-line safely if needed. */
export function highlightCode(code: string, language?: string): SyntaxToken[] {
  if (code.length === 0) {
    return [];
  }
  if (code.length > MAX_HIGHLIGHT_CHARS) {
    return [new SyntaxToken('plain', code)];
  }
  let lines = 1;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) {
      lines += 1;
      if (lines > MAX_HIGHLIGHT_LINES) {
        return [new SyntaxToken('plain', code)];
      }
    }
  }

  const lang: string = (language ?? '').trim().toLowerCase();
  const isJson: boolean = lang === 'json' || lang === 'jsonc' || lang === 'json5';
  const allowHashComment: boolean = supportsHashComments(lang) || lang.length === 0;
  const allowSlashComment: boolean = !isJson || lang === 'jsonc' || lang === 'json5';
  const tokens: SyntaxToken[] = [];
  const len: number = code.length;
  let i: number = 0;

  while (i < len) {
    const ch: number = code.charCodeAt(i);
    const next: number = i + 1 < len ? code.charCodeAt(i + 1) : 0;

    if ((allowSlashComment && ch === 47 && next === 47)
      || ((lang === 'sql' || lang === 'lua' || lang === 'haskell') && ch === 45 && next === 45)
      || (allowHashComment && ch === 35)) {
      let end = i + 1;
      while (end < len && code.charCodeAt(end) !== 10) {
        end += 1;
      }
      pushToken(tokens, 'comment', code.slice(i, end));
      i = end;
      continue;
    }

    if (allowSlashComment && ch === 47 && next === 42) {
      let end = i + 2;
      while (end + 1 < len && !(code.charCodeAt(end) === 42 && code.charCodeAt(end + 1) === 47)) {
        end += 1;
      }
      end = end + 1 < len ? end + 2 : len;
      pushToken(tokens, 'comment', code.slice(i, end));
      i = end;
      continue;
    }

    if (ch === 34 || ch === 39 || ch === 96) {
      const quote = ch;
      let end = i + 1;
      while (end < len) {
        const c = code.charCodeAt(end);
        if (c === 92) {
          end += 2;
          continue;
        }
        if (c === quote) {
          end += 1;
          break;
        }
        if (c === 10 && quote !== 96) {
          break;
        }
        end += 1;
      }
      const raw = code.slice(i, end);
      let k = end;
      while (k < len && (code.charCodeAt(k) === 32 || code.charCodeAt(k) === 9)) {
        k += 1;
      }
      const isKey: boolean = isJson && k < len && code.charCodeAt(k) === 58;
      pushToken(tokens, isKey ? 'property' : 'string', raw);
      i = end;
      continue;
    }

    if (isDigit(ch) || (ch === 46 && isDigit(next))) {
      let end = i;
      if (ch === 48 && (next === 120 || next === 88 || next === 98 || next === 66 || next === 111 || next === 79)) {
        end += 2;
        while (end < len && isHexDigit(code.charCodeAt(end))) {
          end += 1;
        }
      } else {
        while (end < len && (isDigit(code.charCodeAt(end)) || code.charCodeAt(end) === 95)) {
          end += 1;
        }
        if (end < len && code.charCodeAt(end) === 46 && end + 1 < len && isDigit(code.charCodeAt(end + 1))) {
          end += 1;
          while (end < len && (isDigit(code.charCodeAt(end)) || code.charCodeAt(end) === 95)) {
            end += 1;
          }
        }
        if (end < len && (code.charCodeAt(end) === 101 || code.charCodeAt(end) === 69)) {
          let exp = end + 1;
          if (exp < len && (code.charCodeAt(exp) === 43 || code.charCodeAt(exp) === 45)) {
            exp += 1;
          }
          if (exp < len && isDigit(code.charCodeAt(exp))) {
            end = exp;
            while (end < len && isDigit(code.charCodeAt(end))) {
              end += 1;
            }
          }
        }
      }
      pushToken(tokens, 'number', code.slice(i, end));
      i = end;
      continue;
    }

    if (isIdentStart(ch)) {
      let end = i + 1;
      while (end < len && isIdentPart(code.charCodeAt(end))) {
        end += 1;
      }
      const word = code.slice(i, end);
      let lookahead = end;
      while (lookahead < len && (code.charCodeAt(lookahead) === 32 || code.charCodeAt(lookahead) === 9)) {
        lookahead += 1;
      }
      const nextNonWs = lookahead < len ? code.charCodeAt(lookahead) : 0;
      const prevChar = i > 0 ? code.charCodeAt(i - 1) : 0;

      if (LITERAL_CONSTANTS.has(word)) {
        pushToken(tokens, 'number', word);
      } else if (COMMON_KEYWORDS.has(word)) {
        pushToken(tokens, 'keyword', word);
      } else if (BUILTIN_TYPES.has(word) || (ch >= 65 && ch <= 90 && word.length > 1 && word !== word.toUpperCase())) {
        pushToken(tokens, 'type', word);
      } else if (nextNonWs === 40) {
        pushToken(tokens, 'function', word);
      } else if (prevChar === 46 || (nextNonWs === 58 && !isJson)) {
        pushToken(tokens, 'property', word);
      } else {
        pushToken(tokens, 'plain', word);
      }
      i = end;
      continue;
    }

    if (isOperatorChar(ch)) {
      let end = i + 1;
      while (end < len && isOperatorChar(code.charCodeAt(end)) && end - i < 3) {
        end += 1;
      }
      pushToken(tokens, 'operator', code.slice(i, end));
      i = end;
      continue;
    }

    let end = i + 1;
    if (isWhitespace(ch)) {
      while (end < len && isWhitespace(code.charCodeAt(end))) {
        end += 1;
      }
    }
    pushToken(tokens, 'plain', code.slice(i, end));
    i = end;
  }

  return tokens;
}
