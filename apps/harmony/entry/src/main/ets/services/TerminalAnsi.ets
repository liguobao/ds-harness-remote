/**
 * Lightweight ANSI / VT100 terminal output normalizer and screen buffer.
 * Strips OSC/CSI control sequences safely and applies cursor movement, CR/LF,
 * erase-line, and screen-clear controls cleanly for readable mobile output.
 */
export class TerminalScreenBuffer {
  private lines: string[] = [''];
  private row: number = 0;
  private col: number = 0;
  private readonly maxLines: number;

  constructor(maxLines: number = 600) {
    this.maxLines = maxLines;
  }

  reset(initialText: string = ''): void {
    this.lines = [''];
    this.row = 0;
    this.col = 0;
    if (initialText.length > 0) {
      this.append(initialText);
    }
  }

  text(): string {
    return this.lines.join('\n');
  }

  lineCount(): number {
    return this.lines.length;
  }

  append(chunk: string): void {
    const len: number = chunk.length;
    let i: number = 0;
    while (i < len) {
      const code: number = chunk.charCodeAt(i);
      if (code === 27) { // ESC
        const consumed = this.consumeEscape(chunk, i);
        i += consumed;
        continue;
      }
      if (code === 13) { // \r
        this.col = 0;
        i += 1;
        continue;
      }
      if (code === 10) { // \n
        this.newline();
        i += 1;
        continue;
      }
      if (code === 8) { // backspace
        if (this.col > 0) {
          this.col -= 1;
        }
        i += 1;
        continue;
      }
      if (code === 9) { // tab
        const spaces = 4 - (this.col % 4);
        for (let s = 0; s < spaces; s++) {
          this.writeChar(' ');
        }
        i += 1;
        continue;
      }
      if (code < 32) {
        i += 1;
        continue;
      }
      this.writeChar(chunk.charAt(i));
      i += 1;
    }
  }

  private ensureRow(targetRow: number): void {
    while (this.lines.length <= targetRow) {
      this.lines.push('');
    }
    if (this.lines.length > this.maxLines) {
      const drop = this.lines.length - this.maxLines;
      this.lines.splice(0, drop);
      this.row = Math.max(0, this.row - drop);
    }
  }

  private newline(): void {
    this.row += 1;
    this.col = 0;
    this.ensureRow(this.row);
  }

  private writeChar(ch: string): void {
    this.ensureRow(this.row);
    const cur: string = this.lines[this.row];
    if (this.col === cur.length) {
      this.lines[this.row] = cur + ch;
    } else if (this.col > cur.length) {
      let pad = '';
      for (let p = cur.length; p < this.col; p++) {
        pad += ' ';
      }
      this.lines[this.row] = cur + pad + ch;
    } else {
      this.lines[this.row] = cur.slice(0, this.col) + ch + cur.slice(this.col + 1);
    }
    this.col += 1;
  }

  private consumeEscape(chunk: string, start: number): number {
    const len: number = chunk.length;
    if (start + 1 >= len) {
      return 1;
    }
    const next: string = chunk.charAt(start + 1);
    // OSC sequence: ESC ] ... (BEL or ESC \)
    if (next === ']') {
      let j = start + 2;
      while (j < len) {
        if (chunk.charCodeAt(j) === 7) {
          return j - start + 1;
        }
        if (chunk.charCodeAt(j) === 27 && j + 1 < len && chunk.charAt(j + 1) === '\\') {
          return j - start + 2;
        }
        j += 1;
      }
      return len - start;
    }
    // CSI sequence: ESC [ params finalByte (0x40..0x7E)
    if (next === '[') {
      let j = start + 2;
      while (j < len) {
        const c = chunk.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) {
          const params = chunk.slice(start + 2, j);
          this.applyCsi(chunk.charAt(j), params);
          return j - start + 1;
        }
        j += 1;
      }
      return len - start;
    }
    // Single-char escape
    return 2;
  }

  private applyCsi(cmd: string, params: string): void {
    if (cmd === 'm') {
      return; // SGR color/style stripped cleanly
    }
    const clean = params.replace(/^[?>=]/, '');
    const parts = clean.length > 0 ? clean.split(';') : [];
    const n1 = parts.length > 0 && parts[0].length > 0 ? parseInt(parts[0], 10) : 0;
    const n2 = parts.length > 1 && parts[1].length > 0 ? parseInt(parts[1], 10) : 0;

    if (cmd === 'J') {
      if (n1 === 2 || n1 === 3) {
        this.lines = [''];
        this.row = 0;
        this.col = 0;
      } else if (n1 === 0) {
        this.ensureRow(this.row);
        this.lines[this.row] = this.lines[this.row].slice(0, this.col);
        this.lines.splice(this.row + 1);
      }
      return;
    }
    if (cmd === 'K') {
      this.ensureRow(this.row);
      const cur = this.lines[this.row];
      if (n1 === 2) {
        this.lines[this.row] = '';
        this.col = 0;
      } else if (n1 === 1) {
        let spaces = '';
        const k = Math.min(this.col, cur.length);
        for (let s = 0; s < k; s++) spaces += ' ';
        this.lines[this.row] = spaces + cur.slice(k);
      } else {
        this.lines[this.row] = cur.slice(0, this.col);
      }
      return;
    }
    if (cmd === 'H' || cmd === 'f') {
      const targetRow = (n1 > 0 ? n1 : 1) - 1;
      const targetCol = (n2 > 0 ? n2 : 1) - 1;
      this.row = Math.max(0, Math.min(targetRow, 400));
      this.col = Math.max(0, targetCol);
      this.ensureRow(this.row);
      return;
    }
    const delta = n1 > 0 ? n1 : 1;
    if (cmd === 'A') {
      this.row = Math.max(0, this.row - delta);
    } else if (cmd === 'B') {
      this.row += delta;
      this.ensureRow(this.row);
    } else if (cmd === 'C') {
      this.col += delta;
    } else if (cmd === 'D') {
      this.col = Math.max(0, this.col - delta);
    }
  }
}

export class TerminalSpecialKey {
  label: string = '';
  seq: string = '';

  constructor(label: string, seq: string) {
    this.label = label;
    this.seq = seq;
  }
}

export function specialKeysBar(): TerminalSpecialKey[] {
  return [
    new TerminalSpecialKey('Ctrl+C', '\x03'),
    new TerminalSpecialKey('Ctrl+D', '\x04'),
    new TerminalSpecialKey('Ctrl+Z', '\x1a'),
    new TerminalSpecialKey('Tab', '\t'),
    new TerminalSpecialKey('Esc', '\x1b'),
    new TerminalSpecialKey('↑', '\x1b[A'),
    new TerminalSpecialKey('↓', '\x1b[B'),
    new TerminalSpecialKey('←', '\x1b[D'),
    new TerminalSpecialKey('→', '\x1b[C'),
    new TerminalSpecialKey('Clear', '\x0c')
  ];
}
