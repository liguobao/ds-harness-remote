import { processDetail } from '../screens/chat-process'
import { hasVisibleMessageText } from '../state/event-reducer'
import type { AgentBackend, ChatItem, ToolActivity } from '../types'
import { heartbeatMessageBody } from '../ui/heartbeat-message'
import {
  HANDOFF_COMMENT_PREFIX,
  firstLineSnippet,
  type SessionHandoffOrigin,
} from './handoff-preview'

export type HandoffPreset = 'review' | 'continue' | 'custom'

export interface HandoffMeta {
  version: 1
  sourceBackend: AgentBackend
  targetBackend: AgentBackend
  sourceSessionId: string
  sourceTitle?: string
  cwd?: string
  preset: HandoffPreset
  turnsCount: number
  filesCount: number
  omittedTurns: number
  createdAt: number
}

export interface HandoffPacket {
  meta: HandoffMeta
  contextBlock: string
  summaryBytes: number
  editedFiles: string[]
}

export interface PendingHandoffDraft {
  meta: HandoffMeta
  contextBlock: string
}

export interface ParsedHandoffMessage {
  meta: HandoffMeta
  contextBody: string
  instruction: string
}

const MAX_EDITED_FILES = 40
const MAX_META_TITLE_CHARS = 200
const MAX_META_CWD_CHARS = 512
const MAX_ATTACHED_FILES_IN_TURN = 10
const DEFAULT_MAX_CONTEXT_CHARS = 24_000
const FIRST_USER_MAX_CHARS = 4_000
const TOOL_SUMMARY_MAX_CHARS = 200

const HARNESS_EDIT_TOOL_KEYS = new Set([
  'write',
  'write_file',
  'edit',
  'edit_file',
  'patch',
  'apply_patch',
  'str_replace_editor',
  'replace_file_content',
  'multi_replace_file_content',
])

const PATH_ARG_KEYS = ['file_path', 'path', 'filename', 'TargetFile'] as const
const ACP_EDIT_PREFIX_RE = /^(?:edit|write)(?:$|[:\s/_-])/iu
const ACP_INLINE_PATH_RE = /^(?:edit|write)[:\s]+(.+)$/iu
const CODEX_CHANGE_PREFIX_RE = /^(?:\[(?:update|create|add|delete|modify|rename|write)\]\s+|(?:update|create|add|delete|modify|rename|write)\s+)/iu
const CODEX_GENERIC_SUMMARY_RE = /^(?:File changes(?: completed\.)?|Modify \d+ files?)$/iu
const CODEX_DIFF_OR_NOISE_LINE_RE = /^(?:@@|---(?:\s|$)|\+\+\+(?:\s|$)|[+-]|diff --git\b|index [0-9a-f]+\.\.[0-9a-f]+|```)/iu
const KNOWN_EXTENSIONLESS_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'gemfile',
  'procfile',
  'rakefile',
  'vagrantfile',
  'jenkinsfile',
  'readme',
  'license',
  'changelog',
  'copying',
  'notice',
  'authors',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.dockerignore',
  '.nvmrc',
])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonRecord(raw?: string): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function normalizeCandidatePath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim().replace(/^["'`]+|["'`]+$/gu, '')
  if (
    trimmed.length === 0
    || trimmed === '.'
    || trimmed === '..'
    || trimmed.includes('\0')
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(trimmed)
  ) {
    return undefined
  }
  return trimmed
}

function looksLikeWorkspacePath(candidate: string, hadPrefix: boolean): boolean {
  if (candidate.length === 0 || candidate.length > 260) return false
  if (/[;{}()=]|=>|\/\/|\/\*|\*\/|:\s/u.test(candidate)) return false
  if (!hadPrefix && /\s{2,}/u.test(candidate)) return false
  const base = candidate.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() ?? ''
  if (base.length === 0) return false
  const hasSlash = /[\\/]/u.test(candidate)
  const hasExt = /\.[a-z0-9]{1,12}$/iu.test(base)
  const isKnown = KNOWN_EXTENSIONLESS_BASENAMES.has(base.toLowerCase())
  if (!hasSlash && !hasExt && !isKnown) return false
  if (!hadPrefix && /\s/u.test(candidate) && !hasSlash) return false
  return true
}

function extractPathsFromArgs(args: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const key of PATH_ARG_KEYS) {
    const candidate = normalizeCandidatePath(args[key])
    if (candidate !== undefined) paths.push(candidate)
  }
  return paths
}

function parseCodexFileChangeText(text?: string): string[] {
  if (typeof text !== 'string' || text.trim().length === 0) return []
  const paths: string[] = []
  for (const rawLine of text.split(/\r?\n/u)) {
    const trimmed = rawLine.trim()
    if (trimmed.length === 0 || CODEX_GENERIC_SUMMARY_RE.test(trimmed)) continue
    const hadPrefix = CODEX_CHANGE_PREFIX_RE.test(trimmed)
    // Skip indented unified-diff context lines and explicit diff/code markers.
    if (!hadPrefix && (/^\s/u.test(rawLine) || CODEX_DIFF_OR_NOISE_LINE_RE.test(trimmed))) continue
    const stripped = hadPrefix ? trimmed.replace(CODEX_CHANGE_PREFIX_RE, '').trim() : trimmed
    const candidate = normalizeCandidatePath(stripped)
    if (candidate !== undefined && looksLikeWorkspacePath(candidate, hadPrefix)) {
      paths.push(candidate)
    }
  }
  return paths
}

function extractToolEditedPaths(tool: ToolActivity): string[] {
  if (tool.state !== 'finished') return []
  const rawKey = (tool.toolKey ?? tool.toolName).trim()
  const shortKey = rawKey.toLowerCase().split(/[./]/u).at(-1) ?? ''
  const args = parseJsonRecord(tool.arguments)

  if (tool.toolKey === 'file_change' || tool.toolKey === 'codex.fileChange') {
    const argPaths = Array.isArray(args?.changes)
      ? args.changes.flatMap(entry => isPlainRecord(entry) ? [normalizeCandidatePath(entry.path)].filter((v): v is string => v !== undefined) : [])
      : []
    const detailPaths = parseCodexFileChangeText(tool.resultDetail?.text ?? tool.callDetail?.text)
    if (argPaths.length > 0 || detailPaths.length > 0) return [...argPaths, ...detailPaths]
    return parseCodexFileChangeText(tool.summary)
  }

  if (HARNESS_EDIT_TOOL_KEYS.has(shortKey)) {
    if (shortKey === 'str_replace_editor' && args?.command === 'view') return []
    const harnessPaths = args ? extractPathsFromArgs(args) : []
    if (harnessPaths.length > 0) return harnessPaths
  }

  const hasAcpPrefix = ACP_EDIT_PREFIX_RE.test(tool.toolName.trim()) || (tool.toolKey !== undefined && ACP_EDIT_PREFIX_RE.test(tool.toolKey.trim()))
  if (!hasAcpPrefix) return []

  const results: string[] = []
  if (args) results.push(...extractPathsFromArgs(args))
  const inlineMatch = ACP_INLINE_PATH_RE.exec(tool.toolName.trim())
  if (inlineMatch?.[1] !== undefined) {
    const candidate = normalizeCandidatePath(inlineMatch[1])
    if (candidate !== undefined && !/^(?:file|files|text)$/iu.test(candidate) && (/[\\/.]/u.test(candidate) || !/\s/u.test(candidate))) {
      results.push(candidate)
    }
  }
  if (results.length === 0 && typeof tool.resultDetail?.text === 'string') {
    for (const match of tool.resultDetail.text.matchAll(/^File:\s+(.+)$/gmu)) {
      const candidate = normalizeCandidatePath(match[1])
      if (candidate !== undefined) results.push(candidate)
    }
  }
  return results
}

/** Collect deduplicated workspace file paths modified by non-failed tools, capped at 40. */
export function extractHandoffEditedFiles(items: ChatItem[]): string[] {
  const seen = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'tool') continue
    for (const path of extractToolEditedPaths(item)) {
      seen.add(path)
      if (seen.size >= MAX_EDITED_FILES) return [...seen]
    }
  }
  return [...seen]
}

/** Validate and normalize an untrusted HandoffMeta object; returns undefined if invalid. */
export function parseHandoffMeta(value: unknown): HandoffMeta | undefined {
  if (!isPlainRecord(value)) return undefined
  if (value.version !== 1) return undefined
  if (typeof value.sourceBackend !== 'string' || value.sourceBackend.trim().length === 0) return undefined
  if (typeof value.targetBackend !== 'string' || value.targetBackend.trim().length === 0) return undefined
  if (typeof value.sourceSessionId !== 'string' || value.sourceSessionId.trim().length === 0) return undefined
  if (value.sourceTitle !== undefined && typeof value.sourceTitle !== 'string') return undefined
  if (value.cwd !== undefined && typeof value.cwd !== 'string') return undefined
  if (value.preset !== 'review' && value.preset !== 'continue' && value.preset !== 'custom') return undefined
  if (typeof value.turnsCount !== 'number' || !Number.isInteger(value.turnsCount) || value.turnsCount < 0) return undefined
  if (typeof value.filesCount !== 'number' || !Number.isInteger(value.filesCount) || value.filesCount < 0) return undefined
  if (typeof value.omittedTurns !== 'number' || !Number.isInteger(value.omittedTurns) || value.omittedTurns < 0) return undefined
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt < 0) return undefined

  return {
    version: 1,
    sourceBackend: value.sourceBackend,
    targetBackend: value.targetBackend,
    sourceSessionId: value.sourceSessionId,
    ...(value.sourceTitle !== undefined ? { sourceTitle: value.sourceTitle } : {}),
    ...(value.cwd !== undefined ? { cwd: value.cwd } : {}),
    preset: value.preset,
    turnsCount: value.turnsCount,
    filesCount: value.filesCount,
    omittedTurns: value.omittedTurns,
    createdAt: value.createdAt,
  }
}

/** Strictly parse a serialized handoff prompt envelope into metadata, context body, and trailing instruction. */
export function parseHandoffMessage(text: string): ParsedHandoffMessage | undefined {
  const match = /^\s*<!-- dsh-handoff:v1 ([^\r\n]*?) -->\r?\n<handoff_context>\r?\n([\s\S]*?)\r?\n<\/handoff_context>(?:[\r\n]+([\s\S]*))?\s*$/u.exec(text)
  if (!match) return undefined

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(match[1]!)
  } catch {
    return undefined
  }
  const meta = parseHandoffMeta(parsedJson)
  if (meta === undefined) return undefined

  return {
    meta,
    contextBody: match[2]!,
    instruction: (match[3] ?? '').trim(),
  }
}

function escapeEmbeddedTags(text: string): string {
  return text
    .replace(/<(\/?handoff_context)/giu, '&lt;$1')
    .replace(/<!--(\s*dsh-handoff:)/giu, '&lt;!--$1')
}

function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  if (maxChars === 1) return '…'
  return `${text.slice(0, maxChars - 1).trimEnd()}…`
}

function summarizeToolLine(tool: ToolActivity): string {
  const name = (tool.toolKey ?? tool.toolName).replace(/\s+/gu, ' ').trim() || 'tool'
  const rawSummary = (tool.summary && !tool.summary.trim().startsWith('{') ? tool.summary : undefined)
    ?? processDetail(tool)
    ?? tool.resultDetail?.text
    ?? tool.callDetail?.text
    ?? tool.arguments
    ?? (tool.toolKey && tool.toolName !== tool.toolKey ? tool.toolName : '')
  const singleLine = escapeEmbeddedTags(rawSummary.replace(/\s+/gu, ' ').trim())
  const statusPrefixed = tool.state === 'failed'
    ? (singleLine ? `failed: ${singleLine}` : 'failed')
    : singleLine
  const boundedSummary = truncateText(statusPrefixed, TOOL_SUMMARY_MAX_CHARS)
  return boundedSummary ? `[tool: ${name}] ${boundedSummary}` : `[tool: ${name}]`
}

type HandoffEntry =
  | { kind: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; line: string }

function normalizeTranscriptEntries(items: ChatItem[]): HandoffEntry[] {
  const entries: HandoffEntry[] = []
  for (const item of items) {
    if (item.kind === 'approval' || item.kind === 'question') continue
    if (item.kind === 'tool') {
      if (item.state !== 'finished' && item.state !== 'failed') continue
      entries.push({ kind: 'tool', line: summarizeToolLine(item) })
      continue
    }
    if (item.streaming === true) continue
    if (item.sendState === 'failed' || item.sendState === 'canceled' || item.sendState === 'unconfirmed') continue
    if (item.usageOnly === true || item.context === true || item.role === 'system') continue

    let text = item.text
    if (item.role === 'user') {
      const priorHandoff = parseHandoffMessage(text)
      if (priorHandoff !== undefined) text = priorHandoff.instruction
      const heartbeat = heartbeatMessageBody(text, 'user')
      if (heartbeat !== undefined) text = heartbeat
    } else {
      const heartbeat = heartbeatMessageBody(text, 'assistant')
      if (heartbeat !== undefined) text = heartbeat
    }

    const attachedNames = item.role === 'user' && item.files && item.files.length > 0
      ? item.files
        .map(file => (file.name || file.path).trim())
        .filter(name => name.length > 0)
      : []
    const attachmentSummary = attachedNames.length > 0
      ? `[Attached files: ${attachedNames.slice(0, MAX_ATTACHED_FILES_IN_TURN).join(', ')}${attachedNames.length > MAX_ATTACHED_FILES_IN_TURN ? `, +${attachedNames.length - MAX_ATTACHED_FILES_IN_TURN} more` : ''}]`
      : ''

    const hasText = hasVisibleMessageText(text)
    if (!hasText && attachmentSummary.length === 0) continue
    const combined = hasText && attachmentSummary.length > 0
      ? `${text.trim()}\n${attachmentSummary}`
      : (hasText ? text.trim() : attachmentSummary)
    entries.push({ kind: item.role, text: escapeEmbeddedTags(combined) })
  }
  return entries
}

function formatEntryBlock(entry: HandoffEntry, maxTextChars?: number): string {
  if (entry.kind === 'tool') {
    return maxTextChars === undefined ? entry.line : truncateText(entry.line, maxTextChars)
  }
  const roleLabel = entry.kind === 'user' ? '[User]' : '[Assistant]'
  const body = maxTextChars === undefined ? entry.text : truncateText(entry.text, maxTextChars)
  return `${roleLabel}\n${body}`
}

function safeCommentJson(meta: HandoffMeta): string {
  // Keep backend direction first and sourceTitle next so short previews retain both.
  const { sourceBackend, targetBackend, sourceTitle, ...rest } = meta
  return JSON.stringify({
    sourceBackend,
    targetBackend,
    sourceTitle,
    ...rest,
  })
    .replace(/--/gu, '\\u002d\\u002d')
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
}

function buildContextBlock(
  meta: HandoffMeta,
  editedFiles: readonly string[],
  transcriptBody: string,
): string {
  const safeTitle = meta.sourceTitle ? escapeEmbeddedTags(meta.sourceTitle.replace(/\s+/gu, ' ').trim()) : undefined
  const safeCwd = meta.cwd ? escapeEmbeddedTags(meta.cwd.trim()) : undefined
  const headerLines = [
    `Handoff from ${meta.sourceBackend} to ${meta.targetBackend} (source session: ${meta.sourceSessionId}${safeTitle ? `, title: "${safeTitle}"` : ''}).`,
    `Workspace directory: ${safeCwd ?? '(unspecified)'}`,
    'All prior file edits and workspace changes from the previous agent are already reflected on disk in this workspace.',
    'Do NOT re-run completed steps, do NOT revert prior work unless instructed, and do NOT spawn another handoff or sub-thread. Proceed directly with the user instruction after this handoff context block.',
  ]
  const sections: string[] = [headerLines.join('\n')]
  if (editedFiles.length > 0) {
    sections.push(`Edited files (${editedFiles.length}):\n${editedFiles.map(file => `- ${escapeEmbeddedTags(file)}`).join('\n')}`)
  }
  if (transcriptBody.length > 0) {
    const omittedSuffix = meta.omittedTurns > 0 ? `, ${meta.omittedTurns} earlier items omitted` : ''
    sections.push(`Conversation history (${meta.turnsCount} turns${omittedSuffix}):\n\n${transcriptBody}`)
  }
  return `${HANDOFF_COMMENT_PREFIX}${safeCommentJson(meta)} -->\n<handoff_context>\n${sections.join('\n\n')}\n</handoff_context>`
}

/** Build a bounded, self-contained cross-agent handoff packet from chat history items. */
export function buildHandoffPacket({
  items,
  sourceBackend,
  targetBackend,
  sourceSessionId,
  sourceTitle,
  cwd,
  preset,
  maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
  now = Date.now(),
}: {
  items: ChatItem[]
  sourceBackend: AgentBackend
  targetBackend: AgentBackend
  sourceSessionId: string
  sourceTitle?: string
  cwd?: string
  preset: HandoffPreset
  maxContextChars?: number
  now?: number
}): HandoffPacket {
  const editedFiles = extractHandoffEditedFiles(items)
  const entries = normalizeTranscriptEntries(items)

  const trimmedTitle = sourceTitle?.trim()
  const boundedTitle = trimmedTitle && trimmedTitle.length > 0
    ? truncateText(trimmedTitle, MAX_META_TITLE_CHARS)
    : undefined
  const trimmedCwd = cwd?.trim()
  const boundedCwd = trimmedCwd && trimmedCwd.length > 0
    ? truncateText(trimmedCwd, MAX_META_CWD_CHARS)
    : undefined
  const baseMeta: HandoffMeta = {
    version: 1,
    sourceBackend,
    targetBackend,
    sourceSessionId,
    ...(boundedTitle !== undefined ? { sourceTitle: boundedTitle } : {}),
    ...(boundedCwd !== undefined ? { cwd: boundedCwd } : {}),
    preset,
    turnsCount: 999,
    filesCount: editedFiles.length,
    omittedTurns: 999,
    createdAt: now,
  }
  const omissionPlaceholder = '[... 99999 earlier items omitted ...]'
  const envelopeOverhead = buildContextBlock(
    baseMeta,
    editedFiles,
    `${omissionPlaceholder}\n\n${omissionPlaceholder}`,
  ).length + 4
  const transcriptBudget = Math.max(0, maxContextChars - envelopeOverhead)

  const userCount = entries.reduce((count, entry) => count + (entry.kind === 'user' ? 1 : 0), 0)
  const firstUserIdx = entries.findIndex(entry => entry.kind === 'user')
  const reserveFirstUser = userCount > 1 && firstUserIdx >= 0

  let remaining = transcriptBudget
  let reservedFirstBlock: string | undefined
  const includedIndices = new Set<number>()

  if (reserveFirstUser && remaining > 0) {
    const firstCap = remaining >= 8_000
      ? FIRST_USER_MAX_CHARS
      : Math.min(FIRST_USER_MAX_CHARS, Math.max(80, Math.floor(remaining * 0.45)))
    const candidate = formatEntryBlock(entries[firstUserIdx]!, firstCap)
    if (candidate.length <= remaining) {
      reservedFirstBlock = candidate
      includedIndices.add(firstUserIdx)
      remaining -= candidate.length
    }
  }

  const beforeFirstBlocks: string[] = []
  const recentBlocks: string[] = []
  const pushSelectedBlock = (idx: number, block: string) => {
    if (reservedFirstBlock !== undefined && idx < firstUserIdx) {
      beforeFirstBlocks.unshift(block)
    } else {
      recentBlocks.unshift(block)
    }
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (includedIndices.has(i)) continue
    const block = formatEntryBlock(entries[i]!)
    const hasAnySelected = recentBlocks.length > 0 || beforeFirstBlocks.length > 0 || reservedFirstBlock !== undefined
    const joinCost = hasAnySelected ? 2 : 0
    if (block.length + joinCost <= remaining) {
      pushSelectedBlock(i, block)
      includedIndices.add(i)
      remaining -= block.length + joinCost
      continue
    }
    if (recentBlocks.length === 0 && beforeFirstBlocks.length === 0 && remaining - joinCost >= 80) {
      const headerLen = entries[i]!.kind === 'tool' ? 0 : (entries[i]!.kind === 'user' ? '[User]\n'.length : '[Assistant]\n'.length)
      const textCap = Math.max(24, remaining - joinCost - headerLen)
      pushSelectedBlock(i, formatEntryBlock(entries[i]!, textCap))
      includedIndices.add(i)
      remaining = 0
    }
    break
  }

  const omittedTurns = entries.length - includedIndices.size
  let includedUsers = 0
  let includedAssistants = 0
  for (const idx of includedIndices) {
    const kind = entries[idx]!.kind
    if (kind === 'user') includedUsers += 1
    else if (kind === 'assistant') includedAssistants += 1
  }
  const turnsCount = includedUsers > 0 ? includedUsers : (includedAssistants > 0 ? 1 : 0)

  const transcriptParts: string[] = []
  if (reservedFirstBlock !== undefined) {
    let omittedBeforeFirst = 0
    for (let i = 0; i < firstUserIdx; i += 1) {
      if (!includedIndices.has(i)) omittedBeforeFirst += 1
    }
    const omittedAfterFirst = omittedTurns - omittedBeforeFirst
    if (omittedBeforeFirst > 0) {
      transcriptParts.push(`[... ${omittedBeforeFirst} earlier items omitted ...]`)
    }
    transcriptParts.push(...beforeFirstBlocks)
    transcriptParts.push(reservedFirstBlock)
    if (omittedAfterFirst > 0) {
      transcriptParts.push(`[... ${omittedAfterFirst} earlier items omitted ...]`)
    }
  } else if (omittedTurns > 0) {
    transcriptParts.push(`[... ${omittedTurns} earlier items omitted ...]`)
  }
  transcriptParts.push(...recentBlocks)

  const meta: HandoffMeta = {
    version: 1,
    sourceBackend,
    targetBackend,
    sourceSessionId,
    ...(baseMeta.sourceTitle !== undefined ? { sourceTitle: baseMeta.sourceTitle } : {}),
    ...(baseMeta.cwd !== undefined ? { cwd: baseMeta.cwd } : {}),
    preset,
    turnsCount,
    filesCount: editedFiles.length,
    omittedTurns,
    createdAt: now,
  }

  const contextBlock = buildContextBlock(meta, editedFiles, transcriptParts.join('\n\n'))
  const summaryBytes = new TextEncoder().encode(contextBlock).byteLength

  return {
    meta,
    contextBlock,
    summaryBytes,
    editedFiles,
  }
}

/** Combine a handoff context block with the user instruction, never starting with '/'. */
export function formatHandoffPayload(
  packetOrDraft: { meta: HandoffMeta; contextBlock: string },
  instruction: string,
): string {
  const rawBlock = packetOrDraft.contextBlock.trim()
  const safeBlock = rawBlock.startsWith('/') ? `${HANDOFF_COMMENT_PREFIX}${safeCommentJson(packetOrDraft.meta)} -->\n${rawBlock}` : rawBlock
  const trimmedInstruction = instruction.trim()
  if (trimmedInstruction.length === 0) return safeBlock
  return `${safeBlock}\n\n${trimmedInstruction}`
}

/** Extract normalized handoff origin metadata from loaded chat messages, preferring the latest handoff turn. */
export function extractHandoffOriginFromItems(
  items: readonly ChatItem[] | undefined,
): SessionHandoffOrigin | undefined {
  if (!items || items.length === 0) return undefined
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item?.kind !== 'message' || item.role !== 'user') continue
    const parsed = parseHandoffMessage(item.text)
    if (parsed === undefined) continue
    const fallbackTitle = firstLineSnippet(parsed.instruction, 80)
    return {
      sourceBackend: parsed.meta.sourceBackend,
      targetBackend: parsed.meta.targetBackend,
      sourceSessionId: parsed.meta.sourceSessionId,
      ...(parsed.meta.sourceTitle !== undefined ? { sourceTitle: parsed.meta.sourceTitle } : {}),
      ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
      preset: parsed.meta.preset,
      createdAt: parsed.meta.createdAt,
    }
  }
  return undefined
}
