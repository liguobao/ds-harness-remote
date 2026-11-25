export const HANDOFF_COMMENT_PREFIX = '<!-- dsh-handoff:v1 '

/** A thread preview can end mid-header, after the title but before the closing comment. */
export function handoffPreviewTitle(preview: string): string | undefined {
  if (!preview.startsWith(HANDOFF_COMMENT_PREFIX)) return undefined
  const header = preview.slice(HANDOFF_COMMENT_PREFIX.length, 4096).split(/ -->|[\r\n]/u, 1)[0]!
  const field = /"sourceTitle"\s*:\s*("(?:[^"\\]|\\.)*")/u.exec(header)
  if (!field) return undefined
  try {
    const title = (JSON.parse(field[1]!) as string).replace(/\s+/gu, ' ').trim()
    return title && !title.startsWith(HANDOFF_COMMENT_PREFIX) ? title : undefined
  } catch {
    return undefined
  }
}
