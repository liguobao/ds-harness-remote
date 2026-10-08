import type { ChatItem, ChatMessage, ToolActivity } from '../types'
import { hasVisibleMessageText } from '../state/event-reducer'
import { strings } from '../locales/i18n'

// Mirrors ui-chat/conversation-nodes/process-groups.ts: reasoning enters the
// pending activity group; every spoken reply flushes it before rendering.
export type ProcessSegment =
  | { kind: 'activity'; key: string; items: ChatItem[] }
  | { kind: 'response'; key: string; item: ChatMessage }

export function processSegments(items: ChatItem[]): ProcessSegment[] {
  const segments: ProcessSegment[] = []
  let pending: ChatItem[] = []
  const flush = () => {
    if (pending.length > 0) segments.push({ kind: 'activity', key: `activity:${pending[0]!.id}`, items: pending })
    pending = []
  }
  for (const item of items) {
    if (item.kind !== 'message' || item.role !== 'assistant') {
      pending.push(item)
      continue
    }
    if (hasVisibleMessageText(item.reasoning ?? '')) pending.push({ ...item, text: '', images: undefined })
    if (hasVisibleMessageText(item.text) || (item.images?.length ?? 0) > 0) {
      flush()
      segments.push({ kind: 'response', key: `response:${item.id}`, item: { ...item, reasoning: undefined } })
    }
  }
  flush()
  return segments
}

export type ProcessActivity = 'thinking' | 'read' | 'readImage' | 'write' | 'search' | 'edit' | 'commands'
  | 'code' | 'webSearch' | 'webFetch' | 'subagents' | 'plan' | 'questions' | 'tools'

/** Official ui-chat/process-activity.ts categories, retaining display-title fallbacks for old Hosts. */
export function toolActivity(tool: ToolActivity): ProcessActivity {
  const name = tool.toolKey ?? tool.toolName
  if (name === 'read' || name === 'view_file') return 'read'
  if (name === 'read_image') return 'readImage'
  if (name === 'grep' || name === 'glob' || name.endsWith('_inspect')) return 'search'
  if (name === 'write') return 'write'
  if (name === 'edit' || name === 'apply_patch') return 'edit'
  if (['bash', 'pwsh', 'exec_command', 'write_stdin', 'run_command'].includes(name) || name.startsWith('terminal_')) return 'commands'
  if (name === 'run_code') return 'code'
  if (name === 'web_search') return 'webSearch'
  if (name === 'web_fetch') return 'webFetch'
  if (name === 'subagent' || name.startsWith('subagent_')) return 'subagents'
  if (['todo_write', 'create_goal', 'update_goal', 'get_goal'].includes(name)) return 'plan'
  if (name === 'ask_user_question' || name === 'request_user_input') return 'questions'
  if (tool.toolKey === undefined && /运行命令|run command|shell|bash/i.test(name)) return 'commands'
  return 'tools'
}

export function processDetail(tool: ToolActivity): string | undefined {
  const normalize = (value: unknown): string => {
    const text = typeof value === 'string' ? value
      : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.join(', ') : ''
    const chars = Array.from(text.replace(/\s+/g, ' ').trim())
    return chars.length <= 160 ? chars.join('') : `${chars.slice(0, 159).join('').trimEnd()}…`
  }
  if (tool.summary?.trim() && !tool.summary.trim().startsWith('{')) return normalize(tool.summary)
  try {
    const args: unknown = JSON.parse(tool.arguments ?? tool.summary ?? '')
    if (args !== null && typeof args === 'object') {
      for (const key of ['title', 'description', 'objective', 'task', 'task_name', 'name', 'question', 'questions', 'prompt',
        'message', 'command', 'cmd', 'queries', 'query', 'pattern', 'url', 'uri', 'file_path', 'path', 'target', 'action', 'status']) {
        const detail: unknown = Reflect.get(args, key)
        if (key === 'questions' && Array.isArray(detail)) {
          for (const question of detail) {
            const text = normalize(question !== null && typeof question === 'object' ? Reflect.get(question, 'question') : '')
            if (text !== '') return text
          }
        } else {
          const text = normalize(detail)
          if (text !== '') return text
        }
      }
    }
  } catch { /* Like Harness, partial arguments have no one-line task detail. */ }
  return undefined
}

/** ui-chat/step-process.ts title composition, including the shared Chinese prefix. */
export function completedProcessTitle(ranked: ProcessActivity[]): string {
  const copy = strings.chatProcess
  const labels = ranked.slice(0, 3).map(kind => copy.processActivity[kind].done)
  const first = labels[0]
  if (first === undefined) return copy.processActivity.thinking.done
  const second = labels[1]
  if (second === undefined) return first
  const continuation = (label: string) => label.charAt(0).toLowerCase() + label.slice(1)
  if (labels.length === 2) {
    const shared = copy.sharedPrefix !== '' && first.startsWith(copy.sharedPrefix) && second.startsWith(copy.sharedPrefix)
    return copy.joinTwo(first, continuation(shared ? second.slice(copy.sharedPrefix.length) : second))
  }
  return [first, ...labels.slice(1).map(continuation)].join(copy.join) + (ranked.length > 3 ? copy.more : '')
}

export function toolDisplayName(tool: ToolActivity): string {
  // Keep Host-provided titles; localize only the built-in raw tool keys.
  if (tool.toolKey !== undefined && tool.toolName !== tool.toolKey) return tool.toolName
  const names: Partial<Record<string, string>> = strings.chatProcess.toolTitles
  return names[tool.toolKey ?? tool.toolName] ?? tool.toolName
}
