/** Presentation only: never change the stored message or interpret arbitrary XML. */
export function heartbeatMessageBody(text: string, role: 'user' | 'assistant'): string | undefined {
  const envelope = /^\s*<heartbeat>\s*([\s\S]*?)\s*<\/heartbeat>\s*$/.exec(text)
  if (!envelope) return undefined
  const fields = new Map<string, string>()
  let rest = envelope[1]!
  while (rest.trim()) {
    const field = /^\s*<(automation_id|decision|message|instructions)>([\s\S]*?)<\/\1>/.exec(rest)
    if (!field || fields.has(field[1]!)) return undefined
    fields.set(field[1]!, field[2]!.trim())
    rest = rest.slice(field[0].length)
  }
  if (!fields.get('automation_id')) return undefined
  if (role === 'assistant') {
    if (!fields.has('decision') || fields.has('instructions')) return undefined
    return fields.get('message') || undefined
  }
  if (fields.has('decision') || fields.has('message')) return undefined
  return fields.get('instructions') || undefined
}
