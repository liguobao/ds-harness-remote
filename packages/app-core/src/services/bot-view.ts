import { checkShownView } from '../vendor/ds-bot/views.js'
import type { BotObject } from './bot-catalog'

/** A Host card is still untrusted input. Bound traversal before provider normalization. */
export function checkedBotView(pending: BotObject): BotObject | undefined {
  const stack = [{ value: pending.view, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { value, depth } = stack.pop()!
    if (++count > 4096 || depth > 32) return undefined
    if (value && typeof value === 'object') {
      const children = Object.values(value)
      if (children.length + count + stack.length > 4096) return undefined
      for (const child of children) stack.push({ value: child, depth: depth + 1 })
    }
  }
  try {
    const checked = checkShownView(pending.title, pending.view)
    return checked.error === undefined ? checked.view : undefined
  } catch { return undefined }
}
