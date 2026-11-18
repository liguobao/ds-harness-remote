/** Which suggestion surface is active: `/` commands or `@` references. */
export type MentionType = 'command' | 'context'

/** The active `/` or `@` token anchored at the composer cursor. */
export interface MentionToken {
  type: MentionType
  /** Continuous characters between the trigger and the cursor. */
  query: string
  /** Index of the trigger character inside the draft; the pick replaces from here. */
  start: number
}

/**
 * Detect an active `/` or `@` token ending exactly at the cursor.
 * The trigger must sit at line start or right after whitespace, and the query
 * is the continuous (whitespace-free) run between trigger and cursor — so
 * deleting the trigger, or typing past a space, closes the popover naturally.
 */
export function detectMention(text: string, cursor: number): MentionToken | undefined {
  if (cursor <= 0) return undefined
  const quoted = /(?:^|\s)(@"([^"\n]*))$/u.exec(text.slice(0, cursor))
  if (quoted?.[1] !== undefined && quoted[2] !== undefined) return { type: 'context', query: quoted[2], start: cursor - quoted[1].length }
  let index = cursor
  while (index > 0 && !/\s/.test(text.charAt(index - 1))) index -= 1
  if (index >= cursor) return undefined
  const trigger = text.charAt(index)
  if (trigger !== '/' && trigger !== '@') return undefined
  if (index > 0 && !/\s/.test(text.charAt(index - 1))) return undefined
  return { type: trigger === '/' ? 'command' : 'context', query: text.slice(index + 1, cursor), start: index }
}

function matchScore(haystack: string, needle: string): number | undefined {
  const at = haystack.indexOf(needle)
  if (at >= 0) return 1_000 - at + (at === 0 ? 200 : 0)
  let index = 0
  for (const char of haystack) {
    if (char === needle[index]) index += 1
    if (index === needle.length) return 100
  }
  return undefined
}

/**
 * Case-insensitive fuzzy filter shared by the `/` and `@` menus: contiguous
 * matches outrank scattered subsequence matches; ties keep input order.
 */
export function filterByQuery<T>(items: T[], query: string, textOf: (item: T) => string[]): T[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return items
  const scored: Array<{ item: T; score: number; order: number }> = []
  items.forEach((item, order) => {
    let best: number | undefined
    for (const text of textOf(item)) {
      const score = matchScore(text.toLowerCase(), needle)
      if (score !== undefined && (best === undefined || score > best)) best = score
    }
    if (best !== undefined) scored.push({ item, score: best, order })
  })
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.map(entry => entry.item)
}

/** Official dsh-file-reference path grammar; chips close quoted directories. */
export function fileMentionText(path: string, isDirectory?: boolean): string | undefined {
  const norm = isDirectory && !path.endsWith('/') ? `${path}/` : path
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(norm)) return undefined
  return /\s/u.test(norm) ? `@"${norm}" ` : `@${norm} `
}

/** Mirrors dsh-session-reference/uri: JSON string, UTF-8, canonical base64url. */
export function sessionMentionText(sessionId: string, label: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(sessionId))
  const payload = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `@[${label.replace(/[\\\]]/gu, match => `\\${match}`)}](dsh-session:${payload}) `
}

export interface DraftSegment {
  text: string
  /** True for `/` commands and `@` references — rendered with the blue mark. */
  token: boolean
}

/**
 * Split a composer draft into plain/token segments. The web composer renders
 * inserted references with a blue mark (`.q44v1G_reference`), so `/commands`,
 * `@file:`path`` and `@“session title”` runs get the same treatment here.
 */
export function splitDraftSegments(text: string): DraftSegment[] {
  const segments: DraftSegment[] = []
  let plainStart = 0
  let index = 0
  while (index < text.length) {
    const char = text.charAt(index)
    if ((char !== '/' && char !== '@') || (index > 0 && !/\s/.test(text.charAt(index - 1)))) {
      index += 1
      continue
    }
    let end = -1
    const head = text.slice(index, index + 7)
    const next = text.charAt(index + 1)
    const sessionReference = char === '@' ? /^@\[((?:\\.|[^\\\]])*)\]\(dsh-session:[A-Za-z0-9_-]+\)/u.exec(text.slice(index)) : null
    if (sessionReference !== null) {
      end = index + sessionReference[0].length
    } else if (head.startsWith('@file:`')) {
      const closing = text.indexOf('`', index + 7)
      const lineEnd = text.indexOf('\n', index + 7)
      const bounded = closing >= 0 ? closing + 1 : lineEnd >= 0 ? lineEnd : text.length
      end = bounded
    } else if (char === '@' && (next === '“' || next === '"')) {
      const closing = next === '“' ? '”' : '"'
      const quoteEnd = text.indexOf(closing, index + 2)
      const lineEnd = text.indexOf('\n', index + 2)
      end = quoteEnd >= 0 ? quoteEnd + 1 : lineEnd >= 0 ? lineEnd : text.length
    } else {
      let cursor = index + 1
      while (cursor < text.length && !/\s/.test(text.charAt(cursor))) cursor += 1
      end = cursor
    }
    if (end <= index + 1) {
      index += 1
      continue
    }
    if (index > plainStart) segments.push({ text: text.slice(plainStart, index), token: false })
    segments.push({ text: text.slice(index, end), token: true })
    plainStart = end
    index = end
  }
  if (plainStart < text.length) segments.push({ text: text.slice(plainStart), token: false })
  return segments
}

/** Redact Windows / Unix user paths (e.g. C:\Users\<user>\...) to protect personal information. */
export function maskPersonalPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) return path
  return path
    .replace(/^[A-Za-z]:[\\/](?:HuaweiMoveData[\\/])?Users[\\/][^\\/]+/i, '~')
    .replace(/^\/(?:Users|home)[\\/][^\\/]+/i, '~')
}
