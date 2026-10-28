/** Reject duplicate keys before callers use parsed wire values. */
export function parseWireJson(input: string | Uint8Array): unknown {
  try {
    const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input)
    const value: unknown = JSON.parse(text)
    const objects: Array<Set<string> | undefined> = []
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]
      if (char === '{') objects.push(new Set())
      else if (char === '[') objects.push(undefined)
      else if (char === '}' || char === ']') objects.pop()
      else if (char === '"') {
        const start = index
        for (index += 1; index < text.length; index += 1) {
          if (text[index] === '\\') index += 1
          else if (text[index] === '"') break
        }
        let next = index + 1
        while (next < text.length && /\s/u.test(text[next]!)) next += 1
        if (text[next] !== ':') continue
        const keys = objects[objects.length - 1]!
        const key: string = JSON.parse(text.slice(start, index + 1))
        if (keys.has(key)) throw new Error('Duplicate JSON field.')
        keys.add(key)
      }
    }
    return value
  } catch {
    // Parser errors can contain credentials or business content.
    throw new Error('Invalid wire JSON.')
  }
}
