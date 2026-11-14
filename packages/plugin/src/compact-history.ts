import { compactBotRound } from './compact-bot-round.js'

/** Read-only history projection. Never removes records or changes cursor/identity/state. */
const LIMIT = 512
const MARKER = '\n[Compact history: output omitted]'
/**
 * Total characters one projection may spend on preserved group rounds. The
 * compact snapshot is a single secure frame (4 MiB ceiling) and the Android
 * follow stream has no transfer fallback, so growth has to stay far below it.
 */
const ROUND_BUDGET = 128 * 1024
const TOOL_EVENT_TYPES = new Set(['tool/call', 'tool/result', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start', 'tool/code-dispatch', 'tool/code-dispatch-start'])
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

type Budget = { remaining: number }

/** Keep a recognised group round inside the document budget, else fall back. */
function preservedRound(text: string, budget: Budget): string | undefined {
  if (budget.remaining < LIMIT) return undefined
  const round = compactBotRound(text)
  if (round === undefined || round.length > budget.remaining) return undefined
  budget.remaining -= round.length
  return round
}

function summary(value: unknown, budget: Budget): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? ''
  if (text.length <= LIMIT) return text
  return preservedRound(text, budget) ?? text.slice(0, LIMIT) + MARKER
}

function toolValue(value: unknown, budget: Budget): unknown {
  if (Array.isArray(value)) return value.map(item => toolValue(item, budget))
  if (!object(value)) return value
  const result: Record<string, unknown> = { ...value }
  for (const [key, child] of Object.entries(value)) {
    if (['input', 'arguments', 'output', 'result', 'rawInput', 'rawOutput', 'uiResultMeta', 'meta', 'argumentsDelta', 'code'].includes(key)) {
      result[key] = typeof child === 'string' ? summary(child, budget) : { summary: summary(child, budget) }
    } else if (key === 'content' && Array.isArray(child)) {
      let previews = 0
      const blocks = child.flatMap(block => {
        // Keep every tool correlation block, even when several share a message.
        if (object(block) && (block.type === 'tool-call' || block.type === 'tool-result')) return [toolValue(block, budget)]
        const preview = object(block) ? block.text ?? block : block
        // A recognised group round is conversation content: keep it even when it
        // would fall outside the two-preview budget. Earlier previews already go
        // through summary(), which preserves the same shape.
        const round = typeof preview === 'string' && preview.length > LIMIT && previews >= 2
          ? preservedRound(preview, budget) : undefined
        if (round !== undefined) return [{ type: 'text', text: round }]
        if (previews++ >= 2) return []
        return [{ type: 'text', text: summary(preview, budget) }]
      })
      // An omitted block must never turn a failed result into a success.
      if (child.some(block => object(block) && block.isError === true) && object(blocks[0])) blocks[0].isError = true
      result[key] = blocks
    } else if (key === 'text' && typeof child === 'string') result[key] = summary(child, budget)
    else result[key] = toolValue(child, budget)
  }
  return result
}

function messageSource(value: unknown): unknown {
  if (!object(value) || !('replayState' in value)) return value
  const { replayState: _replayState, ...rest } = value
  return rest
}

function messageValue(value: unknown, budget: Budget, isInjectedUser = false): unknown {
  if (Array.isArray(value)) return value.map(item => messageValue(item, budget, isInjectedUser))
  if (!object(value)) return value
  if (value.type === 'tool-call' || value.type === 'tool-result') return toolValue(value, budget)
  if (isInjectedUser && value.type === 'text' && typeof value.text === 'string' && value.text.includes('<system-reminder>')) {
    return { ...value, text: summary(value.text, budget) }
  }
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'stream') continue
    if (key === 'source') out[key] = messageSource(child)
    else out[key] = messageValue(child, budget, isInjectedUser)
  }
  return out
}

function isInjectedUserEvent(event: Record<string, unknown>): boolean {
  const data = object(event.data) ? event.data : undefined
  const msg = data && object(data.message) ? data.message : data
  const src = msg && object(msg.source) ? msg.source : undefined
  if (src && src.kind !== 'user') return true
  const content = msg && Array.isArray(msg.content) ? msg.content : undefined
  return Boolean(content?.every(b => object(b) && b.type === 'text' && typeof b.text === 'string' && b.text.trimStart().startsWith('<system-reminder>')))
}

function requestHeaderEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (!object(event.data) || !object(event.data.header)) return event
  const { tools: _tools, system: _system, ...restHeader } = event.data.header
  return { ...event, data: { ...event.data, header: restHeader } }
}

function project(value: unknown, budget: Budget): unknown {
  if (Array.isArray(value)) return value.map(item => project(item, budget))
  if (!object(value)) return value
  // Only history containers and native events are projected. Other RPCs never use this helper.
  if (object(value.event)) {
    const eventType = String(value.event.type)
    if (TOOL_EVENT_TYPES.has(eventType)) {
      const { view, ...rest } = value
      const event = toolValue(value.event, budget) as Record<string, unknown>
      const data = object(event.data) ? event.data : {}
      const title = object(view) && object(view.view) ? view.view.title : undefined
      return { ...rest, event: { ...event, data: { ...data, ...(typeof title === 'string' && !data.name && !data.toolName ? { toolName: title } : {}) } } }
    }
    if (eventType === 'request/header') return { ...value, event: requestHeaderEvent(value.event) }
    if (eventType === 'assistant/message') return { ...value, event: messageValue(value.event, budget, false) }
    if (eventType === 'user/message') return { ...value, event: messageValue(value.event, budget, isInjectedUserEvent(value.event)) }
  }
  if (typeof value.type === 'string') {
    if (TOOL_EVENT_TYPES.has(value.type)) return toolValue(value, budget)
    if (value.type === 'request/header') return requestHeaderEvent(value)
    if (value.type === 'assistant/message') return messageValue(value, budget, false)
    if (value.type === 'user/message') return messageValue(value, budget, isInjectedUserEvent(value))
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, project(child, budget)]))
}

export function compactHistory<T>(value: T): T {
  return project(value, { remaining: ROUND_BUDGET }) as T
}
