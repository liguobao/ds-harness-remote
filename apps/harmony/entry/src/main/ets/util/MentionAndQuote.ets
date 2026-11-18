import { utf8ToBase64Url } from '../net/TransferCodec';

export class MentionToken {
  type: string = 'context'; // 'command' | 'context'
  query: string = '';
  start: number = 0;

  constructor(type: string, query: string, start: number) {
    this.type = type;
    this.query = query;
    this.start = start;
  }
}

/** Detect active `/` or `@` token ending at cursor (port of Android mention-helpers.ts). */
export function detectMention(text: string, cursor: number): MentionToken | undefined {
  if (cursor <= 0) {
    return undefined;
  }
  const head: string = text.slice(0, cursor);
  const quoted: RegExpExecArray | null = /(?:^|\s)(@"([^"\n]*))$/.exec(head);
  if (quoted !== null && quoted[1] !== undefined && quoted[2] !== undefined) {
    return new MentionToken('context', quoted[2], cursor - quoted[1].length);
  }
  let index: number = cursor;
  while (index > 0 && !/\s/.test(text.charAt(index - 1))) {
    index -= 1;
  }
  if (index >= cursor) {
    return undefined;
  }
  const trigger: string = text.charAt(index);
  if (trigger !== '/' && trigger !== '@') {
    return undefined;
  }
  if (index > 0 && !/\s/.test(text.charAt(index - 1))) {
    return undefined;
  }
  return new MentionToken(trigger === '/' ? 'command' : 'context', text.slice(index + 1, cursor), index);
}

function matchScore(haystack: string, needle: string): number {
  const at: number = haystack.indexOf(needle);
  if (at >= 0) {
    return 1000 - at + (at === 0 ? 200 : 0);
  }
  let idx = 0;
  for (let i = 0; i < haystack.length; i++) {
    if (haystack.charAt(i) === needle.charAt(idx)) {
      idx += 1;
      if (idx === needle.length) {
        return 100;
      }
    }
  }
  return -1;
}

class ScoredIndex {
  order: number = 0;
  score: number = 0;

  constructor(order: number, score: number) {
    this.order = order;
    this.score = score;
  }
}

/** Case-insensitive fuzzy ranking filter shared by `/` and `@` popovers. */
export function filterMentionItems<T>(items: T[], query: string, textsOf: (item: T) => string[]): T[] {
  const needle: string = query.trim().toLowerCase();
  if (needle.length === 0) {
    return items.slice();
  }
  const scored: ScoredIndex[] = [];
  for (let i = 0; i < items.length; i++) {
    const texts: string[] = textsOf(items[i]);
    let best = -1;
    for (const txt of texts) {
      const s = matchScore(txt.toLowerCase(), needle);
      if (s > best) {
        best = s;
      }
    }
    if (best >= 0) {
      scored.push(new ScoredIndex(i, best));
    }
  }
  scored.sort((a: ScoredIndex, b: ScoredIndex) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.order - b.order;
  });
  const out: T[] = [];
  for (const s of scored) {
    out.push(items[s.order]);
  }
  return out;
}

export function fileMentionText(path: string, isDirectory: boolean = false): string | undefined {
  const norm: string = isDirectory && !path.endsWith('/') ? path + '/' : path;
  if (/[\u0000-\u001f\u007f-\u009f"]/.test(norm)) {
    return undefined;
  }
  return /\s/.test(norm) ? `@"${norm}" ` : `@${norm} `;
}

export function sessionMentionText(sessionId: string, label: string): string {
  const payload: string = utf8ToBase64Url(JSON.stringify(sessionId));
  const escapedLabel: string = label.replace(/[\\\]]/g, (m: string) => '\\' + m);
  return `@[${escapedLabel}](dsh-session:${payload}) `;
}

export function quoteTextOf(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^ {0,3}>[ \t]?/gm, '');
}

export function formatQuoteText(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line: string) => '> ' + line).join('\n');
}

export function formatQuoteDraftSnippet(text: string, maxLength: number = 36): string {
  const normalized: string = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength) + '…';
}

export class ParsedQuotes {
  quotes: string[] = [];
  body: string = '';
}

/** Separate leading Markdown blockquote sections from body text. */
export function parseMessageQuotes(text: string): ParsedQuotes {
  const out = new ParsedQuotes();
  const normalized: string = text.replace(/\r\n?/g, '\n');
  const lines: string[] = normalized.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim().length === 0) {
    i += 1;
  }
  if (i >= lines.length || !/^ {0,3}>/.test(lines[i])) {
    out.body = text;
    return out;
  }
  let block: string[] = [];
  while (i < lines.length) {
    const line: string = lines[i];
    if (/^ {0,3}>/.test(line)) {
      block.push(quoteTextOf(line));
      i += 1;
      continue;
    }
    if (line.trim().length === 0 && block.length > 0) {
      const joined: string = block.join('\n').trim();
      if (joined.length > 0) {
        out.quotes.push(joined);
      }
      block = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().length === 0) {
        j += 1;
      }
      if (j < lines.length && /^ {0,3}>/.test(lines[j])) {
        i = j;
        continue;
      }
      i = j;
      break;
    }
    break;
  }
  if (block.length > 0) {
    const joined: string = block.join('\n').trim();
    if (joined.length > 0) {
      out.quotes.push(joined);
    }
  }
  out.body = lines.slice(i).join('\n').replace(/^\s+/, '');
  return out;
}

/** Structured rich Markdown block (code, math, quote, table, heading, bullet, image, link, paragraph). */
export class RichBlock {
  kind: string = 'paragraph'; // 'code' | 'mermaid' | 'math' | 'quote' | 'table' | 'heading' | 'bullet' | 'image' | 'link' | 'paragraph'
  text: string = '';
  language: string = '';
  imageSrc: string = '';
  imageAlt: string = '';
  linkUrl: string = '';
  headers: string[] = [];
  rows: string[][] = [];
}

/** Convert common LaTeX symbols/operators into crisp readable Unicode math expressions. */
export function formatMathDisplay(tex: string): string {
  let out: string = tex.trim();
  const pairs: string[][] = [
    ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'],
    ['\\epsilon', 'ε'], ['\\theta', 'θ'], ['\\lambda', 'λ'], ['\\mu', 'μ'],
    ['\\pi', 'π'], ['\\sigma', 'σ'], ['\\tau', 'τ'], ['\\phi', 'φ'],
    ['\\omega', 'ω'], ['\\Delta', 'Δ'], ['\\Sigma', 'Σ'], ['\\Omega', 'Ω'],
    ['\\infty', '∞'], ['\\sum', '∑'], ['\\prod', '∏'], ['\\int', '∫'],
    ['\\partial', '∂'], ['\\nabla', '∇'], ['\\sqrt', '√'], ['\\pm', '±'],
    ['\\times', '×'], ['\\cdot', '·'], ['\\div', '÷'], ['\\neq', '≠'],
    ['\\leq', '≤'], ['\\le', '≤'], ['\\geq', '≥'], ['\\ge', '≥'],
    ['\\approx', '≈'], ['\\equiv', '≡'], ['\\in', '∈'], ['\\notin', '∉'],
    ['\\subset', '⊂'], ['\\subseteq', '⊆'], ['\\cup', '∪'], ['\\cap', '∩'],
    ['\\forall', '∀'], ['\\exists', '∃'], ['\\rightarrow', '→'], ['\\to', '→'],
    ['\\leftarrow', '←'], ['\\Rightarrow', '⇒'], ['\\Leftrightarrow', '⇔'],
    ['\\ldots', '…'], ['\\cdots', '⋯']
  ];
  for (const pair of pairs) {
    out = out.split(pair[0]).join(pair[1]);
  }
  out = out.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
  out = out.replace(/\\(?:text|mathrm|mathbf|mathbb)\{([^{}]+)\}/g, '$1');
  return out;
}

function replaceInlineMath(line: string): string {
  let out: string = line.replace(/\\\((.+?)\\\)/g, (_m: string, inner: string) => formatMathDisplay(inner));
  out = out.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (m: string, prefix: string, inner: string) => {
    if (inner.trim().length === 0) {
      return m;
    }
    return prefix + formatMathDisplay(inner);
  });
  return out;
}

function splitTableRow(line: string): string[] {
  let trimmed: string = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith('|')) {
    trimmed = trimmed.slice(0, trimmed.length - 1);
  }
  return trimmed.split('|').map((cell: string) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells: string[] = splitTableRow(line);
  if (cells.length === 0) {
    return false;
  }
  for (const c of cells) {
    if (!/^:?-{2,}:?$/.test(c)) {
      return false;
    }
  }
  return true;
}

function stripInlineMarks(body: string): string {
  let out: string = replaceInlineMath(body);
  out = out.split('**').join('');
  out = out.split('__').join('');
  out = out.split('`').join('');
  return out;
}

/** Parse Markdown into rich structural blocks for `RichMessageView`. */
export function parseRichBlocks(source: string): RichBlock[] {
  const out: RichBlock[] = [];
  const raw: string[] = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;

  while (i < raw.length) {
    const line: string = raw[i];
    const trimmed: string = line.trim();

    // 1. Fenced code block / mermaid block
    if (trimmed.startsWith('```')) {
      const lang: string = trimmed.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < raw.length && !raw[i].trim().startsWith('```')) {
        buf.push(raw[i]);
        i += 1;
      }
      if (i < raw.length && raw[i].trim().startsWith('```')) {
        i += 1;
      }
      const blk = new RichBlock();
      blk.kind = lang.toLowerCase() === 'mermaid' ? 'mermaid' : 'code';
      blk.language = lang;
      blk.text = buf.join('\n');
      out.push(blk);
      continue;
    }

    // 2. Display Math block: $$ ... $$ or \[ ... \]
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      const closeDelim: string = trimmed.startsWith('$$') ? '$$' : '\\]';
      let body: string = trimmed.slice(2);
      const buf: string[] = [];
      if (body.trimEnd().endsWith(closeDelim) && body.trim().length > closeDelim.length) {
        buf.push(body.trimEnd().slice(0, -closeDelim.length));
        i += 1;
      } else {
        if (body.length > 0) {
          buf.push(body);
        }
        i += 1;
        while (i < raw.length) {
          const cur: string = raw[i].trimEnd();
          if (cur.endsWith(closeDelim)) {
            const part = cur.slice(0, -closeDelim.length);
            if (part.trim().length > 0) {
              buf.push(part);
            }
            i += 1;
            break;
          }
          buf.push(raw[i]);
          i += 1;
        }
      }
      const mathText = buf.join('\n').trim();
      if (mathText.length > 0) {
        const blk = new RichBlock();
        blk.kind = 'math';
        blk.text = mathText;
        out.push(blk);
      }
      continue;
    }

    if (trimmed.length === 0) {
      i += 1;
      continue;
    }

    // 3. Blockquote block
    if (/^ {0,3}>/.test(line)) {
      const qLines: string[] = [];
      while (i < raw.length && /^ {0,3}>/.test(raw[i])) {
        qLines.push(quoteTextOf(raw[i]));
        i += 1;
      }
      const qText: string = qLines.join('\n').trim();
      if (qText.length > 0) {
        const blk = new RichBlock();
        blk.kind = 'quote';
        blk.text = qText;
        out.push(blk);
      }
      continue;
    }

    // 4. Markdown Table
    if (trimmed.includes('|') && i + 1 < raw.length && isTableSeparator(raw[i + 1])) {
      const headers: string[] = splitTableRow(trimmed).map((h: string) => stripInlineMarks(h));
      i += 2;
      const rows: string[][] = [];
      while (i < raw.length && raw[i].trim().includes('|') && raw[i].trim().length > 0) {
        rows.push(splitTableRow(raw[i]).map((cell: string) => stripInlineMarks(cell)));
        i += 1;
      }
      const blk = new RichBlock();
      blk.kind = 'table';
      blk.headers = headers;
      blk.rows = rows;
      out.push(blk);
      continue;
    }

    // 5. Headings
    if (trimmed.startsWith('### ') || trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      let cut = 2;
      if (trimmed.startsWith('### ')) cut = 4;
      else if (trimmed.startsWith('## ')) cut = 3;
      const blk = new RichBlock();
      blk.kind = 'heading';
      blk.text = stripInlineMarks(trimmed.slice(cut));
      out.push(blk);
      i += 1;
      continue;
    }

    // 6. Bullet / numbered item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const blk = new RichBlock();
      blk.kind = 'bullet';
      blk.text = stripInlineMarks(trimmed.slice(2));
      out.push(blk);
      i += 1;
      continue;
    }

    // 7. Image line `![alt](src)`
    const imgMatch: RegExpMatchArray | null = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (imgMatch !== null) {
      const blk = new RichBlock();
      blk.kind = 'image';
      blk.imageAlt = imgMatch[1];
      blk.imageSrc = imgMatch[2];
      out.push(blk);
      i += 1;
      continue;
    }

    // 8. Standalone link `[label](url)`
    const linkMatch: RegExpMatchArray | null = trimmed.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (linkMatch !== null) {
      const blk = new RichBlock();
      blk.kind = 'link';
      blk.text = stripInlineMarks(linkMatch[1]);
      blk.linkUrl = linkMatch[2];
      out.push(blk);
      i += 1;
      continue;
    }

    // 9. Paragraph line (with inline link flattening + inline math Unicode formatting)
    const blk = new RichBlock();
    blk.kind = 'paragraph';
    const cleaned = stripInlineMarks(trimmed).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_m: string, label: string, url: string) => `${label} (${url})`);
    blk.text = cleaned;
    if (blk.text.length > 0) {
      out.push(blk);
    }
    i += 1;
  }

  return out;
}
